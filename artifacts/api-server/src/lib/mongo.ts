import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { GridFSBucket, MongoClient, type Collection, type Db } from "mongodb";
import { logger } from "./logger";
import {
  formatLotId,
  formatOrderId,
  formatQuotationOrderId,
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
export type ClientType = "Project" | "Retail";

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
  installationCapacity?: number;
  dashboardWidgetOrder?: string[];
  dashboardHiddenWidgets?: string[];
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
  installationCapacity: number;
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
  type?: ClientType | null;
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

export interface OrderLotDocument {
  _id: string;
  sequence: number;
  lotId: string;
  createdBy: string;
  createdAt: Date;
}

export interface OrderDocument {
  _id: string;
  orderId: string;
  legacyOrderId?: string | null;
  sequenceNo: number;
  clientId: string;
  clientType?: ClientType | null;
  clientName: string;
  clientPrefix: string;
  clientPhone: string | null;
  clientAddress: string | null;
  clientGstin: string | null;
  locationCode: string;
  locationName: string;
  quotationId?: string | null;
  quotationNo?: string | null;
  needsReview?: boolean;
  lots?: OrderLotDocument[];
  nextLotSequence?: number;
  status: OrderStatus;
  isActive?: boolean;
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
export interface GlassTrackingItemDocument {
  id: string;
  villaNo: string | null;
  windowNo: string;
  glassType: string;
  widthMm: number;
  heightMm: number;
  ordered: number;
  received: number;
  broken: number;
}
export interface GlassTrackingOrderDocument {
  _id: string;
  orderRecordId: string;
  importId: string | null;
  workbookFilename: string | null;
  revision: number;
  items: GlassTrackingItemDocument[];
  uploadedBy: string;
  updatedBy: string;
  uploadedAt: Date | null;
  updatedAt: Date;
}
export interface GlassTrackingWorkbookImportDocument {
  _id: string;
  filename: string;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: Date;
  mappings: Array<{ clientLabel: string; orderRecordId: string }>;
  sections: Array<{
    clientLabel: string;
    items: Array<{
      id: string;
      villaNo: string | null;
      windowNo: string;
      glassType: string;
      widthMm: number;
      heightMm: number;
      ordered: number;
    }>;
  }>;
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
export interface InstallationAssignedMemberDocument {
  id: string;
  name: string;
}
export interface InstallationSubteamDocument {
  _id: string;
  name: string;
  nameLower: string;
  memberIds: string[];
}
export interface InstallationTeamDocument {
  _id: string;
  name: string;
  nameLower: string;
  memberIds: string[];
  subteams: InstallationSubteamDocument[];
  createdBy: string;
  createdAt: Date;
  updatedBy: string;
  updatedAt: Date;
}
export interface InstallationDocument {
  _id: string;
  orderRecordId: string;
  installationStatus: InstallationStatus;
  installationDate: string | null;
  issueReason: string | null;
  teamId?: string | null;
  teamNameSnapshot?: string | null;
  subteamId?: string | null;
  subteamNameSnapshot?: string | null;
  scheduledDate?: string | null;
  assignedMembers?: InstallationAssignedMemberDocument[];
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
  sheetId?: string;
  legacyId?: string | null;
  clientName: string;
  clientNameLower: string;
  location: string | null;
  legacyLocation?: string | null;
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
export function getGlassTrackingOrders(db: Db) { return db.collection<GlassTrackingOrderDocument>("glass_tracking_orders"); }
export function getGlassTrackingWorkbookImports(db: Db) { return db.collection<GlassTrackingWorkbookImportDocument>("glass_tracking_workbook_imports"); }
export function getOrderPayments(db: Db) { return db.collection<OrderPaymentDocument>("order_payments"); }
export function getOrderRefunds(db: Db) { return db.collection<OrderRefundDocument>("order_refunds"); }
export function getOrderPaymentFlags(db: Db) { return db.collection<OrderPaymentFlagDocument>("order_payment_flags"); }
export function getOrderDocumentCategories(db: Db) { return db.collection<OrderDocumentCategoryDocument>("order_document_categories"); }
export function getOrderDocumentMetadata(db: Db) { return db.collection<OrderDocumentMetadataDocument>("order_document_metadata"); }
export function getOrderActivity(db: Db) { return db.collection<OrderActivityDocument>("order_activity"); }
export function getInstallations(db: Db) { return db.collection<InstallationDocument>("installations"); }
export function getInstallationTeams(db: Db) { return db.collection<InstallationTeamDocument>("installation_teams"); }
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

const measurementSheetSequenceId = "measurementSheetSequence";
const measurementSheetMigrationId = "measurementSheetIdFormatV1";
const measurementSheetFullYearMigrationId = "measurementSheetIdFormatV2";

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function measurementDateCode(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}${part("month")}${part("year")}`;
}

function formatMeasurementSheetId(sequence: number, createdAt: Date): string {
  return `MS-${String(sequence).padStart(3, "0")}-${measurementDateCode(createdAt)}`;
}

export async function allocateMeasurementSheetId(db: Db, createdAt: Date): Promise<string> {
  const counter = await getCounters(db).findOneAndUpdate(
    { _id: measurementSheetSequenceId },
    { $inc: { value: 1 }, $set: { updatedAt: new Date() } },
    { upsert: true, returnDocument: "after" },
  );
  if (!counter || !Number.isSafeInteger(counter.value) || counter.value < 1) {
    throw new Error("Could not allocate a unique measurement sheet number.");
  }
  return formatMeasurementSheetId(counter.value, createdAt);
}

interface MeasurementMigrationDocument {
  _id: string;
  state: "pending" | "running" | "complete";
  owner?: string;
  leaseUntil: Date;
  updatedAt: Date;
}

async function migrateMeasurementSheetIds(db: Db, now: Date): Promise<void> {
  const migrations = db.collection<MeasurementMigrationDocument>("system_migrations");
  const counters = getCounters(db);
  const records = getMeasurementRecords(db);
  try {
    await migrations.updateOne(
      { _id: measurementSheetMigrationId },
      { $setOnInsert: { state: "pending", leaseUntil: new Date(0), updatedAt: now } },
      { upsert: true },
    );
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 11000)) {
      throw error;
    }
  }

  const owner = randomUUID();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const current = await migrations.findOne({ _id: measurementSheetMigrationId });
    if (current?.state === "complete") return;
    const leaseNow = new Date();
    const lease = await migrations.findOneAndUpdate(
      {
        _id: measurementSheetMigrationId,
        state: { $ne: "complete" },
        $or: [{ leaseUntil: { $lte: leaseNow } }, { owner }],
      },
      {
        $set: {
          state: "running",
          owner,
          leaseUntil: new Date(leaseNow.getTime() + 60_000),
          updatedAt: leaseNow,
        },
      },
      { returnDocument: "after" },
    );
    if (lease?.owner !== owner) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }

    try {
      const counter = await counters.findOne({ _id: measurementSheetSequenceId });
      const startingSequence = counter?.value ?? 0;
      const existingRecords = await records.find({}).toArray();
      existingRecords.sort((left, right) => {
        const leftDate = isValidDate(left.createdAt) ? left.createdAt : isValidDate(left.updatedAt) ? left.updatedAt : now;
        const rightDate = isValidDate(right.createdAt) ? right.createdAt : isValidDate(right.updatedAt) ? right.updatedAt : now;
        return leftDate.getTime() - rightDate.getTime() || left._id.localeCompare(right._id);
      });
      const updates = existingRecords.map((record, index) => {
        const createdAt = isValidDate(record.createdAt)
          ? record.createdAt
          : isValidDate(record.updatedAt)
            ? record.updatedAt
            : now;
        const updatedAt = isValidDate(record.updatedAt) ? record.updatedAt : createdAt;
        const legacyLocation = record.legacyLocation ?? record.location ?? null;
        return {
          updateOne: {
            filter: { _id: record._id },
            update: {
              $set: {
                sheetId: formatMeasurementSheetId(startingSequence + index + 1, createdAt),
                legacyId: record.legacyId || `MS-${record._id.toUpperCase()}`,
                location: null,
                ...(!isValidDate(record.createdAt) ? { createdAt } : {}),
                ...(legacyLocation ? { legacyLocation } : {}),
                updatedAt,
              },
            },
          },
        };
      });

      for (let offset = 0; offset < updates.length; offset += 500) {
        await records.bulkWrite(updates.slice(offset, offset + 500));
        const heartbeat = new Date();
        await migrations.updateOne(
          { _id: measurementSheetMigrationId, owner },
          { $set: { leaseUntil: new Date(heartbeat.getTime() + 60_000), updatedAt: heartbeat } },
        );
      }

      const finalSequence = startingSequence + existingRecords.length;
      await counters.updateOne(
        { _id: measurementSheetSequenceId },
        { $max: { value: finalSequence }, $set: { updatedAt: now } },
        { upsert: true },
      );
      await migrations.updateOne(
        { _id: measurementSheetMigrationId, owner },
        { $set: { state: "complete", leaseUntil: new Date(0), updatedAt: new Date() }, $unset: { owner: "" } },
      );
      if (existingRecords.length > 0) {
        logger.info(
          { migratedMeasurementRecords: existingRecords.length, lastSequence: finalSequence },
          "Migrated measurement sheet IDs to the IST sequence format",
        );
      }
      return;
    } catch (error) {
      await migrations.updateOne(
        { _id: measurementSheetMigrationId, owner },
        { $set: { state: "pending", leaseUntil: new Date(0), updatedAt: new Date() }, $unset: { owner: "" } },
      );
      throw error;
    }
  }
  throw new Error("Timed out waiting for the measurement ID migration to finish.");
}

async function migrateMeasurementSheetIdsToFullYear(db: Db, now: Date): Promise<void> {
  const migrations = db.collection<MeasurementMigrationDocument>("system_migrations");
  const records = getMeasurementRecords(db);
  try {
    await migrations.updateOne(
      { _id: measurementSheetFullYearMigrationId },
      { $setOnInsert: { state: "pending", leaseUntil: new Date(0), updatedAt: now } },
      { upsert: true },
    );
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 11000)) {
      throw error;
    }
  }

  const owner = randomUUID();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const current = await migrations.findOne({ _id: measurementSheetFullYearMigrationId });
    if (current?.state === "complete") return;
    const leaseNow = new Date();
    const lease = await migrations.findOneAndUpdate(
      {
        _id: measurementSheetFullYearMigrationId,
        state: { $ne: "complete" },
        $or: [{ leaseUntil: { $lte: leaseNow } }, { owner }],
      },
      {
        $set: {
          state: "running",
          owner,
          leaseUntil: new Date(leaseNow.getTime() + 60_000),
          updatedAt: leaseNow,
        },
      },
      { returnDocument: "after" },
    );
    if (lease?.owner !== owner) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }

    try {
      const existingRecords = await records.find({ sheetId: /^MS-\d+-\d{6}$/ }).toArray();
      const updates = existingRecords.map((record) => {
        const match = /^MS-(\d+)-\d{6}$/.exec(record.sheetId || "");
        if (!match) return null;
        const sequence = Number(match[1]);
        if (!Number.isSafeInteger(sequence) || sequence < 1) {
          throw new Error(`Invalid measurement sheet sequence for record ${record._id}.`);
        }
        const createdAt = isValidDate(record.createdAt)
          ? record.createdAt
          : isValidDate(record.updatedAt)
            ? record.updatedAt
            : now;
        return {
          updateOne: {
            filter: { _id: record._id, sheetId: record.sheetId },
            update: { $set: { sheetId: formatMeasurementSheetId(sequence, createdAt) } },
          },
        };
      }).filter((update): update is NonNullable<typeof update> => update !== null);

      for (let offset = 0; offset < updates.length; offset += 500) {
        await records.bulkWrite(updates.slice(offset, offset + 500));
        const heartbeat = new Date();
        await migrations.updateOne(
          { _id: measurementSheetFullYearMigrationId, owner },
          { $set: { leaseUntil: new Date(heartbeat.getTime() + 60_000), updatedAt: heartbeat } },
        );
      }

      await migrations.updateOne(
        { _id: measurementSheetFullYearMigrationId, owner },
        { $set: { state: "complete", leaseUntil: new Date(0), updatedAt: new Date() }, $unset: { owner: "" } },
      );
      if (updates.length > 0) {
        logger.info(
          { migratedMeasurementRecords: updates.length },
          "Migrated measurement sheet IDs to the four-digit year format",
        );
      }
      return;
    } catch (error) {
      await migrations.updateOne(
        { _id: measurementSheetFullYearMigrationId, owner },
        { $set: { state: "pending", leaseUntil: new Date(0), updatedAt: new Date() }, $unset: { owner: "" } },
      );
      throw error;
    }
  }
  throw new Error("Timed out waiting for the full-year measurement ID migration to finish.");
}

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

async function migrateQuotationOrderIds(db: Db, now: Date): Promise<void> {
  const counters = getCounters(db);
  const migrationMarkerId = "quotationOrderIdFormatV1";
  const marker = await counters.findOne({ _id: migrationMarkerId });
  if (marker?.value === 1) return;

  const [orders, clients, quotations] = await Promise.all([
    getOrders(db).find({}).sort({ createdAt: 1, sequenceNo: 1, _id: 1 }).toArray(),
    getClients(db).find({}).toArray(),
    getQuotations(db).find({}).toArray(),
  ]);
  const clientById = new Map(clients.map((client) => [client._id, client]));
  const quotationById = new Map(quotations.map((quotation) => [quotation._id, quotation]));

  const plans = orders.map((order) => {
    const legacyOrderId = order.legacyOrderId ?? order.orderId;
    const client = clientById.get(order.clientId);
    const candidateType = order.clientType ?? client?.type ?? null;
    const clientType: ClientType | null =
      candidateType === "Project" || candidateType === "Retail" ? candidateType : null;
    const quotationId = order.quotationId ?? null;
    const quotation = quotationId ? quotationById.get(quotationId) : undefined;
    const quotationMatchesClient = quotation?.clientId === order.clientId;
    const targetOrderId =
      quotation && clientType && quotationMatchesClient
        ? formatQuotationOrderId(clientType, quotation.quoteNo)
        : null;

    return {
      order,
      legacyOrderId,
      clientType,
      quotationId,
      quotationNo: quotation?.quoteNo ?? order.quotationNo ?? null,
      targetOrderId,
      eligible: Boolean(targetOrderId),
    };
  });

  const countByTargetId = new Map<string, number>();
  const countByQuotationId = new Map<string, number>();
  for (const plan of plans) {
    if (!plan.eligible || !plan.targetOrderId) continue;
    countByTargetId.set(plan.targetOrderId, (countByTargetId.get(plan.targetOrderId) ?? 0) + 1);
    if (plan.quotationId) {
      countByQuotationId.set(plan.quotationId, (countByQuotationId.get(plan.quotationId) ?? 0) + 1);
    }
  }
  for (const plan of plans) {
    if (!plan.eligible || !plan.targetOrderId) continue;
    if (
      (countByTargetId.get(plan.targetOrderId) ?? 0) > 1 ||
      (plan.quotationId && (countByQuotationId.get(plan.quotationId) ?? 0) > 1)
    ) {
      plan.eligible = false;
    }
  }

  let removedCollision = true;
  while (removedCollision) {
    removedCollision = false;
    const occupiedByReviewOrders = new Set(
      plans.filter((plan) => !plan.eligible).map((plan) => plan.order.orderId),
    );
    for (const plan of plans) {
      if (plan.eligible && plan.targetOrderId && occupiedByReviewOrders.has(plan.targetOrderId)) {
        plan.eligible = false;
        removedCollision = true;
      }
    }
  }

  const lotTargets = plans.map((plan) => {
    const parentId = plan.eligible && plan.targetOrderId ? plan.targetOrderId : plan.legacyOrderId;
    const lots = [...(plan.order.lots ?? [])].map((lot) => ({
      ...lot,
      lotId: formatLotId(parentId, lot.sequence),
    }));
    if (plan.clientType === "Project" && lots.length === 0) {
      lots.push({
        _id: randomUUID(),
        sequence: 1,
        lotId: formatLotId(parentId, 1),
        createdBy: "system",
        createdAt: plan.order.createdAt,
      });
    }
    const highestLotSequence = lots.reduce((highest, lot) => Math.max(highest, lot.sequence), 0);
    return {
      lots,
      nextLotSequence: Math.max(plan.order.nextLotSequence ?? 1, highestLotSequence + 1),
    };
  });

  const converting = plans.filter(
    (plan) => plan.eligible && plan.targetOrderId && plan.order.orderId !== plan.targetOrderId,
  );
  if (converting.length > 0) {
    const migrationToken = randomUUID();
    await getOrders(db).bulkWrite(
      converting.map((plan, index) => ({
        updateOne: {
          filter: { _id: plan.order._id },
          update: { $set: { orderId: `__quotation_order_id_${migrationToken}_${index}` } },
        },
      })),
    );
  }

  if (plans.length > 0) {
    await getOrders(db).bulkWrite(
      plans.map((plan, index) => ({
        updateOne: {
          filter: { _id: plan.order._id },
          update: {
            $set: {
              orderId: plan.eligible && plan.targetOrderId ? plan.targetOrderId : plan.legacyOrderId,
              legacyOrderId: plan.legacyOrderId,
              clientType: plan.clientType,
              quotationId: plan.quotationId,
              quotationNo: plan.quotationNo,
              needsReview: !plan.eligible,
              lots: lotTargets[index].lots,
              nextLotSequence: lotTargets[index].nextLotSequence,
            },
          },
        },
      })),
    );
  }

  await counters.updateOne(
    { _id: migrationMarkerId },
    { $set: { value: 1, updatedAt: now } },
    { upsert: true },
  );
  await counters.updateOne(
    { _id: "orderIdFormatV1" },
    { $set: { value: 1, updatedAt: now } },
    { upsert: true },
  );

  const convertedCount = plans.filter((plan) => plan.eligible).length;
  logger.info(
    { convertedOrders: convertedCount, needsReviewOrders: plans.length - convertedCount },
    "Migrated orders to quotation-based IDs",
  );
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
    installationCapacity: user.installationCapacity ?? 5,
    status: user.status,
    lastLogin: user.lastLogin?.toISOString() ?? null,
    permissions,
    permissionOverrides: user.permissionOverrides,
  };
}

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
  const counters = getCounters(db);
  const orderWindows = getOrderWindows(db);
  const glassTrackingOrders = getGlassTrackingOrders(db);
  const glassTrackingWorkbookImports = getGlassTrackingWorkbookImports(db);
  const orderPayments = getOrderPayments(db);
  const paymentFlags = getOrderPaymentFlags(db);
  const orderDocumentMetadata = getOrderDocumentMetadata(db);
  const orderActivity = getOrderActivity(db);
  const windowProfiles = getWindowProfiles(db);
  const quotations = getQuotations(db);
  const appNotifications = getAppNotifications(db);
  const pushSubscriptions = getPushSubscriptions(db);
  const quotationRateSubmissions = getQuotationRateSubmissions(db);
  const measurementRecords = getMeasurementRecords(db);
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
    orders.createIndex({ legacyOrderId: 1 }, { name: "orders_by_legacy_id" }),
    orders.createIndex({ quotationId: 1 }, { name: "orders_by_quotation" }),
    orders.createIndex({ "lots.lotId": 1 }, { name: "orders_by_lot_id" }),
    orders.createIndex({ sequenceNo: 1 }, { unique: true, name: "order_sequence_unique" }),
    orders.createIndex({ clientId: 1, createdAt: -1 }, { name: "orders_by_client_date" }),
    orders.createIndex({ status: 1, createdAt: -1 }, { name: "orders_by_status_date" }),
    orders.createIndex({ locationCode: 1, createdAt: -1 }, { name: "orders_by_location_date" }),
    orders.createIndex({ createdAt: -1 }, { name: "orders_by_created_date" }),
    orderWindows.createIndex({ orderRecordId: 1, windowNo: 1 }, { unique: true, partialFilterExpression: { archivedAt: null }, name: "active_window_no_unique" }),
    orderWindows.createIndex({ orderRecordId: 1, updatedAt: -1 }, { name: "windows_by_order" }),
    glassTrackingOrders.createIndex({ orderRecordId: 1 }, { unique: true, name: "glass_tracking_order_unique" }),
    glassTrackingWorkbookImports.createIndex({ uploadedAt: -1 }, { name: "glass_tracking_imports_by_date" }),
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
    getInstallations(db).createIndex(
      { scheduledDate: 1, installationStatus: 1 },
      { name: "installations_by_scheduled_date" },
    ),
    appNotifications.createIndex({ userId: 1, createdAt: -1 }, { name: "notifications_by_user_date" }),
    appNotifications.createIndex({ userId: 1, readAt: 1 }, { name: "notifications_by_user_read_state" }),
    pushSubscriptions.createIndex({ userId: 1, updatedAt: -1 }, { name: "push_subscriptions_by_user" }),
    measurementReferences.createIndex(
      { kind: 1, nameLower: 1 },
      { unique: true, name: "measurement_reference_kind_name_unique" },
    ),
    measurementRecords.createIndex(
      { sheetId: 1 },
      {
        unique: true,
        name: "measurement_sheet_id_unique",
        partialFilterExpression: { sheetId: { $type: "string" } },
      },
    ),
    measurementRecords.createIndex({ updatedAt: -1 }, { name: "measurement_records_by_updated_at" }),
    getMeasurementVersions(db).createIndex(
      { uploadedAt: -1 },
      { name: "measurement_versions_by_upload_date" },
    ),
    quotationRateSubmissions.createIndex(
      { measurementRecordId: 1 },
      {
        unique: true,
        name: "rate_request_measurement_sheet_unique",
        partialFilterExpression: { measurementRecordId: { $type: "string" } },
      },
    ),
    quotationRateSubmissions.createIndex(
      { status: 1, createdAt: -1 },
      { name: "rate_requests_by_status_date" },
    ),
  ]);

  const now = new Date();
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
  await getCounters(db).updateOne(
    { _id: "quotation-request-sequence" },
    { $setOnInsert: { _id: "quotation-request-sequence", value: 0, updatedAt: now } },
    { upsert: true },
  );

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
  if (process.env.NODE_ENV === "production") {
    if ((await users.countDocuments()) === 0) {
      throw new Error(
        "No Master Admin exists. Provision the first Master Admin before starting production.",
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

  await migrateQuotationOrderIds(db, now);
  await migrateOrderIds(db, now);
  await migrateMeasurementSheetIds(db, now);
  await migrateMeasurementSheetIdsToFullYear(db, now);

  logger.info({ database: db.databaseName }, "Connected to MongoDB");
}