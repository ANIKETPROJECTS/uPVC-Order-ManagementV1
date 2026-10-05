import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { GridFSBucket, MongoClient, type Collection, type Db } from "mongodb";
import { logger } from "./logger";
import {
  formatOrderId,
  normalizeLocationCode,
  orderDailyCounterId,
  orderDateKey,
} from "./order-identifiers";

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
  { id: "quotation-builder", label: "Quotation & Rate Approval" },
  { id: "rate-approval", label: "Rate Approval Queue" },
  { id: "confirmation", label: "Confirmation / Purchase Order" },
  { id: "measurements", label: "Measurement Database" },
  { id: "qr-assembly", label: "QR Code & Assembly Tracking" },
  { id: "window-readiness", label: "Window-wise Readiness" },
  { id: "glass-procurement", label: "Glass Procurement & Delivery" },
  { id: "payments", label: "Order Value & Payment Tracking" },
  { id: "balance-payment", label: "Balance Payment Register" },
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
  hiddenAtByUser?: Record<string, Date>;
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
  hiddenAtByUser?: Record<string, Date>;
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
  editedAt?: Date | null;
  deletedAt?: Date | null;
}

export type OrderStatus =
  | "quotation_stage"
  | "confirmed"
  | "in_production"
  | "ready"
  | "dispatched"
  | "installed";

export type DispatchStatus = "pending_dispatch" | "dispatched" | "delivered";

