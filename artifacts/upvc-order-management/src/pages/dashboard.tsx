import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { Link, useLocation } from 'wouter';
import {
  Activity, AlertCircle, ArrowUpRight, CalendarDays, Check, ChevronDown,
  CircleDollarSign, Clock3, Download, Factory, FileSpreadsheet, Filter, Gauge, Layers3,
  Moon, PackageCheck, Printer, RefreshCw, Search, Sun, Truck, Users, Wrench, X,
} from 'lucide-react';
import {
  getGetOperationsDashboardQueryKey, useGetOperationsDashboard,
} from '@workspace/api-client-react';
import type { GetOperationsDashboardParams, OperationsDashboard, User } from '@workspace/api-client-react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AppShell } from '@/components/app-shell';

type Filters = GetOperationsDashboardParams;
const MINUTE = 60_000;
const intervals = [
  { label: '5 minutes', value: 5 * MINUTE },
  { label: '15 minutes', value: 15 * MINUTE },
  { label: '1 hour', value: 60 * MINUTE },
  { label: '24 hours', value: 24 * 60 * MINUTE },
];
const statusColors: Record<string, string> = {
  quotation_stage: '#be8150', confirmed: '#5d82a1', in_production: '#247d70',
  ready: '#5d9a6e', dispatched: '#bb8b3e', installed: '#6b7d91',
};
const statusNames: Record<string, string> = {
  quotation_stage: 'Quotation', confirmed: 'Confirmed', in_production: 'In production',
  ready: 'Ready', dispatched: 'Dispatched', installed: 'Installed',
};
const currency = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const number = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('en-IN').format(value);
const localDay = (date: Date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 10);
};
function initialFilters(): Filters {
  const params = new URLSearchParams(window.location.search);
  const today = new Date();
  const from = params.get('from') || localDay(new Date(today.getFullYear(), today.getMonth(), 1));
  const to = params.get('to') || localDay(today);
  const stage = params.get('stage') as Filters['stage'];
  const paymentStatus = params.get('paymentStatus') as Filters['paymentStatus'];
  const assignment = params.get('assignment') as Filters['assignment'];
  const glassStatus = params.get('glassStatus') as Filters['glassStatus'];
  return {
    from, to,
    ...(params.get('q') ? { q: params.get('q')! } : {}),
    ...(stage ? { stage } : {}),
    ...(params.get('clientId') ? { clientId: params.get('clientId')! } : {}),
    ...(params.get('locationCode') ? { locationCode: params.get('locationCode')! } : {}),
    ...(params.get('installerId') ? { installerId: params.get('installerId')! } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(assignment ? { assignment } : {}),
    ...(glassStatus ? { glassStatus } : {}),
    ...(params.get('compare') === 'true' ? { compare: true } : {}),
  };
}
function saveFilters(filters: Filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== false) params.set(key, String(value));
  });
  const next = `${window.location.pathname}${params.size ? `?${params}` : ''}`;
  window.history.replaceState(window.history.state, '', next);
}
function downloadCsv(filename: string, rows: Array<Record<string, string | number | null>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [headers.map(quote).join(','), ...rows.map((row) => headers.map((head) => quote(row[head])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
}
function relativeTime(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(value));
}
function trendBucketRange(bucket: string, from: string, to: string) {
  const dayCount = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  let bucketEnd = bucket;
  if (dayCount > 93) {
    const nextMonth = new Date(`${bucket}T00:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    nextMonth.setUTCDate(0);
    bucketEnd = nextMonth.toISOString().slice(0, 10);
  } else if (dayCount > 31) {
    const end = new Date(`${bucket}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    bucketEnd = end.toISOString().slice(0, 10);
  }
  return {
    from: bucket < from ? from : bucket,
    to: bucketEnd > to ? to : bucketEnd,
  };
}
function SectionHeading({ eyebrow, title, icon: Icon, count }: { eyebrow: string; title: string; icon: typeof Activity; count?: string }) {
  return <div className="mb-4 flex items-center gap-3">
    <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Icon size={17} /></span>
    <div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-primary">{eyebrow}</p><h2 className="mt-0.5 font-display text-lg font-semibold tracking-tight">{title}</h2></div>
    {count && <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{count}</span>}
  </div>;
}
function SectionState({ error, loading, empty, retry }: { error?: string | null; loading: boolean; empty: boolean; retry: () => void }) {
  if (loading) return <div className="space-y-3 p-4"><div className="h-3 w-1/3 animate-pulse rounded bg-muted" /><div className="h-36 animate-pulse rounded-xl bg-muted/70" /></div>;
  if (error) return <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-destructive/30 bg-destructive/[.035] p-5 text-center"><AlertCircle size={18} className="text-destructive" /><p className="text-sm font-semibold">This section could not load</p><p className="max-w-lg text-xs text-muted-foreground">{error}</p><button onClick={retry} className="text-xs font-semibold text-primary hover:underline">Retry section</button></div>;
  if (empty) return <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center"><span className="grid size-9 place-items-center rounded-full bg-secondary text-secondary-foreground"><Layers3 size={16} /></span><p className="mt-3 text-sm font-semibold">Nothing in this view</p><p className="mt-1 text-xs text-muted-foreground">Try widening the date range or clearing a filter.</p></div>;
  return null;
}
function Metric({ label, value, note, icon: Icon, tint, previous, onClick }: { label: string; value: string; note: string; icon: typeof Activity; tint: string; previous?: string; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className="group min-w-0 rounded-2xl border border-border/80 bg-card p-4 text-left transition-colors hover:border-primary/35 hover:bg-primary/[.025] md:p-5" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>
    <div className="flex items-start justify-between gap-3"><p className="text-[11px] font-semibold uppercase tracking-[.12em] text-muted-foreground">{label}</p><span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `${tint}14`, color: tint }}><Icon size={16} /></span></div>
    <p className="mt-4 truncate font-display text-[25px] font-semibold leading-none tracking-[-.04em] tabular-nums md:text-[29px]">{value}</p>
    <div className="mt-3 flex min-h-4 items-center justify-between gap-2 text-[10px] text-muted-foreground"><span className="truncate">{note}</span>{previous && <span className="shrink-0 font-mono text-[10px]">{previous}</span>}</div>
  </button>;
}
function ChartFrame({ children, title, detail, onExport }: { children: React.ReactNode; title: string; detail: string; onExport: () => void }) {
  return <section className="rounded-2xl border border-border/80 bg-card p-4 md:p-5"><div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="font-display text-[15px] font-semibold">{title}</h3><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div><button type="button" aria-label={`Export ${title} CSV`} onClick={onExport} className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" data-testid={`button-export-${title.toLowerCase().replaceAll(' ', '-')}`}><Download size={14} /></button></div>{children}</section>;
}

export default function DashboardPage({ user }: { user: User }) {
  const [location, setLocation] = useLocation();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [searchDraft, setSearchDraft] = useState(filters.q || '');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalMs, setIntervalMs] = useState(intervals[0].value);
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { setTheme, resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const params = useMemo(() => filters, [filters]);
  const query = useGetOperationsDashboard(params, {
    query: { queryKey: getGetOperationsDashboardQueryKey(params), refetchInterval: autoRefresh ? intervalMs : false, refetchOnWindowFocus: false },
  });
  const data = query.data as OperationsDashboard | undefined;
  const permissions = data?.permissions;
  const loading = query.isLoading || (query.isFetching && !query.data);
  const updated = query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : data?.updatedAt ? new Date(data.updatedAt) : null;

  useEffect(() => { saveFilters(filters); }, [filters]);
  useEffect(() => {
    const id = window.setTimeout(() => setFilters((current) => ({ ...current, ...(searchDraft ? { q: searchDraft } : { q: undefined }) })), 280);
    return () => window.clearTimeout(id);
  }, [searchDraft]);
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setFilters((current) => {
      const keys = ['from', 'to', 'q', 'stage', 'clientId', 'locationCode', 'installerId', 'paymentStatus', 'assignment', 'glassStatus', 'compare'];
      const changed = keys.some((key) => (search.get(key) || '') !== String((current as Record<string, unknown>)[key] || ''));
      return changed && location === '/' ? initialFilters() : current;
    });
  }, [location]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K] | undefined) => setFilters((current) => {
    const next = { ...current, [key]: value };
    if (value === '' || value === undefined || value === false) delete (next as Record<string, unknown>)[key];
    return next;
  });
  const clearFilters = () => { setSearchDraft(''); setFilters({ from: localDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: localDay(new Date()) }); };
  const choosePreset = (days: number | 'month' | 'year') => {
    const today = new Date();
    const from = days === 'month' ? new Date(today.getFullYear(), today.getMonth(), 1) : days === 'year' ? new Date(today.getFullYear(), 0, 1) : new Date(Date.now() - (days - 1) * 86_400_000);
    setFilter('from', localDay(from)); setFilter('to', localDay(today));
  };
  const refresh = () => { void query.refetch(); };
  const navigateRoute = (path: string) => setLocation(path);
  const statusFromLabel = (status: string) => statusNames[status] || status.replaceAll('_', ' ');
  const activeFilterCount = Object.keys(filters).filter((key) => !['from', 'to', 'compare'].includes(key)).length + (filters.compare ? 1 : 0);
  const previous = data?.summary.previousPeriod;
  const delta = (value: number | null, before: number | null | undefined) => value == null || before == null ? undefined : `${value - before >= 0 ? '+' : ''}${number(value - before)} vs prior`;
  const errorFor = (key: keyof OperationsDashboard['sectionErrors']) => data?.sectionErrors[key];
  const dismissFilter = (key: keyof Filters) => { setFilter(key, undefined); if (key === 'q') setSearchDraft(''); };
  const sectionsAvailable = Boolean(permissions && Object.values(permissions).some(Boolean));
  const emptySearch = (data?.recentOrders.length ?? 0) === 0;
  const attentionItems = data?.attention.filter((item) => {
    if (!permissions) return false;
    const path = new URL(item.href, window.location.origin).pathname;
    if (path.startsWith('/payments') || path.startsWith('/balance-payment')) return permissions.finance;
    if (path.startsWith('/dispatch')) return permissions.dispatch;
    if (path.startsWith('/installation')) return permissions.installation;
    if (path.startsWith('/glass-procurement')) return permissions.glass;
    if (path.startsWith('/quotation')) return permissions.approvals;
    if (path.startsWith('/measurements')) return permissions.measurements;
    return permissions.orders;
  }) || [];
  const canSeeAttention = Boolean(permissions && Object.values(permissions).some(Boolean));
  const trendError = errorFor(permissions?.orders ? 'orders' : permissions?.readiness ? 'windows' : permissions?.installation ? 'installation' : 'finance');
  const trendCsv = (data?.trend || []).map((point) => ({
    date: point.bucket,
    ...(permissions?.orders ? { orders: point.orderCount } : {}),
    ...(permissions?.readiness ? { readyWindows: point.readyWindows, totalWindows: point.totalWindows } : {}),
    ...(permissions?.orders && permissions?.installation ? { installedOrders: point.installedOrders } : {}),
  }));
  const attentionError = [
    permissions?.orders && errorFor('orders'),
    permissions?.finance && errorFor('finance'),
    permissions?.dispatch && errorFor('dispatch'),
    permissions?.installation && errorFor('installation'),
    permissions?.glass && errorFor('glass'),
    permissions?.approvals && errorFor('approvals'),
    permissions?.measurements && errorFor('measurements'),
    permissions?.readiness && errorFor('windows'),
  ].find(Boolean) || null;

  return <AppShell user={user} title="Operations dashboard" eyebrow="Framewise · live workbench">
    <div className="mx-auto max-w-[1560px] space-y-5 pb-10">
      <header className="relative overflow-hidden rounded-[22px] border border-primary/20 bg-[linear-gradient(112deg,hsl(var(--card))_0%,hsl(var(--secondary)/.72)_55%,hsl(var(--primary)/.13)_100%)] px-5 py-5 md:px-7 md:py-6">
        <div className="pointer-events-none absolute -right-12 -top-24 size-72 rounded-full border border-primary/15" /><div className="pointer-events-none absolute right-16 top-10 size-28 rounded-full border border-primary/10" />
        <div className="relative flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
          <div className="max-w-2xl"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-primary"><span className="size-1.5 rounded-full bg-primary" /> WORK IN MOTION</p><h1 className="mt-2 font-display text-[27px] font-semibold tracking-[-.045em] md:text-[34px]">The floor, in focus.</h1><p className="mt-2 max-w-xl text-[13px] leading-5 text-muted-foreground">Order control from first confirmation through factory readiness, accounts and installation.</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-600" />Connected to live workspace data</span><span>{updated ? `Updated ${updated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Waiting for first update'}</span></div>
          </div>
          <div className="relative flex flex-wrap items-center gap-2 print:hidden">
            <div className="relative" ref={dropdownRef}>
              <div className="flex h-9 overflow-hidden rounded-lg border border-border bg-card/85 text-xs shadow-sm">
                <button onClick={refresh} disabled={query.isFetching} className="inline-flex items-center gap-2 px-3 font-semibold transition-colors hover:bg-secondary disabled:opacity-60" data-testid="button-refresh-dashboard"><RefreshCw size={14} className={query.isFetching ? 'animate-spin' : ''} />Refresh</button>
                <span className="my-2 w-px bg-border" />
                <button aria-label="Auto refresh options" onClick={() => setMenuOpen((open) => !open)} className="grid w-9 place-items-center transition-colors hover:bg-secondary" data-testid="button-auto-refresh-menu"><ChevronDown size={15} /></button>
              </div>
              {menuOpen && <div className="absolute right-0 top-11 z-40 w-56 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-xl">
                <button type="button" onClick={() => setAutoRefresh((value) => !value)} className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-xs hover:bg-muted"><span>Automatic refresh</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${autoRefresh ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{autoRefresh ? 'On' : 'Off'}</span></button>
                {intervals.map((option) => <button key={option.value} type="button" onClick={() => { setIntervalMs(option.value); setAutoRefresh(true); setMenuOpen(false); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><span>Every {option.label}</span>{intervalMs === option.value && autoRefresh && <Check size={13} className="text-primary" />}</button>)}
                <p className="border-t border-border px-3 pt-2 text-[10px] leading-4 text-muted-foreground">Polling is off until enabled. Minimum interval: 5 minutes.</p>
              </div>}
            </div>
            <button type="button" disabled={!data} onClick={() => window.print()} aria-label="Print dashboard" className="grid size-9 place-items-center rounded-lg border border-border bg-card/85 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50" data-testid="button-print-dashboard"><Printer size={15} /></button>
            <button type="button" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`} className="grid size-9 place-items-center rounded-lg border border-border bg-card/85 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" data-testid="button-toggle-theme">{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-border/80 bg-card p-4 md:p-5" aria-label="Dashboard filters">
        <div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Filter size={15} className="text-primary" /><h2 className="text-xs font-bold uppercase tracking-[.13em]">Operating view</h2>{activeFilterCount > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{activeFilterCount} active</span>}</div><button type="button" onClick={clearFilters} className="text-[11px] font-semibold text-muted-foreground transition-colors hover:text-primary" data-testid="button-clear-filters">Reset filters</button></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <label className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-3 xl:col-span-2"><span className="text-[10px] font-semibold text-muted-foreground">Search work</span><span className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:ring-1 focus-within:ring-ring"><Search size={14} className="shrink-0 text-muted-foreground" /><input aria-label="Search orders and clients" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Order, client or location" className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground" data-testid="input-dashboard-search" /></span></label>
          <label className="flex min-w-0 flex-col gap-1"><span className="text-[10px] font-semibold text-muted-foreground">From</span><input aria-label="From date" type="date" value={filters.from} max={filters.to} onChange={(event) => setFilter('from', event.target.value)} className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs" data-testid="input-filter-from" /></label>
          <label className="flex min-w-0 flex-col gap-1"><span className="text-[10px] font-semibold text-muted-foreground">To</span><input aria-label="To date" type="date" value={filters.to} min={filters.from} onChange={(event) => setFilter('to', event.target.value)} className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs" data-testid="input-filter-to" /></label>
          {permissions?.orders && <label className="flex min-w-0 flex-col gap-1"><span className="text-[10px] font-semibold text-muted-foreground">Order stage</span><select value={filters.stage || ''} onChange={(event) => setFilter('stage', (event.target.value || undefined) as Filters['stage'])} className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-stage"><option value="">All stages</option>{Object.entries(statusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
          {permissions?.orders && <label className="flex min-w-0 flex-col gap-1"><span className="text-[10px] font-semibold text-muted-foreground">Client</span><select value={filters.clientId || ''} onChange={(event) => setFilter('clientId', event.target.value || undefined)} className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-client"><option value="">All clients</option>{data?.filterOptions.clients.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}</select></label>}
          {permissions?.orders && <label className="flex min-w-0 flex-col gap-1"><span className="text-[10px] font-semibold text-muted-foreground">Location</span><select value={filters.locationCode || ''} onChange={(event) => setFilter('locationCode', event.target.value || undefined)} className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-location"><option value="">All locations</option>{data?.filterOptions.locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}</select></label>}
          {permissions?.installation && <label className="flex min-w-0 flex-col gap-1"><span className="text-[10px] font-semibold text-muted-foreground">Installer</span><select value={filters.installerId || ''} onChange={(event) => setFilter('installerId', event.target.value || undefined)} className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-installer"><option value="">All installers</option>{data?.filterOptions.installers.map((installer) => <option key={installer.id} value={installer.id}>{installer.label}</option>)}</select></label>}
          {permissions?.finance && <label className="flex min-w-0 flex-col gap-1"><span className="text-[10px] font-semibold text-muted-foreground">Payments</span><select value={filters.paymentStatus || ''} onChange={(event) => setFilter('paymentStatus', (event.target.value || undefined) as Filters['paymentStatus'])} className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-payment"><option value="">Any status</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="unpaid">Unpaid</option></select></label>}
          {permissions?.installation && <label className="flex min-w-0 flex-col gap-1"><span className="text-[10px] font-semibold text-muted-foreground">Assignment</span><select value={filters.assignment || ''} onChange={(event) => setFilter('assignment', (event.target.value || undefined) as Filters['assignment'])} className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-assignment"><option value="">Any assignment</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option></select></label>}
          {(permissions?.glass || permissions?.readiness) && <label className="flex min-w-0 flex-col gap-1"><span className="text-[10px] font-semibold text-muted-foreground">Glass readiness</span><select value={filters.glassStatus || ''} onChange={(event) => setFilter('glassStatus', (event.target.value || undefined) as Filters['glassStatus'])} className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-glass"><option value="">Any glass status</option><option value="untracked">Untracked</option><option value="pending">Pending</option><option value="partial">Partial</option><option value="received">Received</option><option value="broken">Broken</option></select></label>}
          <button type="button" onClick={() => setFilter('compare', !filters.compare)} aria-pressed={Boolean(filters.compare)} className={`flex h-9 items-center justify-center gap-2 self-end rounded-lg border px-2 text-xs font-semibold transition-colors ${filters.compare ? 'border-primary/30 bg-primary/10 text-primary' : 'border-input bg-background text-muted-foreground hover:bg-muted'}`} data-testid="button-toggle-compare"><span className={`grid size-4 place-items-center rounded border ${filters.compare ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{filters.compare && <Check size={11} />}</span>Compare prior</button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-3">
          <span className="mr-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground"><CalendarDays size={12} />Quick range</span>
          {[['7 days', 7], ['30 days', 30], ['90 days', 90], ['This month', 'month'], ['This year', 'year']].map(([label, days]) => <button key={String(label)} type="button" onClick={() => choosePreset(days as number | 'month' | 'year')} className="rounded-md px-2.5 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" data-testid={`button-preset-${String(label).toLowerCase().replaceAll(' ', '-')}`}>{label}</button>)}
          {filters.q && <button onClick={() => dismissFilter('q')} className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary">“{filters.q}” <X size={11} /></button>}
        </div>
      </section>

      {query.isError && !data ? <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-destructive/25 bg-card p-8 text-center"><AlertCircle size={25} className="text-destructive" /><h2 className="mt-3 font-display text-xl font-semibold">Live view unavailable</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">The operations dashboard did not respond. Your filters are saved in this URL; retry when ready.</p><button onClick={refresh} className="mt-4 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground" data-testid="button-retry-dashboard">Retry dashboard</button></div> : <>
        {permissions && <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {permissions.orders && <Metric label="Matching orders" value={loading ? '···' : number(data?.summary.activeOrders)} note="Created within selected dates" icon={Layers3} tint="#477b99" previous={filters.compare ? delta(data?.summary.activeOrders ?? null, previous?.activeOrders) : undefined} onClick={() => setFilter('stage', undefined)} />}
          {permissions.finance && <Metric label="Order value" value={loading ? '···' : currency(data?.summary.orderValue)} note="Recorded value for matching orders" icon={CircleDollarSign} tint="#b9853d" previous={filters.compare ? currency(previous?.orderValue) : undefined} onClick={() => navigateRoute('/payments')} />}
          {permissions.readiness && <Metric label="Window readiness" value={loading ? '···' : `${number(data?.summary.readyWindows)} / ${number(data?.summary.totalWindows)}`} note={`${data?.summary.readyWindowPercent == null ? '—' : `${data.summary.readyWindowPercent}%`} ready · current status`} icon={Gauge} tint="#247d70" previous={filters.compare ? `${number(previous?.readyWindows)} / ${number(previous?.totalWindows)} prior` : undefined} onClick={() => setFilter('glassStatus', 'pending')} />}
          {permissions.orders && permissions.installation && <Metric label="Installed orders" value={loading ? '···' : number(data?.summary.installedOrders)} note="Installed among matching orders" icon={PackageCheck} tint="#688c68" previous={filters.compare ? delta(data?.summary.installedOrders ?? null, previous?.installedOrders) : undefined} onClick={() => navigateRoute('/installation')} />}
          {permissions.finance && <Metric label="Outstanding balance" value={loading ? '···' : currency(data?.summary.outstandingBalance)} note="Known balance · not an overdue total" icon={CircleDollarSign} tint="#ad6653" previous={filters.compare ? currency(previous?.outstandingBalance) : undefined} onClick={() => navigateRoute('/balance-payment')} />}
        </section>}

        {permissions?.orders && <section className="rounded-2xl border border-border/80 bg-card p-4 md:p-5">
          <SectionHeading eyebrow="Order control" title="Work moving through the line" icon={Factory} count={loading ? '—' : `${data?.pipeline.reduce((sum, stage) => sum + stage.count, 0) ?? 0} orders`} />
          {loading || errorFor('orders') ? <SectionState loading={loading} error={errorFor('orders')} empty={false} retry={refresh} /> : data?.pipeline.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{data.pipeline.map((stage) => <button type="button" key={stage.status} onClick={() => setFilter('stage', stage.status)} className={`group rounded-xl border p-3.5 text-left transition-colors ${filters.stage === stage.status ? 'border-primary/40 bg-primary/[.06]' : 'border-border/70 bg-background hover:border-primary/35 hover:bg-primary/[.025]'}`} data-testid={`button-pipeline-${stage.status}`}><span className="mb-3 block h-1 w-8 rounded-full" style={{ backgroundColor: statusColors[stage.status] || '#247d70' }} /><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-muted-foreground">{stage.label || statusFromLabel(stage.status)}</p><div className="mt-1 flex items-end justify-between gap-2"><span className="font-display text-2xl font-semibold tabular-nums">{number(stage.count)}</span>{permissions.finance && <span className="text-[10px] text-muted-foreground">{currency(stage.orderValue)}</span>}</div></button>)}</div> : <SectionState loading={false} empty error={null} retry={refresh} />}
        </section>}

        {(permissions?.orders || permissions?.readiness) && <div className={`grid gap-4 ${permissions?.orders ? 'xl:grid-cols-[1.55fr_1fr]' : ''}`}>
          <div className="rounded-2xl border border-border/80 bg-card p-4 md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-primary">Throughput</p><h2 className="mt-1 font-display text-lg font-semibold">Orders & readiness trend</h2><p className="mt-1 text-[11px] text-muted-foreground">Orders are grouped by creation date; readiness shows their current state.</p></div><button onClick={() => downloadCsv('framewise-operations-trend.csv', trendCsv)} className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-secondary" aria-label="Export operations trend CSV" data-testid="button-export-trend"><Download size={14} /></button></div>
            {loading || trendError ? <SectionState loading={loading} error={trendError} empty={false} retry={refresh} /> : data?.trend.length ? <div className="h-[250px] w-full" role="img" aria-label="Orders and current window readiness over the selected date range"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.trend} margin={{ top: 8, right: 6, left: -18, bottom: 0 }} onClick={(event) => { if (event?.activeLabel) { const point = data.trend.find((item) => item.label === event.activeLabel || item.bucket === event.activeLabel); if (point) { const range = trendBucketRange(point.bucket, filters.from, filters.to); setFilter('from', range.from); setFilter('to', range.to); } } }}><CartesianGrid strokeDasharray="3 5" stroke="hsl(var(--border))" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} /><YAxis yAxisId="orders" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} allowDecimals={false} /><Tooltip cursor={{ fill: 'hsl(var(--primary) / .06)', stroke: 'none' }} contentStyle={{ borderRadius: 10, borderColor: 'hsl(var(--border))', backgroundColor: 'hsl(var(--card))', fontSize: 12 }} />{permissions.orders && <Bar yAxisId="orders" dataKey="orderCount" name="Orders" fill="#247d70" fillOpacity={0.76} radius={[4, 4, 0, 0]} isAnimationActive={false} />}{permissions.readiness && <Line yAxisId="orders" type="monotone" dataKey="readyWindows" name="Ready windows" stroke="#c18b46" strokeWidth={2} dot={false} isAnimationActive={false} />}{permissions.orders && permissions.installation && <Line yAxisId="orders" type="monotone" dataKey="installedOrders" name="Installed orders" stroke="#6987a0" strokeWidth={2} dot={false} isAnimationActive={false} />}</ComposedChart></ResponsiveContainer></div> : <SectionState loading={false} error={null} empty retry={refresh} />}
            {data?.trend.length && <div className="mt-2 flex flex-wrap gap-4 border-t border-border/70 pt-3 text-[10px] text-muted-foreground">{permissions.orders && <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-sm bg-[#247d70]" />Orders</span>}{permissions.readiness && <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#c18b46]" />Ready windows</span>}{permissions.installation && <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#6987a0]" />Installed orders</span>}</div>}
          </div>
          {canSeeAttention && <div className="rounded-2xl border border-border/80 bg-card p-4 md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-primary">Needs a hand</p><h2 className="mt-1 font-display text-lg font-semibold">Attention queue</h2></div><span className="grid size-8 place-items-center rounded-lg bg-amber-500/10 text-amber-700"><AlertCircle size={16} /></span></div>
            {loading || attentionError ? <SectionState loading={loading} error={attentionError} empty={false} retry={refresh} /> : attentionItems.length ? <div className="space-y-2">{attentionItems.map((item) => <button key={item.id} onClick={() => { const url = new URL(item.href, window.location.origin); if (['/order-hub', '/payments', '/balance-payment', '/dispatch', '/installation', '/glass-procurement', '/quotation-builder', '/quotation-approvals', '/measurements'].includes(url.pathname)) navigateRoute(`${url.pathname}${url.search}`); else navigateRoute('/order-hub'); }} className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-background p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/[.025]" data-testid={`button-attention-${item.id}`}><span className={`size-2 shrink-0 rounded-full ${item.severity === 'critical' ? 'bg-destructive' : item.severity === 'warning' ? 'bg-amber-500' : item.severity === 'success' ? 'bg-emerald-600' : 'bg-primary'}`} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{item.title}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{item.description}</span></span><span className="shrink-0 text-right"><span className="block font-mono text-sm font-semibold">{number(item.count)}</span>{permissions.finance && item.amount != null && <span className="text-[9px] text-muted-foreground">{currency(item.amount)}</span>}</span><ArrowUpRight size={13} className="shrink-0 text-muted-foreground" /></button>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} />}
          </div>}
        </div>}

        <div className="grid gap-4 xl:grid-cols-[1.35fr_.9fr]">
          {permissions?.dispatch && <section className="rounded-2xl border border-border/80 bg-card p-4 md:p-5"><SectionHeading eyebrow="Dispatch" title="Dispatch queue" icon={Truck} count={number(data?.dispatchQueue.length)} />
            {loading || errorFor('dispatch') || errorFor('orders') ? <SectionState loading={loading} error={errorFor('dispatch') || errorFor('orders')} empty={false} retry={refresh} /> : data?.dispatchQueue.length ? <div className="space-y-1">{data.dispatchQueue.slice(0, 5).map((order) => <button key={order.id} onClick={() => navigateRoute('/dispatch')} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-primary/[.04]" data-testid={`button-dispatch-order-${order.id}`}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Truck size={15} /></span><span className="min-w-0 flex-1"><span className="block truncate font-mono text-[10px] font-semibold text-primary">{order.orderId}</span><span className="mt-0.5 block truncate text-xs">{order.clientName} · {order.locationName}</span></span><span className={`rounded-full px-2 py-1 text-[9px] font-semibold capitalize ${order.dispatchStatus === 'dispatched' || order.dispatchStatus === 'delivered' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>{order.dispatchStatus.replaceAll('_', ' ')}</span></button>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} />}
            <Link href="/dispatch" className="mt-3 flex items-center justify-between border-t border-border/70 pt-3 text-[11px] font-semibold text-primary hover:underline" data-testid="link-dashboard-dispatch">Open dispatch desk <ArrowUpRight size={13} /></Link>
          </section>}
          {permissions?.orders && <section className="rounded-2xl border border-border/80 bg-card p-4 md:p-5">
            <SectionHeading eyebrow="Latest movement" title="Recent orders" icon={Layers3} count={loading ? '—' : number(data?.recentOrders.length)} />
            {loading || errorFor('orders') ? <SectionState loading={loading} error={errorFor('orders')} empty={false} retry={refresh} /> : emptySearch ? <SectionState loading={false} error={null} empty retry={refresh} /> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead><tr className="border-b border-border text-[9px] font-bold uppercase tracking-[.12em] text-muted-foreground"><th className="pb-2 pr-3">Order / client</th><th className="pb-2 pr-3">Stage</th><th className="pb-2 pr-3">Windows</th><th className="pb-2 pr-3">Fulfillment</th>{permissions.finance && <th className="pb-2 text-right">Value</th>}</tr></thead><tbody>{data?.recentOrders.map((order) => <tr key={order.id} className="group cursor-pointer border-b border-border/60 last:border-0 hover:bg-primary/[.025]" onClick={() => navigateRoute(`/order-hub/${encodeURIComponent(order.id)}`)} data-testid={`row-dashboard-order-${order.id}`}><td className="py-3 pr-3"><span className="block font-mono text-[11px] font-semibold text-primary">{order.orderId}</span><span className="mt-0.5 block max-w-[190px] truncate text-xs font-medium">{order.clientName}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{order.locationName}</span></td><td className="py-3 pr-3"><span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/75 px-2 py-1 text-[10px] font-semibold"><i className="size-1.5 rounded-full" style={{ backgroundColor: statusColors[order.status] || '#247d70' }} />{statusFromLabel(order.status)}</span></td><td className="py-3 pr-3"><span className="font-mono text-xs">{number(order.readyWindows)}<span className="text-muted-foreground"> / {number(order.totalWindows)}</span></span><div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${order.totalWindows ? Math.min(100, order.readyWindows / order.totalWindows * 100) : 0}%` }} /></div></td><td className="py-3 pr-3"><span className="block text-[10px] capitalize text-muted-foreground">{order.dispatchStatus?.replaceAll('_', ' ') ?? '—'}</span><span className="mt-1 block text-[10px] capitalize">{order.installationStatus ?? '—'}</span></td>{permissions.finance && <td className="py-3 text-right font-mono text-xs">{currency(order.orderValue)}</td>}</tr>)}</tbody></table></div>}
          </section>}
          <div className="space-y-4">
            {permissions?.finance && <section className="rounded-2xl border border-border/80 bg-card p-4 md:p-5"><SectionHeading eyebrow="Accounts" title="Payment follow-through" icon={CircleDollarSign} count={number(data?.reminderCandidates.length)} />
              {loading || errorFor('finance') || errorFor('orders') ? <SectionState loading={loading} error={errorFor('finance') || errorFor('orders')} empty={false} retry={refresh} /> : data?.reminderCandidates.length ? <div className="space-y-2">{data.reminderCandidates.slice(0, 5).map((candidate) => <div key={candidate.orderRecordId} className="flex items-center gap-3 rounded-xl border border-border/70 bg-background p-3"><button onClick={() => { setFilter('paymentStatus', 'unpaid'); setFilter('q', candidate.orderId); setSearchDraft(candidate.orderId); }} className="min-w-0 flex-1 text-left" data-testid={`button-reminder-candidate-${candidate.orderRecordId}`}><span className="block truncate font-mono text-[10px] font-semibold text-primary">{candidate.orderId} · {candidate.clientName}</span><span className="mt-1 block truncate text-[10px] text-muted-foreground">{candidate.locationName}</span></button><span className="shrink-0 text-right"><span className="block font-mono text-xs font-semibold">{currency(candidate.balance)}</span><span className="text-[9px] text-muted-foreground">open balance</span></span><form method="post" action={`/api/orders/${encodeURIComponent(candidate.orderRecordId)}/payment-reminder`} target="_blank" rel="noreferrer"><button type="submit" disabled={!candidate.canOpenWhatsApp} title={candidate.canOpenWhatsApp ? 'Open a WhatsApp reminder draft for staff review' : 'This order is not ready for a WhatsApp reminder'} className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40" aria-label={`Open WhatsApp reminder draft for ${candidate.orderId}`} data-testid={`button-dashboard-reminder-${candidate.orderRecordId}`}><Activity size={14} /></button></form></div>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} />}
              <Link href="/payments" className="mt-3 flex items-center justify-between border-t border-border/70 pt-3 text-[11px] font-semibold text-primary hover:underline" data-testid="link-dashboard-payments">Open payments <ArrowUpRight size={13} /></Link>
            </section>}
            {permissions?.installation && <section className="rounded-2xl border border-border/80 bg-card p-4 md:p-5"><SectionHeading eyebrow="Field work" title="Installation schedule" icon={Wrench} count={number(data?.installationSchedule.length)} />
              {loading || errorFor('installation') ? <SectionState loading={loading} error={errorFor('installation')} empty={false} retry={refresh} /> : data?.installationSchedule.length ? <div className="space-y-2">{data.installationSchedule.slice(0, 5).map((item) => <button key={item.orderRecordId} onClick={() => { setFilter('q', item.orderId); setSearchDraft(item.orderId); navigateRoute('/installation'); }} className="flex w-full items-start gap-3 rounded-xl border border-border/70 bg-background p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/[.025]" data-testid={`button-installation-schedule-${item.orderRecordId}`}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><CalendarDays size={15} /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[10px] font-semibold text-primary">{item.orderId}</span><span className="text-[10px] text-muted-foreground">{item.scheduledDate}</span></span><span className="mt-1 block truncate text-xs font-medium">{item.clientName}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{item.teamName || 'Team pending'}{item.subteamName ? ` · ${item.subteamName}` : ''}{item.assignedMembers.length ? ` · ${item.assignedMembers.join(', ')}` : ''}</span></span><span className={`mt-1 size-2 shrink-0 rounded-full ${item.status === 'installed' ? 'bg-emerald-600' : item.status === 'issue' ? 'bg-destructive' : 'bg-amber-500'}`} /></button>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} />}
              <Link href="/installation" className="mt-3 flex items-center justify-between border-t border-border/70 pt-3 text-[11px] font-semibold text-primary hover:underline" data-testid="link-dashboard-installation">Open installation desk <ArrowUpRight size={13} /></Link>
            </section>}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          {permissions?.orders && <section className="rounded-2xl border border-border/80 bg-card p-4 md:p-5"><SectionHeading eyebrow="Relationships" title="Top clients" icon={Users} count={number(data?.topClients.length)} />
            {loading || errorFor('orders') ? <SectionState loading={loading} error={errorFor('orders')} empty={false} retry={refresh} /> : data?.topClients.length ? <div className="space-y-1">{data.topClients.slice(0, 6).map((client, index) => <button key={client.clientId} onClick={() => setFilter('clientId', client.clientId)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-primary/[.04] ${filters.clientId === client.clientId ? 'bg-primary/[.06]' : ''}`} data-testid={`button-top-client-${client.clientId}`}><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-secondary font-mono text-[10px] font-bold text-secondary-foreground">{String(index + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1 truncate text-xs font-semibold">{client.clientName}</span><span className="shrink-0 text-right"><span className="block font-mono text-xs font-semibold">{number(client.orderCount)}</span>{permissions.finance && <span className="text-[9px] text-muted-foreground">{currency(client.orderValue)}</span>}</span></button>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} />}
          </section>}
          {permissions?.measurements && <section className="rounded-2xl border border-border/80 bg-card p-4 md:p-5"><SectionHeading eyebrow="Production intake" title="Measurement uploads" icon={FileSpreadsheet} count={number(data?.recentMeasurements.length)} />
            {loading || errorFor('measurements') ? <SectionState loading={loading} error={errorFor('measurements')} empty={false} retry={refresh} /> : data?.recentMeasurements.length ? <div className="space-y-1">{data.recentMeasurements.slice(0, 5).map((upload) => <button key={upload.id} onClick={() => navigateRoute('/measurements')} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-primary/[.04]" data-testid={`button-measurement-upload-${upload.id}`}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><FileSpreadsheet size={15} /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{upload.filename}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{upload.clientName}{upload.location ? ` · ${upload.location}` : ''}</span></span><time className="shrink-0 text-[9px] text-muted-foreground">{relativeTime(upload.uploadedAt)}</time></button>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} />}
            <Link href="/measurements" className="mt-3 flex items-center justify-between border-t border-border/70 pt-3 text-[11px] font-semibold text-primary hover:underline" data-testid="link-dashboard-measurements">Open measurements <ArrowUpRight size={13} /></Link>
          </section>}
          {permissions?.orders && <section className="rounded-2xl border border-border/80 bg-card p-4 md:p-5"><SectionHeading eyebrow="Audit trail" title="Order activity" icon={Activity} count={number(data?.activity.length)} />
            {loading || errorFor('activity') ? <SectionState loading={loading} error={errorFor('activity')} empty={false} retry={refresh} /> : data?.activity.length ? <div className="space-y-0.5">{data.activity.slice(0, 6).map((item) => <button key={item.id} onClick={() => navigateRoute(`/order-hub/${encodeURIComponent(item.orderRecordId)}`)} className="flex w-full gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-primary/[.04]" data-testid={`button-activity-${item.id}`}><span className="relative mt-1 flex w-3 justify-center"><span className="size-2 rounded-full bg-primary/70" /><span className="absolute top-3 h-7 w-px bg-border" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{item.summary}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{item.actorName} · {item.clientName} · {item.orderId}</span></span><time className="shrink-0 pt-0.5 text-[9px] text-muted-foreground">{relativeTime(item.createdAt)}</time></button>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} />}
          </section>}
        </div>
      </>}
      {!loading && data && !sectionsAvailable && <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center"><span className="mx-auto grid size-11 place-items-center rounded-xl bg-secondary text-secondary-foreground"><Filter size={18} /></span><h2 className="mt-3 font-display text-lg font-semibold">No dashboard sections assigned</h2><p className="mt-1 text-sm text-muted-foreground">Ask a workspace administrator to review your operational access.</p></div>}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-1 pt-3 text-[10px] text-muted-foreground"><span>Framewise operational view · Values reflect the filters above</span><span className="inline-flex items-center gap-1.5"><Clock3 size={11} />{updated ? `Data snapshot ${updated.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : 'No snapshot yet'}</span></footer>
    </div>
  </AppShell>;
}
