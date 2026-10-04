import { randomUUID } from "node:crypto";
import {
  ArchiveQuotationParams,
  ArchiveWindowProfileParams,
  CreateQuotationBody,
  CreateQuotationResponse,
  CreateWindowProfileBody,
  CreateWindowProfileResponse,
  GetQuotationParams,
  GetQuotationResponse,
  ListQuotationsResponse,
  ListWindowProfilesResponse,
  UpdateQuotationBody,
  UpdateQuotationParams,
  UpdateQuotationResponse,
  UpdateWindowProfileBody,
  UpdateWindowProfileParams,
  UpdateWindowProfileResponse,
  type QuotationInput,
  type WindowProfileDrawingType,
  type WindowProfileInput,
} from "@workspace/api-zod";
import { Router, type IRouter, type Request, type RequestHandler } from "express";
import {
  getClients,
  getCounters,
  getMongoDb,
  getQuotations,
  getUsers,
  getWindowProfiles,
  getPublicUser,
  type QuotationDocument,
  type QuotationItemDocument,
  type QuotationTotalsDocument,
  type WindowProfileDocument,
} from "../lib/mongo";
import {
  localImageStoragePath,
  removeProjectUpload,
  storeImageDataUrl,
} from "../lib/project-upload-storage";

const router: IRouter = Router();
const SQ_FT_PER_SQUARE_MM = 92903.04;
const MAX_WINDOW_PROFILE_IMAGE_BYTES = 1_000_000;

interface UserContext {
  id: string;
  name: string;
  permissions: Record<string, "none" | "view" | "edit">;
  masterAdmin: boolean;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

function inputError(
  req: Request,
  res: Parameters<RequestHandler>[1],
  error: { message: string },
): void {
  req.log.warn({ validationError: error.message }, "Rejected invalid quotation input");
  res.status(400).json({ error: error.message });
}

async function context(
  req: Request,
  res: Parameters<RequestHandler>[1],
  edit = false,
): Promise<UserContext | null> {
  const db = await getMongoDb();
  const userId = req.session.userId;
  const user = userId
    ? await getUsers(db).findOne({ _id: userId, status: "active" })
    : null;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return null;
  }

  const publicUser = await getPublicUser(user, db);
  const orderPermission = publicUser.permissions["order-hub"] ?? "none";
  if (orderPermission === "none") {
    res.status(403).json({ error: "Client and order access is required." });
    return null;
  }

  const quotationPermission = publicUser.permissions["quotation-builder"] ?? "none";
  if (
    quotationPermission === "none" ||
    (edit && quotationPermission !== "edit" && publicUser.roleId !== "master-admin")
  ) {
    res.status(403).json({
      error: edit
        ? "Quotation editing access is required."
        : "Quotation access is required.",
    });
    return null;
  }

  return {
    id: user._id,
    name: user.name,
    permissions: publicUser.permissions,
    masterAdmin: publicUser.roleId === "master-admin",
  };
}

