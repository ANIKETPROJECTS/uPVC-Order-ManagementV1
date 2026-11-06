import {
  getMongoDb,
  getPublicUser,
  getQuotationRateSubmissions,
  getUsers,
  type QuotationRateSubmissionDocument,
} from "./mongo";
import { createAppNotification } from "./notification-service";
import { logger } from "./logger";

const positiveNumber = (value: string | undefined, fallback: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

export function getQuotationRateAttentionConfig() {
  const amberHours = positiveNumber(process.env.QUOTATION_RATE_AMBER_HOURS, 24, 720);
  return {
    amberHours,
    redHours: Math.max(amberHours, positiveNumber(process.env.QUOTATION_RATE_RED_HOURS, 48, 720)),
    noOutcomeDays: positiveNumber(process.env.QUOTATION_RATE_NO_OUTCOME_DAYS, 5, 90),
    reminderHours: positiveNumber(process.env.QUOTATION_RATE_REMINDER_HOURS, 24, 720),
  };
}

async function recipientIds() {
  const db = await getMongoDb();
  const activeUsers = await getUsers(db).find({ status: "active" }).toArray();
  const configured = (process.env.QUOTATION_RATE_NOTIFICATION_USER_IDS || "")
    .split(",").map((id) => id.trim()).filter(Boolean);
  if (configured.length) {
    const activeIds = new Set(activeUsers.map((user) => user._id));
    return [...new Set(configured.filter((id) => activeIds.has(id)))];
  }
  const eligible = await Promise.all(activeUsers.map(async (user) => {
    const publicUser = await getPublicUser(user, db);
    return user.roleId === "master-admin" || publicUser.permissions["rate-approval"] === "edit"
      ? user._id
      : null;
  }));
  return eligible.filter((id): id is string => Boolean(id));
}

async function notifyRecipients(input: Parameters<typeof createAppNotification>[2], dedupeKey: string) {
  const db = await getMongoDb();
  for (const userId of await recipientIds()) {
    try {
      await createAppNotification(db, userId, input, dedupeKey);
    } catch (error) {
      logger.error({ err: error, userId, dedupeKey }, "Could not deliver quotation rate notification");
    }
  }
}

export async function notifyNewRateRequest(item: QuotationRateSubmissionDocument, urgent = false) {
  await notifyRecipients({
    type: urgent ? "rate_request_urgent" : "rate_request",
    title: urgent ? "Urgent rate request" : "New rate request",
    message: `${item._id} for ${item.clientName}${urgent ? " is marked urgent." : " is awaiting a rate."}`,
    url: `/quotations-rates?section=rates&pane=requests`,
    quotationId: item._id,
  }, urgent ? `urgent:${item._id}` : `new:${item._id}`);
}

export async function notifyRateAssigned(item: QuotationRateSubmissionDocument) {
  await notifyRecipients({
    type: "rate_assigned",
    title: "Rate entered",
    message: `${item._id} for ${item.clientName} was rated at Rs ${item.ratePerSqFt}/sq. ft.`,
    url: `/quotations-rates/requests/${encodeURIComponent(item._id)}`,
    quotationId: item._id,
  }, `rate-assigned:${item._id}:${item.rateAssignedAt?.toISOString() ?? item.updatedAt.toISOString()}`);
}

const elapsedWaiting = (item: QuotationRateSubmissionDocument, now: Date) => {
  const start = item.awaitingRateSince ?? item.createdAt;
  const activePause = item.status === "query_raised" && item.queryRaisedAt
    ? now.getTime() - item.queryRaisedAt.getTime()
    : 0;
  return Math.max(0, now.getTime() - start.getTime()
    - (item.pausedWaitMilliseconds ?? 0) - activePause);
};

export async function sendQuotationRateOverdueReminders() {
  const db = await getMongoDb();
  const now = new Date();
  const config = getQuotationRateAttentionConfig();
  const cutoff = new Date(now.getTime() - config.reminderHours * 3_600_000);
  const items = await getQuotationRateSubmissions(db).find({
    $or: [
      { status: "awaiting_rate" },
      { status: "sent_to_client", outcomeStatus: null },
    ],
  }).sort({ createdAt: 1 }).limit(1000).toArray();
  const reminderBucket = Math.floor(now.getTime() / (config.reminderHours * 3_600_000));
  for (const item of items) {
    const waiting = item.status === "awaiting_rate"
      && elapsedWaiting(item, now) >= config.amberHours * 3_600_000;
    const sentAt = item.sentToClientAt ?? item.updatedAt;
    const outcomeDue = item.status === "sent_to_client" && !item.outcomeStatus
      && now.getTime() - sentAt.getTime() >= config.noOutcomeDays * 86_400_000;
    if (!waiting && !outcomeDue) continue;
    const repeatDue = !item.attentionLastReminderAt || item.attentionLastReminderAt <= cutoff;
    if (!repeatDue) continue;
    const claimed = await getQuotationRateSubmissions(db).updateOne(
      {
        _id: item._id,
        status: item.status,
        ...(item.status === "sent_to_client" ? { outcomeStatus: null } : {}),
        attentionLastReminderAt: item.attentionLastReminderAt ?? null,
      },
      { $set: { attentionLastReminderAt: now } },
    );
    if (!claimed.matchedCount) continue;
    const latest = await getQuotationRateSubmissions(db).findOne({ _id: item._id });
    const stillWaiting = latest?.status === "awaiting_rate"
      && elapsedWaiting(latest, now) >= config.amberHours * 3_600_000;
    const stillNeedsOutcome = latest?.status === "sent_to_client" && !latest.outcomeStatus
      && now.getTime() - (latest.sentToClientAt ?? latest.updatedAt).getTime() >= config.noOutcomeDays * 86_400_000;
    if (!stillWaiting && !stillNeedsOutcome) continue;
    await notifyRecipients({
      type: "rate_overdue",
      title: "Quotation needs attention",
      message: stillNeedsOutcome
        ? `${item._id} for ${item.clientName} was sent without an outcome.`
        : `${item._id} for ${item.clientName} has been waiting for a rate.`,
      url: stillNeedsOutcome ? "/quotations-rates?section=quotations" : "/quotations-rates?section=rates&pane=requests",
      quotationId: item._id,
    }, `overdue:${item._id}:${reminderBucket}`);
  }
}
