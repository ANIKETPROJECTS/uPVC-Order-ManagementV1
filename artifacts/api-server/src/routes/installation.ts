import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import {
  CreateOrderGrievanceBody,
  CreateOrderGrievanceParams,
  CreateOrderGrievanceResponse,
  ListInstallationOrdersResponse,
  ListOrderGrievancesParams,
  ListOrderGrievancesResponse,
  UpdateInstallationOrderBody,
  UpdateInstallationOrderParams,
  UpdateInstallationOrderResponse,
  AssignInstallationOrderBody,
  AssignInstallationOrderParams,
  AssignInstallationOrderResponse,
  UnassignInstallationOrderParams,
  GetPublicInstallationShareParams,
  GetPublicInstallationShareResponse,
  UploadInstallationDrawingParams,
  UploadInstallationDrawingResponse,
  DeleteInstallationDrawingParams,
  GetPublicInstallationDrawingParams,
} from "@workspace/api-zod";
import { Router } from "express";
import {
  getInstallationTeams,
  getInstallations,
  getMongoClient,
  getMongoDb,
  getOrderActivity,
  getOrderGrievances,
  getOrderWindows,
  getOrders,
  type InstallationSubteamDocument,
  type InstallationDocument,
  type InstallationTeamDocument,
  type OrderDocument,
  type OrderGrievanceDocument,
} from "../lib/mongo";
import {
  removeProjectUpload,
  resolveProjectUploadPath,
  storeProjectUpload,
} from "../lib/project-upload-storage";
import { getActor, resolveEligibleInstallationMembers } from "./installation-access";

const router = Router();
const MAX_INSTALLATION_PDF_BYTES = 10 * 1024 * 1024;

function installationResponse(
  order: OrderDocument,
  installation?: InstallationDocument,
  windowQty = 0,
  team?: InstallationTeamDocument | null,
) {
  const subteam = team?.subteams.find((candidate) => candidate._id === installation?.subteamId);
  return {
    id: order._id,
    orderId: order.orderId,
    clientName: order.clientName,
    locationName: order.locationName,
    orderStatus: order.status,
    dispatchStatus: order.dispatchStatus ?? "pending_dispatch",
    installationStatus: installation?.installationStatus ?? (order.status === "installed" ? "installed" : "pending"),
    installationDate: installation?.installationDate
      ? new Date(`${installation.installationDate}T00:00:00.000Z`)
      : null,
    issueReason: installation?.issueReason ?? null,
    windowQty,
    teamId: installation?.teamId ?? null,
    teamName: team?.name ?? installation?.teamNameSnapshot ?? null,
    subteamId: installation?.subteamId ?? null,
    subteamName: subteam?.name ?? installation?.subteamNameSnapshot ?? null,
    scheduledDate: installation?.scheduledDate
      ? new Date(`${installation.scheduledDate}T00:00:00.000Z`)
      : null,
    assignedMembers: installation?.assignedMembers ?? [],
    actualSquareFootage: installation?.actualSquareFootage ?? null,
    shareToken: installation?.shareToken ?? null,
    drawingFilename: installation?.drawingFilename ?? null,
    drawingSizeBytes: installation?.drawingSizeBytes ?? null,
    updatedAt: installation?.updatedAt ?? order.updatedAt,
  };
}

function istDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function grievanceResponse(item: OrderGrievanceDocument) {
  return {
    id: item._id,
    orderRecordId: item.orderRecordId,
    orderId: item.orderId,
    description: item.description,
    reportedAt: new Date(`${item.reportedAt}T00:00:00.000Z`),
    status: item.status,
    createdBy: item.createdByName,
    createdAt: item.createdAt,
  };
}

class InstallationConflict extends Error {}