function windowProfileResponse(profile: WindowProfileDocument) {
  return {
    id: profile._id,
    code: profile.code,
    name: profile.name,
    profileSystem: profile.profileSystem,
    glass: profile.glass,
    profileColor: profile.profileColor,
    meshType: profile.meshType,
    specifications: profile.specifications,
    accessories: profile.accessories,
    remarks: profile.remarks ?? "",
    imageDataUrl: profile.imageDataUrl ?? null,
    drawingType: profile.drawingType,
    ratePerSqFt: profile.ratePerSqFt,
    weightKgPerSqFt: profile.weightKgPerSqFt,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function quotationResponse(quotation: QuotationDocument) {
  const items = quotation.items.map((item) => ({
    ...item,
    catalogueRatePerSqFt: item.catalogueRatePerSqFt ?? item.ratePerSqFt,
    rateOverridden:
      item.rateOverridden ??
      Math.abs(item.ratePerSqFt - (item.catalogueRatePerSqFt ?? item.ratePerSqFt)) > 0.005,
  }));
  return {
    id: quotation._id,
    quoteNo: quotation.quoteNo,
    clientId: quotation.clientId,
    customerName: quotation.customerName,
    customerPhone: quotation.customerPhone,
    customerAddress: quotation.customerAddress,
    customerGstin: quotation.customerGstin,
    projectName: quotation.projectName,
    quotationDate: quotation.quotationDate,
    items,
    transportationCost: quotation.transportationCost,
    loadingUnloadingCost: quotation.loadingUnloadingCost,
    additionalChargeDescription: quotation.additionalChargeDescription,
    additionalChargeRate: quotation.additionalChargeRate,
    additionalChargeAreaSqFt: quotation.additionalChargeAreaSqFt,
    gstPercent: quotation.gstPercent,
    notes: quotation.notes,
    totals: quotation.totals,
    status: quotation.status,
    sampleOnly: quotation.sampleOnly ?? false,
    requiresRateApproval:
      quotation.requiresRateApproval ?? items.some((item) => item.rateOverridden),
    approvalHistory: (quotation.approvalHistory ?? []).map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    })),
    createdBy: quotation.createdBy,
    updatedBy: quotation.updatedBy,
    createdAt: quotation.createdAt.toISOString(),
    updatedAt: quotation.updatedAt.toISOString(),
  };
}

function quotationLineKey(line: {
  profileId: string;
  code: string;
  location: string;
  widthMm: number;
  heightMm: number;
  quantity: number;
}): string {
  return JSON.stringify([
    line.profileId,
    line.code.trim(),
    line.location.trim(),
    line.widthMm,
    line.heightMm,
    line.quantity,
  ]);
}

