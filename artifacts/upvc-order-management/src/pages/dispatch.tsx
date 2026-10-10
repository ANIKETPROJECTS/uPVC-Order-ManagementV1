import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { QRCodeCanvas } from 'qrcode.react';
import {
  ArrowDownUp,
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  Grid2X2,
  GitBranch,
  List,
  MapPin,
  PackageCheck,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  X,
} from 'lucide-react';
import {
  DispatchStatus,
  getListDispatchOrdersQueryKey,
  getListInstallationOrdersQueryKey,
  useListDispatchOrders,
  useUpdateDispatchOrderPlan,
  useUpdateDispatchOrderStatus,
} from '@workspace/api-client-react';
import type { DispatchOrder, DispatchPlanItem, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getDispatchScanUrl } from '@/lib/order-qr';
import { useToast } from '@/hooks/use-toast';

type StatusValue = (typeof DispatchStatus)[keyof typeof DispatchStatus];
type SortValue = 'updated-desc' | 'updated-asc' | 'order-id' | 'client';
type ViewMode = 'list' | 'grid' | 'tree';

const STATUS_OPTIONS: { value: StatusValue; label: string; tone: string; dot: string }[] = [
  { value: DispatchStatus.pending_dispatch, label: 'Pending Dispatch', tone: 'bg-amber-100 text-amber-900 ring-amber-200', dot: 'bg-amber-500' },
  { value: DispatchStatus.dispatched, label: 'Dispatched', tone: 'bg-teal-100 text-teal-900 ring-teal-200', dot: 'bg-teal-600' },
  { value: DispatchStatus.delivered, label: 'Installed', tone: 'bg-emerald-100 text-emerald-900 ring-emerald-200', dot: 'bg-emerald-600' },
];

const DISPATCH_REGISTER_COLUMNS = 'lg:grid-cols-[minmax(130px,1.25fr)_minmax(85px,.85fr)_minmax(130px,1.05fr)_minmax(95px,.9fr)_minmax(132px,1.1fr)_minmax(130px,1fr)]';

const ORDER_STATUS_LABELS: Record<string, string> = {
  quotation_stage: 'Quotation stage',
  confirmed: 'Confirmed',
  in_production: 'In production',
  ready: 'Ready',
  dispatched: 'Dispatched',
  installed: 'Installed',
};

function dispatchLabel(status: string) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label || status.replaceAll('_', ' ');
}

function dispatchTrackingId(order: DispatchOrder, lotId: string | null, code: string) {
  if (!lotId) return `${order.orderId}-${code}`;
  const sequence = order.lots.find((lot) => lot.lotId === lotId)?.sequence ?? Number(lotId.match(/-L0*(\d+)$/i)?.[1]);
  return sequence ? `${order.orderId}-L${sequence}-${code}` : `${lotId}-${code}`;
}

function orderTone(status: string) {
  const tones: Record<string, string> = {
    quotation_stage: 'bg-stone-100 text-stone-700',
    confirmed: 'bg-sky-100 text-sky-800',
    in_production: 'bg-orange-100 text-orange-900',
    ready: 'bg-lime-100 text-lime-900',
    dispatched: 'bg-violet-100 text-violet-800',
    installed: 'bg-emerald-100 text-emerald-900',
  };
  return tones[status] || 'bg-muted text-muted-foreground';
}

function formatUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Update time unavailable';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function SkeletonRows({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === 'grid') {
    return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading dispatch orders" data-testid="state-dispatch-loading">
      {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="h-56 animate-pulse rounded-xl border border-border/70 bg-card p-4">
        <div className="flex justify-between"><div className="h-4 w-28 rounded bg-muted" /><div className="h-6 w-24 rounded-full bg-muted/70" /></div>
        <div className="mt-5 h-3 w-36 rounded bg-muted/70" /><div className="mt-2 h-3 w-24 rounded bg-muted/60" />
        <div className="mt-6 h-8 w-32 rounded-lg bg-muted/70" /><div className="mt-3 h-3 w-28 rounded bg-muted/60" />
        <div className="mt-6 flex gap-2"><div className="h-8 w-12 rounded-lg bg-muted/70" /><div className="h-8 w-20 rounded-lg bg-muted/70" /></div>
      </div>)}
    </div>;
  }
  return <div className="space-y-2" aria-label="Loading dispatch orders" data-testid="state-dispatch-loading">
    {[0, 1, 2, 3].map((item) => <div key={item} className={`grid animate-pulse grid-cols-1 gap-3 rounded-xl border border-border/70 bg-card px-3.5 py-3 lg:items-center lg:gap-2.5 lg:px-4 ${DISPATCH_REGISTER_COLUMNS}`}>
      <div className="space-y-2"><div className="h-4 w-28 rounded bg-muted" /><div className="h-3 w-36 rounded bg-muted/70" /></div>
      <div className="h-4 w-24 rounded bg-muted/70" /><div className="h-6 w-24 rounded-full bg-muted/70" /><div className="h-4 w-24 rounded bg-muted/60" /><div className="h-3 w-28 rounded bg-muted/60" /><div className="flex gap-1.5"><div className="h-8 w-11 rounded-lg bg-muted/70" /><div className="h-8 w-16 rounded-lg bg-muted/70" /></div>
    </div>)}
  </div>;
}

