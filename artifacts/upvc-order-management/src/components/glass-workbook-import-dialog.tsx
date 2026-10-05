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

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }
  return error instanceof Error ? error.message : fallback;
}

function encodeMapping(orderRecordIds: string[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(orderRecordIds));
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
    if (!file || !preview || mapping.length !== preview.sections.length || mapping.some((id) => !id)) return;
    importWorkbook.mutate({
      filename: encodeURIComponent(file.name),
      mappingToken: encodeMapping(mapping),
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
          <div className="grid gap-3 rounded-xl border border-primary/15 bg-primary/[0.045] p-3 text-xs leading-5 sm:grid-cols-[1fr_auto] sm:items-center">
            <p className="text-muted-foreground"><strong className="text-foreground">{preview.sections.length} client section{preview.sections.length === 1 ? '' : 's'} found.</strong> Assign each section to an existing order. Matching window rows retain their recorded received and broken quantities.</p>
            <span className="rounded-lg border border-border/70 bg-card px-3 py-2 text-[10px] font-semibold text-muted-foreground">Revision cannot fall below recorded counts</span>
          </div>
          {preview.sections.map((section, index) => {
            const glassTypes = [...new Set(section.items.map((item) => item.glassType))];
            const ordered = section.items.reduce((sum, item) => sum + item.ordered, 0);
            return <section key={`${section.clientLabel}-${index}`} className="overflow-hidden rounded-xl border border-border/75 bg-card" data-testid={`glass-workbook-section-${index}`}>
              <div className="grid gap-3 border-b border-border/70 bg-muted/20 p-4 sm:grid-cols-[minmax(150px,.75fr)_minmax(230px,1.25fr)] sm:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 font-mono text-[10px] font-bold text-primary">{String(index + 1).padStart(2, '0')}</span>
                    <p className="truncate text-sm font-bold" title={section.clientLabel}>{section.clientLabel}</p>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {section.items.length} window line{section.items.length === 1 ? '' : 's'} <span className="mx-1 text-border">/</span> <strong className="font-mono text-foreground">{ordered}</strong> pieces
                  </p>
                  <p className="mt-1 truncate text-[10px] leading-5 text-muted-foreground" title={glassTypes.join(' · ')}>{glassTypes.join(' · ')}</p>
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-left text-[11px]">
                  <thead><tr className="border-b border-border/60 text-[9px] uppercase tracking-[.12em] text-muted-foreground">
                    <th className="px-4 py-2.5">Window</th><th className="px-4 py-2.5">Glass type</th><th className="px-4 py-2.5">Dimensions</th><th className="px-4 py-2.5 text-right">Ordered</th>
                  </tr></thead>
                  <tbody>{section.items.map((item) => <tr key={item.id} className="glass-spec-row border-b border-border/50 last:border-0">
                    <td className="px-4 py-2.5 font-semibold">{item.villaNo ? `${item.villaNo} · ` : ''}{item.windowNo}</td>
                    <td className="px-4 py-2.5 font-medium">{item.glassType}</td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">{item.widthMm} × {item.heightMm} mm</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">{item.ordered}</td>
                  </tr>)}</tbody>
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
            disabled={!preview || mapping.some((id) => !id) || importWorkbook.isPending}
            data-testid="button-glass-workbook-import"
          >
            {importWorkbook.isPending ? <><LoaderCircle size={14} className="mr-2 animate-spin" /> Importing…</> : <><FileSpreadsheet size={14} className="mr-2" /> Import workbook</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
