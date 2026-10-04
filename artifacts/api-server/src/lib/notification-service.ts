import { createHash, randomUUID } from "node:crypto";
import webPush from "web-push";
import {
  getAppNotifications,
  getPushSubscriptions,
  type AppNotificationDocument,
  type AppNotificationType,
} from "./mongo";
import { logger } from "./logger";

export type AppNotificationInput = {
  type: AppNotificationType;
  title: string;
  message: string;
  url: string;
  quotationId: string | null;
};

export type PushDeliveryResult = {
  configured: boolean;
  attempted: number;
  sent: number;
  expired: number;
};

const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
const defaultSubject = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
let configurationError: string | null = null;

if (publicKey && privateKey) {
  try {
    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT?.trim() ||
        (defaultSubject ? `https://${defaultSubject}` : "https://localhost"),
      publicKey,
      privateKey,
    );
  } catch (error) {
    configurationError =
      error instanceof Error ? error.message : "Invalid VAPID configuration.";
    logger.error({ err: error }, "Web Push VAPID configuration is invalid");
  }
}

export function getPushConfiguration() {
  const enabled = Boolean(publicKey && privateKey && !configurationError);
  return {
    enabled,
    publicKey: enabled ? publicKey! : null,
  };
}

export function pushConfigurationReady(): boolean {
  return getPushConfiguration().enabled;
}

export function pushSubscriptionId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

export async function sendPushToUser(
  db: Parameters<typeof getAppNotifications>[0],
  userId: string,
  payload: AppNotificationInput,
): Promise<PushDeliveryResult> {
  if (!pushConfigurationReady()) {
    return { configured: false, attempted: 0, sent: 0, expired: 0 };
  }

  const subscriptions = await getPushSubscriptions(db)
    .find({ userId })
    .toArray();
  let sent = 0;
  let expired = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: subscription.keys,
          },
          JSON.stringify(payload),
          { TTL: 3600, urgency: "normal" },
        );
        sent += 1;
      } catch (error) {
        const statusCode =
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error
            ? Number(error.statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          expired += 1;
          await getPushSubscriptions(db).deleteOne({
            _id: subscription._id,
            userId,
          });
          return;
        }
        logger.warn(
          { err: error, userId, subscriptionId: subscription._id },
          "Web Push delivery failed",
        );
      }
    }),
  );
  return {
    configured: true,
    attempted: subscriptions.length,
    sent,
    expired,
  };
}

export async function createAppNotification(
  db: Parameters<typeof getAppNotifications>[0],
  userId: string,
  input: AppNotificationInput,
): Promise<{ notification: AppNotificationDocument; push: PushDeliveryResult }> {
  const notification: AppNotificationDocument = {
    _id: randomUUID(),
    userId,
    ...input,
    readAt: null,
    createdAt: new Date(),
  };
  await getAppNotifications(db).insertOne(notification);
  const push = await sendPushToUser(db, userId, input);
  return { notification, push };
}