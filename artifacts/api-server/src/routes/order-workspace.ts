import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { Router as ExpressRouter, type RequestHandler } from "express";
import {
  ArchiveOrderDocumentParams, ArchiveOrderWindowParams,
  CreateOrderDocumentCategoryBody, CreateOrderDocumentCategoryResponse,
  CreateOrderWindowBody, CreateOrderWindowParams, CreateOrderWindowResponse, DownloadOrderDocumentParams,
  DeleteOrderDocumentCategoryParams,
  GetGlassTrackingResponse,
  GetPaymentOverviewResponse,
  ListOrderDocumentCategoriesResponse,
  ListOrderActivityParams, ListOrderActivityResponse, ListOrderDocumentsParams, ListOrderDocumentsResponse,
  ListOrderPaymentsParams, ListOrderPaymentsResponse, ListOrderWindowsParams, ListOrderWindowsResponse,
  OpenPaymentReminderParams,
  RecordOrderPaymentBody, RecordOrderPaymentParams, RecordOrderPaymentResponse, UpdateOrderWindowBody,
  ReplaceOrderDocumentParams, ReplaceOrderDocumentResponse,
  UpdateOrderDocumentCategoryBody, UpdateOrderDocumentCategoryParams, UpdateOrderDocumentCategoryResponse,
  UpdateOrderWindowParams, UpdateOrderWindowResponse, VoidOrderPaymentBody, VoidOrderPaymentParams, VoidOrderPaymentResponse,
  UploadOrderDocumentParams, UploadOrderDocumentResponse,
} from "@workspace/api-zod";
import {
  getMongoDb, getOrderActivity, getOrderDocumentCategories, getOrderDocumentMetadata, getOrderDocumentsBucket, getOrderPayments,
  getOrders, getOrderWindows, getPublicUser, getUsers, type DocumentCategory, type OrderWindowDocument,
} from "../lib/mongo";
import {
  ensureDefaultOrderDocumentCategories,
  normalizeDocumentCategoryName,
  orderDocumentCategoryResponse,
} from "../lib/order-document-categories";
import {
  removeProjectUpload,
  resolveProjectUploadPath,
  storeProjectUpload,
} from "../lib/project-upload-storage";

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
const paymentResponse = (p: any) => ({ ...p, id: p._id, paidAt: p.paidAt.toISOString(), createdAt: p.createdAt.toISOString() });
const docResponse = (d: any) => ({ id: d._id, orderRecordId: d.orderRecordId, filename: d.filename, category: d.category, contentType: d.contentType, sizeBytes: d.sizeBytes, uploadedBy: d.uploadedBy, uploadedAt: d.uploadedAt.toISOString() });
const activityResponse = (a: any) => ({ ...a, id: a._id, createdAt: a.createdAt.toISOString() });
const gridFsOptions = (contentType: string, orderRecordId: string, category: string) => ({ contentType, metadata: { orderRecordId, category } });
const toWhatsAppNumber = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  const normalized = digits.length === 10 ? `91${digits}` : digits;
  return normalized.length >= 8 && normalized.length <= 15 ? normalized : null;
};
const formatReminderAmount = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);

