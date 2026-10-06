import { type Request, type Response } from "express";
import type { Db } from "mongodb";
import { getMongoDb, getPublicUser, getUsers } from "../lib/mongo";

export type InstallationActor = { id: string; name: string; masterAdmin: boolean };
export type EligibleInstallationUser = {
  id: string;
  name: string;
  username: string;
  roleName: string;
};

export async function getActor(
  req: Request,
  res: Response,
  module: "installation" | "order-hub",
  required: "view" | "edit",
): Promise<InstallationActor | null> {
  const db = await getMongoDb();
  const user = req.session.userId
    ? await getUsers(db).findOne({ _id: req.session.userId, status: "active" })
    : null;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return null;
  }

  const publicUser = await getPublicUser(user, db);
  const permission = publicUser.permissions[module] ?? "none";
  if (
    publicUser.roleId !== "master-admin" &&
    permission !== "edit" &&
    (required === "edit" || permission !== "view")
  ) {
    res.status(403).json({ error: `${module === "installation" ? "Installation" : "Order"} ${required} access is required.` });
    return null;
  }
  return { id: user._id, name: user.name, masterAdmin: publicUser.roleId === "master-admin" };
}

export function getInstallationActor(
  req: Request,
  res: Response,
  required: "view" | "edit",
) {
  return getActor(req, res, "installation", required);
}

export async function listEligibleInstallationUsers(db: Db): Promise<EligibleInstallationUser[]> {
  const users = await getUsers(db).find({ status: "active" }).sort({ name: 1 }).toArray();
  const eligible = await Promise.all(users.map(async (user) => {
    const publicUser = await getPublicUser(user, db);
    if (
      user.roleId !== "master-admin" &&
      publicUser.permissions.installation !== "view" &&
      publicUser.permissions.installation !== "edit"
    ) return null;
    return {
      id: user._id,
      name: user.name,
      username: user.username,
      roleName: publicUser.roleName,
    };
  }));
  return eligible.filter((user): user is EligibleInstallationUser => user !== null);
}

export async function resolveEligibleInstallationMembers(
  db: Db,
  memberIds: string[],
): Promise<Array<{ id: string; name: string }> | null> {
  const uniqueIds = [...new Set(memberIds)];
  if (uniqueIds.length !== memberIds.length) return null;
  const eligibleUsers = await listEligibleInstallationUsers(db);
  const usersById = new Map(eligibleUsers.map((user) => [user.id, user]));
  const members = memberIds.map((id) => usersById.get(id));
  if (members.some((member) => !member)) return null;
  return members.map((member) => ({ id: member!.id, name: member!.name }));
}
