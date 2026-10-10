import {
  ListDispatchOrdersResponse,
  UpdateDispatchOrderPlanBody,
  UpdateDispatchOrderPlanParams,
  UpdateDispatchOrderPlanResponse,
  UpdateDispatchOrderStatusBody,
  UpdateDispatchOrderStatusParams,
  UpdateDispatchOrderStatusResponse,
} from "@workspace/api-zod";
import { Router, type RequestHandler } from "express";
import {
  getOrderActivity,
  getMongoDb,
  getOrders,
  getOrderWindows,
  getPublicUser,
  getUsers,
  type DispatchStatus,
  type OrderDocument,
  type OrderLotDocument,
  type OrderWindowDocument,
} from "../lib/mongo";
import { formatLotId } from "../lib/order-identifiers";
import { randomUUID } from "node:crypto";

const router = Router();

function requireDispatchPermission(required: "view" | "edit"): RequestHandler {
  return (req, res, next) => {
    void getMongoDb()
      .then(async (db) => {
        const userId = req.session.userId;
        const user = userId
          ? await getUsers(db).findOne({ _id: userId, status: "active" })
          : null;
        if (!user) {
          res.status(401).json({ error: "Sign in to continue." });
          return;
        }

        const publicUser = await getPublicUser(user, db);
        const permission = publicUser.permissions.dispatch ?? "none";
        const allowed =
          publicUser.roleId === "master-admin" ||
          permission === "edit" ||
          (required === "view" && permission === "view");
        if (!allowed) {
          res.status(403).json({
            error: required === "edit"
              ? "Dispatch editing access is required."
              : "Dispatch viewing access is required.",
          });
          return;
        }
        next();
      })
      .catch(next);
  };
}

function aggregateStatus(dispatches: NonNullable<OrderDocument["dispatches"]>, legacy?: DispatchStatus): DispatchStatus {
  if (dispatches.length === 0) return legacy ?? "pending_dispatch";
  if (dispatches.every((dispatch) => dispatch.dispatchStatus === "delivered")) return "delivered";
  if (dispatches.some((dispatch) => dispatch.dispatchStatus !== "pending_dispatch")) return "dispatched";
  return "pending_dispatch";
}

function dispatchTrackingId(order: OrderDocument, lotId: string | null, code: string): string {
  if (!lotId) return `${order.orderId}-${code}`;
  const sequence = order.lots?.find((lot) => lot.lotId === lotId)?.sequence
    ?? Number(lotId.match(/-L0*(\d+)$/i)?.[1]);
  return sequence ? `${order.orderId}-L${sequence}-${code}` : `${lotId}-${code}`;
}

