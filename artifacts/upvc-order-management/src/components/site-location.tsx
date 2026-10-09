import { ExternalLink, MapPin } from 'lucide-react';

export function openStreetMapLocationUrl(
  address: string,
  latitude?: number | null,
  longitude?: number | null,
) {
  if (latitude != null && longitude != null) {
    return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
  }
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address.trim())}`;
}

export function SiteLocation({
  address,
  latitude,
  longitude,
  showMap = false,
  compact = false,
  className = '',
  testId = 'site-location',
}: {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  showMap?: boolean;
  compact?: boolean;
  className?: string;
  testId?: string;
}) {
  const value = address?.trim() || '';
  const hasPin = latitude != null && longitude != null;
  const mapBounds = hasPin
    ? `${longitude - 0.01},${latitude - 0.01},${longitude + 0.01},${latitude + 0.01}`
    : '';
  const mapSrc = hasPin
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(mapBounds)}&layer=mapnik&marker=${latitude},${longitude}`
    : null;

  return (
    <div className={className} data-testid={testId}>
      {value || hasPin ? (
        <>
          <p className={`whitespace-pre-line break-words ${compact ? 'text-[10px] leading-4' : 'text-sm leading-6'}`} data-testid={`${testId}-address`}>
            {value || 'Pinned site location'}
          </p>
          {hasPin && <p className="mt-1 font-mono text-[9px] text-muted-foreground" data-testid={`${testId}-coordinates`}>{latitude.toFixed(6)}, {longitude.toFixed(6)}</p>}
          <a
            href={openStreetMapLocationUrl(value, latitude, longitude)}
            target="_blank"
            rel="noreferrer"
            className={`mt-1 inline-flex items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline ${compact ? 'text-[10px]' : 'text-xs'}`}
            data-testid={`${testId}-map-link`}
          >
            <MapPin size={compact ? 11 : 13} />
            Open in OpenStreetMap
            <ExternalLink size={compact ? 10 : 12} />
          </a>
          {showMap && hasPin && mapSrc && (
            <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/30" data-testid={`${testId}-map-preview`}>
              <iframe
                title={`OpenStreetMap site pin: ${latitude}, ${longitude}`}
                src={mapSrc}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="h-64 w-full border-0"
              />
            </div>
          )}
        </>
      ) : (
        <p className={`text-muted-foreground ${compact ? 'text-[10px]' : 'text-sm'}`} data-testid={`${testId}-missing`}>
          Site address not recorded
        </p>
      )}
    </div>
  );
}
