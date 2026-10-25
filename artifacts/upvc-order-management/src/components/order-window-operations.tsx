import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { Check, ChevronDown, ChevronRight, Printer, Settings2, ShieldAlert, X } from 'lucide-react';
import {
  getGetOrderQrPrintSummaryQueryKey,
  getGetQrStickerSettingsQueryKey,
  getListOrderActivityQueryKey,
  getListOrderWindowsQueryKey,
  useCancelQrPrintJob,
  useConfirmQrPrintJob,
  useCreateOrderQrPrintJob,
  useGetOrderQrPrintSummary,
  useGetQrStickerSettings,
  useMarkOrderQrPiecesPending,
  useUpdateQrStickerSettings,
  useUpdateOrderWindow,
} from '@workspace/api-client-react';
import type { Order, OrderWindow, QrPrintJobPiece, QrStickerSettingsInput, QrStickerSettingsResponse, User } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

export function ProjectLotAssignmentPanel({
  order,
  windows,
  user,
}: {
  order: Order;
  windows: OrderWindow[];
  user: User;
}) {
  const update = useUpdateOrderWindow();
  const queryClient = useQueryClient();
  if (order.clientType !== 'Project' || windows.length === 0) return null;

  return (
    <Card data-testid="card-window-lot-assignment">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Plan windows into project lots</CardTitle>
        <p className="text-xs text-muted-foreground">
          Lot membership belongs to each window. Dispatched windows cannot be reassigned.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {windows.map((window) => (
          <label key={window.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-xs">
            <span className="font-semibold">{window.windowNo}</span>
            <select
              aria-label={`Assign ${window.windowNo} to a lot`}
              value={window.lotId ?? ''}
              disabled={(user.roleId !== 'master-admin' && user.permissions?.['order-hub'] !== 'edit') || update.isPending}
              onChange={(event) => update.mutate(
                { id: order.id, windowId: window.id, data: { lotId: event.target.value || null } },
                { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListOrderWindowsQueryKey(order.id) }) },
              )}
              className="h-9 min-w-48 rounded-md border border-input bg-background px-2"
            >
              <option value="">Unassigned</option>
              {order.lots.map((lot) => <option key={lot.id} value={lot.lotId}>{lot.lotId}</option>)}
            </select>
          </label>
        ))}
      </CardContent>
    </Card>
  );
}

export function PieceQrLabelSheet({ order, windows }: { order: Order; windows: OrderWindow[] }) {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const timer = window.setTimeout(() => window.print(), 200);
    return () => window.clearTimeout(timer);
  }, [printing]);

  const printableWindows = order.clientType === 'Project' ? windows.filter((row) => row.lotId) : windows;
  const labels = printableWindows.flatMap((row) => row.pieces.map((piece) => ({
    row,
    piece,
    name: piece.kind === 'frame' ? 'Frame' : piece.kind === 'glass_shutter' ? 'Glass shutter' : 'Mesh shutter',
  })));

  return (
    <Card data-testid="card-window-qr-labels">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Factory QR labels</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Print software-generated labels for the order’s window components.{order.clientType === 'Project' ? ' Assign project windows to a lot before printing their formatted IDs.' : ''}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setPrinting(true)} disabled={!labels.length}>Print label sheet</Button>
      </CardHeader>
      {printing && (
        <CardContent id="piece-qr-print-sheet" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {labels.map(({ row, name, piece }) => (
            <div key={piece.id} className="piece-qr-label flex flex-col items-center gap-1 border border-border p-2 text-center">
              <QRCodeCanvas value={`FRAMEWISE_PIECE:${order.id}:${row.id}:${piece.id}`} size={96} includeMargin />
              <strong className="text-xs">{order.clientType === 'Project' ? piece.id : `${order.orderId} · ${row.windowNo}`}</strong>
              <span className="text-[10px]">{name} {piece.pieceNo} · {piece.status === 'ready' ? 'Ready' : 'Pending'}</span>
            </div>
          ))}
          <style>{`@media print { body * { visibility:hidden!important } #piece-qr-print-sheet,#piece-qr-print-sheet * { visibility:visible!important } #piece-qr-print-sheet { display:grid!important; position:absolute; inset:0; padding:10mm } .piece-qr-label { break-inside:avoid } }`}</style>
        </CardContent>
      )}
    </Card>
  );
}

type StickerJob = {
  jobId: string;
  pieces: QrPrintJobPiece[];
  settings: QrStickerSettingsResponse | QrStickerSettingsInput;
};