function safeFilename(filename: string) {
  return filename.replace(/[\x00-\x1f\x7f"]/g, "_").replace(/[\\/]/g, "_");
}

function contentDisposition(disposition: "attachment" | "inline", filename: string) {
  const clean = safeFilename(filename);
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(clean).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function sendInstallationDrawing(
  req: Request,
  res: Response,
  storagePath: string,
  filename: string,
): void {
  const filePath = resolveProjectUploadPath(storagePath);
  if (!filePath) {
    res.status(404).json({ error: "Installation drawing content not found." });
    return;
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    contentDisposition(req.query.download === "1" ? "attachment" : "inline", filename),
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(filePath, { dotfiles: "deny" }, (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: "Installation drawing content not found." });
    else if (error) req.log.error({ err: error, storagePath }, "Failed to serve an installation drawing");
  });
}

function readInstallationPdf(
  req: Request,
  res: Response,
  next: (error?: unknown) => void,
  done: (body: Buffer) => Promise<void>,
): void {
  const finish = (body: Buffer) => {
    void Promise.resolve().then(() => done(body)).catch(next);
  };
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > MAX_INSTALLATION_PDF_BYTES) {
      res.status(413).json({ error: "PDF must be 10 MiB or smaller." });
      return;
    }
    finish(req.body);
    return;
  }
  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_INSTALLATION_PDF_BYTES) {
    res.status(413).json({ error: "PDF must be 10 MiB or smaller." });
    req.resume();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  req.on("data", (chunk: Buffer) => {
    if (tooLarge) return;
    size += chunk.length;
    if (size > MAX_INSTALLATION_PDF_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      if (!res.headersSent) res.status(413).json({ error: "PDF must be 10 MiB or smaller." });
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (!tooLarge) finish(Buffer.concat(chunks, size));
  });
  req.on("aborted", () => next(new Error("Installation drawing upload was interrupted.")));
  req.on("error", next);
}

async function getActiveShare(db: Awaited<ReturnType<typeof getMongoDb>>, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const installation = await getInstallations(db).findOne({ shareToken: token });
  if (!installation?.teamId) return null;
  const [order, team] = await Promise.all([
    getOrders(db).findOne({ _id: installation.orderRecordId }),
    getInstallationTeams(db).findOne({ _id: installation.teamId }),
  ]);
  if (!order || order.dispatchStatus !== "delivered") return null;
  return { installation, order, team };
}

router.get("/installation/share/:token", async (req, res): Promise<void> => {
  const parsed = GetPublicInstallationShareParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(404).json({ error: "Installation link not found." });
    return;
  }
  const db = await getMongoDb();
  const share = await getActiveShare(db, parsed.data.token);
  if (!share) {
    res.status(404).json({ error: "This installation link is invalid or no longer active." });
    return;
  }
  const { installation, order, team } = share;
  const subteam = team?.subteams.find((candidate: InstallationSubteamDocument) => candidate._id === installation.subteamId);
  const windowQty = await getOrderWindows(db).countDocuments({
    orderRecordId: order._id,
    archivedAt: { $exists: false },
  });
  res.setHeader("Cache-Control", "no-store");
  res.json(GetPublicInstallationShareResponse.parse({
    orderId: order.orderId,
    clientName: order.clientName,
    locationName: order.locationName,
    windowQty,
    teamName: team?.name ?? installation.teamNameSnapshot ?? "Installation team",
    subteamName: subteam?.name ?? installation.subteamNameSnapshot ?? null,
    scheduledDate: installation.scheduledDate
      ? new Date(`${installation.scheduledDate}T00:00:00.000Z`)
      : null,
    actualSquareFootage: installation.actualSquareFootage ?? null,
    drawingFilename: installation.drawingFilename ?? null,
    drawingUrl: installation.drawingStoragePath
      ? `/api/installation/share/${parsed.data.token}/drawing`
      : null,
  }));
});

router.get("/installation/share/:token/drawing", async (req, res): Promise<void> => {
  const parsed = GetPublicInstallationDrawingParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(404).json({ error: "Installation drawing not found." });
    return;
  }
  const db = await getMongoDb();
  const share = await getActiveShare(db, parsed.data.token);
  if (!share?.installation.drawingStoragePath || !share.installation.drawingFilename) {
    res.status(404).json({ error: "No drawing is available for this installation." });
    return;
  }
  sendInstallationDrawing(req, res, share.installation.drawingStoragePath, share.installation.drawingFilename);
});

