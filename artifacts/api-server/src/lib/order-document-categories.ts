import type { Db } from "mongodb";
import {
  getOrderDocumentCategories,
  type OrderDocumentCategoryDocument,
} from "./mongo";

const DEFAULT_CATEGORIES = [
  { id: "quotation", label: "Quotation", requiredModule: "quotation-builder" },
  { id: "purchase_order", label: "Purchase order", requiredModule: "confirmation" },
  { id: "confirmation", label: "Confirmation", requiredModule: "confirmation" },
  { id: "drawing", label: "Elevation", requiredModule: "measurements" },
  { id: "invoice", label: "Invoice", requiredModule: "payments" },
  { id: "other", label: "Other", requiredModule: "order-hub" },
] as const;

type MigrationRecord = { _id: string; appliedAt: Date };

export function normalizeDocumentCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function orderDocumentCategoryResponse(category: OrderDocumentCategoryDocument) {
  return {
    id: category._id,
    label: category.label,
    requiredModule: category.requiredModule,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

export async function ensureDefaultOrderDocumentCategories(db: Db): Promise<void> {
  const migrations = db.collection<MigrationRecord>("workspace_migrations");
  const claim = await migrations.updateOne(
    { _id: "order-document-categories-v1" },
    { $setOnInsert: { appliedAt: new Date() } },
    { upsert: true },
  );

  if (!claim.upsertedCount) return;

  try {
    const now = new Date();
    await getOrderDocumentCategories(db).insertMany(
      DEFAULT_CATEGORIES.map((category) => ({
        _id: category.id,
        label: category.label,
        labelNormalized: category.label.toLowerCase(),
        requiredModule: category.requiredModule,
        createdAt: now,
        updatedAt: now,
      })),
      { ordered: true },
    );
  } catch (error) {
    await migrations.deleteOne({ _id: "order-document-categories-v1" });
    throw error;
  }
}