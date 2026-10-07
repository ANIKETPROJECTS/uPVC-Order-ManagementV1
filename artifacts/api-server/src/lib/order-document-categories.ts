import type { OrderDocumentCategoryDocument } from "./mongo";

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
