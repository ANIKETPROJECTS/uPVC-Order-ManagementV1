import { ExternalLink, MapPin } from 'lucide-react';

export function googleMapsSearchUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
}

export function SiteLocation({
  address,
  showMap = false,
  compact = false,
  className = '',
  testId = 'site-location',
}: {
  address?: string | null;
  showMap?: boolean;
  compact?: boolean;
  className?: string;
  testId?: string;
}) {
  const value = address?.trim() || '';

  return (
    <div className={className} data-testid={testId}>
      {value ? (
        <>
          <p className={`whitespace-pre-line break-words ${compact ? 'text-[10px] leading-4' : 'text-sm leading-6'}`} data-testid={`${testId}-address`}>
            {value}
          </p>
          <a
            href={googleMapsSearchUrl(value)}
            target="_blank"
            rel="noreferrer"
            className={`mt-1 inline-flex items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline ${compact ? 'text-[10px]' : 'text-xs'}`}
            data-testid={`${testId}-map-link`}
          >
            <MapPin size={compact ? 11 : 13} />
            Open in Google Maps
            <ExternalLink size={compact ? 10 : 12} />
          </a>
          {showMap && (
            <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/30" data-testid={`${testId}-map-preview`}>
              <iframe
                title={`Google Maps location: ${value}`}
                src={`https://maps.google.com/maps?q=${encodeURIComponent(value)}&output=embed`}
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
