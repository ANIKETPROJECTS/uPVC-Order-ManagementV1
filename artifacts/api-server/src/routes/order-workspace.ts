import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { Router as ExpressRouter, type RequestHandler } from "express";
import {
  AddPaymentFlagFollowUpBody, AddPaymentFlagFollowUpParams, AddPaymentFlagFollowUpResponse,
  ArchiveOrderDocumentParams, ArchiveOrderWindowParams,
  BounceOrderPaymentBody, BounceOrderPaymentParams, BounceOrderPaymentResponse,
  CreateOrderDocumentCategoryBody, CreateOrderDocumentCategoryResponse,
  CreateOrderPaymentFlagBody, CreateOrderPaymentFlagParams, CreateOrderPaymentFlagResponse,
  CreateOrderWindowBody, CreateOrderWindowParams, CreateOrderWindowResponse, DownloadOrderDocumentParams,
  DeleteOrderDocumentCategoryParams,
  DeleteGlassTrackingParams,
  GetBalancePaymentRegisterResponse,
  GetBalancePaymentTransactionsParams,
  GetBalancePaymentTransactionsResponse,
  GetGlassTrackingResponse,
  ImportGlassOrderWorkbookParams, ImportGlassOrderWorkbookResponse,
  GetPaymentOverviewResponse,
  GetPurchaseOrderRegisterResponse,
  ListOrderDocumentCategoriesResponse,
  ListOrderActivityParams, ListOrderActivityResponse, ListOrderDocumentsParams, ListOrderDocumentsResponse,
  ListOrderPaymentFlagsParams, ListOrderPaymentFlagsResponse, ListOrderPaymentsParams, ListOrderPaymentsResponse, ListOrderWindowsParams, ListOrderWindowsResponse,
  ListOrderRefundsParams, ListOrderRefundsResponse,
  ListPaymentFlagsResponse, RemovePaymentFlagParams, RemovePaymentFlagResponse,
  OpenPaymentReminderParams,
  RecordOrderPaymentBody, RecordOrderPaymentParams, RecordOrderPaymentResponse, UpdateOrderWindowBody,
  RecordOrderRefundBody, RecordOrderRefundParams, RecordOrderRefundResponse,
  ResolvePaymentFlagBody, ResolvePaymentFlagParams, ResolvePaymentFlagResponse,
  PreviewGlassOrderWorkbookParams, PreviewGlassOrderWorkbookResponse,
  ReplaceOrderDocumentParams, ReplaceOrderDocumentResponse,
  UpdateGlassTrackingQuantitiesBody, UpdateGlassTrackingQuantitiesParams, UpdateGlassTrackingQuantitiesResponse,
  UpdateGlassTrackingBody, UpdateGlassTrackingParams, UpdateGlassTrackingResponse,
  UpdateOrderDocumentCategoryBody, UpdateOrderDocumentCategoryParams, UpdateOrderDocumentCategoryResponse,
  UpdateOrderWindowParams, UpdateOrderWindowResponse, UpdatePaymentFlagBody, UpdatePaymentFlagParams, UpdatePaymentFlagResponse, VoidOrderPaymentBody, VoidOrderPaymentParams, VoidOrderPaymentResponse,
  UploadOrderDocumentParams, UploadOrderDocumentResponse, UploadQuotationConfirmationDocumentParams,
  UploadQuotationConfirmationDocumentResponse,
} from "@workspace/api-zod";
import {
  getMongoDb, getOrderActivity, getOrderDocumentCategories, getOrderDocumentMetadata, getOrderDocumentsBucket, getOrderPaymentFlags, getOrderPayments,
  getOrderRefunds, getOrders, getOrderWindows, getGlassTrackingOrders, getGlassTrackingWorkbookImports, getQuotationRateSubmissions, getPublicUser, getUsers, type DocumentCategory, type OrderDocument, type OrderWindowDocument,
  type GlassTrackingItemDocument, type GlassTrackingOrderDocument,
  type OrderPaymentFlagDocument, type PaymentFlagActionDocument, type OrderRefundDocument,
} from "../lib/mongo";
import {
  normalizeDocumentCategoryName,
  orderDocumentCategoryResponse,
} from "../lib/order-document-categories";
import {
  removeProjectUpload,
  resolveProjectUploadPath,
  storeProjectUpload,
} from "../lib/project-upload-storage";
import { parseGlassOrderWorkbook, type ParsedGlassWorkbookSection } from "../lib/glass-order-workbook";

const router = ExpressRouter();
const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILE_MESSAGE = "Document must be 10 MiB or smaller.";
const mimeByExt: Record<string, string[]> = { pdf: ["application/pdf"], png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"], webp: ["image/webp"], docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] };
type UserContext = { id: string; name: string; permissions: Record<string, string>; masterAdmin: boolean };

async function context(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], module?: string, edit = false): Promise<UserContext | null> {
  const db = await getMongoDb();
  const id = req.session.userId;
  const user = id ? await getUsers(db).findOne({ _id: id, status: "active" }) : null;
  if (!user) { res.status(401).json({ error: "Sign in to continue." }); return null; }
  const pub = await getPublicUser(user, db);
  if (!["view", "edit"].includes(pub.permissions["order-hub"] ?? "none")) { res.status(403).json({ error: "Client and order access is required." }); return null; }
  if (module && !(pub.roleId === "master-admin" || pub.permissions[module] === "edit" || (!edit && pub.permissions[module] === "view"))) { res.status(403).json({ error: `${module} access is required.` }); return null; }
  return { id: user._id, name: user.name, permissions: pub.permissions, masterAdmin: pub.roleId === "master-admin" };
}
function hasModuleEdit(actor: UserContext, module: string) {
  return actor.masterAdmin || actor.permissions[module] === "edit";
}
function requireModuleEdit(actor: UserContext, res: Parameters<RequestHandler>[1], module: string) {
  if (hasModuleEdit(actor, module)) return true;
  res.status(403).json({ error: `${module} editing access is required.` });
  return false;
}
async function orderExists(id: string, res: Parameters<RequestHandler>[1]) {
  const order = await getOrders(await getMongoDb()).findOne({ _id: id });
  if (!order) { res.status(404).json({ error: "Order not found." }); return null; }
  return order;
}
async function event(orderRecordId: string, actor: UserContext, action: string, summary: string) {
  await getOrderActivity(await getMongoDb()).insertOne({ _id: randomUUID(), orderRecordId, actorId: actor.id, actorName: actor.name, action, summary, createdAt: new Date() });
}
const windowResponse = (w: OrderWindowDocument) => ({ id: w._id, orderRecordId: w.orderRecordId, windowNo: w.windowNo, widthMm: w.widthMm, heightMm: w.heightMm, windowType: w.windowType, frameStatus: w.frameStatus, shutterStatus: w.shutterStatus, glassStatus: w.glassStatus, pendingReason: w.pendingReason, sqFt: w.sqFt, createdAt: w.createdAt.toISOString(), updatedAt: w.updatedAt.toISOString() });
const paymentResponse = (p: any) => ({
  ...p,
  id: p._id,
  paidAt: p.paidAt.toISOString(),
  bouncedAt: p.bouncedAt?.toISOString().slice(0, 10) ?? null,
  bounceReason: p.bounceReason ?? null,
  bouncedBy: p.bouncedBy ?? null,
  createdAt: p.createdAt.toISOString(),
});
const refundResponse = (refund: OrderRefundDocument) => ({
  id: refund._id,
  orderRecordId: refund.orderRecordId,
  amount: refund.amount,
  refundDate: refund.refundDate.toISOString().slice(0, 10),
  notes: refund.notes,
  createdBy: refund.createdBy,
  createdAt: refund.createdAt.toISOString(),
});
const paymentProgress = (orderValue: number | null | undefined, receipts: number, refunds: number) => {
  const paid = receipts - refunds;
  return {
    orderValue: orderValue ?? null,
    paid,
    balance: orderValue == null ? null : orderValue - paid,
    percentage: orderValue == null || orderValue === 0 ? 0 : (paid / orderValue) * 100,
  };
};
async function getPaymentProgressMap(db: Awaited<ReturnType<typeof getMongoDb>>, ordersById: Map<string, OrderDocument>) {
  const ids = [...ordersById.keys()];
  if (ids.length === 0) return new Map();
  const [paymentTotals, refundTotals] = await Promise.all([
    getOrderPayments(db).aggregate<{ _id: string; total: number }>([
      { $match: { orderRecordId: { $in: ids }, status: "received" } },
      { $group: { _id: "$orderRecordId", total: { $sum: "$amount" } } },
    ]).toArray(),
    getOrderRefunds(db).aggregate<{ _id: string; total: number }>([
      { $match: { orderRecordId: { $in: ids } } },
      { $group: { _id: "$orderRecordId", total: { $sum: "$amount" } } },
    ]).toArray(),
  ]);
  const paidReceiptsByOrder = new Map(paymentTotals.map((row) => [row._id, Number(row.total) || 0]));
  const refundsByOrder = new Map(refundTotals.map((row) => [row._id, Number(row.total) || 0]));
  return new Map(ids.map((id) => [
    id,
    paymentProgress(ordersById.get(id)?.orderValue, paidReceiptsByOrder.get(id) ?? 0, refundsByOrder.get(id) ?? 0),
  ]));
}
const isSamplePaymentFlag = (flag: OrderPaymentFlagDocument) =>
  flag._id.startsWith("sample-payment-flag-") ||
  flag.flaggedById === "sample-data" ||
  flag.flaggedBy.trim().toLowerCase() === "sample data";
const safeFlagActorName = (actorId: string, actorName: string, isSample: boolean) =>
  isSample || actorId === "sample-data" || actorName.trim().toLowerCase() === "sample data"
    ? "System"
    : actorName.trim() || "System";
