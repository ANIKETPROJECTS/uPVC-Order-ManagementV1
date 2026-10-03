import { ObjectId } from "mongodb";
import {
  CreateQuotationRateSubmissionBody,
  CreateQuotationRateSubmissionResponse,
  DeleteQuotationRateSubmissionParams,
  DecideQuotationRateSubmissionBody,
  DecideQuotationRateSubmissionParams,
  DecideQuotationRateSubmissionResponse,
  DownloadQuotationRateSubmissionPdfParams,
  LinkQuotationRateSubmissionOrderBody,
  LinkQuotationRateSubmissionOrderParams,
  LinkQuotationRateSubmissionOrderResponse,
  ListQuotationRateSubmissionsResponse,
  SearchQuotationRateSubmissionsQueryParams,
  SearchQuotationRateSubmissionsResponse,
  UploadQuotationRateSubmissionPdfParams,
  UploadQuotationRateSubmissionPdfResponse,
  UpdateQuotationRateSubmissionBody,
  UpdateQuotationRateSubmissionParams,
  UpdateQuotationRateSubmissionResponse,
} from "@workspace/api-zod";
import { Router, type Request, type RequestHandler } from "express";
import {
  getMongoDb,
  getMongoClient,
  getPublicUser,
  getCounters,
  getMeasurementRecords,
  getOrders,
  getQuotationRatePdfsBucket,
  getQuotationRateSubmissions,
  getUsers,
  type QuotationRateSubmissionDocument,
  type UserDocument,
} from "../lib/mongo";
import {
  removeProjectUpload,
  resolveProjectUploadPath,
  storeProjectUpload,
} from "../lib/project-upload-storage";

const router = Router();
const MAX_PDF_BYTES = 10 * 1024 * 1024;

class LinkConflict extends Error {}
const isDuplicateKeyError = (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 11000);

type Actor = {
  id: string;
  name: string;
  permissions: Record<string, string>;
  masterAdmin: boolean;
};

async function getActor(req: Request, res: Parameters<RequestHandler>[1]): Promise<Actor | null> {
  const db = await getMongoDb();
  const user = req.session.userId
    ? await getUsers(db).findOne({ _id: req.session.userId, status: "active" })
    : null;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return null;
  }
  const publicUser = await getPublicUser(user, db);
  return {
    id: user._id,
    name: user.name,
    permissions: publicUser.permissions,
    masterAdmin: publicUser.roleId === "master-admin",
  };
}

function canSubmit(actor: Actor): boolean {
  return actor.masterAdmin || actor.permissions["quotation-builder"] === "edit";
}

function canApprove(actor: Actor): boolean {
  return actor.masterAdmin || actor.permissions["rate-approval"] === "edit";
}

