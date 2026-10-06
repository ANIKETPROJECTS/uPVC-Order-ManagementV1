import { Fragment, useMemo, useState } from 'react';
import { ArrowDownUp, Check, ChevronDown, ChevronUp, Clock3, FileSpreadsheet, LayoutGrid, List, PackageCheck, Pencil, RefreshCw, Search, ShieldCheck, Trash2, UploadCloud } from 'lucide-react';
import { getGetGlassTrackingQueryKey, useDeleteGlassTracking, useGetGlassTracking, useUpdateGlassTracking, useUpdateGlassTrackingQuantities } from '@workspace/api-client-react';
import type { GlassTrackingOrder, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { GlassQuantityEditor } from '@/components/glass-quantity-editor';
import { GlassTrackingItemEditor } from '@/components/glass-tracking-item-editor';
import { GlassWorkbookImportDialog } from '@/components/glass-workbook-import-dialog';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

type GlassStatus = GlassTrackingOrder['status'];
type SortValue = 'updated' | 'order' | 'client' | 'status' | 'ordered';
type ViewMode = 'list' | 'grid';

const STATUS_OPTIONS: { value: GlassStatus; label: string; tone: string; dot: string; icon: typeof Clock3 }[] = [
  { value: 'glass_input_pending', label: 'Glass Input Pending', tone: 'bg-rose-100 text-rose-900 ring-rose-200', dot: 'bg-rose-500', icon: UploadCloud },
  { value: 'pending', label: 'Pending', tone: 'bg-amber-100 text-amber-900 ring-amber-200', dot: 'bg-amber-500', icon: Clock3 },
  { value: 'partial', label: 'Partial', tone: 'bg-sky-100 text-sky-900 ring-sky-200', dot: 'bg-sky-600', icon: ArrowDownUp },
  { value: 'received', label: 'Received', tone: 'bg-emerald-100 text-emerald-900 ring-emerald-200', dot: 'bg-emerald-600', icon: Check },
];

function statusLabel(status: string) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label || status.replaceAll('_', ' ');
}

function StatusBadge({ status, id }: { status: string; id: string }) {
  const option = STATUS_OPTIONS.find((item) => item.value === status);
  return <span className={`inline-flex w-fit items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${option?.tone || 'bg-muted text-muted-foreground ring-border'}`} data-testid={`status-glass-${id}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${option?.dot || 'bg-muted-foreground'}`} />
    {statusLabel(status)}
  </span>;
}

function LoadingState() {
  return <div className="space-y-2" aria-label="Loading glass tracking orders" data-testid="state-glass-loading">
    {[0, 1, 2, 3].map((item) => <div key={item} className="grid animate-pulse grid-cols-1 gap-4 rounded-xl border border-border/70 bg-card p-4 md:grid-cols-[1.2fr_1fr_.6fr_.6fr_.6fr_auto]">
      <div className="space-y-2"><div className="h-4 w-28 rounded bg-muted" /><div className="h-3 w-36 rounded bg-muted/70" /></div>
      <div className="h-4 w-32 rounded bg-muted/70" /><div className="h-4 w-16 rounded bg-muted/70" /><div className="h-4 w-16 rounded bg-muted/70" /><div className="h-4 w-16 rounded bg-muted/70" /><div className="h-8 w-24 rounded-lg bg-muted/70" />
    </div>)}
  </div>;
}

function orderSearchText(order: GlassTrackingOrder) {
  return [
    order.orderId,
    order.clientName,
    order.locationName,
    order.invoiceNo ?? '',
    order.invoiceFilename ?? '',
    order.glassInputFilename ?? '',
    ...order.items.flatMap((item) => [item.villaNo ?? '', item.windowNo, item.glassType]),
  ].join(' ').toLocaleLowerCase();
}

function formatCount(value: number) {
  return value.toLocaleString('en-IN');
}