async function buildQuotationValues(
  input: QuotationInput,
  existingItems: QuotationItemDocument[] = [],
): Promise<{
  clientId: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerGstin: string | null;
  items: QuotationItemDocument[];
  totals: QuotationTotalsDocument;
}> {
  const db = await getMongoDb();
  let customer = {
    clientId: input.clientId,
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone.trim(),
    customerAddress: input.customerAddress.trim(),
    customerGstin: input.customerGstin?.trim() || null,
  };

  if (input.clientId) {
    const client = await getClients(db).findOne({ _id: input.clientId, isActive: true });
    if (!client) {
      throw Object.assign(new Error("The selected client is no longer active."), {
        statusCode: 404,
      });
    }
    customer = {
      clientId: client._id,
      customerName: client.name,
      customerPhone: client.phone,
      customerAddress: client.address,
      customerGstin: client.gstin,
    };
  }

  const existingByKey = new Map<string, QuotationItemDocument[]>();
  for (const existingItem of existingItems) {
    const key = quotationLineKey(existingItem);
    const matches = existingByKey.get(key) ?? [];
    matches.push(existingItem);
    existingByKey.set(key, matches);
  }

  const profileIds = [...new Set(input.items.map((item) => item.profileId))];
  const profiles = await getWindowProfiles(db)
    .find({ _id: { $in: profileIds }, archivedAt: null })
    .toArray();
  const profilesById = new Map(profiles.map((profile) => [profile._id, profile]));

  const items: QuotationItemDocument[] = input.items.map((line) => {
    const preserved = existingByKey.get(quotationLineKey(line))?.shift();
    const profile = profilesById.get(line.profileId);
    if (!profile && !preserved) {
      throw Object.assign(new Error("A selected window profile is unavailable."), {
        statusCode: 404,
      });
    }
    if (preserved) {
      const catalogueRatePerSqFt =
        preserved.catalogueRatePerSqFt ?? profile?.ratePerSqFt ?? preserved.ratePerSqFt;
      const ratePerSqFt = line.ratePerSqFt ?? preserved.ratePerSqFt;
      if (
        ratePerSqFt === preserved.ratePerSqFt &&
        preserved.catalogueRatePerSqFt !== undefined &&
        preserved.rateOverridden !== undefined
      ) {
        return preserved;
      }
      const unitPrice = roundTo(preserved.sqFtPerWindow * ratePerSqFt, 2);
      return {
        ...preserved,
        ratePerSqFt,
        catalogueRatePerSqFt,
        rateOverridden: Math.abs(ratePerSqFt - catalogueRatePerSqFt) > 0.005,
        unitPrice,
        value: roundTo(unitPrice * preserved.quantity, 2),
      };
    }
    if (!profile) {
      throw Object.assign(new Error("A selected window profile is unavailable."), {
        statusCode: 404,
      });
    }
    const sqFtPerWindow = roundTo(
      (line.widthMm * line.heightMm) / SQ_FT_PER_SQUARE_MM,
      3,
    );
    const ratePerSqFt = line.ratePerSqFt ?? profile.ratePerSqFt;
    const rateOverridden =
      Math.abs(ratePerSqFt - profile.ratePerSqFt) > 0.005;
    const unitPrice = roundTo(sqFtPerWindow * ratePerSqFt, 2);
    const value = roundTo(unitPrice * line.quantity, 2);
    const weightKgPerWindow = roundTo(
      sqFtPerWindow * profile.weightKgPerSqFt,
      3,
    );
    return {
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
      code: line.code.trim(),
      location: line.location.trim(),
      widthMm: line.widthMm,
      heightMm: line.heightMm,
      sqFtPerWindow,
      ratePerSqFt,
      catalogueRatePerSqFt: profile.ratePerSqFt,
      rateOverridden,
      unitPrice,
      quantity: line.quantity,
      value,
      weightKgPerWindow,
    };
  });

  const componentCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAreaSqFt = roundTo(
    items.reduce((sum, item) => sum + item.sqFtPerWindow * item.quantity, 0),
    2,
  );
  const basicValue = roundTo(
    items.reduce((sum, item) => sum + item.value, 0),
    2,
  );
  const additionalCharge = roundTo(
    input.additionalChargeRate * input.additionalChargeAreaSqFt,
    2,
  );
  const transportationCost = roundTo(input.transportationCost, 2);
  const loadingUnloadingCost = roundTo(input.loadingUnloadingCost, 2);
  const subtotal = roundTo(
    basicValue + transportationCost + loadingUnloadingCost + additionalCharge,
    2,
  );
  const gstAmount = roundTo((subtotal * input.gstPercent) / 100, 2);
  const grandTotal = roundTo(subtotal + gstAmount, 2);
  const totals: QuotationTotalsDocument = {
    componentCount,
    totalAreaSqFt,
    basicValue,
    transportationCost,
    loadingUnloadingCost,
    additionalCharge,
    subtotal,
    gstPercent: input.gstPercent,
    gstAmount,
    grandTotal,
    averagePricePerSqFt: totalAreaSqFt ? roundTo(subtotal / totalAreaSqFt, 2) : 0,
  };

  return { ...customer, items, totals };
}

function quotationNumber(sequenceNo: number): string {
  return `THE-QT-${String(sequenceNo).padStart(8, "0")}`;
}

router.get("/window-profiles", async (req, res): Promise<void> => {
  const actor = await context(req, res);
  if (!actor) return;
  const profiles = await getWindowProfiles(await getMongoDb())
    .find({ archivedAt: null })
    .sort({ nameLower: 1 })
    .toArray();
  res.json(ListWindowProfilesResponse.parse(profiles.map(windowProfileResponse)));
});