function response(item: QuotationRateSubmissionDocument) {
  return {
    id: item._id,
    orderRecordId: item.orderRecordId ?? null,
    orderId: item.orderId ?? null,
    measurementRecordId: item.measurementRecordId ?? null,
    clientName: item.clientName,
    location: item.location,
    windowQty: item.windowQty,
    totalSqFt: item.totalSqFt,
    glassType: item.glassType,
    averageSqFtPerQty: item.averageSqFtPerQty,
    status: item.status,
    pdfFilename: item.pdfFilename,
    pdfSizeBytes: item.pdfSizeBytes,
    submittedBy: item.submittedBy,
    submittedByName: item.submittedByName,
    approverIds: item.approverIds,
    decisionComment: item.decisionComment,
    decidedBy: item.decidedBy,
    decidedByName: item.decidedByName,
    pdfNeedsRefresh: item.pdfNeedsRefresh ?? false,
    revisionHistory: (item.revisionHistory ?? []).map((revision) => ({
      ...revision,
      revisedAt: revision.revisedAt.toISOString(),
    })),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

async function cleanupQuotationRatePdf(
  db: Awaited<ReturnType<typeof getMongoDb>>,
  item: QuotationRateSubmissionDocument,
  req: Request,
): Promise<void> {
  if (item.pdfStoragePath) {
    await removeProjectUpload(item.pdfStoragePath).catch((error: unknown) =>
      req.log.error({ err: error, submissionId: item._id }, "Failed to remove a quotation PDF from project storage"),
    );
  }
  if (item.pdfGridFsId && ObjectId.isValid(item.pdfGridFsId)) {
    await getQuotationRatePdfsBucket(db).delete(new ObjectId(item.pdfGridFsId)).catch((error: unknown) =>
      req.log.error({ err: error, submissionId: item._id }, "Failed to remove a legacy quotation PDF from GridFS"),
    );
  }
}

async function findApprovers(users: UserDocument[]): Promise<UserDocument[]> {
  const db = await getMongoDb();
  const usersWithAccess = await Promise.all(
    users.map(async (user) => ({
      user,
      publicUser: await getPublicUser(user, db),
    })),
  );
  return usersWithAccess
    .filter(({ user, publicUser }) =>
      user.roleId === "master-admin" || publicUser.permissions["rate-approval"] === "edit",
    )
    .map(({ user }) => user);
}

router.get("/quotation-rate-submissions", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  const db = await getMongoDb();
  const filter = canApprove(actor)
    ? { $or: [{ submittedBy: actor.id }, { approverIds: actor.id }] }
    : { submittedBy: actor.id };
  const items = await getQuotationRateSubmissions(db)
    .find(filter)
    .sort({ createdAt: -1 })
    .toArray();
  res.json(ListQuotationRateSubmissionsResponse.parse(items.map(response)));
});

router.get("/quotation-rate-submissions/lookup", async (req, res): Promise<void> => {
  const query = SearchQuotationRateSubmissionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const actor = await getActor(req, res);
  if (!actor) return;
  if (!actor.masterAdmin && actor.permissions.measurements !== "edit" && !canApprove(actor)) {
    res.status(403).json({ error: "Measurement editing or rate approval access is required." });
    return;
  }
  const queryText = query.data.query.trim();
  const escaped = queryText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filter = queryText
    ? {
        $or: [
          { _id: { $regex: `^${escaped}`, $options: "i" } },
          { clientNameLower: { $regex: escaped, $options: "i" } },
        ],
      }
    : {};
  const cursor = getQuotationRateSubmissions(await getMongoDb())
    .find(filter, {
      projection: { _id: 1, clientName: 1, clientNameLower: 1, status: 1, orderId: 1, measurementRecordId: 1, createdAt: 1 },
    })
    .sort({ createdAt: -1 });
  if (queryText) cursor.limit(20);
  const items = await cursor.toArray();
  res.json(SearchQuotationRateSubmissionsResponse.parse(items.map((item) => ({
    id: item._id,
    clientName: item.clientName,
    status: item.status,
    orderId: item.orderId ?? null,
    measurementRecordId: item.measurementRecordId ?? null,
  }))));
});

router.post("/quotation-rate-submissions", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  if (!canSubmit(actor)) {
    res.status(403).json({ error: "Quotation member editing access is required." });
    return;
  }
  const parsed = CreateQuotationRateSubmissionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const db = await getMongoDb();
  const activeUsers = await getUsers(db).find({ status: "active" }).toArray();
  const approvers = await findApprovers(activeUsers);
  if (!approvers.length) {
    res.status(503).json({ error: "No active quotation rate approver is available." });
    return;
  }
  const now = new Date();
  const { clientName, location, windowQty, totalSqFt, glassType } = parsed.data;
  const counters = getCounters(db);
  await counters.updateOne(
    { _id: "quotation-rate-sequence" },
    { $setOnInsert: { _id: "quotation-rate-sequence", value: 999, updatedAt: now } },
    { upsert: true },
  );
  const counter = await counters.findOneAndUpdate(
    { _id: "quotation-rate-sequence" },
    { $inc: { value: 1 }, $set: { updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!counter) {
    res.status(503).json({ error: "A temporary quotation ID could not be allocated." });
    return;
  }
  const item: QuotationRateSubmissionDocument = {
    _id: `RA-${counter.value}`,
    orderRecordId: null,
    orderId: null,
    measurementRecordId: null,
    clientName: clientName.trim(),
    clientNameLower: clientName.trim().toLowerCase(),
    location: location?.trim() || null,
    windowQty,
    totalSqFt,
    glassType: glassType.trim(),
    averageSqFtPerQty: Math.round((totalSqFt / windowQty + Number.EPSILON) * 10000) / 10000,
    status: "awaiting_pdf",
    pdfFilename: null,
    pdfSizeBytes: null,
    pdfGridFsId: null,
    submittedBy: actor.id,
    submittedByName: actor.name,
    approverIds: approvers.map((user) => user._id),
    decisionComment: null,
    decidedBy: null,
    decidedByName: null,
    pdfNeedsRefresh: false,
    revisionHistory: [],
    createdAt: now,
    updatedAt: now,
  };
  await getQuotationRateSubmissions(db).insertOne(item);
  res.status(201).json(CreateQuotationRateSubmissionResponse.parse(response(item)));
});

router.patch("/quotation-rate-submissions/:submissionId", async (req, res): Promise<void> => {
  const parsedParams = UpdateQuotationRateSubmissionParams.safeParse(req.params);
  const parsedBody = UpdateQuotationRateSubmissionBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({
      error: !parsedParams.success ? parsedParams.error.message : parsedBody.success ? "" : parsedBody.error.message,
    });
    return;
  }
  const actor = await getActor(req, res);
  if (!actor) return;
  const db = await getMongoDb();
  const submissions = getQuotationRateSubmissions(db);
  const item = await submissions.findOne({ _id: parsedParams.data.submissionId });
  if (!item) {
    res.status(404).json({ error: "Quotation rate submission not found." });
    return;
  }
  if (!actor.masterAdmin && (!canSubmit(actor) || item.submittedBy !== actor.id)) {
    res.status(403).json({ error: "Only the submitting quotation member or a master admin can edit this request." });
    return;
  }

  const now = new Date();
  const { clientName, location, windowQty, totalSqFt, glassType } = parsedBody.data;
  const revisionHistory = item.revisionHistory ?? [];
  const revision = {
    revisionNumber: revisionHistory.length + 1,
    clientName: item.clientName,
    location: item.location,
    windowQty: item.windowQty,
    totalSqFt: item.totalSqFt,
    glassType: item.glassType,
    averageSqFtPerQty: item.averageSqFtPerQty,
    previousStatus: item.status,
    revisedBy: actor.id,
    revisedByName: actor.name,
    revisedAt: now,
    pdfFilename: item.pdfFilename,
    decidedBy: item.decidedBy,
    decidedByName: item.decidedByName,
    decisionComment: item.decisionComment,
  };
  const updated = await submissions.findOneAndUpdate(
    { _id: item._id, updatedAt: item.updatedAt },
    {
      $set: {
        clientName: clientName.trim(),
        clientNameLower: clientName.trim().toLowerCase(),
        location: location?.trim() || null,
        windowQty,
        totalSqFt,
        glassType: glassType.trim(),
        averageSqFtPerQty: Math.round((totalSqFt / windowQty + Number.EPSILON) * 10000) / 10000,
        status: "awaiting_pdf",
        pdfNeedsRefresh: Boolean(item.pdfFilename || item.pdfStoragePath || item.pdfGridFsId),
        decisionComment: null,
        decidedBy: null,
        decidedByName: null,
        updatedAt: now,
      },
      $push: { revisionHistory: revision },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    res.status(409).json({ error: "This request changed while you were editing it. Refresh and try again." });
    return;
  }
  res.json(UpdateQuotationRateSubmissionResponse.parse(response(updated)));
});

router.delete("/quotation-rate-submissions/:submissionId", async (req, res): Promise<void> => {
  const parsedParams = DeleteQuotationRateSubmissionParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.message });
    return;
  }
  const actor = await getActor(req, res);
  if (!actor) return;
  const db = await getMongoDb();
  const submissions = getQuotationRateSubmissions(db);
  const item = await submissions.findOne({ _id: parsedParams.data.submissionId });
  if (!item) {
    res.status(404).json({ error: "Quotation rate submission not found." });
    return;
  }
  if (!actor.masterAdmin && (!canSubmit(actor) || item.submittedBy !== actor.id)) {
    res.status(403).json({ error: "Only the submitting quotation member or a master admin can delete this request." });
    return;
  }
  const deleted = await submissions.deleteOne({ _id: item._id, updatedAt: item.updatedAt });
  if (!deleted.deletedCount) {
    res.status(409).json({ error: "This request changed before it could be deleted. Refresh and try again." });
    return;
  }
  await cleanupQuotationRatePdf(db, item, req);
  res.status(204).send();
});