router.get("/installation/orders/:id/drawing", async (req, res): Promise<void> => {
  const params = DeleteInstallationDrawingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const actor = await getActor(req, res, "installation", "view");
  if (!actor) return;
  const db = await getMongoDb();
  const order = await getOrders(db).findOne({ _id: params.data.id, dispatchStatus: "delivered" });
  if (!order) {
    res.status(404).json({ error: "Delivered installation not found." });
    return;
  }
  const installation = await getInstallations(db).findOne({
    orderRecordId: order._id,
    drawingStoragePath: { $type: "string" },
  });
  if (!installation?.drawingStoragePath || !installation.drawingFilename) {
    res.status(404).json({ error: "Installation drawing not found." });
    return;
  }
  sendInstallationDrawing(req, res, installation.drawingStoragePath, installation.drawingFilename);
});

router.post(
  "/installation/orders/:id/drawing/:filename",
  (req, res, next) => {
    const parsed = UploadInstallationDrawingParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    next();
  },
  async (req, res, next): Promise<void> => {
    const params = UploadInstallationDrawingParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const actor = await getActor(req, res, "installation", "edit");
    if (!actor) return;
    const db = await getMongoDb();
    const order = await getOrders(db).findOne({ _id: params.data.id, dispatchStatus: "delivered" });
    if (!order) {
      res.status(404).json({ error: "Delivered installation not found." });
      return;
    }
    const installations = getInstallations(db);
    const installation = await installations.findOne({ _id: order._id });
    readInstallationPdf(req, res, next, async (body) => {
      const filename = safeFilename(params.data.filename);
      const declaredType = String(req.headers["content-type"] ?? "").split(";")[0].toLowerCase();
      if (
        !filename.toLowerCase().endsWith(".pdf") ||
        body.length < 5 ||
        body.subarray(0, 5).toString("ascii") !== "%PDF-" ||
        (declaredType !== "application/pdf" && declaredType !== "application/octet-stream")
      ) {
        res.status(400).json({ error: "Choose a non-empty PDF file." });
        return;
      }
      const storagePath = await storeProjectUpload("installation-drawings", filename, body);
      let updated: InstallationDocument | null;
      try {
        updated = await installations.findOneAndUpdate(
          { _id: order._id },
          {
            $set: {
              drawingFilename: filename,
              drawingSizeBytes: body.length,
              drawingStoragePath: storagePath,
              updatedBy: actor.id,
              updatedAt: new Date(),
            },
            $setOnInsert: {
              _id: order._id,
              orderRecordId: order._id,
              installationStatus: order.status === "installed" ? "installed" : "pending",
              installationDate: null,
              issueReason: null,
              createdAt: new Date(),
            },
          },
          { returnDocument: "after", upsert: true },
        );
      } catch (error) {
        await removeProjectUpload(storagePath).catch((cleanupError: unknown) =>
          req.log.error({ err: cleanupError }, "Failed to clean up an installation drawing after a database error"),
        );
        throw error;
      }
      if (!updated) throw new Error("Installation drawing was not saved.");
      if (installation?.drawingStoragePath) {
        await removeProjectUpload(installation.drawingStoragePath).catch((cleanupError: unknown) =>
          req.log.error({ err: cleanupError }, "Failed to remove the replaced installation drawing"),
        );
      }
      res.json(UploadInstallationDrawingResponse.parse({ filename, sizeBytes: body.length }));
    });
  },
);

router.delete("/installation/orders/:id/drawing", async (req, res): Promise<void> => {
  const params = DeleteInstallationDrawingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const actor = await getActor(req, res, "installation", "edit");
  if (!actor) return;
  const db = await getMongoDb();
  const installation = await getInstallations(db).findOne({
    orderRecordId: params.data.id,
    drawingStoragePath: { $type: "string" },
  });
  if (!installation?.drawingStoragePath) {
    res.status(404).json({ error: "Installation drawing not found." });
    return;
  }
  const result = await getInstallations(db).updateOne(
    { _id: installation._id, drawingStoragePath: installation.drawingStoragePath },
    {
      $unset: { drawingFilename: "", drawingSizeBytes: "", drawingStoragePath: "" },
      $set: { updatedBy: actor.id, updatedAt: new Date() },
    },
  );
  if (result.modifiedCount !== 1) {
    res.status(409).json({ error: "The drawing changed while it was being removed. Refresh and try again." });
    return;
  }
  await removeProjectUpload(installation.drawingStoragePath).catch((error: unknown) =>
    req.log.error({ err: error }, "Failed to remove a deleted installation drawing"),
  );
  res.status(204).send();
});