const paymentFlagResponse = (flag: OrderPaymentFlagDocument, progress: ReturnType<typeof paymentProgress>) => {
  const isSample = isSamplePaymentFlag(flag);
  return ({
  id: flag._id,
  orderRecordId: flag.orderRecordId,
  orderId: flag.orderId,
  clientName: flag.clientName,
  locationName: flag.locationName,
  paymentProgress: progress,
  flagType: flag.flagType,
  remarks: isSample ? "" : flag.remarks,
  flaggedAmount: flag.flaggedAmount,
  flaggedAt: flag.flaggedAt.toISOString(),
  flaggedById: flag.flaggedById,
  flaggedBy: safeFlagActorName(flag.flaggedById, flag.flaggedBy, isSample),
  bounceReason: flag.bounceReason,
  bouncedAmount: flag.bouncedAmount,
  bankCharges: flag.bankCharges,
  followUpCount: flag.followUpCount,
  lastFollowUpDate: flag.lastFollowUpDate?.toISOString().slice(0, 10) ?? null,
  followUpNotes: isSample ? null : flag.followUpNotes,
  status: flag.status,
  resolutionDate: flag.resolutionDate?.toISOString().slice(0, 10) ?? null,
  resolutionNotes: isSample ? null : flag.resolutionNotes,
  removedAt: flag.removedAt?.toISOString() ?? null,
  removedBy: flag.removedBy,
  actions: flag.actions.map((action) => ({
    ...action,
    actorName: safeFlagActorName(action.actorId, action.actorName, isSample),
    occurredAt: (action.action === "created" ? flag.createdAt : action.occurredAt).toISOString(),
    summary: isSample || action.action === "created" ? "" : action.summary,
  })),
  createdAt: flag.createdAt.toISOString(),
  updatedAt: flag.updatedAt.toISOString(),
  });
};
const parseDateOnly = (value: string | Date): Date | null => {
  const dateText = value instanceof Date
    ? Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10)
    : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;
  const parsed = new Date(`${dateText}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateText ? null : parsed;
};
const withIstCalendarDate = (value: string | Date, time: Date): Date | null => {
  const calendarDate = parseDateOnly(value);
  if (!calendarDate) return null;
  const timeParts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(time).map(({ type, value: part }) => [type, part]));
  const timestamp = Date.UTC(
    calendarDate.getUTCFullYear(),
    calendarDate.getUTCMonth(),
    calendarDate.getUTCDate(),
    Number(timeParts.hour),
    Number(timeParts.minute),
    Number(timeParts.second),
    time.getUTCMilliseconds(),
  ) - (5 * 60 + 30) * 60_000;
  return new Date(timestamp);
};
const docResponse = (d: any) => ({ id: d._id, orderRecordId: d.orderRecordId, quotationRequestId: d.quotationRequestId ?? null, filename: d.filename, category: d.category, contentType: d.contentType, sizeBytes: d.sizeBytes, uploadedBy: d.uploadedBy, uploadedAt: d.uploadedAt.toISOString() });
const activityResponse = (a: any) => ({ ...a, id: a._id, createdAt: a.createdAt.toISOString() });
const gridFsOptions = (contentType: string, orderRecordId: string, category: string) => ({ contentType, metadata: { orderRecordId, category } });
const toWhatsAppNumber = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  const normalized = digits.length === 10 ? `91${digits}` : digits;
  return normalized.length >= 8 && normalized.length <= 15 ? normalized : null;
};
const formatReminderAmount = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
const workbookContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function validGlassWorkbookUpload(
  filename: string,
  rawContentType: string | string[] | undefined,
  body: Buffer,
): boolean {
  const declaredType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return Boolean(
    body?.length
    && filename.toLowerCase().endsWith(".xlsx")
    && !/[\\/\0-\x1f]/.test(filename)
    && (declaredType === "application/octet-stream" || declaredType === workbookContentType),
  );
}

function glassTrackingOrderResponse(
  order: OrderDocument,
  tracking: GlassTrackingOrderDocument | null,
  invoice: { filename: string } | null,
) {
  const items = tracking?.items ?? [];
  const ordered = items.reduce((sum, item) => sum + item.ordered, 0);
  const received = items.reduce((sum, item) => sum + item.received, 0);
  const broken = items.reduce((sum, item) => sum + item.broken, 0);
  const status = !tracking
    ? "glass_input_pending"
    : received + broken === 0
      ? "pending"
      : received + broken < ordered
        ? "partial"
        : "received";
  const invoiceFilename = invoice?.filename ?? null;

  return {
    orderRecordId: order._id,
    orderId: order.orderId,
    clientName: order.clientName,
    locationName: order.locationName,
    invoiceNo: invoiceFilename ? invoiceFilename.replace(/\.[^.]+$/, "") : null,
    invoiceFilename,
    glassInputFilename: tracking?.workbookFilename ?? null,
    glassInputRevision: tracking?.revision ?? 0,
    glassInputUploadedAt: tracking?.uploadedAt?.toISOString() ?? null,
    ordered,
    received,
    broken,
    status,
    items,
    updatedAt: (tracking?.updatedAt ?? order.updatedAt).toISOString(),
  };
}

router.get("/glass-tracking", async (req, res): Promise<void> => {
  if (!(await context(req, res, "glass-procurement"))) return;
  const db = await getMongoDb();
  const [orders, trackingRows, invoiceRows] = await Promise.all([
    getOrders(db).find({}).toArray(),
    getGlassTrackingOrders(db).find({}).toArray(),
    getOrderDocumentMetadata(db)
      .find({ category: "invoice", archivedAt: { $exists: false } })
      .sort({ uploadedAt: -1 })
      .toArray(),
  ]);
  const trackingByOrderId = new Map(trackingRows.map((tracking) => [tracking.orderRecordId, tracking]));
  const invoiceByOrderId = new Map<string, (typeof invoiceRows)[number]>();
  for (const invoice of invoiceRows) {
    if (!invoiceByOrderId.has(invoice.orderRecordId)) invoiceByOrderId.set(invoice.orderRecordId, invoice);
  }
  const response = orders
    .map((order) => glassTrackingOrderResponse(
      order,
      trackingByOrderId.get(order._id) ?? null,
      invoiceByOrderId.get(order._id) ?? null,
    ))
    .sort((a, b) => a.orderId.localeCompare(b.orderId, undefined, { numeric: true, sensitivity: "base" }));
  res.json(GetGlassTrackingResponse.parse(response));
});

router.post("/glass-tracking/workbooks/:filename/preview", async (req, res, next): Promise<void> => {
  const p = PreviewGlassOrderWorkbookParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const actor = await context(req, res, "glass-procurement", true);
  if (!actor) return;
  expressRaw(req, res, next, async () => {
    const body = req.body as Buffer;
    if (!validGlassWorkbookUpload(p.data.filename, req.headers["content-type"], body)) {
      res.status(400).json({ error: "Choose an .xlsx workbook no larger than 10 MiB." });
      return;
    }
    try {
      const sections = await parseGlassOrderWorkbook(body);
      res.json(PreviewGlassOrderWorkbookResponse.parse({ filename: p.data.filename, sections }));
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : "The workbook could not be parsed." });
    }
  });
});

router.post("/glass-tracking/workbooks/:filename/import/:mappingToken", async (req, res, next): Promise<void> => {
  const p = ImportGlassOrderWorkbookParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const actor = await context(req, res, "glass-procurement", true);
  if (!actor) return;

  expressRaw(req, res, next, async () => {
    const body = req.body as Buffer;
    if (!validGlassWorkbookUpload(p.data.filename, req.headers["content-type"], body)) {
      res.status(400).json({ error: "Choose an .xlsx workbook no larger than 10 MiB." });
      return;
    }

    let sections: ParsedGlassWorkbookSection[];
    let orderRecordIds: string[];
    try {
      sections = await parseGlassOrderWorkbook(body);
      const decoded = Buffer.from(p.data.mappingToken, "base64url").toString("utf8");
      const parsedMapping: unknown = JSON.parse(decoded);
      if (!Array.isArray(parsedMapping) || !parsedMapping.every((id) => typeof id === "string" && id.length > 0)) {
        res.status(400).json({ error: "Choose an order for every client section before importing." });
        return;
      }
      orderRecordIds = parsedMapping as string[];
      if (orderRecordIds.length !== sections.length) {
        res.status(400).json({ error: "The workbook sections changed after preview. Preview the file again before importing." });
        return;
      }
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : "The workbook or order mapping could not be read." });
      return;
    }

    const db = await getMongoDb();
    const uniqueOrderIds = [...new Set(orderRecordIds)];
    const orders = await getOrders(db).find({ _id: { $in: uniqueOrderIds } }).toArray();
    const ordersById = new Map(orders.map((order) => [order._id, order]));
    if (ordersById.size !== uniqueOrderIds.length) {
      res.status(400).json({ error: "One or more mapped orders no longer exist. Refresh the register and try again." });
      return;
    }

    const sectionItemsByOrder = new Map<string, {
      clientLabels: string[];
      items: ParsedGlassWorkbookSection["items"];
    }>();
    sections.forEach((section, index) => {
      const orderRecordId = orderRecordIds[index];
      const target = sectionItemsByOrder.get(orderRecordId) ?? { clientLabels: [], items: [] };
      target.clientLabels.push(section.clientLabel);
      target.items.push(...section.items);
      sectionItemsByOrder.set(orderRecordId, target);
    });

    const previousRows = await getGlassTrackingOrders(db)
      .find({ orderRecordId: { $in: uniqueOrderIds } })
      .toArray();
    const previousByOrderId = new Map(previousRows.map((row) => [row.orderRecordId, row]));
    const now = new Date();
    const importId = randomUUID();
    const plannedRows: Array<{
      order: (typeof orders)[number];
      previous: GlassTrackingOrderDocument | null;
      next: GlassTrackingOrderDocument;
      clientLabels: string[];
    }> = [];

    for (const [orderRecordId, mapped] of sectionItemsByOrder) {
      const order = ordersById.get(orderRecordId)!;
      const previous = previousByOrderId.get(orderRecordId) ?? null;
      const previousItems = new Map((previous?.items ?? []).map((item) => [item.id, item]));
      const items: GlassTrackingItemDocument[] = mapped.items.map((item) => {
        const old = previousItems.get(item.id);
        return {
          ...item,
          received: old?.received ?? 0,
          broken: old?.broken ?? 0,
        };
      });
      const overOrderedItem = items.find((item) => item.received + item.broken > item.ordered);
      if (overOrderedItem) {
        res.status(409).json({
          error: `The revised quantity for ${order.orderId}, ${overOrderedItem.glassType} · window ${overOrderedItem.windowNo}, is below its recorded received and broken counts. Correct those counts before importing this revision.`,
        });
        return;
      }
      plannedRows.push({
        order,
        previous,
        clientLabels: mapped.clientLabels,
        next: {
          _id: orderRecordId,
          orderRecordId,
          importId,
          workbookFilename: p.data.filename,
          revision: (previous?.revision ?? 0) + 1,
          items,
          uploadedBy: actor.id,
          updatedBy: actor.id,
          uploadedAt: now,
          updatedAt: now,
        },
      });
    }

    let storagePath: string;
    try {
      storagePath = await storeProjectUpload("glass-order-workbooks", p.data.filename, body);
    } catch (error) {
      req.log.error({ err: error }, "Failed to store a glass-order workbook");
      res.status(500).json({ error: "The workbook could not be saved. Try again." });
      return;
    }

    const importDocument = {
      _id: importId,
      filename: p.data.filename,
      storagePath,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: body.length,
      uploadedBy: actor.id,
      uploadedAt: now,
      mappings: sections.map((section, index) => ({
        clientLabel: section.clientLabel,
        orderRecordId: orderRecordIds[index],
      })),
      sections,
    };

    try {
      await getGlassTrackingWorkbookImports(db).insertOne(importDocument);
      await getGlassTrackingOrders(db).bulkWrite(plannedRows.map(({ next }) => ({
        replaceOne: { filter: { _id: next._id }, replacement: next, upsert: true },
      })));
    } catch (error) {
      await getGlassTrackingWorkbookImports(db).deleteOne({ _id: importId }).catch(() => undefined);
      await Promise.all(plannedRows.map(({ order, previous }) =>
        previous
          ? getGlassTrackingOrders(db).replaceOne({ _id: order._id }, previous).catch(() => undefined)
          : getGlassTrackingOrders(db).deleteOne({ _id: order._id }).catch(() => undefined),
      ));
      await removeProjectUpload(storagePath).catch((cleanupError: unknown) =>
        req.log.error({ err: cleanupError, storagePath }, "Failed to clean up an unsuccessful glass workbook import"),
      );
      throw error;
    }

    await Promise.all(plannedRows.map(({ order, next, clientLabels }) =>
      event(order._id, actor, "glass.workbook.imported", `Imported ${p.data.filename} revision ${next.revision} for ${clientLabels.join(", ")}.`),
    ));
    const invoices = await getOrderDocumentMetadata(db)
      .find({ orderRecordId: { $in: uniqueOrderIds }, category: "invoice", archivedAt: { $exists: false } })
      .sort({ uploadedAt: -1 })
      .toArray();
    const invoiceByOrderId = new Map<string, (typeof invoices)[number]>();
    for (const invoice of invoices) {
      if (!invoiceByOrderId.has(invoice.orderRecordId)) invoiceByOrderId.set(invoice.orderRecordId, invoice);
    }
    const result = plannedRows
      .map(({ order, next }) => glassTrackingOrderResponse(order, next, invoiceByOrderId.get(order._id) ?? null))
      .sort((a, b) => a.orderId.localeCompare(b.orderId, undefined, { numeric: true, sensitivity: "base" }));
    res.json(ImportGlassOrderWorkbookResponse.parse(result));
  });
});

router.patch("/orders/:id/glass-tracking/quantities", async (req, res): Promise<void> => {
  const p = UpdateGlassTrackingQuantitiesParams.safeParse(req.params);
  const body = UpdateGlassTrackingQuantitiesBody.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const actor = await context(req, res, "glass-procurement", true);
  if (!actor) return;
  const order = await orderExists(p.data.id, res);
  if (!order) return;

  const collection = getGlassTrackingOrders(await getMongoDb());
  const tracking = await collection.findOne({ orderRecordId: p.data.id });
  if (!tracking) {
    res.status(409).json({ error: "Import a glass-order workbook before recording received or broken quantities." });
    return;
  }
  const updates = new Map(body.data.items.map((item) => [item.id, item]));
  if (updates.size !== body.data.items.length) {
    res.status(400).json({ error: "Each glass item can appear only once in a quantity update." });
    return;
  }
  const items = tracking.items.map((item) => {
    const update = updates.get(item.id);
    return update ? { ...item, received: update.received, broken: update.broken } : item;
  });
  if (body.data.items.some((item) => !tracking.items.some((current) => current.id === item.id))) {
    res.status(400).json({ error: "One or more glass items are no longer in this order. Refresh and try again." });
    return;
  }
  const exceedingItem = items.find((item) => item.received + item.broken > item.ordered);
  if (exceedingItem) {
    res.status(409).json({ error: `Received and broken pieces cannot exceed the ordered quantity for ${exceedingItem.glassType}, window ${exceedingItem.windowNo}.` });
    return;
  }

  const updatedAt = new Date();
  await collection.updateOne(
    { orderRecordId: p.data.id },
    { $set: { items, updatedBy: actor.id, updatedAt } },
  );
  await event(p.data.id, actor, "glass.quantities.updated", "Updated received and broken glass quantities.");
  const invoice = await getOrderDocumentMetadata(await getMongoDb()).findOne({
    orderRecordId: p.data.id,
    category: "invoice",
    archivedAt: { $exists: false },
  }, { sort: { uploadedAt: -1 } });
  res.json(UpdateGlassTrackingQuantitiesResponse.parse(
    glassTrackingOrderResponse(order, { ...tracking, items, updatedBy: actor.id, updatedAt }, invoice),
  ));
});

router.patch("/orders/:id/glass-tracking", async (req, res): Promise<void> => {
  const p = UpdateGlassTrackingParams.safeParse(req.params);
  const body = UpdateGlassTrackingBody.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const actor = await context(req, res, "glass-procurement", true);
  if (!actor) return;
  const order = await orderExists(p.data.id, res);
  if (!order) return;

  const db = await getMongoDb();
  const collection = getGlassTrackingOrders(db);
  const existing = await collection.findOne({ orderRecordId: order._id });
  const existingItemIds = new Set((existing?.items ?? []).map((item) => item.id));
  const submittedIds = body.data.items.flatMap((item) => item.id ? [item.id] : []);
  if (new Set(submittedIds).size !== submittedIds.length) {
    res.status(400).json({ error: "Each glass item can appear only once in an update." });
    return;
  }
  if (submittedIds.some((id) => !existingItemIds.has(id))) {
    res.status(400).json({ error: "One or more glass items no longer belong to this order. Refresh and try again." });
    return;
  }

  const items: GlassTrackingItemDocument[] = body.data.items.map((item) => ({
    id: item.id ?? randomUUID(),
    villaNo: item.villaNo?.trim() || null,
    windowNo: item.windowNo.trim(),
    glassType: item.glassType.trim(),
    widthMm: item.widthMm,
    heightMm: item.heightMm,
    ordered: item.ordered,
    received: item.received,
    broken: item.broken,
  }));
  const exceedingItem = items.find((item) => item.received + item.broken > item.ordered);
  if (exceedingItem) {
    res.status(409).json({
      error: `Received and broken pieces cannot exceed the ordered quantity for ${exceedingItem.glassType}, window ${exceedingItem.windowNo}.`,
    });
    return;
  }

  const now = new Date();
  const next: GlassTrackingOrderDocument = {
    _id: existing?._id ?? order._id,
    orderRecordId: order._id,
    importId: existing?.importId ?? null,
    workbookFilename: existing?.workbookFilename ?? null,
    revision: existing?.revision ?? 0,
    items,
    uploadedBy: existing?.uploadedBy ?? actor.id,
    updatedBy: actor.id,
    uploadedAt: existing?.uploadedAt ?? null,
    updatedAt: now,
  };
  await collection.replaceOne({ orderRecordId: order._id }, next, { upsert: true });
  await event(order._id, actor, "glass.details.updated", `Updated glass tracking details for ${order.orderId}.`);

  const invoice = await getOrderDocumentMetadata(db).findOne({
    orderRecordId: order._id,
    category: "invoice",
    archivedAt: { $exists: false },
  }, { sort: { uploadedAt: -1 } });
  res.json(UpdateGlassTrackingResponse.parse(glassTrackingOrderResponse(order, next, invoice)));
});

router.delete("/orders/:id/glass-tracking", async (req, res): Promise<void> => {
  const p = DeleteGlassTrackingParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const actor = await context(req, res, "glass-procurement", true);
  if (!actor) return;
  const order = await orderExists(p.data.id, res);
  if (!order) return;

  const collection = getGlassTrackingOrders(await getMongoDb());
  const result = await collection.deleteOne({ orderRecordId: order._id });
  if (result.deletedCount === 0) {
    res.status(404).json({ error: "No glass tracking record exists for this order." });
    return;
  }
  await event(order._id, actor, "glass.tracking.deleted", `Removed glass tracking details for ${order.orderId}; the order and workbook import history were retained.`);
  res.sendStatus(204);
});

router.get("/confirmation/purchase-orders", async (req, res): Promise<void> => {
  if (!(await context(req, res, "confirmation"))) return;

  const db = await getMongoDb();
  const [orders, documents] = await Promise.all([
    getOrders(db).find({}).sort({ updatedAt: -1, sequenceNo: -1 }).toArray(),
    getOrderDocumentMetadata(db)
      .find({
        category: { $in: ["purchase_order", "confirmation"] },
        archivedAt: { $exists: false },
      })
      .sort({ uploadedAt: -1 })
      .toArray(),
  ]);
  const linkedQuotationRequests = await getQuotationRateSubmissions(db)
    .find({ orderRecordId: { $in: orders.map((order) => order._id) } })
    .sort({ updatedAt: -1 })
    .toArray();
  const quotationRequestsByOrder = new Map<string, typeof linkedQuotationRequests>();
  for (const request of linkedQuotationRequests) {
    if (!request.orderRecordId) continue;
    const group = quotationRequestsByOrder.get(request.orderRecordId) ?? [];
    group.push(request);
    quotationRequestsByOrder.set(request.orderRecordId, group);
  }
  const documentsByOrder = new Map<
    string,
    { purchaseOrders: typeof documents; confirmations: typeof documents }
  >();

  for (const document of documents) {
    let group = documentsByOrder.get(document.orderRecordId);
    if (!group) {
      group = { purchaseOrders: [], confirmations: [] };
      documentsByOrder.set(document.orderRecordId, group);
    }
    if (document.category === "purchase_order") group.purchaseOrders.push(document);
    if (document.category === "confirmation") group.confirmations.push(document);
  }

  const register = orders.map((order) => {
    const group = documentsByOrder.get(order._id);
    return {
      orderRecordId: order._id,
      orderId: order.orderId,
      clientName: order.clientName,
      locationCode: order.locationCode,
      locationName: order.locationName,
      orderStatus: order.status,
      orderValue: order.orderValue ?? null,
      orderUpdatedAt: order.updatedAt.toISOString(),
      quotationRequests: (quotationRequestsByOrder.get(order._id) ?? []).map((request) => ({
        id: request._id,
        clientName: request.clientName,
        location: request.location,
        status: request.status,
        pdfFilename: request.pdfFilename && (request.pdfStoragePath || request.pdfGridFsId) ? request.pdfFilename : null,
        pdfSizeBytes: request.pdfFilename && (request.pdfStoragePath || request.pdfGridFsId) ? request.pdfSizeBytes : null,
        updatedAt: request.updatedAt.toISOString(),
      })),
      purchaseOrderDocuments: (group?.purchaseOrders ?? []).map(docResponse),
      confirmationDocuments: (group?.confirmations ?? []).map(docResponse),
    };
  });

  res.json(GetPurchaseOrderRegisterResponse.parse(register));
});

router.get("/orders/:id/windows", async (req, res): Promise<void> => {
  const p = ListOrderWindowsParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!(await context(req, res)) || !(await orderExists(p.data.id, res))) return;
  const rows = await getOrderWindows(await getMongoDb()).find({ orderRecordId: p.data.id, archivedAt: { $exists: false } }).sort({ windowNo: 1 }).toArray();
  res.json(ListOrderWindowsResponse.parse(rows.map(windowResponse)));
});
router.post("/orders/:id/windows", async (req, res): Promise<void> => {
  const p = CreateOrderWindowParams.safeParse(req.params), b = CreateOrderWindowBody.safeParse(req.body); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const actor = await context(req, res, "measurements", true); if (!actor || !(await orderExists(p.data.id, res))) return;
  if (!hasModuleEdit(actor, "window-readiness") && (b.data.frameStatus !== "pending" || b.data.shutterStatus !== "pending" || b.data.pendingReason)) { res.status(403).json({ error: "window-readiness editing access is required to set readiness fields." }); return; }
  if (!hasModuleEdit(actor, "glass-procurement") && b.data.glassStatus !== "pending") { res.status(403).json({ error: "glass-procurement editing access is required to set glass status." }); return; }
  const now = new Date(); const w: OrderWindowDocument = { _id: randomUUID(), orderRecordId: p.data.id, ...b.data, frameStatus: hasModuleEdit(actor, "window-readiness") ? b.data.frameStatus : "pending", shutterStatus: hasModuleEdit(actor, "window-readiness") ? b.data.shutterStatus : "pending", glassStatus: hasModuleEdit(actor, "glass-procurement") ? b.data.glassStatus : "pending", pendingReason: hasModuleEdit(actor, "window-readiness") ? b.data.pendingReason ?? null : null, sqFt: Math.round((b.data.widthMm * b.data.heightMm / 92903.04) * 1000) / 1000, createdBy: actor.id, createdAt: now, updatedBy: actor.id, updatedAt: now };
  try { await getOrderWindows(await getMongoDb()).insertOne(w); } catch (e) { if ((e as any)?.code === 11000) { res.status(409).json({ error: "Window number already exists for this order." }); return; } throw e; }
  await event(p.data.id, actor, "window.created", `Added window ${w.windowNo}.`); res.status(201).json(CreateOrderWindowResponse.parse(windowResponse(w)));
});
router.patch("/orders/:id/windows/:windowId", async (req, res): Promise<void> => {
  const p = UpdateOrderWindowParams.safeParse(req.params), b = UpdateOrderWindowBody.safeParse(req.body); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const actor = await context(req, res); if (!actor) return;
  const db = await getMongoDb(); const old = await getOrderWindows(db).findOne({ _id: p.data.windowId, orderRecordId: p.data.id, archivedAt: { $exists: false } }); if (!old) { res.status(404).json({ error: "Window not found." }); return; }
  const keys = Object.keys(b.data); const measurement = keys.some(k => ["windowNo", "widthMm", "heightMm", "windowType"].includes(k)); const readiness = keys.some(k => ["frameStatus", "shutterStatus", "pendingReason"].includes(k)); const glass = keys.includes("glassStatus");
  if (keys.length === 0) { res.status(400).json({ error: "At least one window field must be provided." }); return; }
  if (measurement && !requireModuleEdit(actor, res, "measurements")) return;
  if (readiness && !requireModuleEdit(actor, res, "window-readiness")) return;
  if (glass && !requireModuleEdit(actor, res, "glass-procurement")) return;
  const changedKeys = keys.filter(k => (old as any)[k] !== (b.data as any)[k]);
  if (changedKeys.length === 0) { res.json(UpdateOrderWindowResponse.parse(windowResponse(old))); return; }
  const changes = Object.fromEntries(changedKeys.map(k => [k, (b.data as any)[k]]));
  const next = { ...old, ...changes }; const updates: any = { ...changes, sqFt: Math.round((next.widthMm * next.heightMm / 92903.04) * 1000) / 1000, updatedAt: new Date(), updatedBy: actor.id };
  try { await getOrderWindows(db).updateOne({ _id: old._id }, { $set: updates }); } catch (e) { if ((e as any)?.code === 11000) { res.status(409).json({ error: "Window number already exists for this order." }); return; } throw e; }
  const updated = await getOrderWindows(db).findOne({ _id: old._id }); await event(p.data.id, actor, "window.updated", `Updated window ${old.windowNo}.`); res.json(UpdateOrderWindowResponse.parse(windowResponse(updated!)));
});
router.delete("/orders/:id/windows/:windowId", async (req, res): Promise<void> => {
  const p = ArchiveOrderWindowParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } const actor = await context(req, res, "measurements", true); if (!actor || !(await orderExists(p.data.id, res))) return;
  const db = await getMongoDb(); const w = await getOrderWindows(db).findOne({ _id: p.data.windowId, orderRecordId: p.data.id, archivedAt: { $exists: false } }); if (!w) { res.status(404).json({ error: "Window not found." }); return; }
  await getOrderWindows(db).updateOne({ _id: w._id }, { $set: { archivedAt: new Date(), updatedAt: new Date(), updatedBy: actor.id } }); await event(p.data.id, actor, "window.archived", `Archived window ${w.windowNo}.`); res.status(204).send();
});

router.get("/orders/:id/payments", async (req, res): Promise<void> => {
  const p = ListOrderPaymentsParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const actor = await context(req, res, "payments");
  if (!actor || !(await orderExists(p.data.id, res))) return;
  const rows = await getOrderPayments(await getMongoDb()).find({ orderRecordId: p.data.id }).sort({ createdAt: -1 }).toArray();
  res.json(ListOrderPaymentsResponse.parse(rows.map(paymentResponse)));
});
router.post("/orders/:id/payments", async (req, res): Promise<void> => {
  const p = RecordOrderPaymentParams.safeParse(req.params);
  const b = RecordOrderPaymentBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const actor = await context(req, res, "payments", true);
  const order = actor ? await orderExists(p.data.id, res) : null;
  if (!actor || !order) return;
  const db = await getMongoDb();
  const progress = (await getPaymentProgressMap(db, new Map([[order._id, order]]))).get(order._id)!;
  if (order.orderValue != null && progress.paid + b.data.amount > order.orderValue) {
    res.status(400).json({ error: "Payment exceeds the remaining order balance." });
    return;
  }
  const paidAt = new Date(b.data.paidAt);
  if (Number.isNaN(paidAt.getTime())) { res.status(400).json({ error: "Invalid payment date." }); return; }
  const payment = {
    _id: randomUUID(), orderRecordId: p.data.id, amount: b.data.amount, method: b.data.method,
    reference: b.data.reference ?? null, notes: b.data.notes ?? null, paidAt, status: "received" as const,
    voidReason: null, bouncedAt: null, bounceReason: null, bouncedBy: null, createdBy: actor.id, createdAt: new Date(),
  };
  await getOrderPayments(db).insertOne(payment);
  await event(p.data.id, actor, "payment.recorded", `Recorded payment of ${payment.amount}.`);
  res.status(201).json(RecordOrderPaymentResponse.parse(paymentResponse(payment)));
});
router.patch("/orders/:id/payments/:paymentId", async (req, res): Promise<void> => {
  const p = VoidOrderPaymentParams.safeParse(req.params);
  const b = VoidOrderPaymentBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const actor = await context(req, res, "payments", true);
  const order = actor ? await orderExists(p.data.id, res) : null;
  if (!actor || !order) return;
  const db = await getMongoDb();
  const old = await getOrderPayments(db).findOne({ _id: p.data.paymentId, orderRecordId: p.data.id });
  if (!old) { res.status(404).json({ error: "Payment not found." }); return; }
  if (old.status !== "received") { res.status(400).json({ error: "Only a received payment can be voided." }); return; }
  const progress = (await getPaymentProgressMap(db, new Map([[order._id, order]]))).get(order._id)!;
  if (progress.paid - old.amount < 0) { res.status(409).json({ error: "This receipt cannot be voided because recorded refunds would exceed the remaining received receipts." }); return; }
  const update = await getOrderPayments(db).updateOne(
    { _id: old._id, status: "received" },
    { $set: { status: "void", voidReason: b.data.voidReason, voidedBy: actor.id, voidedAt: new Date() } },
  );
  if (update.modifiedCount === 0) { res.status(409).json({ error: "This payment has already changed status." }); return; }
  const updated = await getOrderPayments(db).findOne({ _id: old._id });
  await event(p.data.id, actor, "payment.voided", `Voided payment of ${old.amount}.`);
  res.json(VoidOrderPaymentResponse.parse(paymentResponse(updated)));
});
router.post("/orders/:id/payments/:paymentId/bounce", async (req, res): Promise<void> => {
  const p = BounceOrderPaymentParams.safeParse(req.params);
  const b = BounceOrderPaymentBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const actor = await context(req, res, "payments", true);
  const order = actor ? await orderExists(p.data.id, res) : null;
  if (!actor || !order) return;
  const bouncedAt = parseDateOnly(b.data.bouncedAt);
  if (!bouncedAt) { res.status(400).json({ error: "Enter a valid bounce date." }); return; }
  const db = await getMongoDb();
  const old = await getOrderPayments(db).findOne({ _id: p.data.paymentId, orderRecordId: p.data.id });
  if (!old) { res.status(404).json({ error: "Payment not found." }); return; }
  if (old.status !== "received") { res.status(400).json({ error: "Only a received payment can be marked bounced." }); return; }
  const progress = (await getPaymentProgressMap(db, new Map([[order._id, order]]))).get(order._id)!;
  if (progress.paid - old.amount < 0) { res.status(409).json({ error: "This receipt cannot be bounced because recorded refunds would exceed the remaining received receipts." }); return; }
  const update = await getOrderPayments(db).updateOne(
    { _id: old._id, status: "received" },
    { $set: { status: "bounced", bouncedAt, bounceReason: b.data.bounceReason.trim(), bouncedBy: actor.id } },
  );
  if (update.modifiedCount === 0) { res.status(409).json({ error: "This payment has already changed status." }); return; }
  const updated = await getOrderPayments(db).findOne({ _id: old._id });
  await event(p.data.id, actor, "payment.bounced", `Marked payment of ${old.amount} as bounced: ${b.data.bounceReason.trim()}.`);
  res.json(BounceOrderPaymentResponse.parse(paymentResponse(updated)));
});
router.get("/orders/:id/refunds", async (req, res): Promise<void> => {
  const p = ListOrderRefundsParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const actor = await context(req, res, "payments");
  if (!actor || !(await orderExists(p.data.id, res))) return;
  const rows = await getOrderRefunds(await getMongoDb()).find({ orderRecordId: p.data.id }).sort({ refundDate: -1, createdAt: -1 }).toArray();
  res.json(ListOrderRefundsResponse.parse(rows.map(refundResponse)));
});
router.post("/orders/:id/refunds", async (req, res): Promise<void> => {
  const p = RecordOrderRefundParams.safeParse(req.params);
  const b = RecordOrderRefundBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const actor = await context(req, res, "payments", true);
  const order = actor ? await orderExists(p.data.id, res) : null;
  if (!actor || !order) return;
  const refundDate = parseDateOnly(b.data.refundDate);
  if (!refundDate) { res.status(400).json({ error: "Enter a valid refund date." }); return; }
  const db = await getMongoDb();
  const progress = (await getPaymentProgressMap(db, new Map([[order._id, order]]))).get(order._id)!;
  if (b.data.amount > Math.max(0, progress.paid)) {
    res.status(400).json({ error: "Refund exceeds the amount currently paid on this order." });
    return;
  }
  const refund: OrderRefundDocument = {
    _id: randomUUID(), orderRecordId: order._id, amount: b.data.amount, refundDate,
    notes: b.data.notes?.trim() || null, createdBy: actor.id, createdAt: new Date(),
  };
  await getOrderRefunds(db).insertOne(refund);
  await event(order._id, actor, "payment.refunded", `Recorded a refund of ${refund.amount}.`);
  res.status(201).json(RecordOrderRefundResponse.parse(refundResponse(refund)));
});

router.get("/payments/flags", async (req, res): Promise<void> => {
  if (!(await context(req, res, "payments"))) return;
  const db = await getMongoDb();
  const flags = await getOrderPaymentFlags(db).find({}).sort({ createdAt: -1, _id: 1 }).toArray();
  const orderIds = [...new Set(flags.map((flag) => flag.orderRecordId))];
  const orders = await getOrders(db).find({ _id: { $in: orderIds } }).toArray();
  const progressByOrder = await getPaymentProgressMap(db, new Map(orders.map((order) => [order._id, order])));
  res.json(ListPaymentFlagsResponse.parse(flags.map((flag) =>
    paymentFlagResponse(flag, progressByOrder.get(flag.orderRecordId) ?? paymentProgress(null, 0, 0)),
  )));
});

router.get("/orders/:id/payment-flags", async (req, res): Promise<void> => {
  const p = ListOrderPaymentFlagsParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!(await context(req, res, "payments"))) return;
  const order = await orderExists(p.data.id, res);
  if (!order) return;
  const db = await getMongoDb();
  const flags = await getOrderPaymentFlags(db)
    .find({ orderRecordId: p.data.id })
    .sort({ createdAt: -1, _id: 1 })
    .toArray();
  const progress = (await getPaymentProgressMap(db, new Map([[order._id, order]]))).get(order._id)!;
  res.json(ListOrderPaymentFlagsResponse.parse(flags.map((flag) => paymentFlagResponse(flag, progress))));
});

router.post("/orders/:id/payment-flags", async (req, res): Promise<void> => {
  const p = CreateOrderPaymentFlagParams.safeParse(req.params);
  const b = CreateOrderPaymentFlagBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const actor = await context(req, res, "payments", true);
  const order = actor ? await orderExists(p.data.id, res) : null;
  if (!actor || !order) return;
  if (!b.data.remarks.trim()) { res.status(400).json({ error: "Add remarks describing the payment issue." }); return; }
  const now = new Date();
  const flaggedAt = withIstCalendarDate(b.data.flaggedAt, now);
  if (!flaggedAt) { res.status(400).json({ error: "Enter a valid flag date." }); return; }
  const db = await getMongoDb();

  let flaggedAmount: number;
  let bounceReason: string | null = null;
  let bouncedAmount: number | null = null;
  let bankCharges: number | null = null;
  let followUpCount: number | null = null;
  let lastFollowUpDate: Date | null = null;
  let followUpNotes: string | null = null;
  if (b.data.flagType === "bounced_payment") {
    if (!b.data.bounceReason?.trim() || b.data.bouncedAmount == null || b.data.bouncedAmount <= 0) {
      res.status(400).json({ error: "A bounce reason and bounced amount are required." });
      return;
    }
    if (b.data.bankCharges != null && b.data.bankCharges < 0) {
      res.status(400).json({ error: "Bank charges cannot be negative." });
      return;
    }
    bounceReason = b.data.bounceReason.trim();
    bouncedAmount = b.data.bouncedAmount;
    bankCharges = b.data.bankCharges ?? null;
    flaggedAmount = bouncedAmount;
  } else {
    if (b.data.followUpCount == null || b.data.followUpCount < 1 || !b.data.followUpNotes?.trim()) {
      res.status(400).json({ error: "Follow-up count, last follow-up date, and notes are required." });
      return;
    }
    lastFollowUpDate = b.data.lastFollowUpDate ? parseDateOnly(b.data.lastFollowUpDate) : null;
    if (!lastFollowUpDate) { res.status(400).json({ error: "Enter a valid last follow-up date." }); return; }
    if (order.orderValue == null) {
      res.status(409).json({ error: "Set the order value before flagging a refusal to pay." });
      return;
    }
    const progress = (await getPaymentProgressMap(db, new Map([[order._id, order]]))).get(order._id)!;
    flaggedAmount = Math.max(0, progress.balance ?? 0);
    if (flaggedAmount <= 0) {
      res.status(409).json({ error: "This order has no pending amount to flag." });
      return;
    }
    followUpCount = b.data.followUpCount;
    followUpNotes = b.data.followUpNotes.trim();
  }

  const id = randomUUID();
  const historyEntry: PaymentFlagActionDocument = {
    id: randomUUID(),
    action: "created",
    actorId: actor.id,
    actorName: actor.name,
    occurredAt: now,
    summary: "",
  };
  const flag: OrderPaymentFlagDocument = {
    _id: id,
    orderRecordId: order._id,
    orderId: order.orderId,
    clientName: order.clientName,
    locationName: order.locationName,
    flagType: b.data.flagType,
    remarks: b.data.remarks.trim(),
    flaggedAmount,
    flaggedAt,
    flaggedById: actor.id,
    flaggedBy: actor.name,
    bounceReason,
    bouncedAmount,
    bankCharges,
    followUpCount,
    lastFollowUpDate,
    followUpNotes,
    status: "active",
    resolutionDate: null,
    resolutionNotes: null,
    removedAt: null,
    removedBy: null,
    actions: [historyEntry],
    createdAt: now,
    updatedAt: now,
  };
  await getOrderPaymentFlags(db).insertOne(flag);
  await event(
    order._id,
    actor,
    "payment.flag_created",
    `${b.data.flagType === "bounced_payment" ? "Bounced payment" : "Refusal to pay"} flag created.`,
  );
  const progress = (await getPaymentProgressMap(db, new Map([[order._id, order]]))).get(order._id)!;
  res.status(201).json(CreateOrderPaymentFlagResponse.parse(paymentFlagResponse(flag, progress)));
});

router.patch("/payment-flags/:id/resolve", async (req, res): Promise<void> => {
  const p = ResolvePaymentFlagParams.safeParse(req.params);
  const b = ResolvePaymentFlagBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const actor = await context(req, res, "payments", true);
  if (!actor) return;
  if (!b.data.resolutionNotes.trim()) { res.status(400).json({ error: "Add notes describing how the issue was resolved." }); return; }
  const resolutionDate = parseDateOnly(b.data.resolutionDate);
  if (!resolutionDate) { res.status(400).json({ error: "Enter a valid resolution date." }); return; }
  const db = await getMongoDb();
  const flags = getOrderPaymentFlags(db);
  const old = await flags.findOne({ _id: p.data.id });
  if (!old) { res.status(404).json({ error: "Payment flag not found." }); return; }
  if (old.status !== "active") { res.status(409).json({ error: "Only active payment flags can be resolved." }); return; }
  const now = new Date();
  const action: PaymentFlagActionDocument = {
    id: randomUUID(),
    action: "resolved",
    actorId: actor.id,
    actorName: actor.name,
    occurredAt: now,
    summary: b.data.resolutionNotes.trim(),
  };
  const result = await flags.updateOne({ _id: old._id, status: "active" }, {
    $set: { status: "resolved", resolutionDate, resolutionNotes: b.data.resolutionNotes.trim(), updatedAt: now },
    $push: { actions: action },
  });
  if (result.modifiedCount === 0) { res.status(409).json({ error: "Payment flag changed before it could be resolved. Refresh and try again." }); return; }
  const updated = await flags.findOne({ _id: old._id });
  await event(old.orderRecordId, actor, "payment.flag_resolved", `Resolved payment flag for ${old.orderId}. ${action.summary}`);
  const order = await getOrders(db).findOne({ _id: old.orderRecordId });
  const progress = order
    ? (await getPaymentProgressMap(db, new Map([[order._id, order]]))).get(order._id)!
    : paymentProgress(null, 0, 0);
  res.json(ResolvePaymentFlagResponse.parse(paymentFlagResponse(updated!, progress)));
});

router.patch("/payment-flags/:id", async (req, res): Promise<void> => {
  const p = UpdatePaymentFlagParams.safeParse(req.params);
  const b = UpdatePaymentFlagBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const actor = await context(req, res, "payments", true);
  if (!actor) return;
  const db = await getMongoDb();
  const flags = getOrderPaymentFlags(db);
  const old = await flags.findOne({ _id: p.data.id });
  if (!old) { res.status(404).json({ error: "Payment flag not found." }); return; }
  if (old.status === "removed") { res.status(409).json({ error: "Removed payment flags cannot be edited." }); return; }
  const remarks = b.data.remarks.trim();
  if (!remarks) { res.status(400).json({ error: "Add remarks describing the payment issue." }); return; }

  const now = new Date();
  const set: Record<string, unknown> = { remarks, updatedAt: now };
  let summary: string;
  if (old.flagType === "bounced_payment") {
    const bounceReason = b.data.bounceReason?.trim();
    if (!bounceReason || b.data.bouncedAmount == null || b.data.bouncedAmount <= 0) {
      res.status(400).json({ error: "A bounce reason and bounced amount are required." });
      return;
    }
    if (b.data.bankCharges != null && b.data.bankCharges < 0) {
      res.status(400).json({ error: "Bank charges cannot be negative." });
      return;
    }
    set.bounceReason = bounceReason;
    set.bouncedAmount = b.data.bouncedAmount;
    set.bankCharges = b.data.bankCharges ?? null;
    set.flaggedAmount = b.data.bouncedAmount;
    summary = "Edited remarks and bounced payment details.";
  } else {
    const lastFollowUpDate = b.data.lastFollowUpDate ? parseDateOnly(b.data.lastFollowUpDate) : null;
    const followUpNotes = b.data.followUpNotes?.trim();
    if (b.data.followUpCount == null || b.data.followUpCount < 1 || !lastFollowUpDate || !followUpNotes) {
      res.status(400).json({ error: "Follow-up count, last follow-up date, and notes are required." });
      return;
    }
    set.followUpCount = b.data.followUpCount;
    set.lastFollowUpDate = lastFollowUpDate;
    set.followUpNotes = followUpNotes;
    summary = "Edited remarks and refusal-to-pay follow-up details.";
  }
  const action: PaymentFlagActionDocument = {
    id: randomUUID(),
    action: "edited",
    actorId: actor.id,
    actorName: actor.name,
    occurredAt: now,
    summary,
  };
  const result = await flags.updateOne({ _id: old._id, status: old.status, updatedAt: old.updatedAt }, {
    $set: set,
    $push: { actions: action },
  });
  if (result.modifiedCount === 0) { res.status(409).json({ error: "Payment flag changed before it could be edited. Refresh and try again." }); return; }
  const updated = await flags.findOne({ _id: old._id });
  await event(old.orderRecordId, actor, "payment.flag_edited", `${summary} ${old.orderId}.`);
  const order = await getOrders(db).findOne({ _id: old.orderRecordId });
  const progress = order
    ? (await getPaymentProgressMap(db, new Map([[order._id, order]]))).get(order._id)!
    : paymentProgress(null, 0, 0);
  res.json(UpdatePaymentFlagResponse.parse(paymentFlagResponse(updated!, progress)));
});

router.post("/payment-flags/:id/follow-ups", async (req, res): Promise<void> => {
  const p = AddPaymentFlagFollowUpParams.safeParse(req.params);
  const b = AddPaymentFlagFollowUpBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const actor = await context(req, res, "payments", true);
  if (!actor) return;
  const followUpDate = parseDateOnly(b.data.followUpDate);
  const notes = b.data.notes.trim();
  if (!followUpDate || !notes) { res.status(400).json({ error: "Enter a valid follow-up date and notes." }); return; }
  const db = await getMongoDb();
  const flags = getOrderPaymentFlags(db);
  const old = await flags.findOne({ _id: p.data.id });
  if (!old) { res.status(404).json({ error: "Payment flag not found." }); return; }
  if (old.flagType !== "refusal_to_pay" || old.status !== "active") {
    res.status(409).json({ error: "Follow-ups can only be added to active refusal-to-pay flags." });
    return;
  }
  const followUpCount = Math.max(0, old.followUpCount ?? 0) + 1;
  const dateText = followUpDate.toISOString().slice(0, 10);
  const followUpNotes = [old.followUpNotes?.trim(), `${dateText} — ${notes}`].filter(Boolean).join("\n");
  const now = new Date();
  const action: PaymentFlagActionDocument = {
    id: randomUUID(),
    action: "follow_up_added",
    actorId: actor.id,
    actorName: actor.name,
    occurredAt: now,
    summary: `Follow-up ${followUpCount} on ${dateText}: ${notes}`,
  };
  const result = await flags.updateOne({ _id: old._id, status: "active", updatedAt: old.updatedAt }, {
    $set: { followUpCount, lastFollowUpDate: followUpDate, followUpNotes, updatedAt: now },
    $push: { actions: action },
  });
  if (result.modifiedCount === 0) { res.status(409).json({ error: "Payment flag changed before the follow-up was saved. Refresh and try again." }); return; }
  const updated = await flags.findOne({ _id: old._id });
  await event(old.orderRecordId, actor, "payment.flag_follow_up_added", action.summary);
  const order = await getOrders(db).findOne({ _id: old.orderRecordId });
  const progress = order
    ? (await getPaymentProgressMap(db, new Map([[order._id, order]]))).get(order._id)!
    : paymentProgress(null, 0, 0);
  res.json(AddPaymentFlagFollowUpResponse.parse(paymentFlagResponse(updated!, progress)));
});

router.delete("/payment-flags/:id", async (req, res): Promise<void> => {
  const p = RemovePaymentFlagParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const actor = await context(req, res, "payments", true);
  if (!actor) return;
  const db = await getMongoDb();
  const flags = getOrderPaymentFlags(db);
  const old = await flags.findOne({ _id: p.data.id });
  if (!old) { res.status(404).json({ error: "Payment flag not found." }); return; }
  if (old.status === "removed") { res.status(409).json({ error: "Payment flag is already removed." }); return; }
  const now = new Date();
  const action: PaymentFlagActionDocument = {
    id: randomUUID(),
    action: "removed",
    actorId: actor.id,
    actorName: actor.name,
    occurredAt: now,
    summary: "Removed from active payment tracking; audit history retained.",
  };
  const result = await flags.updateOne({ _id: old._id, status: { $ne: "removed" } }, {
    $set: { status: "removed", removedAt: now, removedBy: actor.name, updatedAt: now },
    $push: { actions: action },
  });
  if (result.modifiedCount === 0) { res.status(409).json({ error: "Payment flag changed before it could be removed. Refresh and try again." }); return; }
  const updated = await flags.findOne({ _id: old._id });
  await event(old.orderRecordId, actor, "payment.flag_removed", `Removed payment flag for ${old.orderId}.`);
  const order = await getOrders(db).findOne({ _id: old.orderRecordId });
  const progress = order
    ? (await getPaymentProgressMap(db, new Map([[order._id, order]]))).get(order._id)!
    : paymentProgress(null, 0, 0);
  res.json(RemovePaymentFlagResponse.parse(paymentFlagResponse(updated!, progress)));
});

router.get("/payments/balance-register", async (req, res): Promise<void> => {
  const actor = await context(req, res, "balance-payment");
  if (!actor) return;
  const db = await getMongoDb();
  const orders = await getOrders(db).find({})
    .sort({ createdAt: -1, sequenceNo: -1 })
    .toArray();
  const ordersById = new Map(orders.map((order) => [order._id, order]));
  const progressByOrder = await getPaymentProgressMap(db, ordersById);
  res.json(GetBalancePaymentRegisterResponse.parse(orders.map((order) => {
    const progress = progressByOrder.get(order._id) ?? paymentProgress(order.orderValue, 0, 0);
    return {
      orderRecordId: order._id,
      orderId: order.orderId,
      clientName: order.clientName,
      locationName: order.locationName,
      orderStatus: order.status,
      orderValue: progress.orderValue,
      netPaid: progress.paid,
      balance: progress.balance,
      percentage: progress.percentage,
      createdAt: order.createdAt.toISOString(),
    };
  })));
});

router.get("/payments/balance-register/:orderRecordId/transactions", async (req, res): Promise<void> => {
  const params = GetBalancePaymentTransactionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const actor = await context(req, res, "balance-payment");
  if (!actor) return;
  const db = await getMongoDb();
  const order = await getOrders(db).findOne({ _id: params.data.orderRecordId });
  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  const [receipts, refunds] = await Promise.all([
    getOrderPayments(db).find({ orderRecordId: order._id }).sort({ paidAt: -1, createdAt: -1 }).toArray(),
    getOrderRefunds(db).find({ orderRecordId: order._id }).sort({ refundDate: -1, createdAt: -1 }).toArray(),
  ]);
  res.json(GetBalancePaymentTransactionsResponse.parse({
    orderRecordId: order._id,
    receipts: receipts.map(paymentResponse),
    refunds: refunds.map(refundResponse),
  }));
});

router.get("/payments/overview", async (req, res): Promise<void> => {
  const actor = await context(req, res, "payments");
  if (!actor) return;
  const db = await getMongoDb();
  const [orders, recentPayments] = await Promise.all([
    getOrders(db).find({}).toArray(),
    getOrderPayments(db).find({ status: "received" }).sort({ createdAt: -1, _id: -1 }).limit(12).toArray(),
  ]);
  const orderById = new Map(orders.map((order) => [order._id, order]));
  const progressByOrder = await getPaymentProgressMap(db, orderById);
  const totalCollected = [...progressByOrder.values()].reduce((sum, progress) => sum + progress.paid, 0);
  const totalOutstanding = orders.reduce((sum, order) => {
    const balance = progressByOrder.get(order._id)?.balance;
    return sum + Math.max(0, balance ?? 0);
  }, 0);
  const outstandingOrders = orders.filter((order) => order.orderValue != null
    && (progressByOrder.get(order._id)?.balance ?? 0) > 0);
  const activeWindows = await getOrderWindows(db).find({
    orderRecordId: { $in: outstandingOrders.map((order) => order._id) },
    archivedAt: { $exists: false },
  }).toArray();
  const windowsByOrder = new Map<string, OrderWindowDocument[]>();
  for (const window of activeWindows) {
    const rows = windowsByOrder.get(window.orderRecordId) ?? [];
    rows.push(window);
    windowsByOrder.set(window.orderRecordId, rows);
  }
  const reminderOrders = outstandingOrders.map((order) => {
    const windows = windowsByOrder.get(order._id) ?? [];
    const progress = progressByOrder.get(order._id)!;
    const balance = progress.balance!;
    const productionReady = windows.length > 0 && windows.every((window) => window.frameStatus === "ready"
      && window.shutterStatus === "ready" && window.glassStatus === "received");
    return {
      orderRecordId: order._id,
      orderId: order.orderId,
      orderCreatedAt: order.createdAt.toISOString(),
      orderStatus: order.status,
      clientName: order.clientName,
      locationName: order.locationName,
      orderValue: order.orderValue!,
      totalCollected: progress.paid,
      balance,
      percentage: progress.percentage,
      windowCount: windows.length,
      productionReady,
      canOpenWhatsApp: productionReady && Boolean(toWhatsAppNumber(order.clientPhone)),
    };
  }).sort((a, b) => b.balance - a.balance);

  const recentOrderIds = new Set(recentPayments.map((payment) => payment.orderRecordId));
  const recorderIds = [...new Set(recentPayments.map((payment) => payment.createdBy))];
  const recorders = await getUsers(db).find({ _id: { $in: recorderIds } }).project({ _id: 1, name: 1 }).toArray();
  const recorderNames = new Map(recorders.map((recorder) => [recorder._id, recorder.name]));
  const recentUpdates = recentPayments.flatMap((payment) => {
    const order = orderById.get(payment.orderRecordId);
    if (!order || !recentOrderIds.has(payment.orderRecordId)) return [];
    return [{
      id: payment._id,
      orderRecordId: payment.orderRecordId,
      orderId: order.orderId,
      clientName: order.clientName,
      locationName: order.locationName,
      amount: payment.amount,
      method: payment.method,
      paidAt: payment.paidAt.toISOString(),
      recordedBy: recorderNames.get(payment.createdBy) ?? "Former user",
      createdAt: payment.createdAt.toISOString(),
    }];
  });
  const reminderAvailable = reminderOrders.some((order) => order.canOpenWhatsApp);
  const reminderUnavailableReason = reminderOrders.length > 0 && !reminderAvailable
    ? [
      reminderOrders.some((order) => !order.productionReady)
        ? "Add at least one active window, then make every frame and shutter ready and receive all glass."
        : null,
      reminderOrders.some((order) => order.productionReady && !order.canOpenWhatsApp)
        ? "A valid client WhatsApp number is required to open a reminder draft."
        : null,
    ].filter((reason): reason is string => reason !== null).join(" ")
    : null;
  res.json(GetPaymentOverviewResponse.parse({
    totalCollected,
    totalOutstanding,
    ordersWithBalance: outstandingOrders.length,
    reminderOrders,
    recentPayments: recentUpdates,
    reminderAvailable,
    reminderUnavailableReason,
  }));
});

router.post("/orders/:id/payment-reminder", async (req, res): Promise<void> => {
  const p = OpenPaymentReminderParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const actor = await context(req, res, "payments", true);
  const order = actor ? await orderExists(p.data.id, res) : null;
  if (!actor || !order) return;
  const db = await getMongoDb();
  const windows = await getOrderWindows(db).find({
    orderRecordId: order._id,
    archivedAt: { $exists: false },
  }).toArray();
  if (windows.length === 0 || windows.some((window) => window.frameStatus !== "ready"
    || window.shutterStatus !== "ready" || window.glassStatus !== "received")) {
    res.status(409).json({ error: "Every active window must have a ready frame, ready shutter, and received glass before opening a reminder." });
    return;
  }
  if (order.orderValue == null) {
    res.status(409).json({ error: "Set the order value before opening a balance reminder." });
    return;
  }
  const progress = (await getPaymentProgressMap(db, new Map([[order._id, order]]))).get(order._id)!;
  const balance = progress.balance!;
  if (balance <= 0) {
    res.status(409).json({ error: "This order no longer has an outstanding balance." });
    return;
  }
  const phoneNumber = toWhatsAppNumber(order.clientPhone);
  if (!phoneNumber) {
    res.status(409).json({ error: "Add a valid WhatsApp number to this order before opening a reminder." });
    return;
  }
  const message = `Hello ${order.clientName}, the outstanding balance of ₹${formatReminderAmount(balance)} is due for your uPVC order ${order.orderId} at ${order.locationName}. All windows are ready. Please contact us to arrange payment. Thank you.`;
  const whatsappUrl = new URL(`https://wa.me/${phoneNumber}`);
  whatsappUrl.searchParams.set("text", message);
  await event(
    order._id,
    actor,
    "payment.reminder_prepared",
    `Prepared a manual WhatsApp balance reminder for ${order.clientName} on order ${order.orderId}. The message opens as a draft; sending is manual and delivery is not confirmed.`,
  );
  res.redirect(303, whatsappUrl.toString());
});

