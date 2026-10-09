import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Router, type Request, type Response } from "express";
import type { Db } from "mongodb";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import {
  CancelDispatchRecordBody,
  CancelDispatchRecordParams,
  CancelDispatchRecordResponse,
  CreateDispatchRecordBody,
  CreateDispatchRecordResponse,
  GetDispatchByTokenParams,
  GetDispatchByTokenResponse,
  GetDispatchChallanPdfParams,
  GetDispatchQrPngParams,
  GetDispatchRecordParams,
  GetDispatchRecordResponse,
  GetDispatchSummaryResponse,
  ListDispatchRecordsQueryParams,
  ListDispatchRecordsResponse,
  UpdateDispatchRecordBody,
  UpdateDispatchRecordParams,
  UpdateDispatchRecordResponse,
} from "@workspace/api-zod";
import {
  getActivityEvents,
  getDispatchLocks,
  getDispatchRecords,
  getMongoDb,
  getOrderActivity,
  getOrderDocumentMetadata,
  getOrders,
  getPublicUser,
  getUsers,
  type ActivityEventDocument,
  type DispatchRecordDocument,
  type DispatchRecordStatus,
  type OrderDocument,
} from "../lib/mongo";
import {
  checkLotReadiness,
  getLotWindows,
  refreshOrderDispatchSummary,
  summarizeOrderDispatches,
  toDispatchWindowSnapshot,
} from "../lib/dispatch-domain";
import {
  formatDispatchCode,
  formatLegacyLotId,
  formatLotId,
  normalizeLotCodeAlias,
} from "../lib/order-identifiers";
import {
  resolveProjectUploadPath,
  storeProjectUpload,
} from "../lib/project-upload-storage";

const router = Router();
const LOCK_WAIT_MS = 10_000;
const LOCK_LEASE_MS = 120_000;
const SHARE_ROUTE = "/dispatch/share/";

type DispatchActor = {
  id: string;
  name: string;
  masterAdmin: boolean;
  permissions: Record<string, string>;
};
type PermissionAction = "view" | "create" | "edit" | "cancel" | "override";

function hasPermission(actor: DispatchActor, action: PermissionAction): boolean {
  if (actor.masterAdmin) return true;
  const direct = actor.permissions[`dispatch.${action}`] ?? "none";
  if (action === "override") return direct === "edit";
  if (action === "view") {
    return direct === "view"
      || direct === "edit"
      || actor.permissions.dispatch === "view"
      || actor.permissions.dispatch === "edit";
  }
  return direct === "edit" || actor.permissions.dispatch === "edit";
}

async function authorize(
  req: Request,
  res: Response,
  action: PermissionAction,
): Promise<DispatchActor | null> {
  const db = await getMongoDb();
  const userId = req.session.userId;
  const user = userId
    ? await getUsers(db).findOne({ _id: userId, status: "active" })
    : null;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return null;
  }
  const publicUser = await getPublicUser(user, db);
  const actor: DispatchActor = {
    id: user._id,
    name: user.name,
    masterAdmin: publicUser.roleId === "master-admin",
    permissions: publicUser.permissions,
  };
  if (!hasPermission(actor, action)) {
    res.status(403).json({ error: `Dispatch ${action} access is required.` });
    return null;
  }
  return actor;
}

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

function dispatchResponse(dispatch: DispatchRecordDocument) {
  return {
    id: dispatch._id,
    orderRecordId: dispatch.orderRecordId,
    orderId: dispatch.orderId,
    clientName: dispatch.clientName,
    lotRecordId: dispatch.lotRecordId,
    lotId: dispatch.lotId,
    lotSequence: dispatch.lotSequence,
    dispatchNo: dispatch.dispatchNo,
    dispatchCode: dispatch.dispatchCode,
    legacyDispatchCodes: dispatch.legacyDispatchCodes ?? [],
    legacyLotIds: dispatch.legacyLotIds ?? [],
    dispatchNote: dispatch.dispatchNote ?? null,
    status: dispatch.status,
    plannedAt: iso(dispatch.plannedAt),
    dispatchedAt: iso(dispatch.dispatchedAt),
    deliveredAt: iso(dispatch.deliveredAt),
    returnedAt: iso(dispatch.returnedAt),
    locationName: dispatch.locationName,
    siteAddress: dispatch.siteAddress ?? null,
    siteLatitude: dispatch.siteLatitude ?? null,
    siteLongitude: dispatch.siteLongitude ?? null,
    vehicleNumber: dispatch.vehicleNumber ?? null,
    driverName: dispatch.driverName ?? null,
    driverPhone: dispatch.driverPhone ?? null,
    challanNumber: dispatch.challanNumber ?? null,
    windowsSnapshot: dispatch.windowsSnapshot,
    qrRevokedAt: iso(dispatch.qrRevokedAt),
    overrideReason: dispatch.overrideReason ?? null,
    createdBy: dispatch.createdBy,
    createdAt: dispatch.createdAt.toISOString(),
    updatedBy: dispatch.updatedBy,
    updatedAt: dispatch.updatedAt.toISOString(),
    cancelledBy: dispatch.cancelledBy ?? null,
    cancelledAt: iso(dispatch.cancelledAt),
    cancelReason: dispatch.cancelReason ?? null,
  };
}