function dispatchOrderResponse(order: OrderDocument, windows: OrderWindowDocument[] = []) {
  const dispatches = order.dispatches ?? [];
  return {
    id: order._id,
    orderId: order.orderId,
    clientName: order.clientName,
    locationName: order.locationName,
    clientType: order.clientType ?? ((order.lots?.length ?? 0) > 0 ? "Project" : "Retail"),
    orderStatus: order.status,
    dispatchStatus: aggregateStatus(dispatches, order.dispatchStatus),
    lots: (order.lots ?? []).map((lot) => ({ lotId: lot.lotId, sequence: lot.sequence })),
    dispatches: dispatches.map((dispatch) => ({
      id: dispatch._id,
      code: dispatch.code,
      trackingId: dispatchTrackingId(order, dispatch.lotId, dispatch.code),
      lotId: dispatch.lotId,
      windowIds: dispatch.windowIds,
      dispatchStatus: dispatch.dispatchStatus,
      createdAt: dispatch.createdAt.toISOString(),
      updatedAt: dispatch.updatedAt.toISOString(),
    })),
    windows: windows.map((window) => ({
      id: window._id,
      windowNo: window.windowNo,
      widthMm: window.widthMm,
      heightMm: window.heightMm,
      ready: window.frameStatus === "ready" && window.shutterStatus === "ready" && window.glassStatus === "received",
    })),
    dispatchPlanRevision: order.dispatchPlanRevision ?? 0,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

router.get(
  "/dispatch/orders",
  requireDispatchPermission("view"),
  async (_req, res): Promise<void> => {
    const db = await getMongoDb();
    const orders = await getOrders(db)
      .find({})
      .sort({ updatedAt: -1, createdAt: -1 })
      .toArray();
    const windows = await getOrderWindows(db)
      .find({ orderRecordId: { $in: orders.map((order) => order._id) }, archivedAt: null })
      .toArray();
    const windowsByOrder = new Map<string, typeof windows>();
    for (const window of windows) {
      const group = windowsByOrder.get(window.orderRecordId) ?? [];
      group.push(window);
      windowsByOrder.set(window.orderRecordId, group);
    }
    res.json(ListDispatchOrdersResponse.parse(orders.map((order) => dispatchOrderResponse(order, windowsByOrder.get(order._id) ?? []))));
  },
);

router.patch(
  "/dispatch/orders/:id/plan",
  requireDispatchPermission("edit"),
  async (req, res): Promise<void> => {
    const params = UpdateDispatchOrderPlanParams.safeParse(req.params);
    const body = UpdateDispatchOrderPlanBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : body.success ? "" : body.error.message });
      return;
    }
    const userId = req.session.userId;
    if (!userId) { res.status(401).json({ error: "Sign in to continue." }); return; }

    const db = await getMongoDb();
    const orders = getOrders(db);
    const order = await orders.findOne({ _id: params.data.id });
    if (!order) { res.status(404).json({ error: "Order not found." }); return; }
    const revision = order.dispatchPlanRevision ?? 0;
    if (body.data.expectedRevision !== revision) {
      res.status(409).json({ error: "This dispatch plan changed elsewhere. Refresh and try again." });
      return;
    }

    const codes = new Set<string>();
    const selectedWindows = new Set<string>();
    const oldDispatches = order.dispatches ?? [];
    const isProject = order.clientType === "Project" || (order.lots?.length ?? 0) > 0;
    const now = new Date();
    const nextLots = [...(order.lots ?? [])];
    const newLotsByDraftId = new Map<string, OrderLotDocument>();
    let nextLotSequence = Math.max(
      order.nextLotSequence ?? 1,
      nextLots.reduce((highest, lot) => Math.max(highest, lot.sequence), 0) + 1,
    );
    for (const dispatch of body.data.dispatches) {
      if (!dispatch.createLot) continue;
      if (!isProject || !dispatch.lotId || dispatch.id) {
        res.status(400).json({ error: "Only project orders can add a new lot to a dispatch batch." });
        return;
      }
      if (!newLotsByDraftId.has(dispatch.lotId)) {
        const lot: OrderLotDocument = {
          _id: randomUUID(),
          sequence: nextLotSequence,
          lotId: formatLotId(order.orderId, nextLotSequence),
          createdBy: userId,
          createdAt: now,
        };
        nextLots.push(lot);
        newLotsByDraftId.set(dispatch.lotId, lot);
        nextLotSequence += 1;
      }
    }
    const planItems = body.data.dispatches.map((dispatch) => {
      const createdLot = dispatch.createLot ? newLotsByDraftId.get(dispatch.lotId ?? "") : undefined;
      return { ...dispatch, lotId: createdLot?.lotId ?? dispatch.lotId, createLot: false };
    });
    for (const current of oldDispatches) {
      const incoming = planItems.find((item) => item.id === current._id);
      const assignmentsChanged = incoming && (
        incoming.code.toUpperCase() !== current.code
        || incoming.lotId !== current.lotId
        || [...incoming.windowIds].sort().join("|") !== [...current.windowIds].sort().join("|")
      );
      if (current.dispatchStatus !== "pending_dispatch" && (!incoming || assignmentsChanged)) {
        res.status(409).json({ error: "Dispatched or delivered records are locked. Only their status can be changed." });
        return;
      }
    }
    const existingWindowIds = new Set(oldDispatches.flatMap((dispatch) => dispatch.windowIds));
    for (const dispatch of planItems) {
      if (isProject) {
        if (!dispatch.lotId || !nextLots.some((lot) => lot.lotId === dispatch.lotId)) {
          res.status(400).json({ error: "Choose a valid project lot for each dispatch." });
          return;
        }
      } else if (dispatch.lotId !== null) {
        res.status(400).json({ error: "Retail dispatches cannot be assigned to a project lot." });
        return;
      }
      const codeKey = `${dispatch.lotId ?? "order"}:${dispatch.code.toUpperCase()}`;
      if (codes.has(codeKey)) { res.status(400).json({ error: "Dispatch numbers must be unique within each lot." }); return; }
      codes.add(codeKey);
      for (const windowId of dispatch.windowIds) {
        if (selectedWindows.has(windowId)) { res.status(400).json({ error: "A window can only be assigned to one dispatch at a time." }); return; }
        selectedWindows.add(windowId);
      }
      if (dispatch.id && !oldDispatches.some((current) => current._id === dispatch.id)) {
        res.status(400).json({ error: "A dispatch in this plan is no longer available." });
        return;
      }
    }

    const windows = await getOrderWindows(db).find({
      orderRecordId: order._id,
      _id: { $in: [...selectedWindows] },
      archivedAt: null,
    }).toArray();
    if (windows.length !== selectedWindows.size) {
      res.status(409).json({ error: "One or more selected windows are no longer available." });
      return;
    }
    const notReady = windows.find((window) => !existingWindowIds.has(window._id)
      && (window.frameStatus !== "ready" || window.shutterStatus !== "ready" || window.glassStatus !== "received"));
    if (notReady) {
      res.status(409).json({ error: `Window ${notReady.windowNo} is not ready for dispatch.` });
      return;
    }

    const dispatches = planItems.map((input) => {
      const current = input.id ? oldDispatches.find((dispatch) => dispatch._id === input.id) : undefined;
      return {
        _id: current?._id ?? randomUUID(),
        code: input.code.toUpperCase(),
        lotId: input.lotId,
        windowIds: input.windowIds,
        dispatchStatus: input.dispatchStatus,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        updatedBy: userId,
      };
    });
    const nextStatus = aggregateStatus(dispatches);
    const revisionFilter = revision === 0
      ? { $or: [{ dispatchPlanRevision: 0 }, { dispatchPlanRevision: { $exists: false } }] }
      : { dispatchPlanRevision: revision };
    const lotSequenceFilter = newLotsByDraftId.size > 0
      ? order.nextLotSequence === undefined
        ? { nextLotSequence: { $exists: false as const } }
        : { nextLotSequence: order.nextLotSequence }
      : {};
    const planSet = {
      dispatches,
      dispatchStatus: nextStatus,
      dispatchPlanRevision: revision + 1,
      updatedAt: now,
      updatedBy: userId,
      ...(newLotsByDraftId.size > 0 ? { lots: nextLots, nextLotSequence } : {}),
    };
    const update = await orders.updateOne(
      { _id: order._id, ...revisionFilter, ...lotSequenceFilter },
      { $set: planSet },
    );
    if (!update.matchedCount) {
      res.status(409).json({ error: "This dispatch plan changed elsewhere. Refresh and try again." });
      return;
    }
    const updated = await orders.findOne({ _id: order._id });
    if (!updated) { res.status(404).json({ error: "Order not found." }); return; }
    const actor = await getUsers(db).findOne({ _id: userId, status: "active" });
    await getOrderActivity(db).insertOne({
      _id: randomUUID(), orderRecordId: order._id, actorId: userId, actorName: actor?.name ?? "Team member",
      action: "dispatch.plan_updated",
      summary: `Updated ${new Set(dispatches.map((dispatch) => dispatch.code)).size} dispatch batch(es) across ${dispatches.length} lot entry/entries for ${order.orderId}.`,
      createdAt: now,
    });
    const allWindows = await getOrderWindows(db).find({ orderRecordId: order._id, archivedAt: null }).toArray();
    res.json(UpdateDispatchOrderPlanResponse.parse(dispatchOrderResponse(updated, allWindows)));
  },
);

