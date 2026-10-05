import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import {
  CreateMeasurementRecordBody,
  CreateMeasurementRecordResponse,
  CreateMeasurementReferenceBody,
  CreateMeasurementReferenceResponse,
  DeleteMeasurementRecordParams,
  DeleteMeasurementReferenceParams,
  DeleteMeasurementVersionParams,
  DownloadMeasurementVersionParams,
  ListMeasurementRecordsResponse,
  ListMeasurementReferencesResponse,
  PreviewMeasurementVersionParams,
  SearchMeasurementRecordsQueryParams,
  SearchMeasurementRecordsResponse,
  UpdateMeasurementReferenceBody,
  UpdateMeasurementReferenceParams,
  UpdateMeasurementReferenceResponse,
  UpdateMeasurementRecordBody,
  UpdateMeasurementRecordParams,
  UpdateMeasurementRecordResponse,
  UpdateMeasurementVersionBody,
  UpdateMeasurementVersionParams,
  UpdateMeasurementVersionResponse,
  UploadMeasurementVersionParams,
  UploadMeasurementVersionHeader,
  UploadMeasurementVersionResponse,
} from "@workspace/api-zod";
import { Router, type Request, type RequestHandler } from "express";
import {
  getMeasurementRecords,
  getMeasurementReferences,
  getMongoClient,
  getMeasurementSheetsBucket,
  getMeasurementVersions,
  getMongoDb,
  getOrders,
  getPublicUser,
  getQuotationRateSubmissions,
  getUsers,
  type MeasurementRecordDocument,
  type MeasurementReferenceDocument,
  type MeasurementVersionDocument,
  type OrderDocument,
} from "../lib/mongo";
import {
  removeProjectUpload,
  resolveProjectUploadPath,
  storeProjectUpload,
} from "../lib/project-upload-storage";

const router = Router();
const MAX_FILE_BYTES = 10 * 1024 * 1024;
class LinkConflict extends Error {}
const isDuplicateKeyError = (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 11000);
const sheetTypes: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};

type Actor = {
  id: string;
  name: string;
  permissions: Record<string, string>;
  masterAdmin: boolean;
};

async function actorContext(
  req: Request,
  res: Parameters<RequestHandler>[1],
  edit = false,
  quotationLinkLookup = false,
): Promise<Actor | null> {
  const db = await getMongoDb();
  const user = req.session.userId
    ? await getUsers(db).findOne({ _id: req.session.userId, status: "active" })
    : null;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return null;
  }
  const publicUser = await getPublicUser(user, db);
  const permission = publicUser.permissions.measurements ?? "none";
  const canLinkQuotation = publicUser.permissions["quotation-builder"] === "edit"
    || publicUser.permissions["rate-approval"] === "edit";
  const hasMeasurementAccess = permission !== "none" && (!edit || permission === "edit");
  if (publicUser.roleId !== "master-admin" && !hasMeasurementAccess && !(quotationLinkLookup && canLinkQuotation)) {
    res.status(403).json({
      error: edit ? "Measurement database editing access is required." : "Measurement database access is required.",
    });
    return null;
  }
  return {
    id: user._id,
    name: user.name,
    permissions: publicUser.permissions,
    masterAdmin: publicUser.roleId === "master-admin",
  };
}

function versionResponse(version: MeasurementVersionDocument) {
  return {
    id: version._id,
    versionNumber: version.versionNumber,
    filename: version.filename,
    contentType: version.contentType,
    sizeBytes: version.sizeBytes,
    uploadedBy: version.uploadedBy,
    uploadedByName: version.uploadedByName,
    name: version.name ?? null,
    measurementType: version.measurementType ?? null,
    referenceType: version.referenceType ?? null,
    referenceId: version.referenceId ?? null,
    referenceName: version.referenceName ?? null,
    uploadedAt: version.uploadedAt.toISOString(),
  };
}

function referenceResponse(reference: Pick<MeasurementReferenceDocument, "_id" | "name" | "kind">) {
  return { id: reference._id, name: reference.name, kind: reference.kind ?? "custom" };
}

