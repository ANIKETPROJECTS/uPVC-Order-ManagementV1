import { useEffect, useRef, useState, type FormEvent } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './site-map-picker.css';
import { LoaderCircle, MapPin, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type SiteCoordinates = {
  latitude: number;
  longitude: number;
  address?: string;
};

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
};

let lastAddressSearchAt = 0;

export function SiteMapPicker({
  address,
  latitude,
  longitude,
  onSelect,
  onClear,
  testId = 'site-map-picker',
}: {
  address: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  onSelect: (coordinates: SiteCoordinates) => void;
  onClear: () => void;
  testId?: string;
}) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const onSelectRef = useRef(onSelect);
  const initialCoordinatesRef = useRef({ latitude, longitude });
  const [searchText, setSearchText] = useState(address);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    setSearchText(address);
  }, [address]);

  useEffect(() => {
    const element = mapElementRef.current;
    if (!element || mapRef.current) return;

    const { latitude: initialLatitude, longitude: initialLongitude } = initialCoordinatesRef.current;
    const hasInitialPin = initialLatitude != null && initialLongitude != null;
    const map = L.map(element, { scrollWheelZoom: true }).setView(
      hasInitialPin ? [initialLatitude, initialLongitude] : [20.5937, 78.9629],
      hasInitialPin ? 16 : 5,
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
    }).addTo(map);
    map.on('click', (event: L.LeafletMouseEvent) => {
      onSelectRef.current({
        latitude: Number(event.latlng.lat.toFixed(6)),
        longitude: Number(event.latlng.lng.toFixed(6)),
      });
    });
    mapRef.current = map;
    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (latitude == null || longitude == null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const point: L.LatLngExpression = [latitude, longitude];
    if (markerRef.current) {
      markerRef.current.setLatLng(point);
    } else {
      markerRef.current = L.circleMarker(point, {
        radius: 9,
        color: '#ffffff',
        weight: 3,
        fillColor: '#168a76',
        fillOpacity: 1,
      }).addTo(map);
    }
  }, [latitude, longitude]);

  const searchAddress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) {
      setSearchError('Enter an address or place name to search.');
      return;
    }
    setSearching(true);
    setSearchError('');
    try {
      const waitMs = Math.max(0, 1100 - (Date.now() - lastAddressSearchAt));
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      lastAddressSearchAt = Date.now();
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '1');
      url.searchParams.set('countrycodes', 'in');
      url.searchParams.set('q', query);
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'Accept-Language': 'en-IN,en;q=0.9' },
      });
      if (!response.ok) throw new Error('search failed');
      const results = await response.json() as NominatimResult[];
      const result = results[0];
      if (!result) {
        setSearchError('No matching place was found. Try a fuller address or click the map to place the pin.');
        return;
      }
      const selected: SiteCoordinates = {
        latitude: Number(Number(result.lat).toFixed(6)),
        longitude: Number(Number(result.lon).toFixed(6)),
        address: result.display_name.slice(0, 500),
      };
      onSelect(selected);
      mapRef.current?.setView([selected.latitude, selected.longitude], 16);
    } catch {
      setSearchError('Address search is unavailable right now. You can still pan the map and place the pin manually.');
    } finally {
      setSearching(false);
    }
  };

  const hasPin = latitude != null && longitude != null;

  return (
    <section className="order-map-picker isolate rounded-xl border border-border/70 bg-muted/15 p-3" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold"><MapPin size={14} className="text-primary" />Pin the exact site <span className="font-normal text-muted-foreground">(optional)</span></p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Search for a place, or pan and zoom the map, then click to drop or move the pin.</p>
        </div>
        {hasPin && <Button type="button" size="sm" variant="ghost" className="h-8 text-[10px] text-muted-foreground" onClick={onClear} data-testid={`${testId}-clear`}><Trash2 size={12} />Clear pin</Button>}
      </div>

      <form className="mt-3 flex gap-2" onSubmit={searchAddress}>
        <Input
          value={searchText}
          onChange={(event) => { setSearchText(event.target.value); setSearchError(''); }}
          placeholder="Search a street, building, or place in India"
          aria-label="Search for a map location"
          className="h-9 text-xs"
          data-testid={`${testId}-search`}
        />
        <Button type="submit" variant="outline" size="sm" className="h-9 shrink-0" disabled={searching} data-testid={`${testId}-search-submit`}>
          {searching ? <LoaderCircle size={14} className="animate-spin" /> : <Search size={14} />}
          <span className="sr-only">Search map</span>
        </Button>
      </form>
      {searchError && <p className="mt-2 text-[10px] leading-4 text-destructive" role="status" data-testid={`${testId}-search-error`}>{searchError}</p>}

      <div className="mt-3 h-64 overflow-hidden rounded-lg border border-border/70 bg-muted/30 sm:h-72" data-testid={`${testId}-map`}>
        <div ref={mapElementRef} className="h-full w-full" />
      </div>
      {hasPin ? (
        <p className="mt-2 font-mono text-[10px] text-muted-foreground" data-testid={`${testId}-coordinates`}>
          Pin: {latitude.toFixed(6)}, {longitude.toFixed(6)}
        </p>
      ) : (
        <p className="mt-2 text-[10px] text-muted-foreground" data-testid={`${testId}-no-pin`}>No pin selected. The text address will still be saved.</p>
      )}
      <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
        Map data &copy; OpenStreetMap contributors. Place search uses the public Nominatim service.
      </p>
    </section>
  );
}