async function sharedResponse(db: Db, dispatch: DispatchRecordDocument) {
  const events = await getActivityEvents(db)
    .find({ entityType: "dispatch", dispatchId: dispatch._id })
    .sort({ createdAt: 1 })
    .toArray();
  return {
    id: dispatch._id,
    orderRecordId: dispatch.orderRecordId,
    dispatchCode: dispatch.dispatchCode,
    orderId: dispatch.orderId,
    clientName: dispatch.clientName,
    lotId: dispatch.lotId,
    status: dispatch.status,
    plannedAt: iso(dispatch.plannedAt),
    dispatchedAt: iso(dispatch.dispatchedAt),
    deliveredAt: iso(dispatch.deliveredAt),
    returnedAt: iso(dispatch.returnedAt),
    createdAt: dispatch.createdAt.toISOString(),
    dispatchNote: dispatch.dispatchNote ?? null,
    statusHistory: events.map((event) => ({
      id: event._id,
      eventType: event.eventType,
      message: event.message,
      actorName: event.actorName,
      createdAt: event.createdAt.toISOString(),
    })),
    locationName: dispatch.locationName,
    siteAddress: dispatch.siteAddress ?? null,
    siteLatitude: dispatch.siteLatitude ?? null,
    siteLongitude: dispatch.siteLongitude ?? null,
    vehicleNumber: dispatch.vehicleNumber ?? null,
    driverName: dispatch.driverName ?? null,
    driverPhone: dispatch.driverPhone ?? null,
    challanNumber: dispatch.challanNumber ?? null,
    windowsSnapshot: dispatch.windowsSnapshot,
  };
}

function orderSummaryResponse(order: OrderDocument, dispatches: DispatchRecordDocument[]) {
  return {
    orderRecordId: order._id,
    orderId: order.orderId,
    clientName: order.clientName,
    ...summarizeOrderDispatches(order, dispatches),
  };
}

