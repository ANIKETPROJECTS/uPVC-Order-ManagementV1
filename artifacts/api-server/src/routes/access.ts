import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type RequestHandler } from "express";
import {
  CreateRoleBody,
  CreateRoleResponse,
  CreateUserBody,
  CreateUserResponse,
  DeactivateUserParams,
  DeleteRoleParams,
  GetAdminSummaryResponse,
  GetAuthSessionResponse,
  GetDashboardResponse,
  ListRolesResponse,
  ListUsersQueryParams,
  ListUsersResponse,
  LoginBody,
  LoginResponse,
  LogoutResponse,
  UpdateRoleBody,
  UpdateRoleParams,
  UpdateRoleResponse,
  UpdateUserBody,
  UpdateUserParams,
  UpdateUserResponse,
} from "@workspace/api-zod";
import type { Db } from "mongodb";
import {
  allEditPermissions,
  emptyPermissionMap,
  getMongoDb,
  getPublicUser,
  getRoles,
  getUsers,
  hashPassword,
  MODULES,
  type PermissionLevel,
  type PermissionMap,
  type RoleDocument,
  type UserDocument,
  verifyPassword,
} from "../lib/mongo";

const router: IRouter = Router();

const getSignedInUser = async (req: Request, db: Db) => {
  if (!req.session.userId) return null;
  const user = await getUsers(db).findOne({ _id: req.session.userId });
  return user?.status === "active" ? user : null;
};

const requireMasterAdmin: RequestHandler = (req, res, next) => {
  void getMongoDb()
    .then(async (db) => {
      const user = await getSignedInUser(req, db);
      if (!user) {
        res.status(401).json({ error: "Sign in to continue." });
        return;
      }
      if (user.roleId !== "master-admin") {
        res.status(403).json({ error: "Master Admin access is required." });
        return;
      }
      next();
    })
    .catch(next);
};

const failuresByAddress = new Map<string, { count: number; resetAt: number }>();
const FAILURE_LIMIT = 8;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

