import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownUp, Check, Clock3, LayoutGrid, List, MapPin, PackageCheck, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import {
  getGetGlassTrackingQueryKey,
  getListOrderActivityQueryKey,
  getListOrderWindowsQueryKey,
  OrderGlassStatus,
  useGetGlassTracking,
  useUpdateOrderWindow,
} from '@workspace/api-client-react';
import type { GlassTrackingWindow, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { useToast } from '@/hooks/use-toast';

type GlassStatus = (typeof OrderGlassStatus)[keyof typeof OrderGlassStatus];
type SortValue = 'updated' | 'order' | 'client' | 'window' | 'status' | 'area';
type ViewMode = 'list' | 'grid';

const STATUS_OPTIONS: { value: GlassStatus; label: string; tone: string; dot: string }[] = [
  { value: OrderGlassStatus.pending, label: 'Pending', tone: 'bg-amber-100 text-amber-900 ring-amber-200', dot: 'bg-amber-500' },
  { value: OrderGlassStatus.partial, label: 'Partial', tone: 'bg-sky-100 text-sky-900 ring-sky-200', dot: 'bg-sky-600' },
  { value: OrderGlassStatus.received, label: 'Received', tone: 'bg-emerald-100 text-emerald-900 ring-emerald-200', dot: 'bg-emerald-600' },
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
  return <div className="space-y-2" aria-label="Loading glass tracking records" data-testid="state-glass-loading">
    {[0, 1, 2, 3].map((item) => <div key={item} className="grid animate-pulse grid-cols-1 gap-4 rounded-xl border border-border/70 bg-card p-4 md:grid-cols-[1.1fr_1fr_.8fr_.8fr_auto]">
      <div className="space-y-2"><div className="h-4 w-28 rounded bg-muted" /><div className="h-3 w-36 rounded bg-muted/70" /></div>
      <div className="h-4 w-32 rounded bg-muted/70" /><div className="h-4 w-24 rounded bg-muted/70" /><div className="h-4 w-20 rounded bg-muted/70" /><div className="h-8 w-24 rounded-lg bg-muted/70" />
    </div>)}
  </div>;
}

function GlassRow({ item, canEdit, busy, onChange }: {
  item: GlassTrackingWindow;
  canEdit: boolean;
  busy: boolean;
  onChange: (item: GlassTrackingWindow, status: GlassStatus) => void;
}) {
  return <tr className="border-b border-border/60 last:border-0 hover:bg-muted/25" data-testid={`row-glass-window-${item.windowId}`}>
    <td className="px-4 py-3">
      <p className="font-mono text-xs font-bold text-primary" data-testid={`text-glass-order-${item.windowId}`}>{item.orderId}</p>
      <p className="mt-1 max-w-[220px] truncate text-xs font-semibold" title={item.clientName}>{item.clientName}</p>
    </td>
    <td className="px-4 py-3">
      <p className="text-xs font-semibold">{item.locationName}</p>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.locationCode}</p>
    </td>
    <td className="px-4 py-3">
      <p className="text-xs font-semibold">{item.windowNo} <span className="font-normal text-muted-foreground">· {item.windowType}</span></p>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.widthMm} × {item.heightMm} mm</p>
    </td>
    <td className="px-4 py-3 font-mono text-xs" data-testid={`text-glass-area-${item.windowId}`}>{item.sqFt.toFixed(2)} sq ft</td>
    <td className="px-4 py-3">
      {canEdit ? <label className="sr-only" htmlFor={`glass-status-${item.windowId}`}>Glass status for order {item.orderId}, window {item.windowNo}</label> : null}
      {canEdit ? <select id={`glass-status-${item.windowId}`} value={item.glassStatus} disabled={busy} onChange={(event) => onChange(item, event.target.value as GlassStatus)} className="h-9 min-w-32 rounded-lg border border-input bg-background px-2.5 text-xs font-semibold disabled:cursor-wait disabled:opacity-60" data-testid={`select-glass-status-${item.windowId}`}>
        {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select> : <StatusBadge status={item.glassStatus} id={item.windowId} />}
    </td>
  </tr>;
}