function statusCounts(records: DispatchRecordDocument[]) {
  const counts = {
    total: records.length,
    planned: 0,
    dispatched: 0,
    delivered: 0,
    returned: 0,
    cancelled: 0,
  };
  for (const record of records) counts[record.status] += 1;
  return counts;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textOrNull(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function requestDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function recordEvent(
  db: Db,
  dispatch: DispatchRecordDocument,
  actor: DispatchActor,
  action: string,
  message: string,
  metadata: Record<string, unknown> = {},
  createdAt = new Date(),
): Promise<void> {
  const activityId = randomUUID();
  await getOrderActivity(db).insertOne({
    _id: activityId,
    orderRecordId: dispatch.orderRecordId,
    dispatchId: dispatch._id,
    actorId: actor.id,
    actorName: actor.name,
    action,
    summary: message,
    createdAt,
  });
  const event: ActivityEventDocument = {
    _id: activityId,
    entityType: "dispatch",
    orderRecordId: dispatch.orderRecordId,
    dispatchId: dispatch._id,
    eventType: action,
    actorId: actor.id,
    actorName: actor.name,
    message,
    metadata,
    createdAt,
  };
  await getActivityEvents(db).insertOne(event);
}

class DispatchLockBusyError extends Error {}

async function withLotDispatchLock<T>(
  db: Db,
  lotRecordId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const locks = getDispatchLocks(db);
  const ownerToken = randomUUID();
  const stopAt = Date.now() + LOCK_WAIT_MS;
  let acquired = false;

  while (Date.now() < stopAt) {
    const now = new Date();
    try {
      await locks.findOneAndUpdate(
        {
          _id: lotRecordId,
          $or: [{ leaseUntil: { $lte: now } }, { ownerToken }],
        },
        {
          $set: {
            ownerToken,
            leaseUntil: new Date(now.getTime() + LOCK_LEASE_MS),
          },
        },
        { upsert: true, returnDocument: "after" },
      );
    } catch (error) {
      if ((error as { code?: number })?.code !== 11000) throw error;
    }
    acquired = Boolean(await locks.findOne({ _id: lotRecordId, ownerToken }));
    if (acquired) break;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  if (!acquired) {
    throw new DispatchLockBusyError("A dispatch number is being allocated for this lot. Try again shortly.");
  }

  try {
    return await operation();
  } finally {
    await locks.deleteOne({ _id: lotRecordId, ownerToken });
  }
}

async function requireOverride(
  actor: DispatchActor,
  res: Response,
  reason: string | null,
): Promise<boolean> {
  if (!hasPermission(actor, "override")) {
    res.status(403).json({ error: "Dispatch override access is required when a lot is not ready." });
    return false;
  }
  if (!reason?.trim()) {
    res.status(400).json({ error: "Enter a reason for dispatching a lot that is not fully ready." });
    return false;
  }
  return true;
}

async function shareUrl(req: Request, token: string): Promise<string> {
  const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "")
    .split(",")[0]
    .trim();
  const forwardedProtocol = (req.get("x-forwarded-proto") ?? req.protocol)
    .split(",")[0]
    .trim();
  const protocol = forwardedProtocol === "http" ? "http" : "https";
  if (!host || /[\r\n]/.test(host)) {
    throw new Error("Could not determine the host for the dispatch QR link.");
  }
  return `${protocol}://${host}${SHARE_ROUTE}${encodeURIComponent(token)}`;
}

function dispatchContentHash(dispatch: DispatchRecordDocument): string {
  const hashSource = JSON.stringify({
    dispatchCode: dispatch.dispatchCode,
    orderId: dispatch.orderId,
    clientName: dispatch.clientName,
    lotId: dispatch.lotId,
    status: dispatch.status,
    plannedAt: dispatch.plannedAt,
    dispatchedAt: dispatch.dispatchedAt,
    deliveredAt: dispatch.deliveredAt,
    dispatchNote: dispatch.dispatchNote,
    locationName: dispatch.locationName,
    siteAddress: dispatch.siteAddress,
    vehicleNumber: dispatch.vehicleNumber,
    driverName: dispatch.driverName,
    driverPhone: dispatch.driverPhone,
    challanNumber: dispatch.challanNumber,
    windowsSnapshot: dispatch.windowsSnapshot,
  });
  return createHash("sha256").update(hashSource).digest("hex");
}

async function renderChallan(
  dispatch: DispatchRecordDocument,
  qrLink: string,
): Promise<Buffer> {
  const qrPng = await QRCode.toBuffer(qrLink, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 5,
  });
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 44 });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer | Uint8Array) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    document.font("Helvetica-Bold").fontSize(19).text("FRAMEWISE");
    document.font("Helvetica").fontSize(9).fillColor("#52606b")
      .text("ORDER OPERATIONS · DISPATCH CHALLAN");
    document.moveDown(1.2);
    document.fillColor("#152c35").font("Helvetica-Bold").fontSize(16)
      .text(dispatch.dispatchCode, { width: 350 });
    document.font("Helvetica").fontSize(9).fillColor("#40515a")
      .text(`Status: ${dispatch.status.toUpperCase()}`);
    document.image(qrPng, 430, 48, { fit: [105, 105] });
    document.moveDown(1);

    const detailRows = [
      ["Order", dispatch.orderId],
      ["Client", dispatch.clientName],
      ["Lot", dispatch.lotId],
      ["Location", dispatch.locationName],
      ["Site address", dispatch.siteAddress ?? "Not recorded"],
      ["Planned", dispatch.plannedAt?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) ?? "Not scheduled"],
      ["Vehicle", dispatch.vehicleNumber ?? "Not recorded"],
      ["Driver", dispatch.driverName ?? "Not recorded"],
      ["Driver phone", dispatch.driverPhone ?? "Not recorded"],
      ["Challan no.", dispatch.challanNumber ?? "Not recorded"],
      ["Dispatch note", dispatch.dispatchNote ?? "—"],
    ];
    for (const [label, value] of detailRows) {
      document.font("Helvetica-Bold").fontSize(9).fillColor("#183c43").text(`${label}: `, { continued: true });
      document.font("Helvetica").fillColor("#263840").text(value);
    }

    document.moveDown(1);
    document.font("Helvetica-Bold").fontSize(11).fillColor("#183c43")
      .text("Windows included in this whole-lot dispatch");
    document.moveDown(0.4);
    if (!dispatch.windowsSnapshot.length) {
      document.font("Helvetica").fontSize(9).fillColor("#40515a")
        .text("No active windows were recorded in the dispatch snapshot.");
    } else {
      document.font("Helvetica-Bold").fontSize(8).fillColor("#20353c")
        .text("Window · Dimensions · Type · Area · Frame / Shutter / Glass");
      document.moveDown(0.25);
      for (const window of dispatch.windowsSnapshot) {
        const line = [
          window.windowNo,
          `${window.widthMm} × ${window.heightMm} mm`,
          window.windowType,
          `${window.sqFt.toFixed(2)} sq ft`,
          `${window.frameStatus} / ${window.shutterStatus} / ${window.glassStatus}`,
        ].join(" · ");
        document.font("Helvetica").fontSize(8).fillColor("#263840")
          .text(line, { width: 500 });
      }
    }
    document.moveDown(1.2);
    document.font("Helvetica").fontSize(8).fillColor("#697780")
      .text("This challan is generated from the saved dispatch record. Scan the QR code to view protected dispatch details.");
    document.end();
  });
}

