import { randomUUID } from "node:crypto";
import {
  AddOrderLotParams,
  AddOrderLotResponse,
  CreateClientBody,
  CreateClientResponse,
  CreateOrderBody,
  CreateOrderLocationBody,
  CreateOrderLocationResponse,
  CreateOrderResponse,
  DeleteOrderParams,
  DeleteOrderResponse,
  GetOrderParams,
  GetOrderResponse,
  ListClientsQueryParams,
  ListClientsResponse,
  ListOrderLocationsQueryParams,
  ListOrderLocationsResponse,
  ListOrdersQueryParams,
  ListOrdersResponse,
  ListOrderMessageTemplatesResponse,
  UpdateClientBody,
  UpdateClientParams,
  UpdateClientResponse,
  UpdateOrderBody,
  UpdateOrderBillingBody,
  UpdateOrderBillingParams,
  UpdateOrderBillingResponse,
  UpdateOrderLocationBody,
  UpdateOrderLocationParams,
  UpdateOrderLocationResponse,
  UpdateOrderMessageTemplateBody,
  UpdateOrderMessageTemplateParams,
  UpdateOrderMessageTemplateResponse,
  UpdateOrderParams,
  UpdateOrderResponse,
} from "@workspace/api-zod";
import { Router, type IRouter, type Request, type RequestHandler } from "express";
import type { Filter } from "mongodb";
import {
  getClients,
  getCounters,
  getMongoDb,
  getOrderLocations,
  getOrderMessageTemplates,
  getOrders,
  getOrderActivity,
  getOrderPayments,
  getOrderPaymentFlags,
  getOrderGrievances,
  getQuotationRateSubmissions,
  getQuotations,
  getPublicUser,
  getUsers,
  type ClientType,
  type ClientDocument,
  type OrderLotDocument,
  type OrderDocument,
  type OrderLocationDocument,
  type OrderMessageTemplateDocument,
  type OrderStatus,
} from "../lib/mongo";
import {
  formatLotId,
  formatQuotationOrderId,
  normalizeLocationCode,
} from "../lib/order-identifiers";

const router: IRouter = Router();

const ORDER_STATUSES: OrderStatus[] = [
  "quotation_stage",
  "confirmed",
  "in_production",
  "ready",
  "dispatched",
  "installed",
];

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function locationCodeFromName(locationName: string): string {
  const code = locationName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 5)
    .toUpperCase();
  return code || "SITE";
}

