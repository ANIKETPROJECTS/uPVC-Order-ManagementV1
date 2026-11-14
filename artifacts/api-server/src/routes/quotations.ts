import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  getOrders,
  getQuotationRateSubmissions,
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
  resolveProjectUploadPath,
  storeImageDataUrl,
  storeProjectUpload,
} from "../lib/project-upload-storage";

const router: IRouter = Router();
const SQ_FT_PER_SQUARE_MM = 92903.04;
const MAX_WINDOW_PROFILE_IMAGE_BYTES = 1_000_000;
const MAX_QUOTATION_DOCUMENT_BYTES = 10 * 1024 * 1024;

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
  const documentVersions = quotation.uploadedDocumentVersions?.length
    ? quotation.uploadedDocumentVersions
    : quotation.uploadedDocument
      ? [{ ...quotation.uploadedDocument, versionNumber: 1, uploadedBy: quotation.createdBy }]
      : [];
  return {
    id: quotation._id,
    quoteNo: quotation.quoteNo,
    uploadedDocument: quotation.uploadedDocument ? {
      filename: quotation.uploadedDocument.filename,
      sizeBytes: quotation.uploadedDocument.sizeBytes,
      uploadedAt: quotation.uploadedDocument.uploadedAt.toISOString(),
      downloadUrl: `/api/quotations/${encodeURIComponent(quotation._id)}/document`,
    } : null,
    uploadedDocumentVersions: documentVersions.map((version) => ({
      versionNumber: version.versionNumber,
      filename: version.filename,
      sizeBytes: version.sizeBytes,
      uploadedAt: version.uploadedAt.toISOString(),
      uploadedBy: version.uploadedBy,
      downloadUrl: `/api/quotations/${encodeURIComponent(quotation._id)}/document/versions/${version.versionNumber}`,
    })),
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
    outcomeStatus: quotation.outcomeStatus ?? null,
    lostReason: quotation.lostReason ?? null,
    outcomeSource: quotation.outcomeSource ?? null,
    confirmationRecordIds: quotation.confirmationRecordIds ?? [],
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

function quotationYearCode(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "2-digit",
  }).format(date);
}

