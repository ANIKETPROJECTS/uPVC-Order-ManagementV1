import { useMemo, useState } from 'react';
import { LoaderCircle, Plus, Save, Trash2, X } from 'lucide-react';
import type { GlassTrackingItem } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';

type GlassTrackingItemUpdate = {
  id?: string;
  villaNo: string | null;
  windowNo: string;
  glassType: string;
  widthMm: number;
  heightMm: number;
  ordered: number;
  received: number;
  broken: number;
};

type DraftItem = {
  localKey: string;
  id?: string;
  villaNo: string;
  windowNo: string;
  glassType: string;
  widthMm: string;
  heightMm: string;
  ordered: string;
  received: string;
  broken: string;
};

function toDraft(items: GlassTrackingItem[]): DraftItem[] {
  return items.map((item) => ({
    localKey: item.id,
    id: item.id,
    villaNo: item.villaNo ?? '',
    windowNo: item.windowNo,
    glassType: item.glassType,
    widthMm: String(item.widthMm),
    heightMm: String(item.heightMm),
    ordered: String(item.ordered),
    received: String(item.received),
    broken: String(item.broken),
  }));
}

export function GlassTrackingItemEditor({
  orderId,
  items,
  isSaving,
  onSave,
  onCancel,
}: {
  orderId: string;
  items: GlassTrackingItem[];
  isSaving: boolean;
  onSave: (items: GlassTrackingItemUpdate[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState(() => toDraft(items));
  const original = useMemo(() => JSON.stringify(items), [items]);
  const current = JSON.stringify(rows.map((row) => ({
    id: row.id ?? null,
    villaNo: row.villaNo.trim() || null,
    windowNo: row.windowNo.trim(),
    glassType: row.glassType.trim(),
    widthMm: Number(row.widthMm),
    heightMm: Number(row.heightMm),
    ordered: Number(row.ordered),
    received: Number(row.received),
    broken: Number(row.broken),
  })));
  const hasChanges = current !== original;

  const validationMessage = useMemo(() => {
    if (rows.length === 0) return 'Add at least one glass line, or delete this tracking record.';
    if (rows.length > 500) return 'A tracking record can have at most 500 glass lines.';
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const line = index + 1;
      if (!row.windowNo.trim() || !row.glassType.trim()) {
        return `Enter a window number and glass type for line ${line}.`;
      }
      const width = Number(row.widthMm);
      const height = Number(row.heightMm);
      if (!Number.isFinite(width) || width <= 0 || width > 10000
        || !Number.isFinite(height) || height <= 0 || height > 10000) {
        return `Enter valid dimensions between 0 and 10,000 mm for line ${line}.`;
      }
      const quantities = [row.ordered, row.received, row.broken].map(Number);
      if (quantities.some((value) => !Number.isInteger(value) || value < 0)
        || quantities[0] < 1 || quantities.some((value) => value > 100000)) {
        return `Enter whole, non-negative quantities for line ${line}; ordered must be at least 1.`;
      }
      if (quantities[1] + quantities[2] > quantities[0]) {
        return `Received and broken pieces exceed the ordered quantity on line ${line}.`;
      }
    }
    return '';
  }, [rows]);

  const updateRow = (localKey: string, field: keyof Omit<DraftItem, 'localKey' | 'id'>, value: string) => {
    setRows((currentRows) => currentRows.map((row) => row.localKey === localKey ? { ...row, [field]: value } : row));
  };

  const save = () => {
    if (!hasChanges || validationMessage || isSaving) return;
    onSave(rows.map((row) => ({
      ...(row.id ? { id: row.id } : {}),
      villaNo: row.villaNo.trim() || null,
      windowNo: row.windowNo.trim(),
      glassType: row.glassType.trim(),
      widthMm: Number(row.widthMm),
      heightMm: Number(row.heightMm),
      ordered: Number(row.ordered),
      received: Number(row.received),
      broken: Number(row.broken),
    })));
  };

  return <section className="rounded-xl border border-primary/20 bg-background p-3 sm:p-4" data-testid={`glass-item-editor-${orderId}`}>
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-3">
      <div>
        <h3 className="text-sm font-bold">Edit glass tracking details</h3>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          Update window lines and quantities for <span className="font-mono font-semibold text-primary">{orderId}</span>. This does not change the source workbook file.
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isSaving} data-testid={`button-cancel-glass-edit-${orderId}`}>
          <X size={13} className="mr-1.5" /> Cancel
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={!hasChanges || Boolean(validationMessage) || isSaving} data-testid={`button-save-glass-edit-${orderId}`}>
          {isSaving ? <LoaderCircle size={13} className="mr-1.5 animate-spin" /> : <Save size={13} className="mr-1.5" />}
          {isSaving ? 'Saving…' : 'Save details'}
        </Button>
      </div>
    </div>

    <div className="mt-3 space-y-3">
      {rows.map((row, index) => {
        const fields: Array<{ key: keyof Omit<DraftItem, 'localKey' | 'id'>; label: string; type?: string; step?: string }> = [
          { key: 'villaNo', label: 'Villa / site' },
          { key: 'windowNo', label: 'Window no.' },
          { key: 'glassType', label: 'Glass type' },
          { key: 'widthMm', label: 'Width (mm)', type: 'number', step: 'any' },
          { key: 'heightMm', label: 'Height (mm)', type: 'number', step: 'any' },
          { key: 'ordered', label: 'Ordered', type: 'number', step: '1' },
          { key: 'received', label: 'Received', type: 'number', step: '1' },
          { key: 'broken', label: 'Broken', type: 'number', step: '1' },
        ];
        return <div key={row.localKey} className="rounded-lg border border-border/70 bg-card p-3" data-testid={`glass-edit-line-${index + 1}`}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Glass line {index + 1}</p>
            <button type="button" onClick={() => setRows((currentRows) => currentRows.filter((item) => item.localKey !== row.localKey))} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-semibold text-destructive hover:bg-destructive/5" aria-label={`Remove glass line ${index + 1}`} data-testid={`button-remove-glass-line-${index + 1}`}>
              <Trash2 size={12} /> Remove line
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {fields.map(({ key, label, type = 'text', step }) => <label key={key} className="min-w-0 text-[10px] font-semibold text-muted-foreground">
              <span>{label}</span>
              <input
                type={type}
                step={step}
                min={type === 'number' ? key === 'ordered' ? 1 : 0 : undefined}
                value={row[key]}
                onChange={(event) => updateRow(row.localKey, key, event.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                aria-label={`${label} for ${orderId}, line ${index + 1}`}
                data-testid={`input-glass-edit-${key}-${index + 1}`}
              />
            </label>)}
          </div>
        </div>;
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => setRows((currentRows) => [...currentRows, {
        localKey: crypto.randomUUID(),
        villaNo: '',
        windowNo: '',
        glassType: '',
        widthMm: '',
        heightMm: '',
        ordered: '1',
        received: '0',
        broken: '0',
      }])} disabled={rows.length >= 500 || isSaving} data-testid={`button-add-glass-line-${orderId}`}>
        <Plus size={13} className="mr-1.5" /> Add glass line
      </Button>
    </div>
    {validationMessage && <p className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] text-destructive" role="alert">{validationMessage}</p>}
  </section>;
}