async function generateClientPrefix(db: Awaited<ReturnType<typeof getMongoDb>>): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const prefix = `C${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    const existing = await getClients(db).findOne({ prefixUpper: prefix });
    if (!existing) return prefix;
  }
  throw new Error("A unique client prefix could not be generated.");
}

function requireOrderHubPermission(required: "view" | "edit"): RequestHandler {
  return (req, res, next) => {
    void getMongoDb()
      .then(async (db) => {
        const userId = req.session.userId;
        const user = userId
          ? await getUsers(db).findOne({ _id: userId, status: "active" })
          : null;
        if (!user) {
          res.status(401).json({ error: "Sign in to continue." });
          return;
        }

        const publicUser = await getPublicUser(user, db);
        const permission = publicUser.permissions["order-hub"] ?? "none";
        const allowed =
          permission === "edit" || (required === "view" && permission === "view");
        if (!allowed) {
          res.status(403).json({ error: "Client and order access is required." });
          return;
        }
        next();
      })
      .catch(next);
  };
}

const requireMasterAdmin: RequestHandler = (req, res, next) => {
  void getMongoDb()
    .then(async (db) => {
      const userId = req.session.userId;
      const user = userId
        ? await getUsers(db).findOne({ _id: userId, status: "active" })
        : null;
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

function clientResponse(client: ClientDocument) {
  return {
    id: client._id,
    name: client.name,
    type: client.type ?? null,
    phone: client.phone,
    address: client.address,
    gstin: client.gstin,
    prefix: client.prefix,
    isActive: client.isActive,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  };
}

function locationResponse(location: OrderLocationDocument) {
  return {
    id: location._id,
    code: location.code,
    name: location.name,
    isActive: location.isActive,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}

function orderResponse(order: OrderDocument) {
  return {
    id: order._id,
    orderId: order.orderId,
    legacyOrderId: order.legacyOrderId ?? null,
    clientType: order.clientType ?? null,
    quotationId: order.quotationId ?? null,
    quotationNo: order.quotationNo ?? null,
    needsReview: order.needsReview ?? (!order.clientType || !order.quotationId),
    lots: [...(order.lots ?? [])]
      .sort((left, right) => left.sequence - right.sequence)
      .map((lot) => ({
        id: lot._id,
        lotId: lot.lotId,
        sequence: lot.sequence,
        createdAt: lot.createdAt.toISOString(),
      })),
    sequenceNo: order.sequenceNo,
    clientId: order.clientId,
    clientName: order.clientName,
    clientPrefix: order.clientPrefix,
    clientPhone: order.clientPhone,
    clientAddress: order.clientAddress,
    siteAddress: order.siteAddress?.trim() || order.clientAddress?.trim() || null,
    siteLatitude: order.siteLatitude ?? null,
    siteLongitude: order.siteLongitude ?? null,
    clientGstin: order.clientGstin,
    locationCode: order.locationCode,
    locationName: order.locationName,
    status: order.status,
    isActive: order.isActive !== false,
    notes: order.notes,
    orderValue: order.orderValue ?? null,
    createdBy: order.createdBy,
    createdAt: order.createdAt.toISOString(),
    updatedBy: order.updatedBy,
    updatedAt: order.updatedAt.toISOString(),
  };
}

function templateResponse(template: OrderMessageTemplateDocument) {
  return {
    status: template.status,
    label: template.label,
    template: template.template,
    updatedAt: template.updatedAt.toISOString(),
  };
}

function inputError(
  req: Request,
  res: Parameters<RequestHandler>[1],
  error: { message: string },
): void {
  req.log.warn({ validationError: error.message }, "Rejected invalid order hub input");
  res.status(400).json({ error: error.message });
}

router.use(requireOrderHubPermission("view"));

router.get("/clients", async (req, res): Promise<void> => {
  const parsed = ListClientsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    inputError(req, res, parsed.error);
    return;
  }

  const filter: Filter<ClientDocument> = {};
  const includeInactive = String(req.query.includeInactive).toLowerCase() === "true";
  if (!includeInactive) filter.isActive = true;
  const query = parsed.data.q?.trim();
  if (query) {
    const matcher = new RegExp(escapeRegex(query), "i");
    filter.$or = [{ name: matcher }, { phone: matcher }, { prefix: matcher }];
  }

  const clients = await getClients(await getMongoDb())
    .find(filter)
    .sort({ nameLower: 1 })
    .toArray();
  res.json(ListClientsResponse.parse(clients.map(clientResponse)));
});

router.post(
  "/clients",
  requireOrderHubPermission("edit"),
  async (req, res): Promise<void> => {
    const parsed = CreateClientBody.safeParse(req.body);
    if (!parsed.success) {
      inputError(req, res, parsed.error);
      return;
    }

    const name = parsed.data.name.trim();
    const phone = parsed.data.phone.trim();
    const address = parsed.data.address.trim();
    const prefix = parsed.data.prefix.trim().toUpperCase();
    if (!name || !phone || !address || !prefix) {
      res.status(400).json({ error: "Name, phone, address, and prefix are required." });
      return;
    }

    const db = await getMongoDb();
    const now = new Date();
    const client: ClientDocument = {
      _id: randomUUID(),
      name,
      nameLower: name.toLowerCase(),
      phone,
      address,
      gstin: parsed.data.gstin?.trim().toUpperCase() || null,
      prefix,
      prefixUpper: prefix,
      type: parsed.data.type as ClientType,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await getClients(db).insertOne(client);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        res.status(409).json({ error: "That client prefix is already in use." });
        return;
      }
      throw error;
    }

    res.status(201).json(CreateClientResponse.parse(clientResponse(client)));
  },
);

router.patch(
  "/clients/:clientId",
  requireOrderHubPermission("edit"),
  async (req, res): Promise<void> => {
    const params = UpdateClientParams.safeParse(req.params);
    if (!params.success) {
      inputError(req, res, params.error);
      return;
    }
    const parsed = UpdateClientBody.safeParse(req.body);
    if (!parsed.success) {
      inputError(req, res, parsed.error);
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "Provide at least one client field to update." });
      return;
    }

    const updates: Partial<ClientDocument> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) {
      const name = parsed.data.name.trim();
      if (!name) {
        res.status(400).json({ error: "Client name cannot be empty." });
        return;
      }
      updates.name = name;
      updates.nameLower = name.toLowerCase();
    }
    if (parsed.data.phone !== undefined) {
      const phone = parsed.data.phone.trim();
      if (!phone) {
        res.status(400).json({ error: "Client phone cannot be empty." });
        return;
      }
      updates.phone = phone;
    }
    if (parsed.data.address !== undefined) {
      const address = parsed.data.address.trim();
      if (!address) {
        res.status(400).json({ error: "Client address cannot be empty." });
        return;
      }
      updates.address = address;
    }
    if (parsed.data.gstin !== undefined) {
      updates.gstin = parsed.data.gstin?.trim().toUpperCase() || null;
    }
    if (parsed.data.prefix !== undefined) {
      const prefix = parsed.data.prefix.trim().toUpperCase();
      if (!prefix) {
        res.status(400).json({ error: "Client prefix cannot be empty." });
        return;
      }
      updates.prefix = prefix;
      updates.prefixUpper = prefix;
    }
    if (parsed.data.type !== undefined) updates.type = parsed.data.type as ClientType;
    if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;

    const db = await getMongoDb();
    try {
      const result = await getClients(db).updateOne(
        { _id: params.data.clientId },
        { $set: updates },
      );
      if (result.matchedCount === 0) {
        res.status(404).json({ error: "Client not found." });
        return;
      }
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        res.status(409).json({ error: "That client prefix is already in use." });
        return;
      }
      throw error;
    }
    const client = await getClients(db).findOne({ _id: params.data.clientId });
    if (!client) {
      res.status(404).json({ error: "Client not found." });
      return;
    }
    res.json(UpdateClientResponse.parse(clientResponse(client)));
  },
);

router.get("/locations", async (req, res): Promise<void> => {
  const parsed = ListOrderLocationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    inputError(req, res, parsed.error);
    return;
  }
  const includeInactive = String(req.query.includeInactive).toLowerCase() === "true";
  const filter: Filter<OrderLocationDocument> =
    includeInactive ? {} : { isActive: true };
  const locations = await getOrderLocations(await getMongoDb())
    .find(filter)
    .sort({ codeUpper: 1 })
    .toArray();
  res.json(ListOrderLocationsResponse.parse(locations.map(locationResponse)));
});

router.post(
  "/locations",
  requireOrderHubPermission("edit"),
  async (req, res): Promise<void> => {
    const parsed = CreateOrderLocationBody.safeParse(req.body);
    if (!parsed.success) {
      inputError(req, res, parsed.error);
      return;
    }
    const code = parsed.data.code.trim().toUpperCase();
    const name = parsed.data.name.trim();
    if (!code || !name) {
      res.status(400).json({ error: "Location code and name are required." });
      return;
    }

    const now = new Date();
    const location: OrderLocationDocument = {
      _id: randomUUID(),
      code,
      codeUpper: code,
      name,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await getOrderLocations(await getMongoDb()).insertOne(location);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        res.status(409).json({ error: "That location code is already in use." });
        return;
      }
      throw error;
    }
    res.status(201).json(CreateOrderLocationResponse.parse(locationResponse(location)));
  },
);

router.patch(
  "/locations/:locationId",
  requireOrderHubPermission("edit"),
  async (req, res): Promise<void> => {
    const params = UpdateOrderLocationParams.safeParse(req.params);
    if (!params.success) {
      inputError(req, res, params.error);
      return;
    }
    const parsed = UpdateOrderLocationBody.safeParse(req.body);
    if (!parsed.success) {
      inputError(req, res, parsed.error);
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "Provide at least one location field to update." });
      return;
    }

    const updates: Partial<OrderLocationDocument> = { updatedAt: new Date() };
    if (parsed.data.code !== undefined) {
      const code = parsed.data.code.trim().toUpperCase();
      if (!code) {
        res.status(400).json({ error: "Location code cannot be empty." });
        return;
      }
      updates.code = code;
      updates.codeUpper = code;
    }
    if (parsed.data.name !== undefined) {
      const name = parsed.data.name.trim();
      if (!name) {
        res.status(400).json({ error: "Location name cannot be empty." });
        return;
      }
      updates.name = name;
    }
    if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;

    const db = await getMongoDb();
    try {
      const result = await getOrderLocations(db).updateOne(
        { _id: params.data.locationId },
        { $set: updates },
      );
      if (result.matchedCount === 0) {
        res.status(404).json({ error: "Location not found." });
        return;
      }
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        res.status(409).json({ error: "That location code is already in use." });
        return;
      }
      throw error;
    }

    const location = await getOrderLocations(db).findOne({
      _id: params.data.locationId,
    });
    if (!location) {
      res.status(404).json({ error: "Location not found." });
      return;
    }
    res.json(UpdateOrderLocationResponse.parse(locationResponse(location)));
  },
);

router.get("/orders", async (req, res): Promise<void> => {
  const parsed = ListOrdersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    inputError(req, res, parsed.error);
    return;
  }
  const filter: Filter<OrderDocument> = {};
  if (!parsed.data.includeInactive) filter.isActive = { $ne: false };
  if (parsed.data.status) filter.status = parsed.data.status as OrderStatus;
  if (parsed.data.clientId) filter.clientId = parsed.data.clientId;
  if (parsed.data.locationCode) {
    filter.locationCode = parsed.data.locationCode.trim().toUpperCase();
  }
  if (parsed.data.locationName?.trim()) {
    filter.locationName = new RegExp(escapeRegex(parsed.data.locationName.trim()), "i");
  }
  if (parsed.data.from || parsed.data.to) {
    const dateFilter: { $gte?: Date; $lte?: Date } = {};
    if (parsed.data.from) dateFilter.$gte = new Date(`${parsed.data.from}T00:00:00.000Z`);
    if (parsed.data.to) dateFilter.$lte = new Date(`${parsed.data.to}T23:59:59.999Z`);
    if (
      dateFilter.$gte &&
      dateFilter.$lte &&
      dateFilter.$gte.getTime() > dateFilter.$lte.getTime()
    ) {
      res.status(400).json({ error: "The start date must be on or before the end date." });
      return;
    }
    filter.createdAt = dateFilter;
  }
  const query = parsed.data.q?.trim();
  if (query) {
    const matcher = new RegExp(escapeRegex(query), "i");
    filter.$or = [
      { orderId: matcher },
      { legacyOrderId: matcher },
      { "lots.lotId": matcher },
      { clientName: matcher },
      { clientPrefix: matcher },
      { clientPhone: matcher },
      { siteAddress: matcher },
      { locationName: matcher },
    ];
  }
  const orders = await getOrders(await getMongoDb())
    .find(filter)
    .sort({ createdAt: -1, sequenceNo: -1 })
    .toArray();
  res.json(ListOrdersResponse.parse(orders.map(orderResponse)));
});

router.post(
  "/orders",
  requireOrderHubPermission("edit"),
  async (req, res): Promise<void> => {
    const parsed = CreateOrderBody.safeParse(req.body);
    if (!parsed.success) {
      inputError(req, res, parsed.error);
      return;
    }
    const db = await getMongoDb();
    const actorId = req.session.userId;
    if (!actorId) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }

    const locationName = parsed.data.locationName.trim();
    if (locationName.length < 2) {
      res.status(400).json({ error: "Enter a city or location name." });
      return;
    }
    const siteAddress = parsed.data.siteAddress.trim();
    if (siteAddress.length < 3) {
      res.status(400).json({ error: "Enter a site address with at least 3 characters." });
      return;
    }
    const siteLatitude = parsed.data.siteLatitude ?? null;
    const siteLongitude = parsed.data.siteLongitude ?? null;
    if ((siteLatitude === null) !== (siteLongitude === null)) {
      res.status(400).json({ error: "Choose both map coordinates or clear the selected pin." });
      return;
    }

    const isManualClient = !parsed.data.clientId;
    const manualName = parsed.data.clientName?.trim() || "";
    if (isManualClient && (!manualName || !parsed.data.clientType)) {
      res.status(400).json({ error: "Enter the client name and choose Project or Retail." });
      return;
    }

    let existingClient = parsed.data.clientId
      ? await getClients(db).findOne({ _id: parsed.data.clientId, isActive: true })
      : null;
    if (parsed.data.clientId && !existingClient) {
      res.status(404).json({ error: "Choose an active client." });
      return;
    }
    const clientType = parsed.data.clientType ?? existingClient?.type;
    if (clientType !== "Project" && clientType !== "Retail") {
      res.status(409).json({ error: "Choose Project or Retail for this client before creating an order." });
      return;
    }
    if (existingClient?.type && parsed.data.clientType && existingClient.type !== parsed.data.clientType) {
      res.status(409).json({ error: "The selected client already has a different client type." });
      return;
    }

    let quotation = null;
    if (parsed.data.quotationId) {
      quotation = await getQuotations(db).findOne({ _id: parsed.data.quotationId });
      if (!quotation || quotation.archivedAt) {
        res.status(404).json({ error: "Choose an active quotation for this order." });
        return;
      }
      if (quotation.sampleOnly) {
        res.status(400).json({ error: "Sample quotations cannot be used to create an order." });
        return;
      }
      if (isManualClient) {
        const quotationClient = quotation.clientId
          ? await getClients(db).findOne({ _id: quotation.clientId, isActive: true })
          : null;
        if (
          !quotationClient ||
          quotationClient.name.trim().toLocaleLowerCase() !== manualName.toLocaleLowerCase()
        ) {
          res.status(400).json({
            error: "The selected quotation must belong to the manually entered client. Enter that client's saved name or choose the existing client.",
          });
          return;
        }
        if (quotationClient.type && quotationClient.type !== parsed.data.clientType) {
          res.status(409).json({ error: "The selected quotation client's type does not match the chosen Project or Retail type." });
          return;
        }
        existingClient = quotationClient;
      }
      if (quotation.clientId !== existingClient?._id) {
        res.status(400).json({ error: "Choose a quotation linked to the selected client." });
        return;
      }
    }

    const now = new Date();
    const counter = await getCounters(db).findOneAndUpdate(
      { _id: "orderSequence" },
      { $inc: { value: 1 }, $set: { updatedAt: now } },
      { upsert: true, returnDocument: "after" },
    );
    if (!counter) {
      throw new Error("The order sequence counter could not be allocated.");
    }
    const sequenceNo = counter.value;

    const generatedOrderId = quotation
      ? formatQuotationOrderId(clientType, quotation.quoteNo)
      : `TMP-${String(sequenceNo).padStart(6, "0")}`;
    if (!generatedOrderId) {
      res.status(400).json({ error: "The quotation number must use the QT- followed by digits format." });
      return;
    }
    if (quotation && await getOrders(db).findOne({ quotationId: quotation._id })) {
      res.status(409).json({ error: "This quotation is already linked to an order." });
      return;
    }
    if (await getOrders(db).findOne({ orderId: generatedOrderId })) {
      res.status(409).json({ error: `Order ID ${generatedOrderId} is already in use.` });
      return;
    }

    const clientId = existingClient?._id ?? randomUUID();
    const clientPrefix = existingClient?.prefix ?? await generateClientPrefix(db);
    const clientName = existingClient?.name ?? manualName;
    const clientPhone = parsed.data.clientPhone?.trim() || existingClient?.phone || "";
    const clientAddress = parsed.data.clientAddress?.trim() || existingClient?.address || "";
    const clientGstin = parsed.data.clientGstin?.trim().toUpperCase() || existingClient?.gstin || null;
    const client: ClientDocument = existingClient
      ? { ...existingClient, type: clientType }
      : {
          _id: clientId,
          name: clientName,
          nameLower: clientName.toLowerCase(),
          phone: clientPhone,
          address: clientAddress,
          gstin: clientGstin,
          prefix: clientPrefix,
          prefixUpper: clientPrefix,
          type: clientType,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };
    const lots: OrderLotDocument[] =
      clientType === "Project"
        ? [{
            _id: randomUUID(),
            sequence: 1,
            lotId: formatLotId(generatedOrderId, 1),
            createdBy: actorId,
            createdAt: now,
          }]
        : [];
    const order: OrderDocument = {
      _id: randomUUID(),
      orderId: generatedOrderId,
      legacyOrderId: null,
      sequenceNo,
      clientId,
      clientType,
      clientName,
      clientPrefix,
      clientPhone: clientPhone || null,
      clientAddress: clientAddress || null,
      clientGstin,
      locationCode: locationCodeFromName(locationName),
      locationName,
      siteAddress,
      siteLatitude,
      siteLongitude,
      quotationId: quotation?._id ?? null,
      quotationNo: quotation?.quoteNo ?? null,
      needsReview: false,
      lots,
      nextLotSequence: clientType === "Project" ? 2 : 1,
      status: "quotation_stage",
      isActive: true,
      dispatchStatus: "pending_dispatch",
      notes: parsed.data.notes?.trim() || null,
      orderValue: null,
      createdBy: actorId,
      createdAt: now,
      updatedBy: null,
      updatedAt: now,
    };
    let insertedManualClient = false;
    try {
      if (!existingClient) {
        await getClients(db).insertOne(client);
        insertedManualClient = true;
      } else if (!existingClient.type) {
        await getClients(db).updateOne(
          { _id: existingClient._id },
          { $set: { type: clientType, updatedAt: now } },
        );
      }
      await getOrders(db).insertOne(order);
    } catch (error) {
      if (insertedManualClient) {
        await getClients(db).deleteOne({ _id: client._id });
      }
      if (isDuplicateKeyError(error)) {
        res.status(409).json({ error: `Order ID ${generatedOrderId} is already in use.` });
        return;
      }
      throw error;
    }
    const actor = await getUsers(db).findOne({ _id: actorId });
    if (actor) {
      await getOrderActivity(db).insertOne({
        _id: randomUUID(), orderRecordId: order._id, actorId, actorName: actor.name,
        action: "order.created", summary: `Created order ${order.orderId}.`, createdAt: now,
      });
    }
    res.status(201).json(CreateOrderResponse.parse(orderResponse(order)));
  },
);

router.get(
  "/orders/:id",
  requireOrderHubPermission("view"),
  async (req, res): Promise<void> => {
    const params = GetOrderParams.safeParse(req.params);
    if (!params.success) {
      inputError(req, res, params.error);
      return;
    }
    const order = await getOrders(await getMongoDb()).findOne({ _id: params.data.id });
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    res.json(GetOrderResponse.parse(orderResponse(order)));
  },
);

router.patch(
  "/orders/:id",
  requireOrderHubPermission("edit"),
  async (req, res): Promise<void> => {
    const params = UpdateOrderParams.safeParse(req.params);
    if (!params.success) {
      inputError(req, res, params.error);
      return;
    }
    const parsed = UpdateOrderBody.safeParse(req.body);
    if (!parsed.success) {
      inputError(req, res, parsed.error);
      return;
    }
    if (
      parsed.data.status === undefined &&
      parsed.data.notes === undefined &&
      parsed.data.clientName === undefined &&
      parsed.data.clientType === undefined &&
      parsed.data.clientPhone === undefined &&
      parsed.data.clientAddress === undefined &&
      parsed.data.clientGstin === undefined &&
      parsed.data.locationCode === undefined &&
      parsed.data.siteAddress === undefined &&
      parsed.data.siteLatitude === undefined &&
      parsed.data.siteLongitude === undefined &&
      parsed.data.locationName === undefined &&
      parsed.data.quotationId === undefined &&
      parsed.data.isActive === undefined
    ) {
      res.status(400).json({ error: "Provide at least one order field to update." });
      return;
    }
    const actorId = req.session.userId;
    if (!actorId) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }

    const updates: Partial<OrderDocument> = {
      updatedAt: new Date(),
      updatedBy: actorId,
    };
    if (parsed.data.status !== undefined) {
      updates.status = parsed.data.status as OrderStatus;
    }
    if (parsed.data.isActive !== undefined) {
      updates.isActive = parsed.data.isActive;
    }
    if (parsed.data.notes !== undefined) {
      updates.notes = parsed.data.notes?.trim() || null;
    }
    if (parsed.data.clientName !== undefined) {
      const clientName = parsed.data.clientName.trim();
      if (clientName.length < 2) {
        res.status(400).json({ error: "Enter a client name with at least 2 characters." });
        return;
      }
      updates.clientName = clientName;
    }
    if (parsed.data.clientType !== undefined) {
      updates.clientType = parsed.data.clientType;
    }
    if (parsed.data.clientPhone !== undefined) {
      updates.clientPhone = parsed.data.clientPhone?.trim() || null;
    }
    if (parsed.data.clientAddress !== undefined) {
      updates.clientAddress = parsed.data.clientAddress?.trim() || null;
    }
    if (parsed.data.clientGstin !== undefined) {
      updates.clientGstin = parsed.data.clientGstin?.trim().toUpperCase() || null;
    }
    if (parsed.data.siteAddress !== undefined) {
      const siteAddress = parsed.data.siteAddress.trim();
      if (siteAddress.length < 3) {
        res.status(400).json({ error: "Enter a site address with at least 3 characters." });
        return;
      }
      updates.siteAddress = siteAddress;
    }
    if (parsed.data.locationName !== undefined) {
      const locationName = parsed.data.locationName.trim();
      if (locationName.length < 2) {
        res.status(400).json({ error: "Enter a city or location name." });
        return;
      }
      updates.locationName = locationName;
      updates.locationCode = locationCodeFromName(locationName);
    }
    const db = await getMongoDb();
    const before = await getOrders(db).findOne({ _id: params.data.id });
    if (!before) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    if (parsed.data.siteLatitude !== undefined || parsed.data.siteLongitude !== undefined) {
      const siteLatitude = parsed.data.siteLatitude !== undefined ? parsed.data.siteLatitude : before.siteLatitude ?? null;
      const siteLongitude = parsed.data.siteLongitude !== undefined ? parsed.data.siteLongitude : before.siteLongitude ?? null;
      if ((siteLatitude === null) !== (siteLongitude === null)) {
        res.status(400).json({ error: "Choose both map coordinates or clear the selected pin." });
        return;
      }
      updates.siteLatitude = siteLatitude;
      updates.siteLongitude = siteLongitude;
    }
    if (parsed.data.locationCode !== undefined && parsed.data.locationName === undefined) {
      const locationCode = normalizeLocationCode(parsed.data.locationCode);
      if (locationCode !== normalizeLocationCode(before.locationCode)) {
        const location = await getOrderLocations(db).findOne({
          codeUpper: locationCode,
          isActive: true,
        });
        if (!location) {
          res.status(404).json({ error: "Choose an active order location." });
          return;
        }
        updates.locationCode = normalizeLocationCode(location.code);
        updates.locationName = location.name;
      }
    }
    const targetQuotationId = parsed.data.quotationId !== undefined
      ? parsed.data.quotationId
      : parsed.data.clientType !== undefined
        ? before.quotationId ?? null
        : undefined;
    if (targetQuotationId !== undefined) {
      const linkedQuotation = targetQuotationId
        ? await getQuotations(db).findOne({ _id: targetQuotationId })
        : null;
      if (targetQuotationId && (!linkedQuotation || linkedQuotation.archivedAt)) {
        res.status(404).json({ error: "Choose an active quotation for this order." });
        return;
      }
      if (linkedQuotation?.sampleOnly) {
        res.status(400).json({ error: "Sample quotations cannot be linked to an order." });
        return;
      }
      if (linkedQuotation && linkedQuotation.clientId !== before.clientId) {
        res.status(400).json({ error: "Choose a quotation linked to this order's client." });
        return;
      }
      if (linkedQuotation && await getOrders(db).findOne({ quotationId: linkedQuotation._id, _id: { $ne: before._id } })) {
        res.status(409).json({ error: "This quotation is already linked to another order." });
        return;
      }
      const client = await getClients(db).findOne({ _id: before.clientId });
      const clientType = parsed.data.clientType === null
        ? null
        : parsed.data.clientType ?? before.clientType ?? client?.type;
      if (linkedQuotation && clientType !== "Project" && clientType !== "Retail") {
        res.status(409).json({ error: "Set this order's client type to Project or Retail before linking a quotation." });
        return;
      }
      const generatedOrderId = linkedQuotation
        ? formatQuotationOrderId(clientType as ClientType, linkedQuotation.quoteNo)
        : `TMP-${String(before.sequenceNo).padStart(6, "0")}`;
      if (!generatedOrderId) {
        res.status(400).json({ error: "The quotation number must use the QT- followed by digits format." });
        return;
      }
      if (await getOrders(db).findOne({ orderId: generatedOrderId, _id: { $ne: before._id } })) {
        res.status(409).json({ error: `Order ID ${generatedOrderId} is already in use.` });
        return;
      }
      updates.orderId = generatedOrderId;
      updates.quotationId = linkedQuotation?._id ?? null;
      updates.quotationNo = linkedQuotation?.quoteNo ?? null;
      if (linkedQuotation && clientType) updates.clientType = clientType;
      updates.lots = (before.lots ?? []).map((lot) => ({
        ...lot,
        lotId: formatLotId(generatedOrderId, lot.sequence),
      }));
    }
    const result = await getOrders(db).updateOne(
      { _id: params.data.id },
      { $set: updates },
    );
    if (result.matchedCount === 0) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const order = await getOrders(db).findOne({ _id: params.data.id });
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const orderIdChanged = before.orderId !== order.orderId;
    if (orderIdChanged) {
      await Promise.all([
        getOrderPaymentFlags(db).updateMany(
          { orderRecordId: order._id },
          { $set: { orderId: order.orderId, clientName: order.clientName, locationName: order.locationName } },
        ),
        getOrderGrievances(db).updateMany(
          { orderRecordId: order._id },
          { $set: { orderId: order.orderId } },
        ),
        getQuotationRateSubmissions(db).updateMany(
          { orderRecordId: order._id },
          { $set: { orderId: order.orderId } },
        ),
      ]);
    } else if (before.clientName !== order.clientName || before.locationName !== order.locationName) {
      await getOrderPaymentFlags(db).updateMany(
        { orderRecordId: order._id },
        { $set: { clientName: order.clientName, locationName: order.locationName } },
      );
    }
    const actor = await getUsers(db).findOne({ _id: actorId });
    const activeStateChanged =
      before &&
      (before.isActive !== false) !== (order.isActive !== false);
    const quotationChanged = before.quotationId !== order.quotationId;
    if (
      before &&
      actor &&
      (before.clientName !== order.clientName ||
        before.clientType !== order.clientType ||
        before.clientPhone !== order.clientPhone ||
        before.clientAddress !== order.clientAddress ||
        before.clientGstin !== order.clientGstin ||
        quotationChanged ||
        orderIdChanged ||
        before.locationCode !== order.locationCode ||
        before.locationName !== order.locationName ||
        before.siteAddress !== order.siteAddress ||
        before.siteLatitude !== order.siteLatitude ||
        before.siteLongitude !== order.siteLongitude ||
        before.status !== order.status ||
        before.notes !== order.notes ||
        activeStateChanged)
    ) {
      const changes = [
        before.clientName !== order.clientName ? `client name to ${order.clientName}` : "",
        before.clientType !== order.clientType ? `client type to ${order.clientType ?? "not set"}` : "",
        before.clientPhone !== order.clientPhone ? "client phone" : "",
        before.clientAddress !== order.clientAddress ? "client address" : "",
        before.clientGstin !== order.clientGstin ? "GSTIN" : "",
        before.locationName !== order.locationName
          ? `location to ${order.locationName}`
          : before.locationCode !== order.locationCode
            ? `location code to ${order.locationCode}`
            : "",
        before.siteAddress !== order.siteAddress ? "site address" : "",
        before.siteLatitude !== order.siteLatitude || before.siteLongitude !== order.siteLongitude ? "map pin" : "",
        before.status !== order.status ? `status to ${order.status}` : "",
        before.notes !== order.notes ? "internal notes" : "",
        quotationChanged
          ? order.quotationNo
            ? `linked quotation ${order.quotationNo}`
            : "removed the linked quotation"
          : "",
        orderIdChanged ? `changed Order ID to ${order.orderId}` : "",
        (before.isActive !== false) !== (order.isActive !== false)
          ? order.isActive === false ? "archived the order" : "restored the order"
          : "",
      ].filter(Boolean).join(" and ");
      await getOrderActivity(db).insertOne({
        _id: randomUUID(),
        orderRecordId: order._id,
        actorId,
        actorName: actor.name,
        action: activeStateChanged
          ? order.isActive === false ? "order.archived" : "order.restored"
          : "order.updated",
        summary: `Updated ${changes}.`,
        createdAt: new Date(),
      });
    }
    res.json(UpdateOrderResponse.parse(orderResponse(order)));
  },
);

router.delete(
  "/orders/:id",
  requireOrderHubPermission("edit"),
  async (req, res): Promise<void> => {
    const params = DeleteOrderParams.safeParse(req.params);
    if (!params.success) {
      inputError(req, res, params.error);
      return;
    }
    const actorId = req.session.userId;
    if (!actorId) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }

    const db = await getMongoDb();
    const before = await getOrders(db).findOne({ _id: params.data.id });
    if (!before) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    if (before.isActive !== false) {
      const now = new Date();
      await getOrders(db).updateOne(
        { _id: params.data.id },
        { $set: { isActive: false, updatedAt: now, updatedBy: actorId } },
      );
      const actor = await getUsers(db).findOne({ _id: actorId });
      if (actor) {
        await getOrderActivity(db).insertOne({
          _id: randomUUID(),
          orderRecordId: before._id,
          actorId,
          actorName: actor.name,
          action: "order.archived",
          summary: `Archived ${before.orderId} from the active register; linked history was retained.`,
          createdAt: now,
        });
      }
    }
    const order = await getOrders(db).findOne({ _id: params.data.id });
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    res.json(DeleteOrderResponse.parse(orderResponse(order)));
  },
);

router.post(
  "/orders/:id/lots",
  requireOrderHubPermission("edit"),
  async (req, res): Promise<void> => {
    const params = AddOrderLotParams.safeParse(req.params);
    if (!params.success) {
      inputError(req, res, params.error);
      return;
    }
    const db = await getMongoDb();
    const actorId = req.session.userId;
    if (!actorId) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const order = await getOrders(db).findOne({ _id: params.data.id });
      if (!order) {
        res.status(404).json({ error: "Order not found." });
        return;
      }
      if (order.needsReview || !order.clientType || !order.quotationId) {
        res.status(409).json({ error: "Resolve this order's client type and quotation before adding lots." });
        return;
      }

      const expectedNext = order.nextLotSequence;
      const highestLotSequence = (order.lots ?? []).reduce(
        (highest, lot) => Math.max(highest, lot.sequence),
        0,
      );
      const sequence = Math.max(expectedNext ?? 1, highestLotSequence + 1);
      const lot: OrderLotDocument = {
        _id: randomUUID(),
        sequence,
        lotId: formatLotId(order.orderId, sequence),
        createdBy: actorId,
        createdAt: new Date(),
      };
      const filter =
        expectedNext === undefined
          ? { _id: order._id, nextLotSequence: { $exists: false } }
          : { _id: order._id, nextLotSequence: expectedNext };
      const result = await getOrders(db).updateOne(filter, {
        $push: { lots: lot },
        $set: {
          nextLotSequence: sequence + 1,
          updatedAt: lot.createdAt,
          updatedBy: actorId,
        },
      });
      if (result.matchedCount > 0) {
        const updated = await getOrders(db).findOne({ _id: order._id });
        if (!updated) {
          res.status(404).json({ error: "Order not found." });
          return;
        }
        res.status(201).json(AddOrderLotResponse.parse(orderResponse(updated)));
        return;
      }
    }
    res.status(409).json({ error: "The next lot number could not be allocated. Try again." });
  },
);

router.patch("/orders/:id/billing", requireOrderHubPermission("view"), async (req, res): Promise<void> => {
  const params = UpdateOrderBillingParams.safeParse(req.params);
  const parsed = UpdateOrderBillingBody.safeParse(req.body);
  if (!params.success) { inputError(req, res, params.error); return; }
  if (!parsed.success) { inputError(req, res, parsed.error); return; }
  const db = await getMongoDb();
  const userId = req.session.userId;
  const user = userId ? await getUsers(db).findOne({ _id: userId, status: "active" }) : null;
  const publicUser = user ? await getPublicUser(user, db) : null;
  if (!publicUser || publicUser.permissions.payments !== "edit") { res.status(user ? 403 : 401).json({ error: user ? "Payment editing access is required." : "Sign in to continue." }); return; }
  const order = await getOrders(db).findOne({ _id: params.data.id });
  if (!order) { res.status(404).json({ error: "Order not found." }); return; }
  const received = await getOrderPayments(db).aggregate([{ $match: { orderRecordId: order._id, status: "received" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).toArray();
  const total = Number(received[0]?.total ?? 0);
  if (parsed.data.orderValue !== null && parsed.data.orderValue < total) { res.status(400).json({ error: `Order value cannot be below received payments (${total}).` }); return; }
  const old = order.orderValue ?? null;
  await getOrders(db).updateOne({ _id: order._id }, { $set: { orderValue: parsed.data.orderValue, updatedAt: new Date(), updatedBy: userId } });
  if (old !== parsed.data.orderValue) {
    await getOrderActivity(db).insertOne({ _id: randomUUID(), orderRecordId: order._id, actorId: userId!, actorName: user!.name, action: "order.billing_updated", summary: `Changed order value from ${old ?? "unset"} to ${parsed.data.orderValue ?? "unset"}.`, createdAt: new Date() });
  }
  const updated = await getOrders(db).findOne({ _id: order._id });
  res.json(UpdateOrderBillingResponse.parse(orderResponse(updated!)));
});

router.get("/order-message-templates", async (_req, res): Promise<void> => {
  const templates = await getOrderMessageTemplates(await getMongoDb()).find().toArray();
  const templateByStatus = new Map(templates.map((template) => [template.status, template]));
  const response = ORDER_STATUSES.flatMap((status) => {
    const template = templateByStatus.get(status);
    return template ? [templateResponse(template)] : [];
  });
  res.json(ListOrderMessageTemplatesResponse.parse(response));
});

router.patch(
  "/order-message-templates/:status",
  requireMasterAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateOrderMessageTemplateParams.safeParse(req.params);
    if (!params.success) {
      inputError(req, res, params.error);
      return;
    }
    const parsed = UpdateOrderMessageTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      inputError(req, res, parsed.error);
      return;
    }
    const db = await getMongoDb();
    const template = await getOrderMessageTemplates(db).findOne({
      _id: params.data.status as OrderStatus,
    });
    if (!template) {
      res.status(404).json({ error: "Message template not found." });
      return;
    }
    await getOrderMessageTemplates(db).updateOne(
      { _id: template._id },
      { $set: { template: parsed.data.template.trim(), updatedAt: new Date() } },
    );
    const updated = await getOrderMessageTemplates(db).findOne({
      _id: template._id,
    });
    if (!updated) {
      res.status(404).json({ error: "Message template not found." });
      return;
    }
    res.json(
      UpdateOrderMessageTemplateResponse.parse(templateResponse(updated)),
    );
  },
);

router.use((error: unknown, req: Request, res: Parameters<RequestHandler>[1], next: Parameters<RequestHandler>[2]) => {
  req.log.error({ error }, "Order hub request failed");
  next(error);
});

export default router;