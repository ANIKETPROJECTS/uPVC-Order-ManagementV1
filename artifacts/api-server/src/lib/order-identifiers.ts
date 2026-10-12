const ORDER_TIME_ZONE = "Asia/Kolkata";
const orderDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ORDER_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function orderDateKey(date: Date): string {
  const parts = orderDateFormatter.formatToParts(date);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const year = parts.find((part) => part.type === "year")?.value;

  if (!day || !month || !year) {
    throw new Error("The order creation date could not be formatted.");
  }

  return `${day}${month}${year}`;
}

export function normalizeLocationCode(locationCode: string): string {
  return locationCode.trim().toUpperCase();
}

export function orderDailyCounterId(dateKey: string, locationCode: string): string {
  return `orderDailySequence:${dateKey}:${normalizeLocationCode(locationCode)}`;
}

export function formatOrderId(
  dateKey: string,
  locationCode: string,
  dailySequenceNo: number,
): string {
  return `${dateKey}${normalizeLocationCode(locationCode)}${dailySequenceNo}`;
}

export function formatQuotationOrderId(
  clientType: "Project" | "Retail",
  quoteNo: string,
): string | null {
  const match = /^QT-(\d+)$/i.exec(quoteNo.trim());
  if (!match) return null;
  const number = match[1].replace(/^0+/, "") || "0";
  return `${clientType === "Project" ? "P" : "R"}${number}`;
}

export function formatProjectOrderId(createdAt: Date, sequenceNo: number): string {
  if (!Number.isInteger(sequenceNo) || sequenceNo < 1) {
    throw new Error("Project sequence must be a positive integer.");
  }
  const year = orderDateKey(createdAt).slice(-2);
  return `P-${year}-${String(sequenceNo).padStart(4, "0")}`;
}

export function formatLotId(orderId: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Lot sequence must be a positive integer.");
  }
  return `${orderId}-L${sequence}`;
}

export function formatProjectPieceId(
  lotId: string,
  windowNo: string,
  kind: "frame" | "glass_shutter" | "mesh_shutter",
  pieceNo: number,
): string {
  const normalizedWindow = windowNo.trim().match(/^W?0*(\d+)$/i);
  const windowSuffix = normalizedWindow
    ? `W${Number(normalizedWindow[1])}`
    : `W${windowNo.trim().replace(/^W/i, "").replace(/[^a-zA-Z0-9-]/g, "")}`;
  const pieceSuffix =
    kind === "frame" ? (pieceNo === 1 ? "F" : `F${pieceNo}`) :
    kind === "glass_shutter" ? `G${pieceNo}` : `M${pieceNo}`;
  return `${lotId}-${windowSuffix}-${pieceSuffix}`;
}