router.patch(
  "/quotation-rate-submissions/:submissionId/order",
  async (req, res): Promise<void> => {
    const parsedParams = LinkQuotationRateSubmissionOrderParams.safeParse(req.params);
    const parsedBody = LinkQuotationRateSubmissionOrderBody.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      res.status(400).json({
        error: !parsedParams.success ? parsedParams.error.message : parsedBody.success ? "" : parsedBody.error.message,
      });
      return;
    }
    const actor = await getActor(req, res);
    if (!actor) return;
    const db = await getMongoDb();
    const submissions = getQuotationRateSubmissions(db);
    const item = await submissions.findOne({ _id: parsedParams.data.submissionId });
    if (!item) {
      res.status(404).json({ error: "Quotation rate submission not found." });
      return;
    }
    if (!actor.masterAdmin && !canApprove(actor) && (!canSubmit(actor) || item.submittedBy !== actor.id)) {
      res.status(403).json({ error: "Only the submitter or assigned rate approver can link this quotation." });
      return;
    }
    const order = await getOrders(db).findOne({ _id: parsedBody.data.orderRecordId });
    if (!order) {
      res.status(404).json({ error: "The selected order could not be found." });
      return;
    }
    const measurement = parsedBody.data.measurementRecordId
      ? await getMeasurementRecords(db).findOne({ _id: parsedBody.data.measurementRecordId })
      : null;
    if (parsedBody.data.measurementRecordId && !measurement) {
      res.status(404).json({ error: "The selected measurement sheet could not be found." });
      return;
    }
    if (measurement) {
      const otherLinkedRequest = await submissions.findOne({
        _id: { $ne: item._id },
        measurementRecordId: measurement._id,
      });
      if (otherLinkedRequest) {
        res.status(409).json({ error: "This measurement sheet is already linked to another quotation request." });
        return;
      }
    }

    const session = (await getMongoClient()).startSession();
    let updated: QuotationRateSubmissionDocument | null = null;
    try {
      await session.withTransaction(async () => {
        const quoteResult = await submissions.findOneAndUpdate(
          {
            _id: item._id,
            $and: [
              {
                $or: [
                  { orderRecordId: null },
                  { orderRecordId: order._id },
                  { orderRecordId: { $exists: false } },
                ],
              },
              {
                $or: [
                  { measurementRecordId: item.measurementRecordId ?? null },
                  { measurementRecordId: { $exists: false } },
                ],
              },
            ],
          },
          {
            $set: {
              orderRecordId: order._id,
              orderId: order.orderId,
              measurementRecordId: measurement?._id ?? null,
              updatedAt: new Date(),
            },
          },
          { returnDocument: "after", session },
        );
        if (!quoteResult) throw new LinkConflict("This quotation's links changed. Refresh and try again.");
        if (measurement) {
          const measurementResult = await getMeasurementRecords(db).updateOne(
            {
              _id: measurement._id,
              $or: [
                { orderRecordId: null },
                { orderRecordId: order._id },
                { orderRecordId: { $exists: false } },
              ],
            },
            { $set: { orderRecordId: order._id, updatedAt: new Date() } },
            { session },
          );
          if (!measurementResult.matchedCount) {
            throw new LinkConflict("This measurement sheet is already linked to another order.");
          }
        }
        updated = quoteResult;
      });
    } catch (error) {
      if (error instanceof LinkConflict || isDuplicateKeyError(error)) {
        res.status(409).json({
          error: error instanceof LinkConflict
            ? error.message
            : "This measurement sheet is already linked to another quotation request.",
        });
        return;
      }
      throw error;
    } finally {
      await session.endSession();
    }
    if (!updated) {
      res.status(409).json({ error: "The link could not be saved. Refresh and try again." });
      return;
    }
    res.json(LinkQuotationRateSubmissionOrderResponse.parse(response(updated)));
  },
);