router.get("/measurement-references", async (req, res): Promise<void> => {
  const actor = await actorContext(req, res);
  if (!actor) return;
  const db = await getMongoDb();
  const [users, managedReferences] = await Promise.all([
    getUsers(db).find({ status: "active" }, { projection: { _id: 1, name: 1 } }).sort({ name: 1 }).toArray(),
    getMeasurementReferences(db).find({}).sort({ nameLower: 1 }).toArray(),
  ]);
  const references = [
    ...users.map((user) => ({ id: user._id, name: user.name, kind: "user" as const })),
    ...managedReferences.map(referenceResponse),
  ].sort((a, b) => a.name.localeCompare(b.name));
  res.json(ListMeasurementReferencesResponse.parse(references));
});

router.post("/measurement-references", async (req, res): Promise<void> => {
  const parsed = CreateMeasurementReferenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const actor = await actorContext(req, res, true);
  if (!actor) return;
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Reference name cannot be blank." });
    return;
  }
  const now = new Date();
  const reference: MeasurementReferenceDocument = {
    _id: randomUUID(),
    name,
    nameLower: name.toLowerCase(),
    kind: parsed.data.kind ?? "custom",
    createdBy: actor.id,
    updatedBy: actor.id,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await getMeasurementReferences(await getMongoDb()).insertOne(reference);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      res.status(409).json({ error: "A reference with that name already exists." });
      return;
    }
    throw error;
  }
  res.status(201).json(CreateMeasurementReferenceResponse.parse(referenceResponse(reference)));
});

router.patch("/measurement-references/:referenceId", async (req, res): Promise<void> => {
  const parsedParams = UpdateMeasurementReferenceParams.safeParse(req.params);
  const parsedBody = UpdateMeasurementReferenceBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({
      error: !parsedParams.success ? parsedParams.error.message : parsedBody.success ? "" : parsedBody.error.message,
    });
    return;
  }
  const actor = await actorContext(req, res, true);
  if (!actor) return;
  const name = parsedBody.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Reference name cannot be blank." });
    return;
  }
  const db = await getMongoDb();
  const referenceCollection = getMeasurementReferences(db);
  const existingReference = await referenceCollection.findOne({ _id: parsedParams.data.referenceId });
  if (!existingReference) {
    res.status(404).json({ error: "Measurement reference not found." });
    return;
  }
  const kind = existingReference.kind ?? "custom";
  try {
    const updated = await referenceCollection.updateOne(
      { _id: parsedParams.data.referenceId },
      { $set: { name, nameLower: name.toLowerCase(), updatedBy: actor.id, updatedAt: new Date() } },
    );
    if (!updated.matchedCount) {
      res.status(404).json({ error: "Measurement reference not found." });
      return;
    }
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      res.status(409).json({ error: "A reference with that name already exists." });
      return;
    }
    throw error;
  }
  await getMeasurementVersions(db).updateMany(
    { referenceType: kind, referenceId: parsedParams.data.referenceId },
    { $set: { referenceName: name } },
  );
  res.json(UpdateMeasurementReferenceResponse.parse({
    id: parsedParams.data.referenceId,
    name,
    kind,
  }));
});

router.delete("/measurement-references/:referenceId", async (req, res): Promise<void> => {
  const parsed = DeleteMeasurementReferenceParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const actor = await actorContext(req, res, true);
  if (!actor) return;
  const deleted = await getMeasurementReferences(await getMongoDb()).deleteOne({ _id: parsed.data.referenceId });
  if (!deleted.deletedCount) {
    res.status(404).json({ error: "Measurement reference not found." });
    return;
  }
  res.status(204).send();
});