export interface ClientDocument {
  _id: string;
  name: string;
  nameLower: string;
  phone: string;
  address: string;
  gstin: string | null;
  prefix: string;
  prefixUpper: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderLocationDocument {
  _id: string;
  code: string;
  codeUpper: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderDocument {
  _id: string;
  orderId: string;
  sequenceNo: number;
  clientId: string;
  clientName: string;
  clientPrefix: string;
  clientPhone: string | null;
  clientAddress: string | null;
  clientGstin: string | null;
  locationCode: string;
  locationName: string;
  status: OrderStatus;
  dispatchStatus?: DispatchStatus;
  notes: string | null;
  orderValue?: number | null;
  createdBy: string;
  createdAt: Date;
  updatedBy: string | null;
  updatedAt: Date;
}

export type WindowReadiness = "pending" | "in_progress" | "ready";
export type GlassStatus = "pending" | "partial" | "received";
export interface OrderWindowDocument {
  _id: string; orderRecordId: string; windowNo: string; widthMm: number; heightMm: number;
  windowType: string; frameStatus: WindowReadiness; shutterStatus: WindowReadiness;
  glassStatus: GlassStatus; pendingReason: string | null; sqFt: number;
  createdBy: string; createdAt: Date; updatedBy: string; updatedAt: Date; archivedAt?: Date | null;
}
export type PaymentMethod = "cash" | "bank_transfer" | "upi" | "cheque" | "other";
export type PaymentStatus = "received" | "void" | "bounced";
export interface OrderPaymentDocument {
  _id: string; orderRecordId: string; amount: number; method: PaymentMethod;
  reference: string | null; notes: string | null; paidAt: Date; status: PaymentStatus;
  voidReason: string | null; createdBy: string; createdAt: Date; voidedBy?: string | null; voidedAt?: Date | null;
  bouncedAt?: Date | null; bounceReason?: string | null; bouncedBy?: string | null;
}
export interface OrderRefundDocument {
  _id: string; orderRecordId: string; amount: number; refundDate: Date;
  notes: string | null; createdBy: string; createdAt: Date;
}
export type PaymentFlagType = "bounced_payment" | "refusal_to_pay";
export type PaymentFlagStatus = "active" | "resolved" | "removed";
export type PaymentFlagActionType = "created" | "edited" | "follow_up_added" | "resolved" | "removed";
export interface PaymentFlagActionDocument {
  id: string;
  action: PaymentFlagActionType;
  actorId: string;
  actorName: string;
  occurredAt: Date;
  summary: string;
}
export interface OrderPaymentFlagDocument {
  _id: string;
  orderRecordId: string;
  orderId: string;
  clientName: string;
  locationName: string;
  flagType: PaymentFlagType;
  remarks: string;
  flaggedAmount: number;
  flaggedAt: Date;
  flaggedById: string;
  flaggedBy: string;
  bounceReason: string | null;
  bouncedAmount: number | null;
  bankCharges: number | null;
  followUpCount: number | null;
  lastFollowUpDate: Date | null;
  followUpNotes: string | null;
  status: PaymentFlagStatus;
  resolutionDate: Date | null;
  resolutionNotes: string | null;
  removedAt: Date | null;
  removedBy: string | null;
  actions: PaymentFlagActionDocument[];
  createdAt: Date;
  updatedAt: Date;
}
export type DocumentCategory = string;
export interface OrderDocumentCategoryDocument {
  _id: string;
  label: string;
  labelNormalized: string;
  requiredModule: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface OrderDocumentMetadataDocument {
  _id: string; orderRecordId: string; quotationRequestId?: string | null; filename: string; category: DocumentCategory;
  contentType: string; sizeBytes: number; gridFsId: string | null; storagePath?: string | null; uploadedBy: string; uploadedAt: Date; archivedAt?: Date | null;
}
export interface OrderActivityDocument {
  _id: string; orderRecordId: string; actorId: string; actorName: string; action: string; summary: string; createdAt: Date;
}
export type InstallationStatus = "pending" | "issue" | "installed";
export interface InstallationDocument {
  _id: string;
  orderRecordId: string;
  installationStatus: InstallationStatus;
  installationDate: string | null;
  issueReason: string | null;
  updatedBy: string;
  updatedAt: Date;
  createdAt: Date;
}
export interface OrderGrievanceDocument {
  _id: string;
  orderRecordId: string;
  orderId: string;
  description: string;
  reportedAt: string;
  status: "open";
  createdBy: string;
  createdByName: string;
  createdAt: Date;
}

export type WindowProfileDrawingType = "casement" | "sliding" | "mixed" | "louvre";
export interface WindowProfileDocument {
  _id: string;
  code: string;
  codeUpper: string;
  name: string;
  nameLower: string;
  profileSystem: string;
  glass: string;
  profileColor: string;
  meshType: string;
  specifications: string;
  accessories: string;
  remarks?: string;
  imageDataUrl?: string | null;
  drawingType: WindowProfileDrawingType;
  ratePerSqFt: number;
  weightKgPerSqFt: number;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date | null;
}

export interface QuotationItemDocument {
  profileId: string;
  profileCode: string;
  profileName: string;
  profileSystem: string;
  glass: string;
  profileColor: string;
  meshType: string;
  specifications: string;
  accessories: string;
  remarks?: string;
  imageDataUrl?: string | null;
  drawingType: WindowProfileDrawingType;
  code: string;
  location: string;
  widthMm: number;
  heightMm: number;
  sqFtPerWindow: number;
  ratePerSqFt: number;
  catalogueRatePerSqFt?: number;
  rateOverridden?: boolean;
  unitPrice: number;
  quantity: number;
  value: number;
  weightKgPerWindow: number;
}

export interface QuotationTotalsDocument {
  componentCount: number;
  totalAreaSqFt: number;
  basicValue: number;
  transportationCost: number;
  loadingUnloadingCost: number;
  additionalCharge: number;
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  grandTotal: number;
  averagePricePerSqFt: number;
}

export type QuotationApprovalAction = "submitted" | "approved" | "rejected";

export interface QuotationApprovalHistoryEntry {
  action: QuotationApprovalAction;
  actorId: string;
  actorName: string;
  reason: string | null;
  createdAt: Date;
}

export interface QuotationDocument {
  _id: string;
  sequenceNo: number;
  quoteNo: string;
  clientId: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerGstin: string | null;
  projectName: string;
  quotationDate: string;
  items: QuotationItemDocument[];
  transportationCost: number;
  loadingUnloadingCost: number;
  additionalChargeDescription: string;
  additionalChargeRate: number;
  additionalChargeAreaSqFt: number;
  gstPercent: number;
  notes: string | null;
  totals: QuotationTotalsDocument;
  status: "draft" | "pending_approval" | "approved" | "rejected";
  requiresRateApproval?: boolean;
  approvalApproverId?: string | null;
  approvalSubmittedAt?: Date | null;
  approvalLastReminderAt?: Date | null;
  approvalHistory?: QuotationApprovalHistoryEntry[];
  sampleOnly?: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date | null;
}

export type AppNotificationType =
  | "approval_request"
  | "approval_decision"
  | "approval_reminder"
  | "test";

export interface AppNotificationDocument {
  _id: string;
  userId: string;
  type: AppNotificationType;
  title: string;
  message: string;
  url: string;
  quotationId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface PushSubscriptionDocument {
  _id: string;
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotationApprovalSettingsDocument {
  _id: "saved-quotation-approval";
  approverUserId: string | null;
  updatedBy: string;
  updatedAt: Date;
}

export type QuotationRateSubmissionStatus =
  | "awaiting_pdf"
  | "pending_review"
  | "approved"
  | "rejected";
export interface QuotationRateSubmissionRevisionDocument {
  revisionNumber: number;
  clientName: string;
  location: string | null;
  windowQty: number;
  totalSqFt: number;
  glassType: string;
  averageSqFtPerQty: number;
  previousStatus: QuotationRateSubmissionStatus;
  revisedBy: string;
  revisedByName: string;
  revisedAt: Date;
  pdfFilename: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decisionComment: string | null;
}
export interface QuotationRateSubmissionDocument {
  _id: string;
  orderRecordId: string | null;
  orderId: string | null;
  measurementRecordId?: string | null;
  clientName: string;
  clientNameLower: string;
  location: string | null;
  windowQty: number;
  totalSqFt: number;
  glassType: string;
  averageSqFtPerQty: number;
  status: QuotationRateSubmissionStatus;
  pdfFilename: string | null;
  pdfSizeBytes: number | null;
  pdfGridFsId: string | null;
  pdfStoragePath?: string | null;
  submittedBy: string;
  submittedByName: string;
  approverIds: string[];
  decisionComment: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  pdfNeedsRefresh?: boolean;
  revisionHistory?: QuotationRateSubmissionRevisionDocument[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MeasurementRecordDocument {
  _id: string;
  clientName: string;
  clientNameLower: string;
  location: string | null;
  orderRecordId: string | null;
  versionCount?: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface MeasurementVersionDocument {
  _id: string;
  recordId: string;
  versionNumber: number;
  filename: string;
  name?: string | null;
  measurementType?: "quotation" | "final" | null;
  referenceType?: "user" | "custom" | "customer" | null;
  referenceId?: string | null;
  referenceName?: string | null;
  contentType: string;
  sizeBytes: number;
  gridFsId: string | null;
  storagePath?: string | null;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: Date;
}
export interface MeasurementReferenceDocument {
  _id: string;
  name: string;
  nameLower: string;
  kind?: "custom" | "customer";
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderMessageTemplateDocument {
  _id: OrderStatus;
  status: OrderStatus;
  label: string;
  template: string;
  updatedAt: Date;
}

interface CounterDocument {
  _id: string;
  value: number;
  updatedAt: Date;
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

export function getClients(db: Db): Collection<ClientDocument> {
  return db.collection<ClientDocument>("clients");
}

export function getOrderLocations(db: Db): Collection<OrderLocationDocument> {
  return db.collection<OrderLocationDocument>("order_locations");
}

export function getOrders(db: Db): Collection<OrderDocument> {
  return db.collection<OrderDocument>("orders");
}

export function getOrderMessageTemplates(
  db: Db,
): Collection<OrderMessageTemplateDocument> {
  return db.collection<OrderMessageTemplateDocument>("order_message_templates");
}

export function getCounters(db: Db): Collection<CounterDocument> {
  return db.collection<CounterDocument>("counters");
}
export function getOrderWindows(db: Db) { return db.collection<OrderWindowDocument>("order_windows"); }
export function getOrderPayments(db: Db) { return db.collection<OrderPaymentDocument>("order_payments"); }
export function getOrderRefunds(db: Db) { return db.collection<OrderRefundDocument>("order_refunds"); }
export function getOrderPaymentFlags(db: Db) { return db.collection<OrderPaymentFlagDocument>("order_payment_flags"); }
export function getOrderDocumentCategories(db: Db) { return db.collection<OrderDocumentCategoryDocument>("order_document_categories"); }
export function getOrderDocumentMetadata(db: Db) { return db.collection<OrderDocumentMetadataDocument>("order_document_metadata"); }
export function getOrderActivity(db: Db) { return db.collection<OrderActivityDocument>("order_activity"); }
export function getInstallations(db: Db) { return db.collection<InstallationDocument>("installations"); }
export function getOrderGrievances(db: Db) { return db.collection<OrderGrievanceDocument>("order_grievances"); }
export function getWindowProfiles(db: Db) { return db.collection<WindowProfileDocument>("window_profiles"); }
export function getQuotations(db: Db) { return db.collection<QuotationDocument>("quotations"); }
export function getAppNotifications(db: Db) { return db.collection<AppNotificationDocument>("app_notifications"); }
export function getPushSubscriptions(db: Db) { return db.collection<PushSubscriptionDocument>("push_subscriptions"); }
export function getQuotationApprovalSettings(db: Db) { return db.collection<QuotationApprovalSettingsDocument>("quotation_approval_settings"); }
export function getOrderDocumentsBucket(db: Db): any { return new GridFSBucket(db, { bucketName: "order_documents" }); }
export function getQuotationRateSubmissions(db: Db) { return db.collection<QuotationRateSubmissionDocument>("quotation_rate_submissions"); }
export function getQuotationRatePdfsBucket(db: Db): any { return new GridFSBucket(db, { bucketName: "quotation_rate_pdfs" }); }
export function getMeasurementRecords(db: Db) { return db.collection<MeasurementRecordDocument>("measurement_records"); }
export function getMeasurementVersions(db: Db) { return db.collection<MeasurementVersionDocument>("measurement_versions"); }
export function getMeasurementReferences(db: Db) { return db.collection<MeasurementReferenceDocument>("measurement_references"); }
export function getMeasurementSheetsBucket(db: Db): any { return new GridFSBucket(db, { bucketName: "measurement_sheets" }); }

async function migrateOrderIds(db: Db, now: Date): Promise<void> {
  const counters = getCounters(db);
  const migrationMarkerId = "orderIdFormatV1";
  const marker = await counters.findOne({ _id: migrationMarkerId });
  if (marker?.value === 1) return;

  const orders = await getOrders(db)
    .find({})
    .sort({ createdAt: 1, sequenceNo: 1, _id: 1 })
    .toArray();
  const nextByCounter = new Map<string, number>();
  const planned = orders.map((order) => {
    const dateKey = orderDateKey(order.createdAt);
    const locationCode = normalizeLocationCode(order.locationCode);
    const counterId = orderDailyCounterId(dateKey, locationCode);
    const dailySequenceNo = (nextByCounter.get(counterId) ?? 0) + 1;
    nextByCounter.set(counterId, dailySequenceNo);

    return {
      order,
      counterId,
      orderId: formatOrderId(dateKey, locationCode, dailySequenceNo),
    };
  });
  const changed = planned.filter(({ order, orderId }) => order.orderId !== orderId);

  if (changed.length > 0) {
    const migrationToken = randomUUID();
    await getOrders(db).bulkWrite(
      changed.map(({ order }, index) => ({
        updateOne: {
          filter: { _id: order._id },
          update: {
            $set: { orderId: `__order_id_migration_${migrationToken}_${index}` },
          },
        },
      })),
    );
    await getOrders(db).bulkWrite(
      changed.map(({ order, orderId }) => ({
        updateOne: {
          filter: { _id: order._id },
          update: { $set: { orderId } },
        },
      })),
    );
  }

  for (const [counterId, value] of nextByCounter) {
    await counters.updateOne(
      { _id: counterId },
      { $max: { value }, $set: { updatedAt: now } },
      { upsert: true },
    );
  }

  await counters.updateOne(
    { _id: migrationMarkerId },
    { $set: { value: 1, updatedAt: now } },
    { upsert: true },
  );

  if (changed.length > 0) {
    logger.info(
      { migratedOrders: changed.length, dateLocationGroups: nextByCounter.size },
      "Migrated order IDs to date/location sequence format",
    );
  }
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
    _id: "approver",
    name: "Approver",
    nameLower: "approver",
    description: "Reviews saved quotations assigned by an administrator.",
    isSystem: true,
    permissions: makePermissionMap({
      "quotation-builder": "view",
    }),
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
  {
    _id: "quotation-member",
    name: "Quotation Member",
    nameLower: "quotation member",
    description: "Submits quotation details and Eva Software PDFs for rate review.",
    isSystem: false,
    permissions: makePermissionMap({
      "order-hub": "view",
      "quotation-builder": "edit",
      "rate-approval": "view",
      measurements: "view",
    }),
  },
  {
    _id: "measurement-editor",
    name: "Measurement Editor",
    nameLower: "measurement editor",
    description: "Maintains client measurement sheets and their retained versions.",
    isSystem: false,
    permissions: makePermissionMap({
      "order-hub": "view",
      measurements: "edit",
    }),
  },
];

const seedWindowProfiles: Array<Omit<WindowProfileDocument, "createdAt" | "updatedAt" | "createdBy" | "updatedBy">> = [
  {
    _id: "profile-openable-exz",
    code: "CASE-60",
    codeUpper: "CASE-60",
    name: "OPANABLE AND EXZ",
    nameLower: "opanable and exz",
    profileSystem: "60 mm uPVC casement with extra-z sash",
    glass: "5 mm toughened glass",
    profileColor: "White",
    meshType: "No mesh",
    specifications: "60 mm uPVC profile system\nOpenable sash with extra-z section",
    accessories: "Stainless steel friction stay, handle and locking hardware",
    drawingType: "casement",
    ratePerSqFt: 644.97,
    weightKgPerSqFt: 2.13,
  },
  {
    _id: "profile-sliding-3-track",
    code: "SLIDE-3T",
    codeUpper: "SLIDE-3T",
    name: "3 TRACK 2 GLASS 1 MESH",
    nameLower: "3 track 2 glass 1 mesh",
    profileSystem: "Three-track uPVC sliding system",
    glass: "5 mm toughened glass",
    profileColor: "White",
    meshType: "Stainless steel flymesh",
    specifications: "Three-track frame with two glass shutters and one mesh shutter",
    accessories: "Sliding rollers, interlocks, lock and mesh hardware",
    drawingType: "sliding",
    ratePerSqFt: 545.08,
    weightKgPerSqFt: 2.73,
  },
  {
    _id: "profile-sliding-3-track-exz",
    code: "MIX-3T",
    codeUpper: "MIX-3T",
    name: "3TRACK 2GLASS 1MESH WITH EXZ",
    nameLower: "3track 2glass 1mesh with exz",
    profileSystem: "Three-track uPVC sliding system with extra-z sash",
    glass: "5 mm toughened glass",
    profileColor: "White",
    meshType: "Stainless steel flymesh",
    specifications: "Three-track frame with two glass shutters, one mesh shutter and extra-z sash",
    accessories: "Sliding rollers, interlocks, lock and mesh hardware",
    drawingType: "mixed",
    ratePerSqFt: 664.60,
    weightKgPerSqFt: 2.87,
  },
  {
    _id: "profile-bath-louvre-casement",
    code: "LOUV-CASE",
    codeUpper: "LOUV-CASE",
    name: "BATH LOUVERS AND OPANABLE AND EXZ",
    nameLower: "bath louvers and opanable and exz",
    profileSystem: "uPVC casement with bath louvre section and extra-z sash",
    glass: "5 mm toughened glass with louvre section",
    profileColor: "White",
    meshType: "As specified per opening",
    specifications: "Casement opening with integrated bathroom louvre section",
    accessories: "Stainless steel friction stay, handle, locking hardware and louvre blades",
    drawingType: "louvre",
    ratePerSqFt: 637.93,
    weightKgPerSqFt: 2.1,
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

const seedOrderClients = [
  { id: "rayal", name: "Rayal uPVC", phone: "+91 98220 21001", address: "College Road, Nashik, Maharashtra", gstin: "27AAECR1234F1Z5", prefix: "R" },
  { id: "chavan-bhau", name: "Chavan Bhau Developers", phone: "+91 98220 21002", address: "Kothrud, Pune, Maharashtra", gstin: "27AACCC4567G1Z2", prefix: "C" },
  { id: "aakar-solitaire", name: "Aakar Solitaire", phone: "+91 98220 21003", address: "Gangapur Road, Nashik, Maharashtra", gstin: null, prefix: "A" },
  { id: "patil-builders", name: "Patil Builders", phone: "+91 98220 21004", address: "Andheri East, Mumbai, Maharashtra", gstin: "27AANCP7654B1ZT", prefix: "P" },
  { id: "greenview-heights", name: "Greenview Heights", phone: "+91 98220 21005", address: "Wadala, Mumbai, Maharashtra", gstin: null, prefix: "G" },
  { id: "mehta-residency", name: "Mehta Residency", phone: "+91 98220 21006", address: "Baner, Pune, Maharashtra", gstin: "27AAKFM9876J1ZQ", prefix: "M" },
];

const seedOrderLocations = [
  { id: "pune", code: "PN", name: "Pune" },
  { id: "mumbai", code: "MUM", name: "Mumbai" },
  { id: "wadala", code: "WAD", name: "Wadala" },
  { id: "nashik", code: "NSK", name: "Nashik" },
];

const seedOrders: Array<{
  id: string;
  orderId: string;
  sequenceNo: number;
  clientId: string;
  clientName: string;
  clientPrefix: string;
  clientPhone: string;
  clientAddress: string;
  clientGstin: string | null;
  locationCode: string;
  locationName: string;
  status: OrderStatus;
  notes: string | null;
  ageDays: number;
}> = [
  { id: "seed-order-253", orderId: "R253 PN", sequenceNo: 253, clientId: "rayal", clientName: "Rayal uPVC", clientPrefix: "R", clientPhone: "+91 98220 21001", clientAddress: "College Road, Nashik, Maharashtra", clientGstin: "27AAECR1234F1Z5", locationCode: "PN", locationName: "Pune", status: "quotation_stage", notes: "Site measurements received; quotation preparation started.", ageDays: 2 },
  { id: "seed-order-254", orderId: "C254 NSK", sequenceNo: 254, clientId: "chavan-bhau", clientName: "Chavan Bhau Developers", clientPrefix: "C", clientPhone: "+91 98220 21002", clientAddress: "Kothrud, Pune, Maharashtra", clientGstin: "27AACCC4567G1Z2", locationCode: "NSK", locationName: "Nashik", status: "confirmed", notes: "Confirmation received from the client.", ageDays: 8 },
  { id: "seed-order-255", orderId: "A255 MUM", sequenceNo: 255, clientId: "aakar-solitaire", clientName: "Aakar Solitaire", clientPrefix: "A", clientPhone: "+91 98220 21003", clientAddress: "Gangapur Road, Nashik, Maharashtra", clientGstin: null, locationCode: "MUM", locationName: "Mumbai", status: "in_production", notes: "Production schedule shared with the factory.", ageDays: 12 },
  { id: "seed-order-256", orderId: "P256 WAD", sequenceNo: 256, clientId: "patil-builders", clientName: "Patil Builders", clientPrefix: "P", clientPhone: "+91 98220 21004", clientAddress: "Andheri East, Mumbai, Maharashtra", clientGstin: "27AANCP7654B1ZT", locationCode: "WAD", locationName: "Wadala", status: "ready", notes: "All scheduled windows are ready for the next stage.", ageDays: 18 },
  { id: "seed-order-257", orderId: "G257 PN", sequenceNo: 257, clientId: "greenview-heights", clientName: "Greenview Heights", clientPrefix: "G", clientPhone: "+91 98220 21005", clientAddress: "Wadala, Mumbai, Maharashtra", clientGstin: null, locationCode: "PN", locationName: "Pune", status: "dispatched", notes: "Dispatch completed; installation coordination is pending.", ageDays: 23 },
  { id: "seed-order-258", orderId: "M258 MUM", sequenceNo: 258, clientId: "mehta-residency", clientName: "Mehta Residency", clientPrefix: "M", clientPhone: "+91 98220 21006", clientAddress: "Baner, Pune, Maharashtra", clientGstin: "27AAKFM9876J1ZQ", locationCode: "MUM", locationName: "Mumbai", status: "installed", notes: "Installation completed and recorded.", ageDays: 31 },
  { id: "seed-order-259", orderId: "R259 NSK", sequenceNo: 259, clientId: "rayal", clientName: "Rayal uPVC", clientPrefix: "R", clientPhone: "+91 98220 21001", clientAddress: "College Road, Nashik, Maharashtra", clientGstin: "27AAECR1234F1Z5", locationCode: "NSK", locationName: "Nashik", status: "confirmed", notes: null, ageDays: 5 },
  { id: "seed-order-260", orderId: "C260 PN", sequenceNo: 260, clientId: "chavan-bhau", clientName: "Chavan Bhau Developers", clientPrefix: "C", clientPhone: "+91 98220 21002", clientAddress: "Kothrud, Pune, Maharashtra", clientGstin: "27AACCC4567G1Z2", locationCode: "PN", locationName: "Pune", status: "quotation_stage", notes: "Awaiting final quotation review.", ageDays: 1 },
];

const seedOrderMessageTemplates: Array<{
  status: OrderStatus;
  label: string;
  template: string;
}> = [
  { status: "quotation_stage", label: "Quotation Stage", template: "Dear {{clientName}}, quotation preparation has started for order {{orderId}} at {{locationName}}. We will share the details with you shortly." },
  { status: "confirmed", label: "Confirmed", template: "Dear {{clientName}}, your order {{orderId}} for {{locationName}} has been confirmed. We will keep you updated on the next steps." },
  { status: "in_production", label: "In Production", template: "Dear {{clientName}}, your order {{orderId}} for {{locationName}} is now in production. We will share another update as it progresses." },
  { status: "ready", label: "Ready", template: "Dear {{clientName}}, the items for order {{orderId}} at {{locationName}} are ready. Please contact us to coordinate the next steps." },
  { status: "dispatched", label: "Dispatched", template: "Dear {{clientName}}, order {{orderId}} for {{locationName}} has been dispatched. Please contact us if you need any delivery details." },
  { status: "installed", label: "Installed", template: "Dear {{clientName}}, installation for order {{orderId}} at {{locationName}} has been completed. Thank you for choosing us." },
];

export async function initializeMongo(): Promise<void> {
  const db = await getMongoDb();
  const users = getUsers(db);
  const roles = getRoles(db);
  const chatConversations = getChatConversations(db);
  const chatGroups = getChatGroups(db);
  const chatMessages = getChatMessages(db);
  const clients = getClients(db);
  const locations = getOrderLocations(db);
  const orders = getOrders(db);
  const orderMessageTemplates = getOrderMessageTemplates(db);
  const counters = getCounters(db);
  const orderWindows = getOrderWindows(db);
  const orderPayments = getOrderPayments(db);
  const paymentFlags = getOrderPaymentFlags(db);
  const orderDocumentMetadata = getOrderDocumentMetadata(db);
  const orderActivity = getOrderActivity(db);
  const windowProfiles = getWindowProfiles(db);
  const quotations = getQuotations(db);
  const appNotifications = getAppNotifications(db);
  const pushSubscriptions = getPushSubscriptions(db);
  const quotationRateSubmissions = getQuotationRateSubmissions(db);
  const measurementReferences = getMeasurementReferences(db);

  const measurementReferencesExists = await db
    .listCollections({ name: "measurement_references" }, { nameOnly: true })
    .hasNext();
  if (measurementReferencesExists) {
    await measurementReferences.updateMany(
      { kind: { $exists: false } },
      { $set: { kind: "custom" } },
    );
    const measurementReferenceIndexes = await measurementReferences.indexes();
    if (measurementReferenceIndexes.some((index) => index.name === "measurement_reference_name_unique")) {
      await measurementReferences.dropIndex("measurement_reference_name_unique");
    }
  }

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
    clients.createIndex({ prefixUpper: 1 }, { unique: true, name: "client_prefix_unique" }),
    clients.createIndex({ nameLower: 1 }, { name: "clients_by_name" }),
    locations.createIndex({ codeUpper: 1 }, { unique: true, name: "location_code_unique" }),
    orders.createIndex({ orderId: 1 }, { unique: true, name: "order_id_unique" }),
    orders.createIndex({ sequenceNo: 1 }, { unique: true, name: "order_sequence_unique" }),
    orders.createIndex({ clientId: 1, createdAt: -1 }, { name: "orders_by_client_date" }),
    orders.createIndex({ status: 1, createdAt: -1 }, { name: "orders_by_status_date" }),
    orders.createIndex({ locationCode: 1, createdAt: -1 }, { name: "orders_by_location_date" }),
    orderWindows.createIndex({ orderRecordId: 1, windowNo: 1 }, { unique: true, partialFilterExpression: { archivedAt: null }, name: "active_window_no_unique" }),
    orderWindows.createIndex({ orderRecordId: 1, updatedAt: -1 }, { name: "windows_by_order" }),
    orderPayments.createIndex({ orderRecordId: 1, createdAt: -1 }, { name: "payments_by_order" }),
    paymentFlags.createIndex({ orderRecordId: 1, flaggedAt: -1 }, { name: "payment_flags_by_order_date" }),
    paymentFlags.createIndex({ status: 1, flaggedAt: -1 }, { name: "payment_flags_by_status_date" }),
    paymentFlags.createIndex({ createdAt: -1, _id: 1 }, { name: "payment_flags_by_created_date" }),
    paymentFlags.createIndex({ orderRecordId: 1, createdAt: -1, _id: 1 }, { name: "payment_flags_by_order_created_date" }),
    orderDocumentMetadata.createIndex({ orderRecordId: 1, uploadedAt: -1 }, { name: "documents_by_order" }),
    orderActivity.createIndex({ orderRecordId: 1, createdAt: -1 }, { name: "activity_by_order" }),
    windowProfiles.createIndex(
      { codeUpper: 1 },
      {
        unique: true,
        name: "active_window_profile_code_unique",
        partialFilterExpression: { archivedAt: null },
      },
    ),
    windowProfiles.createIndex({ nameLower: 1 }, { name: "window_profiles_by_name" }),
    quotations.createIndex({ quoteNo: 1 }, { unique: true, name: "quotation_number_unique" }),
    quotations.createIndex({ updatedAt: -1 }, { name: "quotations_by_updated_at" }),
    quotations.createIndex({ clientId: 1, updatedAt: -1 }, { name: "quotations_by_client" }),
    quotations.createIndex({ status: 1, approvalApproverId: 1, approvalSubmittedAt: -1 }, { name: "quotation_approval_queue" }),
    appNotifications.createIndex({ userId: 1, createdAt: -1 }, { name: "notifications_by_user_date" }),
    appNotifications.createIndex({ userId: 1, readAt: 1 }, { name: "notifications_by_user_read_state" }),
    pushSubscriptions.createIndex({ userId: 1, updatedAt: -1 }, { name: "push_subscriptions_by_user" }),
    measurementReferences.createIndex(
      { kind: 1, nameLower: 1 },
      { unique: true, name: "measurement_reference_kind_name_unique" },
    ),
    quotationRateSubmissions.createIndex(
      { measurementRecordId: 1 },
      {
        unique: true,
        name: "rate_request_measurement_sheet_unique",
        partialFilterExpression: { measurementRecordId: { $type: "string" } },
      },
    ),
  ]);

  const now = new Date();
  for (const profile of seedWindowProfiles) {
    await windowProfiles.updateOne(
      { _id: profile._id },
      {
        $setOnInsert: {
          ...profile,
          createdBy: "system",
          updatedBy: "system",
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  }
  await getCounters(db).updateOne(
    { _id: "quotation-sequence" },
    { $setOnInsert: { _id: "quotation-sequence", value: 498, updatedAt: now } },
    { upsert: true },
  );
  await getCounters(db).updateOne(
    { _id: "quotation-rate-sequence" },
    { $setOnInsert: { _id: "quotation-rate-sequence", value: 999, updatedAt: now } },
    { upsert: true },
  );

  for (const role of seedRoles) {
    await roles.updateOne(
      { _id: role._id },
      { $setOnInsert: { ...role, createdAt: now, updatedAt: now } },
      { upsert: true },
    );
  }
  const profileRates = new Map(
    (await windowProfiles.find({}).toArray()).map((profile) => [
      profile._id,
      profile.ratePerSqFt,
    ]),
  );
  const savedQuotations = await quotations.find({ archivedAt: null }).toArray();
  for (const quotation of savedQuotations) {
    let changed = quotation.requiresRateApproval === undefined;
    const items = quotation.items.map((item) => {
      if (
        item.catalogueRatePerSqFt !== undefined &&
        item.rateOverridden !== undefined
      ) {
        return item;
      }
      changed = true;
      const catalogueRatePerSqFt =
        item.catalogueRatePerSqFt ??
        profileRates.get(item.profileId) ??
        item.ratePerSqFt;
      return {
        ...item,
        catalogueRatePerSqFt,
        rateOverridden:
          Math.abs(item.ratePerSqFt - catalogueRatePerSqFt) > 0.005,
      };
    });
    if (changed) {
      await quotations.updateOne(
        { _id: quotation._id },
        {
          $set: {
            items,
            requiresRateApproval: items.some((item) => item.rateOverridden),
            approvalHistory: quotation.approvalHistory ?? [],
          },
        },
      );
    }
  }
  await getQuotationApprovalSettings(db).updateOne(
    { _id: "saved-quotation-approval" },
    {
      $setOnInsert: {
        _id: "saved-quotation-approval",
        approverUserId: null,
        updatedBy: "system",
        updatedAt: now,
      },
    },
    { upsert: true },
  );

  if (process.env.NODE_ENV !== "production") {
    const createSampleQuotation = async ({
      id,
      quoteNo,
      projectName,
      profileId,
      widthMm,
      heightMm,
      quantity,
      ratePerSqFt,
    }: {
      id: string;
      quoteNo: string;
      projectName: string;
      profileId: string;
      widthMm: number;
      heightMm: number;
      quantity: number;
      ratePerSqFt?: number;
    }): Promise<void> => {
      const profile = await windowProfiles.findOne({ _id: profileId });
      if (!profile) return;
      const roundTo = (value: number, places: number) => {
        const factor = 10 ** places;
        return Math.round((value + Number.EPSILON) * factor) / factor;
      };
      const sqFtPerWindow = roundTo((widthMm * heightMm) / 92903.04, 3);
      const appliedRate = ratePerSqFt ?? profile.ratePerSqFt;
      const unitPrice = roundTo(sqFtPerWindow * appliedRate, 2);
      const value = roundTo(unitPrice * quantity, 2);
      const totalAreaSqFt = roundTo(sqFtPerWindow * quantity, 2);
      const subtotal = value;
      const gstAmount = roundTo((subtotal * 18) / 100, 2);
      const rateOverridden = Math.abs(appliedRate - profile.ratePerSqFt) > 0.005;
      const quotation: QuotationDocument = {
        _id: id,
        sequenceNo: 0,
        quoteNo,
        clientId: null,
        customerName: "Sample Customer",
        customerPhone: "0000000000",
        customerAddress: "Sample data only — not a real customer",
        customerGstin: null,
        projectName,
        quotationDate: now.toISOString().slice(0, 10),
        items: [{
          profileId: profile._id,
          profileCode: profile.code,
          profileName: profile.name,
          profileSystem: profile.profileSystem,
          glass: profile.glass,
          profileColor: profile.profileColor,
          meshType: profile.meshType,
          specifications: profile.specifications,
          accessories: profile.accessories,
          remarks: profile.remarks ?? "",
          imageDataUrl: profile.imageDataUrl ?? null,
          drawingType: profile.drawingType,
          code: profile.code,
          location: "Sample opening",
          widthMm,
          heightMm,
          sqFtPerWindow,
          ratePerSqFt: appliedRate,
          catalogueRatePerSqFt: profile.ratePerSqFt,
          rateOverridden,
          unitPrice,
          quantity,
          value,
          weightKgPerWindow: roundTo(sqFtPerWindow * profile.weightKgPerSqFt, 3),
        }],
        transportationCost: 0,
        loadingUnloadingCost: 0,
        additionalChargeDescription: "",
        additionalChargeRate: 0,
        additionalChargeAreaSqFt: 0,
        gstPercent: 18,
        notes: "SAMPLE ONLY — do not send to a customer.",
        totals: {
          componentCount: quantity,
          totalAreaSqFt,
          basicValue: value,
          transportationCost: 0,
          loadingUnloadingCost: 0,
          additionalCharge: 0,
          subtotal,
          gstPercent: 18,
          gstAmount,
          grandTotal: roundTo(subtotal + gstAmount, 2),
          averagePricePerSqFt: totalAreaSqFt ? roundTo(value / totalAreaSqFt, 2) : 0,
        },
        status: "draft",
        requiresRateApproval: rateOverridden,
        approvalHistory: [],
        sampleOnly: true,
        createdBy: "system",
        updatedBy: "system",
        createdAt: now,
        updatedAt: now,
      };
      await quotations.updateOne(
        { _id: id },
        { $setOnInsert: quotation },
        { upsert: true },
      );
    };
    await createSampleQuotation({
      id: "sample-quotation-standard",
      quoteNo: "SAMPLE-STD-001",
      projectName: "[SAMPLE ONLY] Standard quotation",
      profileId: "profile-openable-exz",
      widthMm: 1200,
      heightMm: 1200,
      quantity: 2,
    });
    await createSampleQuotation({
      id: "sample-quotation-rate-override",
      quoteNo: "SAMPLE-RATE-002",
      projectName: "[SAMPLE ONLY] Rate override approval",
      profileId: "profile-sliding-3-track",
      widthMm: 1500,
      heightMm: 1200,
      quantity: 2,
      ratePerSqFt: 525,
    });
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

  for (const seed of seedOrderMessageTemplates) {
    await orderMessageTemplates.updateOne(
      { _id: seed.status },
      {
        $setOnInsert: {
          ...seed,
          _id: seed.status,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  }

  if (process.env.NODE_ENV !== "production") {
    if ((await clients.countDocuments()) === 0) {
      await clients.insertMany(
        seedOrderClients.map((seed) => ({
          _id: seed.id,
          name: seed.name,
          nameLower: seed.name.toLowerCase(),
          phone: seed.phone,
          address: seed.address,
          gstin: seed.gstin,
          prefix: seed.prefix,
          prefixUpper: seed.prefix.toUpperCase(),
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    if ((await locations.countDocuments()) === 0) {
      await locations.insertMany(
        seedOrderLocations.map((seed) => ({
          _id: seed.id,
          code: seed.code,
          codeUpper: seed.code.toUpperCase(),
          name: seed.name,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    const sampleClientCount = await clients.countDocuments({
      _id: { $in: seedOrderClients.map((client) => client.id) },
    });
    const sampleLocationCount = await locations.countDocuments({
      _id: { $in: seedOrderLocations.map((location) => location.id) },
    });
    if (
      (await orders.countDocuments()) === 0 &&
      sampleClientCount === seedOrderClients.length &&
      sampleLocationCount === seedOrderLocations.length
    ) {
      await orders.insertMany(
        seedOrders.map(({ ageDays, ...seed }) => {
          const createdAt = new Date(now.getTime() - ageDays * 24 * 60 * 60 * 1000);
          return {
            _id: seed.id,
            orderId: seed.orderId,
            sequenceNo: seed.sequenceNo,
            clientId: seed.clientId,
            clientName: seed.clientName,
            clientPrefix: seed.clientPrefix,
            clientPhone: seed.clientPhone,
            clientAddress: seed.clientAddress,
            clientGstin: seed.clientGstin,
            locationCode: seed.locationCode,
            locationName: seed.locationName,
            status: seed.status,
            notes: seed.notes,
            createdBy: "admin",
            createdAt,
            updatedBy: null,
            updatedAt: createdAt,
          };
        }),
      );
      logger.info({ orders: seedOrders.length }, "Seeded development order hub records");
    }
  }

  if (process.env.NODE_ENV !== "production") {
    const sampleClientId = "sample-payment-progress-client";
    const sampleLocationId = "sample-payment-progress-location";
    const existingSampleClient = await clients.findOne({ _id: sampleClientId });
    let sampleClientPrefix = existingSampleClient?.prefix ?? "SMP";
    if (!existingSampleClient) {
      let suffix = 1;
      while (await clients.findOne({ prefixUpper: sampleClientPrefix })) {
        sampleClientPrefix = `SMP${suffix}`;
        suffix += 1;
      }
    }
    await clients.updateOne(
      { _id: sampleClientId },
      {
        $setOnInsert: {
          _id: sampleClientId,
          name: "Payment Progress Samples",
          nameLower: "payment progress samples",
          phone: "",
          address: "Development sample records",
          gstin: null,
          prefix: sampleClientPrefix,
          prefixUpper: sampleClientPrefix.toUpperCase(),
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    const existingSampleLocation = await locations.findOne({ _id: sampleLocationId });
    let sampleLocationCode = existingSampleLocation?.code ?? "PAYTEST";
    if (!existingSampleLocation) {
      let suffix = 1;
      while (await locations.findOne({ codeUpper: sampleLocationCode.toUpperCase() })) {
        sampleLocationCode = `PAYTEST${suffix}`;
        suffix += 1;
      }
    }
    await locations.updateOne(
      { _id: sampleLocationId },
      {
        $setOnInsert: {
          _id: sampleLocationId,
          code: sampleLocationCode,
          codeUpper: sampleLocationCode.toUpperCase(),
          name: "Payment Progress Demo",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );

    const progressSamples = [
      { key: "under-30", orderId: "PAY-DEMO-LOW", label: "Under 30%", orderValue: 100000, paid: 20000 },
      { key: "between-30-and-99", orderId: "PAY-DEMO-MID", label: "Between 30% and 99%", orderValue: 100000, paid: 65000 },
      { key: "at-100", orderId: "PAY-DEMO-FULL", label: "100%", orderValue: 100000, paid: 100000 },
    ];
    const currentCounter = await counters.findOne({ _id: "orderSequence" });
    const highestOrder = await orders.find().sort({ sequenceNo: -1 }).limit(1).next();
    let nextSequenceNo = Math.max(currentCounter?.value ?? 0, highestOrder?.sequenceNo ?? 0);
    const sampleCreatedAt = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

    for (const sample of progressSamples) {
      const orderRecordId = `sample-payment-progress-${sample.key}`;
      let order = await orders.findOne({ _id: orderRecordId });
      if (!order) {
        nextSequenceNo += 1;
        let orderId = sample.orderId;
        if (await orders.findOne({ orderId })) {
          orderId = `SAMPLE-${sample.orderId}`;
          if (await orders.findOne({ orderId })) {
            orderId = `${sample.orderId}-${nextSequenceNo}`;
          }
        }
        order = {
          _id: orderRecordId,
          orderId,
          sequenceNo: nextSequenceNo,
          clientId: sampleClientId,
          clientName: `Payment Progress Sample — ${sample.label}`,
          clientPrefix: sampleClientPrefix,
          clientPhone: null,
          clientAddress: "Development sample records",
          clientGstin: null,
          locationCode: sampleLocationCode,
          locationName: "Payment Progress Demo",
          status: "confirmed",
          notes: "Development sample order for payment progress testing.",
          orderValue: sample.orderValue,
          createdBy: "Sample data",
          createdAt: sampleCreatedAt,
          updatedBy: null,
          updatedAt: sampleCreatedAt,
        };
        await orders.insertOne(order);
      }

      const paymentId = `${orderRecordId}-receipt`;
      await orderPayments.updateOne(
        { _id: paymentId },
        {
          $setOnInsert: {
            _id: paymentId,
            orderRecordId,
            amount: sample.paid,
            method: "bank_transfer",
            reference: `SAMPLE-${sample.key}`,
            notes: "Development sample receipt for payment progress testing.",
            paidAt: sampleCreatedAt,
            status: "received",
            voidReason: null,
            createdBy: "Sample data",
            createdAt: sampleCreatedAt,
          },
        },
        { upsert: true },
      );
    }
  }

  if (process.env.NODE_ENV !== "production") {
    const sampleOrders = await orders.find({}).sort({ createdAt: -1 }).limit(4).toArray();
    const sampleDefinitions: Array<{
      key: string;
      orderIndex: number;
      flagType: PaymentFlagType;
      remarks: string;
      flaggedAmount: number;
      daysAgo: number;
      bounceReason: string | null;
      bouncedAmount: number | null;
      bankCharges: number | null;
      followUpCount: number | null;
      lastFollowUpDaysAgo: number | null;
      followUpNotes: string | null;
      status: PaymentFlagStatus;
      resolutionDaysAgo: number | null;
      resolutionNotes: string | null;
    }> = [
      {
        key: "bounced-active",
        orderIndex: 0,
        flagType: "bounced_payment",
        remarks: "",
        flaggedAmount: 28500,
        daysAgo: 1,
        bounceReason: "Insufficient funds",
        bouncedAmount: 28500,
        bankCharges: 450,
        followUpCount: null,
        lastFollowUpDaysAgo: null,
        followUpNotes: null,
        status: "active",
        resolutionDaysAgo: null,
        resolutionNotes: null,
      },
      {
        key: "refusal-active",
        orderIndex: 1,
        flagType: "refusal_to_pay",
        remarks: "",
        flaggedAmount: 42000,
        daysAgo: 2,
        bounceReason: null,
        bouncedAmount: null,
        bankCharges: null,
        followUpCount: 3,
        lastFollowUpDaysAgo: 1,
        followUpNotes: null,
        status: "active",
        resolutionDaysAgo: null,
        resolutionNotes: null,
      },
      {
        key: "bounced-resolved",
        orderIndex: 2,
        flagType: "bounced_payment",
        remarks: "",
        flaggedAmount: 16750,
        daysAgo: 8,
        bounceReason: "Transfer returned by receiving bank",
        bouncedAmount: 16750,
        bankCharges: 250,
        followUpCount: null,
        lastFollowUpDaysAgo: null,
        followUpNotes: null,
        status: "resolved",
        resolutionDaysAgo: 4,
        resolutionNotes: null,
      },
      {
        key: "refusal-active-second",
        orderIndex: 3,
        flagType: "refusal_to_pay",
        remarks: "",
        flaggedAmount: 31500,
        daysAgo: 5,
        bounceReason: null,
        bouncedAmount: null,
        bankCharges: null,
        followUpCount: 4,
        lastFollowUpDaysAgo: 2,
        followUpNotes: null,
        status: "active",
        resolutionDaysAgo: null,
        resolutionNotes: null,
      },
    ];
    for (const sample of sampleDefinitions) {
      const order = sampleOrders[sample.orderIndex % Math.max(sampleOrders.length, 1)];
      if (!order) continue;
      const id = `sample-payment-flag-${sample.key}`;
      const flaggedAt = new Date(now.getTime() - sample.daysAgo * 24 * 60 * 60 * 1000);
      const actions: PaymentFlagActionDocument[] = [{
        id: `${id}-created`,
        action: "created",
        actorId: "sample-data",
        actorName: "System",
        occurredAt: flaggedAt,
        summary: "",
      }];
      const resolutionDate = sample.resolutionDaysAgo == null
        ? null
        : new Date(now.getTime() - sample.resolutionDaysAgo * 24 * 60 * 60 * 1000);
      if (resolutionDate) {
        actions.push({
          id: `${id}-resolved`,
          action: "resolved",
          actorId: "sample-data",
          actorName: "System",
          occurredAt: resolutionDate,
          summary: sample.resolutionNotes ?? "",
        });
      }
      await paymentFlags.updateOne(
        { _id: id },
        {
          $setOnInsert: {
            _id: id,
            orderRecordId: order._id,
            orderId: order.orderId,
            clientName: order.clientName,
            locationName: order.locationName,
            flagType: sample.flagType,
            remarks: sample.remarks,
            flaggedAmount: sample.flaggedAmount,
            flaggedAt,
            flaggedById: "sample-data",
            flaggedBy: "System",
            bounceReason: sample.bounceReason,
            bouncedAmount: sample.bouncedAmount,
            bankCharges: sample.bankCharges,
            followUpCount: sample.followUpCount,
            lastFollowUpDate: sample.lastFollowUpDaysAgo == null
              ? null
              : new Date(now.getTime() - sample.lastFollowUpDaysAgo * 24 * 60 * 60 * 1000),
            followUpNotes: sample.followUpNotes,
            status: sample.status,
            resolutionDate,
            resolutionNotes: sample.resolutionNotes,
            removedAt: null,
            removedBy: null,
            actions,
            createdAt: flaggedAt,
            updatedAt: resolutionDate ?? flaggedAt,
          },
        },
        { upsert: true },
      );
    }
  }

  await counters.updateOne(
    { _id: "orderSequence" },
    { $setOnInsert: { value: 0, updatedAt: now } },
    { upsert: true },
  );
  const highestOrder = await orders.find().sort({ sequenceNo: -1 }).limit(1).next();
  await counters.updateOne(
    { _id: "orderSequence" },
    { $max: { value: highestOrder?.sequenceNo ?? 0 }, $set: { updatedAt: now } },
    { upsert: true },
  );

  await migrateOrderIds(db, now);

  logger.info({ database: db.databaseName }, "Connected to MongoDB");
}