router.get("/glass-tracking", async (req, res): Promise<void> => {
  if (!(await context(req, res, "glass-procurement"))) return;
  const db = await getMongoDb();
  const [orders, windows] = await Promise.all([
    getOrders(db).find({}).toArray(),
    getOrderWindows(db).find({ archivedAt: { $exists: false } }).toArray(),
  ]);
  const ordersById = new Map(orders.map((order) => [order._id, order]));
  const trackingRows = windows.flatMap((window) => {
    const order = ordersById.get(window.orderRecordId);
    if (!order) return [];
    return [{
      windowId: window._id,
      orderRecordId: order._id,
      orderId: order.orderId,
      orderStatus: order.status,
      clientName: order.clientName,
      locationCode: order.locationCode,
      locationName: order.locationName,
      windowNo: window.windowNo,
      windowType: window.windowType,
      widthMm: window.widthMm,
      heightMm: window.heightMm,
      sqFt: window.sqFt,
      glassStatus: window.glassStatus,
      updatedAt: window.updatedAt.toISOString(),
    }];
  }).sort((a, b) => a.orderId.localeCompare(b.orderId) || a.windowNo.localeCompare(b.windowNo));
  res.json(GetGlassTrackingResponse.parse(trackingRows));
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

router.get("/orders/:id/payments", async (req, res): Promise<void> => { const p = ListOrderPaymentsParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } const actor = await context(req, res, "payments"); if (!actor || !(await orderExists(p.data.id, res))) return; const rows = await getOrderPayments(await getMongoDb()).find({ orderRecordId: p.data.id }).sort({ createdAt: -1 }).toArray(); res.json(ListOrderPaymentsResponse.parse(rows.map(paymentResponse))); });
router.post("/orders/:id/payments", async (req, res): Promise<void> => { const p = RecordOrderPaymentParams.safeParse(req.params), b = RecordOrderPaymentBody.safeParse(req.body); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } if (!b.success) { res.status(400).json({ error: b.error.message }); return; } const actor = await context(req, res, "payments", true); const order = actor ? await orderExists(p.data.id, res) : null; if (!actor || !order) return; const db = await getMongoDb(); const total = await getOrderPayments(db).aggregate([{ $match: { orderRecordId: p.data.id, status: "received" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).toArray(); if (order.orderValue != null && Number(total[0]?.total ?? 0) + b.data.amount > order.orderValue) { res.status(400).json({ error: "Payment exceeds the remaining order balance." }); return; } const paidAt = new Date(b.data.paidAt); if (Number.isNaN(paidAt.getTime())) { res.status(400).json({ error: "Invalid payment date." }); return; } const payment = { _id: randomUUID(), orderRecordId: p.data.id, amount: b.data.amount, method: b.data.method, reference: b.data.reference ?? null, notes: b.data.notes ?? null, paidAt, status: "received" as const, voidReason: null, createdBy: actor.id, createdAt: new Date() }; await getOrderPayments(db).insertOne(payment); await event(p.data.id, actor, "payment.recorded", `Recorded payment of ${payment.amount}.`); res.status(201).json(RecordOrderPaymentResponse.parse(paymentResponse(payment))); });
router.patch("/orders/:id/payments/:paymentId", async (req, res): Promise<void> => { const p = VoidOrderPaymentParams.safeParse(req.params), b = VoidOrderPaymentBody.safeParse(req.body); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } if (!b.success) { res.status(400).json({ error: b.error.message }); return; } const actor = await context(req, res, "payments", true); if (!actor || !(await orderExists(p.data.id, res))) return; const db = await getMongoDb(); const old = await getOrderPayments(db).findOne({ _id: p.data.paymentId, orderRecordId: p.data.id }); if (!old) { res.status(404).json({ error: "Payment not found." }); return; } if (old.status === "void") { res.status(400).json({ error: "Payment is already void." }); return; } await getOrderPayments(db).updateOne({ _id: old._id }, { $set: { status: "void", voidReason: b.data.voidReason, voidedBy: actor.id, voidedAt: new Date() } }); const updated = await getOrderPayments(db).findOne({ _id: old._id }); await event(p.data.id, actor, "payment.voided", `Voided payment of ${old.amount}.`); res.json(VoidOrderPaymentResponse.parse(paymentResponse(updated))); });

router.get("/payments/overview", async (req, res): Promise<void> => {
  const actor = await context(req, res, "payments");
  if (!actor) return;
  const db = await getMongoDb();
  const [orders, paymentTotals, recentPayments] = await Promise.all([
    getOrders(db).find({}).toArray(),
    getOrderPayments(db).aggregate<{ _id: string; total: number }>([
      { $match: { status: "received" } },
      { $group: { _id: "$orderRecordId", total: { $sum: "$amount" } } },
    ]).toArray(),
    getOrderPayments(db).find({ status: "received" }).sort({ createdAt: -1, _id: -1 }).limit(12).toArray(),
  ]);
  const orderById = new Map(orders.map((order) => [order._id, order]));
  const collectedByOrder = new Map(paymentTotals.map((row) => [row._id, Number(row.total) || 0]));
  const totalCollected = paymentTotals.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
  const totalOutstanding = orders.reduce((sum, order) => {
    if (order.orderValue == null) return sum;
    return sum + Math.max(0, order.orderValue - (collectedByOrder.get(order._id) ?? 0));
  }, 0);
  const outstandingOrders = orders.filter((order) => order.orderValue != null
    && order.orderValue - (collectedByOrder.get(order._id) ?? 0) > 0);
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
    const collected = collectedByOrder.get(order._id) ?? 0;
    const balance = order.orderValue! - collected;
    const productionReady = windows.length > 0 && windows.every((window) => window.frameStatus === "ready"
      && window.shutterStatus === "ready" && window.glassStatus === "received");
    return {
      orderRecordId: order._id,
      orderId: order.orderId,
      orderStatus: order.status,
      clientName: order.clientName,
      locationName: order.locationName,
      orderValue: order.orderValue!,
      totalCollected: collected,
      balance,
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
  const paymentTotal = await getOrderPayments(db).aggregate<{ total: number }>([
    { $match: { orderRecordId: order._id, status: "received" } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]).toArray();
  const balance = order.orderValue - Number(paymentTotal[0]?.total ?? 0);
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
  await ensureDefaultOrderDocumentCategories(db);
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
  await ensureDefaultOrderDocumentCategories(db);
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
  await ensureDefaultOrderDocumentCategories(db);
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
  await ensureDefaultOrderDocumentCategories(db);
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
  await ensureDefaultOrderDocumentCategories(db);
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
    const meta = { _id: randomUUID(), orderRecordId: p.data.id, filename: p.data.filename, category: p.data.category as DocumentCategory, contentType: type, sizeBytes: body.length, gridFsId: null, storagePath, uploadedBy: actor.id, uploadedAt: new Date() };
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
router.delete("/orders/:id/documents/:documentId", async (req, res): Promise<void> => {
  const p = ArchiveOrderDocumentParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const actor = await context(req, res);
  if (!actor) return;
  const db = await getMongoDb();
  const meta = await getOrderDocumentMetadata(db).findOne({ _id: p.data.documentId, orderRecordId: p.data.id, archivedAt: { $exists: false } });
  if (!meta) { res.status(404).json({ error: "Document not found." }); return; }
  await ensureDefaultOrderDocumentCategories(db);
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
  await ensureDefaultOrderDocumentCategories(db);
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