import {
  ListDispatchOrdersResponse,
} from "@workspace/api-zod";
import { Router, type RequestHandler } from "express";
import {
  getDispatchRecords,
  getMongoDb,
  getOrders,
  getPublicUser,
  getUsers,
  type OrderDocument,
} from "../lib/mongo";
import { summarizeOrderDispatches } from "../lib/dispatch-domain";

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

function dispatchOrderResponse(order: OrderDocument) {
  return {
    id: order._id,
    orderId: order.orderId,
    clientName: order.clientName,
    locationName: order.locationName,
    orderStatus: order.status,
    dispatchStatus: order.dispatchStatus ?? "pending_dispatch",
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
    const dispatches = orders.length
      ? await getDispatchRecords(db).find({
          orderRecordId: { $in: orders.map((order) => order._id) },
        }).toArray()
      : [];
    const byOrderId = new Map<string, typeof dispatches>();
    for (const dispatch of dispatches) {
      const rows = byOrderId.get(dispatch.orderRecordId) ?? [];
      rows.push(dispatch);
      byOrderId.set(dispatch.orderRecordId, rows);
    }
    const response = orders.map((order) => ({
      ...dispatchOrderResponse(order),
      dispatchStatus: summarizeOrderDispatches(
        order,
        byOrderId.get(order._id) ?? [],
      ).dispatchStatus,
    }));
    res.json(ListDispatchOrdersResponse.parse(response));
  },
);

router.patch(
  "/dispatch/orders/:id/status",
  requireDispatchPermission("edit"),
  async (_req, res): Promise<void> => {
    res.status(409).json({
      error: "Order dispatch status is derived from lot dispatch records. Use the lot dispatch workflow instead.",
    });
  },
);

export default router;