function GlassCard({ item, canEdit, busy, onChange }: {
  item: GlassTrackingWindow;
  canEdit: boolean;
  busy: boolean;
  onChange: (item: GlassTrackingWindow, status: GlassStatus) => void;
}) {
  return <article className="rounded-xl border border-border/75 bg-card p-4 shadow-sm transition-shadow hover:shadow-md" data-testid={`card-glass-window-${item.windowId}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-mono text-xs font-bold text-primary">{item.orderId}</p>
        <p className="mt-1 truncate text-sm font-semibold">{item.clientName}</p>
      </div>
      <StatusBadge status={item.glassStatus} id={item.windowId} />
    </div>
    <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-border/60 pt-3 text-xs">
      <div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Window</p><p className="mt-1 font-semibold">{item.windowNo} · {item.windowType}</p></div>
      <div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Area</p><p className="mt-1 font-mono">{item.sqFt.toFixed(2)} sq ft</p></div>
      <div className="col-span-2 flex items-start gap-2"><MapPin size={13} className="mt-0.5 shrink-0 text-primary" /><span>{item.locationName} <span className="font-mono text-muted-foreground">({item.locationCode})</span></span></div>
      <div className="col-span-2 font-mono text-[10px] text-muted-foreground">{item.widthMm} × {item.heightMm} mm</div>
    </div>
    {canEdit && <div className="mt-4 border-t border-border/60 pt-3">
      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor={`glass-status-${item.windowId}`}>Glass status</label>
      <select id={`glass-status-${item.windowId}`} value={item.glassStatus} disabled={busy} onChange={(event) => onChange(item, event.target.value as GlassStatus)} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs font-semibold disabled:cursor-wait disabled:opacity-60" data-testid={`select-glass-status-${item.windowId}`}>
        {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>}
  </article>;
}

export default function GlassTrackingPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const permission = user.permissions?.['glass-procurement'];
  const canView = user.roleId === 'master-admin' || permission === 'view' || permission === 'edit';
  const canEdit = user.roleId === 'master-admin' || permission === 'edit';
  const trackingQuery = useGetGlassTracking({ query: { queryKey: getGetGlassTrackingQueryKey(), enabled: canView } });
  const updateWindow = useUpdateOrderWindow();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [sort, setSort] = useState<SortValue>('updated');
  const [view, setView] = useState<ViewMode>('list');
  const windows = trackingQuery.data || [];
  const locations = useMemo(() => [...new Map(windows.map((item) => [item.locationCode, item.locationName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])), [windows]);

  const filteredWindows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const result = windows.filter((item) => {
      const matchesSearch = !needle || [item.orderId, item.clientName, item.locationName, item.locationCode, item.windowNo, item.windowType]
        .some((value) => value.toLocaleLowerCase().includes(needle));
      return matchesSearch
        && (statusFilter === 'all' || item.glassStatus === statusFilter)
        && (locationFilter === 'all' || item.locationCode === locationFilter);
    });
    return result.sort((a, b) => {
      if (sort === 'order') return a.orderId.localeCompare(b.orderId, undefined, { numeric: true, sensitivity: 'base' });
      if (sort === 'client') return a.clientName.localeCompare(b.clientName, undefined, { sensitivity: 'base' });
      if (sort === 'window') return a.windowNo.localeCompare(b.windowNo, undefined, { numeric: true, sensitivity: 'base' });
      if (sort === 'status') {
        const statusOrder: Record<GlassStatus, number> = {
          [OrderGlassStatus.pending]: 0,
          [OrderGlassStatus.partial]: 1,
          [OrderGlassStatus.received]: 2,
        };
        return statusOrder[a.glassStatus] - statusOrder[b.glassStatus];
      }
      if (sort === 'area') return b.sqFt - a.sqFt;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [windows, search, statusFilter, locationFilter, sort]);

  const counts = useMemo(() => ({
    pending: windows.filter((item) => item.glassStatus === OrderGlassStatus.pending).length,
    partial: windows.filter((item) => item.glassStatus === OrderGlassStatus.partial).length,
    received: windows.filter((item) => item.glassStatus === OrderGlassStatus.received).length,
  }), [windows]);

  const changeStatus = (item: GlassTrackingWindow, glassStatus: GlassStatus) => {
    if (!canEdit || glassStatus === item.glassStatus) return;
    updateWindow.mutate({ id: item.orderRecordId, windowId: item.windowId, data: { glassStatus } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetGlassTrackingQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListOrderWindowsQueryKey(item.orderRecordId) });
        void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(item.orderRecordId) });
        toast({ title: 'Glass status updated', description: `${item.orderId} · window ${item.windowNo} marked ${statusLabel(glassStatus).toLowerCase()}.` });
      },
      onError: () => toast({ title: 'Could not update glass status', description: 'The previous status is unchanged. Try again.', variant: 'destructive' }),
    });
  };

  const clearFilters = () => { setSearch(''); setStatusFilter('all'); setLocationFilter('all'); };
  const hasFilters = Boolean(search || statusFilter !== 'all' || locationFilter !== 'all');

  return <AppShell user={user} title="Glass Tracking" eyebrow="Module · glass tracking">
    <div className="mx-auto w-full max-w-[1440px] space-y-5 pb-8">
      <section className="order-hub-accent relative overflow-hidden rounded-2xl border border-primary/10 px-5 py-5 shadow-sm md:px-7 md:py-6">
        <div className="absolute -right-8 -top-12 h-48 w-48 rounded-full border border-primary/15" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Framewise operations <span className="text-muted-foreground/70">/</span> procurement desk</div>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.05em] text-foreground md:text-[2.6rem]">Glass, accounted for.</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Track each opening from supplier delivery through receipt, against the order and its installation location.</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-primary/15 bg-white/45 px-3.5 py-3">
            <PackageCheck size={17} className="text-primary" />
            <div><p className="font-display text-xl font-bold leading-none" data-testid="metric-glass-total">{trackingQuery.isLoading ? '—' : windows.length}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Window records</p></div>
          </div>
        </div>
      </section>

      {canView && <section aria-label="Glass status totals" className="grid grid-cols-3 gap-2 sm:gap-3">
        {STATUS_OPTIONS.map((option, index) => {
          const Icon = index === 0 ? Clock3 : index === 1 ? ArrowDownUp : Check;
          return <button key={option.value} type="button" onClick={() => setStatusFilter(statusFilter === option.value ? 'all' : option.value)} className={`rounded-xl border bg-card px-3 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:px-4 sm:py-4 ${statusFilter === option.value ? 'border-primary/40 ring-2 ring-primary/10' : 'border-border/80'}`} data-testid={`filter-glass-${option.value}`} aria-pressed={statusFilter === option.value}>
            <div className="flex items-center justify-between gap-2"><span className="truncate text-[9px] font-bold uppercase tracking-[0.11em] text-muted-foreground sm:text-[10px]">{option.label}</span><Icon size={15} className="shrink-0 text-primary/75" /></div>
            <div className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl" data-testid={`metric-glass-${option.value}`}>{trackingQuery.isLoading ? '—' : counts[option.value]}</div>
            <div className="mt-1 hidden text-[10px] text-muted-foreground sm:block">{statusFilter === option.value ? 'Showing this stage' : 'Window records'}</div>
          </button>;
        })}
      </section>}

      <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
        <div className="border-b border-border/75 p-4 md:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><div className="flex items-center gap-2"><span className="h-5 w-1 rounded-full bg-primary" /><h2 className="font-display text-lg font-bold tracking-tight">Glass register</h2><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground" data-testid="text-glass-count">{filteredWindows.length} / {windows.length}</span></div><p className="ml-3 mt-1 text-xs text-muted-foreground">Search by order, client, location, opening number, or window type.</p></div>
            {canView && !canEdit && <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-900"><ShieldCheck size={13} /> View-only access</span>}
          </div>
          {canView && <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(200px,1fr)_170px_190px_auto]">
            <label className="relative block">
              <span className="sr-only">Search glass tracking</span><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search orders, clients, windows…" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10" data-testid="input-glass-search" />
            </label>
            <label className="sr-only" htmlFor="glass-location-filter">Filter by location</label>
            <select id="glass-location-filter" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} className="h-10 rounded-lg border border-input bg-background px-3 text-xs" data-testid="select-glass-location">
              <option value="all">All locations</option>{locations.map(([code, name]) => <option key={code} value={code}>{name} · {code}</option>)}
            </select>
            <label className="sr-only" htmlFor="glass-sort">Sort glass records</label>
            <select id="glass-sort" value={sort} onChange={(event) => setSort(event.target.value as SortValue)} className="h-10 rounded-lg border border-input bg-background px-3 text-xs" data-testid="select-glass-sort">
              <option value="updated">Recently updated</option><option value="order">Order ID</option><option value="client">Client</option><option value="window">Window number</option><option value="status">Glass status</option><option value="area">Area · largest first</option>
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
                : windows.length === 0 ? <div className="rounded-xl border border-dashed border-border p-8 text-center" data-testid="state-glass-empty"><PackageCheck size={22} className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm font-semibold">No glass records yet</p><p className="mt-1 text-xs text-muted-foreground">Active order windows will appear here when they are available for procurement.</p></div>
                  : filteredWindows.length === 0 ? <div className="rounded-xl border border-dashed border-border p-8 text-center" data-testid="state-glass-no-results"><p className="text-sm font-semibold">No matching windows</p><p className="mt-1 text-xs text-muted-foreground">Adjust the search or filters to see more glass records.</p>{hasFilters && <button type="button" onClick={clearFilters} className="mt-3 text-xs font-bold text-primary hover:underline" data-testid="button-glass-clear-filters">Clear all filters</button>}</div>
                    : view === 'list' ? <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead><tr className="border-b border-border/70 text-[10px] uppercase tracking-[0.13em] text-muted-foreground"><th className="px-4 py-3">Order / client</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Window</th><th className="px-4 py-3">Area</th><th className="px-4 py-3">Glass status</th></tr></thead><tbody>{filteredWindows.map((item) => <GlassRow key={item.windowId} item={item} canEdit={canEdit} busy={updateWindow.isPending} onChange={changeStatus} />)}</tbody></table></div>
                      : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filteredWindows.map((item) => <GlassCard key={item.windowId} item={item} canEdit={canEdit} busy={updateWindow.isPending} onChange={changeStatus} />)}</div>}
        </div>
      </section>
    </div>
  </AppShell>;
}