router.post("/window-profiles", async (req, res): Promise<void> => {
  const actor = await context(req, res, true);
  if (!actor) return;
  const parsed = CreateWindowProfileBody.safeParse(req.body);
  if (!parsed.success) {
    inputError(req, res, parsed.error);
    return;
  }
  const input: WindowProfileInput = parsed.data;
  const imageDataUrl = input.imageDataUrl
    ? await storeImageDataUrl(input.imageDataUrl, "window-profiles", MAX_WINDOW_PROFILE_IMAGE_BYTES)
    : null;
  if (input.imageDataUrl && !imageDataUrl) {
    res.status(400).json({ error: "Choose a valid JPEG, PNG, or WebP profile drawing." });
    return;
  }
  const createdImagePath = input.imageDataUrl?.startsWith("data:")
    ? localImageStoragePath(imageDataUrl ?? "", "window-profiles")
    : null;
  const now = new Date();
  const code = input.code.trim();
  const document: WindowProfileDocument = {
    _id: randomUUID(),
    code,
    codeUpper: code.toUpperCase(),
    name: input.name.trim(),
    nameLower: input.name.trim().toLowerCase(),
    profileSystem: input.profileSystem.trim(),
    glass: input.glass.trim(),
    profileColor: input.profileColor.trim(),
    meshType: input.meshType.trim(),
    specifications: input.specifications.trim(),
    accessories: input.accessories.trim(),
    remarks: (input.remarks ?? "").trim(),
    imageDataUrl,
    drawingType: input.drawingType,
    ratePerSqFt: input.ratePerSqFt,
    weightKgPerSqFt: input.weightKgPerSqFt,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await getWindowProfiles(await getMongoDb()).insertOne(document);
    res.status(201).json(
      CreateWindowProfileResponse.parse(windowProfileResponse(document)),
    );
  } catch (error) {
    if (createdImagePath) {
      await removeProjectUpload(createdImagePath).catch((cleanupError: unknown) =>
        req.log.error({ err: cleanupError }, "Failed to clean up an unused profile image"),
      );
    }
    if (isDuplicateKeyError(error)) {
      res.status(409).json({ error: "A window profile with that code already exists." });
      return;
    }
    throw error;
  }
});