function getClientAddress(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function effectivePermissions(
  role: RoleDocument | null,
  user: UserDocument,
): PermissionMap {
  const base =
    user.roleId === "master-admin"
      ? allEditPermissions()
      : { ...emptyPermissionMap(), ...(role?.permissions ?? {}) };
  return { ...base, ...(user.permissionOverrides ?? {}) };
}

async function findRole(db: Db, roleId: string): Promise<RoleDocument | null> {
  return getRoles(db).findOne({ _id: roleId });
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

router.get("/auth/session", async (req, res): Promise<void> => {
  const db = await getMongoDb();
  const user = await getSignedInUser(req, db);
  const response = user
    ? { authenticated: true, user: await getPublicUser(user, db) }
    : { authenticated: false, user: null };
  res.setHeader("Cache-Control", "no-store");
  res.json(GetAuthSessionResponse.parse(response));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your username and password." });
    return;
  }

  const address = getClientAddress(req);
  const failures = failuresByAddress.get(address);
  const now = Date.now();
  if (failures && failures.resetAt > now && failures.count >= FAILURE_LIMIT) {
    res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
    return;
  }

  const db = await getMongoDb();
  const user = await getUsers(db).findOne({
    usernameLower: parsed.data.username.trim().toLowerCase(),
  });
  if (
    !user ||
    user.status !== "active" ||
    !verifyPassword(parsed.data.password, user.passwordSalt, user.passwordHash)
  ) {
    const current =
      failures && failures.resetAt > now
        ? failures
        : { count: 0, resetAt: now + FAILURE_WINDOW_MS };
    current.count += 1;
    failuresByAddress.set(address, current);
    res.status(401).json({ error: "The username or password is incorrect." });
    return;
  }

  failuresByAddress.delete(address);
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
  req.session.userId = user._id;
  await new Promise<void>((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
  await getUsers(db).updateOne(
    { _id: user._id },
    { $set: { lastLogin: new Date(), updatedAt: new Date() } },
  );
  const updated = { ...user, lastLogin: new Date() };
  res.setHeader("Cache-Control", "no-store");
  res.json(LoginResponse.parse(await getPublicUser(updated, db)));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
  res.clearCookie("upvc.sid", { httpOnly: true, sameSite: "lax" });
  res.json(LogoutResponse.parse({ success: true }));
});

router.use("/users", requireMasterAdmin);
router.use("/roles", requireMasterAdmin);
router.use("/admin", requireMasterAdmin);

router.get("/users", async (req, res): Promise<void> => {
  const parsed = ListUsersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const db = await getMongoDb();
  const { q, status, roleId } = parsed.data;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (roleId) filter.roleId = roleId;
  if (q?.trim()) {
    const query = new RegExp(escapeRegex(q.trim()), "i");
    filter.$or = [{ name: query }, { username: query }, { email: query }, { phone: query }];
  }
  const records = await getUsers(db).find(filter).sort({ updatedAt: -1 }).toArray();
  const users = await Promise.all(records.map((user) => getPublicUser(user, db)));
  res.json(ListUsersResponse.parse(users));
});

router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const db = await getMongoDb();
  const role = await findRole(db, parsed.data.roleId);
  if (!role) {
    res.status(400).json({ error: "Choose an existing role." });
    return;
  }

  const now = new Date();
  const { salt, hash } = hashPassword(parsed.data.password);
  const username = parsed.data.username.trim();
  const user: UserDocument = {
    _id: randomUUID(),
    name: parsed.data.name.trim(),
    username,
    usernameLower: username.toLowerCase(),
    email: parsed.data.email?.trim() || null,
    phone: parsed.data.phone?.trim() || null,
    roleId: role._id,
    status: "active",
    lastLogin: null,
    permissionOverrides: parsed.data.permissionOverrides ?? null,
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await getUsers(db).insertOne(user);
  } catch (error) {
    if (isDuplicateKey(error)) {
      res.status(409).json({ error: "That username is already in use." });
      return;
    }
    throw error;
  }
  res.status(201).json(
    CreateUserResponse.parse(await getPublicUser(user, db)),
  );
});

router.patch("/users/:userId", async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Check the user details and try again." });
    return;
  }

  const db = await getMongoDb();
  const users = getUsers(db);
  const existing = await users.findOne({ _id: params.data.userId });
  if (!existing) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  if (parsed.data.roleId && !(await findRole(db, parsed.data.roleId))) {
    res.status(400).json({ error: "Choose an existing role." });
    return;
  }
  const nextRoleId = parsed.data.roleId ?? existing.roleId;
  const deactivatingMasterAdmin =
    existing.roleId === "master-admin" &&
    (parsed.data.status === "inactive" || nextRoleId !== "master-admin");
  if (deactivatingMasterAdmin) {
    const activeAdmins = await users.countDocuments({
      roleId: "master-admin",
      status: "active",
      _id: { $ne: existing._id },
    });
    if (activeAdmins === 0) {
      res.status(409).json({ error: "At least one active Master Admin must remain." });
      return;
    }
  }

  const update: Partial<UserDocument> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) update.name = parsed.data.name.trim();
  if (parsed.data.username !== undefined) {
    update.username = parsed.data.username.trim();
    update.usernameLower = parsed.data.username.trim().toLowerCase();
  }
  if (parsed.data.email !== undefined) update.email = parsed.data.email?.trim() || null;
  if (parsed.data.phone !== undefined) update.phone = parsed.data.phone?.trim() || null;
  if (parsed.data.roleId !== undefined) update.roleId = parsed.data.roleId;
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.permissionOverrides !== undefined) {
    update.permissionOverrides = parsed.data.permissionOverrides;
  }
  if (parsed.data.password) {
    const { salt, hash } = hashPassword(parsed.data.password);
    update.passwordSalt = salt;
    update.passwordHash = hash;
  }

  try {
    await users.updateOne({ _id: existing._id }, { $set: update });
  } catch (error) {
    if (isDuplicateKey(error)) {
      res.status(409).json({ error: "That username is already in use." });
      return;
    }
    throw error;
  }

  const updated = await users.findOne({ _id: existing._id });
  if (!updated) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  res.json(UpdateUserResponse.parse(await getPublicUser(updated, db)));
});

router.delete("/users/:userId", async (req, res): Promise<void> => {
  const params = DeactivateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const db = await getMongoDb();
  const users = getUsers(db);
  const user = await users.findOne({ _id: params.data.userId });
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  if (user.roleId === "master-admin") {
    const otherAdmins = await users.countDocuments({
      roleId: "master-admin",
      status: "active",
      _id: { $ne: user._id },
    });
    if (otherAdmins === 0) {
      res.status(409).json({ error: "At least one active Master Admin must remain." });
      return;
    }
  }
  await users.updateOne(
    { _id: user._id },
    { $set: { status: "inactive", updatedAt: new Date() } },
  );
  res.sendStatus(204);
});

router.get("/roles", async (_req, res): Promise<void> => {
  const db = await getMongoDb();
  const roles = await getRoles(db).find().sort({ isSystem: -1, name: 1 }).toArray();
  res.json(
    ListRolesResponse.parse(
      roles.map((role) => ({
        id: role._id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissions: role.permissions,
      })),
    ),
  );
});

