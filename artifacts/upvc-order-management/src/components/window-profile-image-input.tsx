import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const MAX_WINDOW_PROFILE_IMAGE_LENGTH = 220_000;

async function makeCompactJpeg(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose a JPG, PNG, or WebP image.');
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error('Choose an image smaller than 12 MB.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('This image could not be opened.'));
    });

    const maxWidth = 1100;
    const maxHeight = 820;
    const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not process this image.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54]) {
      const result = canvas.toDataURL('image/jpeg', quality);
      if (result.length <= MAX_WINDOW_PROFILE_IMAGE_LENGTH) return result;
    }
    throw new Error('This image is still too large after compression. Choose a smaller image.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function WindowProfileImageInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const chooseImage = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      onChange(await makeCompactJpeg(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The image could not be processed.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/80 p-3">
        {value ? (
          <img
            src={value}
            alt="Window profile drawing preview"
            className="h-20 w-28 rounded-md border border-border/70 bg-white object-contain p-1"
          />
        ) : (
          <div className="grid h-20 w-28 place-items-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground">
            <ImagePlus size={21} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
            <ImagePlus size={14} /> {busy ? 'Processing…' : value ? 'Replace image' : 'Upload image'}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={() => onChange(null)}>
              <Trash2 size={14} /> Remove
            </Button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={disabled || busy}
          onChange={(event) => void chooseImage(event.currentTarget.files?.[0])}
          data-testid="input-profile-drawing-image"
        />
      </div>
      <p className="text-[10px] leading-4 text-muted-foreground">JPG, PNG, or WebP. Images are resized and saved as a compact JPEG.</p>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}