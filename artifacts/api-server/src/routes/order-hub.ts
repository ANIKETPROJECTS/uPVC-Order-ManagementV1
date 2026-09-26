import { randomUUID } from "node:crypto";
import {
  CreateClientBody,
  CreateClientResponse,
  CreateOrderBody,
  CreateOrderLocationBody,
  CreateOrderLocationResponse,
  CreateOrderResponse,
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
  getPublicUser,
  getUsers,
  type ClientDocument,
  type OrderDocument,
  type OrderLocationDocument,
  type OrderMessageTemplateDocument,
  type OrderStatus,
} from "../lib/mongo";
import {
  formatOrderId,
  normalizeLocationCode,
  orderDailyCounterId,
  orderDateKey,
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
    sequenceNo: order.sequenceNo,
    clientId: order.clientId,
    clientName: order.clientName,
    clientPrefix: order.clientPrefix,
    clientPhone: order.clientPhone,
    clientAddress: order.clientAddress,
    clientGstin: order.clientGstin,
    locationCode: order.locationCode,
    locationName: order.locationName,
    status: order.status,
    notes: order.notes,
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
  if (parsed.data.status) filter.status = parsed.data.status as OrderStatus;
  if (parsed.data.clientId) filter.clientId = parsed.data.clientId;
  if (parsed.data.locationCode) {
    filter.locationCode = parsed.data.locationCode.trim().toUpperCase();
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
      { clientName: matcher },
      { clientPrefix: matcher },
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
    const client = await getClients(db).findOne({
      _id: parsed.data.clientId,
      isActive: true,
    });
    const locationCode = normalizeLocationCode(parsed.data.locationCode);
    const location = await getOrderLocations(db).findOne({
      codeUpper: locationCode,
      isActive: true,
    });
    if (!client || !location) {
      res.status(404).json({ error: "Choose an active client and location." });
      return;
    }
    const actorId = req.session.userId;
    if (!actorId) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
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
    const dateKey = orderDateKey(now);
    const normalizedLocationCode = normalizeLocationCode(location.code);
    const dailyCounter = await getCounters(db).findOneAndUpdate(
      { _id: orderDailyCounterId(dateKey, normalizedLocationCode) },
      { $inc: { value: 1 }, $set: { updatedAt: now } },
      { upsert: true, returnDocument: "after" },
    );
    if (!dailyCounter) {
      throw new Error("The daily order sequence could not be allocated.");
    }
    const dailySequenceNo = dailyCounter.value;
    const order: OrderDocument = {
      _id: randomUUID(),
      orderId: formatOrderId(dateKey, normalizedLocationCode, dailySequenceNo),
      sequenceNo,
      clientId: client._id,
      clientName: client.name,
      clientPrefix: client.prefix,
      clientPhone: client.phone,
      clientAddress: client.address,
      clientGstin: client.gstin,
      locationCode: normalizedLocationCode,
      locationName: location.name,
      status: "quotation_stage",
      notes: parsed.data.notes?.trim() || null,
      createdBy: actorId,
      createdAt: now,
      updatedBy: null,
      updatedAt: now,
    };
    await getOrders(db).insertOne(order);
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
    if (parsed.data.status === undefined && parsed.data.notes === undefined) {
      res.status(400).json({ error: "Provide an order status or notes update." });
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
    if (parsed.data.notes !== undefined) {
      updates.notes = parsed.data.notes?.trim() || null;
    }
    const db = await getMongoDb();
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
    res.json(UpdateOrderResponse.parse(orderResponse(order)));
  },
);

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