async function recordResponse(record: MeasurementRecordDocument) {
  const db = await getMongoDb();
  const [versions, order, quotation] = await Promise.all([
    getMeasurementVersions(db).find({ recordId: record._id }).sort({ versionNumber: -1 }).toArray(),
    record.orderRecordId ? getOrders(db).findOne({ _id: record.orderRecordId }) : Promise.resolve(null),
    getQuotationRateSubmissions(db).findOne({ measurementRecordId: record._id }, { projection: { _id: 1 } }),
  ]);
  return {
    id: record._id,
    clientName: record.clientName,
    location: record.location,
    orderRecordId: record.orderRecordId,
    orderId: order?.orderId ?? null,
    quotationRequestId: quotation?._id ?? null,
    versions: versions.map(versionResponse),
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

router.get("/measurement-records", async (req, res): Promise<void> => {
  const actor = await actorContext(req, res);
  if (!actor) return;
  const records = await getMeasurementRecords(await getMongoDb()).find({}).sort({ updatedAt: -1 }).toArray();
  const response = await Promise.all(records.map(recordResponse));
  res.json(ListMeasurementRecordsResponse.parse(response));
});

router.get("/measurement-records/lookup", async (req, res): Promise<void> => {
  const query = SearchMeasurementRecordsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const actor = await actorContext(req, res, false, true);
  if (!actor) return;
  const rawQuery = query.data.query.trim();
  const clientSearch = rawQuery.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const idSearch = rawQuery.replace(/^MS-/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const searchConditions: Record<string, unknown>[] = [{ clientNameLower: { $regex: clientSearch } }];
  if (rawQuery) searchConditions.push({ location: { $regex: clientSearch, $options: "i" } });
  if (idSearch) searchConditions.push({ _id: { $regex: idSearch, $options: "i" } });
  const db = await getMongoDb();
  const cursor = getMeasurementRecords(db)
    .find(rawQuery ? { $or: searchConditions } : {}, {
      projection: { _id: 1, clientName: 1, location: 1, orderRecordId: 1, updatedAt: 1 },
    })
    .sort({ updatedAt: -1 });
  if (rawQuery) cursor.limit(20);
  const records = await cursor.toArray();
  const quotationLinks = records.length
    ? await getQuotationRateSubmissions(db)
        .find({ measurementRecordId: { $in: records.map((record) => record._id) } }, { projection: { _id: 1, measurementRecordId: 1 } })
        .toArray()
    : [];
  const quotationIdByRecord = new Map(quotationLinks.map((item) => [item.measurementRecordId!, item._id]));
  const linkedOrderRecords = records.flatMap((record) => record.orderRecordId ? [record.orderRecordId] : []);
  const linkedOrders = linkedOrderRecords.length
    ? await getOrders(db).find({ _id: { $in: linkedOrderRecords } }, { projection: { _id: 1, orderId: 1 } }).toArray()
    : [];
  const orderIdByRecord = new Map(linkedOrders.map((item) => [item._id, item.orderId]));
  const response = records.map((record) => ({
    id: record._id,
    clientName: record.clientName,
    location: record.location,
    orderId: record.orderRecordId ? orderIdByRecord.get(record.orderRecordId) ?? null : null,
    quotationRequestId: quotationIdByRecord.get(record._id) ?? null,
  }));
  res.json(SearchMeasurementRecordsResponse.parse(response));
});

router.post("/measurement-records", async (req, res): Promise<void> => {
  const actor = await actorContext(req, res, true);
  if (!actor) return;
  const parsed = CreateMeasurementRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const db = await getMongoDb();
  if (parsed.data.orderRecordId) {
    const order = await getOrders(db).findOne({ _id: parsed.data.orderRecordId });
    if (!order) {
      res.status(404).json({ error: "The selected order could not be found." });
      return;
    }
  }
  const now = new Date();
  const record: MeasurementRecordDocument = {
    _id: randomUUID(),
    clientName: parsed.data.clientName.trim(),
    clientNameLower: parsed.data.clientName.trim().toLowerCase(),
    location: parsed.data.location?.trim() || null,
    orderRecordId: parsed.data.orderRecordId,
    versionCount: 0,
    createdBy: actor.id,
    createdAt: now,
    updatedAt: now,
  };
  await getMeasurementRecords(db).insertOne(record);
  res.status(201).json(CreateMeasurementRecordResponse.parse(await recordResponse(record)));
});

router.patch("/measurement-records/:recordId", async (req, res): Promise<void> => {
  const parsedParams = UpdateMeasurementRecordParams.safeParse(req.params);
  const parsedBody = UpdateMeasurementRecordBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({
      error: !parsedParams.success ? parsedParams.error.message : parsedBody.success ? "" : parsedBody.error.message,
    });
    return;
  }
  const actor = await actorContext(req, res, true);
  if (!actor) return;
  const db = await getMongoDb();
  const collection = getMeasurementRecords(db);
  const old = await collection.findOne({ _id: parsedParams.data.recordId });
  if (!old) {
    res.status(404).json({ error: "Measurement record not found." });
    return;
  }
  const linkQuotationFieldProvided = Object.hasOwn(parsedBody.data, "linkQuotationSubmissionId");
  const hasRecordChanges = parsedBody.data.clientName !== undefined
    || parsedBody.data.location !== undefined
    || parsedBody.data.orderRecordId !== undefined;
  if (!hasRecordChanges && !linkQuotationFieldProvided) {
    res.status(400).json({ error: "Provide at least one field to update." });
    return;
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsedBody.data.clientName !== undefined) {
    const clientName = parsedBody.data.clientName.trim();
    updates.clientName = clientName;
    updates.clientNameLower = clientName.toLowerCase();
  }
  if (parsedBody.data.location !== undefined) updates.location = parsedBody.data.location?.trim() || null;
  let selectedOrder: OrderDocument | null = null;
  if (parsedBody.data.orderRecordId !== undefined) {
    if (parsedBody.data.orderRecordId) {
      selectedOrder = await getOrders(db).findOne({ _id: parsedBody.data.orderRecordId });
      if (!selectedOrder) {
        res.status(404).json({ error: "The selected order could not be found." });
        return;
      }
    }
    updates.orderRecordId = parsedBody.data.orderRecordId;
  }

  const quotationCollection = getQuotationRateSubmissions(db);
  const requestedQuotationId = parsedBody.data.linkQuotationSubmissionId ?? null;
  const requestedQuotation = linkQuotationFieldProvided && requestedQuotationId
    ? await quotationCollection.findOne({ _id: requestedQuotationId })
    : null;
  if (linkQuotationFieldProvided && requestedQuotationId && !requestedQuotation) {
    res.status(404).json({ error: "The selected quotation request could not be found." });
    return;
  }

  if (linkQuotationFieldProvided) {
    const session = (await getMongoClient()).startSession();
    try {
      await session.withTransaction(async () => {
        const existingQuotation = await quotationCollection.findOne(
          { measurementRecordId: old._id },
          { session, projection: { _id: 1 } },
        );
        if (existingQuotation && existingQuotation._id !== requestedQuotationId) {
          const cleared = await quotationCollection.updateOne(
            { _id: existingQuotation._id, measurementRecordId: old._id },
            { $set: { measurementRecordId: null, updatedAt: new Date() } },
            { session },
          );
          if (!cleared.matchedCount) {
            throw new LinkConflict("The existing quotation link changed. Refresh and try again.");
          }
        }

        if (requestedQuotation) {
          const linkedQuotation = await quotationCollection.updateOne(
            {
              _id: requestedQuotation._id,
              $or: [
                { measurementRecordId: null },
                { measurementRecordId: old._id },
                { measurementRecordId: { $exists: false } },
              ],
            },
            { $set: { measurementRecordId: old._id, updatedAt: new Date() } },
            { session },
          );
          if (!linkedQuotation.matchedCount) {
            throw new LinkConflict("This quotation request is already linked to another measurement sheet.");
          }
        }

        const updatedRecord = await collection.updateOne(
          { _id: old._id, orderRecordId: old.orderRecordId ?? null },
          { $set: updates },
          { session },
        );
        if (!updatedRecord.matchedCount) {
          throw new LinkConflict("This measurement sheet changed while linking. Refresh and try again.");
        }
      });
    } catch (error) {
      if (error instanceof LinkConflict || isDuplicateKeyError(error)) {
        res.status(409).json({
          error: error instanceof LinkConflict ? error.message : "This sheet is already linked to another quotation request.",
        });
        return;
      }
      throw error;
    } finally {
      await session.endSession();
    }
  } else {
    await collection.updateOne({ _id: old._id }, { $set: updates });
  }
  const updated = await collection.findOne({ _id: old._id });
  res.json(UpdateMeasurementRecordResponse.parse(await recordResponse(updated!)));
});

router.delete("/measurement-records/:recordId", async (req, res): Promise<void> => {
  const parsedParams = DeleteMeasurementRecordParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.message });
    return;
  }
  const actor = await actorContext(req, res, true);
  if (!actor) return;
  const db = await getMongoDb();
  const collection = getMeasurementRecords(db);
  const record = await collection.findOne({ _id: parsedParams.data.recordId });
  if (!record) {
    res.status(404).json({ error: "Measurement record not found." });
    return;
  }
  const versions = await getMeasurementVersions(db).find({ recordId: record._id }).toArray();
  const session = (await getMongoClient()).startSession();
  try {
    await session.withTransaction(async () => {
      await getQuotationRateSubmissions(db).updateMany(
        { measurementRecordId: record._id },
        { $set: { measurementRecordId: null, updatedAt: new Date() } },
        { session },
      );
      await getMeasurementVersions(db).deleteMany({ recordId: record._id }, { session });
      const deleted = await collection.deleteOne({ _id: record._id }, { session });
      if (!deleted.deletedCount) {
        throw new LinkConflict("The measurement record changed while it was being deleted.");
      }
    });
  } catch (error) {
    if (error instanceof LinkConflict) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  } finally {
    await session.endSession();
  }

  const bucket = getMeasurementSheetsBucket(db);
  for (const version of versions) {
    try {
      if (version.storagePath) {
        await removeProjectUpload(version.storagePath);
      } else if (version.gridFsId && ObjectId.isValid(version.gridFsId)) {
        const gridFsId = new ObjectId(version.gridFsId);
        if (await bucket.find({ _id: gridFsId }).next()) await bucket.delete(gridFsId);
      }
    } catch (error) {
      req.log.warn({ err: error, recordId: record._id, versionId: version._id }, "Failed to remove stored bytes for a deleted measurement record");
    }
  }
  res.status(204).send();
});