function StatusPill({ status }: { status: string }) {
  const option = STATUS_OPTIONS.find((item) => item.value === status);
  return <span className={`inline-flex w-fit items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${option?.tone || 'bg-muted text-muted-foreground ring-border'}`} data-testid={`status-dispatch-${status}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${option?.dot || 'bg-muted-foreground'}`} />{dispatchLabel(status)}
  </span>;
}

function DispatchGridCard({ order, canViewOrderHub, canEdit, busy, onShowQr, onUpdate }: {
  order: DispatchOrder;
  canViewOrderHub: boolean;
  canEdit: boolean;
  busy: boolean;
  onShowQr: () => void;
  onUpdate: () => void;
}) {
  return <article className="group flex min-h-56 flex-col rounded-xl border border-border/75 bg-background p-4 transition duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-primary/[.018] hover:shadow-md" data-testid={`card-dispatch-order-${order.id}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {canViewOrderHub
          ? <Link href={`/order-status/${encodeURIComponent(order.id)}`} className="break-all font-mono text-sm font-bold tracking-tight text-primary underline-offset-4 hover:underline" data-testid={`link-order-status-${order.id}`}>{order.orderId}</Link>
          : <span className="break-all font-mono text-sm font-bold tracking-tight text-foreground" data-testid={`order-id-${order.id}`}>{order.orderId}</span>}
        <p className="mt-1 truncate text-xs font-semibold text-foreground">{order.clientName}</p>
      </div>
      <StatusPill status={order.dispatchStatus} />
    </div>
    <div className="mt-4 flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><MapPin size={14} className="shrink-0 text-primary/70" /><span className="truncate">{order.locationName}</span></div>
    <div className="mt-4 rounded-lg border border-border/60 bg-muted/25 p-3">
      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Order lifecycle</p>
      <span className={`mt-2 inline-flex w-fit rounded-md px-2 py-1 text-[10px] font-semibold ${orderTone(order.orderStatus)}`} data-testid={`status-order-${order.id}`}>{ORDER_STATUS_LABELS[order.orderStatus] || order.orderStatus.replaceAll('_', ' ')}</span>
    </div>
    <div className="mt-3 text-[10px] text-muted-foreground"><span className="font-bold uppercase tracking-wider">Updated</span><span className="ml-2" title={formatUpdated(order.updatedAt)}>{formatUpdated(order.updatedAt)}</span></div>
    <div className="mt-auto flex items-center justify-end gap-1.5 border-t border-border/60 pt-4">
      <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-[10px]" onClick={onShowQr} aria-label={`Show QR for ${order.orderId}`} data-testid={`button-show-qr-${order.id}`}><QrCode size={13} /><span className="hidden sm:inline">QR</span></Button>
      <Button type="button" size="sm" className="h-8 px-2 text-[10px]" disabled={!canEdit || busy} onClick={onUpdate} title={canEdit ? 'Manage lots, windows, and dispatches' : 'View-only access'} data-testid={`button-change-status-${order.id}`}>{canEdit ? 'Update' : 'View'}<ArrowRight size={12} /></Button>
    </div>
  </article>;
}

function StatusDialog({ order, canEdit, busy, error, onClose, onSave }: {
  order: DispatchOrder | null;
  canEdit: boolean;
  busy: boolean;
  error: boolean;
  onClose: () => void;
  onSave: (id: string, status: StatusValue) => void;
}) {
  const [nextStatus, setNextStatus] = useState<StatusValue>(DispatchStatus.pending_dispatch);
  useEffect(() => {
    if (order) setNextStatus(order.dispatchStatus);
  }, [order]);
  const isOpen = Boolean(order);
  const changed = Boolean(order && (nextStatus !== order.dispatchStatus || order.dispatches.some((dispatch) => dispatch.dispatchStatus !== nextStatus)));
  return <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Truck size={19} /></div>
        <DialogTitle>Update all dispatch statuses</DialogTitle>
        <DialogDescription>{order ? `Set one status for every dispatch under ${order.orderId}. Production status is not changed.` : 'Choose a dispatch state.'}</DialogDescription>
      </DialogHeader>
      {order && <div className="space-y-4">
        <div className="rounded-xl border border-border/80 bg-muted/30 p-3">
          <div className="font-mono text-sm font-bold tracking-tight">{order.orderId}</div>
          <div className="mt-1 text-xs text-muted-foreground">{order.clientName} <span className="px-1">·</span> {order.locationName}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill status={order.dispatchStatus} /><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Overall status</span></div>
          <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Dispatches updated together</p>
            {order.dispatches.length ? order.dispatches.map((dispatch) => <div key={dispatch.id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-mono font-semibold">{dispatch.trackingId}</span><span className="text-muted-foreground">{dispatch.windowIds.length} windows · {dispatchLabel(dispatch.dispatchStatus)}</span></div>) : <p className="text-xs text-muted-foreground">No dispatch plan has been saved yet.</p>}
          </div>
        </div>
        {!canEdit ? <div className="flex gap-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-950"><ShieldCheck size={16} className="mt-0.5 shrink-0" /><span>Your dispatch access is view-only. Ask an administrator for edit permission to make changes.</span></div> : <>
          <label className="block space-y-1.5 text-xs font-semibold text-foreground" htmlFor="dispatch-status-select">
            New status for every dispatch
            <select id="dispatch-status-select" value={nextStatus} onChange={(event) => setNextStatus(event.target.value as StatusValue)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-medium shadow-sm" data-testid="select-dispatch-status">
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {error && <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive"><CircleAlert size={15} className="mt-0.5 shrink-0" />Status could not be saved. Refresh and try again.</p>}
        </>}
      </div>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} data-testid="button-close-dispatch-dialog">Cancel</Button>
        {canEdit && order && <Button type="button" disabled={!changed || busy} onClick={() => onSave(order.id, nextStatus)} data-testid="button-save-dispatch-status">
          {busy ? 'Saving…' : <><Check size={15} /> Save status</>}
        </Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function DispatchPlanDialog({ order, canEdit, busy, error, onClose, onSave }: {
  order: DispatchOrder | null;
  canEdit: boolean;
  busy: boolean;
  error: boolean;
  onClose: () => void;
  onSave: (order: DispatchOrder, dispatches: DispatchPlanItem[]) => void;
}) {
  const [draft, setDraft] = useState<DispatchPlanItem[]>([]);
  const [localError, setLocalError] = useState('');
  useEffect(() => {
    if (!order) { setDraft([]); setLocalError(''); return; }
    setDraft(order.dispatches.length
      ? order.dispatches.map((dispatch) => ({ id: dispatch.id, code: dispatch.code, lotId: dispatch.lotId, windowIds: [...dispatch.windowIds], dispatchStatus: dispatch.dispatchStatus }))
      : [{ code: 'D1', lotId: order.lots[0]?.lotId ?? null, windowIds: [], dispatchStatus: order.dispatchStatus }]);
    setLocalError('');
  }, [order]);
  const batches = useMemo(() => {
    const grouped = new Map<string, { code: string; rows: { dispatch: DispatchPlanItem; index: number }[] }>();
    draft.forEach((dispatch, index) => {
      const code = dispatch.code.toUpperCase();
      const batch = grouped.get(code) ?? { code, rows: [] };
      batch.rows.push({ dispatch, index });
      grouped.set(code, batch);
    });
    return [...grouped.values()].sort((a, b) => Number(a.code.slice(1)) - Number(b.code.slice(1)));
  }, [draft]);
  const assignedElsewhere = (index: number) => new Set(draft.flatMap((dispatch, other) => other === index ? [] : dispatch.windowIds));
  const update = (index: number, patch: Partial<DispatchPlanItem>) => setDraft((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const addDispatch = () => {
    if (!order) return;
    const lotId = order.lots[0]?.lotId ?? null;
    const used = draft.map((item) => Number(item.code.slice(1)) || 0);
    const next = Math.max(0, ...used) + 1;
    setDraft((rows) => [...rows, { code: `D${next}`, lotId, windowIds: [], dispatchStatus: DispatchStatus.pending_dispatch }]);
  };
  const addLotToBatch = (code: string) => {
    if (!order) return;
    const includedLots = new Set(draft.filter((item) => item.code.toUpperCase() === code).map((item) => item.lotId));
    const lot = order.lots.find((candidate) => !includedLots.has(candidate.lotId));
    if (!lot) { setLocalError('Every lot is already included in this dispatch batch.'); return; }
    setDraft((rows) => [...rows, { code, lotId: lot.lotId, windowIds: [], dispatchStatus: DispatchStatus.pending_dispatch }]);
    setLocalError('');
  };
  const updateBatchCode = (oldCode: string, newCode: string) => {
    setDraft((rows) => rows.map((row) => row.code.toUpperCase() === oldCode ? { ...row, code: newCode.toUpperCase() } : row));
  };
  const invalid = draft.some((dispatch) => !/^D[1-9]\d*$/.test(dispatch.code) || dispatch.windowIds.length === 0)
    || draft.some((dispatch, index) => draft.slice(0, index).some((other) => other.lotId === dispatch.lotId && other.code.toUpperCase() === dispatch.code.toUpperCase()));
  const save = () => {
    if (!order) return;
    if (invalid) { setLocalError('Use a valid D-number, include each lot only once per batch, and assign at least one ready window to each lot.'); return; }
    setLocalError('');
    onSave(order, draft);
  };
  return <Dialog open={Boolean(order)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="w-[min(96vw,78rem)] max-w-6xl max-h-[92dvh] overflow-y-auto">
      <DialogHeader>
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Truck size={19} /></div>
        <DialogTitle>Manage dispatches</DialogTitle>
        <DialogDescription>{order ? `${order.orderId} · ${order.clientName}. Each D-number is a dispatch batch; add multiple lots and manage each lot’s windows and status independently.` : 'Manage order dispatches.'}</DialogDescription>
      </DialogHeader>
      {order && <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-muted/25 p-3">
          <div><p className="font-mono text-sm font-bold">{order.orderId}</p><p className="mt-1 text-xs text-muted-foreground">{order.locationName} · {order.windows.filter((window) => window.ready).length} ready windows</p></div>
          <Button type="button" size="sm" onClick={addDispatch}><Truck size={14} /> Add dispatch batch</Button>
        </div>
        {draft.length === 0 && <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">No dispatch batches. Add one to plan a delivery handoff.</div>}
        <div className="space-y-3">
          {batches.map((batch) => {
            const batchLocked = batch.rows.some(({ dispatch }) => dispatch.dispatchStatus !== DispatchStatus.pending_dispatch);
            return <section key={batch.code} className="rounded-xl border border-border/80 bg-background p-4" data-testid={`dispatch-batch-${batch.code}`}>
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 pb-3">
                <label className="w-40 space-y-1.5 text-xs font-semibold">Dispatch batch / D-number<input value={batch.code} disabled={!canEdit || batchLocked} onChange={(event) => updateBatchCode(batch.code, event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm" placeholder="D1" /></label>
                <p className="pb-2 text-xs text-muted-foreground">{batch.rows.length} lot{batch.rows.length === 1 ? '' : 's'} · each lot keeps its own status</p>
                {order.lots.length > batch.rows.length && <Button type="button" size="sm" variant="outline" disabled={!canEdit || batchLocked} onClick={() => addLotToBatch(batch.code)}>+ Add lot to {batch.code}</Button>}
              </div>
              <div className="mt-3 space-y-3">
                {batch.rows.map(({ dispatch, index }) => {
                  const unavailable = assignedElsewhere(index);
                  const choices = order.windows.filter((window) => window.ready && (!unavailable.has(window.id) || dispatch.windowIds.includes(window.id)));
                  const tracking = dispatchTrackingId(order, dispatch.lotId, batch.code);
                  const assignmentLocked = dispatch.dispatchStatus !== DispatchStatus.pending_dispatch;
                  return <div key={dispatch.id ?? `new-${batch.code}-${index}`} className="rounded-lg border border-border/65 bg-muted/15 p-3" data-testid={`dispatch-plan-item-${index}`}>
                    <div className="grid gap-3 md:grid-cols-[minmax(145px,1fr)_minmax(170px,1fr)_auto] md:items-end">
                      <label className="space-y-1.5 text-xs font-semibold">Lot<select value={dispatch.lotId ?? ''} disabled={!canEdit || assignmentLocked || order.lots.length === 0} onChange={(event) => update(index, { lotId: event.target.value || null })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                        {order.lots.length ? order.lots.map((lot) => <option key={lot.lotId} value={lot.lotId}>Lot L{lot.sequence}</option>) : <option value="">Order dispatch</option>}
                      </select></label>
                      <label className="space-y-1.5 text-xs font-semibold">This lot’s status<select value={dispatch.dispatchStatus} disabled={!canEdit} onChange={(event) => update(index, { dispatchStatus: event.target.value as StatusValue })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                        {STATUS_OPTIONS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                      </select></label>
                      <Button type="button" variant="outline" className="text-destructive" disabled={!canEdit || assignmentLocked} title={assignmentLocked ? 'Shipped lot records cannot be removed' : 'Remove pending lot from this batch'} onClick={() => setDraft((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}><X size={14} /> Remove lot</Button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3"><p className="font-mono text-xs font-bold text-primary">{tracking}</p><p className="text-[11px] text-muted-foreground">{dispatch.windowIds.length} selected · {choices.length} ready and available</p></div>
                    {choices.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {choices.map((window) => <label key={window.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs hover:bg-muted/40">
                        <input type="checkbox" disabled={!canEdit || assignmentLocked} checked={dispatch.windowIds.includes(window.id)} onChange={(event) => update(index, { windowIds: event.target.checked ? [...dispatch.windowIds, window.id] : dispatch.windowIds.filter((id) => id !== window.id) })} />
                        <span className="font-semibold">{window.windowNo}</span><span className="text-muted-foreground">{window.widthMm} × {window.heightMm} mm</span>
                      </label>)}
                    </div> : <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">No unassigned windows are ready. A window is ready when frame and shutter are ready and glass is received.</p>}
                  </div>;
                })}
              </div>
            </section>;
          })}
        </div>
        {(localError || error) && <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive"><CircleAlert size={15} className="mt-0.5 shrink-0" />{localError || 'Dispatches could not be saved. Refresh and try again.'}</p>}
      </div>}
      <DialogFooter className="sticky bottom-0 bg-background py-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        {canEdit && order && <Button type="button" disabled={busy} onClick={save} data-testid="button-save-dispatch-plan">{busy ? 'Saving…' : <><Check size={15} /> Save dispatch plan</>}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function DispatchPage({ user }: { user: User }) {
  const canView = user.roleId === 'master-admin'
    || user.permissions?.dispatch === 'view'
    || user.permissions?.dispatch === 'edit';
  const canEdit = user.roleId === 'master-admin' || user.permissions?.dispatch === 'edit';
  const canViewOrderHub = user.roleId === 'master-admin'
    || user.permissions?.['order-hub'] === 'view'
    || user.permissions?.['order-hub'] === 'edit';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const ordersQuery = useListDispatchOrders({
    query: { queryKey: getListDispatchOrdersQueryKey(), enabled: canView },
  });
  const updateStatus = useUpdateDispatchOrderStatus();
  const updatePlan = useUpdateDispatchOrderPlan();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState<SortValue>('updated-desc');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeOrder, setActiveOrder] = useState<DispatchOrder | null>(null);
  const [bulkOrder, setBulkOrder] = useState<DispatchOrder | null>(null);
  const [qrOrder, setQrOrder] = useState<DispatchOrder | null>(null);
  const handledScanRef = useRef<string | null>(null);

  const orders = ordersQuery.data || [];
  useEffect(() => {
    const recordId = new URLSearchParams(window.location.search).get('scanOrderId');
    if (!canView || !recordId || !ordersQuery.data || ordersQuery.isLoading || handledScanRef.current === recordId) return;
    handledScanRef.current = recordId;
    const match = ordersQuery.data.find((order) => order.id === recordId);
    if (match) {
      setBulkOrder(match);
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
    } else {
      toast({ title: 'Order not found in dispatch', description: 'This QR code did not match a live dispatch record.' });
    }
  }, [canView, ordersQuery.data, ordersQuery.isLoading, toast]);

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const filtered = orders.filter((order) => {
      const matchesSearch = !needle || [order.orderId, order.clientName, order.locationName].some((value) => value.toLocaleLowerCase().includes(needle));
      return matchesSearch && (statusFilter === 'all' || order.dispatchStatus === statusFilter);
    });
    return filtered.sort((a, b) => {
      if (sort === 'updated-asc') return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      if (sort === 'order-id') return a.orderId.localeCompare(b.orderId, undefined, { numeric: true, sensitivity: 'base' });
      if (sort === 'client') return a.clientName.localeCompare(b.clientName, undefined, { sensitivity: 'base' });
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [orders, search, statusFilter, sort]);

  const countByStatus = (status: StatusValue) => orders.filter((order) => order.dispatchStatus === status).length;
  const saveStatus = (id: string, dispatchStatus: StatusValue) => {
    if (!canEdit) return;
    updateStatus.mutate({ id, data: { dispatchStatus } }, {
      onSuccess: (updated) => {
        queryClient.setQueryData<DispatchOrder[]>(getListDispatchOrdersQueryKey(), (current) => current?.map((order) => order.id === updated.id ? updated : order));
        void queryClient.invalidateQueries({ queryKey: getListDispatchOrdersQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListInstallationOrdersQueryKey() });
        toast({ title: 'Dispatch status updated', description: `${updated.orderId} · ${dispatchLabel(updated.dispatchStatus)}` });
        setBulkOrder(null);
      },
    });
  };
  const savePlan = (order: DispatchOrder, dispatches: DispatchPlanItem[]) => {
    if (!canEdit) return;
    updatePlan.mutate({ id: order.id, data: { expectedRevision: order.dispatchPlanRevision, dispatches } }, {
      onSuccess: (updated) => {
        queryClient.setQueryData<DispatchOrder[]>(getListDispatchOrdersQueryKey(), (current) => current?.map((item) => item.id === updated.id ? updated : item));
        void queryClient.invalidateQueries({ queryKey: getListDispatchOrdersQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListInstallationOrdersQueryKey() });
        toast({ title: 'Dispatch plan saved', description: `${updated.orderId} · ${updated.dispatches.length} dispatch(es)` });
        setActiveOrder(null);
      },
      onError: () => toast({ title: 'Dispatch plan could not be saved', description: 'Refresh the dispatch register and try again.', variant: 'destructive' }),
    });
  };
  const clearFilters = () => { setSearch(''); setStatusFilter('all'); };

  return <AppShell user={user} title="Dispatch" eyebrow="Module · delivery handoff">
    <div className="mx-auto w-full max-w-[1440px] space-y-5 pb-8">
      <section className="order-hub-accent relative overflow-hidden rounded-2xl border border-primary/10 px-5 py-5 shadow-sm md:px-7 md:py-6">
        <div className="absolute -right-9 -top-16 h-56 w-56 rounded-full border border-primary/15" />
        <div className="absolute right-10 top-5 hidden h-24 w-24 rotate-12 rounded-2xl border border-accent/30 bg-white/10 md:block" />
        <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Framewise operations <span className="text-muted-foreground/70">/</span> dispatch desk</div>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.05em] text-foreground md:text-[2.65rem]">Every handoff, accounted for.</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Find live orders quickly, confirm their delivery state, and keep dispatch separate from the production lifecycle.</p>
          </div>
          {canView && <Link href="/order-scanner?flow=dispatch" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" data-testid="link-dispatch-scanner">
            <QrCode size={15} /> Scan order QR <ArrowRight size={14} className="opacity-70" />
          </Link>}
        </div>
      </section>

      <section aria-label="Dispatch totals" className="grid grid-cols-3 gap-2 sm:gap-3">
        {STATUS_OPTIONS.map((option, index) => {
          const Icon = index === 0 ? Clock3 : index === 1 ? Truck : PackageCheck;
          return <button type="button" key={option.value} onClick={() => setStatusFilter(statusFilter === option.value ? 'all' : option.value)} className={`group rounded-xl border bg-card px-3 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md sm:px-4 sm:py-4 ${statusFilter === option.value ? 'border-primary/40 ring-2 ring-primary/10' : 'border-border/80'}`} data-testid={`filter-dispatch-${option.value}`}>
            <div className="flex items-center justify-between gap-2"><span className="truncate text-[9px] font-bold uppercase tracking-[0.11em] text-muted-foreground sm:text-[10px]">{option.label}</span><Icon size={15} className="shrink-0 text-primary/75" /></div>
            <div className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl" data-testid={`metric-dispatch-${option.value}`}>{ordersQuery.isLoading ? '—' : countByStatus(option.value)}</div>
            <div className="mt-1 hidden text-[10px] text-muted-foreground sm:block">{statusFilter === option.value ? 'Showing this stage' : 'Live records'}</div>
          </button>;
        })}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
        <div className="border-b border-border/75 p-4 md:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><div className="flex items-center gap-2"><span className="h-5 w-1 rounded-full bg-primary" /><h2 className="font-display text-lg font-bold tracking-tight">Dispatch register</h2><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground" data-testid="text-dispatch-count">{filteredOrders.length} / {orders.length}</span></div><p className="ml-3 mt-1 text-xs text-muted-foreground">Search by order, client, or delivery location.</p></div>
            {!canEdit && <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-900"><ShieldCheck size={13} /> View-only access</span>}
          </div>
          <div className="mt-4 flex flex-col gap-2 lg:flex-row">
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(180px,1fr)_minmax(150px,.75fr)_minmax(150px,.75fr)]">
              <label className="relative block">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an order…" aria-label="Search by order, client, or location" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10" data-testid="input-dispatch-search" />
              </label>
              <label className="relative">
                <span className="sr-only">Filter dispatch status</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-8 text-xs font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" data-testid="select-dispatch-filter">
                  <option value="all">All dispatch statuses</option>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <ArrowDownUp size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </label>
              <label className="relative">
                <span className="sr-only">Sort dispatch orders</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as SortValue)} className="h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-8 text-xs font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" data-testid="select-dispatch-sort">
                  <option value="updated-desc">Recently updated</option><option value="updated-asc">Oldest update</option><option value="order-id">Order ID</option><option value="client">Client name</option>
                </select>
                <ArrowDownUp size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </label>
            </div>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-background p-1" role="group" aria-label="Dispatch register view">
                <Button type="button" variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setViewMode('list')} aria-label="List view" aria-pressed={viewMode === 'list'} title="List view" data-testid="button-dispatch-list-view"><List size={15} /></Button>
                <Button type="button" variant={viewMode === 'grid' ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setViewMode('grid')} aria-label="Grid view" aria-pressed={viewMode === 'grid'} title="Grid view" data-testid="button-dispatch-grid-view"><Grid2X2 size={15} /></Button>
                <Button type="button" variant={viewMode === 'tree' ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setViewMode('tree')} aria-label="Dispatch tree view" aria-pressed={viewMode === 'tree'} title="Dispatch tree" data-testid="button-dispatch-tree-view"><GitBranch size={15} /></Button>
              </div>
              {(search || statusFilter !== 'all') && <Button type="button" variant="ghost" size="sm" className="h-10 text-xs" onClick={clearFilters} data-testid="button-clear-dispatch-filters"><X size={14} /> Clear</Button>}
            </div>
          </div>
        </div>

        {viewMode === 'list' && <div className={`mx-2 hidden gap-3 rounded-xl border border-transparent bg-muted/45 px-3.5 py-2.5 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground sm:mx-3 lg:grid lg:items-center lg:gap-2.5 lg:px-4 ${DISPATCH_REGISTER_COLUMNS}`}>
          <span>Order / client</span><span>Delivery location</span><span>Dispatch status</span><span>Order lifecycle</span><span>Updated</span><span className="text-right">Actions</span>
        </div>}
        <div className="p-2 sm:p-3">
          {!canView ? <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-muted/15 p-6 text-center" data-testid="state-dispatch-access-denied">
            <div><ShieldCheck size={24} className="mx-auto text-muted-foreground" /><h3 className="mt-3 font-display text-sm font-bold">Dispatch access required</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Your role does not have permission to view dispatch records. Ask an administrator for dispatch access.</p></div>
          </div> : ordersQuery.isLoading ? <SkeletonRows viewMode={viewMode} /> : ordersQuery.isError ? <div className="grid min-h-64 place-items-center rounded-xl border border-destructive/20 bg-destructive/[0.035] p-6 text-center" data-testid="state-dispatch-error">
            <div><CircleAlert size={24} className="mx-auto text-destructive" /><h3 className="mt-3 font-display text-sm font-bold">Dispatch records unavailable</h3><p className="mt-1 text-xs text-muted-foreground">The latest handoff records could not be loaded.</p><Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void ordersQuery.refetch()} data-testid="button-retry-dispatch"><RefreshCw size={13} /> Try again</Button></div>
          </div> : filteredOrders.length === 0 ? <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-muted/15 p-6 text-center" data-testid="state-dispatch-empty">
            <div><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-secondary text-primary"><PackageCheck size={20} /></div><h3 className="mt-3 font-display text-sm font-bold">{orders.length ? 'No orders match these filters' : 'No dispatch records yet'}</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{orders.length ? 'Try a different search or status filter, or clear your filters.' : 'Orders will appear here with a separate dispatch status so delivery handoffs can be tracked.'}</p>{orders.length > 0 && <Button type="button" size="sm" variant="outline" className="mt-4" onClick={clearFilters} data-testid="button-empty-clear-filters">Clear filters</Button>}</div>
          </div> : viewMode === 'grid' ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="grid-dispatch-orders">
            {filteredOrders.map((order) => <DispatchGridCard key={order.id} order={order} canViewOrderHub={canViewOrderHub} canEdit={canEdit} busy={updatePlan.isPending} onShowQr={() => setQrOrder(order)} onUpdate={() => setActiveOrder(order)} />)}
          </div> : viewMode === 'tree' ? <div className="space-y-3" data-testid="tree-dispatch-orders">
            {filteredOrders.map((order) => {
              const batches = new Map<string, typeof order.dispatches>();
              order.dispatches.forEach((dispatch) => {
                const rows = batches.get(dispatch.code) ?? [];
                rows.push(dispatch);
                batches.set(dispatch.code, rows);
              });
              return <article key={order.id} className="rounded-xl border border-border/75 bg-background p-4" data-testid={`tree-dispatch-order-${order.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0"><p className="font-mono text-sm font-bold text-primary">{order.orderId}</p><p className="mt-1 text-xs font-semibold">{order.clientName} <span className="text-muted-foreground">· {order.locationName}</span></p></div>
                  <div className="flex items-center gap-2"><StatusPill status={order.dispatchStatus} /><Button type="button" size="sm" variant="outline" disabled={!canEdit || updatePlan.isPending} onClick={() => setActiveOrder(order)}>{canEdit ? 'Manage dispatches' : 'View'}</Button></div>
                </div>
                <div className="ml-2 mt-3 space-y-2 border-l-2 border-primary/20 pl-4">
                  {[...batches].sort(([left], [right]) => Number(left.slice(1)) - Number(right.slice(1))).map(([code, records]) => <section key={code} className="rounded-lg bg-muted/25 p-3" data-testid={`tree-dispatch-batch-${code}`}>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Dispatch batch {code} · {records.length} lot{records.length === 1 ? '' : 's'}</p>
                    <div className="mt-2 space-y-2">{records.map((dispatch) => <div key={dispatch.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-3 py-2">
                      <div><p className="font-mono text-xs font-bold">{dispatch.trackingId}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{order.lots.find((lot) => lot.lotId === dispatch.lotId) ? `Lot L${order.lots.find((lot) => lot.lotId === dispatch.lotId)?.sequence}` : 'Order-level'} · {dispatch.windowIds.length} windows</p></div><StatusPill status={dispatch.dispatchStatus} />
                    </div>)}</div>
                  </section>)}
                  {!batches.size && <p className="rounded-lg bg-muted/25 p-3 text-xs text-muted-foreground">No dispatch batches planned.</p>}
                </div>
              </article>;
            })}
          </div> : <div className="space-y-2" data-testid="list-dispatch-orders">
            {filteredOrders.map((order) => <article key={order.id} className={`group grid gap-3 rounded-xl border border-border/75 bg-background px-3.5 py-3 transition duration-200 hover:border-primary/25 hover:bg-primary/[0.018] hover:shadow-sm lg:items-center lg:gap-2.5 lg:px-4 ${DISPATCH_REGISTER_COLUMNS}`} data-testid={`row-dispatch-order-${order.id}`}>
            <div className="min-w-0">
              {canViewOrderHub
                ? <Link href={`/order-status/${encodeURIComponent(order.id)}`} className="w-fit font-mono text-[13px] font-bold tracking-tight text-primary underline-offset-4 hover:underline" data-testid={`link-order-status-${order.id}`}>{order.orderId}</Link>
                : <span className="w-fit font-mono text-[13px] font-bold tracking-tight text-foreground" data-testid={`order-id-${order.id}`}>{order.orderId}</span>}
              <p className="mt-1 truncate text-xs font-semibold text-foreground">{order.clientName}</p>
            </div>
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><MapPin size={14} className="shrink-0 text-primary/70" /><span className="truncate">{order.locationName}</span></div>
            <div className="flex flex-wrap items-center gap-2"><span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">Dispatch</span><StatusPill status={order.dispatchStatus} /></div>
            <div className="flex flex-wrap items-center gap-2"><span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">Order stage</span><span className={`inline-flex w-fit rounded-md px-2 py-1 text-[10px] font-semibold ${orderTone(order.orderStatus)}`} data-testid={`status-order-${order.id}`}>{ORDER_STATUS_LABELS[order.orderStatus] || order.orderStatus.replaceAll('_', ' ')}</span></div>
            <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground lg:block">
              <span className="text-[9px] font-bold uppercase tracking-wider lg:hidden">Updated</span>
              <span className="whitespace-nowrap" title={formatUpdated(order.updatedAt)}>{formatUpdated(order.updatedAt)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2 lg:justify-end lg:border-0 lg:pt-0">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">Actions</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-[10px]" onClick={() => setQrOrder(order)} aria-label={`Show QR for ${order.orderId}`} data-testid={`button-show-qr-${order.id}`}><QrCode size={13} /><span className="hidden sm:inline">QR</span></Button>
                <Button type="button" size="sm" className="h-8 px-2 text-[10px]" disabled={!canEdit || updatePlan.isPending} onClick={() => setActiveOrder(order)} title={canEdit ? 'Manage lots, windows, and dispatches' : 'View-only access'} data-testid={`button-change-status-${order.id}`}>{canEdit ? 'Update' : 'View'}<ArrowRight size={12} /></Button>
              </div>
            </div>
            </article>)}
          </div>}
        </div>
        {!ordersQuery.isLoading && !ordersQuery.isError && orders.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-3 text-[10px] text-muted-foreground">
          <span>Updated records are shown first by default.</span><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> {filteredOrders.length} {filteredOrders.length === 1 ? 'record' : 'records'} in view</span>
        </div>}
      </section>
    </div>

    <DispatchPlanDialog order={activeOrder} canEdit={canEdit} busy={updatePlan.isPending} error={updatePlan.isError} onClose={() => { setActiveOrder(null); updatePlan.reset(); }} onSave={savePlan} />
    <StatusDialog order={bulkOrder} canEdit={canEdit} busy={updateStatus.isPending} error={updateStatus.isError} onClose={() => { setBulkOrder(null); updateStatus.reset(); }} onSave={saveStatus} />
    <Dialog open={Boolean(qrOrder)} onOpenChange={(open) => { if (!open) setQrOrder(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Dispatch QR code</DialogTitle><DialogDescription>{qrOrder ? `Scan to update every dispatch for ${qrOrder.orderId} together.` : 'Order dispatch QR code.'}</DialogDescription></DialogHeader>
        {qrOrder && <div className="flex flex-col items-center rounded-xl border border-border/70 bg-muted/20 p-5">
          <div className="rounded-xl bg-white p-3 shadow-sm"><QRCodeCanvas value={getDispatchScanUrl(qrOrder.id)} size={208} level="M" includeMargin /></div>
          <p className="mt-4 font-mono text-sm font-bold">{qrOrder.orderId}</p><p className="mt-1 text-xs text-muted-foreground">{qrOrder.clientName} · {qrOrder.locationName}</p><div className="mt-3"><StatusPill status={qrOrder.dispatchStatus} /></div>
          <p className="mt-3 max-w-[250px] text-center text-[10px] leading-4 text-muted-foreground">This order-level code opens a bulk status update for every dispatch. Dispatch edit permission is required.</p>
        </div>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setQrOrder(null)} data-testid="button-close-dispatch-qr">Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </AppShell>;
}