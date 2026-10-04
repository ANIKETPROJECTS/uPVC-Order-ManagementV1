import {
  DecideQuotationApprovalBody,
  DecideQuotationApprovalParams,
  DecideQuotationApprovalResponse,
  GetQuotationApprovalSettingsResponse,
  ListQuotationApprovalsResponse,
  SubmitQuotationForApprovalParams,
  SubmitQuotationForApprovalResponse,
  UpdateQuotationApprovalSettingsBody,
  UpdateQuotationApprovalSettingsResponse,
} from "@workspace/api-zod";
import { Router, type Request, type RequestHandler } from "express";
import {
  getPublicUser,
  getQuotationApprovalSettings,
  getQuotations,
  getMongoDb,
  getUsers,
  type QuotationDocument,
  type UserDocument,
} from "../lib/mongo";
import { createAppNotification } from "../lib/notification-service";
import { logger } from "../lib/logger";
import { quotationResponse } from "./quotations";

const router = Router();
const SETTINGS_ID = "saved-quotation-approval";

type Actor = {
  id: string;
  name: string;
  roleId: string;
  permissions: Record<string, "none" | "view" | "edit">;
  masterAdmin: boolean;
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
    name: user.name,
    roleId: user.roleId,
    permissions: publicUser.permissions,
    masterAdmin: user.roleId === "master-admin",
  };
}

function isAdmin(actor: Actor): boolean {
  return actor.masterAdmin || actor.permissions["user-access"] === "edit";
}

function isEligibleApprover(
  user: Pick<UserDocument, "_id" | "roleId">,
  permissions: Record<string, "none" | "view" | "edit">,
): boolean {
  return (
    user.roleId === "master-admin" ||
    user.roleId === "approver" ||
    permissions["rate-approval"] === "edit"
  );
}

async function readApprovalSettings() {
  const db = await getMongoDb();
  const settings = await getQuotationApprovalSettings(db).findOne({
    _id: SETTINGS_ID,
  });
  const approver = settings?.approverUserId
    ? await getUsers(db).findOne({
        _id: settings.approverUserId,
        status: "active",
      })
    : null;
  const activeUsers = await getUsers(db)
    .find({ status: "active" })
    .sort({ name: 1 })
    .toArray();
  const resolved = await Promise.all(
    activeUsers.map(async (user) => ({
      user,
      publicUser: await getPublicUser(user, db),
    })),
  );
  const candidates = resolved
    .filter(({ user, publicUser }) =>
      isEligibleApprover(user, publicUser.permissions),
    )
    .map(({ user, publicUser }) => ({
      id: user._id,
      name: user.name,
      roleName: publicUser.roleName,
    }));
  return GetQuotationApprovalSettingsResponse.parse({
    approverUserId: approver?._id ?? null,
    approverName: approver?.name ?? null,
    candidates,
  });
}

async function appendNotification(
  userId: string,
  input: Parameters<typeof createAppNotification>[2],
): Promise<void> {
  try {
    await createAppNotification(await getMongoDb(), userId, input);
  } catch (error) {
    logger.error({ err: error, userId }, "Could not create quotation approval notification");
  }
}

router.get("/quotation-approval-settings", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  if (!isAdmin(actor)) {
    res.status(403).json({ error: "Administrator access required." });
    return;
  }
  res.json(await readApprovalSettings());
});

router.put("/quotation-approval-settings", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  if (!isAdmin(actor)) {
    res.status(403).json({ error: "Administrator access required." });
    return;
  }
  const parsed = UpdateQuotationApprovalSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const db = await getMongoDb();
  const { approverUserId } = parsed.data;
  let selectedApprover: UserDocument | null = null;
  if (approverUserId) {
    selectedApprover = await getUsers(db).findOne({
      _id: approverUserId,
      status: "active",
    });
    if (
      !selectedApprover ||
      !isEligibleApprover(
        selectedApprover,
        (await getPublicUser(selectedApprover, db)).permissions,
      )
    ) {
      res.status(400).json({
        error: "Choose an active user with the Approver role or rate-approval access.",
      });
      return;
    }
  }

  const pending = await getQuotations(db)
    .find({ status: "pending_approval", archivedAt: null })
    .toArray();
  if (!approverUserId && pending.length) {
    res.status(409).json({
      error: "Choose a replacement approver before clearing approval routing.",
    });
    return;
  }

  const previous = await getQuotationApprovalSettings(db).findOne({
    _id: SETTINGS_ID,
  });
  const now = new Date();
  await getQuotationApprovalSettings(db).updateOne(
    { _id: SETTINGS_ID },
    {
      $set: { approverUserId, updatedBy: actor.id, updatedAt: now },
      $setOnInsert: { _id: SETTINGS_ID },
    },
    { upsert: true },
  );

  if (
    selectedApprover &&
    selectedApprover._id !== previous?.approverUserId &&
    pending.length
  ) {
    await getQuotations(db).updateMany(
      { status: "pending_approval", archivedAt: null },
      {
        $set: {
          approvalApproverId: selectedApprover._id,
          approvalLastReminderAt: now,
        },
      },
    );
    for (const quote of pending) {
      await appendNotification(selectedApprover._id, {
        type: "approval_request",
        title: "Quotation approval reassigned",
        message: `${quote.quoteNo} for ${quote.customerName} is waiting for your review.`,
        url: `/quotation-approvals?quote=${encodeURIComponent(quote._id)}`,
        quotationId: quote._id,
      });
    }
  }

  res.json(await readApprovalSettings());
});

