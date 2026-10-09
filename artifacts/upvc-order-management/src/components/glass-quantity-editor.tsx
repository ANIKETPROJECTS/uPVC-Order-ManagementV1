import { useEffect, useMemo, useState } from 'react';
import { Check, LoaderCircle, Save } from 'lucide-react';
import type { GlassTrackingItem } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';

type QuantityUpdate = Array<{ id: string; received: number; broken: number }>;
type ItemDraft = Record<string, { received: string; broken: string }>;

function makeDraft(items: GlassTrackingItem[]): ItemDraft {
  return Object.fromEntries(items.map((item) => [item.id, {
    received: String(item.received),
    broken: String(item.broken),
  }]));
}

export function GlassQuantityEditor({
  orderId,
  items,
  canEdit,
  isSaving,
  onSave,
}: {
  orderId: string;
  items: GlassTrackingItem[];
  canEdit: boolean;
  isSaving: boolean;
  onSave: (items: QuantityUpdate) => void;
}) {
  const [draft, setDraft] = useState<ItemDraft>(() => makeDraft(items));
  useEffect(() => setDraft(makeDraft(items)), [items]);

  const hasChanges = items.some((item) => {
    const current = draft[item.id];
    return current && (current.received !== String(item.received) || current.broken !== String(item.broken));
  });
  const receivedTotal = items.reduce((sum, item) => sum + item.received, 0);
  const brokenTotal = items.reduce((sum, item) => sum + item.broken, 0);
  const orderedTotal = items.reduce((sum, item) => sum + item.ordered, 0);
  const validationMessage = useMemo(() => {
    for (const item of items) {
      const current = draft[item.id];
      if (!current || !/^\d+$/.test(current.received) || !/^\d+$/.test(current.broken)) {
        return 'Enter whole, non-negative quantities for received and broken pieces.';
      }
      if (Number(current.received) + Number(current.broken) > item.ordered) {
        return `Received and broken pieces cannot exceed ${item.ordered} ordered for ${item.glassType}, window ${item.windowNo}.`;
      }
    }
    return '';
  }, [draft, items]);

  const save = () => {
    if (!canEdit || !hasChanges || validationMessage || isSaving) return;
    onSave(items.map((item) => ({
      id: item.id,
      received: Number(draft[item.id].received),
      broken: Number(draft[item.id].broken),
    })));
  };

  const fillAllAsReceived = () => {
    if (!canEdit || isSaving) return;
    setDraft((current) => {
      const next = { ...current };
      for (const item of items) {
        const currentItem = current[item.id] ?? {
          received: String(item.received),
          broken: String(item.broken),
        };
        const brokenValue = currentItem.broken;
        const broken = /^\d+$/.test(brokenValue) ? Number(brokenValue) : item.broken;
        next[item.id] = {
          ...currentItem,
          received: String(Math.max(0, item.ordered - broken)),
        };
      }
      return next;
    });
  };

  if (!items.length) {
    return <div className="rounded-xl border border-dashed border-primary/25 bg-primary/[0.025] p-5 text-xs text-muted-foreground">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Save size={15} /></span>
        <div><p className="font-semibold text-foreground">No window lines in this order</p><p className="mt-1 leading-5">Import a glass-order workbook or use Edit to add per-window glass types and ordered quantities for <span className="font-mono font-semibold text-primary">{orderId}</span>.</p></div>
      </div>
    </div>;
  }

  return <div className="overflow-hidden rounded-xl border border-border/70 bg-background" data-testid={`glass-quantity-editor-${orderId}`}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-primary/15 bg-card text-primary"><Save size={14} /></span>
        <div>
          <p className="text-xs font-bold">Window glass lines <span className="ml-1 font-mono text-[10px] font-medium text-muted-foreground">{items.length}</span></p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">All received sets Received to Ordered minus Broken; save to apply.</p>
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          <span>Ordered <strong className="ml-1 font-mono text-foreground">{orderedTotal}</strong></span>
          <span>Received <strong className="ml-1 font-mono text-foreground">{receivedTotal}</strong></span>
          <span>Broken <strong className="ml-1 font-mono text-foreground">{brokenTotal}</strong></span>
        </div>
        {canEdit && <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fillAllAsReceived}
            disabled={isSaving}
            title="Set each received count to ordered minus broken. Save quantities to apply."
            data-testid={`button-all-glass-received-${orderId}`}
          >
            <Check size={13} className="mr-1.5" /> All received
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={!hasChanges || Boolean(validationMessage) || isSaving} data-testid={`button-save-glass-quantities-${orderId}`}>
            {isSaving ? <LoaderCircle size={13} className="mr-1.5 animate-spin" /> : hasChanges ? <Save size={13} className="mr-1.5" /> : <Check size={13} className="mr-1.5" />}
            {isSaving ? 'Saving…' : hasChanges ? 'Save quantities' : 'Saved'}
          </Button>
        </div>}
      </div>
    </div>

    <div className="overflow-x-auto">
      <table className="w-full min-w-[740px] text-left text-xs">
        <thead><tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
          <th className="px-4 py-2.5">Window</th>
          <th className="px-4 py-2.5">Dimensions</th>
          <th className="px-4 py-2.5">Glass type</th>
          <th className="px-4 py-2.5 text-right">Ordered</th>
          <th className="px-4 py-2.5 text-right">Received</th>
          <th className="px-4 py-2.5 text-right">Broken</th>
        </tr></thead>
        <tbody>{items.map((item) => <tr key={item.id} className="glass-spec-row border-b border-border/50 last:border-0">
          <td className="px-4 py-3">
            {item.villaNo ? <span className="font-semibold">{item.villaNo} · </span> : null}
            <span className="font-semibold">{item.windowNo}</span>
          </td>
          <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{item.widthMm} × {item.heightMm} mm</td>
          <td className="px-4 py-3 font-medium">{item.glassType}</td>
          <td className="px-4 py-3 text-right font-mono font-semibold">{item.ordered}</td>
          <td className="px-4 py-2.5 text-right">
            {canEdit ? <input
              type="number"
              min={0}
              max={item.ordered}
              step={1}
              value={draft[item.id]?.received ?? ''}
              onChange={(event) => setDraft((current) => ({ ...current, [item.id]: { ...current[item.id], received: event.target.value } }))}
              aria-label={`Received pieces for ${orderId}, ${item.glassType}, window ${item.windowNo}`}
              className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right font-mono text-xs outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
              data-testid={`input-glass-received-${item.id}`}
            /> : <span className="font-mono">{item.received}</span>}
          </td>
          <td className="px-4 py-2.5 text-right">
            {canEdit ? <input
              type="number"
              min={0}
              max={item.ordered}
              step={1}
              value={draft[item.id]?.broken ?? ''}
              onChange={(event) => setDraft((current) => ({ ...current, [item.id]: { ...current[item.id], broken: event.target.value } }))}
              aria-label={`Broken pieces for ${orderId}, ${item.glassType}, window ${item.windowNo}`}
              className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right font-mono text-xs outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
              data-testid={`input-glass-broken-${item.id}`}
            /> : <span className="font-mono">{item.broken}</span>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>
    {canEdit && validationMessage ? <p className="border-t border-destructive/15 bg-destructive/5 px-4 py-2.5 text-[11px] text-destructive" role="alert">{validationMessage}</p> : null}
    {!canEdit ? <p className="border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">View-only access</p> : null}
  </div>;
}