router.patch("/window-profiles/:profileId", async (req, res): Promise<void> => {
  const actor = await context(req, res, true);
  if (!actor) return;
  const parsedParams = UpdateWindowProfileParams.safeParse(req.params);
  const parsedBody = UpdateWindowProfileBody.safeParse(req.body);
  if (!parsedParams.success) {
    inputError(req, res, parsedParams.error);
    return;
  }
  if (!parsedBody.success) {
    inputError(req, res, parsedBody.error);
    return;
  }
  const input: WindowProfileInput = parsedBody.data;
  const imageDataUrl = input.imageDataUrl
    ? await storeImageDataUrl(input.imageDataUrl, "window-profiles", MAX_WINDOW_PROFILE_IMAGE_BYTES)
    : null;
  if (input.imageDataUrl && !imageDataUrl) {
    res.status(400).json({ error: "Choose a valid JPEG, PNG, or WebP profile drawing." });
    return;
  }
  const createdImagePath = input.imageDataUrl?.startsWith("data:")
    ? localImageStoragePath(imageDataUrl ?? "", "window-profiles")
    : null;
  const code = input.code.trim();
  const now = new Date();
  try {
    const updated = await getWindowProfiles(await getMongoDb()).findOneAndUpdate(
      { _id: parsedParams.data.profileId, archivedAt: null },
      {
        $set: {
          code,
          codeUpper: code.toUpperCase(),
          name: input.name.trim(),
          nameLower: input.name.trim().toLowerCase(),
          profileSystem: input.profileSystem.trim(),
          glass: input.glass.trim(),
          profileColor: input.profileColor.trim(),
          meshType: input.meshType.trim(),
          specifications: input.specifications.trim(),
          accessories: input.accessories.trim(),
          remarks: (input.remarks ?? "").trim(),
          imageDataUrl,
          drawingType: input.drawingType,
          ratePerSqFt: input.ratePerSqFt,
          weightKgPerSqFt: input.weightKgPerSqFt,
          updatedBy: actor.id,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      if (createdImagePath) {
        await removeProjectUpload(createdImagePath).catch((cleanupError: unknown) =>
          req.log.error({ err: cleanupError }, "Failed to clean up an unused profile image"),
        );
      }
      res.status(404).json({ error: "Window profile not found." });
      return;
    }
    res.json(UpdateWindowProfileResponse.parse(windowProfileResponse(updated)));
  } catch (error) {
    if (createdImagePath) {
      await removeProjectUpload(createdImagePath).catch((cleanupError: unknown) =>
        req.log.error({ err: cleanupError }, "Failed to clean up an unused profile image"),
      );
    }
    if (isDuplicateKeyError(error)) {
      res.status(409).json({ error: "A window profile with that code already exists." });
      return;
    }
    throw error;
  }
});

router.delete("/window-profiles/:profileId", async (req, res): Promise<void> => {
  const actor = await context(req, res, true);
  if (!actor) return;
  const parsed = ArchiveWindowProfileParams.safeParse(req.params);
  if (!parsed.success) {
    inputError(req, res, parsed.error);
    return;
  }
  const result = await getWindowProfiles(await getMongoDb()).updateOne(
    { _id: parsed.data.profileId, archivedAt: null },
    { $set: { archivedAt: new Date(), updatedAt: new Date(), updatedBy: actor.id } },
  );
  if (!result.matchedCount) {
    res.status(404).json({ error: "Window profile not found." });
    return;
  }
  res.status(204).end();
});

router.get("/quotations", async (req, res): Promise<void> => {
  const actor = await context(req, res);
  if (!actor) return;
  const quotations = await getQuotations(await getMongoDb())
    .find({ archivedAt: null })
    .sort({ updatedAt: -1 })
    .toArray();
  res.json(ListQuotationsResponse.parse(quotations.map(quotationResponse)));
});

router.post("/quotations", async (req, res): Promise<void> => {
  const actor = await context(req, res, true);
  if (!actor) return;
  const parsed = CreateQuotationBody.safeParse(req.body);
  if (!parsed.success) {
    inputError(req, res, parsed.error);
    return;
  }
  try {
    const values = await buildQuotationValues(parsed.data);
    const db = await getMongoDb();
    const counter = await getCounters(db).findOneAndUpdate(
      { _id: "quotation-sequence" },
      { $inc: { value: 1 }, $set: { updatedAt: new Date() } },
      { returnDocument: "after", upsert: true },
    );
    const sequenceNo = counter?.value ?? 499;
    const now = new Date();
    const document: QuotationDocument = {
      _id: randomUUID(),
      sequenceNo,
      quoteNo: quotationNumber(sequenceNo),
      clientId: values.clientId,
      customerName: values.customerName,
      customerPhone: values.customerPhone,
      customerAddress: values.customerAddress,
      customerGstin: values.customerGstin,
      projectName: parsed.data.projectName.trim(),
      quotationDate: parsed.data.quotationDate.toISOString().slice(0, 10),
      items: values.items,
      transportationCost: roundTo(parsed.data.transportationCost, 2),
      loadingUnloadingCost: roundTo(parsed.data.loadingUnloadingCost, 2),
      additionalChargeDescription: parsed.data.additionalChargeDescription.trim(),
      additionalChargeRate: parsed.data.additionalChargeRate,
      additionalChargeAreaSqFt: parsed.data.additionalChargeAreaSqFt,
      gstPercent: parsed.data.gstPercent,
      notes: parsed.data.notes?.trim() || null,
      totals: values.totals,
      status: "draft",
      sampleOnly: false,
      requiresRateApproval: values.items.some((item) => item.rateOverridden),
      approvalApproverId: null,
      approvalSubmittedAt: null,
      approvalLastReminderAt: null,
      approvalHistory: [],
      createdBy: actor.id,
      updatedBy: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await getQuotations(db).insertOne(document);
    res.status(201).json(CreateQuotationResponse.parse(quotationResponse(document)));
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 0;
    if (statusCode === 404) {
      res.status(404).json({ error: error instanceof Error ? error.message : "Not found." });
      return;
    }
    throw error;
  }
});

router.get("/quotations/:quotationId", async (req, res): Promise<void> => {
  const actor = await context(req, res);
  if (!actor) return;
  const parsed = GetQuotationParams.safeParse(req.params);
  if (!parsed.success) {
    inputError(req, res, parsed.error);
    return;
  }
  const quotation = await getQuotations(await getMongoDb()).findOne({
    _id: parsed.data.quotationId,
    archivedAt: null,
  });
  if (!quotation) {
    res.status(404).json({ error: "Quotation not found." });
    return;
  }
  res.json(GetQuotationResponse.parse(quotationResponse(quotation)));
});

router.patch("/quotations/:quotationId", async (req, res): Promise<void> => {
  const actor = await context(req, res, true);
  if (!actor) return;
  const parsedParams = UpdateQuotationParams.safeParse(req.params);
  const parsedBody = UpdateQuotationBody.safeParse(req.body);
  if (!parsedParams.success) {
    inputError(req, res, parsedParams.error);
    return;
  }
  if (!parsedBody.success) {
    inputError(req, res, parsedBody.error);
    return;
  }
  const collection = getQuotations(await getMongoDb());
  const existing = await collection.findOne({
    _id: parsedParams.data.quotationId,
    archivedAt: null,
  });
  if (!existing) {
    res.status(404).json({ error: "Quotation not found." });
    return;
  }
  try {
    const values = await buildQuotationValues(parsedBody.data, existing.items);
    const now = new Date();
    const updated = await collection.findOneAndUpdate(
      {
        _id: existing._id,
        archivedAt: null,
        status: { $in: ["draft", "rejected"] },
      },
      {
        $set: {
          ...values,
          status: "draft",
          requiresRateApproval: values.items.some((item) => item.rateOverridden),
          approvalApproverId: null,
          approvalSubmittedAt: null,
          approvalLastReminderAt: null,
          approvalHistory: existing.approvalHistory ?? [],
          projectName: parsedBody.data.projectName.trim(),
          quotationDate: parsedBody.data.quotationDate.toISOString().slice(0, 10),
          transportationCost: roundTo(parsedBody.data.transportationCost, 2),
          loadingUnloadingCost: roundTo(parsedBody.data.loadingUnloadingCost, 2),
          additionalChargeDescription: parsedBody.data.additionalChargeDescription.trim(),
          additionalChargeRate: parsedBody.data.additionalChargeRate,
          additionalChargeAreaSqFt: parsedBody.data.additionalChargeAreaSqFt,
          gstPercent: parsedBody.data.gstPercent,
          notes: parsedBody.data.notes?.trim() || null,
          updatedBy: actor.id,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      res.status(409).json({ error: "Only draft or rejected quotations can be edited." });
      return;
    }
    res.json(UpdateQuotationResponse.parse(quotationResponse(updated)));
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 0;
    if (statusCode === 404) {
      res.status(404).json({ error: error instanceof Error ? error.message : "Not found." });
      return;
    }
    throw error;
  }
});

router.delete("/quotations/:quotationId", async (req, res): Promise<void> => {
  const actor = await context(req, res, true);
  if (!actor) return;
  const parsed = ArchiveQuotationParams.safeParse(req.params);
  if (!parsed.success) {
    inputError(req, res, parsed.error);
    return;
  }
  const result = await getQuotations(await getMongoDb()).updateOne(
    { _id: parsed.data.quotationId, archivedAt: null, status: "draft" },
    { $set: { archivedAt: new Date(), updatedAt: new Date(), updatedBy: actor.id } },
  );
  if (!result.matchedCount) {
    res.status(404).json({ error: "Draft quotation not found." });
    return;
  }
  res.status(204).end();
});

export default router;