function assertStatusTransition(
  current: DispatchRecordStatus,
  next: DispatchRecordStatus,
): boolean {
  if (current === next) return true;
  if (current === "planned") return next === "dispatched";
  if (current === "dispatched") return next === "delivered" || next === "returned";
  if (current === "delivered") return next === "returned";
  return false;
}

router.get("/dispatches", async (req, res): Promise<void> => {
  const actor = await authorize(req, res, "view");
  if (!actor) return;
  const parsed = ListDispatchRecordsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filter: Record<string, unknown> = {};
  if (parsed.data.orderRecordId) filter.orderRecordId = parsed.data.orderRecordId;
  if (parsed.data.status) filter.status = parsed.data.status;
  const search = parsed.data.q?.trim();
  if (search) {
    const matcher = new RegExp(escapeRegex(search), "i");
    const normalizedMatcher = new RegExp(escapeRegex(normalizeLotCodeAlias(search)), "i");
    filter.$or = [
      { dispatchCode: matcher },
      { dispatchCode: normalizedMatcher },
      { legacyDispatchCodes: matcher },
      { orderId: matcher },
      { clientName: matcher },
      { locationName: matcher },
      { lotId: matcher },
      { legacyLotIds: matcher },
    ];
  }

  const db = await getMongoDb();
  const records = await getDispatchRecords(db)
    .find(filter)
    .sort({ createdAt: -1, dispatchNo: -1 })
    .toArray();
  const orderIds = [...new Set(records.map((record) => record.orderRecordId))];
  const [orders, allRelatedDispatches] = orderIds.length
    ? await Promise.all([
        getOrders(db).find({ _id: { $in: orderIds } }).toArray(),
        getDispatchRecords(db).find({ orderRecordId: { $in: orderIds } }).toArray(),
      ])
    : [[], []];
  const byOrderDispatches = new Map<string, DispatchRecordDocument[]>();
  for (const record of allRelatedDispatches) {
    const rows = byOrderDispatches.get(record.orderRecordId) ?? [];
    rows.push(record);
    byOrderDispatches.set(record.orderRecordId, rows);
  }
  const response = {
    records: records.map(dispatchResponse),
    orderSummaries: orders.map((order) =>
      orderSummaryResponse(order, byOrderDispatches.get(order._id) ?? [])),
    statusCounts: statusCounts(records),
  };
  res.json(ListDispatchRecordsResponse.parse(response));
});

router.get("/dispatches/summary", async (req, res): Promise<void> => {
  const actor = await authorize(req, res, "view");
  if (!actor) return;
  const db = await getMongoDb();
  const [orders, records] = await Promise.all([
    getOrders(db).find({ isActive: { $ne: false } }).sort({ createdAt: -1 }).toArray(),
    getDispatchRecords(db).find({}).toArray(),
  ]);
  const byOrder = new Map<string, DispatchRecordDocument[]>();
  for (const record of records) {
    const rows = byOrder.get(record.orderRecordId) ?? [];
    rows.push(record);
    byOrder.set(record.orderRecordId, rows);
  }
  const lotsWithActiveDispatch = new Set(records.map((record) => record.lotRecordId));
  const readyLotsAwaitingDispatch = [];
  for (const order of orders) {
    if (order.status === "installed") continue;
    for (const lot of order.lots ?? []) {
      if (lotsWithActiveDispatch.has(lot._id)) continue;
      const windows = await getLotWindows(db, order, lot);
      if (!checkLotReadiness(windows).ready) continue;
      readyLotsAwaitingDispatch.push({
        orderRecordId: order._id,
        orderId: order.orderId,
        clientName: order.clientName,
        lotRecordId: lot._id,
        lotId: lot.lotId,
        locationName: order.locationName,
        windowsCount: windows.length,
      });
    }
  }
  res.json(GetDispatchSummaryResponse.parse({
    orders: orders.map((order) => orderSummaryResponse(order, byOrder.get(order._id) ?? [])),
    readyLotsAwaitingDispatch,
    statusCounts: statusCounts(records),
  }));
});

