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