router.get("/installation/orders", async (req, res): Promise<void> => {
  const actor = await getActor(req, res, "installation", "view");
  if (!actor) return;

  const db = await getMongoDb();
  const orders = await getOrders(db)
    .find({ dispatchStatus: "delivered" })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();
  if (!orders.length) {
    res.json(ListInstallationOrdersResponse.parse([]));
    return;
  }

  const installations = await getInstallations(db)
    .find({ _id: { $in: orders.map((order) => order._id) } })
    .toArray();
  for (const installation of installations) {
    if (!installation.teamId || installation.shareToken) continue;
    const token = randomBytes(32).toString("hex");
    const updated = await getInstallations(db).updateOne(
      {
        _id: installation._id,
        teamId: installation.teamId,
        $or: [{ shareToken: { $exists: false } }, { shareToken: null }],
      },
      { $set: { shareToken: token } },
    );
    if (updated.modifiedCount === 1) {
      installation.shareToken = token;
    } else {
      const refreshed = await getInstallations(db).findOne({ _id: installation._id });
      installation.shareToken = refreshed?.shareToken ?? null;
    }
  }
  const teams = await getInstallationTeams(db).find().toArray();
  const windows = await getOrderWindows(db).find({
    orderRecordId: { $in: orders.map((order) => order._id) },
    archivedAt: { $exists: false },
  }).toArray();
  const installationsByOrder = new Map(installations.map((item) => [item.orderRecordId, item]));
  const teamsById = new Map(teams.map((team) => [team._id, team]));
  const windowQtyByOrder = new Map<string, number>();
  for (const window of windows) {
    windowQtyByOrder.set(window.orderRecordId, (windowQtyByOrder.get(window.orderRecordId) ?? 0) + 1);
  }
  res.json(ListInstallationOrdersResponse.parse(orders.map((order) =>
    installationResponse(
      order,
      installationsByOrder.get(order._id),
      windowQtyByOrder.get(order._id) ?? 0,
      teamsById.get(installationsByOrder.get(order._id)?.teamId ?? "") ?? null,
    ),
  )));
});