router.get("/order-document-categories", async (req, res): Promise<void> => {
  const actor = await context(req, res, "order-hub");
  if (!actor) return;
  const db = await getMongoDb();
  const categories = await getOrderDocumentCategories(db).find({}).sort({ label: 1 }).toArray();
  res.json(ListOrderDocumentCategoriesResponse.parse(categories.map(orderDocumentCategoryResponse)));
});

router.post("/order-document-categories", async (req, res): Promise<void> => {
  const actor = await context(req, res, "order-hub", true);
  if (!actor) return;
  const body = CreateOrderDocumentCategoryBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const label = normalizeDocumentCategoryName(body.data.name);
  if (!label) { res.status(400).json({ error: "Category name cannot be blank." }); return; }
  const db = await getMongoDb();
  const categories = getOrderDocumentCategories(db);
  const labelNormalized = label.toLocaleLowerCase();
  if (await categories.findOne({ labelNormalized })) {
    res.status(409).json({ error: "A document category with that name already exists." });
    return;
  }
  const now = new Date();
  const category = {
    _id: randomUUID(),
    label,
    labelNormalized,
    requiredModule: "order-hub",
    createdAt: now,
    updatedAt: now,
  };
  await categories.insertOne(category);
  res.status(201).json(CreateOrderDocumentCategoryResponse.parse(orderDocumentCategoryResponse(category)));
});