router.post(
  "/quotation-rate-submissions/:submissionId/pdf/:filename",
  async (req, res, next): Promise<void> => {
    const parsed = UploadQuotationRateSubmissionPdfParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const actor = await getActor(req, res);
    if (!actor) return;
    const db = await getMongoDb();
    const submissions = getQuotationRateSubmissions(db);
    const item = await submissions.findOne({ _id: parsed.data.submissionId });
    if (!item) {
      res.status(404).json({ error: "Quotation rate submission not found." });
      return;
    }
    if (!actor.masterAdmin && (item.submittedBy !== actor.id || !canSubmit(actor))) {
      res.status(403).json({ error: "Only the submitting quotation member or a master admin can attach the PDF." });
      return;
    }
    if (item.status !== "awaiting_pdf") {
      res.status(409).json({ error: "A PDF can only be attached before the submission enters review." });
      return;
    }

    readRawFile(req, res, next, async (body) => {
      const filename = parsed.data.filename;
      if (!filename.toLowerCase().endsWith(".pdf") || body.length < 5 || body.subarray(0, 5).toString("ascii") !== "%PDF-") {
        res.status(400).json({ error: "Attach a non-empty PDF file." });
        return;
      }
      const declaredType = String(req.headers["content-type"] ?? "").split(";")[0];
      if (declaredType !== "application/pdf" && declaredType !== "application/octet-stream") {
        res.status(400).json({ error: "The attached file must be a PDF." });
        return;
      }

      const storagePath = await storeProjectUpload("quotation-rate-pdfs", filename, body);

      let updated: QuotationRateSubmissionDocument | null;
      try {
        updated = await submissions.findOneAndUpdate(
          { _id: item._id, status: "awaiting_pdf", updatedAt: item.updatedAt },
          {
            $set: {
              status: "pending_review",
              pdfFilename: filename,
              pdfSizeBytes: body.length,
              pdfGridFsId: null,
              pdfStoragePath: storagePath,
              pdfNeedsRefresh: false,
              updatedAt: new Date(),
            },
          },
          { returnDocument: "after" },
        );
      } catch (error) {
        await removeProjectUpload(storagePath).catch((cleanupError: unknown) =>
          req.log.error({ err: cleanupError }, "Failed to clean up a quotation PDF after a database error"),
        );
        throw error;
      }
      if (!updated) {
        await removeProjectUpload(storagePath).catch((cleanupError: unknown) =>
          req.log.error({ err: cleanupError }, "Failed to clean up a duplicate project quotation PDF upload"),
        );
        res.status(409).json({ error: "This submission changed or has already been routed for review." });
        return;
      }
      await cleanupQuotationRatePdf(db, item, req);
      res.json(UploadQuotationRateSubmissionPdfResponse.parse(response(updated)));
    });
  },
);