function invoiceFilenameStem(filename: string | null) {
  if (!filename) return null;
  const name = filename.split(/[\\/]/).pop() || filename;
  return name.replace(/\.[^.]+$/, '') || null;
}

function DemoDataPreview() {
  const demoOrders: GlassTrackingOrder[] = [
    {
      orderRecordId: 'demo-glass-order-2401',
      orderId: 'DEMO-GL-2401',
      clientName: 'Cedar Grove Villas',
      locationName: 'Pune',
      invoiceNo: 'INV-DEMO-2401',
      invoiceFilename: 'INV-DEMO-2401.pdf',
      glassInputFilename: 'glass-order-demo-rev2.xlsx',
      glassInputRevision: 2,
      glassInputUploadedAt: '2026-10-05T10:00:00.000Z',
      ordered: 18,
      received: 14,
      broken: 2,
      status: 'partial',
      updatedAt: '2026-10-05T10:00:00.000Z',
      items: [
        { id: 'demo-glass-item-1', villaNo: '4-A', windowNo: '1', glassType: '6mm Toughened Glass', widthMm: 1026, heightMm: 2082, ordered: 8, received: 8, broken: 0 },
        { id: 'demo-glass-item-2', villaNo: '4-B', windowNo: '2', glassType: '5mm Frosted Toughened', widthMm: 1055, heightMm: 1540, ordered: 10, received: 6, broken: 2 },
      ],
    },
    {
      orderRecordId: 'demo-glass-order-2402',
      orderId: 'DEMO-GL-2402',
      clientName: 'Maple Court Residence',
      locationName: 'Mumbai',
      invoiceNo: null,
      invoiceFilename: null,
      glassInputFilename: null,
      glassInputRevision: 0,
      glassInputUploadedAt: null,
      ordered: 0,
      received: 0,
      broken: 0,
      status: 'glass_input_pending',
      updatedAt: '2026-10-05T10:00:00.000Z',
      items: [],
    },
    {
      orderRecordId: 'demo-glass-order-2403',
      orderId: 'DEMO-GL-2403',
      clientName: 'Hilltop Bungalows',
      locationName: 'Pune',
      invoiceNo: 'INV-DEMO-2403',
      invoiceFilename: 'INV-DEMO-2403.pdf',
      glassInputFilename: 'hilltop-glass-order.xlsx',
      glassInputRevision: 1,
      glassInputUploadedAt: '2026-10-04T10:00:00.000Z',
      ordered: 8,
      received: 8,
      broken: 0,
      status: 'received',
      updatedAt: '2026-10-04T10:00:00.000Z',
      items: [
        { id: 'demo-glass-item-3', villaNo: 'B-2', windowNo: '3', glassType: '8mm Toughened Glass', widthMm: 1028, heightMm: 1304, ordered: 8, received: 8, broken: 0 },
      ],
    },
  ];

  return <section className="overflow-hidden rounded-2xl border border-dashed border-primary/30 bg-primary/[0.025]" data-testid="glass-demo-preview">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/10 px-4 py-3">
      <div className="flex items-center gap-2"><FileSpreadsheet size={15} className="text-primary" /><div><h2 className="text-sm font-bold">Development sample register</h2><p className="text-[10px] text-muted-foreground">Illustrative orders only · never saved</p></div></div>
      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">Synthetic demo data</span>
    </div>
    <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
      {demoOrders.map((order) => <article key={order.orderRecordId} className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="font-mono text-xs font-bold text-primary">{order.orderId}</p><p className="mt-1 truncate text-sm font-semibold">{order.clientName}</p></div>
          <StatusBadge status={order.status} id={order.orderRecordId} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 text-xs">
          <div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Invoice No.</p><p className="mt-1 truncate font-medium">{order.invoiceNo ?? 'Invoice Upload Pending'}</p></div>
          <div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Ordered · Received · Broken</p><p className="mt-1 font-mono font-semibold">{order.ordered} · {order.received} · {order.broken}</p></div>
        </div>
        {order.items.length ? <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3 text-[11px]">
          {order.items.map((item) => <li key={item.id} className="leading-5">
            <span className="font-semibold">{item.villaNo} · {item.windowNo}</span>
            <span className="text-muted-foreground"> · {item.glassType} · {item.widthMm} × {item.heightMm} mm · {item.ordered} ordered, {item.received} received, {item.broken} broken</span>
          </li>)}
        </ul> : <p className="mt-3 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">No workbook uploaded for this sample order.</p>}
      </article>)}
    </div>
  </section>;
}