const defaultStickerSettings: QrStickerSettingsInput = {
  widthMm: 60,
  heightMm: 40,
  orientation: 'landscape',
  marginMm: 2,
  qrSizeMm: 22,
  fontSizeLine1Pt: 10,
  fontSizeLine2Pt: 8,
  nameMaxLines: 2,
};

function canDo(user: User, permission: string) {
  return user.roleId === 'master-admin' || user.permissions?.[permission] === 'edit';
}

const kindName = (kind: OrderWindow['pieces'][number]['kind']) =>
  kind === 'frame' ? 'Frame' : kind === 'glass_shutter' ? 'Glass shutter' : 'Mesh shutter';

const istStamp = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Not printed';

function stickerPrintCss(
  rootId: string,
  settings: QrStickerSettingsResponse | QrStickerSettingsInput,
) {
  const pageWidth = settings.orientation === 'landscape' ? Math.max(settings.widthMm, settings.heightMm) : Math.min(settings.widthMm, settings.heightMm);
  const pageHeight = settings.orientation === 'landscape' ? Math.min(settings.widthMm, settings.heightMm) : Math.max(settings.widthMm, settings.heightMm);
  return `
    @page { size: ${pageWidth}mm ${pageHeight}mm; margin: 0; }
    @media print {
      html, body {
        width: auto !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        position: static !important;
      }
      body.printing-stickers > :not(#${rootId}) { display: none !important; }
      body.printing-stickers > #${rootId} {
        display: block !important;
        width: auto !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        position: static !important;
      }
      body.printing-stickers > #${rootId},
      body.printing-stickers > #${rootId} * {
        visibility: visible !important;
      }
      body.printing-stickers #${rootId} .qr-sticker-page {
        display: flex !important;
        position: static !important;
        width: ${pageWidth}mm !important;
        height: ${pageHeight}mm !important;
        min-height: 0 !important;
        box-sizing: border-box !important;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1mm;
        overflow: hidden !important;
        margin: 0 !important;
        padding: ${settings.marginMm}mm !important;
        background: #fff !important;
        color: #000 !important;
        page-break-after: always;
        break-after: page;
        font-family: Arial, sans-serif;
      }
      body.printing-stickers #${rootId} .qr-sticker-page:last-child {
        page-break-after: auto !important;
        break-after: auto !important;
      }
      body.printing-stickers #${rootId} .qr-sticker-qr {
        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;
        margin: 0 auto;
      }
      body.printing-stickers #${rootId} .qr-sticker-qr canvas {
        display: block;
        width: ${settings.qrSizeMm}mm !important;
        height: ${settings.qrSizeMm}mm !important;
        image-rendering: pixelated;
      }
      body.printing-stickers #${rootId} .qr-sticker-id {
        width: 100%;
        flex: none;
        overflow: hidden;
        white-space: nowrap;
        text-align: center;
        font-weight: 700;
        line-height: 1.12;
      }
      body.printing-stickers #${rootId} .qr-sticker-client {
        display: -webkit-box;
        width: 100%;
        flex: none;
        overflow: hidden;
        overflow-wrap: anywhere;
        text-align: center;
        line-height: 1.12;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: ${settings.nameMaxLines};
        text-overflow: ellipsis;
      }
    }
  `;
}

function StickerPrintDocument({
  pieces,
  settings,
  rootId,
}: {
  pieces: QrPrintJobPiece[];
  settings: QrStickerSettingsResponse | QrStickerSettingsInput;
  rootId: string;
}) {
  return createPortal(<div
    id={rootId}
    className="qr-sticker-print-root"
    aria-hidden="true"
    style={{ display: 'none' }}
  >
    {pieces.map((piece, index) => {
      const scale = Math.max(0.62, Math.min(1, 22 / Math.max(22, piece.displayId.length)));
      return <article className="qr-sticker-page" key={`${piece.pieceId}-${index}`}>
        <div className="qr-sticker-qr"><QRCodeCanvas value={piece.payload} size={Math.round(settings.qrSizeMm * 3.78)} level="M" includeMargin /></div>
        <div className="qr-sticker-id" style={{ fontSize: `${settings.fontSizeLine1Pt * scale}pt` }}>{piece.displayId}</div>
        <div className="qr-sticker-client" style={{ fontSize: `${settings.fontSizeLine2Pt}pt` }}>{piece.clientName}</div>
      </article>;
    })}
  </div>, document.body);
}