router.patch("/order-document-categories/:categoryId", async (req, res): Promise<void> => {
  const p = UpdateOrderDocumentCategoryParams.safeParse(req.params);
  const body = UpdateOrderDocumentCategoryBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const actor = await context(req, res, "order-hub", true);
  if (!actor) return;
  const label = normalizeDocumentCategoryName(body.data.name);
  if (!label) { res.status(400).json({ error: "Category name cannot be blank." }); return; }
  const db = await getMongoDb();
  const categories = getOrderDocumentCategories(db);
  const current = await categories.findOne({ _id: p.data.categoryId });
  if (!current) { res.status(404).json({ error: "Document category not found." }); return; }
  const labelNormalized = label.toLocaleLowerCase();
  if (await categories.findOne({ _id: { $ne: current._id }, labelNormalized })) {
    res.status(409).json({ error: "A document category with that name already exists." });
    return;
  }
  await categories.updateOne(
    { _id: current._id },
    { $set: { label, labelNormalized, updatedAt: new Date() } },
  );
  const updated = await categories.findOne({ _id: current._id });
  if (!updated) { res.status(404).json({ error: "Document category not found." }); return; }
  res.json(UpdateOrderDocumentCategoryResponse.parse(orderDocumentCategoryResponse(updated)));
});

router.delete("/order-document-categories/:categoryId", async (req, res): Promise<void> => {
  const p = DeleteOrderDocumentCategoryParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const actor = await context(req, res, "order-hub", true);
  if (!actor) return;
  const db = await getMongoDb();
  const categories = getOrderDocumentCategories(db);
  const category = await categories.findOne({ _id: p.data.categoryId });
  if (!category) { res.status(404).json({ error: "Document category not found." }); return; }
  if (await getOrderDocumentMetadata(db).countDocuments({ category: category._id })) {
    res.status(409).json({ error: "This category is assigned to documents and cannot be deleted." });
    return;
  }
  await categories.deleteOne({ _id: category._id });
  res.status(204).send();
});