router.patch("/measurement-records/:recordId/versions/:versionId", async (req, res): Promise<void> => {
  const parsedParams = UpdateMeasurementVersionParams.safeParse(req.params);
  const parsedBody = UpdateMeasurementVersionBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({
      error: !parsedParams.success ? parsedParams.error.message : parsedBody.success ? "" : parsedBody.error.message,
    });
    return;
  }
  const actor = await actorContext(req, res, true);
  if (!actor) return;
  const db = await getMongoDb();
  const record = await getMeasurementRecords(db).findOne({ _id: parsedParams.data.recordId });
  if (!record) {
    res.status(404).json({ error: "Measurement record not found." });
    return;
  }
  const body = parsedBody.data;
  if (
    body.name === undefined &&
    body.measurementType === undefined &&
    body.referenceType === undefined &&
    body.referenceId === undefined
  ) {
    res.status(400).json({ error: "Provide at least one measurement sheet field to update." });
    return;
  }
  const fields: Partial<MeasurementVersionDocument> = {};
  if (body.name !== undefined) fields.name = body.name?.trim() || null;
  if (body.measurementType !== undefined) fields.measurementType = body.measurementType;

  const hasReferenceUpdate = body.referenceType !== undefined || body.referenceId !== undefined;
  if (hasReferenceUpdate) {
    const referenceType = body.referenceType ?? null;
    const referenceId = body.referenceId?.trim() || null;
    if (!referenceType && !referenceId) {
      fields.referenceType = null;
      fields.referenceId = null;
      fields.referenceName = null;
    } else if (!referenceType || !referenceId) {
      res.status(400).json({ error: "Select both a reference type and reference." });
      return;
    } else if (referenceType === "user") {
      const referenceUser = await getUsers(db).findOne(
        { _id: referenceId, status: "active" },
        { projection: { name: 1 } },
      );
      if (!referenceUser) {
        res.status(404).json({ error: "The selected user is not active or no longer exists." });
        return;
      }
      fields.referenceType = "user";
      fields.referenceId = referenceId;
      fields.referenceName = referenceUser.name;
    } else {
      const managedReference = await getMeasurementReferences(db).findOne({ _id: referenceId });
      const managedReferenceKind = managedReference?.kind ?? "custom";
      if (!managedReference || managedReferenceKind !== referenceType) {
        res.status(404).json({ error: "The selected reference no longer exists." });
        return;
      }
      fields.referenceType = managedReferenceKind;
      fields.referenceId = referenceId;
      fields.referenceName = managedReference.name;
    }
  }

  const updatedAt = new Date();
  const result = await getMeasurementVersions(db).updateOne(
    { _id: parsedParams.data.versionId, recordId: record._id },
    { $set: fields },
  );
  if (!result.matchedCount) {
    res.status(404).json({ error: "Measurement sheet version not found." });
    return;
  }
  await getMeasurementRecords(db).updateOne({ _id: record._id }, { $set: { updatedAt } });
  const updated = await getMeasurementVersions(db).findOne({
    _id: parsedParams.data.versionId,
    recordId: record._id,
  });
  if (!updated) {
    res.status(404).json({ error: "Measurement sheet version not found." });
    return;
  }
  res.json(UpdateMeasurementVersionResponse.parse(versionResponse(updated)));
});

