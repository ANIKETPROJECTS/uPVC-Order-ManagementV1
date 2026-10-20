import { useState } from 'react';
import { FileSpreadsheet, LoaderCircle, Upload } from 'lucide-react';
import {
  useImportGlassOrderWorkbook,
  usePreviewGlassOrderWorkbook,
} from '@workspace/api-client-react';
import type { GlassTrackingOrder, GlassWorkbookPreview } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;

function normalize(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function numericCell(value: string | undefined) {
  const parsed = Number((value ?? '').replace(/,/g, '').replace(/[^\d.+-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function piecesCell(value: string | undefined) {
  const match = /^\s*(\d+)\s*(?:nos?|pcs?|pieces?)?\s*$/i.exec(value ?? '');
  return match ? Number(match[1]) : null;
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }
  return error instanceof Error ? error.message : fallback;
}

function encodeMapping(orderRecordIds: string[], preview: GlassWorkbookPreview) {
  const bytes = new TextEncoder().encode(JSON.stringify({
    orderRecordIds,
    columnMappings: preview.sections.map((section) => section.mapping),
  }));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function GlassWorkbookImportDialog({
  orders,
  canEdit,
  onImported,
}: {
  orders: GlassTrackingOrder[];
  canEdit: boolean;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<GlassWorkbookPreview | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [tableView, setTableView] = useState<'excel' | 'software'>('excel');
  const previewWorkbook = usePreviewGlassOrderWorkbook();
  const importWorkbook = useImportGlassOrderWorkbook();

  const startPreview = (selectedFile: File | undefined) => {
    if (!selectedFile) return;
    if (!selectedFile.name.toLocaleLowerCase().endsWith('.xlsx')) {
      toast({ title: 'Choose an .xlsx workbook', description: 'Glass Tracking imports Excel workbooks in .xlsx format.', variant: 'destructive' });
      return;
    }
    if (selectedFile.size > MAX_WORKBOOK_BYTES) {
      toast({ title: 'Workbook is too large', description: 'Choose an .xlsx workbook no larger than 10 MiB.', variant: 'destructive' });
      return;
    }

    setFile(selectedFile);
    setPreview(null);
    setMapping([]);
    setTableView('excel');
    setOpen(true);
    previewWorkbook.mutate({ filename: encodeURIComponent(selectedFile.name), data: selectedFile }, {
      onSuccess: (result) => {
        setPreview(result);
        setMapping(result.sections.map((section) => {
          const matches = orders.filter((order) => normalize(order.clientName) === normalize(section.clientLabel));
          return matches.length === 1 ? matches[0].orderRecordId : '';
        }));
      },
      onError: (error) => {
        toast({
          title: 'Workbook preview failed',
          description: errorMessage(error, 'Check the workbook layout and try again.'),
          variant: 'destructive',
        });
      },
    });
  };

  const closeDialog = (nextOpen: boolean) => {
    if (importWorkbook.isPending) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setFile(null);
      setPreview(null);
      setMapping([]);
    }
  };

  const importPreview = () => {
    if (!file || !preview || mapping.length !== preview.sections.length || mapping.some((id) => !id)
      || preview.sections.some((section) => section.mapping.width == null || section.mapping.height == null || section.mapping.quantity == null)) return;
    importWorkbook.mutate({
      filename: encodeURIComponent(file.name),
      mappingToken: encodeMapping(mapping, preview),
      data: file,
    }, {
      onSuccess: () => {
        onImported();
        toast({
          title: 'Glass workbook imported',
          description: `Updated ${new Set(mapping).size} order${new Set(mapping).size === 1 ? '' : 's'}. Existing received and broken counts were kept for matching rows.`,
        });
        setOpen(false);
        setFile(null);
        setPreview(null);
        setMapping([]);
      },
      onError: (error) => {
        toast({
          title: 'Workbook was not imported',
          description: errorMessage(error, 'No quantities were changed. Review the workbook and try again.'),
          variant: 'destructive',
        });
      },
    });
  };

  return <>
    {canEdit && <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-3.5 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 hover:bg-primary/90 focus-within:outline-none focus-within:ring-2 focus-within:ring-primary/30">
      <Upload size={14} aria-hidden="true" />
      <span>Upload / re-upload glass Excel</span>
      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        data-testid="input-glass-workbook"
        onChange={(event) => {
          const selectedFile = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          startPreview(selectedFile);
        }}
      />
    </label>}

    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto" data-testid="dialog-glass-workbook-import">
        <DialogHeader>
          <div className="mb-1 flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-primary"><FileSpreadsheet size={19} /></span>
            <div className="min-w-0">
              <DialogTitle>Import glass-order workbook</DialogTitle>
              <DialogDescription className="mt-1">
                {file ? file.name : 'Choose an .xlsx workbook.'} · Match every client section to its order before importing.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {previewWorkbook.isPending ? <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4" aria-label="Reading workbook" data-testid="state-glass-workbook-preview-loading">
          <div className="flex items-center gap-3 text-sm font-semibold"><LoaderCircle size={17} className="animate-spin text-primary" />Reading workbook sections…</div>
          <div className="space-y-2"><div className="h-10 animate-pulse rounded-lg bg-muted" /><div className="h-16 animate-pulse rounded-lg bg-muted/75" /></div>
        </div> : null}

        {preview ? <div className="space-y-3">
          {(() => {
            const rowCount = preview.sections.reduce((sum, section) => sum + section.items.length, 0);
            const pieces = preview.sections.reduce((sum, section) => sum + section.items.reduce((subtotal, item) => subtotal + (piecesCell(item.rawValues[section.mapping.quantity ?? -1]) ?? 0), 0), 0);
            const area = preview.sections.reduce((sum, section) => sum + section.items.reduce((subtotal, item) => {
              const width = numericCell(item.rawValues[section.mapping.width ?? -1]);
              const height = numericCell(item.rawValues[section.mapping.height ?? -1]);
              const qty = piecesCell(item.rawValues[section.mapping.quantity ?? -1]);
              return subtotal + (width && height && qty ? width * height * qty / 92903 : 0);
            }, 0), 0);
            const clients = new Set(preview.sections.map((section) => normalize(section.clientLabel)).filter(Boolean)).size;
            return <div className="space-y-3 rounded-xl border border-primary/15 bg-primary/[0.045] p-3">
              <p className="text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Workbook review.</strong> Assign each group to an existing order. Matching rows retain recorded received and broken quantities.</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  ['Clients', clients],
                  ['Groups', preview.sections.length],
                  ['Rows', rowCount],
                  ['Pieces', pieces],
                  ['Area', `${area.toFixed(1)} sq ft`],
                ].map(([label, value]) => <div key={label} className="rounded-lg border border-border/70 bg-card px-3 py-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className="mt-1 text-sm font-bold tabular-nums">{value}</p>
                </div>)}
              </div>
              <p className="text-[10px] text-muted-foreground">Revision cannot fall below recorded received and broken counts.</p>
            </div>;
          })()}
          {preview.sections.map((section, index) => {
            const ordered = section.items.reduce((sum, item) => sum + (piecesCell(item.rawValues[section.mapping.quantity ?? -1]) ?? 0), 0);
            const area = section.items.reduce((sum, item) => {
              const width = numericCell(item.rawValues[section.mapping.width ?? -1]);
              const height = numericCell(item.rawValues[section.mapping.height ?? -1]);
              const qty = piecesCell(item.rawValues[section.mapping.quantity ?? -1]);
              return sum + (width && height && qty ? width * height * qty / 92903 : 0);
            }, 0);
            const warnings = [...section.warnings, ...section.items.flatMap((item) => item.warnings.map((warning) => `Excel row ${item.sourceRow}: ${warning}`))];
            const setColumn = (role: keyof typeof section.mapping, value: string) => setPreview((current) => current ? ({
              ...current,
              sections: current.sections.map((entry, sectionIndex) => sectionIndex === index
                ? { ...entry, mapping: { ...entry.mapping, [role]: value === '' ? null : Number(value) } }
                : entry),
            }) : current);
            return <section key={`${section.clientLabel}-${index}`} className="overflow-hidden rounded-xl border border-border/75 bg-card" data-testid={`glass-workbook-section-${index}`}>
              <div className="grid gap-3 border-b border-border/70 bg-muted/20 p-4 sm:grid-cols-[minmax(150px,.75fr)_minmax(230px,1.25fr)] sm:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 font-mono text-[10px] font-bold text-primary">{String(index + 1).padStart(2, '0')}</span>
                    <p className="truncate text-sm font-bold" title={section.clientLabel}>{section.clientLabel}</p>
                    {section.needsAttention && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-900">Needs attention</span>}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {section.items.length} rows <span className="mx-1 text-border">/</span> <strong className="font-mono text-foreground">{ordered}</strong> pieces <span className="mx-1 text-border">/</span>{area.toFixed(1)} sq ft
                  </p>
                  <p className="mt-1 truncate text-[10px] leading-5 text-muted-foreground" title={section.glassType}>{section.glassType}</p>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{[section.lot, section.wing, section.date, section.supplier].filter(Boolean).join(' · ') || 'Lot, wing, date, and supplier not found'}</p>
                  <p className="mt-1 text-[10px] font-medium text-muted-foreground">{section.sourceSheet}, rows {section.sourceRowStart} to {section.sourceRowEnd}</p>
                  {warnings.length > 0 && <ul className="mt-2 space-y-1 text-[10px] text-amber-800">{warnings.map((warning, warningIndex) => <li key={warningIndex}>• {warning}</li>)}</ul>}
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Assign section to order</span>
                  <select
                    value={mapping[index] ?? ''}
                    onChange={(event) => setMapping((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                    data-testid={`select-glass-workbook-order-${index}`}
                  >
                    <option value="">Choose an order…</option>
                    {orders.map((order) => <option key={order.orderRecordId} value={order.orderRecordId}>
                      {order.orderId} — {order.clientName}
                    </option>)}
                  </select>
                </label>
              </div>
              <div className="border-b border-border/60 bg-muted/10 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-[10px] uppercase tracking-wider text-muted-foreground">Columns</strong>
                  <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-[10px]" role="group" aria-label="Preview table view">
                    <button type="button" onClick={() => setTableView('excel')} className={`rounded px-2 py-1 ${tableView === 'excel' ? 'bg-primary text-primary-foreground' : ''}`}>Excel view</button>
                    <button type="button" onClick={() => setTableView('software')} className={`rounded px-2 py-1 ${tableView === 'software' ? 'bg-primary text-primary-foreground' : ''}`}>Software view</button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {([
                    ['width', 'Width'],
                    ['height', 'Height'],
                    ['quantity', 'Quantity'],
                    ['serial', 'Sr no'],
                    ['flat', 'Flat / Unit'],
                  ] as const).map(([role, label]) => <label key={role} className="text-[10px] font-medium text-muted-foreground">
                    {label}
                    <select value={section.mapping[role] ?? ''} onChange={(event) => setColumn(role, event.target.value)} className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-[10px]" aria-label={`${label} column`}>
                      <option value="">Not mapped</option>
                      {section.columns.map((column, columnIndex) => <option key={`${column}-${columnIndex}`} value={columnIndex}>{column}</option>)}
                    </select>
                  </label>)}
                </div>
                {(section.mapping.width == null || section.mapping.height == null || section.mapping.quantity == null) && <p className="mt-2 text-[10px] font-semibold text-amber-800">Map Width, Height, and Quantity to continue.</p>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-left text-[11px]">
                  {tableView === 'excel' ? <>
                    <thead><tr className="border-b border-border/60 text-[9px] uppercase tracking-[.12em] text-muted-foreground">
                      {section.columns.map((column, columnIndex) => <th key={`${column}-${columnIndex}`} className="px-3 py-2.5 text-left">{column}</th>)}
                      <th className="px-3 py-2.5 text-right">Area (sq ft)</th><th className="px-3 py-2.5 text-right">Pieces</th><th className="px-3 py-2.5 text-right">Excel row</th>
                    </tr></thead>
                    <tbody>{section.items.map((item) => {
                      const width = numericCell(item.rawValues[section.mapping.width ?? -1]);
                      const height = numericCell(item.rawValues[section.mapping.height ?? -1]);
                      const qty = piecesCell(item.rawValues[section.mapping.quantity ?? -1]);
                      const rowArea = width && height && qty ? width * height * qty / 92903 : null;
                      return <tr key={item.id} className="glass-spec-row border-b border-border/50 last:border-0">
                        {section.columns.map((_, columnIndex) => <td key={columnIndex} className="px-3 py-2.5">{item.rawValues[columnIndex]}</td>)}
                        <td className="px-3 py-2.5 text-right font-mono">{rowArea === null ? '—' : rowArea.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{qty ?? '—'}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{item.sourceRow}</td>
                      </tr>;
                    })}</tbody>
                  </> : <>
                    <thead><tr className="border-b border-border/60 text-[9px] uppercase tracking-[.12em] text-muted-foreground"><th className="px-4 py-2.5">Window</th><th className="px-4 py-2.5">Glass type</th><th className="px-4 py-2.5">Dimensions</th><th className="px-4 py-2.5 text-right">Ordered</th></tr></thead>
                    <tbody>{section.items.map((item) => {
                      const serial = section.mapping.serial == null ? '' : item.rawValues[section.mapping.serial] ?? '';
                      const flat = section.mapping.flat == null ? '' : item.rawValues[section.mapping.flat] ?? '';
                      const width = numericCell(item.rawValues[section.mapping.width ?? -1]);
                      const height = numericCell(item.rawValues[section.mapping.height ?? -1]);
                      const qty = piecesCell(item.rawValues[section.mapping.quantity ?? -1]);
                      return <tr key={item.id} className="glass-spec-row border-b border-border/50 last:border-0">
                        <td className="px-4 py-2.5 font-semibold">{flat ? `${flat} · ` : ''}{serial || item.windowNo}</td><td className="px-4 py-2.5">{section.glassType}</td>
                        <td className="px-4 py-2.5 font-mono text-muted-foreground">{width ?? '—'} × {height ?? '—'} mm</td><td className="px-4 py-2.5 text-right font-mono font-semibold">{qty ?? '—'}</td>
                      </tr>;
                    })}</tbody>
                  </>}
                </table>
              </div>
            </section>;
          })}
        </div> : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => closeDialog(false)} disabled={importWorkbook.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={importPreview}
            disabled={!preview || mapping.some((id) => !id)
              || preview.sections.some((section) => section.mapping.width == null || section.mapping.height == null || section.mapping.quantity == null)
              || importWorkbook.isPending}
            data-testid="button-glass-workbook-import"
          >
            {importWorkbook.isPending ? <><LoaderCircle size={14} className="mr-2 animate-spin" /> Importing…</> : <><FileSpreadsheet size={14} className="mr-2" /> Import workbook</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