router.get("/quotation-rate-submissions/:submissionId/pdf", async (req, res, next): Promise<void> => {
  const parsed = DownloadQuotationRateSubmissionPdfParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const actor = await getActor(req, res);
  if (!actor) return;
  const db = await getMongoDb();
  const item = await getQuotationRateSubmissions(db).findOne({ _id: parsed.data.submissionId });
  if (!item || (!item.pdfStoragePath && !item.pdfGridFsId)) {
    res.status(404).json({ error: "Quotation PDF not found." });
    return;
  }
  const canViewLinkedOrderQuotation = Boolean(item.orderRecordId)
    && (actor.masterAdmin || ["view", "edit"].includes(actor.permissions["order-hub"] ?? "none"))
    && (actor.masterAdmin || ["view", "edit"].includes(actor.permissions.confirmation ?? "none"));
  if (item.submittedBy !== actor.id && !item.approverIds.includes(actor.id) && !canViewLinkedOrderQuotation) {
    res.status(403).json({ error: "You do not have access to this quotation PDF." });
    return;
  }
  const safeFilename = (item.pdfFilename ?? "quotation.pdf").replace(/[\x00-\x1f\x7f"]/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (item.pdfStoragePath) {
    const filePath = resolveProjectUploadPath(item.pdfStoragePath);
    if (!filePath) {
      res.status(404).json({ error: "Quotation PDF content not found." });
      return;
    }
    res.sendFile(filePath, { dotfiles: "deny" }, (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: "Quotation PDF content not found." });
      else if (error) req.log.error({ err: error, storagePath: item.pdfStoragePath }, "Failed to serve a quotation PDF upload");
    });
    return;
  }
  if (!item.pdfGridFsId || !ObjectId.isValid(item.pdfGridFsId)) {
    res.status(404).json({ error: "Quotation PDF not found." });
    return;
  }
  const gridId = new ObjectId(item.pdfGridFsId);
  const bucket = getQuotationRatePdfsBucket(db);
  if (!(await bucket.find({ _id: gridId }).next())) {
    res.status(404).json({ error: "Quotation PDF content not found." });
    return;
  }
  const stream = bucket.openDownloadStream(gridId);
  stream.on("error", next);
  stream.pipe(res);
});