router.patch(
  "/dispatch/orders/:id/status",
  requireDispatchPermission("edit"),
  async (req, res): Promise<void> => {
    const params = UpdateDispatchOrderStatusParams.safeParse(req.params);
    const body = UpdateDispatchOrderStatusBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : body.success ? "" : body.error.message,
      });
      return;
    }

    const userId = req.session.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }

    const db = await getMongoDb();
    const orders = getOrders(db);
    const order = await orders.findOne({ _id: params.data.id });
    if (!order) { res.status(404).json({ error: "Order not found." }); return; }
    const updatedAt = new Date();
    const dispatches = (order.dispatches ?? []).map((dispatch) => ({
      ...dispatch,
      dispatchStatus: body.data.dispatchStatus,
      updatedAt,
      updatedBy: userId,
    }));
    const revision = order.dispatchPlanRevision ?? 0;
    const revisionFilter = revision === 0
      ? { $or: [{ dispatchPlanRevision: 0 }, { dispatchPlanRevision: { $exists: false } }] }
      : { dispatchPlanRevision: revision };
    const result = await orders.updateOne(
      { _id: params.data.id, ...revisionFilter },
      {
        $set: {
          dispatches,
          dispatchStatus: body.data.dispatchStatus,
          updatedAt,
          updatedBy: userId,
          dispatchPlanRevision: revision + 1,
        },
      },
    );
    if (!result.matchedCount) {
      res.status(409).json({ error: "The dispatch plan changed elsewhere. Refresh and try again." });
      return;
    }

    const updated = await orders.findOne({ _id: params.data.id });
    if (!updated) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const actor = await getUsers(db).findOne({ _id: userId, status: "active" });
    await getOrderActivity(db).insertOne({
      _id: randomUUID(),
      orderRecordId: updated._id,
      actorId: userId,
      actorName: actor?.name ?? "Team member",
      action: "dispatch.status_set",
      summary: `Set every dispatch for ${updated.orderId} to ${body.data.dispatchStatus}.`,
      createdAt: updatedAt,
    });
    const windows = await getOrderWindows(db).find({ orderRecordId: updated._id, archivedAt: null }).toArray();
    res.json(UpdateDispatchOrderStatusResponse.parse(dispatchOrderResponse(updated, windows)));
  },
);

export default router;