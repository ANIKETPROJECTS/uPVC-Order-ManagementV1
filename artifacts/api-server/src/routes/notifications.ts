import {
  GetPushConfigResponse,
  ListNotificationsResponse,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadParams,
  MarkNotificationReadResponse,
  SavePushSubscriptionBody,
  SendTestNotificationResponse,
  DeletePushSubscriptionBody,
} from "@workspace/api-zod";
import { Router, type Request, type RequestHandler } from "express";
import {
  getAppNotifications,
  getMongoDb,
  getPublicUser,
  getPushSubscriptions,
  getUsers,
} from "../lib/mongo";
import {
  createAppNotification,
  getPushConfiguration,
  pushConfigurationReady,
  pushSubscriptionId,
} from "../lib/notification-service";

const router = Router();

type Actor = {
  id: string;
  roleId: string;
  permissions: Record<string, "none" | "view" | "edit">;
};

async function getActor(
  req: Request,
  res: Parameters<RequestHandler>[1],
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
  return {
    id: user._id,
    roleId: user.roleId,
    permissions: publicUser.permissions,
  };
}

function isAdmin(actor: Actor): boolean {
  return (
    actor.roleId === "master-admin" ||
    actor.permissions["user-access"] === "edit"
  );
}

router.get("/push/config", async (req, res): Promise<void> => {
  if (!(await getActor(req, res))) return;
  res.json(GetPushConfigResponse.parse(getPushConfiguration()));
});

router.post("/push-subscriptions", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  if (!pushConfigurationReady()) {
    res.status(503).json({ error: "Browser push is not configured yet." });
    return;
  }
  const parsed = SavePushSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const db = await getMongoDb();
  const now = new Date();
  const { endpoint, keys } = parsed.data;
  await getPushSubscriptions(db).updateOne(
    { _id: pushSubscriptionId(endpoint) },
    {
      $set: {
        userId: actor.id,
        endpoint,
        keys,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
  res.sendStatus(204);
});

router.delete("/push-subscriptions", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  const parsed = DeletePushSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await getPushSubscriptions(await getMongoDb()).deleteOne({
    _id: pushSubscriptionId(parsed.data.endpoint),
    userId: actor.id,
  });
  res.sendStatus(204);
});

router.get("/notifications", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  const db = await getMongoDb();
  const filter = { userId: actor.id };
  const [items, unreadCount] = await Promise.all([
    getAppNotifications(db)
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(40)
      .toArray(),
    getAppNotifications(db).countDocuments({ ...filter, readAt: null }),
  ]);
  res.json(
    ListNotificationsResponse.parse({
      items: items.map((item) => ({
        id: item._id,
        type: item.type,
        title: item.title,
        message: item.message,
        url: item.url,
        quotationId: item.quotationId,
        readAt: item.readAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      unreadCount,
    }),
  );
});

router.post(
  "/notifications/:notificationId/read",
  async (req, res): Promise<void> => {
    const actor = await getActor(req, res);
    if (!actor) return;
    const params = MarkNotificationReadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    await getAppNotifications(await getMongoDb()).updateOne(
      { _id: params.data.notificationId, userId: actor.id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    res.sendStatus(204);
  },
);

router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  await getAppNotifications(await getMongoDb()).updateMany(
    { userId: actor.id, readAt: null },
    { $set: { readAt: new Date() } },
  );
  res.sendStatus(204);
});

router.post("/notifications/test", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  if (!isAdmin(actor)) {
    res.status(403).json({ error: "Administrator access required." });
    return;
  }
  if (!pushConfigurationReady()) {
    res.status(503).json({ error: "Browser push is not configured yet." });
    return;
  }
  const db = await getMongoDb();
  const subscriptions = await getPushSubscriptions(db)
    .countDocuments({ userId: actor.id });
  if (!subscriptions) {
    res.status(409).json({
      error: "Enable browser notifications on this device before sending a test.",
    });
    return;
  }
  const result = await createAppNotification(db, actor.id, {
    type: "test",
    title: "Test notification",
    message: "Browser notifications are working on this device.",
    url: "/",
    quotationId: null,
  });
  if (!result.push.sent) {
    res.status(409).json({
      error: "No active browser subscription received the test notification.",
    });
    return;
  }
  res.json(SendTestNotificationResponse.parse({ success: true }));
});

export default router;