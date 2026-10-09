import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  CalendarClock, Check, CircleAlert, Download, FileText, MapPin,
  PackageCheck, Plus, QrCode, RefreshCw, Search, ShieldCheck, Truck, X,
} from 'lucide-react';
import {
  getGetDispatchChallanPdfQueryKey, getGetDispatchQrPngQueryKey,
  getGetDispatchSummaryQueryKey, getListDispatchRecordsQueryKey, getListOrderWindowsQueryKey,
  getListOrdersQueryKey, useCancelDispatchRecord, useCreateDispatchRecord, useGetDispatchChallanPdf,
  useGetDispatchQrPng, useGetDispatchSummary, useListDispatchRecords, useListOrderWindows,
  useListOrders, useUpdateDispatchRecord,
} from '@workspace/api-client-react';
import type { DispatchRecord, DispatchRecordStatus, Order, OrderWindow, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

type StatusFilter = 'all' | DispatchRecordStatus;
type SortKey = 'date-desc' | 'date-asc' | 'code' | 'client';
const STATUS: DispatchRecordStatus[] = ['planned', 'dispatched', 'delivered', 'returned', 'cancelled'];
const statusStyle: Record<DispatchRecordStatus, string> = {
  planned: 'border-amber-200 bg-amber-50 text-amber-900',
  dispatched: 'border-sky-200 bg-sky-50 text-sky-900',
  delivered: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  returned: 'border-orange-200 bg-orange-50 text-orange-900',
  cancelled: 'border-rose-200 bg-rose-50 text-rose-900',
};
const fmt = (value?: string | null) => value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value)) : '—';
const human = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const wholeLotReady = (windows: OrderWindow[]) => windows.length > 0 && windows.every((window) => window.frameStatus === 'ready' && window.shutterStatus === 'ready' && window.glassStatus === 'received');
const canDispatchAction = (user: User, action: 'view' | 'create' | 'edit' | 'cancel' | 'override') => {
  if (user.roleId === 'master-admin') return true;
  const direct = user.permissions?.[`dispatch.${action}`];
  if (action === 'view') return direct === 'view' || direct === 'edit' || user.permissions?.dispatch === 'view' || user.permissions?.dispatch === 'edit';
  if (action === 'override') return direct === 'edit';
  return direct === 'edit' || user.permissions?.dispatch === 'edit';
};
function StatusBadge({ status }: { status: DispatchRecordStatus }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusStyle[status]}`} data-testid={`status-dispatch-${status}`}><i className="h-1.5 w-1.5 rounded-full bg-current" />{human(status)}</span>;
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function printDispatchQr(imageUrl: string, dispatchCode: string) {
  const printWindow = window.open('', '_blank', 'width=560,height=640');
  if (!printWindow) return false;
  const document = printWindow.document;
  document.title = `${dispatchCode} QR`;
  document.body.replaceChildren();
  const style = document.createElement('style');
  style.textContent = 'body{font:16px Arial,sans-serif;text-align:center;padding:28px;color:#18343b}img{width:320px;height:320px;object-fit:contain}h1{font-size:20px}';
  const heading = document.createElement('h1');
  heading.textContent = dispatchCode;
  const image = document.createElement('img');
  image.src = imageUrl;
  image.alt = `QR code for ${dispatchCode}`;
  image.addEventListener('load', () => {
    printWindow.focus();
    printWindow.print();
  }, { once: true });
  document.head.append(style);
  document.body.append(heading, image);
  return true;
}
function DispatchForm({ user, open, onOpenChange, onCreated, initialOrderId = '', initialLotId = '' }: { user: User; open: boolean; onOpenChange: (value: boolean) => void; onCreated: (record: DispatchRecord) => void; initialOrderId?: string; initialLotId?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateDispatchRecord();
  const canOverride = canDispatchAction(user, 'override');
  const orderQuery = useListOrders({ includeInactive: false }, { query: { enabled: open, queryKey: getListOrdersQueryKey({ includeInactive: false }) } });
  const [orderSearch, setOrderSearch] = useState('');
  const [orderId, setOrderId] = useState(initialOrderId);
  const [lotId, setLotId] = useState(initialLotId);
  const [note, setNote] = useState('');
  const [planned, setPlanned] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [phone, setPhone] = useState('');
  const [challan, setChallan] = useState('');
  const [location, setLocation] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [formError, setFormError] = useState('');
  const initialSelectionApplied = useRef(false);
  const orders = orderQuery.data ?? [];
  const selectedOrder = orders.find((item) => item.id === orderId);
  const windowsQuery = useListOrderWindows(orderId, { query: { enabled: Boolean(orderId) && open, queryKey: getListOrderWindowsQueryKey(orderId) } });
  const dispatchesQuery = useListDispatchRecords({ orderRecordId: orderId || undefined }, { query: { enabled: Boolean(orderId) && open, queryKey: getListDispatchRecordsQueryKey({ orderRecordId: orderId || undefined }) } });
  const windows = (windowsQuery.data ?? []).filter((window) => window.lotRecordId === lotId || (!window.lotRecordId && selectedOrder?.lots[0]?.id === lotId));
  const lot = selectedOrder?.lots.find((item) => item.id === lotId);
  const readiness = wholeLotReady(windows);
  const visibleOrders = orders.filter((item) => `${item.orderId} ${item.clientName} ${item.locationName}`.toLowerCase().includes(orderSearch.toLowerCase()));
  const summary = useGetDispatchSummary({ query: { enabled: open, queryKey: getGetDispatchSummaryQueryKey() } });
  const existingLotDispatches = (dispatchesQuery.data?.records ?? []).filter((record) => record.lotRecordId === lotId);
  const latestDispatch = existingLotDispatches.slice().sort((a, b) => b.dispatchNo - a.dispatchNo)[0];
  const nextDispatchNo = (latestDispatch?.dispatchNo ?? 0) + 1;
  useEffect(() => {
    if (!open) {
      initialSelectionApplied.current = false;
      return;
    }
    setOrderSearch(''); setOrderId(''); setLotId(''); setNote(''); setPlanned('');
    setOverrideReason(''); setVehicle(''); setDriver(''); setPhone(''); setChallan('');
    setLocation(''); setAddress(''); setLat(''); setLng(''); setFormError('');
  }, [open, initialOrderId, initialLotId]);
  const chooseOrder = (item: Order, selectedLotId = '') => {
    setOrderId(item.id); setLotId(selectedLotId); setLocation(item.locationName || '');
    setAddress(item.siteAddress || item.clientAddress || '');
    setLat(item.siteLatitude == null ? '' : String(item.siteLatitude));
    setLng(item.siteLongitude == null ? '' : String(item.siteLongitude));
  };
  useEffect(() => {
    if (!open || !orders.length || !initialOrderId || initialSelectionApplied.current) return;
    const item = initialOrderId && orders.find((order) => order.id === initialOrderId);
    if (item) {
      chooseOrder(item, initialLotId);
      initialSelectionApplied.current = true;
    }
  }, [open, orders, initialOrderId, initialLotId]);
  const submit = async () => {
    if (!selectedOrder || !lot || create.isPending) return;
    if (!readiness && (!canOverride || !overrideReason.trim())) {
      setFormError(canOverride ? 'Enter an override reason to dispatch a lot that is not fully ready.' : 'This lot is not fully ready. Dispatch override permission is required.');
      return;
    }
    setFormError('');
    try {
      const created = await create.mutateAsync({ data: {
        orderRecordId: selectedOrder.id, lotRecordId: lot.id, dispatchNote: note.trim() || null,
        plannedAt: planned ? new Date(planned).toISOString() : null,
        overrideReason: readiness ? null : overrideReason.trim(),
        locationName: location.trim() || selectedOrder.locationName,
        siteAddress: address.trim() || null,
        siteLatitude: lat ? Number(lat) : null,
        siteLongitude: lng ? Number(lng) : null,
        vehicleNumber: vehicle.trim() || null,
        driverName: driver.trim() || null,
        driverPhone: phone.trim() || null,
        challanNumber: challan.trim() || null,
      } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListDispatchRecordsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetDispatchSummaryQueryKey() }),
        qc.invalidateQueries({ queryKey: getListOrdersQueryKey() }),
      ]);
      toast({ title: 'Dispatch created', description: `${created.dispatchCode} · ${created.windowsSnapshot.length} windows` });
      onCreated(created);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Dispatch could not be created or its delivery details could not be saved.');
    }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-3xl overflow-y-auto">
    <DialogHeader><p className="text-[10px] font-bold uppercase tracking-[.16em] text-primary">Whole-lot handoff</p><DialogTitle>Create dispatch record</DialogTitle><DialogDescription>One dispatch number covers every window assigned to the selected lot. Re-dispatches receive the next sequence.</DialogDescription></DialogHeader>
    <div className="space-y-5">
      <section className="space-y-3 rounded-xl border border-border/70 bg-muted/15 p-4">
        <label className="block text-xs font-semibold">Find an order<input value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} placeholder="Order ID, client or location" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-dispatch-order-search" /></label>
        {orderQuery.isLoading ? <div className="h-12 animate-pulse rounded-lg bg-muted" /> : orderQuery.isError ? <div className="flex items-center justify-between text-xs text-destructive">Orders could not be loaded <Button size="sm" variant="outline" onClick={() => void orderQuery.refetch()}>Retry</Button></div> : <select value={orderId} onChange={(e) => { const order = orders.find((item) => item.id === e.target.value); if (order) chooseOrder(order); }} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="select-dispatch-order"><option value="">Select an order</option>{visibleOrders.map((item) => <option key={item.id} value={item.id}>{item.orderId} · {item.clientName} · {item.locationName}</option>)}</select>}
        {selectedOrder && <div className="grid gap-3 sm:grid-cols-2">
          <section className="space-y-2 sm:col-span-2" aria-label="Select a lot for dispatch">
            <h3 className="text-xs font-semibold">Lots on this order</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {selectedOrder.lots.map((candidate) => {
                const candidateWindows = (windowsQuery.data ?? []).filter((window) => window.lotRecordId === candidate.id || (!window.lotRecordId && selectedOrder.lots[0]?.id === candidate.id));
                const candidateDispatches = (dispatchesQuery.data?.records ?? []).filter((record) => record.lotRecordId === candidate.id).sort((a, b) => a.dispatchNo - b.dispatchNo);
                const candidateReady = wholeLotReady(candidateWindows);
                return <button type="button" key={candidate.id} aria-pressed={lotId === candidate.id} onClick={() => setLotId(candidate.id)} className={`min-w-0 rounded-xl border p-3 text-left transition ${lotId === candidate.id ? 'border-primary bg-primary/[.06] ring-1 ring-primary/20' : 'border-border bg-card hover:border-primary/30'}`} data-testid={`button-select-dispatch-lot-${candidate.id}`}>
                  <span className="flex items-center justify-between gap-2"><span className="font-mono text-xs font-bold text-primary">{candidate.lotId}</span><span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${candidateReady ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>{windowsQuery.isLoading ? 'Checking' : candidateReady ? 'Ready' : 'Needs attention'}</span></span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">{candidateWindows.length} windows</span>
                  <span className="mt-2 flex flex-wrap gap-1">{candidateDispatches.length ? candidateDispatches.map((record) => <span key={record.id} className={`rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${record.status === 'cancelled' ? 'bg-rose-100 text-rose-900' : 'bg-muted text-foreground'}`}>D{record.dispatchNo} {human(record.status)}</span>) : <span className="text-[9px] text-muted-foreground">No dispatch records</span>}</span>
                </button>;
              })}
            </div>
          </section>
           {lot && <div className="rounded-lg border border-border bg-card px-3 py-2.5 text-xs" data-testid="text-dispatch-next-code"><p className="font-bold text-primary">Next code preview</p><p className="mt-1 font-mono">{`${selectedOrder.orderId}-L${lot.sequence}-D${nextDispatchNo}`}</p><p className="mt-1 text-muted-foreground">{dispatchesQuery.isLoading ? 'Checking dispatch history…' : `${existingLotDispatches.length} existing · latest ${latestDispatch?.dispatchCode || 'none'}`}</p></div>}
        </div>}
        {lotId && <div className={`rounded-lg border p-3 text-xs ${readiness ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`} data-testid="panel-dispatch-readiness">
          <div className="flex items-center justify-between gap-2"><strong>{readiness ? 'Lot ready for dispatch' : 'Readiness needs attention'}</strong><span>{windows.length} whole-lot windows</span></div>
          <p className="mt-1 leading-5">{windowsQuery.isLoading ? 'Checking window readiness…' : windowsQuery.isError ? 'Window readiness could not be checked.' : windows.length === 0 ? 'No windows are assigned to this lot yet.' : readiness ? 'Every window has frame and shutter ready, with glass received.' : `${windows.filter((w) => w.frameStatus !== 'ready').length} frame pending · ${windows.filter((w) => w.shutterStatus !== 'ready').length} shutter pending · ${windows.filter((w) => w.glassStatus !== 'received').length} glass pending.`}</p>
          {canOverride && !readiness && <label className="mt-3 block font-semibold">Override reason (required)<Textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={2} placeholder="Why should this lot move before readiness is complete?" data-testid="textarea-dispatch-override" /></label>}
          {windows.length > 0 && <div className="mt-3 overflow-hidden rounded-lg border border-current/10 bg-white/60"><div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b border-current/10 px-3 py-2 text-[9px] font-bold uppercase tracking-wide"><span>Window</span><span>Frame</span><span>Shutter</span><span>Glass</span></div>{windows.map((w) => <div key={w.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b border-current/10 px-3 py-2 text-[10px] last:border-0" data-testid={`row-dispatch-window-${w.id}`}><span>{w.windowNo} · {w.widthMm}×{w.heightMm} mm</span><span>{w.frameStatus}</span><span>{w.shutterStatus}</span><span>{w.glassStatus}</span></div>)}</div>}
        </div>}
      </section>
       {lot && <section className="space-y-3"><h3 className="text-xs font-bold uppercase tracking-[.13em] text-muted-foreground">Dispatch details</h3><div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold">Planned date<input type="date" value={planned} onChange={(e) => setPlanned(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-dispatch-planned-date" /></label>
        <label className="text-xs font-semibold">Vehicle number<input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="MH 12 AB 3456" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-dispatch-vehicle" /></label>
        <label className="text-xs font-semibold">Driver name<input value={driver} onChange={(e) => setDriver(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-dispatch-driver" /></label>
        <label className="text-xs font-semibold">Driver phone<input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-dispatch-driver-phone" /></label>
        <label className="text-xs font-semibold">Challan number<input value={challan} onChange={(e) => setChallan(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-dispatch-challan" /></label>
        <label className="text-xs font-semibold">Delivery location<input value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-dispatch-location" /></label>
        <label className="text-xs font-semibold sm:col-span-2">Delivery address<textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" data-testid="textarea-dispatch-address" /></label>
        <label className="text-xs font-semibold">Map latitude<input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-dispatch-latitude" /></label>
        <label className="text-xs font-semibold">Map longitude<input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-dispatch-longitude" /></label>
        <label className="text-xs font-semibold sm:col-span-2">Dispatch note<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" data-testid="textarea-dispatch-note" /></label>
       </div><p className="text-[10px] text-muted-foreground">All dispatch and delivery details are saved together with this record. No window selection is made.</p></section>}
      {formError && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="error-create-dispatch">{formError}</p>}
    </div>
     <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-create-dispatch">Cancel</Button><Button disabled={!selectedOrder || !lot || !windows.length || windowsQuery.isLoading || dispatchesQuery.isLoading || create.isPending || (!readiness && (!canOverride || !overrideReason.trim()))} onClick={() => void submit()} data-testid="button-submit-dispatch">{create.isPending ? 'Saving dispatch…' : <><Plus size={14} /> Create whole-lot dispatch</>}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function CancelDialog({ record, onClose, onConfirm, pending }: { record: DispatchRecord | null; onClose: () => void; onConfirm: (reason: string) => void; pending: boolean }) {
  const [reason, setReason] = useState('');
  useEffect(() => { setReason(''); }, [record?.id]);
  return <Dialog open={Boolean(record)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Cancel dispatch?</DialogTitle><DialogDescription>{record ? `${record.dispatchCode} will be marked cancelled and its QR will be revoked. This cannot be undone.` : ''}</DialogDescription></DialogHeader><label className="text-xs font-semibold">Cancellation reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" data-testid="textarea-dispatch-cancel-reason" /></label><DialogFooter><Button variant="outline" onClick={onClose}>Keep dispatch</Button><Button variant="destructive" disabled={reason.trim().length < 2 || pending} onClick={() => onConfirm(reason.trim())} data-testid="button-confirm-cancel-dispatch">{pending ? 'Cancelling…' : 'Confirm cancellation'}</Button></DialogFooter></DialogContent></Dialog>;
}

export default function DispatchPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canView = canDispatchAction(user, 'view');
  const canEdit = canDispatchAction(user, 'edit');
  const canCreate = canDispatchAction(user, 'create');
  const canCancel = canDispatchAction(user, 'cancel');
  const summary = useGetDispatchSummary({ query: { queryKey: getGetDispatchSummaryQueryKey(), enabled: canView } });
  const update = useUpdateDispatchRecord();
  const cancel = useCancelDispatchRecord();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
  const [querySearch, setQuerySearch] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [lotFilter, setLotFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState<SortKey>('date-desc');
  const [createOpen, setCreateOpen] = useState(() => canCreate && new URLSearchParams(window.location.search).get('create') === '1');
  const [active, setActive] = useState<DispatchRecord | null>(null);
  const [postCreateRecord, setPostCreateRecord] = useState<DispatchRecord | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DispatchRecord | null>(null);
  const [qrTarget, setQrTarget] = useState<DispatchRecord | null>(null);
  const [qrImageUrl, setQrImageUrl] = useState('');
  const [qrImageRecordId, setQrImageRecordId] = useState('');
  const [qrImageFailed, setQrImageFailed] = useState(false);
  const [challanTarget, setChallanTarget] = useState<DispatchRecord | null>(null);
  const [editFields, setEditFields] = useState({ plannedAt: '', locationName: '', siteAddress: '', siteLatitude: '', siteLongitude: '', vehicleNumber: '', driverName: '', driverPhone: '', challanNumber: '', dispatchNote: '' });
  useEffect(() => { const timer = window.setTimeout(() => setQuerySearch(search.trim()), 220); return () => window.clearTimeout(timer); }, [search]);
  const params = { q: querySearch || undefined, status: filter === 'all' ? undefined : filter };
  const query = useListDispatchRecords(params, { query: { queryKey: getListDispatchRecordsQueryKey(params), enabled: canView } });
  const allRecords = query.data?.records ?? [];
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const scanId = params.get('record') || params.get('scanOrderId');
    if (!scanId || !allRecords.length) return;
    const scanned = allRecords.find((record) => record.id === scanId) || allRecords.filter((record) => record.orderRecordId === scanId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (scanned) {
      setActive(scanned);
      if (params.get('qr') === '1') setQrTarget(scanned);
      if (params.get('challan') === '1') setChallanTarget(scanned);
      params.delete('record'); params.delete('scanOrderId'); params.delete('qr'); params.delete('challan');
      window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
    }
  }, [allRecords]);
  useEffect(() => {
    if (!active) return;
    setEditFields({
      plannedAt: active.plannedAt?.slice(0, 10) || '', locationName: active.locationName || '', siteAddress: active.siteAddress || '',
      siteLatitude: active.siteLatitude == null ? '' : String(active.siteLatitude), siteLongitude: active.siteLongitude == null ? '' : String(active.siteLongitude),
      vehicleNumber: active.vehicleNumber || '', driverName: active.driverName || '', driverPhone: active.driverPhone || '',
      challanNumber: active.challanNumber || '', dispatchNote: active.dispatchNote || '',
    });
  }, [active?.id]);
  const qr = useGetDispatchQrPng(qrTarget?.id || '', {
    query: {
      enabled: Boolean(qrTarget),
      queryKey: getGetDispatchQrPngQueryKey(qrTarget?.id || ''),
      retry: false,
    },
    request: { responseType: 'blob', credentials: 'include' },
  });
  useEffect(() => {
    setQrImageFailed(false);
    setQrImageUrl('');
    setQrImageRecordId('');
    if (!qrTarget || !qr.data) {
      return;
    }
    const objectUrl = URL.createObjectURL(qr.data);
    setQrImageUrl(objectUrl);
    setQrImageRecordId(qrTarget.id);
    return () => URL.revokeObjectURL(objectUrl);
  }, [qrTarget?.id, qr.data]);
  const records = useMemo(() => allRecords.filter((item) => {
    const needle = search.trim().toLowerCase();
    const matchesText = !needle || [item.dispatchCode, ...item.legacyDispatchCodes, item.lotId, ...item.legacyLotIds, `L${String(item.lotSequence).padStart(2, '0')}`, item.orderId, item.clientName, item.locationName, item.siteAddress || ''].some((value) => value.toLowerCase().includes(needle));
    const date = item.plannedAt || item.dispatchedAt || item.deliveredAt || item.createdAt;
    const day = date.slice(0, 10);
    return matchesText && (filter === 'all' || item.status === filter) && (clientFilter === 'all' || item.clientName === clientFilter) && (locationFilter === 'all' || item.locationName === locationFilter) && (!lotFilter || item.lotId.toLowerCase().includes(lotFilter.toLowerCase())) && (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
  }).sort((a, b) => sort === 'code' ? a.dispatchCode.localeCompare(b.dispatchCode, undefined, { numeric: true }) : sort === 'client' ? a.clientName.localeCompare(b.clientName) : sort === 'date-asc' ? Date.parse(a.plannedAt || a.createdAt) - Date.parse(b.plannedAt || b.createdAt) : Date.parse(b.plannedAt || b.createdAt) - Date.parse(a.plannedAt || a.createdAt)), [allRecords, search, filter, clientFilter, locationFilter, lotFilter, dateFrom, dateTo, sort]);
  const clientOptions = useMemo(() => [...new Set(allRecords.map((record) => record.clientName).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [allRecords]);
  const locationOptions = useMemo(() => [...new Set(allRecords.map((record) => record.locationName).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [allRecords]);
  const kpis = summary.data?.statusCounts;
  const refresh = async () => Promise.all([qc.invalidateQueries({ queryKey: getListDispatchRecordsQueryKey() }), qc.invalidateQueries({ queryKey: getGetDispatchSummaryQueryKey() })]);
  const handleCreateDialogOpenChange = (open: boolean) => {
    setCreateOpen(open);
    if (!open) {
      const url = new URL(window.location.href);
      url.searchParams.delete('create');
      url.searchParams.delete('orderRecordId');
      url.searchParams.delete('lotRecordId');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  };
  const statusChange = (record: DispatchRecord, status: DispatchRecordStatus) => update.mutate({ id: record.id, data: { status } }, { onSuccess: async (saved) => { await refresh(); setActive(saved); toast({ title: 'Dispatch status updated', description: `${saved.dispatchCode} · ${saved.status}` }); }, onError: () => toast({ title: 'Status transition not allowed', description: 'The server rejected this change. Refresh to see the latest allowed state.', variant: 'destructive' }) });
  const saveDetails = async () => {
    if (!active) return;
    try {
      const saved = await update.mutateAsync({ id: active.id, data: {
        plannedAt: editFields.plannedAt ? new Date(editFields.plannedAt).toISOString() : null,
        locationName: editFields.locationName.trim(), siteAddress: editFields.siteAddress.trim() || null,
        siteLatitude: editFields.siteLatitude ? Number(editFields.siteLatitude) : null, siteLongitude: editFields.siteLongitude ? Number(editFields.siteLongitude) : null,
        vehicleNumber: editFields.vehicleNumber.trim() || null, driverName: editFields.driverName.trim() || null,
        driverPhone: editFields.driverPhone.trim() || null, challanNumber: editFields.challanNumber.trim() || null,
        dispatchNote: editFields.dispatchNote.trim() || null,
      } });
      setActive(saved); await refresh();
      toast({ title: 'Dispatch details saved', description: saved.dispatchCode });
    } catch (error) {
      toast({ title: 'Could not save dispatch details', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' });
    }
  };
  const cancelRecord = (reason: string) => cancelTarget && cancel.mutate({ id: cancelTarget.id, data: { reason } }, { onSuccess: async () => { await refresh(); toast({ title: 'Dispatch cancelled', description: 'Its QR code is now revoked.' }); setCancelTarget(null); setActive(null); }, onError: (error) => toast({ title: 'Dispatch could not be cancelled', description: error instanceof Error ? error.message : 'The server rejected this cancellation.', variant: 'destructive' }) });
  const clearFilters = () => {
    setSearch('');
    setQuerySearch('');
    setFilter('all');
    setClientFilter('all');
    setLocationFilter('all');
    setLotFilter('');
    setDateFrom('');
    setDateTo('');
  };
  const activeFilters: { label: string; clear: () => void }[] = [
    ...(search.trim() ? [{ label: `Search: ${search.trim()}`, clear: () => { setSearch(''); setQuerySearch(''); } }] : []),
    ...(filter !== 'all' ? [{ label: `Status: ${human(filter)}`, clear: () => setFilter('all') }] : []),
    ...(clientFilter !== 'all' ? [{ label: `Client: ${clientFilter}`, clear: () => setClientFilter('all') }] : []),
    ...(locationFilter !== 'all' ? [{ label: `Location: ${locationFilter}`, clear: () => setLocationFilter('all') }] : []),
    ...(lotFilter.trim() ? [{ label: `Lot: ${lotFilter.trim()}`, clear: () => setLotFilter('') }] : []),
    ...(dateFrom ? [{ label: `From: ${dateFrom}`, clear: () => setDateFrom('') }] : []),
    ...(dateTo ? [{ label: `To: ${dateTo}`, clear: () => setDateTo('') }] : []),
  ];
  return <AppShell user={user} title="Dispatch register" eyebrow="Fulfilment · lot handoffs">
    <main className="mx-auto w-full max-w-[1500px] space-y-5 pb-10">
      <section className="relative overflow-hidden rounded-2xl border border-primary/15 bg-[linear-gradient(115deg,#edf6f2_0%,#e2f0ec_55%,#f7ebd9_100%)] px-5 py-5 shadow-sm md:flex md:items-end md:justify-between md:px-7 md:py-6">
        <div className="absolute -right-12 -top-20 h-64 w-64 rounded-full border border-primary/10" /><div className="relative"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Framewise operations / transport ledger</p><h2 className="mt-2 font-display text-3xl font-bold tracking-[-.05em] md:text-4xl">A clear chain of custody.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Each dispatch is a numbered, whole-lot handoff. Production readiness stays separate from delivery status.</p></div>
        <div className="relative mt-4 flex flex-wrap gap-2 md:mt-0">{canView && <Link href="/order-scanner?flow=dispatch" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold hover:bg-muted" data-testid="link-dispatch-scanner"><QrCode size={15} /> Scan QR</Link>}{canCreate && <Button onClick={() => setCreateOpen(true)} data-testid="button-create-dispatch"><Plus size={15} /> Create dispatch</Button>}</div>
      </section>
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Dispatch KPIs">
        {[{ label: 'Ready lots · never dispatched', value: summary.data?.readyLotsAwaitingDispatch.length ?? 0, icon: PackageCheck, detail: 'Ready with no active dispatch record' }, { label: 'In transit', value: kpis?.dispatched ?? 0, icon: Truck, detail: 'Awaiting delivery confirmation' }, { label: 'Delivered', value: kpis?.delivered ?? 0, icon: Check, detail: 'Dispatch records completed' }, { label: 'Dispatch records', value: kpis?.total ?? allRecords.length, icon: CalendarClock, detail: `${kpis?.planned ?? 0} planned` }].map((item) => <div key={item.label} className="rounded-xl border border-border/80 bg-card p-3.5 shadow-sm sm:p-4" data-testid={`metric-${item.label.toLowerCase().replaceAll(/[^a-z]+/g, '-')}`}><div className="flex items-start justify-between gap-2"><p className="max-w-[170px] text-[9px] font-bold uppercase tracking-[.12em] text-muted-foreground sm:text-[10px]">{item.label}</p><item.icon size={16} className="shrink-0 text-primary" /></div><p className="mt-2 font-display text-2xl font-bold tabular-nums">{query.isLoading || summary.isLoading ? '—' : item.value}</p><p className="mt-1 text-[10px] text-muted-foreground">{item.detail}</p></div>)}
      </section>
      <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
        <header className="border-b border-border/70 p-4 md:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><span className="h-5 w-1 rounded-full bg-primary" /><h2 className="font-display text-lg font-bold">Dispatch records</h2><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px]" data-testid="text-dispatch-count">{records.length} / {kpis?.total ?? allRecords.length}</span></div>
              <p className="ml-3 mt-1 text-xs text-muted-foreground">Search dispatch codes, legacy lot aliases, order, client or location.</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[10px] font-bold text-muted-foreground">Sort<select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="mt-1 block h-9 w-full min-w-[155px] rounded-lg border border-input bg-background px-3 text-xs font-normal text-foreground" data-testid="select-dispatch-sort"><option value="date-desc">Planned / newest</option><option value="date-asc">Planned / oldest</option><option value="code">Dispatch code</option><option value="client">Client name</option></select></label>
              {!canEdit && <span className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-900"><ShieldCheck size={13} /> View only</span>}
            </div>
          </div>
          <div className="mt-4 space-y-3" data-testid="dispatch-filter-rows">
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(145px,1fr))]">
              <label className="block min-w-0 text-[10px] font-bold text-muted-foreground md:col-span-2 xl:col-span-1">Search
                <span className="relative mt-1.5 block"><Search size={14} className="absolute left-3 top-3 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, order, client, location" className="h-10 w-full min-w-0 rounded-lg border border-input bg-background pl-9 pr-3 text-xs font-normal text-foreground" data-testid="input-dispatch-search" /></span>
              </label>
              <label className="block min-w-0 text-[10px] font-bold text-muted-foreground">Status
                <select value={filter} onChange={(e) => setFilter(e.target.value as StatusFilter)} className="mt-1.5 h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-xs font-normal text-foreground" data-testid="select-dispatch-filter"><option value="all">All statuses</option>{STATUS.map((s) => <option value={s} key={s}>{human(s)}</option>)}</select>
              </label>
              <label className="block min-w-0 text-[10px] font-bold text-muted-foreground">Client
                <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="mt-1.5 h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-xs font-normal text-foreground" data-testid="select-dispatch-client"><option value="all">All clients</option>{clientOptions.map((client) => <option value={client} key={client}>{client}</option>)}</select>
              </label>
              <label className="block min-w-0 text-[10px] font-bold text-muted-foreground">Location
                <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="mt-1.5 h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-xs font-normal text-foreground" data-testid="select-dispatch-location"><option value="all">All locations</option>{locationOptions.map((location) => <option value={location} key={location}>{location}</option>)}</select>
              </label>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(145px,1fr)_minmax(170px,1fr)_minmax(170px,1fr)_auto]">
              <label className="block min-w-0 text-[10px] font-bold text-muted-foreground">Lot
                <input value={lotFilter} onChange={(e) => setLotFilter(e.target.value)} placeholder="All lots" className="mt-1.5 h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-xs font-normal text-foreground" data-testid="input-dispatch-lot-filter" />
              </label>
              <label className="block min-w-0 text-[10px] font-bold text-muted-foreground">From
                <input type="date" aria-label="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1.5 h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-xs font-normal text-foreground xl:min-w-[160px]" data-testid="input-dispatch-date-from" />
              </label>
              <label className="block min-w-0 text-[10px] font-bold text-muted-foreground">To
                <input type="date" aria-label="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1.5 h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-xs font-normal text-foreground xl:min-w-[160px]" data-testid="input-dispatch-date-to" />
              </label>
              <div className="flex items-end justify-end"><Button type="button" variant="outline" onClick={clearFilters} className="h-10 w-full md:w-auto" data-testid="button-clear-dispatch-filters"><X size={14} /> Clear</Button></div>
            </div>
            {activeFilters.length > 0 && <div className="flex flex-wrap gap-1.5 pt-1" aria-label="Active dispatch filters" data-testid="list-active-dispatch-filters">{activeFilters.map((item) => <button key={item.label} type="button" onClick={item.clear} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary/[.06] px-2.5 py-1 text-[10px] font-semibold text-primary hover:bg-primary/10" title={`Remove ${item.label} filter`}>{item.label}<X size={11} className="shrink-0" /></button>)}</div>}
          </div>
        </header>
        <div className="space-y-2 p-2 sm:p-3">
              {!canView ? <div className="grid min-h-56 place-items-center text-sm text-muted-foreground" data-testid="state-dispatch-access-denied">Dispatch access is required.</div> : query.isLoading ? <div className="space-y-2" data-testid="state-dispatch-loading">{[1,2,3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/65" />)}</div> : query.isError ? <div className="grid min-h-56 place-items-center rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center" data-testid="state-dispatch-error"><div><CircleAlert className="mx-auto text-destructive" /><p className="mt-2 text-sm font-bold">Dispatch register unavailable</p><p className="mt-1 text-xs text-muted-foreground">The live records could not be loaded.</p><Button className="mt-3" variant="outline" size="sm" onClick={() => void query.refetch()} data-testid="button-retry-dispatch"><RefreshCw size={13} /> Retry</Button></div></div> : !records.length ? <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-border bg-muted/15 p-6 text-center" data-testid="state-dispatch-empty"><div><PackageCheck className="mx-auto text-primary" size={24} /><p className="mt-3 text-sm font-bold">{kpis?.total ? 'No dispatches match these filters' : 'No dispatch records yet'}</p><p className="mt-1 text-xs text-muted-foreground">{kpis?.total ? 'Clear a filter or adjust your search.' : 'Create a dispatch when a lot is ready for a whole-lot handoff.'}</p>{Boolean(kpis?.total) && <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>Clear filters</Button>}</div></div> : records.map((item) => <article key={item.id} className="grid min-w-0 gap-3 rounded-xl border border-border/70 bg-background p-3.5 transition hover:border-primary/25 hover:bg-primary/[.015] sm:grid-cols-[minmax(0,1.1fr)_minmax(130px,.9fr)_minmax(120px,.7fr)_auto] sm:items-center" data-testid={`row-dispatch-record-${item.id}`}>
            <div className="min-w-0"><p className="font-mono text-sm font-bold text-primary" data-testid={`text-dispatch-code-${item.id}`}>{item.dispatchCode}</p><p className="mt-1 truncate text-xs font-semibold">{item.clientName} <span className="text-muted-foreground">· {item.orderId}</span></p><p className="mt-1 text-[10px] text-muted-foreground">{item.lotId} <span className="px-1">·</span> {item.windowsSnapshot.length} windows <span className="px-1">·</span> {item.dispatchNote || 'No dispatch note'}</p></div>
            <div className="min-w-0 text-xs"><p className="flex items-center gap-1.5 font-semibold"><MapPin size={13} className="shrink-0 text-primary" />{item.locationName}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{item.siteAddress || 'Delivery address not recorded'}</p></div>
            <div className="flex items-center justify-between gap-3 sm:block"><StatusBadge status={item.status} /><p className="mt-1 text-[10px] text-muted-foreground">{item.status === 'delivered' ? `Delivered ${fmt(item.deliveredAt)}` : item.status === 'dispatched' ? `Dispatched ${fmt(item.dispatchedAt)}` : `Planned ${fmt(item.plannedAt)}`}</p></div>
            <div className="flex flex-wrap items-center gap-1 border-t border-border/60 pt-2 sm:justify-end sm:border-0 sm:pt-0">
              <Button size="sm" variant="outline" className="h-8 px-2 text-[10px]" onClick={() => setActive(item)} data-testid={`button-view-dispatch-${item.id}`}>{canEdit ? 'View / update' : 'View'}</Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Show dispatch QR" onClick={() => setQrTarget(item)} data-testid={`button-show-dispatch-qr-${item.id}`}><QrCode size={14} /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Download challan PDF" onClick={() => setChallanTarget(item)} data-testid={`button-download-challan-${item.id}`}><FileText size={14} /></Button>
            </div>
          </article>)}
        </div>
      </section>
    </main>
    {canCreate && <DispatchForm user={user} open={createOpen} onOpenChange={handleCreateDialogOpenChange} initialOrderId={new URLSearchParams(window.location.search).get('orderRecordId') || ''} initialLotId={new URLSearchParams(window.location.search).get('lotRecordId') || ''} onCreated={(record) => { handleCreateDialogOpenChange(false); setPostCreateRecord(record); void refresh(); }} />}
    <Dialog open={Boolean(active)} onOpenChange={(open) => { if (!open) setActive(null); }}><DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto"><DialogHeader><DialogTitle>{active?.dispatchCode || 'Dispatch record'}</DialogTitle><DialogDescription>{active ? `${active.orderId} · ${active.clientName} · ${active.lotId}` : ''}</DialogDescription></DialogHeader>{active && <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 p-3"><StatusBadge status={active.status} /><span className="text-xs text-muted-foreground">{active.windowsSnapshot.length} windows · created {fmt(active.createdAt)}</span></div>
      {canEdit ? <div className="grid gap-3 sm:grid-cols-2">{[
        { label: 'Planned date', key: 'plannedAt', type: 'date' }, { label: 'Delivery location', key: 'locationName' },
        { label: 'Vehicle number', key: 'vehicleNumber' }, { label: 'Driver', key: 'driverName' },
        { label: 'Driver phone', key: 'driverPhone' }, { label: 'Challan number', key: 'challanNumber' },
        { label: 'Map latitude', key: 'siteLatitude' }, { label: 'Map longitude', key: 'siteLongitude' },
      ].map(({ label, key, type }) => <label key={key} className="text-[10px] font-semibold text-muted-foreground">{label}<input type={type || 'text'} value={editFields[key as keyof typeof editFields]} onChange={(e) => setEditFields((fields) => ({ ...fields, [key]: e.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground" data-testid={`input-edit-dispatch-${key}`} /></label>)}<label className="text-[10px] font-semibold text-muted-foreground sm:col-span-2">Delivery address<textarea value={editFields.siteAddress} onChange={(e) => setEditFields((fields) => ({ ...fields, siteAddress: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs text-foreground" data-testid="textarea-edit-dispatch-address" /></label><label className="text-[10px] font-semibold text-muted-foreground sm:col-span-2">Dispatch note<textarea value={editFields.dispatchNote} onChange={(e) => setEditFields((fields) => ({ ...fields, dispatchNote: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs text-foreground" data-testid="textarea-edit-dispatch-note" /></label><Button size="sm" className="sm:col-span-2" disabled={update.isPending || !editFields.locationName.trim()} onClick={() => void saveDetails()} data-testid="button-save-dispatch-details">{update.isPending ? 'Saving…' : 'Save dispatch details'}</Button></div> : <div className="grid grid-cols-2 gap-3 text-xs"><p><span className="block text-[9px] uppercase text-muted-foreground">Delivery</span>{active.locationName}<br />{active.siteAddress || 'Address not recorded'}</p><p><span className="block text-[9px] uppercase text-muted-foreground">Vehicle / driver</span>{active.vehicleNumber || '—'} · {active.driverName || '—'}</p><p><span className="block text-[9px] uppercase text-muted-foreground">Planned</span>{fmt(active.plannedAt)}</p><p><span className="block text-[9px] uppercase text-muted-foreground">Challan</span>{active.challanNumber || 'Not recorded'}</p>{active.dispatchNote && <p className="col-span-2 rounded-lg bg-muted/30 p-3" data-testid="text-active-dispatch-note">{active.dispatchNote}</p>}</div>}
      <div className="flex flex-wrap gap-2">{canEdit && active.status === 'planned' && <Button size="sm" disabled={update.isPending} onClick={() => statusChange(active, 'dispatched')} data-testid="button-mark-dispatched">Mark dispatched</Button>}{canEdit && active.status === 'dispatched' && <><Button size="sm" disabled={update.isPending} onClick={() => statusChange(active, 'delivered')} data-testid="button-mark-delivered">Mark delivered</Button><Button size="sm" variant="outline" disabled={update.isPending} onClick={() => statusChange(active, 'returned')} data-testid="button-mark-returned">Mark returned</Button></>}{canEdit && active.status === 'delivered' && <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => statusChange(active, 'returned')} data-testid="button-mark-returned">Mark returned</Button>}{canCancel && ['planned','dispatched'].includes(active.status) && <Button size="sm" variant="destructive" onClick={() => setCancelTarget(active)} data-testid="button-cancel-dispatch">Cancel dispatch</Button>}</div><Button variant="outline" size="sm" onClick={() => { setQrTarget(active); }}><QrCode size={14} /> Show QR</Button></div>}<DialogFooter><Button variant="outline" onClick={() => setActive(null)}>Close</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(postCreateRecord)} onOpenChange={(open) => { if (!open) setPostCreateRecord(null); }}>
      <DialogContent className="max-w-md" data-testid="dialog-dispatch-created">
        <DialogHeader><DialogTitle>Dispatch created</DialogTitle><DialogDescription>{postCreateRecord ? `${postCreateRecord.dispatchCode} is saved with ${postCreateRecord.windowsSnapshot.length} windows. Choose a QR or challan action.` : ''}</DialogDescription></DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" disabled={!postCreateRecord} onClick={() => { if (postCreateRecord) setQrTarget(postCreateRecord); setPostCreateRecord(null); }} data-testid="button-created-dispatch-qr"><QrCode size={14} /> Download QR</Button>
          <Button disabled={!postCreateRecord} onClick={() => { if (postCreateRecord) setChallanTarget(postCreateRecord); setPostCreateRecord(null); }} data-testid="button-created-dispatch-challan"><FileText size={14} /> Print / download challan</Button>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setPostCreateRecord(null)}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <CancelDialog record={cancelTarget} onClose={() => setCancelTarget(null)} onConfirm={cancelRecord} pending={cancel.isPending} />
    <Dialog open={Boolean(qrTarget)} onOpenChange={(open) => { if (!open) setQrTarget(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Dispatch QR</DialogTitle><DialogDescription>{qrTarget ? `${qrTarget.dispatchCode} · protected status link` : ''}</DialogDescription></DialogHeader>
        {qrTarget && (qr.isFetching || (!qr.isError && !qrImageFailed && qrImageRecordId !== qrTarget.id)) ? <div className="grid h-60 place-items-center rounded-xl border border-border bg-muted/20" role="status" aria-live="polite" data-testid="state-dispatch-qr-loading"><div className="text-center text-xs text-muted-foreground"><RefreshCw size={22} className="mx-auto animate-spin text-primary" /><p className="mt-3">Loading dispatch QR…</p></div></div> : qr.isError || qrImageFailed ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" data-testid="state-dispatch-qr-error"><p className="font-semibold">The dispatch QR could not be loaded.</p><p className="mt-1 text-xs leading-5">Check your sign-in and dispatch access, then try again. Cancelled or revoked dispatch links are unavailable.</p><Button className="mt-3" size="sm" variant="outline" disabled={qr.isFetching} onClick={() => { setQrImageFailed(false); setQrImageUrl(''); setQrImageRecordId(''); void qr.refetch(); }} data-testid="button-retry-dispatch-qr"><RefreshCw size={13} className={qr.isFetching ? 'animate-spin' : ''} /> Retry</Button></div> : qrImageUrl && qrImageRecordId === qrTarget?.id && <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/20 p-4"><img src={qrImageUrl} alt={`QR code for dispatch status ${qrTarget.dispatchCode}`} onError={() => setQrImageFailed(true)} className="h-52 w-52 rounded-lg bg-white p-2" data-testid="img-dispatch-qr" /><p className="font-mono text-sm font-bold">{qrTarget.dispatchCode}</p><div className="flex flex-wrap justify-center gap-2"><Button size="sm" variant="outline" disabled={!qr.data} onClick={() => qr.data && downloadBlob(qr.data, `${qrTarget.dispatchCode}-qr.png`)} data-testid="button-download-dispatch-qr"><Download size={14} /> Download PNG</Button><Button size="sm" variant="outline" onClick={() => { if (!printDispatchQr(qrImageUrl, qrTarget.dispatchCode)) toast({ title: 'Allow pop-ups to print the QR', description: 'The QR image is still available to download.' }); }} data-testid="button-print-dispatch-qr">Print QR</Button></div></div>}
        <DialogFooter><Button variant="outline" onClick={() => setQrTarget(null)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ChallanDownloader record={challanTarget} onDone={() => setChallanTarget(null)} />
  </AppShell>;
}

function ChallanDownloader({ record, onDone }: { record: DispatchRecord | null; onDone: () => void }) {
  const query = useGetDispatchChallanPdf(record?.id || '', { query: { enabled: Boolean(record), queryKey: getGetDispatchChallanPdfQueryKey(record?.id || '') } });
  const { toast } = useToast();
  useEffect(() => {
    if (record && query.data) { downloadBlob(query.data, `${record.dispatchCode}-challan.pdf`); onDone(); }
    else if (record && query.isError) { toast({ title: 'Challan unavailable', description: 'The PDF could not be generated. Try again.', variant: 'destructive' }); onDone(); }
  }, [record, query.data, query.isError, onDone, toast]);
  return null;
}