router.get("/orders/:id/documents", async (req, res): Promise<void> => { const p = ListOrderDocumentsParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } const actor = await context(req, res); if (!actor || !(await orderExists(p.data.id, res))) return; const rows = await getOrderDocumentMetadata(await getMongoDb()).find({ orderRecordId: p.data.id, archivedAt: { $exists: false } }).sort({ uploadedAt: -1 }).toArray(); res.json(ListOrderDocumentsResponse.parse(rows.map(docResponse))); });
router.post("/orders/:id/documents/:category/:filename", async (req, res, next): Promise<void> => {
  const p = UploadOrderDocumentParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const db = await getMongoDb();
  const category = await getOrderDocumentCategories(db).findOne({ _id: p.data.category });
  if (!category) { res.status(400).json({ error: "Choose an active document category." }); return; }
  const actor = await context(req, res, category.requiredModule, true);
  if (!actor || !(await orderExists(p.data.id, res))) return;
  expressRaw(req, res, next, async () => {
    const body = req.body as Buffer;
    const declaredType = String(req.headers["content-type"] ?? "").split(";")[0];
    const ext = p.data.filename.toLowerCase().split(".").pop() ?? "";
    const type = mimeByExt[ext]?.[0];
    if (!body?.length || !type || (declaredType !== "application/octet-stream" && declaredType !== type)) {
      res.status(400).json({ error: "Unsupported document. Allowed files are PDF, PNG, JPEG, WebP, DOCX and XLSX up to 10 MiB." });
      return;
    }
    const storagePath = await storeProjectUpload("order-documents", p.data.filename, body);
    const meta = { _id: randomUUID(), orderRecordId: p.data.id, quotationRequestId: null, filename: p.data.filename, category: p.data.category as DocumentCategory, contentType: type, sizeBytes: body.length, gridFsId: null, storagePath, uploadedBy: actor.id, uploadedAt: new Date() };
    try {
      await getOrderDocumentMetadata(db).insertOne(meta);
    } catch (error) {
      await removeProjectUpload(storagePath).catch((cleanupError: unknown) => req.log.error({ err: cleanupError }, "Failed to clean up an orphaned project upload"));
      throw error;
    }
    await event(p.data.id, actor, "document.uploaded", `Uploaded ${meta.filename}.`);
    res.status(201).json(UploadOrderDocumentResponse.parse(docResponse(meta)));
  });
});
router.post("/orders/:id/quotation-requests/:quotationRequestId/confirmation-documents/:filename", async (req, res, next): Promise<void> => {
  const p = UploadQuotationConfirmationDocumentParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const db = await getMongoDb();
  const category = await getOrderDocumentCategories(db).findOne({ _id: "confirmation" });
  if (!category) {
    res.status(409).json({ error: "The confirmation document category is unavailable." });
    return;
  }
  const actor = await context(req, res, category.requiredModule, true);
  if (!actor || !(await orderExists(p.data.id, res))) return;
  const quotationRequest = await getQuotationRateSubmissions(db).findOne({
    _id: p.data.quotationRequestId,
    orderRecordId: p.data.id,
  });
  if (!quotationRequest) {
    res.status(404).json({ error: "The quotation request is not linked to this order." });
    return;
  }
  expressRaw(req, res, next, async () => {
    const body = req.body as Buffer;
    const declaredType = String(req.headers["content-type"] ?? "").split(";")[0];
    const ext = p.data.filename.toLowerCase().split(".").pop() ?? "";
    const type = mimeByExt[ext]?.[0];
    if (!body?.length || !type || (declaredType !== "application/octet-stream" && declaredType !== type)) {
      res.status(400).json({ error: "Unsupported document. Allowed files are PDF, PNG, JPEG, WebP, DOCX and XLSX up to 10 MiB." });
      return;
    }
    const storagePath = await storeProjectUpload("order-documents", p.data.filename, body);
    const meta = {
      _id: randomUUID(),
      orderRecordId: p.data.id,
      quotationRequestId: p.data.quotationRequestId,
      filename: p.data.filename,
      category: "confirmation",
      contentType: type,
      sizeBytes: body.length,
      gridFsId: null,
      storagePath,
      uploadedBy: actor.id,
      uploadedAt: new Date(),
    };
    try {
      await getOrderDocumentMetadata(db).insertOne(meta);
    } catch (error) {
      await removeProjectUpload(storagePath).catch((cleanupError: unknown) => req.log.error({ err: cleanupError }, "Failed to clean up an orphaned project upload"));
      throw error;
    }
    await event(p.data.id, actor, "document.uploaded", `Uploaded ${meta.filename} for quotation request ${meta.quotationRequestId}.`);
    res.status(201).json(UploadQuotationConfirmationDocumentResponse.parse(docResponse(meta)));
  });
});
router.delete("/orders/:id/documents/:documentId", async (req, res): Promise<void> => {
  const p = ArchiveOrderDocumentParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const actor = await context(req, res);
  if (!actor) return;
  const db = await getMongoDb();
  const meta = await getOrderDocumentMetadata(db).findOne({ _id: p.data.documentId, orderRecordId: p.data.id, archivedAt: { $exists: false } });
  if (!meta) { res.status(404).json({ error: "Document not found." }); return; }
  const category = await getOrderDocumentCategories(db).findOne({ _id: meta.category });
  if (!category) { res.status(409).json({ error: "The document category is no longer available." }); return; }
  if (!requireModuleEdit(actor, res, category.requiredModule)) return;
  if (meta.gridFsId && ObjectId.isValid(meta.gridFsId)) {
    const bucket = getOrderDocumentsBucket(db);
    const gridId = new ObjectId(meta.gridFsId);
    if (await bucket.find({ _id: gridId }).next()) await bucket.delete(gridId);
  }
  if (meta.storagePath) await removeProjectUpload(meta.storagePath);
  await getOrderDocumentMetadata(db).updateOne({ _id: meta._id }, { $set: { archivedAt: new Date(), removedBy: actor.id } });
  await event(p.data.id, actor, "document.removed", `Removed ${meta.filename}.`);
  res.status(204).send();
});
router.get("/orders/:id/documents/:documentId/content", async (req, res, next): Promise<void> => {
  const p = DownloadOrderDocumentParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const actor = await context(req, res);
  if (!actor) return;
  const db = await getMongoDb();
  const meta = await getOrderDocumentMetadata(db).findOne({ _id: p.data.documentId, orderRecordId: p.data.id, archivedAt: { $exists: false } });
  if (!meta) { res.status(404).json({ error: "Document not found." }); return; }
  const safeFilename = meta.filename.replace(/[\x00-\x1f\x7f"]/g, "_") || "order-document";
  res.setHeader("Content-Type", meta.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (meta.storagePath) {
    const filePath = resolveProjectUploadPath(meta.storagePath);
    if (!filePath) { res.status(404).json({ error: "Document content not found." }); return; }
    res.sendFile(filePath, { dotfiles: "deny" }, (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: "Document content not found." });
      else if (error) req.log.error({ err: error, storagePath: meta.storagePath }, "Failed to serve an order document upload");
    });
    return;
  }
  if (!meta.gridFsId || !ObjectId.isValid(meta.gridFsId)) { res.status(404).json({ error: "Document not found." }); return; }
  const gridId = new ObjectId(meta.gridFsId);
  const file = await getOrderDocumentsBucket(db).find({ _id: gridId }).next();
  if (!file) { res.status(404).json({ error: "Document content not found." }); return; }
  const stream = getOrderDocumentsBucket(db).openDownloadStream(gridId);
  stream.on("error", next);
  stream.pipe(res);
});
router.put("/orders/:id/documents/:documentId/content/:filename", async (req, res, next): Promise<void> => {
  const p = ReplaceOrderDocumentParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const actor = await context(req, res);
  if (!actor) return;
  const db = await getMongoDb();
  const documents = getOrderDocumentMetadata(db);
  const meta = await documents.findOne({
    _id: p.data.documentId,
    orderRecordId: p.data.id,
    archivedAt: { $exists: false },
  });
  if (!meta) { res.status(404).json({ error: "Document not found." }); return; }
  const category = await getOrderDocumentCategories(db).findOne({ _id: meta.category });
  if (!category) { res.status(409).json({ error: "The document category is no longer available." }); return; }
  if (!requireModuleEdit(actor, res, category.requiredModule)) return;

  expressRaw(req, res, next, async () => {
    const body = req.body as Buffer;
    const declaredType = String(req.headers["content-type"] ?? "").split(";")[0];
    const ext = p.data.filename.toLowerCase().split(".").pop() ?? "";
    const type = mimeByExt[ext]?.[0];
    if (!body?.length || !type || (declaredType !== "application/octet-stream" && declaredType !== type)) {
      res.status(400).json({ error: "Unsupported document. Allowed files are PDF, PNG, JPEG, WebP, DOCX and XLSX up to 10 MiB." });
      return;
    }

    const storagePath = await storeProjectUpload("order-documents", p.data.filename, body);
    const uploadedAt = new Date();
    let replaced;
    try {
      replaced = await documents.updateOne(
        {
          _id: meta._id,
          orderRecordId: p.data.id,
          archivedAt: { $exists: false },
          filename: meta.filename,
          uploadedAt: meta.uploadedAt,
          storagePath: meta.storagePath ?? null,
          gridFsId: meta.gridFsId ?? null,
        },
        {
          $set: {
            filename: p.data.filename,
            contentType: type,
            sizeBytes: body.length,
            storagePath,
            gridFsId: null,
            uploadedBy: actor.id,
            uploadedAt,
          },
        },
      );
    } catch (error) {
      await removeProjectUpload(storagePath).catch((cleanupError: unknown) => req.log.error({ err: cleanupError }, "Failed to clean up an orphaned replacement upload"));
      throw error;
    }

    if (replaced.modifiedCount !== 1) {
      await removeProjectUpload(storagePath).catch((cleanupError: unknown) => req.log.error({ err: cleanupError }, "Failed to clean up an unused replacement upload"));
      res.status(409).json({ error: "This document changed while the replacement was uploading. Refresh and try again." });
      return;
    }

    const updated = await documents.findOne({ _id: meta._id });
    if (!updated) { res.status(404).json({ error: "Replaced document could not be loaded." }); return; }
    if (meta.storagePath) {
      await removeProjectUpload(meta.storagePath).catch((error: unknown) => req.log.warn({ err: error, storagePath: meta.storagePath }, "Failed to remove replaced order document bytes"));
    }
    if (meta.gridFsId && ObjectId.isValid(meta.gridFsId)) {
      const bucket = getOrderDocumentsBucket(db);
      const gridId = new ObjectId(meta.gridFsId);
      try {
        if (await bucket.find({ _id: gridId }).next()) await bucket.delete(gridId);
      } catch (error) {
        req.log.warn({ err: error, gridFsId: meta.gridFsId }, "Failed to remove replaced legacy order document bytes");
      }
    }
    await event(p.data.id, actor, "document.replaced", `Replaced ${meta.filename} with ${updated.filename}.`);
    res.json(ReplaceOrderDocumentResponse.parse(docResponse(updated)));
  });
});
router.get("/orders/:id/activity", async (req, res): Promise<void> => { const p = ListOrderActivityParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } const actor = await context(req, res); if (!actor || !(await orderExists(p.data.id, res))) return; const rows = await getOrderActivity(await getMongoDb()).find({ orderRecordId: p.data.id }).sort({ createdAt: -1 }).toArray(); res.json(ListOrderActivityResponse.parse(rows.map(activityResponse))); });

function expressRaw(req: any, res: any, next: (error?: unknown) => void, done: () => Promise<void>) {
  const run = () => { void Promise.resolve().then(done).catch(next); };
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > MAX_FILE) { res.status(413).json({ error: MAX_FILE_MESSAGE }); return; }
    run();
    return;
  }
  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE) {
    res.status(413).json({ error: MAX_FILE_MESSAGE });
    req.resume();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  req.on("data", (chunk: Buffer) => {
    if (tooLarge) return;
    if (size + chunk.length > MAX_FILE) {
      tooLarge = true;
      chunks.length = 0;
      if (!res.headersSent) res.status(413).json({ error: MAX_FILE_MESSAGE });
      return;
    }
    size += chunk.length;
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (tooLarge) return;
    req.body = Buffer.concat(chunks, size);
    run();
  });
  req.on("aborted", () => next(new Error("Document upload was interrupted.")));
  req.on("error", (error: unknown) => next(error));
}
export default router;