router.get("/quotation-approvals", async (req, res): Promise<void> => {
  const actor = await getActor(req, res);
  if (!actor) return;
  const db = await getMongoDb();
  const settings = await getQuotationApprovalSettings(db).findOne({
    _id: SETTINGS_ID,
  });
  const isAssignedApprover = settings?.approverUserId === actor.id;
  if (
    !isAdmin(actor) &&
    (!isAssignedApprover ||
      !isEligibleApprover(
        { _id: actor.id, roleId: actor.roleId },
        actor.permissions,
      ))
  ) {
    res.status(403).json({ error: "You are not the configured quotation approver." });
    return;
  }
  const filter = {
    status: "pending_approval" as const,
    archivedAt: null,
    ...(actor.masterAdmin ? {} : { approvalApproverId: actor.id }),
  };
  const quotations = await getQuotations(db)
    .find(filter)
    .sort({ approvalSubmittedAt: 1, updatedAt: 1 })
    .toArray();
  const userIds = [
    ...new Set(
      quotations.flatMap((quotation) => [
        quotation.createdBy,
        quotation.approvalApproverId ?? "",
      ]).filter(Boolean),
    ),
  ];
  const users = await getUsers(db).find({ _id: { $in: userIds } }).toArray();
  const names = new Map(users.map((user) => [user._id, user.name]));
  res.json(
    ListQuotationApprovalsResponse.parse(
      quotations.map((quotation) => ({
        quotation: quotationResponse(quotation),
        submittedByName: names.get(quotation.createdBy) ?? "Former user",
        approverName:
          names.get(quotation.approvalApproverId ?? "") ?? "Unassigned approver",
        submittedAt: (
          quotation.approvalSubmittedAt ?? quotation.updatedAt
        ).toISOString(),
      })),
    ),
  );
});

