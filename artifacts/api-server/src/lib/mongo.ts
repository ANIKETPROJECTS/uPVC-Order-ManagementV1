import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { MongoClient, type Collection, type Db } from "mongodb";
import { logger } from "./logger";

const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  throw new Error("MONGODB_URI must be set before the API server can start.");
}

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set before the API server can start.");
}

const parsedUri = new URL(mongoUri);
const databaseName =
  decodeURIComponent(parsedUri.pathname.replace(/^\/+/, "")) ||
  "upvc_order_management";
const mongoClient = new MongoClient(mongoUri);
let clientPromise: Promise<MongoClient> | undefined;

export type PermissionLevel = "none" | "view" | "edit";
export type PermissionMap = Record<string, PermissionLevel>;
export type UserStatus = "active" | "inactive";

export const MODULES = [
  { id: "user-access", label: "Multi-User Access & Roles" },
  { id: "order-hub", label: "Client & Order ID Hub" },
  { id: "quotation-builder", label: "Digital Quotation Builder" },
  { id: "rate-approval", label: "Rate Approval Workflow" },
  { id: "confirmation", label: "Confirmation / Purchase Order" },
  { id: "measurements", label: "Measurement Database" },
  { id: "qr-assembly", label: "QR Code & Assembly Tracking" },
  { id: "window-readiness", label: "Window-wise Readiness" },
  { id: "glass-procurement", label: "Glass Procurement & Delivery" },
  { id: "payments", label: "Order Value & Payment Tracking" },
  { id: "balance-payment", label: "Balance Payment Messages" },
  { id: "dispatch", label: "Dispatch QR & Gate Pass" },
  { id: "installation", label: "Installation Scheduling" },
  { id: "reporting", label: "Central Dashboard & Reporting" },
] as const;

export type ModuleId = (typeof MODULES)[number]["id"];