router.delete("/measurement-records/:recordId/versions/:versionId", async (req, res): Promise<void> => {
  const parsed = DeleteMeasurementVersionParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const actor = await actorContext(req, res, true);
  if (!actor) return;
  const db = await getMongoDb();
  const record = await getMeasurementRecords(db).findOne({ _id: parsed.data.recordId });
  if (!record) {
    res.status(404).json({ error: "Measurement record not found." });
    return;
  }
  const versions = getMeasurementVersions(db);
  const version = await versions.findOne({ _id: parsed.data.versionId, recordId: record._id });
  if (!version) {
    res.status(404).json({ error: "Measurement sheet version not found." });
    return;
  }

  if (version.storagePath) {
    await removeProjectUpload(version.storagePath);
  } else if (version.gridFsId && ObjectId.isValid(version.gridFsId)) {
    const gridFsId = new ObjectId(version.gridFsId);
    const bucket = getMeasurementSheetsBucket(db);
    if (await bucket.find({ _id: gridFsId }).next()) await bucket.delete(gridFsId);
  }

  const deleted = await versions.deleteOne({ _id: version._id, recordId: record._id });
  if (!deleted.deletedCount) {
    res.status(404).json({ error: "Measurement sheet version not found." });
    return;
  }
  await getMeasurementRecords(db).updateOne({ _id: record._id }, { $set: { updatedAt: new Date() } });
  res.status(204).send();
});