router.post("/quotation-rate-submissions/:submissionId/decision", async (req, res): Promise<void> => {
  const parsedParams = DecideQuotationRateSubmissionParams.safeParse(req.params);
  const parsedBody = DecideQuotationRateSubmissionBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({
      error: !parsedParams.success ? parsedParams.error.message : parsedBody.success ? "" : parsedBody.error.message,
    });
    return;
  }
  const actor = await getActor(req, res);
  if (!actor) return;
  if (!canApprove(actor)) {
    res.status(403).json({ error: "Rate approval editing access is required." });
    return;
  }
  const collection = getQuotationRateSubmissions(await getMongoDb());
  const updated = await collection.findOneAndUpdate(
    {
      _id: parsedParams.data.submissionId,
      status: "pending_review",
      ...(actor.masterAdmin ? {} : { approverIds: actor.id }),
    },
    {
      $set: {
        status: parsedBody.data.decision,
        decisionComment: parsedBody.data.comment.trim() || null,
        decidedBy: actor.id,
        decidedByName: actor.name,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    const existing = await collection.findOne({ _id: parsedParams.data.submissionId });
    if (!existing) {
      res.status(404).json({ error: "Quotation rate submission not found." });
      return;
    }
    res.status(409).json({ error: "This submission is no longer waiting for a decision." });
    return;
  }
  res.json(DecideQuotationRateSubmissionResponse.parse(response(updated)));
});

function readRawFile(
  req: Request,
  res: Parameters<RequestHandler>[1],
  next: (error?: unknown) => void,
  done: (body: Buffer) => Promise<void>,
): void {
  const run = (body: Buffer) => { void Promise.resolve().then(() => done(body)).catch(next); };
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > MAX_PDF_BYTES) {
      res.status(413).json({ error: "PDF must be 10 MiB or smaller." });
      return;
    }
    run(req.body);
    return;
  }
  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
    res.status(413).json({ error: "PDF must be 10 MiB or smaller." });
    req.resume();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  req.on("data", (chunk: Buffer) => {
    if (tooLarge) return;
    size += chunk.length;
    if (size > MAX_PDF_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      if (!res.headersSent) res.status(413).json({ error: "PDF must be 10 MiB or smaller." });
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (!tooLarge) run(Buffer.concat(chunks, size));
  });
  req.on("aborted", () => next(new Error("Quotation PDF upload was interrupted.")));
  req.on("error", next);
}

export default router;