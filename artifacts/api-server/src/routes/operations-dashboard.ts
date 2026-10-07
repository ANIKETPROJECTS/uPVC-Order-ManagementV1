import { Router, type IRouter, type Request } from "express";
import type { Filter } from "mongodb";
import {
  GetOperationsDashboardQueryParams,
  GetOperationsDashboardResponse,
} from "@workspace/api-zod";
import {
  getClients,
  getGlassTrackingOrders,
  getInstallationTeams,
  getInstallations,
  getMeasurementRecords,
  getMeasurementVersions,
  getMongoDb,
  getOrderActivity,
  getOrderPayments,
  getOrderRefunds,
  getOrderWindows,
  getOrderLocations,
  getOrders,
  getPublicUser,
  getQuotationRateSubmissions,
  getQuotations,
  getUsers,
  type InstallationDocument,
  type OrderDocument,
  type OrderStatus,
  type PermissionMap,
  type QuotationDocument,
  type QuotationRateSubmissionDocument,
} from "../lib/mongo";

const router: IRouter = Router();
const IST_OFFSET = "+05:30";
const DAY_MS = 24 * 60 * 60 * 1000;
const ORDER_STATUSES: OrderStatus[] = [
  "quotation_stage",
  "confirmed",
  "in_production",
  "ready",
  "dispatched",
  "installed",
];
const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  quotation_stage: "Quotation stage",
  confirmed: "Confirmed",
  in_production: "In production",
  ready: "Ready",
  dispatched: "Dispatched",
  installed: "Installed",
};

type ErrorSection =
  | "orders"
  | "windows"
  | "finance"
  | "dispatch"
  | "installation"
  | "approvals"
  | "glass"
  | "measurements"
  | "activity";

function parseDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function istBoundary(day: string): Date {
  return new Date(`${day}T00:00:00.000${IST_OFFSET}`);
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateKeyInIst(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getPermission(
  permissions: PermissionMap,
  key: string,
): boolean {
  return permissions[key as keyof PermissionMap] !== undefined
    && permissions[key as keyof PermissionMap] !== "none";
}

function buildOrderQuery(
  params: {
    stage?: OrderStatus;
    clientId?: string;
    locationCode?: string;
    q?: string;
  },
  dateRange?: { start: Date; endExclusive: Date },
): Filter<OrderDocument> {
  const query: Filter<OrderDocument> = { isActive: { $ne: false } };
  if (dateRange) {
    query.createdAt = { $gte: dateRange.start, $lt: dateRange.endExclusive };
  }
  if (params.stage) query.status = params.stage;
  if (params.clientId) query.clientId = params.clientId;
  if (params.locationCode) query.locationCode = params.locationCode;
  if (params.q) {
    const expression = new RegExp(escapeRegex(params.q), "i");
    query.$or = [
      { orderId: expression },
      { legacyOrderId: expression },
      { clientName: expression },
      { clientPhone: expression },
      { clientAddress: expression },
      { locationName: expression },
    ];
  }
  return query;
}

function installmentIsAssigned(installation: InstallationDocument | undefined): boolean {
  return Boolean(installation?.teamId || installation?.assignedMembers?.length);
}

function glassState(
  tracking: { items: Array<{ ordered: number; received: number; broken: number }> } | undefined,
): "untracked" | "pending" | "partial" | "received" | "broken" {
  if (!tracking) return "untracked";
  const ordered = tracking.items.reduce((sum, item) => sum + item.ordered, 0);
  const received = tracking.items.reduce((sum, item) => sum + item.received, 0);
  const broken = tracking.items.reduce((sum, item) => sum + item.broken, 0);
  if (broken > 0) return "broken";
  if (ordered > 0 && received >= ordered) return "received";
  if (received > 0) return "partial";
  return "pending";
}

function orderBalance(
  order: OrderDocument,
  receivedByOrder: Map<string, number>,
  refundedByOrder: Map<string, number>,
): number | null {
  if (typeof order.orderValue !== "number" || !Number.isFinite(order.orderValue)) {
    return null;
  }
  return Math.max(
    0,
    order.orderValue
      - (receivedByOrder.get(order._id) ?? 0)
      + (refundedByOrder.get(order._id) ?? 0),
  );
}

function paymentState(
  order: OrderDocument,
  receivedByOrder: Map<string, number>,
  refundedByOrder: Map<string, number>,
): "paid" | "partial" | "unpaid" | "unknown" {
  const balance = orderBalance(order, receivedByOrder, refundedByOrder);
  if (balance === null) return "unknown";
  if (balance <= 0) return "paid";
  return (receivedByOrder.get(order._id) ?? 0) > 0 ? "partial" : "unpaid";
}

function matchesRelatedFilters(
  order: OrderDocument,
  params: {
    installerId?: string;
    assignment?: "assigned" | "unassigned";
    paymentStatus?: "paid" | "partial" | "unpaid";
    glassStatus?: "untracked" | "pending" | "partial" | "received" | "broken";
  },
  installationByOrder: Map<string, InstallationDocument>,
  glassByOrder: Map<string, { items: Array<{ ordered: number; received: number; broken: number }> }>,
  receivedByOrder: Map<string, number>,
  refundedByOrder: Map<string, number>,
): boolean {
  const installation = installationByOrder.get(order._id);
  if (params.assignment === "assigned" && !installmentIsAssigned(installation)) return false;
  if (params.assignment === "unassigned" && installmentIsAssigned(installation)) return false;
  if (
    params.installerId
    && !installation?.assignedMembers?.some((member) => member.id === params.installerId)
  ) {
    return false;
  }
  if (
    params.paymentStatus
    && paymentState(order, receivedByOrder, refundedByOrder) !== params.paymentStatus
  ) {
    return false;
  }
  if (
    params.glassStatus
    && glassState(glassByOrder.get(order._id)) !== params.glassStatus
  ) {
    return false;
  }
  return true;
}

function getWindowReadiness(
  orderId: string,
  byOrder: Map<string, { total: number; ready: number }>,
): { total: number; ready: number } {
  return byOrder.get(orderId) ?? { total: 0, ready: 0 };
}

function snapshot(
  orders: OrderDocument[],
  canViewOrders: boolean,
  canViewReadiness: boolean,
  canViewFinance: boolean,
  windowsByOrder: Map<string, { total: number; ready: number }>,
  receivedByOrder: Map<string, number>,
  refundedByOrder: Map<string, number>,
) {
  const totalWindows = canViewReadiness
    ? orders.reduce((sum, order) => sum + getWindowReadiness(order._id, windowsByOrder).total, 0)
    : 0;
  const readyWindows = canViewReadiness
    ? orders.reduce((sum, order) => sum + getWindowReadiness(order._id, windowsByOrder).ready, 0)
    : 0;
  const orderValue = canViewFinance
    ? orders.reduce((sum, order) => sum + (order.orderValue ?? 0), 0)
    : null;
  const outstandingBalance = canViewFinance
    ? orders.reduce(
      (sum, order) => sum + (orderBalance(order, receivedByOrder, refundedByOrder) ?? 0),
      0,
    )
    : null;
  return {
    activeOrders: canViewOrders ? orders.length : 0,
    orderValue,
    readyWindows,
    totalWindows,
    readyWindowPercent: canViewReadiness && totalWindows > 0
      ? Math.round((readyWindows / totalWindows) * 100)
      : null,
    installedOrders: canViewOrders
      ? orders.filter((order) => order.status === "installed").length
      : 0,
    outstandingBalance,
  };
}

function makeTrend(
  from: string,
  to: string,
  orders: OrderDocument[],
  canViewOrders: boolean,
  canViewReadiness: boolean,
  canViewFinance: boolean,
  windowsByOrder: Map<string, { total: number; ready: number }>,
  receivedByOrder: Map<string, number>,
  refundedByOrder: Map<string, number>,
) {
  const dayCount = Math.floor(
    (new Date(`${to}T00:00:00.000Z`).getTime()
      - new Date(`${from}T00:00:00.000Z`).getTime()) / DAY_MS,
  ) + 1;
  const granularity = dayCount <= 31 ? "day" : dayCount <= 93 ? "week" : "month";
  const bucketStart = (key: string): string => {
    if (granularity === "month") return `${key.slice(0, 7)}-01`;
    if (granularity === "week") {
      const date = new Date(`${key}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      return date.toISOString().slice(0, 10);
    }
    return key;
  };
  const buckets = new Map<string, {
    orderCount: number;
    orderValue: number;
    readyWindows: number;
    totalWindows: number;
    installedOrders: number;
    outstandingBalance: number;
  }>();
  for (
    let cursor = new Date(`${from}T00:00:00.000Z`);
    cursor <= new Date(`${to}T00:00:00.000Z`);
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const key = bucketStart(cursor.toISOString().slice(0, 10));
    if (!buckets.has(key)) {
      buckets.set(key, {
        orderCount: 0,
        orderValue: 0,
        readyWindows: 0,
        totalWindows: 0,
        installedOrders: 0,
        outstandingBalance: 0,
      });
    }
  }
  for (const order of orders) {
    const key = bucketStart(dateKeyInIst(order.createdAt));
    const bucket = buckets.get(key) ?? {
      orderCount: 0,
      orderValue: 0,
      readyWindows: 0,
      totalWindows: 0,
      installedOrders: 0,
      outstandingBalance: 0,
    };
    bucket.orderCount += 1;
    bucket.orderValue += order.orderValue ?? 0;
    bucket.installedOrders += order.status === "installed" ? 1 : 0;
    const readiness = getWindowReadiness(order._id, windowsByOrder);
    bucket.readyWindows += readiness.ready;
    bucket.totalWindows += readiness.total;
    bucket.outstandingBalance += orderBalance(order, receivedByOrder, refundedByOrder) ?? 0;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => {
    const bucketDate = new Date(`${key}T00:00:00.000Z`);
    const label = granularity === "month"
      ? new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(bucketDate)
      : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(bucketDate);
    return {
      bucket: key,
      label,
      orderCount: canViewOrders ? value.orderCount : 0,
      orderValue: canViewFinance ? value.orderValue : null,
      readyWindows: canViewReadiness ? value.readyWindows : 0,
      totalWindows: canViewReadiness ? value.totalWindows : 0,
      installedOrders: canViewOrders ? value.installedOrders : 0,
      outstandingBalance: canViewFinance ? value.outstandingBalance : null,
    };
  });
}

async function safeRead<T>(
  req: Request,
  section: ErrorSection,
  errors: Record<ErrorSection, string | null>,
  task: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await task();
  } catch {
    errors[section] = "This section could not be loaded.";
    req.log.error({ section }, "Operational dashboard query failed");
    return fallback;
  }
}

router.get("/dashboard/operations", async (req, res): Promise<void> => {
  const from = parseDay(req.query.from);
  const to = parseDay(req.query.to);
  if (!from || !to || from > to) {
    res.status(400).json({ error: "Choose a valid dashboard date range." });
    return;
  }
  const parsed = GetOperationsDashboardQueryParams.safeParse({
    ...req.query,
    from: new Date(`${from}T00:00:00.000Z`),
    to: new Date(`${to}T00:00:00.000Z`),
  });
  if (!parsed.success) {
    res.status(400).json({ error: "One or more dashboard filters are invalid." });
    return;
  }
  const params = parsed.data;
  const start = istBoundary(from);
  const endExclusive = istBoundary(addDays(to, 1));
  const duration = endExclusive.getTime() - start.getTime();
  const previousRange = {
    start: new Date(start.getTime() - duration),
    endExclusive: start,
  };

  const db = await getMongoDb();
  const user = req.session.userId
    ? await getUsers(db).findOne({ _id: req.session.userId, status: "active" })
    : null;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  const publicUser = await getPublicUser(user, db);
  const permissions = publicUser.permissions;
  const canViewOrders = getPermission(permissions, "order-hub");
  const canViewReadiness = getPermission(permissions, "window-readiness");
  const canViewFinance = getPermission(permissions, "payments")
    || getPermission(permissions, "balance-payment");
  const canViewDispatch = getPermission(permissions, "dispatch");
  const canViewInstallation = getPermission(permissions, "installation");
  const canViewRateApproval = getPermission(permissions, "rate-approval");
  const canViewQuotationApproval = getPermission(permissions, "quotation-builder");
  const canViewApprovals = canViewRateApproval || canViewQuotationApproval;
  const canViewMeasurements = getPermission(permissions, "measurements");
  const canViewGlass = getPermission(permissions, "glass-procurement");
  const canQueryOrderData = canViewOrders || canViewReadiness || canViewFinance
    || canViewDispatch || canViewInstallation || canViewGlass;

  if (params.paymentStatus && !canViewFinance) {
    res.status(403).json({ error: "Payment filters require payment access." });
    return;
  }
  if ((params.assignment || params.installerId) && !canViewInstallation) {
    res.status(403).json({ error: "Installation filters require installation access." });
    return;
  }
  if (params.glassStatus && !canViewGlass) {
    res.status(403).json({ error: "Glass filters require glass-tracking access." });
    return;
  }

  const sectionErrors: Record<ErrorSection, string | null> = {
    orders: null,
    windows: null,
    finance: null,
    dispatch: null,
    installation: null,
    approvals: null,
    glass: null,
    measurements: null,
    activity: null,
  };
  const currentQuery = buildOrderQuery(params, { start, endExclusive });
  const currentOrders = canQueryOrderData
    ? await safeRead(
      req,
      "orders",
      sectionErrors,
      () => getOrders(db).find(currentQuery).sort({ createdAt: -1 }).toArray(),
      [],
    )
    : [];
  const previousOrders = params.compare && canQueryOrderData
    ? await safeRead(
      req,
      "orders",
      sectionErrors,
      () => getOrders(db)
        .find(buildOrderQuery(params, previousRange))
        .sort({ createdAt: -1 })
        .toArray(),
      [],
    )
    : [];
  const scheduledInstallations = canViewInstallation
    ? await safeRead(
      req,
      "installation",
      sectionErrors,
      () => getInstallations(db)
        .find({
          scheduledDate: { $gte: from, $lte: to },
          installationStatus: { $ne: "installed" },
        })
        .sort({ scheduledDate: 1 })
        .toArray(),
      [],
    )
    : [];
  const scheduleOrderIds = [...new Set(scheduledInstallations.map((row) => row.orderRecordId))];
  const knownOrderIds = new Set([
    ...currentOrders.map((order) => order._id),
    ...previousOrders.map((order) => order._id),
  ]);
  const missingScheduleOrderIds = scheduleOrderIds.filter((id) => !knownOrderIds.has(id));
  const scheduleOrders = missingScheduleOrderIds.length
    ? await safeRead(
      req,
      "orders",
      sectionErrors,
      () => getOrders(db)
        .find({ _id: { $in: missingScheduleOrderIds }, isActive: { $ne: false } })
        .toArray(),
      [],
    )
    : [];
  const unionOrders = [...new Map(
    [...currentOrders, ...previousOrders, ...scheduleOrders].map((order) => [order._id, order]),
  ).values()];
  const orderById = new Map(unionOrders.map((order) => [order._id, order]));
  const orderRecordIds = unionOrders.map((order) => order._id);

  const windowRows = canViewReadiness || canViewFinance
    ? await safeRead(
      req,
      "windows",
      sectionErrors,
      () => getOrderWindows(db)
        .aggregate<{ _id: string; total: number; ready: number }>([
          { $match: { orderRecordId: { $in: orderRecordIds }, archivedAt: null } },
          {
            $group: {
              _id: "$orderRecordId",
              total: { $sum: 1 },
              ready: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$frameStatus", "ready"] },
                        { $eq: ["$shutterStatus", "ready"] },
                        { $eq: ["$glassStatus", "received"] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ])
        .toArray(),
      [],
    )
    : [];
  const windowsByOrder = new Map(windowRows.map((row) => [row._id, { total: row.total, ready: row.ready }]));

  const financeRows = canViewFinance && orderRecordIds.length
    ? await safeRead(
      req,
      "finance",
      sectionErrors,
      async () => Promise.all([
        getOrderPayments(db)
          .aggregate<{ _id: string; total: number }>([
            {
              $match: {
                orderRecordId: { $in: orderRecordIds },
                status: "received",
              },
            },
            { $group: { _id: "$orderRecordId", total: { $sum: "$amount" } } },
          ])
          .toArray(),
        getOrderRefunds(db)
          .aggregate<{ _id: string; total: number }>([
            { $match: { orderRecordId: { $in: orderRecordIds } } },
            { $group: { _id: "$orderRecordId", total: { $sum: "$amount" } } },
          ])
          .toArray(),
      ]),
      [[], []],
    )
    : [[], []];
  const receivedByOrder = new Map(financeRows[0].map((row) => [row._id, row.total]));
  const refundedByOrder = new Map(financeRows[1].map((row) => [row._id, row.total]));

  const glassRows = canViewGlass && orderRecordIds.length
    ? await safeRead(
      req,
      "glass",
      sectionErrors,
      () => getGlassTrackingOrders(db)
        .find({ orderRecordId: { $in: orderRecordIds } })
        .toArray(),
      [],
    )
    : [];
  const glassByOrder = new Map(glassRows.map((row) => [row.orderRecordId, row]));

  const installationRows = canViewInstallation && orderRecordIds.length
    ? await safeRead(
      req,
      "installation",
      sectionErrors,
      () => getInstallations(db)
        .find({ orderRecordId: { $in: orderRecordIds } })
        .toArray(),
      scheduledInstallations,
    )
    : scheduledInstallations;
  const installationByOrder = new Map(installationRows.map((row) => [row.orderRecordId, row]));

  const matchesCommon = (order: OrderDocument) => {
    if (params.stage && order.status !== params.stage) return false;
    if (params.clientId && order.clientId !== params.clientId) return false;
    if (params.locationCode && order.locationCode !== params.locationCode) return false;
    if (params.q) {
      const query = params.q.toLowerCase();
      const matches = [
        order.orderId,
        order.legacyOrderId ?? "",
        order.clientName,
        order.clientPhone ?? "",
        order.clientAddress ?? "",
        order.locationName,
      ].some((value) => value.toLowerCase().includes(query));
      if (!matches) return false;
    }
    return true;
  };
  const matchesAll = (order: OrderDocument) =>
    matchesCommon(order)
    && matchesRelatedFilters(
      order,
      params,
      installationByOrder,
      glassByOrder,
      receivedByOrder,
      refundedByOrder,
    );
  const filteredCurrentOrders = currentOrders.filter(matchesAll);
  const filteredPreviousOrders = previousOrders.filter(matchesAll);
  const filteredCurrentOrderIds = new Set(filteredCurrentOrders.map((order) => order._id));
  const filteredScheduleRows = scheduledInstallations.filter((installation) => {
    const order = orderById.get(installation.orderRecordId);
    return Boolean(order && matchesAll(order));
  });

  const clients = canViewOrders
    ? await safeRead(
      req,
      "orders",
      sectionErrors,
      () => getClients(db).find({ isActive: true }).sort({ nameLower: 1 }).limit(500).toArray(),
      [],
    )
    : [];
  const locations = canViewOrders
    ? await safeRead(
      req,
      "orders",
      sectionErrors,
      () => getOrderLocations(db).find({ isActive: true }).sort({ codeUpper: 1 }).limit(300).toArray(),
      [],
    )
    : [];
  let installerOptions: Array<{ id: string; label: string }> = [];
  if (canViewInstallation) {
    const teams = await safeRead(
      req,
      "installation",
      sectionErrors,
      () => getInstallationTeams(db).find({}).toArray(),
      [],
    );
    const teamMemberIds = [...new Set(teams.flatMap((team) => [
      ...team.memberIds,
      ...team.subteams.flatMap((subteam) => subteam.memberIds),
    ]))];
    const installerUsers = teamMemberIds.length
      ? await safeRead(
        req,
        "installation",
        sectionErrors,
        () => getUsers(db)
          .find({ _id: { $in: teamMemberIds }, status: "active" })
          .project({ _id: 1, name: 1 })
          .sort({ name: 1 })
          .toArray(),
        [],
      )
      : [];
    installerOptions = installerUsers.map((installer) => ({
      id: installer._id,
      label: installer.name,
    }));
  }

  const range = { start, endExclusive };
  const [rateSubmissions, quotations]: [
    QuotationRateSubmissionDocument[],
    QuotationDocument[],
  ] = await Promise.all([
    canViewRateApproval
      ? safeRead(
        req,
        "approvals",
        sectionErrors,
        () => getQuotationRateSubmissions(db)
          .find({
            status: { $in: ["awaiting_pdf", "pending_review"] },
            createdAt: { $gte: range.start, $lt: range.endExclusive },
          })
          .sort({ createdAt: -1 })
          .limit(1000)
          .toArray(),
        [],
      )
      : [],
    canViewQuotationApproval
      ? safeRead(
        req,
        "approvals",
        sectionErrors,
        () => getQuotations(db)
          .find({
            status: "pending_approval",
            approvalSubmittedAt: { $gte: range.start, $lt: range.endExclusive },
            archivedAt: null,
          })
          .sort({ approvalSubmittedAt: -1 })
          .limit(1000)
          .toArray(),
        [],
      )
      : [],
  ]);
  const orderScopedFilterActive = Boolean(
    params.stage || params.installerId || params.assignment || params.paymentStatus || params.glassStatus,
  );
  const rateMatchesFilters = rateSubmissions.filter((submission) => {
    if (params.q && !`${submission.clientName} ${submission.location ?? ""} ${submission.orderId ?? ""}`
      .toLowerCase().includes(params.q.toLowerCase())) return false;
    if (params.locationCode) {
      const label = locations.find((item) => item.code === params.locationCode)?.name ?? "";
      if (!label || !submission.location?.toLowerCase().includes(label.toLowerCase())) return false;
    }
    if (params.clientId) {
      const name = clients.find((item) => item._id === params.clientId)?.name ?? "";
      if (!name || !submission.clientName.toLowerCase().includes(name.toLowerCase())) return false;
    }
    if (orderScopedFilterActive && submission.orderRecordId
      && !filteredCurrentOrderIds.has(submission.orderRecordId)) return false;
    if (orderScopedFilterActive && !submission.orderRecordId) {
      return false;
    }
    return true;
  });
  const quotationMatchesFilters = quotations.filter((quotation) => {
    if (params.q && !`${quotation.quoteNo} ${quotation.customerName} ${quotation.projectName}`
      .toLowerCase().includes(params.q.toLowerCase())) return false;
    if (params.clientId && quotation.clientId !== params.clientId) return false;
    if (params.locationCode) {
      const label = locations.find((item) => item.code === params.locationCode)?.name ?? "";
      const itemText = JSON.stringify(quotation.items).toLowerCase();
      if (!itemText.includes(params.locationCode.toLowerCase())
        && (!label || !itemText.includes(label.toLowerCase()))) return false;
    }
    if (orderScopedFilterActive) return false;
    return true;
  });

  const measurementVersionRows = canViewMeasurements
    ? await safeRead(
      req,
      "measurements",
      sectionErrors,
      () => getMeasurementVersions(db)
        .find({ uploadedAt: { $gte: start, $lt: endExclusive } })
        .sort({ uploadedAt: -1 })
        .limit(100)
        .toArray(),
      [],
    )
    : [];
  const measurementRecordIds = [...new Set(measurementVersionRows.map((version) => version.recordId))];
  const measurementRecords = canViewMeasurements && measurementRecordIds.length
    ? await safeRead(
      req,
      "measurements",
      sectionErrors,
      () => getMeasurementRecords(db).find({ _id: { $in: measurementRecordIds } }).toArray(),
      [],
    )
    : [];
  const measurementById = new Map(measurementRecords.map((record) => [record._id, record]));
  const recentMeasurements = measurementVersionRows.flatMap((version) => {
    const record = measurementById.get(version.recordId);
    if (!record) return [];
    const linkedOrder = record.orderRecordId ? orderById.get(record.orderRecordId) : undefined;
    if (params.q && !`${record.sheetId ?? ""} ${record.legacyId ?? ""} ${record.clientName} ${record.location ?? ""} ${version.filename} ${linkedOrder?.orderId ?? ""}`
      .toLowerCase().includes(params.q.toLowerCase())) return [];
    if (params.clientId) {
      const clientName = clients.find((client) => client._id === params.clientId)?.name ?? "";
      if (!clientName || !record.clientName.toLowerCase().includes(clientName.toLowerCase())) return [];
    }
    if (params.locationCode) {
      const locationName = locations.find((location) => location.code === params.locationCode)?.name ?? "";
      if (!locationName || !record.location?.toLowerCase().includes(locationName.toLowerCase())) return [];
    }
    if (orderScopedFilterActive && record.orderRecordId
      && !filteredCurrentOrderIds.has(record.orderRecordId)) return [];
    if (orderScopedFilterActive && !record.orderRecordId
      && (params.stage || params.installerId || params.assignment || params.paymentStatus || params.glassStatus)) {
      return [];
    }
    return [{
      id: version._id,
      sheetId: record.sheetId ?? record.legacyId ?? null,
      clientName: record.clientName,
      location: record.location,
      filename: version.filename,
      uploadedAt: version.uploadedAt.toISOString(),
      orderRecordId: record.orderRecordId,
    }];
  }).slice(0, 8);

  const activityRows = canViewOrders || canViewDispatch || canViewInstallation || canViewGlass
    ? await safeRead(
      req,
      "activity",
      sectionErrors,
      () => filteredCurrentOrderIds.size
        ? getOrderActivity(db)
          .find({
            orderRecordId: { $in: [...filteredCurrentOrderIds] },
            createdAt: { $gte: start, $lt: endExclusive },
          })
          .sort({ createdAt: -1 })
          .limit(60)
          .toArray()
        : Promise.resolve([]),
      [],
    )
    : [];
  const activity = activityRows
    .filter((item) => {
      const action = item.action.toLowerCase();
      if (!canViewFinance && action.startsWith("payment")) return false;
      if (!canViewGlass && action.startsWith("glass")) return false;
      if (!canViewInstallation && action.startsWith("installation")) return false;
      if (!canViewDispatch && action.startsWith("dispatch")) return false;
      if (!canViewMeasurements && action.startsWith("measurement")) return false;
      if (!canViewApprovals && (action.startsWith("quotation") || action.startsWith("rate"))) {
        return false;
      }
      return true;
    })
    .slice(0, 12)
    .flatMap((item) => {
      const order = orderById.get(item.orderRecordId);
      if (!order) return [];
      return [{
        id: item._id,
        orderRecordId: item.orderRecordId,
        orderId: order.orderId,
        clientName: order.clientName,
        action: item.action,
        summary: item.summary,
        actorName: item.actorName,
        createdAt: item.createdAt.toISOString(),
      }];
    });

  const attention: Array<{
    id: string;
    title: string;
    description: string;
    count: number;
    amount: number | null;
    href: string;
    severity: "critical" | "warning" | "info" | "success";
  }> = [];
  const pendingDispatchOrders = canViewDispatch
    ? filteredCurrentOrders.filter((order) => {
      const dispatchStatus = order.dispatchStatus ?? "pending_dispatch";
      return (order.status === "ready" && dispatchStatus === "pending_dispatch")
        || dispatchStatus === "dispatched";
    })
    : [];
  const dispatchQueue = pendingDispatchOrders.slice(0, 8).map((order) => ({
      id: order._id,
      orderId: order.orderId,
      clientName: order.clientName,
      locationName: order.locationName,
      dispatchStatus: order.dispatchStatus ?? "pending_dispatch",
    }));
  const pendingDispatch = pendingDispatchOrders.length;
  if (canViewDispatch) {
    attention.push({
      id: "pending-dispatch",
      title: "Dispatch follow-up",
      description: "Orders in the dispatch stage that are not yet marked delivered.",
      count: pendingDispatch,
      amount: null,
      href: "/dispatch",
      severity: pendingDispatch ? "warning" : "success",
    });
  }
  const pendingRateCount = rateMatchesFilters.length;
  if (canViewRateApproval) {
    attention.push({
      id: "pending-rate-approvals",
      title: "Rate requests to review",
      description: "Requests awaiting a PDF or approval decision.",
      count: pendingRateCount,
      amount: null,
      href: "/quotation-builder",
      severity: pendingRateCount ? "warning" : "success",
    });
  }
  if (canViewQuotationApproval) {
    attention.push({
      id: "pending-quotation-approvals",
      title: "Quotations awaiting approval",
      description: "Submitted quotations waiting for a decision.",
      count: quotationMatchesFilters.length,
      amount: null,
      href: "/quotation-approvals",
      severity: quotationMatchesFilters.length ? "warning" : "success",
    });
  }
  if (canViewGlass) {
    const brokenQuantity = filteredCurrentOrders.reduce((sum, order) => sum
      + (glassByOrder.get(order._id)?.items.reduce((itemSum, item) => itemSum + item.broken, 0) ?? 0), 0);
    const brokenOrders = filteredCurrentOrders.filter((order) =>
      (glassByOrder.get(order._id)?.items.reduce((sum, item) => sum + item.broken, 0) ?? 0) > 0).length;
    attention.push({
      id: "broken-glass",
      title: "Broken glass",
      description: `${brokenQuantity} pane${brokenQuantity === 1 ? "" : "s"} recorded broken.`,
      count: brokenOrders,
      amount: null,
      href: "/glass-procurement",
      severity: brokenQuantity ? "critical" : "success",
    });
  }
  if (canViewInstallation) {
    const issueCount = filteredCurrentOrders.filter((order) =>
      installationByOrder.get(order._id)?.installationStatus === "issue").length;
    attention.push({
      id: "installation-issues",
      title: "Installation issues",
      description: "Scheduled installations marked for follow-up.",
      count: issueCount,
      amount: null,
      href: "/installation",
      severity: issueCount ? "critical" : "success",
    });
  }
  if (canViewFinance) {
    const balance = filteredCurrentOrders.reduce(
      (sum, order) => sum + (orderBalance(order, receivedByOrder, refundedByOrder) ?? 0),
      0,
    );
    const outstandingCount = filteredCurrentOrders.filter((order) =>
      (orderBalance(order, receivedByOrder, refundedByOrder) ?? 0) > 0).length;
    attention.push({
      id: "outstanding-payments",
      title: "Outstanding balances",
      description: `${outstandingCount} order${outstandingCount === 1 ? "" : "s"} with a balance.`,
      count: outstandingCount,
      amount: balance,
      href: "/payments",
      severity: outstandingCount ? "warning" : "success",
    });
  }
  if (canViewReadiness) {
    const notReady = filteredCurrentOrders.filter((order) => {
      const readiness = getWindowReadiness(order._id, windowsByOrder);
      return readiness.total > 0 && readiness.ready < readiness.total;
    }).length;
    attention.push({
      id: "window-readiness",
      title: "Orders with windows to finish",
      description: "At least one active window still needs frame, shutter or glass readiness.",
      count: notReady,
      amount: null,
      href: "/order-hub",
      severity: notReady ? "info" : "success",
    });
  }

  const statusMap = new Map<OrderStatus, OrderDocument[]>(
    ORDER_STATUSES.map((status) => [status, filteredCurrentOrders.filter((order) => order.status === status)]),
  );
  const pipeline = ORDER_STATUSES.map((status) => {
    const rows = statusMap.get(status) ?? [];
    return {
      status,
      label: ORDER_STATUS_LABELS[status],
      count: canViewOrders ? rows.length : 0,
      orderValue: canViewFinance
        ? rows.reduce((sum, order) => sum + (order.orderValue ?? 0), 0)
        : null,
    };
  });
  const installationsForSchedule = filteredScheduleRows
    .slice()
    .sort((left, right) => (left.scheduledDate ?? "").localeCompare(right.scheduledDate ?? ""))
    .slice(0, 8)
    .flatMap((installation) => {
      const order = orderById.get(installation.orderRecordId);
      if (!order || !installation.scheduledDate) return [];
      return [{
        orderRecordId: order._id,
        orderId: order.orderId,
        clientName: order.clientName,
        locationName: order.locationName,
        scheduledDate: installation.scheduledDate,
        teamName: installation.teamNameSnapshot ?? null,
        subteamName: installation.subteamNameSnapshot ?? null,
        assignedMembers: (installation.assignedMembers ?? []).map((member) => member.name),
        status: installation.installationStatus,
      }];
    });

  const recentOrders = canViewOrders
    ? filteredCurrentOrders.slice(0, 8).map((order) => ({
      id: order._id,
      orderId: order.orderId,
      clientName: order.clientName,
      locationName: order.locationName,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      orderValue: canViewFinance ? order.orderValue ?? null : null,
      totalWindows: canViewReadiness ? getWindowReadiness(order._id, windowsByOrder).total : 0,
      readyWindows: canViewReadiness ? getWindowReadiness(order._id, windowsByOrder).ready : 0,
      dispatchStatus: canViewDispatch ? order.dispatchStatus ?? "pending_dispatch" : null,
      installationStatus: canViewInstallation
        ? installationByOrder.get(order._id)?.installationStatus ?? "pending"
        : null,
    }))
    : [];
  const topClientRows = new Map<string, { clientName: string; orders: OrderDocument[] }>();
  for (const order of filteredCurrentOrders) {
    const row = topClientRows.get(order.clientId) ?? { clientName: order.clientName, orders: [] };
    row.orders.push(order);
    topClientRows.set(order.clientId, row);
  }
  const topClients = canViewOrders
    ? [...topClientRows.entries()]
      .map(([clientId, value]) => ({
        clientId,
        clientName: value.clientName,
        orderCount: value.orders.length,
        orderValue: canViewFinance
          ? value.orders.reduce((sum, order) => sum + (order.orderValue ?? 0), 0)
          : null,
      }))
      .sort((left, right) => right.orderCount - left.orderCount || left.clientName.localeCompare(right.clientName))
      .slice(0, 6)
    : [];

  const reminderCandidates = canViewFinance
    ? filteredCurrentOrders.flatMap((order) => {
      const balance = orderBalance(order, receivedByOrder, refundedByOrder);
      const readiness = getWindowReadiness(order._id, windowsByOrder);
      const orderWindowsReady = readiness.total > 0 && readiness.ready === readiness.total;
      const validPhone = (order.clientPhone ?? "").replace(/\D/g, "").length >= 10;
      if (!balance || balance <= 0 || !orderWindowsReady || !validPhone) return [];
      return [{
        orderRecordId: order._id,
        orderId: order.orderId,
        clientName: order.clientName,
        locationName: order.locationName,
        balance,
        canOpenWhatsApp: true,
      }];
    }).slice(0, 5)
    : [];

  if (sectionErrors.orders) {
    if (canViewReadiness) sectionErrors.windows ??= sectionErrors.orders;
    if (canViewFinance) sectionErrors.finance ??= sectionErrors.orders;
    if (canViewDispatch) sectionErrors.dispatch ??= sectionErrors.orders;
    if (canViewInstallation) sectionErrors.installation ??= sectionErrors.orders;
    if (canViewGlass) sectionErrors.glass ??= sectionErrors.orders;
    if (canViewOrders || canViewDispatch || canViewInstallation || canViewGlass) {
      sectionErrors.activity ??= sectionErrors.orders;
    }
  }

  const response = {
    updatedAt: new Date().toISOString(),
    permissions: {
      orders: canViewOrders,
      readiness: canViewReadiness,
      finance: canViewFinance,
      dispatch: canViewDispatch,
      installation: canViewInstallation,
      approvals: canViewApprovals,
      measurements: canViewMeasurements,
      glass: canViewGlass,
    },
    filterOptions: {
      clients: canViewOrders ? clients.map((client) => ({ id: client._id, label: client.name })) : [],
      locations: canViewOrders ? locations.map((location) => ({ id: location.code, label: location.name })) : [],
      installers: canViewInstallation ? installerOptions : [],
    },
    summary: {
      ...snapshot(
        filteredCurrentOrders,
        canViewOrders,
        canViewReadiness,
        canViewFinance,
        windowsByOrder,
        receivedByOrder,
        refundedByOrder,
      ),
      previousPeriod: params.compare
        ? snapshot(
          filteredPreviousOrders,
          canViewOrders,
          canViewReadiness,
          canViewFinance,
          windowsByOrder,
          receivedByOrder,
          refundedByOrder,
        )
        : null,
    },
    pipeline,
    trend: makeTrend(
      from,
      to,
      filteredCurrentOrders,
      canViewOrders,
      canViewReadiness,
      canViewFinance,
      windowsByOrder,
      receivedByOrder,
      refundedByOrder,
    ),
    attention,
    activity,
    recentOrders,
    dispatchQueue,
    installationSchedule: installationsForSchedule,
    recentMeasurements,
    topClients,
    reminderCandidates,
    sectionErrors,
  };
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetOperationsDashboardResponse.parse(response));
});

export default router;