router.post("/measurement-records/:recordId/versions/:filename", async (req, res, next): Promise<void> => {
  const parsed = UploadMeasurementVersionParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const actor = await actorContext(req, res, true);
  if (!actor) return;
  const db = await getMongoDb();
  const record = await getMeasurementRecords(db).findOne({ _id: parsed.data.recordId });
  if (!record) {
    res.status(404).json({ error: "Measurement record not found." });
    return;
  }
  const parsedHeader = UploadMeasurementVersionHeader.safeParse({
    "X-Measurement-Sheet-Name": req.headers["x-measurement-sheet-name"],
  });
  if (!parsedHeader.success) {
    res.status(400).json({ error: "Sheet name must be 160 characters or fewer." });
    return;
  }
  const encodedName = parsedHeader.data["X-Measurement-Sheet-Name"];
  let name: string | null = null;
  if (encodedName) {
    try {
      name = decodeURIComponent(encodedName).trim() || null;
    } catch {
      res.status(400).json({ error: "Sheet name could not be decoded." });
      return;
    }
    if (name && name.length > 160) {
      res.status(400).json({ error: "Sheet name must be 160 characters or fewer." });
      return;
    }
  }
  readRawFile(req, res, next, async (body) => {
    const extension = parsed.data.filename.toLowerCase().split(".").pop() ?? "";
    const contentType = sheetTypes[extension];
    const declaredType = String(req.headers["content-type"] ?? "").split(";")[0];
    if (!contentType || !body.length) {
      res.status(400).json({ error: "Choose a non-empty PDF, XLSX, or CSV measurement sheet." });
      return;
    }
    const validFileSignature = extension === "pdf"
      ? body.subarray(0, 5).toString("ascii") === "%PDF-"
      : extension === "xlsx"
        ? body.subarray(0, 4).toString("ascii") === "PK\u0003\u0004"
        : !body.includes(0);
    if (!validFileSignature) {
      res.status(400).json({ error: "The file contents do not match the selected measurement sheet type." });
      return;
    }
    if (declaredType !== contentType && declaredType !== "application/octet-stream") {
      res.status(400).json({ error: "File content type does not match the measurement sheet." });
      return;
    }

    const storagePath = await storeProjectUpload(
      "measurement-sheets",
      parsed.data.filename,
      body,
    );

    let versionedRecord: MeasurementRecordDocument | null;
    try {
      versionedRecord = await getMeasurementRecords(db).findOneAndUpdate(
        { _id: record._id },
        { $inc: { versionCount: 1 }, $set: { updatedAt: new Date() } },
        { returnDocument: "after" },
      );
    } catch (error) {
      await removeProjectUpload(storagePath).catch((cleanupError: unknown) =>
        req.log.error({ err: cleanupError }, "Failed to clean up a measurement sheet after a database error"),
      );
      throw error;
    }
    if (!versionedRecord) {
      await removeProjectUpload(storagePath).catch((cleanupError: unknown) =>
        req.log.error({ err: cleanupError }, "Failed to clean up an orphaned measurement sheet upload"),
      );
      res.status(404).json({ error: "Measurement record not found." });
      return;
    }
    const version: MeasurementVersionDocument = {
      _id: randomUUID(),
      recordId: record._id,
      versionNumber: versionedRecord.versionCount ?? 1,
      filename: parsed.data.filename,
      name,
      measurementType: null,
      referenceType: null,
      referenceId: null,
      referenceName: null,
      contentType,
      sizeBytes: body.length,
      gridFsId: null,
      storagePath,
      uploadedBy: actor.id,
      uploadedByName: actor.name,
      uploadedAt: new Date(),
    };
    try {
      await getMeasurementVersions(db).insertOne(version);
    } catch (error) {
      await removeProjectUpload(storagePath).catch((cleanupError: unknown) =>
        req.log.error({ err: cleanupError }, "Failed to clean up an orphaned measurement version"),
      );
      throw error;
    }
    res.status(201).json(UploadMeasurementVersionResponse.parse(versionResponse(version)));
  });
});