router.post("/roles", async (req, res): Promise<void> => {
  const parsed = CreateRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const db = await getMongoDb();
  const now = new Date();
  const name = parsed.data.name.trim();
  const role: RoleDocument = {
    _id: randomUUID(),
    name,
    nameLower: name.toLowerCase(),
    description: parsed.data.description?.trim() || null,
    isSystem: false,
    permissions: parsed.data.permissions,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await getRoles(db).insertOne(role);
  } catch (error) {
    if (isDuplicateKey(error)) {
      res.status(409).json({ error: "A role with that name already exists." });
      return;
    }
    throw error;
  }
  res.status(201).json(
    CreateRoleResponse.parse({
      id: role._id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.permissions,
    }),
  );
});

router.patch("/roles/:roleId", async (req, res): Promise<void> => {
  const params = UpdateRoleParams.safeParse(req.params);
  const parsed = UpdateRoleBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Check the role details and try again." });
    return;
  }
  const db = await getMongoDb();
  const roles = getRoles(db);
  const role = await roles.findOne({ _id: params.data.roleId });
  if (!role) {
    res.status(404).json({ error: "Role not found." });
    return;
  }
  if (role.isSystem) {
    res.status(409).json({ error: "System roles cannot be edited." });
    return;
  }
  const update: Partial<RoleDocument> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) {
    update.name = parsed.data.name.trim();
    update.nameLower = parsed.data.name.trim().toLowerCase();
  }
  if (parsed.data.description !== undefined) {
    update.description = parsed.data.description?.trim() || null;
  }
  if (parsed.data.permissions !== undefined) {
    update.permissions = parsed.data.permissions;
  }
  try {
    await roles.updateOne({ _id: role._id }, { $set: update });
  } catch (error) {
    if (isDuplicateKey(error)) {
      res.status(409).json({ error: "A role with that name already exists." });
      return;
    }
    throw error;
  }
  const updated = await roles.findOne({ _id: role._id });
  if (!updated) {
    res.status(404).json({ error: "Role not found." });
    return;
  }
  res.json(
    UpdateRoleResponse.parse({
      id: updated._id,
      name: updated.name,
      description: updated.description,
      isSystem: updated.isSystem,
      permissions: updated.permissions,
    }),
  );
});

router.delete("/roles/:roleId", async (req, res): Promise<void> => {
  const params = DeleteRoleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const db = await getMongoDb();
  const roles = getRoles(db);
  const role = await roles.findOne({ _id: params.data.roleId });
  if (!role) {
    res.status(404).json({ error: "Role not found." });
    return;
  }
  if (role.isSystem) {
    res.status(409).json({ error: "System roles cannot be deleted." });
    return;
  }
  if ((await getUsers(db).countDocuments({ roleId: role._id })) > 0) {
    res.status(409).json({ error: "Reassign this role's users before deleting it." });
    return;
  }
  await roles.deleteOne({ _id: role._id });
  res.sendStatus(204);
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const db = await getMongoDb();
  const user = await getSignedInUser(req, db);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  const role = await findRole(db, user.roleId);
  const permissions = effectivePermissions(role, user);
  const moduleCount = Object.values(permissions).filter((level) => level !== "none").length;
  const labels: Record<string, string> = {
    "master-admin": "System overview",
    operator: "Production floor",
    manager: "Operations overview",
    "rate-approver": "Rate approval queue",
    accounts: "Payments and collections",
    "quotation-team": "Quotation workspace",
  };
  res.json(
    GetDashboardResponse.parse({
      userName: user.name,
      roleName: role?.name ?? "Unassigned",
      roleLabel: labels[user.roleId] ?? "Team workspace",
      moduleCount,
    }),
  );
});

router.get("/admin/summary", async (_req, res): Promise<void> => {
  const db = await getMongoDb();
  const [totalUsers, activeUsers, inactiveUsers, totalRoles, masterAdmins] =
    await Promise.all([
      getUsers(db).countDocuments(),
      getUsers(db).countDocuments({ status: "active" }),
      getUsers(db).countDocuments({ status: "inactive" }),
      getRoles(db).countDocuments(),
      getUsers(db).countDocuments({ roleId: "master-admin", status: "active" }),
    ]);
  res.json(
    GetAdminSummaryResponse.parse({
      totalUsers,
      activeUsers,
      inactiveUsers,
      totalRoles,
      masterAdmins,
    }),
  );
});

export default router;