export interface RoleDocument {
  _id: string;
  name: string;
  nameLower: string;
  description: string | null;
  isSystem: boolean;
  permissions: PermissionMap;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDocument {
  _id: string;
  name: string;
  username: string;
  usernameLower: string;
  email: string | null;
  phone: string | null;
  avatarUrl?: string | null;
  roleId: string;
  status: UserStatus;
  lastLogin: Date | null;
  permissionOverrides: PermissionMap | null;
  passwordSalt: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicUser {
  id: string;
  name: string;
  username: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  roleId: string;
  roleName: string;
  status: UserStatus;
  lastLogin: string | null;
  permissions: PermissionMap;
  permissionOverrides: PermissionMap | null;
}

export interface ChatConversationDocument {
  _id: string;
  type: "direct";
  participantIds: string[];
  readAtByUser: Record<string, Date>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatGroupDocument {
  _id: string;
  name: string;
  nameLower: string;
  description: string | null;
  memberIds: string[];
  readAtByUser: Record<string, Date>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ChatMessageDocument {
  _id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: Date;
}

export function getMongoClient(): Promise<MongoClient> {
  clientPromise ??= mongoClient.connect();
  return clientPromise;
}

export async function getMongoDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(databaseName);
}

export function getMongoDatabaseName(): string {
  return databaseName;
}

export function getUsers(db: Db): Collection<UserDocument> {
  return db.collection<UserDocument>("users");
}

export function getRoles(db: Db): Collection<RoleDocument> {
  return db.collection<RoleDocument>("roles");
}

export function getChatConversations(db: Db): Collection<ChatConversationDocument> {
  return db.collection<ChatConversationDocument>("chat_conversations");
}

export function getChatGroups(db: Db): Collection<ChatGroupDocument> {
  return db.collection<ChatGroupDocument>("chat_groups");
}

export function getChatMessages(db: Db): Collection<ChatMessageDocument> {
  return db.collection<ChatMessageDocument>("chat_messages");
}

export function emptyPermissionMap(): PermissionMap {
  return Object.fromEntries(MODULES.map(({ id }) => [id, "none"]));
}

export function allEditPermissions(): PermissionMap {
  return Object.fromEntries(MODULES.map(({ id }) => [id, "edit"]));
}

export function makePermissionMap(
  permissions: Partial<Record<ModuleId, PermissionLevel>>,
): PermissionMap {
  return { ...emptyPermissionMap(), ...permissions };
}

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: scryptSync(password, salt, 64).toString("hex"),
  };
}

export function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): boolean {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function getPublicUser(
  user: UserDocument,
  db: Db,
): Promise<PublicUser> {
  const roles = getRoles(db);
  const role = await roles.findOne({ _id: user.roleId });
  const basePermissions =
    user.roleId === "master-admin"
      ? allEditPermissions()
      : { ...emptyPermissionMap(), ...(role?.permissions ?? {}) };
  const permissions = { ...basePermissions, ...(user.permissionOverrides ?? {}) };

  return {
    id: user._id,
    name: user.name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl ?? null,
    roleId: user.roleId,
    roleName: role?.name ?? "Unassigned",
    status: user.status,
    lastLogin: user.lastLogin?.toISOString() ?? null,
    permissions,
    permissionOverrides: user.permissionOverrides,
  };
}

const seedRoles: Array<Omit<RoleDocument, "createdAt" | "updatedAt">> = [
  {
    _id: "master-admin",
    name: "Master Admin",
    nameLower: "master admin",
    description: "Full system access, including user and role administration.",
    isSystem: true,
    permissions: allEditPermissions(),
  },
  {
    _id: "operator",
    name: "Operator",
    nameLower: "operator",
    description: "Factory-floor assembly and readiness updates.",
    isSystem: false,
    permissions: makePermissionMap({
      "order-hub": "view",
      measurements: "view",
      "qr-assembly": "edit",
      "window-readiness": "edit",
      "glass-procurement": "view",
    }),
  },
  {
    _id: "manager",
    name: "Manager",
    nameLower: "manager",
    description: "Production visibility and order coordination.",
    isSystem: false,
    permissions: makePermissionMap({
      "order-hub": "edit",
      "quotation-builder": "view",
      "rate-approval": "view",
      confirmation: "view",
      measurements: "view",
      "window-readiness": "view",
      "glass-procurement": "view",
      dispatch: "view",
      installation: "view",
      reporting: "view",
    }),
  },
  {
    _id: "rate-approver",
    name: "Rate Approver",
    nameLower: "rate approver",
    description: "Reviews unpriced quotations and records approved rates.",
    isSystem: false,
    permissions: makePermissionMap({
      "order-hub": "view",
      "quotation-builder": "view",
      "rate-approval": "edit",
    }),
  },
  {
    _id: "accounts",
    name: "Accounts",
    nameLower: "accounts",
    description: "Records payments and confirms dispatch payment clearance.",
    isSystem: false,
    permissions: makePermissionMap({
      "order-hub": "view",
      payments: "edit",
      "balance-payment": "view",
      dispatch: "edit",
      reporting: "view",
    }),
  },
  {
    _id: "quotation-team",
    name: "Quotation Team",
    nameLower: "quotation team",
    description: "Creates quotations and follows rate approvals.",
    isSystem: false,
    permissions: makePermissionMap({
      "order-hub": "view",
      "quotation-builder": "edit",
      "rate-approval": "view",
      confirmation: "view",
      measurements: "view",
    }),
  },
];

const developmentUsers = [
  { name: "Aditi Kulkarni", username: "admin", phone: "+91 98220 10001", roleId: "master-admin", password: "Admin@12345" },
  { name: "Rohan Patil", username: "operator", phone: "+91 98220 10002", roleId: "operator", password: "Demo@12345" },
  { name: "Meera Joshi", username: "manager", phone: "+91 98220 10003", roleId: "manager", password: "Demo@12345" },
  { name: "Uday Deshmukh", username: "rate.approver", phone: "+91 98220 10004", roleId: "rate-approver", password: "Demo@12345" },
  { name: "Sneha Shah", username: "accounts", phone: "+91 98220 10005", roleId: "accounts", password: "Demo@12345" },
  { name: "Kavita More", username: "quotations", phone: "+91 98220 10006", roleId: "quotation-team", password: "Demo@12345" },
];

export async function initializeMongo(): Promise<void> {
  const db = await getMongoDb();
  const users = getUsers(db);
  const roles = getRoles(db);
  const chatConversations = getChatConversations(db);
  const chatGroups = getChatGroups(db);
  const chatMessages = getChatMessages(db);

  await Promise.all([
    users.createIndex({ usernameLower: 1 }, { unique: true, name: "username_unique" }),
    roles.createIndex({ nameLower: 1 }, { unique: true, name: "role_name_unique" }),
    chatConversations.createIndex(
      { participantIds: 1, updatedAt: -1 },
      { name: "chat_conversations_by_member" },
    ),
    chatGroups.createIndex(
      { memberIds: 1, updatedAt: -1 },
      { name: "chat_groups_by_member" },
    ),
    chatGroups.createIndex(
      { nameLower: 1 },
      {
        unique: true,
        name: "chat_group_name_unique",
        partialFilterExpression: { deletedAt: null },
      },
    ),
    chatMessages.createIndex(
      { conversationId: 1, createdAt: 1 },
      { name: "chat_messages_by_conversation" },
    ),
  ]);

  const now = new Date();
  for (const role of seedRoles) {
    await roles.updateOne(
      { _id: role._id },
      { $setOnInsert: { ...role, createdAt: now, updatedAt: now } },
      { upsert: true },
    );
  }

  if (process.env.NODE_ENV === "production") {
    if ((await users.countDocuments()) === 0) {
      throw new Error(
        "No Master Admin exists. Provision the first Master Admin before starting production.",
      );
    }
  } else if ((await users.countDocuments()) === 0) {
    await users.insertMany(
      developmentUsers.map((seed) => {
        const { salt, hash } = hashPassword(seed.password);
        return {
          _id: seed.username,
          name: seed.name,
          username: seed.username,
          usernameLower: seed.username.toLowerCase(),
          email: null,
          phone: seed.phone,
          roleId: seed.roleId,
          status: "active" as const,
          lastLogin: null,
          permissionOverrides: null,
          passwordSalt: salt,
          passwordHash: hash,
          createdAt: now,
          updatedAt: now,
        };
      }),
    );
    logger.info({ users: developmentUsers.length }, "Seeded development access accounts");
  }

  logger.info({ database: db.databaseName }, "Connected to MongoDB");
}