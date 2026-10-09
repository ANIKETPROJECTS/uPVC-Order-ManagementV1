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

export function formatLotId(orderId: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Lot sequence must be a positive integer.");
  }
  return `${orderId}-L${sequence}`;
}

export function formatLegacyLotId(orderId: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Lot sequence must be a positive integer.");
  }
  return `${orderId}-L${String(sequence).padStart(2, "0")}`;
}

export function formatDispatchCode(
  orderId: string,
  lotSequence: number,
  dispatchNo: number,
): string {
  if (!Number.isInteger(lotSequence) || lotSequence < 1) {
    throw new Error("Lot sequence must be a positive integer.");
  }
  if (!Number.isInteger(dispatchNo) || dispatchNo < 1) {
    throw new Error("Dispatch number must be a positive integer.");
  }
  return `${orderId}-L${lotSequence}-D${dispatchNo}`;
}

export function normalizeLotCodeAlias(value: string): string {
  return value.replace(/(^|-)L0*(\d+)(?=-|$)/gi, (_match, prefix: string, digits: string) => {
    const sequence = Number.parseInt(digits, 10);
    return Number.isSafeInteger(sequence) && sequence > 0
      ? `${prefix}L${sequence}`
      : `${prefix}L${digits}`;
  });
}