router.patch("/installation/orders/:id/assignment", async (req, res): Promise<void> => {
  const params = AssignInstallationOrderParams.safeParse(req.params);
  const body = AssignInstallationOrderBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "" : body.error.message });
    return;
  }
  const actor = await getActor(req, res, "installation", "edit");
  if (!actor) return;

  const db = await getMongoDb();
  const session = (await getMongoClient()).startSession();
  const scheduledDate = body.data.scheduledDate.toISOString().slice(0, 10);
  let updatedOrder: OrderDocument | null = null;
  let updatedInstallation: InstallationDocument | null = null;
  let assignedTeam: InstallationTeamDocument | null = null;
  try {
    await session.withTransaction(async () => {
      const order = await getOrders(db).findOne(
        { _id: params.data.id, dispatchStatus: "delivered" },
        { session },
      );
      if (!order) {
        const existing = await getOrders(db).findOne({ _id: params.data.id }, { session });
        if (!existing) throw new InstallationConflict("Order not found.");
        throw new InstallationConflict("Only delivered orders can be scheduled in Installation.");
      }
      if (order.status === "installed") {
        throw new InstallationConflict("Installed orders cannot be reassigned.");
      }

      const team = await getInstallationTeams(db).findOne({ _id: body.data.teamId }, { session });
      if (!team) throw new InstallationConflict("Installation team not found.");
      const subteam = body.data.subteamId
        ? team.subteams.find((candidate) => candidate._id === body.data.subteamId)
        : null;
      if (body.data.subteamId && !subteam) {
        throw new InstallationConflict("This subdivision is no longer part of the selected team. Refresh and try again.");
      }
      const eligibleMemberIds = new Set(subteam?.memberIds ?? team.memberIds);
      if (body.data.memberIds.some((memberId) => !eligibleMemberIds.has(memberId))) {
        throw new InstallationConflict("Choose members from the selected team or subdivision.");
      }
      const assignedMembers = await resolveEligibleInstallationMembers(db, body.data.memberIds);
      if (!assignedMembers?.length) {
        throw new InstallationConflict("Choose active users who have Installation access.");
      }

      const existingInstallation = await getInstallations(db).findOne({ _id: order._id }, { session });
      if (existingInstallation?.installationStatus === "installed") {
        throw new InstallationConflict("Installed orders cannot be reassigned.");
      }
      const sameAssignment = existingInstallation?.teamId === team._id
        && (existingInstallation.subteamId ?? null) === (subteam?._id ?? null);
      const shareToken = sameAssignment && existingInstallation?.shareToken
        ? existingInstallation.shareToken
        : randomBytes(32).toString("hex");
      const now = new Date();
      const result = await getInstallations(db).findOneAndUpdate(
        { _id: order._id },
        {
          $set: {
            orderRecordId: order._id,
            teamId: team._id,
            teamNameSnapshot: team.name,
            subteamId: subteam?._id ?? null,
            subteamNameSnapshot: subteam?.name ?? null,
            scheduledDate,
            assignedMembers,
            actualSquareFootage: body.data.actualSquareFootage,
            shareToken,
            updatedBy: actor.id,
            updatedAt: now,
          },
          $setOnInsert: {
            installationStatus: "pending",
            installationDate: null,
            issueReason: null,
            createdAt: now,
          },
        },
        { returnDocument: "after", upsert: true, session },
      );
      if (!result) throw new InstallationConflict("The installation assignment could not be saved.");

      const changes = [
        `Team ${team.name}${subteam ? ` · ${subteam.name}` : ""}`,
        `scheduled ${scheduledDate}`,
        `members ${assignedMembers.map((member) => member.name).join(", ")}`,
      ];
      await getOrderActivity(db).insertOne({
        _id: randomUUID(),
        orderRecordId: order._id,
        actorId: actor.id,
        actorName: actor.name,
        action: "installation_assignment",
        summary: `${order.orderId} installation assignment: ${changes.join("; ")}.`,
        createdAt: now,
      }, { session });

      updatedOrder = order;
      updatedInstallation = result;
      assignedTeam = team;
    });
  } catch (error) {
    if (error instanceof InstallationConflict) {
      res.status(error.message === "Order not found." || error.message === "Installation team not found." ? 404 : 409)
        .json({ error: error.message });
      return;
    }
    throw error;
  } finally {
    await session.endSession();
  }

  const savedOrder = updatedOrder as OrderDocument | null;
  const savedInstallation = updatedInstallation as InstallationDocument | null;
  const savedTeam = assignedTeam as InstallationTeamDocument | null;
  if (!savedOrder || !savedInstallation) {
    res.status(409).json({ error: "The installation assignment could not be saved." });
    return;
  }
  const windowQty = await getOrderWindows(db).countDocuments({
    orderRecordId: savedOrder._id,
    archivedAt: { $exists: false },
  });
  res.json(AssignInstallationOrderResponse.parse(
    installationResponse(savedOrder, savedInstallation, windowQty, savedTeam),
  ));
});

