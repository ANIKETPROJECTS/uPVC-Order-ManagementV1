export function getOrderStatusUrl(orderRecordId: string): string {
  const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const path = `${basePath}/order-status/${encodeURIComponent(orderRecordId)}`;
  return new URL(path, window.location.origin).toString();
}

export function getOrderRecordIdFromQr(value: string): string | null {
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;

    const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '');
    const routePath =
      basePath && url.pathname.startsWith(`${basePath}/`)
        ? url.pathname.slice(basePath.length)
        : url.pathname;
    const match = routePath.match(/^\/order-status\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}