export default function GlassTrackingPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const permission = user.permissions?.['glass-procurement'];
  const canView = user.roleId === 'master-admin' || permission === 'view' || permission === 'edit';
  const canEdit = user.roleId === 'master-admin' || permission === 'edit';
  const trackingQuery = useGetGlassTracking({ query: { queryKey: getGetGlassTrackingQueryKey(), enabled: canView } });
  const updateQuantities = useUpdateGlassTrackingQuantities();
  const updateDetails = useUpdateGlassTracking();
  const deleteTracking = useDeleteGlassTracking();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [sort, setSort] = useState<SortValue>('updated');
  const [view, setView] = useState<ViewMode>('list');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const orders = trackingQuery.data || [];
  const locations = useMemo(() => [...new Set(orders.map((order) => order.locationName))]
    .sort((a, b) => a.localeCompare(b)), [orders]);

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const result = orders.filter((order) => {
      return (!needle || orderSearchText(order).includes(needle))
        && (statusFilter === 'all' || order.status === statusFilter)
        && (locationFilter === 'all' || order.locationName === locationFilter);
    });
    const statusOrder: Record<GlassStatus, number> = {
      glass_input_pending: 0,
      pending: 1,
      partial: 2,
      received: 3,
    };
    return result.sort((a, b) => {
      if (sort === 'order') return a.orderId.localeCompare(b.orderId, undefined, { numeric: true, sensitivity: 'base' });
      if (sort === 'client') return a.clientName.localeCompare(b.clientName, undefined, { sensitivity: 'base' });
      if (sort === 'status') return statusOrder[a.status] - statusOrder[b.status];
      if (sort === 'ordered') return b.ordered - a.ordered;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [orders, search, statusFilter, locationFilter, sort]);

  const counts: Record<GlassStatus, number> = {
    glass_input_pending: orders.filter((order) => order.status === 'glass_input_pending').length,
    pending: orders.filter((order) => order.status === 'pending').length,
    partial: orders.filter((order) => order.status === 'partial').length,
    received: orders.filter((order) => order.status === 'received').length,
  };

  const saveQuantities = (order: GlassTrackingOrder, items: Array<{ id: string; received: number; broken: number }>) => {
    if (!canEdit) return;
    updateQuantities.mutate({ id: order.orderRecordId, data: { items } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetGlassTrackingQueryKey() });
        toast({ title: 'Glass quantities updated', description: `${order.orderId} received and broken counts were saved.` });
      },
      onError: () => toast({ title: 'Could not save glass quantities', description: 'No counts were changed. Check the quantities and try again.', variant: 'destructive' }),
    });
  };

  const saveDetails = (order: GlassTrackingOrder, items: Array<{
    id?: string;
    villaNo: string | null;
    windowNo: string;
    glassType: string;
    widthMm: number;
    heightMm: number;
    ordered: number;
    received: number;
    broken: number;
  }>) => {
    if (!canEdit) return;
    updateDetails.mutate({ id: order.orderRecordId, data: { items } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetGlassTrackingQueryKey() });
        setEditingOrderId(null);
        toast({ title: 'Glass tracking updated', description: `${order.orderId} details were saved.` });
      },
      onError: () => toast({ title: 'Could not update glass tracking', description: 'No details were changed. Check the line values and try again.', variant: 'destructive' }),
    });
  };

  const removeTracking = (order: GlassTrackingOrder) => {
    if (!canEdit || (!order.glassInputFilename && order.items.length === 0)) return;
    const confirmed = window.confirm(
      `Delete glass tracking data for ${order.orderId}? The order will remain in the register as pending, and the imported workbook history will be retained. Manually edited lines will be removed.`,
    );
    if (!confirmed) return;
    deleteTracking.mutate({ id: order.orderRecordId }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetGlassTrackingQueryKey() });
        setEditingOrderId(null);
        setExpandedOrderId(null);
        toast({ title: 'Glass tracking deleted', description: `${order.orderId} remains in the register as pending.` });
      },
      onError: () => toast({ title: 'Could not delete glass tracking', description: 'The tracking record was not removed. Refresh and try again.', variant: 'destructive' }),
    });
  };

  const clearFilters = () => { setSearch(''); setStatusFilter('all'); setLocationFilter('all'); };
  const hasFilters = Boolean(search || statusFilter !== 'all' || locationFilter !== 'all');

  const editor = (order: GlassTrackingOrder) => <GlassQuantityEditor
    orderId={order.orderId}
    items={order.items}
    canEdit={canEdit}
    isSaving={updateQuantities.isPending && updateQuantities.variables?.id === order.orderRecordId}
    onSave={(items) => saveQuantities(order, items)}
  />;

  return <AppShell user={user} title="Glass Tracking" eyebrow="Module · glass tracking">
    <div className="glass-register mx-auto w-full max-w-[1440px] space-y-5 pb-8">
      <section className="glass-hero relative isolate overflow-hidden rounded-2xl border border-primary/15 px-5 py-5 shadow-sm md:px-7 md:py-6">
        <div className="glass-pane-mark pointer-events-none absolute -right-6 -top-8 hidden h-56 w-56 rotate-6 rounded-[1.8rem] border border-primary/20 opacity-80 sm:block" aria-hidden="true">
          <div className="absolute inset-4 rounded-[1.2rem] border border-primary/20 bg-card/20" />
          <div className="absolute bottom-4 left-1/2 top-4 w-px bg-primary/20" />
          <div className="absolute left-4 right-4 top-1/2 h-px bg-primary/20" />
        </div>
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Procurement desk <span className="text-muted-foreground/70">/</span> glass register</div>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.05em] text-foreground md:text-[2.6rem]">Every pane, accounted for.</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">One register from client invoice to supplier workbook. Check each window line, then reconcile intact and broken pieces at dispatch.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-primary/15 bg-card/70 px-3.5 py-3 backdrop-blur-sm">
              <PackageCheck size={17} className="text-primary" />
              <div><p className="font-display text-xl font-bold leading-none glass-tabular" data-testid="metric-glass-total">{trackingQuery.isLoading ? '—' : orders.length}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Orders in register</p></div>
            </div>
            {canView && <GlassWorkbookImportDialog
              orders={orders}
              canEdit={canEdit}
              onImported={() => { void queryClient.invalidateQueries({ queryKey: getGetGlassTrackingQueryKey() }); }}
            />}
          </div>
        </div>
      </section>

      {canView && <section aria-label="Glass status totals" className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {STATUS_OPTIONS.map((option) => {
          const Icon = option.icon;
          return <button key={option.value} type="button" onClick={() => setStatusFilter(statusFilter === option.value ? 'all' : option.value)} className={`rounded-xl border bg-card px-3 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:px-4 sm:py-4 ${statusFilter === option.value ? 'border-primary/40 ring-2 ring-primary/10' : 'border-border/80'}`} data-testid={`filter-glass-${option.value}`} aria-pressed={statusFilter === option.value}>
            <div className="flex items-center justify-between gap-2"><span className="truncate text-[9px] font-bold uppercase tracking-[0.11em] text-muted-foreground sm:text-[10px]">{option.label}</span><Icon size={15} className="shrink-0 text-primary/75" /></div>
            <div className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl" data-testid={`metric-glass-${option.value}`}>{trackingQuery.isLoading ? '—' : counts[option.value]}</div>
            <div className="mt-1 hidden text-[10px] text-muted-foreground sm:block">{statusFilter === option.value ? 'Showing this stage' : 'Orders'}</div>
          </button>;
        })}
      </section>}

      {canView && import.meta.env.DEV ? <DemoDataPreview /> : null}

      <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
        <div className="border-b border-border/75 p-4 md:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><div className="flex items-center gap-2"><span className="h-5 w-1 rounded-full bg-primary" /><h2 className="font-display text-lg font-bold tracking-tight">Glass register</h2><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground" data-testid="text-glass-count">{filteredOrders.length} / {orders.length}</span></div><p className="ml-3 mt-1 text-xs text-muted-foreground">All created Order IDs are listed, including orders without a glass workbook.</p></div>
            {canView && !canEdit && <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-900"><ShieldCheck size={13} /> View-only access</span>}
          </div>
          {canView && <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(200px,1fr)_170px_190px_auto]">
            <label className="relative block">
              <span className="sr-only">Search glass tracking</span><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search orders, clients, glass types…" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10" data-testid="input-glass-search" />
            </label>
            <label className="sr-only" htmlFor="glass-location-filter">Filter by location</label>
            <select id="glass-location-filter" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} className="h-10 rounded-lg border border-input bg-background px-3 text-xs" data-testid="select-glass-location">
              <option value="all">All locations</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}
            </select>
            <label className="sr-only" htmlFor="glass-sort">Sort glass orders</label>
            <select id="glass-sort" value={sort} onChange={(event) => setSort(event.target.value as SortValue)} className="h-10 rounded-lg border border-input bg-background px-3 text-xs" data-testid="select-glass-sort">
              <option value="updated">Recently updated</option><option value="order">Order ID</option><option value="client">Client</option><option value="status">Glass status</option><option value="ordered">Ordered quantity</option>
            </select>
            <div className="flex h-10 items-center rounded-lg border border-border/80 bg-muted/35 p-1" role="group" aria-label="Glass register view">
              <button type="button" onClick={() => setView('list')} aria-pressed={view === 'list'} aria-label="List view" className={`grid h-8 w-9 place-items-center rounded-md transition ${view === 'list' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} data-testid="button-glass-list-view"><List size={15} /></button>
              <button type="button" onClick={() => setView('grid')} aria-pressed={view === 'grid'} aria-label="Grid view" className={`grid h-8 w-9 place-items-center rounded-md transition ${view === 'grid' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} data-testid="button-glass-grid-view"><LayoutGrid size={15} /></button>
            </div>
          </div>}
        </div>
        <div className="p-3 sm:p-4">
          {!canView ? <div className="rounded-xl border border-dashed border-border p-8 text-center" data-testid="state-glass-no-access"><ShieldCheck size={22} className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm font-semibold">Glass tracking access is not assigned</p><p className="mt-1 text-xs text-muted-foreground">Ask an administrator to enable this module for your role.</p></div>
            : trackingQuery.isLoading ? <LoadingState />
              : trackingQuery.isError ? <div className="rounded-xl border border-dashed border-border p-8 text-center" data-testid="state-glass-error"><p className="text-sm font-semibold">Glass tracking could not be loaded.</p><p className="mt-1 text-xs text-muted-foreground">Check your connection and try again.</p><button type="button" onClick={() => void trackingQuery.refetch()} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90" data-testid="button-glass-retry"><RefreshCw size={13} /> Retry</button></div>
                : orders.length === 0 ? <div className="rounded-xl border border-dashed border-border p-8 text-center" data-testid="state-glass-empty"><PackageCheck size={22} className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm font-semibold">No orders created yet</p><p className="mt-1 text-xs text-muted-foreground">Every created order will appear here. Create an order before importing its glass workbook.</p></div>
                  : filteredOrders.length === 0 ? <div className="rounded-xl border border-dashed border-border p-8 text-center" data-testid="state-glass-no-results"><p className="text-sm font-semibold">No matching orders</p><p className="mt-1 text-xs text-muted-foreground">Adjust the search or filters to see more glass orders.</p>{hasFilters && <button type="button" onClick={clearFilters} className="mt-3 text-xs font-bold text-primary hover:underline" data-testid="button-glass-clear-filters">Clear all filters</button>}</div>
             : view === 'list' ? <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-xs">
                      <thead><tr className="border-b border-border/70 text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
                        <th className="px-4 py-3">Order / client</th><th className="px-4 py-3">Invoice No.</th><th className="px-4 py-3 text-right">Ordered</th><th className="px-4 py-3 text-right">Received</th><th className="px-4 py-3 text-right">Broken</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th>
                      </tr></thead>
                      <tbody>{filteredOrders.map((order) => {
                        const expanded = expandedOrderId === order.orderRecordId;
                        return <Fragment key={order.orderRecordId}>
                          <tr className="glass-order-row border-b border-border/60 last:border-0" data-testid={`row-glass-order-${order.orderRecordId}`}>
                            <td className="px-4 py-3">
                              <p className="font-mono text-xs font-bold text-primary" data-testid={`text-glass-order-${order.orderRecordId}`}>{order.orderId}</p>
                              <p className="mt-1 max-w-[250px] truncate text-xs font-semibold" title={order.clientName}>{order.clientName}</p>
                              <p className="mt-1 max-w-[250px] truncate text-[10px] text-muted-foreground" title={order.glassInputFilename ?? undefined}>
                                {order.glassInputFilename ? `Workbook rev. ${order.glassInputRevision} · ${order.glassInputFilename}` : order.items.length ? 'Manual glass details' : 'Glass Input Pending'}
                              </p>
                              <p className="mt-1 text-[10px] text-muted-foreground">{order.locationName}</p>
                            </td>
                            <td className="px-4 py-3"><span className={order.invoiceFilename || order.invoiceNo ? 'font-medium' : 'text-muted-foreground'} title={order.invoiceFilename ?? undefined}>{order.invoiceNo ?? invoiceFilenameStem(order.invoiceFilename) ?? 'Invoice Upload Pending'}</span></td>
                            <td className="glass-tabular px-4 py-3 text-right font-mono font-semibold">{formatCount(order.ordered)}</td>
                            <td className="glass-tabular px-4 py-3 text-right font-mono">{formatCount(order.received)}</td>
                            <td className="glass-tabular px-4 py-3 text-right font-mono">{formatCount(order.broken)}</td>
                            <td className="px-4 py-3"><StatusBadge status={order.status} id={order.orderRecordId} /></td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-1.5">
                                <button type="button" onClick={() => { setEditingOrderId(null); setExpandedOrderId(expanded ? null : order.orderRecordId); }} aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} glass details for ${order.orderId}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-semibold hover:bg-muted" data-testid={`button-glass-details-${order.orderRecordId}`}>{expanded ? 'Hide' : 'Details'}{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>
                                {canEdit && <button type="button" onClick={() => { setExpandedOrderId(null); setEditingOrderId(editingOrderId === order.orderRecordId ? null : order.orderRecordId); }} aria-expanded={editingOrderId === order.orderRecordId} aria-label={`${editingOrderId === order.orderRecordId ? 'Close edit' : 'Edit'} glass tracking for ${order.orderId}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-primary/20 px-2 text-[11px] font-semibold text-primary hover:bg-primary/5" data-testid={`button-glass-edit-${order.orderRecordId}`}><Pencil size={12} /> Edit</button>}
                                {canEdit && (order.glassInputFilename || order.items.length > 0) && <button type="button" onClick={() => removeTracking(order)} disabled={deleteTracking.isPending} aria-label={`Delete glass tracking for ${order.orderId}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-destructive/20 px-2 text-[11px] font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-50" data-testid={`button-glass-delete-${order.orderRecordId}`}><Trash2 size={12} /> Delete</button>}
                              </div>
                            </td>
                          </tr>
                          {expanded && <tr className="border-b border-border/60 bg-muted/10"><td colSpan={7} className="p-3 sm:p-4">{editor(order)}</td></tr>}
                          {editingOrderId === order.orderRecordId && <tr className="border-b border-border/60 bg-muted/10"><td colSpan={7} className="p-3 sm:p-4"><GlassTrackingItemEditor key={order.orderRecordId} orderId={order.orderId} items={order.items} isSaving={updateDetails.isPending && updateDetails.variables?.id === order.orderRecordId} onSave={(items) => saveDetails(order, items)} onCancel={() => setEditingOrderId(null)} /></td></tr>}
                        </Fragment>;
                      })}</tbody>
                    </table></div>
                      : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filteredOrders.map((order) => {
                        const expanded = expandedOrderId === order.orderRecordId;
                        return <article key={order.orderRecordId} className="glass-order-card rounded-xl border border-border/75 bg-card p-4 shadow-sm" data-testid={`card-glass-order-${order.orderRecordId}`}>
                          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-xs font-bold text-primary">{order.orderId}</p><p className="mt-1 truncate text-sm font-semibold">{order.clientName}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{order.locationName}</p></div><StatusBadge status={order.status} id={order.orderRecordId} /></div>
                          <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-border/60 pt-3 text-xs">
                            <div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Invoice No.</p><p className="mt-1 truncate font-semibold" title={order.invoiceFilename ?? undefined}>{order.invoiceNo ?? invoiceFilenameStem(order.invoiceFilename) ?? 'Invoice Upload Pending'}</p></div>
                            <div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Glass details</p><p className="mt-1 truncate font-semibold">{order.glassInputFilename ? `Workbook revision ${order.glassInputRevision}` : order.items.length ? 'Manual entry' : 'Glass Input Pending'}</p></div>
                            <div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Ordered</p><p className="mt-1 font-mono font-semibold">{formatCount(order.ordered)}</p></div>
                            <div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Received · Broken</p><p className="mt-1 font-mono font-semibold">{formatCount(order.received)} · {formatCount(order.broken)}</p></div>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button type="button" onClick={() => { setEditingOrderId(null); setExpandedOrderId(expanded ? null : order.orderRecordId); }} aria-expanded={expanded} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-semibold hover:bg-muted" data-testid={`button-glass-details-${order.orderRecordId}`}>{expanded ? 'Hide window details' : 'View window details'}{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>
                            {canEdit && <button type="button" onClick={() => { setExpandedOrderId(null); setEditingOrderId(editingOrderId === order.orderRecordId ? null : order.orderRecordId); }} aria-expanded={editingOrderId === order.orderRecordId} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/20 px-2.5 text-[11px] font-semibold text-primary hover:bg-primary/5" data-testid={`button-glass-edit-${order.orderRecordId}`}><Pencil size={12} /> {editingOrderId === order.orderRecordId ? 'Close editor' : 'Edit'}</button>}
                            {canEdit && (order.glassInputFilename || order.items.length > 0) && <button type="button" onClick={() => removeTracking(order)} disabled={deleteTracking.isPending} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-destructive/20 px-2.5 text-[11px] font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-50" data-testid={`button-glass-delete-${order.orderRecordId}`}><Trash2 size={12} /> Delete</button>}
                          </div>
                          {expanded && <div className="mt-3">{editor(order)}</div>}
                          {editingOrderId === order.orderRecordId && <div className="mt-3"><GlassTrackingItemEditor key={order.orderRecordId} orderId={order.orderId} items={order.items} isSaving={updateDetails.isPending && updateDetails.variables?.id === order.orderRecordId} onSave={(items) => saveDetails(order, items)} onCancel={() => setEditingOrderId(null)} /></div>}
                        </article>;
                      })}</div>}
        </div>
      </section>
    </div>
  </AppShell>;
}