router.delete("/installation/orders/:id/assignment", async (req, res): Promise<void> => {
  const params = UnassignInstallationOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const actor = await getActor(req, res, "installation", "edit");
  if (!actor) return;

  const db = await getMongoDb();
  const session = (await getMongoClient()).startSession();
  try {
    await session.withTransaction(async () => {
      const orders = getOrders(db);
      const order = await orders.findOne(
        { _id: params.data.id, dispatchStatus: "delivered" },
        { session },
      );
      if (!order) {
        const existing = await orders.findOne({ _id: params.data.id }, { session });
        if (!existing) throw new InstallationConflict("Order not found.");
        throw new InstallationConflict("Only delivered orders can be unassigned from Installation.");
      }
      if (order.status === "installed") {
        throw new InstallationConflict("Installed orders cannot be unassigned.");
      }

      const installations = getInstallations(db);
      const installation = await installations.findOne({ _id: order._id }, { session });
      if (!installation?.teamId) return;
      if (installation.installationStatus === "installed") {
        throw new InstallationConflict("Installed orders cannot be unassigned.");
      }

      const team = await getInstallationTeams(db).findOne({ _id: installation.teamId }, { session });
      const teamName = team?.name ?? installation.teamNameSnapshot ?? "installation team";
      const subteamName = team?.subteams.find((candidate) => candidate._id === installation.subteamId)?.name
        ?? installation.subteamNameSnapshot
        ?? null;
      const scheduledDate = installation.scheduledDate ?? null;
      const assignedMemberCount = installation.assignedMembers?.length ?? 0;
      const now = new Date();
      const result = await installations.updateOne(
        {
          _id: order._id,
          teamId: installation.teamId,
          installationStatus: { $ne: "installed" },
        },
        {
          $set: {
            teamId: null,
            teamNameSnapshot: null,
            subteamId: null,
            subteamNameSnapshot: null,
            assignedMembers: [],
            shareToken: null,
            updatedBy: actor.id,
            updatedAt: now,
          },
        },
        { session },
      );
      if (result.modifiedCount !== 1) {
        throw new InstallationConflict("The installation assignment changed before it could be unassigned.");
      }

      await getOrderActivity(db).insertOne({
        _id: randomUUID(),
        orderRecordId: order._id,
        actorId: actor.id,
        actorName: actor.name,
        action: "installation_assignment",
        summary: `${order.orderId} was unassigned from ${teamName}${subteamName ? ` · ${subteamName}` : ""}; ${assignedMemberCount} member${assignedMemberCount === 1 ? "" : "s"} cleared.${scheduledDate ? ` Scheduled date ${scheduledDate} retained.` : ""}`,
        createdAt: now,
      }, { session });
    });
  } catch (error) {
    if (error instanceof InstallationConflict) {
      res.status(error.message === "Order not found." ? 404 : 409).json({ error: error.message });
      return;
    }
    throw error;
  } finally {
    await session.endSession();
  }

  res.status(204).send();
});

router.patch("/installation/orders/:id", async (req, res): Promise<void> => {
  const params = UpdateInstallationOrderParams.safeParse(req.params);
  const body = UpdateInstallationOrderBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "" : body.error.message });
    return;
  }
  const actor = await getActor(req, res, "installation", "edit");
  if (!actor) return;

  const issueReason = body.data.installationStatus === "issue"
    ? body.data.issueReason?.trim() ?? ""
    : "";
  if (body.data.installationStatus === "issue" && !issueReason) {
    res.status(400).json({ error: "Add a reason before recording an installation issue." });
    return;
  }

  const db = await getMongoDb();
  const session = (await getMongoClient()).startSession();
  let updatedOrder: OrderDocument | null = null;
  let updatedInstallation: InstallationDocument | null = null;
  const now = new Date();
  const installationDate = body.data.installationDate.toISOString().slice(0, 10);

  try {
    await session.withTransaction(async () => {
      const orders = getOrders(db);
      const order = await orders.findOne(
        { _id: params.data.id, dispatchStatus: "delivered" },
        { session },
      );
      if (!order) {
        const existing = await orders.findOne({ _id: params.data.id }, { session });
        if (!existing) throw new InstallationConflict("Order not found.");
        throw new InstallationConflict("Only delivered orders can be updated in Installation.");
      }
      if (order.status === "installed" && body.data.installationStatus === "issue") {
        throw new InstallationConflict("Record a post-installation complaint in the Grievances tab instead.");
      }

      if (body.data.installationStatus === "installed") {
        if (order.status !== "installed") {
          const assignment = await getInstallations(db).findOne({ _id: order._id }, { session });
          const scheduledDate = assignment?.scheduledDate ?? null;
          if (!assignment?.teamId || !scheduledDate) {
            throw new InstallationConflict("Assign an installation team and schedule date before marking this order installed.");
          }
          if (scheduledDate > istDateKey(now)) {
            throw new InstallationConflict("This order cannot be marked installed before its scheduled installation date.");
          }
          if (installationDate < scheduledDate) {
            throw new InstallationConflict("The installation date cannot be earlier than the scheduled date.");
          }
        }
        const result = await orders.findOneAndUpdate(
          { _id: order._id, dispatchStatus: "delivered" },
          { $set: { status: "installed", updatedAt: now, updatedBy: actor.id } },
          { returnDocument: "after", session },
        );
        if (!result) throw new InstallationConflict("The order changed before installation could be saved.");
        updatedOrder = result;
      } else {
        updatedOrder = order;
      }

      const result = await getInstallations(db).findOneAndUpdate(
        { _id: order._id },
        {
          $set: {
            orderRecordId: order._id,
            installationStatus: body.data.installationStatus,
            installationDate,
            issueReason: body.data.installationStatus === "issue" ? issueReason : null,
            updatedBy: actor.id,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { returnDocument: "after", upsert: true, session },
      );
      if (!result) throw new InstallationConflict("The installation update could not be saved.");
      updatedInstallation = result;

      await getOrderActivity(db).insertOne({
        _id: randomUUID(),
        orderRecordId: order._id,
        actorId: actor.id,
        actorName: actor.name,
        action: body.data.installationStatus === "issue" ? "installation_issue" : "installation",
        summary: body.data.installationStatus === "issue"
          ? `Installation issue recorded for ${order.orderId} on ${installationDate}: ${issueReason}`
          : `${order.orderId} marked installed on ${installationDate}.`,
        createdAt: now,
      }, { session });
    });
  } catch (error) {
    if (error instanceof InstallationConflict) {
      res.status(error.message === "Order not found." ? 404 : 409).json({ error: error.message });
      return;
    }
    throw error;
  } finally {
    await session.endSession();
  }

  const savedOrder = updatedOrder as OrderDocument | null;
  const savedInstallation = updatedInstallation as InstallationDocument | null;
  if (!savedOrder || !savedInstallation) {
    res.status(409).json({ error: "The installation update could not be saved." });
    return;
  }
  const [team, windowQty] = await Promise.all([
    savedInstallation.teamId
      ? getInstallationTeams(db).findOne({ _id: savedInstallation.teamId })
      : Promise.resolve(null),
    getOrderWindows(db).countDocuments({
      orderRecordId: savedOrder._id,
      archivedAt: { $exists: false },
    }),
  ]);
  res.json(UpdateInstallationOrderResponse.parse(
    installationResponse(savedOrder, savedInstallation, windowQty, team),
  ));
});