router.post(
  "/quotations/:quotationId/submit-for-approval",
  async (req, res): Promise<void> => {
    const actor = await getActor(req, res);
    if (!actor) return;
    if (
      !actor.masterAdmin &&
      actor.permissions["quotation-builder"] !== "edit"
    ) {
      res.status(403).json({ error: "Quotation edit access is required." });
      return;
    }
    const params = SubmitQuotationForApprovalParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const db = await getMongoDb();
    const existing = await getQuotations(db).findOne({
      _id: params.data.quotationId,
      archivedAt: null,
    });
    if (!existing) {
      res.status(404).json({ error: "Quotation not found." });
      return;
    }
    if (existing.status !== "draft" && existing.status !== "rejected") {
      res.status(409).json({
        error: "Only draft or rejected quotations can be sent for approval.",
      });
      return;
    }

    const settings = await getQuotationApprovalSettings(db).findOne({
      _id: SETTINGS_ID,
    });
    const approver = settings?.approverUserId
      ? await getUsers(db).findOne({
          _id: settings.approverUserId,
          status: "active",
        })
      : null;
    if (
      !approver ||
      !isEligibleApprover(
        approver,
        (await getPublicUser(approver, db)).permissions,
      )
    ) {
      res.status(409).json({
        error: "An administrator must select an active quotation approver first.",
      });
      return;
    }

    const now = new Date();
    const updated = await getQuotations(db).findOneAndUpdate(
      {
        _id: existing._id,
        archivedAt: null,
        status: { $in: ["draft", "rejected"] },
      },
      {
        $set: {
          status: "pending_approval",
          requiresRateApproval: (existing.items ?? []).some(
            (item) =>
              item.rateOverridden ??
              Math.abs(
                item.ratePerSqFt -
                  (item.catalogueRatePerSqFt ?? item.ratePerSqFt),
              ) > 0.005,
          ),
          approvalApproverId: approver._id,
          approvalSubmittedAt: now,
          approvalLastReminderAt: now,
          updatedBy: actor.id,
          updatedAt: now,
        },
        $push: {
          approvalHistory: {
            action: "submitted",
            actorId: actor.id,
            actorName: actor.name,
            reason: null,
            createdAt: now,
          },
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      res.status(409).json({ error: "This quotation has already changed state." });
      return;
    }

    await appendNotification(approver._id, {
      type: "approval_request",
      title: "Quotation needs approval",
      message: `${updated.quoteNo} for ${updated.customerName} is waiting for your review.`,
      url: `/quotation-approvals?quote=${encodeURIComponent(updated._id)}`,
      quotationId: updated._id,
    });
    res.json(SubmitQuotationForApprovalResponse.parse(quotationResponse(updated)));
  },
);

router.post(
  "/quotation-approvals/:quotationId/decision",
  async (req, res): Promise<void> => {
    const actor = await getActor(req, res);
    if (!actor) return;
    const params = DecideQuotationApprovalParams.safeParse(req.params);
    const parsed = DecideQuotationApprovalBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const reason = parsed.data.reason?.trim() ?? "";
    if (parsed.data.decision === "rejected" && !reason) {
      res.status(400).json({ error: "Enter a reason before rejecting." });
      return;
    }

    const db = await getMongoDb();
    const existing = await getQuotations(db).findOne({
      _id: params.data.quotationId,
      archivedAt: null,
      status: "pending_approval",
    });
    if (!existing) {
      res.status(404).json({ error: "Pending quotation not found." });
      return;
    }
    if (
      !actor.masterAdmin &&
      (existing.approvalApproverId !== actor.id ||
        !isEligibleApprover(
          { _id: actor.id, roleId: actor.roleId },
          actor.permissions,
        ))
    ) {
      res.status(403).json({ error: "This quotation is assigned to another approver." });
      return;
    }

    const now = new Date();
    const status = parsed.data.decision;
    const updated = await getQuotations(db).findOneAndUpdate(
      {
        _id: existing._id,
        archivedAt: null,
        status: "pending_approval",
        ...(actor.masterAdmin ? {} : { approvalApproverId: actor.id }),
      },
      {
        $set: {
          status,
          updatedBy: actor.id,
          updatedAt: now,
        },
        $push: {
          approvalHistory: {
            action: status,
            actorId: actor.id,
            actorName: actor.name,
            reason: reason || null,
            createdAt: now,
          },
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      res.status(409).json({ error: "This quotation has already received a decision." });
      return;
    }

    const decisionLabel = status === "approved" ? "approved" : "rejected";
    const decisionMessage =
      status === "rejected" && reason
        ? `${updated.quoteNo} was rejected. Reason: ${reason}`
        : `${updated.quoteNo} was approved.`;
    await appendNotification(updated.createdBy, {
      type: "approval_decision",
      title: `Quotation ${decisionLabel}`,
      message: decisionMessage,
      url: `/quotation-builder?quote=${encodeURIComponent(updated._id)}&section=drafts`,
      quotationId: updated._id,
    });
    res.json(DecideQuotationApprovalResponse.parse(quotationResponse(updated)));
  },
);

async function sendHourlyApprovalReminders(): Promise<void> {
  const db = await getMongoDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - 60 * 60 * 1000);
  const candidates = await getQuotations(db)
    .find({
      status: "pending_approval",
      archivedAt: null,
      approvalSubmittedAt: { $lte: cutoff },
      $or: [
        { approvalLastReminderAt: { $lte: cutoff } },
        { approvalLastReminderAt: { $exists: false } },
        { approvalLastReminderAt: null },
      ],
    })
    .limit(100)
    .toArray();

  for (const quotation of candidates) {
    const approverId = quotation.approvalApproverId;
    if (!approverId) continue;
    const activeApprover = await getUsers(db).findOne({
      _id: approverId,
      status: "active",
    });
    if (!activeApprover) continue;
    const claimed = await getQuotations(db).updateOne(
      {
        _id: quotation._id,
        status: "pending_approval",
        approvalSubmittedAt: { $lte: cutoff },
        $or: [
          { approvalLastReminderAt: { $lte: cutoff } },
          { approvalLastReminderAt: { $exists: false } },
          { approvalLastReminderAt: null },
        ],
      },
      { $set: { approvalLastReminderAt: now } },
    );
    if (!claimed.matchedCount) continue;
    await appendNotification(approverId, {
      type: "approval_reminder",
      title: "Quotation approval reminder",
      message: `${quotation.quoteNo} for ${quotation.customerName} is still awaiting your review.`,
      url: `/quotation-approvals?quote=${encodeURIComponent(quotation._id)}`,
      quotationId: quotation._id,
    });
  }
}

const reminderTimer = setInterval(() => {
  void sendHourlyApprovalReminders().catch((error: unknown) => {
    logger.error({ err: error }, "Hourly quotation approval reminder check failed");
  });
}, 60 * 1000);
reminderTimer.unref();

export default router;