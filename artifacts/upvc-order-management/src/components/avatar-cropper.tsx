import { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, ZoomIn } from 'lucide-react';

type Point = { x: number; y: number };
type Dimensions = { width: number; height: number };
type AvatarCropperProps = {
  file: File;
  onApply: (dataUrl: string) => void;
  onCancel: () => void;
};

const CROP_SIZE = 240;
const OUTPUT_SIZE = 256;
const MAX_DATA_URL_LENGTH = 180_000;

function getPanLimits(dimensions: Dimensions, zoom: number): Point {
  const scale = Math.max(CROP_SIZE / dimensions.width, CROP_SIZE / dimensions.height) * zoom;
  return {
    x: Math.max(0, (dimensions.width * scale - CROP_SIZE) / 2),
    y: Math.max(0, (dimensions.height * scale - CROP_SIZE) / 2),
  };
}

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value));
}

export function AvatarCropper({ file, onApply, onCancel }: AvatarCropperProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ pointerId: number; start: Point; origin: Point } | null>(null);
  const [source, setSource] = useState('');
  const [dimensions, setDimensions] = useState<Dimensions | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setSource(objectUrl);
    setDimensions(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError('');
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const scale = dimensions
    ? Math.max(CROP_SIZE / dimensions.width, CROP_SIZE / dimensions.height) * zoom
    : 0;
  const imageWidth = dimensions ? dimensions.width * scale : 0;
  const imageHeight = dimensions ? dimensions.height * scale : 0;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dimensions) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: offset,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !dimensions) return;
    const limits = getPanLimits(dimensions, zoom);
    setOffset({
      x: clamp(drag.origin.x + event.clientX - drag.start.x, limits.x),
      y: clamp(drag.origin.y + event.clientY - drag.start.y, limits.y),
    });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const changeZoom = (value: number) => {
    setZoom(value);
    if (dimensions) {
      const limits = getPanLimits(dimensions, value);
      setOffset((current) => ({
        x: clamp(current.x, limits.x),
        y: clamp(current.y, limits.y),
      }));
    }
  };

  const applyCrop = () => {
    const image = imageRef.current;
    if (!image || !dimensions || !scale) return;

    const side = CROP_SIZE / scale;
    const displayedLeft = (imageWidth - CROP_SIZE) / 2 - offset.x;
    const displayedTop = (imageHeight - CROP_SIZE) / 2 - offset.y;
    const sourceX = clamp(displayedLeft / scale, dimensions.width - side);
    const sourceY = clamp(displayedTop / scale, dimensions.height - side);
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext('2d');
    if (!context) {
      setError('This browser could not prepare the cropped image. Try another image.');
      return;
    }

    context.drawImage(image, sourceX, sourceY, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    let result = '';
    for (const quality of [0.84, 0.76, 0.68, 0.6, 0.52]) {
      result = canvas.toDataURL('image/jpeg', quality);
      if (result.length <= MAX_DATA_URL_LENGTH) break;
    }

    if (result.length > MAX_DATA_URL_LENGTH) {
      setError('This image is still too large. Choose another image and try again.');
      return;
    }

    setError('');
    onApply(result);
  };

  return (
    <div className="rounded-xl border border-border bg-background p-4" data-testid="avatar-cropper">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div
          className="relative shrink-0 touch-none select-none overflow-hidden rounded-full border-2 border-white bg-muted shadow-[0_0_0_1px_hsl(var(--border))] active:cursor-grabbing"
          style={{ width: CROP_SIZE, height: CROP_SIZE, touchAction: 'none', cursor: dimensions ? 'grab' : 'default' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-label="Circular profile photo crop selector. Drag the image to reposition it."
          data-testid="area-avatar-crop"
        >
          {source && (
            <img
              ref={imageRef}
              src={source}
              alt=""
              draggable={false}
              onLoad={(event) => setDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
              style={{
                width: imageWidth || 'auto',
                height: imageHeight || 'auto',
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          )}
          <div className="pointer-events-none absolute inset-0 rounded-full border border-white/70" />
        </div>

        <div className="w-full space-y-4 sm:pt-2">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold"><ImagePlus size={14} className="text-primary" /> Adjust your photo</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Drag the image inside the circle, then zoom until the crop looks right.</p>
          </div>
          <label className="block">
            <span className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold"><ZoomIn size={13} /> Zoom</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.01"
              value={zoom}
              onChange={(event) => changeZoom(Number(event.target.value))}
              className="w-full accent-primary"
              data-testid="slider-avatar-zoom"
            />
            <span className="mt-1 block text-[10px] text-muted-foreground">{zoom.toFixed(1)}×</span>
          </label>
          {error && <p className="text-xs text-destructive" role="alert" data-testid="status-avatar-crop-error">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onCancel} className="rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground hover:bg-muted" data-testid="button-cancel-avatar-crop">Cancel</button>
            <button type="button" onClick={applyCrop} disabled={!dimensions} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-bold text-primary-foreground disabled:opacity-50" data-testid="button-apply-avatar-crop"><Check size={13} /> Use this crop</button>
          </div>
        </div>
      </div>
    </div>
  );
}