router.get("/orders/:id/grievances", async (req, res): Promise<void> => {
  const params = ListOrderGrievancesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const actor = await getActor(req, res, "order-hub", "view");
  if (!actor) return;
  const db = await getMongoDb();
  const order = await getOrders(db).findOne({ _id: params.data.id });
  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  const grievances = await getOrderGrievances(db)
    .find({ orderRecordId: order._id })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(ListOrderGrievancesResponse.parse(grievances.map(grievanceResponse)));
});

router.post("/orders/:id/grievances", async (req, res): Promise<void> => {
  const params = CreateOrderGrievanceParams.safeParse(req.params);
  const body = CreateOrderGrievanceBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "" : body.error.message });
    return;
  }
  const actor = await getActor(req, res, "order-hub", "edit");
  if (!actor) return;
  const description = body.data.description.trim();
  if (!description) {
    res.status(400).json({ error: "Add details before recording a grievance." });
    return;
  }

  const db = await getMongoDb();
  const session = (await getMongoClient()).startSession();
  const grievanceId = randomUUID();
  const now = new Date();
  const item: OrderGrievanceDocument = {
    _id: grievanceId,
    orderRecordId: params.data.id,
    orderId: "",
    description,
    reportedAt: body.data.reportedAt.toISOString().slice(0, 10),
    status: "open",
    createdBy: actor.id,
    createdByName: actor.name,
    createdAt: now,
  };

  try {
    await session.withTransaction(async () => {
      const order = await getOrders(db).findOne({ _id: params.data.id }, { session });
      if (!order) throw new InstallationConflict("Order not found.");
      if (order.status !== "installed") {
        throw new InstallationConflict("Grievances can only be recorded after the order is installed.");
      }
      item.orderId = order.orderId;
      await getOrderGrievances(db).insertOne(item, { session });
      await getOrderActivity(db).insertOne({
        _id: randomUUID(),
        orderRecordId: order._id,
        actorId: actor.id,
        actorName: actor.name,
        action: "grievance",
        summary: `Customer grievance recorded for ${order.orderId}: ${item.description}`,
        createdAt: now,
      }, { session });
    });
  } catch (error) {
    if (error instanceof InstallationConflict) {
      res.status(error.message === "Order not found." ? 404 : 409).json({ error: error.message });
      return;
    }
    throw error;
  } finally {
    await session.endSession();
  }

  res.status(201).json(CreateOrderGrievanceResponse.parse(grievanceResponse(item)));
});

export default router;