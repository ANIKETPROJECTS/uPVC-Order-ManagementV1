import { randomUUID } from "node:crypto";
import {
  CreateInstallationTeamBody,
  CreateInstallationTeamResponse,
  DeleteInstallationTeamParams,
  ListInstallationTeamsResponse,
  ListInstallationUsersResponse,
  UpdateInstallationTeamBody,
  UpdateInstallationTeamParams,
  UpdateInstallationTeamResponse,
} from "@workspace/api-zod";
import { Router, type Response } from "express";
import {
  getInstallationTeams,
  getInstallations,
  getMongoDb,
  type InstallationSubteamDocument,
  type InstallationTeamDocument,
} from "../lib/mongo";
import {
  getInstallationActor,
  listEligibleInstallationUsers,
  resolveEligibleInstallationMembers,
} from "./installation-access";

const router = Router();

class TeamConflict extends Error {}
class TeamValidationError extends Error {}

function normalizeName(value: string) {
  return value.trim();
}

function normalizeIds(values: string[]) {
  return [...new Set(values)];
}

function teamResponse(team: InstallationTeamDocument) {
  return {
    id: team._id,
    name: team.name,
    memberIds: team.memberIds,
    subteams: team.subteams.map((subteam) => ({
      id: subteam._id,
      name: subteam.name,
      memberIds: subteam.memberIds,
    })),
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

async function validateMembers(db: Awaited<ReturnType<typeof getMongoDb>>, memberIds: string[]) {
  if (!await resolveEligibleInstallationMembers(db, memberIds)) {
    throw new TeamValidationError("Choose active users who have Installation access.");
  }
}

function normalizeSubteams(
  inputs: Array<{ id?: string; name: string; memberIds: string[] }>,
  teamMemberIds: string[],
  existing?: InstallationTeamDocument,
): InstallationSubteamDocument[] {
  const parentMembers = new Set(teamMemberIds);
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const existingById = new Map((existing?.subteams ?? []).map((item) => [item._id, item]));

  return inputs.map((input) => {
    const name = normalizeName(input.name);
    const nameLower = name.toLocaleLowerCase();
    const memberIds = normalizeIds(input.memberIds);
    if (!name) throw new TeamValidationError("Subdivision names cannot be blank.");
    if (seenNames.has(nameLower)) throw new TeamValidationError("Subdivision names must be unique within a team.");
    if (memberIds.length !== input.memberIds.length) {
      throw new TeamValidationError("Choose each subdivision member only once.");
    }
    if (memberIds.some((id) => !parentMembers.has(id))) {
      throw new TeamValidationError("Subdivision members must also belong to the parent installation team.");
    }

    const oldSubteam = input.id ? existingById.get(input.id) : undefined;
    if (input.id && (!oldSubteam || seenIds.has(input.id))) {
      throw new TeamValidationError("One of the subdivisions is no longer part of this team. Refresh and try again.");
    }
    const id = oldSubteam?._id ?? randomUUID();
    seenIds.add(id);
    seenNames.add(nameLower);
    return { _id: id, name, nameLower, memberIds };
  });
}

function sendTeamError(res: Response, error: unknown) {
  if (error instanceof TeamValidationError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  if (error instanceof TeamConflict) {
    res.status(409).json({ error: error.message });
    return true;
  }
  return false;
}

router.get("/installation/users", async (req, res): Promise<void> => {
  const actor = await getInstallationActor(req, res, "edit");
  if (!actor) return;
  const db = await getMongoDb();
  const users = await listEligibleInstallationUsers(db);
  res.json(ListInstallationUsersResponse.parse(users));
});

router.get("/installation/teams", async (req, res): Promise<void> => {
  const actor = await getInstallationActor(req, res, "view");
  if (!actor) return;
  const db = await getMongoDb();
  const teams = await getInstallationTeams(db).find().sort({ nameLower: 1 }).toArray();
  res.json(ListInstallationTeamsResponse.parse(teams.map(teamResponse)));
});

router.post("/installation/teams", async (req, res): Promise<void> => {
  const parsed = CreateInstallationTeamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const actor = await getInstallationActor(req, res, "edit");
  if (!actor) return;

  const db = await getMongoDb();
  try {
    const name = normalizeName(parsed.data.name);
    const nameLower = name.toLocaleLowerCase();
    const memberIds = normalizeIds(parsed.data.memberIds);
    if (!name) throw new TeamValidationError("Team names cannot be blank.");
    if (memberIds.length !== parsed.data.memberIds.length) {
      throw new TeamValidationError("Choose each installation team member only once.");
    }
    await validateMembers(db, memberIds);
    const subteams = normalizeSubteams(parsed.data.subteams, memberIds);
    for (const subteam of subteams) await validateMembers(db, subteam.memberIds);
    if (await getInstallationTeams(db).findOne({ nameLower })) {
      throw new TeamConflict("An installation team with that name already exists.");
    }

    const now = new Date();
    const team: InstallationTeamDocument = {
      _id: randomUUID(),
      name,
      nameLower,
      memberIds,
      subteams,
      createdBy: actor.id,
      createdAt: now,
      updatedBy: actor.id,
      updatedAt: now,
    };
    await getInstallationTeams(db).insertOne(team);
    res.status(201).json(CreateInstallationTeamResponse.parse(teamResponse(team)));
  } catch (error) {
    if (sendTeamError(res, error)) return;
    throw error;
  }
});

router.patch("/installation/teams/:id", async (req, res): Promise<void> => {
  const params = UpdateInstallationTeamParams.safeParse(req.params);
  const parsed = UpdateInstallationTeamBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : parsed.success ? "" : parsed.error.message });
    return;
  }
  const actor = await getInstallationActor(req, res, "edit");
  if (!actor) return;

  const db = await getMongoDb();
  try {
    const teams = getInstallationTeams(db);
    const existing = await teams.findOne({ _id: params.data.id });
    if (!existing) {
      res.status(404).json({ error: "Installation team not found." });
      return;
    }
    const name = normalizeName(parsed.data.name);
    const nameLower = name.toLocaleLowerCase();
    const memberIds = normalizeIds(parsed.data.memberIds);
    if (!name) throw new TeamValidationError("Team names cannot be blank.");
    if (memberIds.length !== parsed.data.memberIds.length) {
      throw new TeamValidationError("Choose each installation team member only once.");
    }
    await validateMembers(db, memberIds);
    const subteams = normalizeSubteams(parsed.data.subteams, memberIds, existing);
    for (const subteam of subteams) await validateMembers(db, subteam.memberIds);
    if (await teams.findOne({ _id: { $ne: existing._id }, nameLower })) {
      throw new TeamConflict("An installation team with that name already exists.");
    }

    const retainedSubteamIds = new Set(subteams.map((subteam) => subteam._id));
    const removedSubteams = existing.subteams.filter((subteam) => !retainedSubteamIds.has(subteam._id));
    for (const removedSubteam of removedSubteams) {
      const activeAssignment = await getInstallations(db).findOne({
        teamId: existing._id,
        subteamId: removedSubteam._id,
        installationStatus: { $ne: "installed" },
      });
      if (activeAssignment) {
        throw new TeamConflict("Reassign active orders from this subdivision before deleting it.");
      }
    }

    const updatedAt = new Date();
    const update = {
      name,
      nameLower,
      memberIds,
      subteams,
      updatedBy: actor.id,
      updatedAt,
    };
    await teams.updateOne({ _id: existing._id }, { $set: update });
    const updated = await teams.findOne({ _id: existing._id });
    if (!updated) {
      res.status(404).json({ error: "Installation team not found." });
      return;
    }
    res.json(UpdateInstallationTeamResponse.parse(teamResponse(updated)));
  } catch (error) {
    if (sendTeamError(res, error)) return;
    throw error;
  }
});

router.delete("/installation/teams/:id", async (req, res): Promise<void> => {
  const params = DeleteInstallationTeamParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const actor = await getInstallationActor(req, res, "edit");
  if (!actor) return;

  const db = await getMongoDb();
  const teams = getInstallationTeams(db);
  const team = await teams.findOne({ _id: params.data.id });
  if (!team) {
    res.status(404).json({ error: "Installation team not found." });
    return;
  }
  const activeAssignment = await getInstallations(db).findOne({
    teamId: team._id,
    installationStatus: { $ne: "installed" },
  });
  if (activeAssignment) {
    res.status(409).json({ error: "Reassign active orders before deleting this team." });
    return;
  }
  await teams.deleteOne({ _id: team._id });
  res.status(204).send();
});

export default router;