router.post("/dispatches", async (req, res): Promise<void> => {
  const actor = await authorize(req, res, "create");
  if (!actor) return;
  const parsed = CreateDispatchRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if ((parsed.data.siteLatitude == null) !== (parsed.data.siteLongitude == null)) {
    res.status(400).json({ error: "Choose both map coordinates or clear the selected pin." });
    return;
  }
  const db = await getMongoDb();
  const order = await getOrders(db).findOne({ _id: parsed.data.orderRecordId });
  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  const lot = (order.lots ?? []).find((item) => item._id === parsed.data.lotRecordId);
  if (!lot) {
    res.status(404).json({ error: "Lot not found on this order." });
    return;
  }
  const initialLatitude = parsed.data.siteLatitude === undefined
    ? order.siteLatitude ?? null
    : parsed.data.siteLatitude;
  const initialLongitude = parsed.data.siteLongitude === undefined
    ? order.siteLongitude ?? null
    : parsed.data.siteLongitude;
  if ((initialLatitude === null) !== (initialLongitude === null)) {
    res.status(409).json({ error: "The order's saved map pin is incomplete. Update the order location before dispatch." });
    return;
  }
  const windows = await getLotWindows(db, order, lot);
  const readiness = checkLotReadiness(windows);
  const overrideReason = textOrNull(parsed.data.overrideReason);
  if (!readiness.ready && !(await requireOverride(actor, res, overrideReason))) return;

  const now = new Date();
  const plannedAt = requestDate(parsed.data.plannedAt);
  let created: DispatchRecordDocument;
  try {
    created = await withLotDispatchLock(db, lot._id, async () => {
      const currentOrder = await getOrders(db).findOne({ _id: order._id });
      const currentLot = currentOrder?.lots?.find((item) => item._id === lot._id);
      if (!currentOrder || !currentLot) {
        throw new Error("The order or lot was removed while the dispatch was being created.");
      }
      const latestWindows = await getLotWindows(db, currentOrder, currentLot);
      const latestReadiness = checkLotReadiness(latestWindows);
      if (!latestReadiness.ready && !(await requireOverride(actor, res, overrideReason))) {
        throw new Error("Dispatch readiness override was not authorized.");
      }

      const latest = await getDispatchRecords(db)
        .find({ lotRecordId: currentLot._id })
        .sort({ dispatchNo: -1 })
        .limit(1)
        .next();
      const dispatchNo = (latest?.dispatchNo ?? 0) + 1;
      const currentLotId = formatLotId(currentOrder.orderId, currentLot.sequence);
      const currentDispatchCode = formatDispatchCode(
        currentOrder.orderId,
        currentLot.sequence,
        dispatchNo,
      );
      const legacyLotId = currentLot.lotId !== currentLotId
        ? currentLot.lotId
        : formatLegacyLotId(currentOrder.orderId, currentLot.sequence);
      const legacyDispatchCode = `${legacyLotId}-D${dispatchNo}`;
      const siteLatitude = parsed.data.siteLatitude === undefined
        ? currentOrder.siteLatitude ?? null
        : parsed.data.siteLatitude;
      const siteLongitude = parsed.data.siteLongitude === undefined
        ? currentOrder.siteLongitude ?? null
        : parsed.data.siteLongitude;
      if ((siteLatitude === null) !== (siteLongitude === null)) {
        throw new Error("The order's saved map pin is incomplete. Update the order location before dispatch.");
      }
      const record: DispatchRecordDocument = {
        _id: randomUUID(),
        orderRecordId: currentOrder._id,
        orderId: currentOrder.orderId,
        clientName: currentOrder.clientName,
        lotRecordId: currentLot._id,
        lotId: currentLotId,
        lotSequence: currentLot.sequence,
        legacyLotIds: legacyLotId === currentLotId ? [] : [legacyLotId],
        legacyDispatchCodes: legacyDispatchCode === currentDispatchCode ? [] : [legacyDispatchCode],
        dispatchNo,
        dispatchCode: currentDispatchCode,
        dispatchNote: textOrNull(parsed.data.dispatchNote),
        status: "planned",
        plannedAt,
        dispatchedAt: null,
        deliveredAt: null,
        returnedAt: null,
        locationName: parsed.data.locationName?.trim() || currentOrder.locationName,
        siteAddress: parsed.data.siteAddress === undefined
          ? currentOrder.siteAddress ?? null
          : textOrNull(parsed.data.siteAddress),
        siteLatitude,
        siteLongitude,
        vehicleNumber: textOrNull(parsed.data.vehicleNumber),
        driverName: textOrNull(parsed.data.driverName),
        driverPhone: textOrNull(parsed.data.driverPhone),
        challanNumber: textOrNull(parsed.data.challanNumber),
        windowsSnapshot: toDispatchWindowSnapshot(latestWindows),
        qrToken: randomUUID(),
        qrRevokedAt: null,
        overrideReason: latestReadiness.ready ? null : overrideReason,
        createdBy: actor.id,
        createdAt: now,
        updatedBy: actor.id,
        updatedAt: now,
        cancelledBy: null,
        cancelledAt: null,
        cancelReason: null,
      };
      await getDispatchRecords(db).insertOne(record);
      return record;
    });
  } catch (error) {
    if (error instanceof DispatchLockBusyError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if ((error as { code?: number })?.code === 11000) {
      res.status(409).json({ error: "A dispatch number was allocated concurrently. Refresh and try again." });
      return;
    }
    if (error instanceof Error && error.message === "Dispatch readiness override was not authorized.") {
      return;
    }
    if (error instanceof Error && error.message === "The order's saved map pin is incomplete. Update the order location before dispatch.") {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
  const refreshed = await refreshOrderDispatchSummary(db, created.orderRecordId, actor.id, now);
  await recordEvent(db, created, actor, "dispatch.created", `Created dispatch ${created.dispatchCode}.`, {
    lotRecordId: created.lotRecordId,
    dispatchNo: created.dispatchNo,
    windowsCount: created.windowsSnapshot.length,
    readinessOverride: Boolean(created.overrideReason),
  }, now);
  res.status(201).json(CreateDispatchRecordResponse.parse(dispatchResponse(refreshed
    ? { ...created, orderId: refreshed.order.orderId }
    : created)));
});

router.get("/dispatches/by-token/:token", async (req, res): Promise<void> => {
  const actor = await authorize(req, res, "view");
  if (!actor) return;
  const parsed = GetDispatchByTokenParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const db = await getMongoDb();
  const dispatch = await getDispatchRecords(db).findOne({ qrToken: parsed.data.token });
  if (!dispatch) {
    res.status(404).json({ error: "This dispatch QR is invalid." });
    return;
  }
  if (dispatch.status === "cancelled" || dispatch.qrRevokedAt) {
    res.status(410).json({
      error: dispatch.status === "cancelled"
        ? "This dispatch was cancelled and its QR has been revoked."
        : "This dispatch QR has been revoked.",
    });
    return;
  }
  res.json(GetDispatchByTokenResponse.parse(await sharedResponse(db, dispatch)));
});

router.get("/dispatches/:id/qr.png", async (req, res): Promise<void> => {
  const actor = await authorize(req, res, "view");
  if (!actor) return;
  const parsed = GetDispatchQrPngParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const db = await getMongoDb();
  const dispatch = await getDispatchRecords(db).findOne({
    _id: parsed.data.id,
    status: { $ne: "cancelled" },
    qrRevokedAt: null,
  });
  if (!dispatch) {
    res.status(404).json({ error: "This dispatch QR is unavailable or has been revoked." });
    return;
  }
  const image = await QRCode.toBuffer(await shareUrl(req, dispatch.qrToken), {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 7,
  });
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, no-store");
  res.send(image);
});

router.get("/dispatches/:id/challan.pdf", async (req, res): Promise<void> => {
  const actor = await authorize(req, res, "view");
  if (!actor) return;
  const parsed = GetDispatchChallanPdfParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const db = await getMongoDb();
  const dispatch = await getDispatchRecords(db).findOne({ _id: parsed.data.id });
  if (!dispatch) {
    res.status(404).json({ error: "Dispatch record not found." });
    return;
  }

  try {
    await withLotDispatchLock(db, `challan:${dispatch._id}`, async () => {
      const current = await getDispatchRecords(db).findOne({ _id: dispatch._id });
      if (!current) {
        res.status(404).json({ error: "Dispatch record not found." });
        return;
      }
      const documents = getOrderDocumentMetadata(db);
      const fingerprint = dispatchContentHash(current);
      const latest = await documents.find({
        orderRecordId: current.orderRecordId,
        dispatchId: current._id,
        category: "dispatch-challan",
        archivedAt: { $exists: false },
      }).sort({ documentVersion: -1, uploadedAt: -1 }).limit(1).next();
      if (latest?.contentHash === fingerprint && latest.storagePath) {
        const stored = resolveProjectUploadPath(latest.storagePath);
        if (stored) {
          try {
            const content = await readFile(stored);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="${current.dispatchCode}-challan-v${latest.documentVersion ?? 1}.pdf"`,
            );
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.send(content);
            return;
          } catch {
            // Regenerate a missing or unreadable saved version below.
          }
        }
      }

      const pdf = await renderChallan(current, await shareUrl(req, current.qrToken));
      const version = (latest?.documentVersion ?? 0) + 1;
      const filename = `${current.dispatchCode}-challan-v${version}.pdf`;
      const storagePath = await storeProjectUpload("order-documents", filename, pdf);
      try {
        await documents.insertOne({
          _id: randomUUID(),
          orderRecordId: current.orderRecordId,
          quotationRequestId: null,
          filename,
          category: "dispatch-challan",
          contentType: "application/pdf",
          sizeBytes: pdf.length,
          gridFsId: null,
          storagePath,
          uploadedBy: actor.id,
          uploadedAt: new Date(),
          dispatchId: current._id,
          documentVersion: version,
          contentHash: fingerprint,
        });
      } catch (error) {
        const { removeProjectUpload } = await import("../lib/project-upload-storage");
        await removeProjectUpload(storagePath).catch(() => undefined);
        throw error;
      }
      await recordEvent(
        db,
        current,
        actor,
        "dispatch.challan_generated",
        `Generated challan version ${version} for ${current.dispatchCode}.`,
        { documentVersion: version },
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(pdf);
    });
  } catch (error) {
    if (error instanceof DispatchLockBusyError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.get("/dispatches/:id", async (req, res): Promise<void> => {
  const actor = await authorize(req, res, "view");
  if (!actor) return;
  const parsed = GetDispatchRecordParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const dispatch = await getDispatchRecords(
    await getMongoDb(),
  ).findOne({ _id: parsed.data.id });
  if (!dispatch) {
    res.status(404).json({ error: "Dispatch record not found." });
    return;
  }
  res.json(GetDispatchRecordResponse.parse(dispatchResponse(dispatch)));
});

router.patch("/dispatches/:id", async (req, res): Promise<void> => {
  const actor = await authorize(req, res, "edit");
  if (!actor) return;
  const params = UpdateDispatchRecordParams.safeParse(req.params);
  const parsed = UpdateDispatchRecordBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : parsed.success ? "" : parsed.error.message,
    });
    return;
  }
  if (parsed.data.status === "cancelled") {
    res.status(400).json({ error: "Use the cancel action so the cancellation reason is recorded and the QR is revoked." });
    return;
  }

  const db = await getMongoDb();
  const existing = await getDispatchRecords(db).findOne({ _id: params.data.id });
  if (!existing) {
    res.status(404).json({ error: "Dispatch record not found." });
    return;
  }
  if (existing.status === "cancelled") {
    res.status(409).json({ error: "Cancelled dispatch records cannot be edited." });
    return;
  }
  if (parsed.data.status && !assertStatusTransition(existing.status, parsed.data.status)) {
    res.status(409).json({ error: `The dispatch cannot move from ${existing.status} to ${parsed.data.status}.` });
    return;
  }
  const nextStatus = parsed.data.status ?? existing.status;
  const order = await getOrders(db).findOne({ _id: existing.orderRecordId });
  const lot = order?.lots?.find((item) => item._id === existing.lotRecordId);
  if (!order || !lot) {
    res.status(409).json({ error: "The order or lot linked to this dispatch no longer exists." });
    return;
  }
  const updates: Partial<DispatchRecordDocument> = { updatedBy: actor.id, updatedAt: new Date() };
  const fields = [
    "dispatchNote",
    "vehicleNumber",
    "driverName",
    "driverPhone",
    "challanNumber",
    "siteAddress",
  ] as const;
  for (const field of fields) {
    if (parsed.data[field] !== undefined) {
      (updates as Record<string, unknown>)[field] = textOrNull(parsed.data[field] as string | null);
    }
  }
  if (parsed.data.plannedAt !== undefined) updates.plannedAt = requestDate(parsed.data.plannedAt);
  if (parsed.data.locationName !== undefined) updates.locationName = parsed.data.locationName.trim();
  if (parsed.data.siteLatitude !== undefined) updates.siteLatitude = parsed.data.siteLatitude;
  if (parsed.data.siteLongitude !== undefined) updates.siteLongitude = parsed.data.siteLongitude;

  const nextLatitude = updates.siteLatitude !== undefined ? updates.siteLatitude : existing.siteLatitude;
  const nextLongitude = updates.siteLongitude !== undefined ? updates.siteLongitude : existing.siteLongitude;
  if ((nextLatitude === null) !== (nextLongitude === null)) {
    res.status(400).json({ error: "Choose both map coordinates or clear the selected pin." });
    return;
  }
  if (nextStatus === "dispatched" && existing.status !== "dispatched") {
    const readiness = checkLotReadiness(await getLotWindows(db, order, lot));
    if (!readiness.ready) {
      const reason = textOrNull(parsed.data.overrideReason);
      if (!(await requireOverride(actor, res, reason))) return;
      updates.overrideReason = reason;
    }
  }
  if (parsed.data.status && parsed.data.status !== existing.status) {
    updates.status = parsed.data.status;
    if (parsed.data.status === "dispatched") updates.dispatchedAt = new Date();
    if (parsed.data.status === "delivered") updates.deliveredAt = new Date();
    if (parsed.data.status === "returned") updates.returnedAt = new Date();
  }
  const result = await getDispatchRecords(db).updateOne(
    { _id: existing._id, status: existing.status, updatedAt: existing.updatedAt },
    { $set: updates },
  );
  if (result.modifiedCount !== 1) {
    res.status(409).json({ error: "This dispatch changed while you were editing it. Refresh and try again." });
    return;
  }
  const updated = await getDispatchRecords(db).findOne({ _id: existing._id });
  if (!updated) {
    res.status(404).json({ error: "Updated dispatch record could not be loaded." });
    return;
  }
  const refreshed = await refreshOrderDispatchSummary(db, updated.orderRecordId, actor.id);
  const changed = Object.keys(parsed.data).filter((key) => key !== "overrideReason");
  await recordEvent(
    db,
    updated,
    actor,
    parsed.data.status && parsed.data.status !== existing.status
      ? "dispatch.status_changed"
      : "dispatch.updated",
    parsed.data.status && parsed.data.status !== existing.status
      ? `Changed ${updated.dispatchCode} to ${updated.status}.`
      : `Updated dispatch details for ${updated.dispatchCode}.`,
    { changedFields: changed, readinessOverride: Boolean(updated.overrideReason) },
  );
  res.json(UpdateDispatchRecordResponse.parse(dispatchResponse(refreshed
    ? { ...updated, orderId: refreshed.order.orderId }
    : updated)));
});

router.post("/dispatches/:id/cancel", async (req, res): Promise<void> => {
  const actor = await authorize(req, res, "cancel");
  if (!actor) return;
  const params = CancelDispatchRecordParams.safeParse(req.params);
  const parsed = CancelDispatchRecordBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : parsed.success ? "" : parsed.error.message,
    });
    return;
  }
  const db = await getMongoDb();
  const existing = await getDispatchRecords(db).findOne({ _id: params.data.id });
  if (!existing) {
    res.status(404).json({ error: "Dispatch record not found." });
    return;
  }
  if (existing.status === "cancelled") {
    res.status(409).json({ error: "This dispatch is already cancelled." });
    return;
  }
  const now = new Date();
  const result = await getDispatchRecords(db).updateOne(
    { _id: existing._id, status: existing.status, updatedAt: existing.updatedAt },
    {
      $set: {
        status: "cancelled",
        cancelledBy: actor.id,
        cancelledAt: now,
        cancelReason: parsed.data.reason.trim(),
        qrRevokedAt: now,
        updatedBy: actor.id,
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount !== 1) {
    res.status(409).json({ error: "This dispatch changed while it was being cancelled. Refresh and try again." });
    return;
  }
  const cancelled = await getDispatchRecords(db).findOne({ _id: existing._id });
  if (!cancelled) {
    res.status(404).json({ error: "Cancelled dispatch record could not be loaded." });
    return;
  }
  const refreshed = await refreshOrderDispatchSummary(db, cancelled.orderRecordId, actor.id, now);
  await recordEvent(
    db,
    cancelled,
    actor,
    "dispatch.cancelled",
    `Cancelled ${cancelled.dispatchCode}: ${parsed.data.reason.trim()}`,
    { reason: parsed.data.reason.trim(), dispatchNo: cancelled.dispatchNo },
    now,
  );
  res.json(CancelDispatchRecordResponse.parse(dispatchResponse(refreshed
    ? { ...cancelled, orderId: refreshed.order.orderId }
    : cancelled)));
});

export default router;
