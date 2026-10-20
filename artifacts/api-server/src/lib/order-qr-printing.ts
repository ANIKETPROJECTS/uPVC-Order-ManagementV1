import { randomUUID } from "node:crypto";
import { formatProjectPieceId } from "./order-identifiers";
import type {
  OrderDocument,
  OrderWindowDocument,
  OrderWindowPieceDocument,
  QrStickerSettingsDocument,
} from "./mongo";

export const QR_STICKER_SETTINGS_ID = "qrStickerSettings" as const;

export const DEFAULT_QR_STICKER_SETTINGS: Omit<
  QrStickerSettingsDocument,
  "_id" | "updatedBy" | "updatedAt"
> = {
  widthMm: 60,
  heightMm: 40,
  orientation: "landscape",
  marginMm: 2,
  qrSizeMm: 24,
  fontSizeLine1Pt: 7,
  fontSizeLine2Pt: 8,
  nameMaxLines: 2,
};

export function createWindowPieces(
  window: Pick<OrderWindowDocument, "_id" | "frameCount" | "frameStatus" | "glassShutterCount" | "glassShutterReadyCount" | "glassStatus" | "meshShutterCount" | "meshShutterReadyCount">,
  legacy = false,
): OrderWindowPieceDocument[] {
  const make = (
    kind: OrderWindowPieceDocument["kind"],
    count: number,
    readyCount: number,
  ) =>
    Array.from({ length: Math.max(0, count) }, (_, index) => ({
      id: `${window._id}_${kind}_${index + 1}`,
      kind,
      pieceNo: index + 1,
      status: index < readyCount ? "ready" as const : "pending" as const,
      qrPrint: legacy
        ? { status: "printed" as const, printCount: 0, firstPrintedAt: null, lastPrintedAt: null, lastPrintedBy: null }
        : { status: "pending" as const, printCount: 0, firstPrintedAt: null, lastPrintedAt: null, lastPrintedBy: null },
    }));

  return [
    ...make("frame", window.frameCount ?? 1, window.frameStatus === "ready" ? window.frameCount ?? 1 : 0),
    ...make(
      "glass_shutter",
      window.glassShutterCount ?? 0,
      window.glassShutterReadyCount ?? (window.glassStatus === "received" ? window.glassShutterCount ?? 0 : 0),
    ),
    ...make("mesh_shutter", window.meshShutterCount ?? 0, window.meshShutterReadyCount ?? 0),
  ];
}

export function pieceDisplayId(
  order: Pick<OrderDocument, "orderId" | "clientType">,
  window: Pick<OrderWindowDocument, "lotId" | "windowNo">,
  piece: Pick<OrderWindowPieceDocument, "kind" | "pieceNo">,
): string {
  if (order.clientType === "Project" && window.lotId) {
    const id = formatProjectPieceId(window.lotId, window.windowNo, piece.kind, piece.pieceNo);
    return piece.kind === "frame" && piece.pieceNo === 1 ? `${id}1` : id;
  }
  const normalized = window.windowNo.trim().match(/^W?0*(\d+)$/i);
  const windowPart = normalized
    ? `W${Number(normalized[1])}`
    : `W${window.windowNo.trim().replace(/^W/i, "").replace(/[^a-zA-Z0-9-]/g, "")}`;
  const prefix = piece.kind === "frame" ? "F" : piece.kind === "glass_shutter" ? "GS" : "MS";
  return `${order.orderId}-${windowPart}-${prefix}${piece.pieceNo}`;
}

export function pieceQrPayload(orderId: string, windowId: string, pieceId: string): string {
  return `FRAMEWISE_PIECE:${orderId}:${windowId}:${pieceId}`;
}

export function isPiecePrinted(piece: Pick<OrderWindowPieceDocument, "qrPrint">): boolean {
  // No print state means the label predates tracking and is assumed printed.
  return !piece.qrPrint || piece.qrPrint.status === "printed";
}

export function validateQrStickerSettings(value: unknown): Omit<
  QrStickerSettingsDocument,
  "_id" | "updatedBy" | "updatedAt"
> | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const keys = ["widthMm", "heightMm", "marginMm", "qrSizeMm", "fontSizeLine1Pt", "fontSizeLine2Pt", "nameMaxLines"];
  if (keys.some((key) => typeof input[key] !== "number" || !Number.isFinite(input[key]))) return null;
  if (
    (input.widthMm as number) < 20 || (input.widthMm as number) > 150 ||
    (input.heightMm as number) < 15 || (input.heightMm as number) > 150 ||
    (input.marginMm as number) < 0 || (input.marginMm as number) > 20 ||
    (input.qrSizeMm as number) < 10 || (input.qrSizeMm as number) > 100 ||
    (input.qrSizeMm as number) + (input.marginMm as number) * 2 > Math.min(input.widthMm as number, input.heightMm as number) ||
    (input.fontSizeLine1Pt as number) < 4 || (input.fontSizeLine1Pt as number) > 24 ||
    (input.fontSizeLine2Pt as number) < 4 || (input.fontSizeLine2Pt as number) > 24 ||
    !Number.isInteger(input.nameMaxLines) || (input.nameMaxLines as number) < 1 || (input.nameMaxLines as number) > 5 ||
    !["portrait", "landscape"].includes(String(input.orientation))
  ) return null;
  return {
    widthMm: input.widthMm as number,
    heightMm: input.heightMm as number,
    orientation: input.orientation as "portrait" | "landscape",
    marginMm: input.marginMm as number,
    qrSizeMm: input.qrSizeMm as number,
    fontSizeLine1Pt: input.fontSizeLine1Pt as number,
    fontSizeLine2Pt: input.fontSizeLine2Pt as number,
    nameMaxLines: input.nameMaxLines as number,
  };
}

export type PieceCountUpdate = Pick<
  OrderWindowDocument,
  "frameCount" | "glassShutterCount" | "meshShutterCount"
>;

export function reconcileWindowPieceCounts(
  window: OrderWindowDocument,
  counts: PieceCountUpdate,
): { pieces: OrderWindowPieceDocument[]; printedRemoved: number; error: string | null } {
  const pieces = (window.pieces ?? createWindowPieces(window, true)).map((piece) => ({ ...piece, qrPrint: piece.qrPrint ? { ...piece.qrPrint } : undefined }));
  let printedRemoved = 0;
  const targets = [
    ["frame", counts.frameCount],
    ["glass_shutter", counts.glassShutterCount],
    ["mesh_shutter", counts.meshShutterCount],
  ] as const;
  for (const [kind, desiredCount] of targets) {
    if (desiredCount == null) continue;
    const current = pieces.filter((piece) => piece.kind === kind).length;
    if (desiredCount > current) {
      const maxPieceNo = pieces.filter((piece) => piece.kind === kind).reduce((max, piece) => Math.max(max, piece.pieceNo), 0);
      for (let pieceNo = maxPieceNo + 1; pieceNo <= maxPieceNo + desiredCount - current; pieceNo++) {
        pieces.push({
          id: randomUUID(),
          kind,
          pieceNo,
          status: "pending",
          qrPrint: { status: "pending", printCount: 0, firstPrintedAt: null, lastPrintedAt: null, lastPrintedBy: null },
        });
      }
    } else if (desiredCount < current) {
      const removeCount = current - desiredCount;
      const remove = pieces
        .filter((piece) => piece.kind === kind)
        .sort((left, right) => right.pieceNo - left.pieceNo)
        .slice(0, removeCount);
      if (remove.some((piece) => piece.status === "ready")) {
        return { pieces, printedRemoved, error: `Cannot reduce ${kind.replaceAll("_", " ")} count: a piece being removed is already ready.` };
      }
      printedRemoved += remove.filter(isPiecePrinted).length;
      const removeIds = new Set(remove.map((piece) => piece.id));
      for (let index = pieces.length - 1; index >= 0; index--) {
        if (removeIds.has(pieces[index].id)) pieces.splice(index, 1);
      }
    }
  }
  return { pieces, printedRemoved, error: null };
}
