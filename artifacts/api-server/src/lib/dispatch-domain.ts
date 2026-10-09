import type { Db } from "mongodb";
import {
  getDispatchRecords,
  getOrderWindows,
  getOrders,
  type DispatchRecordDocument,
  type DispatchWindowSnapshotDocument,
  type OrderDocument,
  type OrderLotDocument,
  type OrderStatus,
  type OrderWindowDocument,
} from "./mongo";

export interface LotDispatchSummary {
  lotRecordId: string;
  lotId: string;
  lotSequence: number;
  dispatchStatus: "not_dispatched" | "dispatched" | "delivered";
  dispatchCount: number;
  latestDispatchCode: string | null;
}

export interface OrderDispatchSummary {
  dispatchStatus: "pending_dispatch" | "dispatched" | "delivered";
  totalLots: number;
  dispatchedLots: number;
  deliveredLots: number;
  activeDispatches: number;
  lots: LotDispatchSummary[];
}

export function summarizeOrderDispatches(
  order: OrderDocument,
  dispatches: DispatchRecordDocument[],
): OrderDispatchSummary {
  const orderLots = [...(order.lots ?? [])].sort((a, b) => a.sequence - b.sequence);
  const lots = orderLots.map((lot) => {
    const rows = dispatches
      .filter((dispatch) => dispatch.lotRecordId === lot._id && dispatch.status !== "cancelled")
      .sort((a, b) => b.dispatchNo - a.dispatchNo);
    const delivered = rows.some((dispatch) => dispatch.status === "delivered");
    const started = rows.some((dispatch) =>
      dispatch.status === "dispatched"
      || dispatch.status === "delivered"
      || dispatch.status === "returned");
    return {
      lotRecordId: lot._id,
      lotId: lot.lotId,
      lotSequence: lot.sequence,
      dispatchStatus: delivered ? "delivered" as const : started ? "dispatched" as const : "not_dispatched" as const,
      dispatchCount: rows.length,
      latestDispatchCode: rows[0]?.dispatchCode ?? null,
    };
  });

  const activeDispatches = dispatches.filter((dispatch) =>
    dispatch.status === "planned" || dispatch.status === "dispatched").length;
  const dispatchedLots = lots.filter((lot) => lot.dispatchStatus !== "not_dispatched").length;
  const deliveredLots = lots.filter((lot) => lot.dispatchStatus === "delivered").length;
  const fullyDelivered = lots.length > 0
    && deliveredLots === lots.length
    && activeDispatches === 0;

  return {
    dispatchStatus: fullyDelivered
      ? "delivered"
      : dispatchedLots > 0
        ? "dispatched"
        : "pending_dispatch",
    totalLots: lots.length,
    dispatchedLots,
    deliveredLots,
    activeDispatches,
    lots,
  };
}

export async function refreshOrderDispatchSummary(
  db: Db,
  orderRecordId: string,
  actorId: string,
  now = new Date(),
): Promise<{ order: OrderDocument; summary: OrderDispatchSummary } | null> {
  const orders = getOrders(db);
  const order = await orders.findOne({ _id: orderRecordId });
  if (!order) return null;

  const dispatches = await getDispatchRecords(db)
    .find({ orderRecordId })
    .sort({ createdAt: 1, dispatchNo: 1 })
    .toArray();
  const summary = summarizeOrderDispatches(order, dispatches);
  const updates: Partial<OrderDocument> = {
    dispatchStatus: summary.dispatchStatus,
    updatedAt: now,
    updatedBy: actorId,
  };
  const unset: Record<string, ""> = {};

  const hasStarted = summary.dispatchStatus === "dispatched" || summary.dispatchStatus === "delivered";
  if (hasStarted && order.status !== "installed") {
    if (order.status !== "dispatched") {
      updates.dispatchLifecyclePreviousStatus = order.status;
    }
    updates.status = "dispatched";
  } else if (
    !hasStarted
    && order.status === "dispatched"
    && order.dispatchLifecyclePreviousStatus
  ) {
    updates.status = order.dispatchLifecyclePreviousStatus;
    unset.dispatchLifecyclePreviousStatus = "";
  }

  await orders.updateOne(
    { _id: orderRecordId },
    {
      $set: updates,
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    },
  );
  const refreshed = await orders.findOne({ _id: orderRecordId });
  return refreshed ? { order: refreshed, summary } : null;
}

export async function getLotWindows(
  db: Db,
  order: OrderDocument,
  lot: OrderLotDocument,
): Promise<OrderWindowDocument[]> {
  const lots = [...(order.lots ?? [])].sort((a, b) => a.sequence - b.sequence);
  const defaultLotRecordId = lots[0]?._id;
  const windows = await getOrderWindows(db)
    .find({
      orderRecordId: order._id,
      archivedAt: null,
    })
    .sort({ windowNo: 1 })
    .toArray();
  return windows.filter((window) =>
    (window.lotRecordId ?? defaultLotRecordId) === lot._id);
}

export function checkLotReadiness(windows: OrderWindowDocument[]): {
  ready: boolean;
  reason: string | null;
} {
  if (windows.length === 0) {
    return { ready: false, reason: "This lot has no active windows assigned to it." };
  }
  const notReady = windows.filter((window) =>
    window.frameStatus !== "ready"
    || window.shutterStatus !== "ready"
    || window.glassStatus !== "received");
  if (notReady.length) {
    return {
      ready: false,
      reason: `${notReady.length} of ${windows.length} windows are not fully ready (frame, shutter, and glass).`,
    };
  }
  return { ready: true, reason: null };
}

export function toDispatchWindowSnapshot(
  windows: OrderWindowDocument[],
): DispatchWindowSnapshotDocument[] {
  return windows.map((window) => ({
    windowId: window._id,
    windowNo: window.windowNo,
    widthMm: window.widthMm,
    heightMm: window.heightMm,
    windowType: window.windowType,
    sqFt: window.sqFt,
    frameStatus: window.frameStatus,
    shutterStatus: window.shutterStatus,
    glassStatus: window.glassStatus,
  }));
}

export function isDispatchStarted(status: string): boolean {
  return status === "dispatched" || status === "delivered" || status === "returned";
}

export function statusBeforeDispatch(orderStatus: OrderStatus): OrderStatus {
  return orderStatus === "dispatched" || orderStatus === "installed"
    ? "ready"
    : orderStatus;
}