function quotationNumber(year: string, sequenceNo: number): string {
  return `QT-${year}-${String(sequenceNo).padStart(4, "0")}`;
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

router.post("/quotations/upload/:filename", async (req, res, next): Promise<void> => {
  const actor = await context(req, res, true);
  if (!actor) return;
  const filename = req.params.filename.replace(/[\r\n"]/g, "").trim().slice(0, 200);
  const declaredType = String(req.headers["content-type"] ?? "").split(";")[0];
  const declaredLength = Number(req.headers["content-length"]);
  if (!filename.toLowerCase().endsWith(".pdf") || (declaredType !== "application/pdf" && declaredType !== "application/octet-stream")) {
    res.status(400).json({ error: "Upload a PDF quotation document." });
    return;
  }
  if (Number.isFinite(declaredLength) && declaredLength > MAX_QUOTATION_DOCUMENT_BYTES) {
    res.status(413).json({ error: "The quotation PDF must be 10 MiB or smaller." });
    req.resume();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  req.on("data", (chunk: Buffer) => {
    if (tooLarge) return;
    size += chunk.length;
    if (size > MAX_QUOTATION_DOCUMENT_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      if (!res.headersSent) res.status(413).json({ error: "The quotation PDF must be 10 MiB or smaller." });
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (tooLarge) return;
    void (async () => {
      const body = Buffer.concat(chunks, size);
      if (body.length < 5 || body.subarray(0, 5).toString("ascii") !== "%PDF-") {
        res.status(400).json({ error: "The uploaded file is not a valid PDF." });
        return;
      }
      const db = await getMongoDb();
      const now = new Date();
      const year = quotationYearCode(now);
      const counter = await getCounters(db).findOneAndUpdate(
        { _id: `quotation-year-sequence:${year}` },
        { $inc: { value: 1 }, $set: { updatedAt: now } },
        { returnDocument: "after", upsert: true },
      );
      if (!counter || !Number.isSafeInteger(counter.value) || counter.value < 1) {
        res.status(503).json({ error: "A quotation ID could not be allocated." });
        return;
      }
      const storagePath = await storeProjectUpload("quotation-documents", filename, body);
      const quoteNo = quotationNumber(year, counter.value);
      const document: QuotationDocument = {
        _id: randomUUID(),
        sequenceNo: counter.value,
        quoteNo,
        clientId: null,
        customerName: filename.replace(/\.pdf$/i, "").slice(0, 160) || "Uploaded quotation",
        customerPhone: "",
        customerAddress: "",
        customerGstin: null,
        projectName: "",
        quotationDate: now.toISOString().slice(0, 10),
        items: [],
        transportationCost: 0,
        loadingUnloadingCost: 0,
        additionalChargeDescription: "",
        additionalChargeRate: 0,
        additionalChargeAreaSqFt: 0,
        gstPercent: 0,
        notes: "Uploaded quotation document",
        totals: {
          componentCount: 0, totalAreaSqFt: 0, basicValue: 0, transportationCost: 0,
          loadingUnloadingCost: 0, additionalCharge: 0, subtotal: 0, gstPercent: 0,
          gstAmount: 0, grandTotal: 0, averagePricePerSqFt: 0,
        },
        status: "draft",
        sampleOnly: false,
        requiresRateApproval: false,
        approvalApproverId: null,
        approvalSubmittedAt: null,
        approvalLastReminderAt: null,
        approvalHistory: [],
        uploadedDocument: { filename, sizeBytes: body.length, storagePath, uploadedAt: now },
        uploadedDocumentVersions: [{
          versionNumber: 1,
          filename,
          sizeBytes: body.length,
          storagePath,
          uploadedAt: now,
          uploadedBy: actor.id,
        }],
        uploadedDocumentVersionSequence: 1,
        createdBy: actor.id,
        updatedBy: actor.id,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await getQuotations(db).insertOne(document);
        res.status(201).json(quotationResponse(document));
      } catch (error) {
        await removeProjectUpload(storagePath).catch(() => undefined);
        throw error;
      }
    })().catch(next);
  });
  req.on("aborted", () => next(new Error("Quotation upload was interrupted.")));
  req.on("error", next);
});

router.get("/quotations/:quotationId/document", async (req, res): Promise<void> => {
  const actor = await context(req, res);
  if (!actor) return;
  const quotation = await getQuotations(await getMongoDb()).findOne({
    _id: req.params.quotationId,
    archivedAt: null,
  });
  if (!quotation?.uploadedDocument) {
    res.status(404).json({ error: "Uploaded quotation document not found." });
    return;
  }
  const filePath = resolveProjectUploadPath(quotation.uploadedDocument.storagePath);
  if (!filePath) {
    res.status(404).json({ error: "Quotation document is unavailable." });
    return;
  }
  try {
    res.type("application/pdf").setHeader("Content-Disposition", `inline; filename="${quotation.uploadedDocument.filename.replace(/[\r\n"\\]/g, "")}"`);
    res.send(await readFile(filePath));
  } catch {
    res.status(404).json({ error: "Quotation document is unavailable." });
  }
});

router.post("/quotations/:quotationId/document/:filename", async (req, res, next): Promise<void> => {
  const actor = await context(req, res, true);
  if (!actor) return;
  const filename = req.params.filename.replace(/[\r\n"]/g, "").trim().slice(0, 200);
  const declaredType = String(req.headers["content-type"] ?? "").split(";")[0];
  const declaredLength = Number(req.headers["content-length"]);
  if (!filename.toLowerCase().endsWith(".pdf") || (declaredType !== "application/pdf" && declaredType !== "application/octet-stream")) {
    res.status(400).json({ error: "Upload a PDF quotation document." });
    return;
  }
  if (Number.isFinite(declaredLength) && declaredLength > MAX_QUOTATION_DOCUMENT_BYTES) {
    res.status(413).json({ error: "The quotation PDF must be 10 MiB or smaller." });
    req.resume();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  req.on("data", (chunk: Buffer) => {
    if (tooLarge) return;
    size += chunk.length;
    if (size > MAX_QUOTATION_DOCUMENT_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      if (!res.headersSent) res.status(413).json({ error: "The quotation PDF must be 10 MiB or smaller." });
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (tooLarge) return;
    void (async () => {
      const body = Buffer.concat(chunks, size);
      if (body.length < 5 || body.subarray(0, 5).toString("ascii") !== "%PDF-") {
        res.status(400).json({ error: "The uploaded file is not a valid PDF." });
        return;
      }
      const quotations = getQuotations(await getMongoDb());
      const existing = await quotations.findOne({ _id: req.params.quotationId, archivedAt: null });
      if (!existing) {
        res.status(404).json({ error: "Quotation not found." });
        return;
      }
      const now = new Date();
      const storagePath = await storeProjectUpload("quotation-documents", filename, body);
      const currentVersions = existing.uploadedDocumentVersions?.length
        ? existing.uploadedDocumentVersions
        : existing.uploadedDocument
          ? [{ ...existing.uploadedDocument, versionNumber: 1, uploadedBy: existing.createdBy }]
          : [];
      const version = {
        versionNumber: Math.max(
          existing.uploadedDocumentVersionSequence ?? 0,
          currentVersions.reduce((max, item) => Math.max(max, item.versionNumber), 0),
        ) + 1,
        filename,
        sizeBytes: body.length,
        storagePath,
        uploadedAt: now,
        uploadedBy: actor.id,
      };
      let updated: QuotationDocument | null;
      try {
        updated = await quotations.findOneAndUpdate(
          { _id: existing._id, updatedAt: existing.updatedAt, archivedAt: null },
          {
            $set: {
              uploadedDocument: { filename, sizeBytes: body.length, storagePath, uploadedAt: now },
              uploadedDocumentVersions: [...currentVersions, version],
              uploadedDocumentVersionSequence: version.versionNumber,
              updatedAt: now,
              updatedBy: actor.id,
            },
          },
          { returnDocument: "after" },
        );
      } catch (error) {
        await removeProjectUpload(storagePath).catch(() => undefined);
        throw error;
      }
      if (!updated) {
        await removeProjectUpload(storagePath).catch(() => undefined);
        res.status(409).json({ error: "The quotation changed during upload. Refresh and try again." });
        return;
      }
      res.json(quotationResponse(updated));
    })().catch(next);
  });
  req.on("aborted", () => next(new Error("Quotation upload was interrupted.")));
  req.on("error", next);
});

router.get("/quotations/:quotationId/document/versions/:versionNumber", async (req, res): Promise<void> => {
  const actor = await context(req, res);
  if (!actor) return;
  const versionNumber = Number(req.params.versionNumber);
  const quotation = await getQuotations(await getMongoDb()).findOne({ _id: req.params.quotationId, archivedAt: null });
  const versions = quotation?.uploadedDocumentVersions?.length
    ? quotation.uploadedDocumentVersions
    : quotation?.uploadedDocument
      ? [{ ...quotation.uploadedDocument, versionNumber: 1, uploadedBy: quotation.createdBy }]
      : [];
  const version = versions.find((entry) => entry.versionNumber === versionNumber);
  const filePath = version ? resolveProjectUploadPath(version.storagePath) : null;
  if (!version || !filePath) {
    res.status(404).json({ error: "Quotation version not found." });
    return;
  }
  try {
    res.type("application/pdf").setHeader("Content-Disposition", `inline; filename="${version.filename.replace(/[\r\n"\\]/g, "")}"`);
    res.send(await readFile(filePath));
  } catch {
    res.status(404).json({ error: "Quotation version is unavailable." });
  }
});

router.delete("/quotations/:quotationId/document/versions/:versionNumber", async (req, res): Promise<void> => {
  const actor = await context(req, res, true);
  if (!actor) return;
  const versionNumber = Number(req.params.versionNumber);
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    res.status(400).json({ error: "Invalid quotation version number." });
    return;
  }
  const quotations = getQuotations(await getMongoDb());
  const existing = await quotations.findOne({ _id: req.params.quotationId, archivedAt: null });
  if (!existing) {
    res.status(404).json({ error: "Quotation not found." });
    return;
  }
  const versions = existing.uploadedDocumentVersions?.length
    ? existing.uploadedDocumentVersions
    : existing.uploadedDocument
      ? [{ ...existing.uploadedDocument, versionNumber: 1, uploadedBy: existing.createdBy }]
      : [];
  const removed = versions.find((entry) => entry.versionNumber === versionNumber);
  if (!removed) {
    res.status(404).json({ error: "Quotation version not found." });
    return;
  }
  const remaining = versions.filter((entry) => entry.versionNumber !== versionNumber);
  const latest = remaining.reduce<typeof remaining[number] | null>(
    (current, entry) => !current || entry.versionNumber > current.versionNumber ? entry : current,
    null,
  );
  const updated = await quotations.updateOne(
    { _id: existing._id, updatedAt: existing.updatedAt, archivedAt: null },
    {
      $set: {
        uploadedDocumentVersions: remaining,
        uploadedDocument: latest ? {
          filename: latest.filename,
          sizeBytes: latest.sizeBytes,
          storagePath: latest.storagePath,
          uploadedAt: latest.uploadedAt,
        } : null,
        updatedAt: new Date(),
        updatedBy: actor.id,
      },
    },
  );
  if (!updated.matchedCount) {
    res.status(409).json({ error: "The quotation changed. Refresh and try again." });
    return;
  }
  await removeProjectUpload(removed.storagePath).catch((error: unknown) =>
    req.log.error({ err: error, quotationId: existing._id }, "Failed to remove a deleted quotation version"),
  );
  res.status(204).end();
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
    const now = new Date();
    const year = quotationYearCode(now);
    const counter = await getCounters(db).findOneAndUpdate(
      { _id: `quotation-year-sequence:${year}` },
      { $inc: { value: 1 }, $set: { updatedAt: now } },
      { returnDocument: "after", upsert: true },
    );
    if (!counter || !Number.isSafeInteger(counter.value) || counter.value < 1) {
      throw new Error("The quotation ID sequence could not be allocated.");
    }
    const legacySequenceCounter = await getCounters(db).findOneAndUpdate(
      { _id: "quotation-sequence" },
      { $inc: { value: 1 }, $set: { updatedAt: new Date() } },
      { returnDocument: "after", upsert: true },
    );
    if (!legacySequenceCounter || !Number.isSafeInteger(legacySequenceCounter.value) || legacySequenceCounter.value < 1) {
      throw new Error("The quotation sequence counter could not be allocated.");
    }
    const sequenceNo = legacySequenceCounter.value;
    const document: QuotationDocument = {
      _id: randomUUID(),
      sequenceNo,
      quoteNo: quotationNumber(year, counter.value),
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
  const db = await getMongoDb();
  const quotations = getQuotations(db);
  const quotation = await quotations.findOne({
    _id: parsed.data.quotationId,
    archivedAt: null,
    status: "draft",
  });
  if (!quotation) {
    res.status(404).json({ error: "Draft quotation not found." });
    return;
  }
  const [linkedOrder, linkedRequest] = await Promise.all([
    getOrders(db).findOne({ quotationId: quotation._id }),
    getQuotationRateSubmissions(db).findOne({ quotationRecordId: quotation._id }),
  ]);
  if (linkedOrder || linkedRequest) {
    res.status(409).json({ error: "This quotation is linked to an order or rate request. Remove the PDF versions individually instead." });
    return;
  }
  const result = await quotations.updateOne(
    { _id: quotation._id, archivedAt: null, status: "draft", updatedAt: quotation.updatedAt },
    { $set: { archivedAt: new Date(), updatedAt: new Date(), updatedBy: actor.id } },
  );
  if (!result.matchedCount) {
    res.status(409).json({ error: "The quotation changed. Refresh and try again." });
    return;
  }
  const versions = quotation.uploadedDocumentVersions?.length
    ? quotation.uploadedDocumentVersions
    : quotation.uploadedDocument
      ? [{ ...quotation.uploadedDocument, versionNumber: 1, uploadedBy: quotation.createdBy }]
      : [];
  await Promise.all(versions.map((version) =>
    removeProjectUpload(version.storagePath).catch((error: unknown) =>
      req.log.error({ err: error, quotationId: quotation._id }, "Failed to remove an archived quotation PDF"),
    ),
  ));
  res.status(204).end();
});

export default router;