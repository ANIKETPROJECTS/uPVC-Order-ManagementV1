export function getOrderStatusUrl(orderRecordId: string): string {
  const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const path = `${basePath}/order-status/${encodeURIComponent(orderRecordId)}`;
  return new URL(path, window.location.origin).toString();
}

export function getOrderRecordIdFromQr(value: string): string | null {
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    // QR links can outlive a domain or HTTPS migration. Match the app route,
    // not the original host or deployment prefix; navigation stays on this app.
    const segments = url.pathname.split('/').filter(Boolean);
    const statusIndex = segments.lastIndexOf('order-status');
    if (statusIndex < 0 || statusIndex !== segments.length - 2) return null;

    const recordId = decodeURIComponent(segments[statusIndex + 1]);
    return recordId && !recordId.includes('/') ? recordId : null;
  } catch {
    return null;
  }
}