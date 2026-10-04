const indianCurrencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const indianCurrencyWithPaiseFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const istDateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h12',
});

const istDateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatInr(value: number | null | undefined, fallback = '—'): string {
  if (value == null) return fallback;
  return Number.isInteger(value)
    ? indianCurrencyFormatter.format(value)
    : indianCurrencyWithPaiseFormatter.format(value);
}

export function formatIstDateTime(value: string | Date): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '—';
  const parts = Object.fromEntries(istDateTimeFormatter.formatToParts(date).map(({ type, value: part }) => [type, part]));
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod.toLowerCase()}`;
}

export function formatIstDate(value: string | Date): string {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00.000Z`)
    : toDate(value);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '—';
  return istDateFormatter.format(date);
}

export function getIstDateKey(value: string | Date): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}