import { ObjectId } from "mongodb";
import {
  AssignQuotationRateSubmissionRateBody,
  AssignQuotationRateSubmissionRateParams,
  AssignQuotationRateSubmissionRateResponse,
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
import { logger } from "../lib/logger";
import {
  getQuotationRateAttentionConfig,
  notifyNewRateRequest,
  notifyRateAssigned,
  sendQuotationRateOverdueReminders,
} from "../lib/quotation-rate-attention";

const router = Router();
const MAX_PDF_BYTES = 10 * 1024 * 1024;

class LinkConflict extends Error {}
const isDuplicateKeyError = (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 11000);

function quotationRequestYearCode(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    year: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function formatQuotationRequestId(sequence: number, createdAt: Date): string {
  return `QT-${quotationRequestYearCode(createdAt)}-${String(sequence).padStart(4, "0")}`;
}

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

function response(item: QuotationRateSubmissionDocument, measurementSheetId: string | null) {
  return {
    id: item._id,
    orderRecordId: item.orderRecordId ?? null,
    orderId: item.orderId ?? null,
    measurementRecordId: item.measurementRecordId ?? null,
    measurementSheetId,
    clientName: item.clientName,
    location: item.location,
    windowQty: item.windowQty,
    totalSqFt: item.totalSqFt,
    glassType: item.glassType,
    priority: item.priority ?? "normal",
    averageSqFtPerQty: item.averageSqFtPerQty,
    status: item.status,
    pdfFilename: item.pdfFilename,
    pdfSizeBytes: item.pdfSizeBytes,
    submittedBy: item.submittedBy,
    submittedByName: item.submittedByName,
    approverIds: item.approverIds,
    workflowVersion: item.workflowVersion ?? 1,
    awaitingRateSince: item.awaitingRateSince?.toISOString() ?? item.createdAt.toISOString(),
    queryRaisedAt: item.queryRaisedAt?.toISOString() ?? null,
    pausedWaitMilliseconds: item.pausedWaitMilliseconds ?? 0,
    queryHistory: (item.queryHistory ?? []).map((entry) => ({
      ...entry,
      raisedAt: entry.raisedAt.toISOString(),
      respondedAt: entry.respondedAt?.toISOString() ?? null,
    })),
    sentToClientAt: item.sentToClientAt?.toISOString() ?? null,
    outcomeStatus: item.outcomeStatus ?? null,
    lostReason: item.lostReason ?? null,
    outcomeSource: item.outcomeSource ?? null,
    confirmationRecordIds: item.confirmationRecordIds ?? [],
    ratePerSqFt: item.ratePerSqFt ?? null,
    rateNote: item.rateNote ?? null,
    rateAssignedBy: item.rateAssignedBy ?? null,
    rateAssignedByName: item.rateAssignedByName ?? null,
    rateAssignedAt: item.rateAssignedAt?.toISOString() ?? null,
    decisionComment: item.decisionComment,
    decidedBy: item.decidedBy,
    decidedByName: item.decidedByName,
    pdfNeedsRefresh: item.pdfNeedsRefresh ?? false,
    revisionHistory: (item.revisionHistory ?? []).map((revision) => ({
      ...revision,
      revisedAt: revision.revisedAt.toISOString(),
      rateAssignedAt: revision.rateAssignedAt?.toISOString() ?? null,
    })),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

async function responseList(items: QuotationRateSubmissionDocument[]) {
  const recordIds = Array.from(new Set(items.flatMap((item) => item.measurementRecordId ? [item.measurementRecordId] : [])));
  const records = recordIds.length
    ? await getMeasurementRecords(await getMongoDb())
        .find({ _id: { $in: recordIds } }, { projection: { _id: 1, sheetId: 1 } })
        .toArray()
    : [];
  const sheetIdByRecord = new Map(records.map((record) => [record._id, record.sheetId ?? null]));
  return items.map((item) =>
    response(item, item.measurementRecordId ? sheetIdByRecord.get(item.measurementRecordId) ?? null : null),
  );
}

async function responseOne(item: QuotationRateSubmissionDocument) {
  const [result] = await responseList([item]);
  if (!result) throw new Error("Could not serialize the quotation rate submission.");
  return result;
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
    ? {
        $or: [
          { submittedBy: actor.id },
          { approverIds: actor.id },
          { status: { $in: ["awaiting_rate", "query_raised", "rated", "sent_to_client", "awaiting_pdf", "pending_review"] as const } },
        ],
      }
    : { submittedBy: actor.id };
  const submissions = getQuotationRateSubmissions(db);
  const legacyItems = await submissions.find({ workflowVersion: 2 }).toArray();
  for (const item of legacyItems) {
    const now = new Date();
    const status = item.status === "rate_assigned" ? "rated"
      : item.status === "approved" ? "sent_to_client"
      : item.status === "awaiting_pdf" || item.status === "pending_review" ? "awaiting_rate"
      : item.status;
    await submissions.updateOne({ _id: item._id, workflowVersion: 2 }, { $set: {
      workflowVersion: 3,
      status,
      awaitingRateSince: item.createdAt,
      pausedWaitMilliseconds: 0,
      queryHistory: [],
      sentToClientAt: status === "sent_to_client" ? item.updatedAt : null,
      outcomeStatus: null,
      outcomeSource: null,
      confirmationRecordIds: [],
    } });
  }
  const items = await submissions
    .find(filter)
    .sort({ createdAt: -1 })
    .toArray();
  res.json(ListQuotationRateSubmissionsResponse.parse(await responseList(items)));
});

router.get("/quotation-rate-attention-config", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  res.json(getQuotationRateAttentionConfig());
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
  const db = await getMongoDb();
  const cursor = getQuotationRateSubmissions(db)
    .find(filter, {
      projection: { _id: 1, clientName: 1, clientNameLower: 1, status: 1, orderId: 1, measurementRecordId: 1, createdAt: 1 },
    })
    .sort({ createdAt: -1 });
  if (queryText) cursor.limit(20);
  const items = await cursor.toArray();
  const measurementIds = Array.from(new Set(items.flatMap((item) => item.measurementRecordId ? [item.measurementRecordId] : [])));
  const linkedMeasurements = measurementIds.length
    ? await getMeasurementRecords(db)
        .find({ _id: { $in: measurementIds } }, { projection: { _id: 1, sheetId: 1 } })
        .toArray()
    : [];
  const sheetIdByRecord = new Map(linkedMeasurements.map((record) => [record._id, record.sheetId ?? null]));
  res.json(SearchQuotationRateSubmissionsResponse.parse(items.map((item) => ({
    id: item._id,
    clientName: item.clientName,
    status: item.status,
    orderId: item.orderId ?? null,
    measurementRecordId: item.measurementRecordId ?? null,
    measurementSheetId: item.measurementRecordId ? sheetIdByRecord.get(item.measurementRecordId) ?? null : null,
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
  const measurementRecordId = parsed.data.measurementRecordId ?? null;
  if (measurementRecordId) {
    const measurement = await getMeasurementRecords(db).findOne({ _id: measurementRecordId });
    if (!measurement) {
      res.status(404).json({ error: "The selected measurement sheet could not be found." });
      return;
    }
    const existingLink = await getQuotationRateSubmissions(db).findOne({ measurementRecordId });
    if (existingLink) {
      res.status(409).json({ error: "This measurement sheet is already linked to another rate request." });
      return;
    }
  }
  const counters = getCounters(db);
  const year = quotationRequestYearCode(now);
  const counter = await counters.findOneAndUpdate(
    { _id: `quotation-year-sequence:${year}` },
    { $inc: { value: 1 }, $set: { updatedAt: now } },
    { returnDocument: "after", upsert: true },
  );
  if (!counter) {
    res.status(503).json({ error: "A quotation request ID could not be allocated." });
    return;
  }
  const item: QuotationRateSubmissionDocument = {
    _id: formatQuotationRequestId(counter.value, now),
    orderRecordId: null,
    orderId: null,
    measurementRecordId,
    clientName: clientName.trim(),
    clientNameLower: clientName.trim().toLowerCase(),
    location: location?.trim() || null,
    windowQty,
    totalSqFt,
    glassType: glassType.trim(),
    priority: parsed.data.priority ?? "normal",
    averageSqFtPerQty: Math.round((totalSqFt / windowQty + Number.EPSILON) * 10000) / 10000,
    pdfFilename: null,
    pdfSizeBytes: null,
    pdfGridFsId: null,
    submittedBy: actor.id,
    submittedByName: actor.name,
    approverIds: approvers.map((user) => user._id),
    workflowVersion: 3,
    status: "awaiting_rate",
    ratePerSqFt: null,
    rateNote: null,
    rateAssignedBy: null,
    rateAssignedByName: null,
    rateAssignedAt: null,
    decisionComment: null,
    decidedBy: null,
    decidedByName: null,
    pdfNeedsRefresh: false,
    revisionHistory: [],
    awaitingRateSince: now,
    queryRaisedAt: null,
    pausedWaitMilliseconds: 0,
    queryHistory: [],
    sentToClientAt: null,
    outcomeStatus: null,
    lostReason: null,
    outcomeSource: null,
    confirmationRecordIds: [],
    createdAt: now,
    updatedAt: now,
  };
  try {
    await getQuotationRateSubmissions(db).insertOne(item);
  } catch (error) {
    if (isDuplicateKeyError(error) && measurementRecordId) {
      res.status(409).json({ error: "This measurement sheet is already linked to another rate request." });
      return;
    }
    throw error;
  }
  void notifyNewRateRequest(item, item.priority === "urgent").catch((error: unknown) => {
    logger.error({ err: error, submissionId: item._id }, "Could not notify quotation rate recipients");
  });
  res.status(201).json(CreateQuotationRateSubmissionResponse.parse(await responseOne(item)));
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
  const item = await submissions.findOne({ $or: [{ _id: parsedParams.data.submissionId }, { legacyId: parsedParams.data.submissionId }] });
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
  const measurementRecordId =
    parsedBody.data.measurementRecordId === undefined
      ? item.measurementRecordId ?? null
      : parsedBody.data.measurementRecordId;
  if (measurementRecordId) {
    const measurement = await getMeasurementRecords(db).findOne({ _id: measurementRecordId });
    if (!measurement) {
      res.status(404).json({ error: "The selected measurement sheet could not be found." });
      return;
    }
    const existingLink = await submissions.findOne({
      _id: { $ne: item._id },
      measurementRecordId,
    });
    if (existingLink) {
      res.status(409).json({ error: "This measurement sheet is already linked to another rate request." });
      return;
    }
  }
  const revisionHistory = item.revisionHistory ?? [];
  const revision = {
    revisionNumber: revisionHistory.length + 1,
    clientName: item.clientName,
    location: item.location,
    windowQty: item.windowQty,
    totalSqFt: item.totalSqFt,
    glassType: item.glassType,
    priority: item.priority ?? "normal",
    ratePerSqFt: item.ratePerSqFt ?? null,
    rateNote: item.rateNote ?? null,
    rateAssignedByName: item.rateAssignedByName ?? null,
    rateAssignedAt: item.rateAssignedAt ?? null,
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
  let updated: QuotationRateSubmissionDocument | null;
  try {
    updated = await submissions.findOneAndUpdate(
      { _id: item._id, updatedAt: item.updatedAt },
      {
        $set: {
          clientName: clientName.trim(),
          clientNameLower: clientName.trim().toLowerCase(),
          location: location?.trim() || null,
          windowQty,
          totalSqFt,
          glassType: glassType.trim(),
          priority: parsedBody.data.priority ?? item.priority ?? "normal",
          measurementRecordId,
          averageSqFtPerQty: Math.round((totalSqFt / windowQty + Number.EPSILON) * 10000) / 10000,
          status: "awaiting_rate",
          workflowVersion: 3,
          ratePerSqFt: null,
          rateNote: null,
          rateAssignedBy: null,
          rateAssignedByName: null,
          rateAssignedAt: null,
          pdfNeedsRefresh: Boolean(item.pdfFilename || item.pdfStoragePath || item.pdfGridFsId),
          awaitingRateSince: now,
          queryRaisedAt: null,
          pausedWaitMilliseconds: 0,
          queryHistory: [],
          sentToClientAt: null,
          outcomeStatus: null,
          lostReason: null,
          outcomeSource: null,
          decisionComment: null,
          decidedBy: null,
          decidedByName: null,
          updatedAt: now,
        },
        $push: { revisionHistory: revision },
      },
      { returnDocument: "after" },
    );
  } catch (error) {
    if (isDuplicateKeyError(error) && measurementRecordId) {
      res.status(409).json({ error: "This measurement sheet is already linked to another rate request." });
      return;
    }
    throw error;
  }
  if (!updated) {
    res.status(409).json({ error: "This request changed while you were editing it. Refresh and try again." });
    return;
  }
  if (updated.priority === "urgent" && item.priority !== "urgent") {
    void notifyNewRateRequest(updated, true).catch((error: unknown) => {
      logger.error({ err: error, submissionId: item._id }, "Could not notify urgent quotation rate recipients");
    });
  }
  res.json(UpdateQuotationRateSubmissionResponse.parse(await responseOne(updated)));
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
  const item = await submissions.findOne({ $or: [{ _id: parsedParams.data.submissionId }, { legacyId: parsedParams.data.submissionId }] });
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
    const item = await submissions.findOne({ $or: [{ _id: parsedParams.data.submissionId }, { legacyId: parsedParams.data.submissionId }] });
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
    res.json(LinkQuotationRateSubmissionOrderResponse.parse(await responseOne(updated)));
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
    const item = await submissions.findOne({ $or: [{ _id: parsed.data.submissionId }, { legacyId: parsed.data.submissionId }] });
    if (!item) {
      res.status(404).json({ error: "Quotation rate submission not found." });
      return;
    }
    if (!actor.masterAdmin && (item.submittedBy !== actor.id || !canSubmit(actor))) {
      res.status(403).json({ error: "Only the submitting quotation member or a master admin can attach the PDF." });
      return;
    }
    if (item.status !== "rated") {
      res.status(409).json({ error: "Upload the final PDF after a rate has been assigned." });
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
          { _id: item._id, status: "rated", updatedAt: item.updatedAt },
          {
            $set: {
              status: "sent_to_client",
              sentToClientAt: new Date(),
              outcomeStatus: null,
              outcomeSource: null,
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
      res.json(UploadQuotationRateSubmissionPdfResponse.parse(await responseOne(updated)));
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
  const item = await getQuotationRateSubmissions(db).findOne({ $or: [{ _id: parsed.data.submissionId }, { legacyId: parsed.data.submissionId }] });
  if (!item || (!item.pdfStoragePath && !item.pdfGridFsId)) {
    res.status(404).json({ error: "Quotation PDF not found." });
    return;
  }
  const canViewLinkedOrderQuotation = Boolean(item.orderRecordId)
    && (actor.masterAdmin || ["view", "edit"].includes(actor.permissions["order-hub"] ?? "none"))
    && (actor.masterAdmin || ["view", "edit"].includes(actor.permissions.confirmation ?? "none"));
  if (
    item.submittedBy !== actor.id &&
    !item.approverIds.includes(actor.id) &&
    !canApprove(actor) &&
    !canViewLinkedOrderQuotation
  ) {
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
      workflowVersion: { $ne: 2 },
    },
    {
      $set: {
        status: parsedBody.data.decision,
        decisionComment: parsedBody.data.comment.trim() || null,
        decidedBy: actor.id,
        decidedByName: actor.name,
        updatedAt: new Date(),
      },
      $addToSet: { approverIds: actor.id },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    const existing = await collection.findOne({ $or: [{ _id: parsedParams.data.submissionId }, { legacyId: parsedParams.data.submissionId }] });
    if (!existing) {
      res.status(404).json({ error: "Quotation rate submission not found." });
      return;
    }
    res.status(409).json({ error: "This submission is no longer waiting for a decision." });
    return;
  }
  res.json(DecideQuotationRateSubmissionResponse.parse(await responseOne(updated)));
});

router.post("/quotation-rate-submissions/:submissionId/rate", async (req, res): Promise<void> => {
  const parsedParams = AssignQuotationRateSubmissionRateParams.safeParse(req.params);
  const parsedBody = AssignQuotationRateSubmissionRateBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: !parsedParams.success ? parsedParams.error.message : parsedBody.success ? "" : parsedBody.error.message });
    return;
  }
  const actor = await getActor(req, res);
  if (!actor) return;
  if (!canApprove(actor)) {
    res.status(403).json({ error: "Rate manager editing access is required." });
    return;
  }
  const db = await getMongoDb();
  const submissions = getQuotationRateSubmissions(db);
  const current = await submissions.findOne({
    _id: parsedParams.data.submissionId,
    workflowVersion: 3,
    status: { $in: ["awaiting_rate", "rated"] },
  });
  if (!current) {
    res.status(404).json({ error: "Rate request is not available for rate entry." });
    return;
  }
  if (current.updatedAt.getTime() !== parsedBody.data.expectedUpdatedAt.getTime()) {
    res.status(409).json({ error: "This request changed while you were entering the rate. Refresh and review the latest details." });
    return;
  }
  const now = new Date();
  const updated = await submissions.findOneAndUpdate(
    { _id: current._id, workflowVersion: 3, status: current.status, updatedAt: current.updatedAt },
    {
      $set: {
        status: "rated",
        ratePerSqFt: Math.round((parsedBody.data.ratePerSqFt + Number.EPSILON) * 100) / 100,
        rateNote: parsedBody.data.rateNote?.trim() || null,
        rateAssignedBy: actor.id,
        rateAssignedByName: actor.name,
        rateAssignedAt: now,
        updatedAt: now,
      },
      $addToSet: { approverIds: actor.id },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    const existing = await getQuotationRateSubmissions(db).findOne({ $or: [{ _id: parsedParams.data.submissionId }, { legacyId: parsedParams.data.submissionId }] });
    if (!existing) {
      res.status(404).json({ error: "Quotation rate submission not found." });
      return;
    }
    res.status(409).json({ error: "This request is not waiting for a rate assignment." });
    return;
  }
  void notifyRateAssigned(updated).catch((error: unknown) => {
    logger.error({ err: error, submissionId: updated._id }, "Could not notify recipients of the assigned rate");
  });
  res.json(AssignQuotationRateSubmissionRateResponse.parse(await responseOne(updated)));
});

router.get("/quotation-rate-submissions/:submissionId/past-rates", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  if (!canApprove(actor)) {
    res.status(403).json({ error: "Rate manager editing access is required." });
    return;
  }
  const db = await getMongoDb();
  const current = await getQuotationRateSubmissions(db).findOne({ _id: String(req.params.submissionId) });
  if (!current) {
    res.status(404).json({ error: "Rate request not found." });
    return;
  }
  const count = Math.min(10, Math.max(1, Number(process.env.QUOTATION_RATE_PAST_RATE_COUNT) || 3));
  const tolerancePercent = Math.min(100, Math.max(1, Number(process.env.QUOTATION_RATE_PAST_RATE_TOLERANCE_PCT) || 20));
  const maxAgeDays = Math.min(3650, Math.max(1, Number(process.env.QUOTATION_RATE_PAST_RATE_MAX_AGE_DAYS) || 365));
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000);
  const candidates = await getQuotationRateSubmissions(db).find({
    _id: { $ne: current._id },
    ratePerSqFt: { $gt: 0 },
    $or: [
      { workflowVersion: 3, status: { $in: ["rated", "sent_to_client"] } },
      { workflowVersion: { $ne: 3 }, status: { $in: ["rate_assigned", "approved"] } },
    ],
  }).sort({ rateAssignedAt: -1, updatedAt: -1 }).limit(500).toArray();
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  const rates = candidates.filter((item) => {
    const date = item.rateAssignedAt ?? item.updatedAt;
    if (date < cutoff || !item.averageSqFtPerQty) return false;
    const sameGlass = normalize(item.glassType) === normalize(current.glassType);
    const similarArea = current.averageSqFtPerQty > 0
      && Math.abs(item.averageSqFtPerQty - current.averageSqFtPerQty) / current.averageSqFtPerQty * 100 <= tolerancePercent;
    return sameGlass || similarArea;
  }).slice(0, count).map((item) => ({
    id: item._id,
    clientName: item.clientName,
    glassType: item.glassType,
    averageSqFtPerQty: item.averageSqFtPerQty,
    ratePerSqFt: item.ratePerSqFt!,
    rateAssignedAt: (item.rateAssignedAt ?? item.updatedAt).toISOString(),
  }));
  res.json({ rates, count, tolerancePercent, maxAgeDays });
});

router.post("/quotation-rate-submissions/:submissionId/query", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  if (!canApprove(actor)) { res.status(403).json({ error: "Rate manager access is required to raise a query." }); return; }
  const question = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
  if (!question || question.length > 2000) { res.status(400).json({ error: "Enter a query up to 2000 characters." }); return; }
  const submissions = getQuotationRateSubmissions(await getMongoDb());
  const item = await submissions.findOne({ _id: String(req.params.submissionId), workflowVersion: 3, status: { $in: ["awaiting_rate", "rated"] } });
  if (!item) { res.status(409).json({ error: "This request cannot receive a query in its current status." }); return; }
  const now = new Date();
  const queryHistory = [...(item.queryHistory ?? []), {
    question, raisedBy: actor.id, raisedByName: actor.name, raisedAt: now,
    response: null, respondedBy: null, respondedByName: null, respondedAt: null,
  }];
  await submissions.updateOne({ _id: item._id, updatedAt: item.updatedAt }, { $set: {
    status: "query_raised", queryRaisedAt: now, queryHistory, updatedAt: now,
  } });
  res.json(await responseOne({ ...item, status: "query_raised", queryRaisedAt: now, queryHistory, updatedAt: now }));
});

router.post("/quotation-rate-submissions/:submissionId/query-response", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  const submissions = getQuotationRateSubmissions(await getMongoDb());
  const item = await submissions.findOne({ _id: String(req.params.submissionId), workflowVersion: 3, status: "query_raised" });
  if (!item) { res.status(409).json({ error: "There is no open query on this request." }); return; }
  if (!actor.masterAdmin && (!canSubmit(actor) || item.submittedBy !== actor.id)) {
    res.status(403).json({ error: "Only the requesting quotation member can answer this query." }); return;
  }
  const answer = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
  if (!answer || answer.length > 2000) { res.status(400).json({ error: "Enter a response up to 2000 characters." }); return; }
  const now = new Date();
  const queryHistory = [...(item.queryHistory ?? [])];
  const openQuery = [...queryHistory].reverse().find((query) => !query.respondedAt);
  if (!openQuery || !item.queryRaisedAt) { res.status(409).json({ error: "The open query could not be found." }); return; }
  openQuery.response = answer;
  openQuery.respondedBy = actor.id;
  openQuery.respondedByName = actor.name;
  openQuery.respondedAt = now;
  const updated = { ...item, status: "awaiting_rate" as const, queryRaisedAt: null, pausedWaitMilliseconds: (item.pausedWaitMilliseconds ?? 0) + (now.getTime() - item.queryRaisedAt.getTime()), queryHistory, updatedAt: now };
  await submissions.updateOne({ _id: item._id, updatedAt: item.updatedAt }, { $set: {
    status: updated.status, queryRaisedAt: null, pausedWaitMilliseconds: updated.pausedWaitMilliseconds, queryHistory, updatedAt: now,
  } });
  res.json(await responseOne(updated));
});

router.patch("/quotation-rate-submissions/:submissionId/outcome", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  const status = req.body?.status;
  const lostReason = req.body?.lostReason;
  const allowedReasons = ["price", "competitor", "delayed", "project_cancelled"];
  if (!["negotiating", "won", "lost"].includes(status) || (status === "lost" && !allowedReasons.includes(lostReason))) {
    res.status(400).json({ error: "Choose an outcome; Lost also requires a valid reason." }); return;
  }
  const submissions = getQuotationRateSubmissions(await getMongoDb());
  const item = await submissions.findOne({ _id: String(req.params.submissionId), workflowVersion: 3, status: "sent_to_client" });
  if (!item) { res.status(409).json({ error: "Only sent quotations can have an outcome." }); return; }
  if (!actor.masterAdmin && (!canSubmit(actor) || item.submittedBy !== actor.id)) {
    res.status(403).json({ error: "Only the quotation owner can set its client outcome." }); return;
  }
  if (item.outcomeSource === "confirmation" && item.outcomeStatus === "won") {
    res.status(409).json({ error: "This quotation is already Won from a linked confirmation." }); return;
  }
  const updated = await submissions.findOneAndUpdate({ _id: item._id, updatedAt: item.updatedAt }, { $set: {
    outcomeStatus: status, lostReason: status === "lost" ? lostReason : null, outcomeSource: "manual", updatedAt: new Date(),
  } }, { returnDocument: "after" });
  if (!updated) { res.status(409).json({ error: "This quotation changed. Refresh and try again." }); return; }
  res.json(await responseOne(updated));
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

const rateAttentionReminderTimer = setInterval(() => {
  void sendQuotationRateOverdueReminders().catch((error: unknown) => {
    logger.error({ err: error }, "Hourly quotation rate reminder check failed");
  });
}, 60 * 60 * 1000);
rateAttentionReminderTimer.unref();
void sendQuotationRateOverdueReminders().catch((error: unknown) => {
  logger.error({ err: error }, "Initial quotation rate reminder check failed");
});

export default router;