const measurementVersionContentHandler = (inline: boolean): RequestHandler => async (req, res, next) => {
  const paramsSchema = inline ? PreviewMeasurementVersionParams : DownloadMeasurementVersionParams;
  const parsed = paramsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const actor = await actorContext(req, res);
  if (!actor) return;
  const db = await getMongoDb();
  const version = await getMeasurementVersions(db).findOne({
    _id: parsed.data.versionId,
    recordId: parsed.data.recordId,
  });
  if (!version) {
    res.status(404).json({ error: "Measurement sheet version not found." });
    return;
  }
  const safeFilename = version.filename.replace(/[\x00-\x1f\x7f"]/g, "_");
  const disposition = inline ? "inline" : "attachment";
  res.setHeader("Content-Type", version.contentType);
  res.setHeader("Content-Disposition", `${disposition}; filename="${safeFilename}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (version.storagePath) {
    const filePath = resolveProjectUploadPath(version.storagePath);
    if (!filePath) {
      res.status(404).json({ error: "Measurement sheet content not found." });
      return;
    }
    res.sendFile(filePath, { dotfiles: "deny" }, (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: "Measurement sheet content not found." });
      else if (error) req.log.error({ err: error, storagePath: version.storagePath }, "Failed to serve a measurement sheet upload");
    });
    return;
  }
  if (!version.gridFsId || !ObjectId.isValid(version.gridFsId)) {
    res.status(404).json({ error: "Measurement sheet version not found." });
    return;
  }
  const gridId = new ObjectId(version.gridFsId);
  const bucket = getMeasurementSheetsBucket(db);
  if (!(await bucket.find({ _id: gridId }).next())) {
    res.status(404).json({ error: "Measurement sheet content not found." });
    return;
  }
  const stream = bucket.openDownloadStream(gridId);
  stream.on("error", next);
  stream.pipe(res);
};

router.get(
  "/measurement-records/:recordId/versions/:versionId/content",
  measurementVersionContentHandler(false),
);
router.get(
  "/measurement-records/:recordId/versions/:versionId/preview",
  measurementVersionContentHandler(true),
);

function readRawFile(
  req: Request,
  res: Parameters<RequestHandler>[1],
  next: (error?: unknown) => void,
  done: (body: Buffer) => Promise<void>,
): void {
  const run = (body: Buffer) => { void Promise.resolve().then(() => done(body)).catch(next); };
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > MAX_FILE_BYTES) {
      res.status(413).json({ error: "Measurement sheet must be 10 MiB or smaller." });
      return;
    }
    run(req.body);
    return;
  }
  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_BYTES) {
    res.status(413).json({ error: "Measurement sheet must be 10 MiB or smaller." });
    req.resume();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  req.on("data", (chunk: Buffer) => {
    if (tooLarge) return;
    size += chunk.length;
    if (size > MAX_FILE_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      if (!res.headersSent) res.status(413).json({ error: "Measurement sheet must be 10 MiB or smaller." });
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (!tooLarge) run(Buffer.concat(chunks, size));
  });
  req.on("aborted", () => next(new Error("Measurement sheet upload was interrupted.")));
  req.on("error", next);
}

export default router;