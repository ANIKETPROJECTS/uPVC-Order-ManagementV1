import {
  ListDispatchOrdersResponse,
  UpdateDispatchOrderStatusBody,
  UpdateDispatchOrderStatusParams,
  UpdateDispatchOrderStatusResponse,
} from "@workspace/api-zod";
import { Router, type RequestHandler } from "express";
import {
  getOrderActivity,
  getMongoDb,
  getOrders,
  getPublicUser,
  getUsers,
  type OrderDocument,
} from "../lib/mongo";
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
    const orders = await getOrders(await getMongoDb())
      .find({})
      .sort({ updatedAt: -1, createdAt: -1 })
      .toArray();
    res.json(ListDispatchOrdersResponse.parse(orders.map(dispatchOrderResponse)));
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
    const updatedAt = new Date();
    const result = await orders.updateOne(
      { _id: params.data.id },
      {
        $set: {
          dispatchStatus: body.data.dispatchStatus,
          updatedAt,
          updatedBy: userId,
        },
      },
    );
    if (!result.matchedCount) {
      res.status(404).json({ error: "Order not found." });
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
      summary: `Set dispatch status for ${updated.orderId} to ${updated.dispatchStatus ?? "pending_dispatch"}.`,
      createdAt: updatedAt,
    });
    res.json(UpdateDispatchOrderStatusResponse.parse(dispatchOrderResponse(updated)));
  },
);

export default router;