export function OrderQrStickerControls({
  orderId,
  order,
  windows,
  user,
}: {
  orderId: string;
  order: Order | undefined;
  windows: OrderWindow[];
  user: User;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canPrint = canDo(user, 'order.qr.print');
  const canReprint = canDo(user, 'order.qr.reprint');
  const isMaster = user.roleId === 'master-admin';
  const summaryQuery = useGetOrderQrPrintSummary(orderId, { query: { enabled: canPrint, queryKey: getGetOrderQrPrintSummaryQueryKey(orderId), refetchInterval: 10_000 } });
  const settingsQuery = useGetQrStickerSettings({ query: { enabled: isMaster, queryKey: getGetQrStickerSettingsQueryKey() } });
  const createJob = useCreateOrderQrPrintJob();
  const confirmJob = useConfirmQrPrintJob();
  const cancelJob = useCancelQrPrintJob();
  const markPending = useMarkOrderQrPiecesPending();
  const updateSettings = useUpdateQrStickerSettings();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [inProgress, setInProgress] = useState<Record<string, string>>({});
  const [warningMode, setWarningMode] = useState<'all' | 'selected' | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<QrStickerSettingsInput>(defaultStickerSettings);
  const [jobToPrint, setJobToPrint] = useState<StickerJob | null>(null);
  const [testPrint, setTestPrint] = useState(false);
  const [renderedCount, setRenderedCount] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [printedIds, setPrintedIds] = useState<string[]>([]);
  const [partialConfirm, setPartialConfirm] = useState(false);

  const pieces = useMemo(() => windows.flatMap((window) => window.pieces.map((piece) => ({ ...piece, windowId: window.id, windowNo: window.windowNo }))), [windows]);
  const pieceById = useMemo(() => new Map(pieces.map((piece) => [piece.id, piece])), [pieces]);
  const printedCount = pieces.filter((piece) => piece.qrPrint?.status === 'printed').length;
  const pendingCount = summaryQuery.data?.pendingPieces ?? pieces.filter((piece) => piece.qrPrint?.status !== 'printed').length;
  const selectedPrinted = selectedIds.some((id) => pieceById.get(id)?.qrPrint?.status === 'printed');
  const visibleSelection = selectedIds.filter((id) => pieceById.has(id) && !inProgress[id]);
  const settings = settingsQuery.data ?? defaultStickerSettings;
  const allPieces = pieces;
  const changeSelected = (ids: string[], checked: boolean) => setSelectedIds((current) => checked
    ? [...new Set([...current, ...ids])]
    : current.filter((id) => !ids.includes(id)));
  const invalidatePrintData = () => {
    void queryClient.invalidateQueries({ queryKey: getListOrderWindowsQueryKey(orderId) });
    void queryClient.invalidateQueries({ queryKey: getGetOrderQrPrintSummaryQueryKey(orderId) });
    void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(orderId) });
  };

  useEffect(() => {
    if (!settingsQuery.data) return;
    const { defaultsUnconfirmed: _defaults, updatedBy: _by, updatedAt: _at, ...input } = settingsQuery.data;
    setSettingsDraft(input);
  }, [settingsQuery.data]);

  useEffect(() => {
    if (!summaryQuery.data) return;
    setInProgress(Object.fromEntries(summaryQuery.data.inProgressPieces.map(({ pieceId, createdByName }) => [pieceId, createdByName])));
  }, [summaryQuery.data]);

  useEffect(() => {
    if (!jobToPrint && !testPrint) return;
    const labelCount = testPrint ? 1 : jobToPrint?.pieces.length ?? 0;
    setRenderedCount(0);
    const timer = window.setInterval(() => {
      setRenderedCount((count) => Math.min(labelCount, count + 50));
    }, 35);
    return () => window.clearInterval(timer);
  }, [jobToPrint, testPrint]);

  useEffect(() => {
    const count = testPrint ? 1 : jobToPrint?.pieces.length ?? 0;
    if ((!jobToPrint && !testPrint) || count === 0 || renderedCount < count) return;
    let cancelled = false;
    let completed = false;
    let printStyle: HTMLStyleElement | null = null;
    let afterPrintHandler: (() => void) | null = null;
    let timeoutId: number | undefined;
    let secondFrame: number | undefined;
    const rootId = testPrint ? 'qr-sticker-test-print-root' : 'qr-sticker-job-print-root';
    const finishPrint = () => {
      if (completed) return;
      completed = true;
      document.body.classList.remove('printing-stickers');
      printStyle?.remove();
      if (afterPrintHandler) window.removeEventListener('afterprint', afterPrintHandler);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (!testPrint && jobToPrint) {
        setPrintedIds(jobToPrint.pieces.map((piece) => piece.pieceId));
        setConfirmOpen(true);
      } else {
        setTestPrint(false);
      }
    };
    const doPrint = () => {
      if (cancelled) return;
      const renderedStickerCount = document.querySelectorAll(`#${rootId} .qr-sticker-page`).length;
      if (renderedStickerCount !== count) {
        toast({
          title: 'Sticker print stopped',
          description: `Expected ${count} stickers but found ${renderedStickerCount}. Nothing was sent to the printer.`,
          variant: 'destructive',
        });
        if (testPrint) {
          setTestPrint(false);
        } else if (jobToPrint) {
          cancelJob.mutate({ jobId: jobToPrint.jobId }, {
            onSuccess: () => {
              invalidatePrintData();
              setInProgress({});
              setJobToPrint(null);
            },
            onError: () => setJobToPrint(null),
          });
        }
        return;
      }
      printStyle = document.createElement('style');
      printStyle.dataset.qrStickerPrint = 'true';
      printStyle.textContent = stickerPrintCss(
        rootId,
        testPrint ? settingsDraft : jobToPrint!.settings,
      );
      document.head.appendChild(printStyle);
      document.body.classList.add('printing-stickers');
      afterPrintHandler = finishPrint;
      window.addEventListener('afterprint', finishPrint, { once: true });
      window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          window.print();
          timeoutId = window.setTimeout(finishPrint, 500);
        });
      });
    };
    const frame = window.requestAnimationFrame(doPrint);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
      if (!completed) {
        document.body.classList.remove('printing-stickers');
        printStyle?.remove();
        if (afterPrintHandler) window.removeEventListener('afterprint', afterPrintHandler);
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      }
    };
  }, [jobToPrint, testPrint, renderedCount]);

  const startJob = (mode: 'all' | 'selected' | 'pending') => {
    const ids = mode === 'selected' ? visibleSelection : undefined;
    createJob.mutate({ id: orderId, data: { mode, ...(ids ? { pieceIds: ids } : {}) } }, {
      onSuccess: (response) => {
        const progress: Record<string, string> = {};
        for (const entry of response.inProgressPieces ?? []) progress[entry.pieceId] = entry.createdByName;
        for (const piece of response.pieces ?? []) progress[piece.pieceId] = user.name;
        setInProgress(progress);
        if (!response.job || response.pieces.length === 0) {
          toast({ title: 'No labels to print', description: response.inProgressPieces?.length ? 'Selected pieces already have a print job in progress.' : 'There are no eligible pieces for this print run.' });
          return;
        }
        const savedSettings = response.stickerSettings ?? settings;
        setRenderedCount(0);
        setJobToPrint({ jobId: response.job.id, pieces: response.pieces, settings: savedSettings });
        setSelectionMode(false);
        setSelectedIds([]);
      },
      onError: (error) => toast({ title: 'Print job could not be created', description: error instanceof Error ? error.message : 'Refresh the order and try again.', variant: 'destructive' }),
    });
  };

  const closeConfirmation = (cancel: boolean, ids: string[] = printedIds) => {
    if (!jobToPrint) return;
    if (cancel) {
      cancelJob.mutate({ jobId: jobToPrint.jobId }, {
        onSuccess: () => { invalidatePrintData(); setInProgress({}); setJobToPrint(null); setConfirmOpen(false); setPrintedIds([]); setPartialConfirm(false); },
        onError: (error) => toast({ title: 'Print job remains unresolved', description: error instanceof Error ? error.message : 'Try again before leaving this order.', variant: 'destructive' }),
      });
    } else {
      confirmJob.mutate({ jobId: jobToPrint.jobId, data: { printedPieceIds: ids } }, {
        onSuccess: () => { invalidatePrintData(); setInProgress({}); setJobToPrint(null); setConfirmOpen(false); setPrintedIds([]); setPartialConfirm(false); toast({ title: 'Sticker print recorded', description: `${ids.length} piece${ids.length === 1 ? '' : 's'} marked printed.` }); },
        onError: (error) => toast({ title: 'Print confirmation could not be saved', description: error instanceof Error ? error.message : 'The job remains pending; retry confirmation.', variant: 'destructive' }),
      });
    }
  };

  const markSelectedPending = () => {
    if (!visibleSelection.length) return;
    markPending.mutate({ id: orderId, data: { pieceIds: visibleSelection } }, {
      onSuccess: () => {
        invalidatePrintData();
        setPendingConfirm(false);
        setSelectedIds([]);
        toast({ title: 'Selected pieces marked pending' });
      },
      onError: (error) => toast({ title: 'Pieces could not be marked pending', description: error instanceof Error ? error.message : 'Refresh the order and try again.', variant: 'destructive' }),
    });
  };

  const saveSettings = () => updateSettings.mutate({ data: settingsDraft }, {
    onSuccess: (saved) => {
      queryClient.setQueryData(getGetQrStickerSettingsQueryKey(), saved);
      setSettingsOpen(false);
      toast({ title: 'Sticker settings saved' });
    },
    onError: (error) => toast({ title: 'Sticker settings could not be saved', description: error instanceof Error ? error.message : 'Check the dimensions and try again.', variant: 'destructive' }),
  });

  const testPiece: QrPrintJobPiece = {
    windowId: 'preview-window',
    pieceId: 'preview-piece',
    displayId: pieces[0]?.displayId ?? 'FRAME-01',
    payload: `FRAMEWISE_PIECE:${orderId}:${pieces[0]?.windowId ?? 'window'}:${pieces[0]?.id ?? 'piece'}`,
    clientName: order?.clientName ?? 'Client name preview',
  };

  if (!canPrint) return null;
  return <section className="mb-4 overflow-hidden rounded-xl border border-primary/15 bg-primary/[0.025]" data-testid="panel-order-qr-stickers">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-3 py-3 sm:px-4">
      <div className="min-w-[175px]">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary">Traceability</p>
        <h3 className="mt-0.5 text-sm font-bold">QR stickers</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid="text-qr-piece-summary">
          {summaryQuery.isLoading ? 'Loading print counts…' : `${summaryQuery.data?.printedPieces ?? printedCount} printed · ${pendingCount} pending · ${summaryQuery.data?.totalPieces ?? pieces.length} total`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={(printedCount > 0 && !canReprint) || createJob.isPending || allPieces.length === 0} title={printedCount > 0 && !canReprint ? 'Reprint permission required' : undefined} onClick={() => printedCount > 0 ? setWarningMode('all') : startJob('all')} data-testid="button-print-all-qr">
          <Printer size={14} /> Print all
        </Button>
        <Button type="button" size="sm" variant={selectionMode ? 'default' : 'outline'} onClick={() => { setSelectionMode((value) => !value); setSelectedIds([]); }} data-testid="button-pick-qr-pieces">
          {selectionMode ? 'Exit selection' : 'Pick and choose'}
        </Button>
        <Button type="button" size="sm" disabled={createJob.isPending || pendingCount === 0} title={pendingCount === 0 ? 'All pieces already have QR stickers' : undefined} onClick={() => startJob('pending')} data-testid="button-print-pending-qr">
          <Printer size={14} /> Pending QR codes ({pendingCount})
        </Button>
        {isMaster && <Button type="button" size="icon" variant="ghost" aria-label="Label settings" title="Label settings" onClick={() => setSettingsOpen(true)} data-testid="button-open-qr-settings"><Settings2 size={16} /></Button>}
      </div>
    </div>
    {summaryQuery.isError && <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2 text-xs text-amber-800"><span>Print counts are unavailable; piece status is shown from the register.</span><Button size="sm" variant="outline" onClick={() => void summaryQuery.refetch()}>Retry</Button></div>}
    {selectionMode && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background/60 px-3 py-2.5 sm:px-4">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" aria-label="Select all pieces" checked={visibleSelection.length === allPieces.filter((piece) => !inProgress[piece.id]).length && visibleSelection.length > 0} onChange={(event) => setSelectedIds(event.target.checked ? allPieces.filter((piece) => !inProgress[piece.id]).map((piece) => piece.id) : [])} data-testid="checkbox-select-all-qr" /> Select all pieces</label>
        <span className="font-mono text-muted-foreground">{visibleSelection.length} selected</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {isMaster && <Button size="sm" variant="outline" disabled={!visibleSelection.length || markPending.isPending} onClick={() => setPendingConfirm(true)} data-testid="button-mark-qr-pending">Mark as pending</Button>}
        <Button size="sm" disabled={!visibleSelection.length || createJob.isPending || (selectedPrinted && !canReprint)} title={selectedPrinted && !canReprint ? 'Reprint permission required for printed pieces' : undefined} onClick={() => selectedPrinted ? setWarningMode('selected') : startJob('selected')} data-testid="button-print-selected-qr">
          <Printer size={13} /> Print selected ({visibleSelection.length})
        </Button>
      </div>
    </div>}
    {pendingCount === 0 && <p className="border-b border-border/60 px-4 py-2 text-[11px] font-medium text-emerald-800" data-testid="text-all-qr-printed">All pieces already have QR stickers</p>}
    <div className="divide-y divide-border/60">
      {windows.map((window) => {
        const isOpen = expanded.includes(window.id);
        const ids = window.pieces.map((piece) => piece.id);
        const selectedInWindow = ids.filter((id) => selectedIds.includes(id)).length;
        return <div key={window.id} data-testid={`qr-window-group-${window.id}`}>
          <div className="flex min-w-0 items-center gap-2 px-3 py-2.5 sm:px-4">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen} onClick={() => setExpanded((current) => isOpen ? current.filter((id) => id !== window.id) : [...current, window.id])} data-testid={`button-expand-qr-window-${window.id}`}>
              {isOpen ? <ChevronDown size={15} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={15} className="shrink-0 text-muted-foreground" />}
              <span className="font-mono text-xs font-bold">{window.windowNo}</span>
              <span className="truncate text-[11px] text-muted-foreground">{window.windowType || 'Window'} · {window.pieces.length} pieces</span>
              {selectedInWindow > 0 && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-primary">{selectedInWindow} selected</span>}
            </button>
            {selectionMode && <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
              <input type="checkbox" aria-label={`Select all pieces in ${window.windowNo}`} checked={ids.filter((id) => !inProgress[id]).length > 0 && selectedInWindow === ids.filter((id) => !inProgress[id]).length} onChange={(event) => changeSelected(ids.filter((id) => !inProgress[id]), event.target.checked)} data-testid={`checkbox-select-window-${window.id}`} />
              Window
            </label>}
          </div>
          {isOpen && <div className="space-y-1 bg-background/55 px-3 pb-3 sm:px-4">
            {window.pieces.map((piece) => {
              const progressName = inProgress[piece.id];
              const checked = selectedIds.includes(piece.id);
              const badge = progressName
                ? <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-semibold text-blue-800">In progress by {progressName}</span>
                : piece.qrPrint?.status === 'printed'
                  ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-800">{piece.qrPrint.printCount > 0 ? `Printed (${piece.qrPrint.printCount} ${piece.qrPrint.printCount === 1 ? 'time' : 'times'})` : 'Printed (history unknown)'}</span>
                  : <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-800">Pending</span>;
              return <div key={piece.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-2 text-[11px]" data-testid={`row-qr-piece-${piece.id}`}>
                {selectionMode ? <input type="checkbox" aria-label={`Select ${piece.displayId}`} checked={checked} disabled={Boolean(progressName)} onChange={(event) => changeSelected([piece.id], event.target.checked)} data-testid={`checkbox-qr-piece-${piece.id}`} /> : <span className="w-4" />}
                <span className="min-w-0 flex-1 basis-32 truncate font-mono font-bold" data-testid={`text-qr-display-id-${piece.id}`}>{piece.displayId}</span>
                <span className="w-24 text-muted-foreground">{kindName(piece.kind)}</span>
                <span className={`w-fit rounded px-1.5 py-0.5 text-[9px] font-semibold ${piece.status === 'ready' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{piece.status === 'ready' ? 'Ready' : 'Pending'}</span>
                <span className="ml-6 flex basis-full flex-wrap items-center gap-x-2 gap-y-1 sm:ml-0 sm:basis-auto">{badge}
                  {piece.qrPrint?.status === 'printed' && piece.qrPrint.lastPrintedAt && <span className="text-[9px] text-muted-foreground" title={`First printed ${istStamp(piece.qrPrint.firstPrintedAt)} · Last printed ${istStamp(piece.qrPrint.lastPrintedAt)} by ${piece.qrPrint.lastPrintedBy || 'unknown'}`}>Last: {istStamp(piece.qrPrint.lastPrintedAt)}</span>}
                </span>
              </div>;
            })}
            {window.pieces.length === 0 && <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">No pieces recorded for this window.</p>}
          </div>}
        </div>;
      })}
    </div>
    {createJob.isPending && <div className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">Preparing print job…</div>}
    {warningMode && <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/45 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="qr-reprint-warning-title">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-2xl">
        <div className="flex gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><ShieldAlert size={18} /></div><div><h2 id="qr-reprint-warning-title" className="font-display text-base font-bold">Reprint existing stickers?</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">{warningMode === 'all' ? printedCount : selectedIds.filter((id) => pieceById.get(id)?.qrPrint?.status === 'printed').length} pieces already have stickers. This print run will reprint them.</p></div></div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setWarningMode(null)} data-testid="button-cancel-qr-reprint">Cancel</Button><Button disabled={createJob.isPending} onClick={() => { const mode = warningMode; setWarningMode(null); startJob(mode); }} data-testid="button-confirm-qr-reprint">Continue to print</Button></div>
      </div>
    </div>}
    {pendingConfirm && <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/45 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="mark-pending-title">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-2xl"><h2 id="mark-pending-title" className="font-display text-base font-bold">Mark selected pieces as pending?</h2><p className="mt-2 text-sm text-muted-foreground">This resets QR print state for {visibleSelection.length} selected piece{visibleSelection.length === 1 ? '' : 's'}. Use this only when stickers were not actually printed.</p><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setPendingConfirm(false)}>Cancel</Button><Button disabled={markPending.isPending} onClick={markSelectedPending}>{markPending.isPending ? 'Updating…' : 'Mark pending'}</Button></div></div>
    </div>}
    {settingsOpen && <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="qr-settings-title">
      <div className="max-h-[94dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-border bg-background p-4 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary">Master Admin · printer setup</p><h2 id="qr-settings-title" className="mt-1 font-display text-lg font-bold">Label settings</h2><p className="mt-1 text-xs text-muted-foreground">Saved dimensions are applied to every sticker in a print job.</p></div><Button size="icon" variant="ghost" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={16} /></Button></div>
        {settingsQuery.data?.defaultsUnconfirmed && <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-900"><ShieldAlert size={15} className="mt-0.5 shrink-0" />Size not confirmed with the label supplier</p>}
        {settingsQuery.isLoading ? <div className="mt-5 h-40 animate-pulse rounded-xl bg-muted/60" /> : settingsQuery.isError ? <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">Saved sticker settings could not be loaded. <Button variant="outline" size="sm" onClick={() => void settingsQuery.refetch()}>Retry</Button></div> : <div className="mt-4 grid gap-5 md:grid-cols-[1fr_260px]">
          <div className="grid content-start grid-cols-2 gap-3">
            <SettingField label="Width (mm)" min={20} max={150} value={settingsDraft.widthMm} onChange={(value) => setSettingsDraft((current) => ({ ...current, widthMm: value }))} />
            <SettingField label="Height (mm)" min={15} max={150} value={settingsDraft.heightMm} onChange={(value) => setSettingsDraft((current) => ({ ...current, heightMm: value }))} />
            <label className="col-span-2 space-y-1 text-xs font-medium">Orientation<select value={settingsDraft.orientation} onChange={(event) => setSettingsDraft((current) => ({ ...current, orientation: event.target.value as QrStickerSettingsInput['orientation'] }))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
            <SettingField label="Inner margin (mm)" min={0} max={20} value={settingsDraft.marginMm} onChange={(value) => setSettingsDraft((current) => ({ ...current, marginMm: value }))} />
            <SettingField label="QR size (mm)" min={10} max={100} value={settingsDraft.qrSizeMm} onChange={(value) => setSettingsDraft((current) => ({ ...current, qrSizeMm: value }))} />
            <SettingField label="Display ID font (pt)" min={4} max={24} value={settingsDraft.fontSizeLine1Pt} onChange={(value) => setSettingsDraft((current) => ({ ...current, fontSizeLine1Pt: value }))} />
            <SettingField label="Client font (pt)" min={4} max={24} value={settingsDraft.fontSizeLine2Pt} onChange={(value) => setSettingsDraft((current) => ({ ...current, fontSizeLine2Pt: value }))} />
            <SettingField label="Client max lines" min={1} max={5} value={settingsDraft.nameMaxLines} onChange={(value) => setSettingsDraft((current) => ({ ...current, nameMaxLines: value }))} />
          </div>
          <div className="rounded-xl border border-border bg-muted/25 p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Live label preview</p>
            <div className="mx-auto flex min-h-36 w-full max-w-[230px] flex-col items-center justify-center overflow-hidden border border-dashed border-border bg-white p-2 text-black shadow-sm" style={{ aspectRatio: `${settingsDraft.widthMm} / ${settingsDraft.heightMm}` }}>
              <QRCodeCanvas value={testPiece.payload} size={Math.min(92, Math.max(40, settingsDraft.qrSizeMm * 3.1))} level="M" includeMargin />
              <p className="max-w-full truncate text-center font-bold" style={{ fontSize: `${Math.min(16, settingsDraft.fontSizeLine1Pt * 1.1)}px` }}>{testPiece.displayId}</p>
              <p className="line-clamp-2 max-w-full text-center leading-tight" style={{ fontSize: `${Math.min(13, settingsDraft.fontSizeLine2Pt * 1.15)}px` }}>{testPiece.clientName}</p>
            </div>
            <Button type="button" variant="outline" className="mt-3 w-full" disabled={testPrint} onClick={() => { setRenderedCount(0); setTestPrint(true); }} data-testid="button-print-test-qr"><Printer size={13} /> Print test sticker</Button>
            <p className="mt-3 text-[10px] leading-4 text-muted-foreground">In the print dialog, choose the TSC TE 210 driver, set paper size to the label size, set Margins to None, uncheck Headers and footers, and use Scale 100%.</p>
          </div>
        </div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4"><Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button><Button disabled={updateSettings.isPending || settingsQuery.isLoading} onClick={saveSettings} data-testid="button-save-qr-settings">{updateSettings.isPending ? 'Saving…' : 'Save settings'}</Button></div>
      </div>
    </div>}
    {jobToPrint && <div className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-xl rounded-xl border border-border bg-background p-3 shadow-xl" aria-live="polite" data-testid="qr-render-progress"><div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold">Preparing stickers</span><span className="font-mono text-muted-foreground">{Math.min(renderedCount, jobToPrint.pieces.length)} / {jobToPrint.pieces.length}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${jobToPrint.pieces.length ? Math.min(100, renderedCount * 100 / jobToPrint.pieces.length) : 0}%` }} /></div>{jobToPrint.pieces.length > 200 && <p className="mt-2 text-[10px] text-amber-800">Large print run: browser preparation may take a short while. Keep this tab open until confirmation.</p>}</div>}
    {(jobToPrint || testPrint) && <StickerPrintDocument
      rootId={testPrint ? 'qr-sticker-test-print-root' : 'qr-sticker-job-print-root'}
      pieces={testPrint ? [testPiece] : (jobToPrint?.pieces.slice(0, renderedCount) ?? [])}
      settings={testPrint ? settingsDraft : jobToPrint!.settings}
    />}
    {confirmOpen && jobToPrint && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="qr-print-confirm-title">
      <div className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-2xl">
        <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Print job · {jobToPrint.pieces.length} labels</p><h2 id="qr-print-confirm-title" className="mt-1 font-display text-lg font-bold">Did the stickers print correctly?</h2><p className="mt-1 text-sm text-muted-foreground">The job remains pending until you record which labels came out successfully.</p><p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">In the print dialog: Margins = None, uncheck Headers and footers, Scale = 100%, Paper size = label size.</p>
        <div className="mt-4 flex flex-wrap gap-2"><Button disabled={confirmJob.isPending || cancelJob.isPending} onClick={() => closeConfirmation(false, jobToPrint.pieces.map((piece) => piece.pieceId))} data-testid="button-qr-confirm-all"><Check size={14} /> Yes, mark {jobToPrint.pieces.length} pieces as printed</Button><Button variant="outline" disabled={confirmJob.isPending || cancelJob.isPending} onClick={() => { setPrintedIds([]); setPartialConfirm(true); }} data-testid="button-qr-some-failed">Some failed</Button><Button variant="ghost" disabled={confirmJob.isPending || cancelJob.isPending} onClick={() => closeConfirmation(true, [])} data-testid="button-qr-cancel-job">No, keep pending</Button></div>
        {partialConfirm && <p className="mt-3 text-xs text-muted-foreground">Select only the stickers that printed successfully, then confirm below.</p>}
        <div className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
          {jobToPrint.pieces.map((piece) => <label key={piece.pieceId} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/40"><input type="checkbox" checked={printedIds.includes(piece.pieceId)} onChange={(event) => setPrintedIds((current) => event.target.checked ? [...new Set([...current, piece.pieceId])] : current.filter((id) => id !== piece.pieceId))} data-testid={`checkbox-confirm-printed-${piece.pieceId}`} /><span className="font-mono font-bold">{piece.displayId}</span><span className="truncate text-muted-foreground">{piece.clientName}</span></label>)}
        </div>
        {partialConfirm && <div className="mt-4 flex justify-end"><Button disabled={confirmJob.isPending || cancelJob.isPending || printedIds.length === 0} onClick={() => closeConfirmation(false, printedIds)} data-testid="button-confirm-selected-qr">{confirmJob.isPending ? 'Saving…' : `Mark ${printedIds.length} printed`}</Button></div>}
      </div>
    </div>}
  </section>;
}

function SettingField({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: number; onChange: (value: number) => void }) {
  return <label className="space-y-1 text-xs font-medium">{label}<input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" /></label>;
}
