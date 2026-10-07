import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { Link, useLocation } from 'wouter';
import {
  Activity, AlertCircle, ArrowUpRight, BadgeCheck, CalendarDays, Check, ChevronDown,
  CircleDollarSign, Clock3, CreditCard, Download, Factory, FileSpreadsheet, Filter,
  Gauge, Layers3, MapPin, Moon, PackageCheck, Printer, QrCode, RefreshCw, Search,
  Sun, Truck, Users, Wrench, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  getGetOperationsDashboardQueryKey, useGetOperationsDashboard,
} from '@workspace/api-client-react';
import type { GetOperationsDashboardParams, OperationsDashboard, User } from '@workspace/api-client-react';
import {
  Area, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { AppShell } from '@/components/app-shell';
import { DashboardWidgetBoundary } from '@/components/dashboard-widget-boundary';

type Filters = GetOperationsDashboardParams;
type RangePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'last6' | 'thisMonth' | 'lastMonth' | 'thisFY' | 'custom';

const DEFAULT_REFRESH_SECONDS = 30;
const presetOptions: Array<{ value: RangePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'last6', label: 'Last 6 months' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'thisFY', label: 'This FY' },
  { value: 'custom', label: 'Custom range' },
];
const statuses = [
  ['quotation_stage', 'Quotation stage'],
  ['confirmed', 'Confirmed'],
  ['in_production', 'In production'],
  ['ready', 'Ready'],
  ['dispatched', 'Dispatched'],
  ['installed', 'Installed'],
] as const;
const statusColors: Record<string, string> = {
  quotation_stage: '#8B5CF6',
  confirmed: '#3B82F6',
  in_production: '#14B8A6',
  ready: '#10B981',
  dispatched: '#F97316',
  installed: '#64748B',
};
const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2, success: 3 };

const formatNumber = (value: number | null | undefined) =>
  value == null ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
const formatCurrency = (value: number | null | undefined) =>
  value == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const compactCurrency = (value: number | null | undefined) => {
  if (value == null) return '—';
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `₹${(value / 10_000_000).toFixed(abs >= 100_000_000 ? 1 : 2)} Cr`;
  if (abs >= 100_000) return `₹${(value / 100_000).toFixed(abs >= 1_000_000 ? 1 : 2)} L`;
  return formatCurrency(value);
};
const dateParts = (value: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).formatToParts(value);
function todayInIndia() {
  const parts = dateParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function dateRangeFor(preset: Exclude<RangePreset, 'custom'>, today = todayInIndia()) {
  const [year, month] = today.split('-').map(Number);
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'yesterday') {
    const yesterday = shiftDay(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (preset === 'last7') return { from: shiftDay(today, -6), to: today };
  if (preset === 'last30') return { from: shiftDay(today, -29), to: today };
  if (preset === 'last90') return { from: shiftDay(today, -89), to: today };
  if (preset === 'last6') {
    const firstOfMonth = new Date(Date.UTC(year, month - 1, 1, 12));
    firstOfMonth.setUTCMonth(firstOfMonth.getUTCMonth() - 6);
    return { from: firstOfMonth.toISOString().slice(0, 10), to: today };
  }
  if (preset === 'thisMonth') return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: today };
  if (preset === 'thisFY') return { from: `${month >= 4 ? year : year - 1}-04-01`, to: today };
  const firstOfThisMonth = new Date(Date.UTC(year, month - 1, 1, 12));
  firstOfThisMonth.setUTCMonth(firstOfThisMonth.getUTCMonth() - 1);
  const from = firstOfThisMonth.toISOString().slice(0, 10);
  const lastOfLastMonth = shiftDay(`${year}-${String(month).padStart(2, '0')}-01`, -1);
  return { from, to: lastOfLastMonth };
}
function initialFilters(): Filters {
  const params = new URLSearchParams(window.location.search);
  const defaultRange = dateRangeFor('last30');
  const candidateStage = params.get('stage') || params.get('status');
  const paymentStatus = params.get('paymentStatus');
  const assignment = params.get('assignment');
  const glassStatus = params.get('glassStatus');
  return {
    from: params.get('from') || defaultRange.from,
    to: params.get('to') || defaultRange.to,
    ...(params.get('q') ? { q: params.get('q')! } : {}),
    ...(statuses.some(([value]) => value === candidateStage) ? { stage: candidateStage as Filters['stage'] } : {}),
    ...(params.get('clientId') ? { clientId: params.get('clientId')! } : {}),
    ...(params.get('locationCode') ? { locationCode: params.get('locationCode')! } : {}),
    ...(params.get('installerId') ? { installerId: params.get('installerId')! } : {}),
    ...(paymentStatus === 'paid' || paymentStatus === 'partial' || paymentStatus === 'unpaid' ? { paymentStatus } : {}),
    ...(assignment === 'assigned' || assignment === 'unassigned' ? { assignment } : {}),
    ...(glassStatus === 'untracked' || glassStatus === 'pending' || glassStatus === 'partial' || glassStatus === 'received' || glassStatus === 'broken' ? { glassStatus } : {}),
    ...(params.get('compare') === 'true' ? { compare: true } : {}),
  };
}
function saveFilters(filters: Filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== false) params.set(key, String(value));
  });
  const next = `${window.location.pathname}${params.size ? `?${params.toString()}` : ''}`;
  window.history.replaceState(window.history.state, '', next);
}
function inferPreset(from: string, to: string): RangePreset {
  for (const option of presetOptions) {
    if (option.value === 'custom') continue;
    const range = dateRangeFor(option.value);
    if (range.from === from && range.to === to) return option.value;
  }
  return 'custom';
}
function dateLabel(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = value instanceof Date
    ? value
    : new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}
function relativeTime(value: string | Date) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return dateLabel(value);
}
function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() || '').join('');
}
function makeOrdersHref(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.stage) params.set('status', filters.stage);
  if (filters.clientId) params.set('clientId', filters.clientId);
  if (filters.locationCode) params.set('locationCode', filters.locationCode);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return `/order-hub${params.size ? `?${params.toString()}` : ''}`;
}
function downloadCsv(filename: string, rows: Array<Record<string, string | number | null>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [headers.map(quote).join(','), ...rows.map((row) => headers.map((head) => quote(row[head])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
function exportChartPng(container: HTMLDivElement | null, filename: string) {
  const source = container?.querySelector('svg');
  if (!source) return;
  const bounds = source.getBoundingClientRect();
  const width = Math.max(320, Math.round(bounds.width));
  const height = Math.max(220, Math.round(bounds.height));
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width * 2));
  clone.setAttribute('height', String(height * 2));
  clone.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
  const imageUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }));
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const context = canvas.getContext('2d');
    if (!context) {
      URL.revokeObjectURL(imageUrl);
      return;
    }
    context.fillStyle = getComputedStyle(container!.closest('.dashboard-card') || container!).backgroundColor || '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
      }
      URL.revokeObjectURL(imageUrl);
    }, 'image/png');
  };
  image.onerror = () => URL.revokeObjectURL(imageUrl);
  image.src = imageUrl;
}

function SectionHeading({ eyebrow, title, icon: Icon, action }: { eyebrow: string; title: string; icon: LucideIcon; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex min-w-0 items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon size={17} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-bold uppercase tracking-[.16em] text-primary">{eyebrow}</p>
        <h2 className="mt-0.5 truncate text-base font-semibold tracking-tight">{title}</h2>
      </div>
      {action}
    </div>
  );
}
function SectionState({ error, loading, empty, retry, emptyTitle = 'Nothing in this view', emptyDetail = 'Try widening the date range or clearing a filter.' }: {
  error?: string | null;
  loading: boolean;
  empty: boolean;
  retry: () => void;
  emptyTitle?: string;
  emptyDetail?: string;
}) {
  if (loading) return <div className="space-y-3 p-3" aria-label="Loading section"><div className="h-3 w-1/3 animate-pulse rounded bg-muted" /><div className="h-28 animate-pulse rounded-xl bg-muted/75" /></div>;
  if (error) return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-destructive/30 bg-destructive/[.035] p-5 text-center">
      <AlertCircle size={18} className="text-destructive" />
      <p className="text-sm font-semibold">This section could not load</p>
      <p className="max-w-lg text-xs text-muted-foreground">{error}</p>
      <button type="button" onClick={retry} className="text-xs font-semibold text-primary hover:underline">Retry section</button>
    </div>
  );
  if (empty) return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center">
      <span className="grid size-9 place-items-center rounded-full bg-secondary text-secondary-foreground"><Layers3 size={16} /></span>
      <p className="mt-3 text-sm font-semibold">{emptyTitle}</p>
      <p className="mt-1 text-xs text-muted-foreground">{emptyDetail}</p>
    </div>
  );
  return null;
}
function useCountUp(value: number | null | undefined) {
  const [animated, setAnimated] = useState(value ?? 0);
  const hasAnimated = useRef(false);
  useEffect(() => {
    if (value == null || !Number.isFinite(value)) {
      setAnimated(0);
      return;
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (hasAnimated.current || reduceMotion) {
      hasAnimated.current = true;
      setAnimated(value);
      return;
    }
    hasAnimated.current = true;
    const start = performance.now();
    const duration = 650;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimated(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return animated;
}
function AnimatedValue({ value, format }: { value: number | null | undefined; format: (value: number) => string }) {
  const animated = useCountUp(value);
  return <>{value == null ? '—' : format(animated)}</>;
}
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return <span className="block h-7 w-16" aria-hidden="true" />;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min || 1;
  const points = finite.map((value, index) => {
    const x = (index / (finite.length - 1)) * 64;
    const y = 22 - ((value - min) / range) * 18;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return <svg className="h-7 w-16 shrink-0" viewBox="0 0 64 24" role="img" aria-label="Trend sparkline">
    <path d={`M ${points.join(' L ')} L 64 24 L 0 24 Z`} fill={color} fillOpacity=".12" />
    <path d={`M ${points.join(' L ')}`} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
function MetricCard({ label, value, format, note, icon: Icon, tint, spark, comparison, onClick }: {
  label: string;
  value: number | null | undefined;
  format: (value: number) => string;
  note: string;
  icon: LucideIcon;
  tint: string;
  spark: number[];
  comparison?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">{label}</p>
          <p className="mt-3 truncate text-[25px] font-semibold leading-none tracking-[-.04em] tabular-nums sm:text-[28px]">
            <AnimatedValue value={value} format={format} />
          </p>
        </div>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${tint}18`, color: tint }}><Icon size={18} /></span>
      </div>
      <div className="mt-4 flex min-h-7 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] leading-4 text-muted-foreground">{comparison || note}</span>
        <Sparkline values={spark} color={tint} />
      </div>
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className="dashboard-card min-w-0 rounded-[20px] border border-border/80 bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>{content}</button>
    : <article className="dashboard-card min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>{content}</article>;
}
function comparisonText(value: number | null | undefined, previous: number | null | undefined) {
  if (value == null || previous == null) return undefined;
  if (previous === 0) return value === 0 ? 'No change vs previous period' : 'New activity vs previous period';
  const change = ((value - previous) / Math.abs(previous)) * 100;
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs previous period`;
}
function LiveClock({ lastRefresh, refreshSeconds }: { lastRefresh: number | null; refreshSeconds: number }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const time = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(now);
  const date = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(now);
  const refreshText = lastRefresh
    ? `Data refreshed ${relativeTime(new Date(lastRefresh))}`
    : 'Waiting for first data refresh';
  return (
    <div className="min-w-[210px] rounded-2xl border border-white/15 bg-white/[.08] px-4 py-3 text-white/90">
      <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.14em] text-white/65">
        <span className={`size-1.5 rounded-full ${refreshSeconds ? 'animate-pulse bg-emerald-300' : 'bg-amber-300'}`} />
        India Standard Time
      </div>
      <time className="mt-1 block font-mono text-[22px] font-semibold tabular-nums tracking-tight" dateTime={now.toISOString()}>{time}</time>
      <p className="mt-0.5 text-[10px] text-white/65">{date}</p>
      <p className="mt-2 border-t border-white/15 pt-2 text-[9px] text-white/65">{refreshSeconds ? `Live · refreshes every ${refreshSeconds}s` : 'Auto-refresh is off'} · {refreshText}</p>
    </div>
  );
}
const MemoizedLiveClock = memo(LiveClock);
function ExportMenu({ title, onCsv, onPng }: { title: string; onCsv: () => void; onPng: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative print:hidden">
      <button type="button" aria-label={`Export ${title}`} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground" data-testid={`button-export-${title.toLowerCase().replaceAll(' ', '-')}`}><Download size={14} /></button>
      {open && <div className="absolute right-0 top-9 z-40 w-36 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl" role="menu">
        <button type="button" onClick={() => { onCsv(); setOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-muted" role="menuitem">Download CSV</button>
        <button type="button" onClick={() => { onPng(); setOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-muted" role="menuitem">Download PNG</button>
      </div>}
    </div>
  );
}
function StatusPill({ status }: { status: string }) {
  const label = statuses.find(([value]) => value === status)?.[1] || status.replaceAll('_', ' ');
  return <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary/80 px-2.5 py-1 text-[10px] font-semibold capitalize">
    <i className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: statusColors[status] || '#14B8A6' }} />{label}
  </span>;
}
function ActionIcon({ action }: { action: string }) {
  const key = action.toLowerCase();
  const Icon = key.includes('payment') ? CreditCard
    : key.includes('dispatch') ? Truck
      : key.includes('installation') ? Wrench
        : key.includes('scan') || key.includes('qr') ? QrCode
          : key.includes('approval') || key.includes('quotation') || key.includes('rate') ? BadgeCheck
            : key.includes('glass') || key.includes('measurement') ? FileSpreadsheet
              : Activity;
  return <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon size={15} /></span>;
}
function attentionAllowed(href: string, permissions: OperationsDashboard['permissions'] | undefined) {
  if (!permissions) return false;
  const path = href.toLowerCase();
  if (path.includes('payment') || path.includes('balance')) return permissions.finance;
  if (path.includes('dispatch')) return permissions.dispatch;
  if (path.includes('installation')) return permissions.installation;
  if (path.includes('glass')) return permissions.glass;
  if (path.includes('approval') || path.includes('quotation')) return permissions.approvals;
  if (path.includes('production') || path.includes('readiness')) return permissions.readiness;
  return permissions.orders;
}

export default function DashboardRedesign({ user }: { user: User }) {
  const [, setLocation] = useLocation();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [searchDraft, setSearchDraft] = useState(filters.q || '');
  const [refreshSeconds, setRefreshSeconds] = useState(DEFAULT_REFRESH_SECONDS);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const trendChartRef = useRef<HTMLDivElement>(null);
  const stageChartRef = useRef<HTMLDivElement>(null);
  const previousOrderSignatures = useRef<Map<string, string>>(new Map());
  const [flashedRows, setFlashedRows] = useState<string[]>([]);
  const { setTheme, resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const query = useGetOperationsDashboard(filters, {
    query: {
      queryKey: getGetOperationsDashboardQueryKey(filters),
      refetchInterval: refreshSeconds ? refreshSeconds * 1000 : false,
      refetchOnWindowFocus: true,
    },
  });
  const data = query.data as OperationsDashboard | undefined;
  const permissions = data?.permissions;
  const loading = query.isLoading;
  const updatedAt = query.dataUpdatedAt || (data?.updatedAt ? new Date(data.updatedAt).getTime() : 0);
  const retry = () => { void query.refetch(); };
  const errorFor = (key: keyof OperationsDashboard['sectionErrors']) => data?.sectionErrors[key] || null;
  const stageTotal = data?.pipeline.reduce((total, stage) => total + stage.count, 0) ?? 0;
  const rangePreset = inferPreset(filters.from, filters.to);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K] | undefined) => {
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (value === '' || value === undefined || value === false) delete (next as Record<string, unknown>)[key];
      return next;
    });
  };
  const clearAdvancedFilter = (key: keyof Filters) => {
    setFilters((current) => {
      const next = { ...current } as Record<string, unknown>;
      delete next[key];
      return next as Filters;
    });
    if (key === 'q') setSearchDraft('');
  };
  const clearFilters = () => {
    setSearchDraft('');
    setFilters({ ...dateRangeFor('last30') });
  };
  const chooseRange = (preset: RangePreset) => {
    if (preset === 'custom') return;
    setFilters((current) => ({ ...current, ...dateRangeFor(preset) }));
  };
  const refresh = () => { void query.refetch(); };

  useEffect(() => {
    saveFilters(filters);
  }, [filters]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => {
        if ((current.q || '') === searchDraft) return current;
        const next = { ...current };
        if (searchDraft.trim()) next.q = searchDraft.trim();
        else delete (next as Record<string, unknown>).q;
        return next;
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);
  useEffect(() => {
    if (!data?.recentOrders) return;
    const nextSignatures = new Map(data.recentOrders.map((order) => [
      order.id,
      `${order.status}|${order.clientName}|${order.locationName}|${order.readyWindows}|${order.totalWindows}|${order.dispatchStatus}|${order.installationStatus}`,
    ]));
    if (previousOrderSignatures.current.size) {
      const changed = [...nextSignatures.entries()]
        .filter(([id, signature]) => previousOrderSignatures.current.get(id) !== signature)
        .map(([id]) => id);
      if (changed.length) {
        setFlashedRows(changed);
        const timer = window.setTimeout(() => setFlashedRows([]), 1300);
        previousOrderSignatures.current = nextSignatures;
        return () => window.clearTimeout(timer);
      }
    }
    previousOrderSignatures.current = nextSignatures;
    return undefined;
  }, [data?.recentOrders, query.dataUpdatedAt]);

  const previous = data?.summary.previousPeriod;
  const trend = data?.trend ?? [];
  const orderSpark = trend.map((point) => point.orderCount);
  const valueSpark = trend.map((point) => point.orderValue ?? 0);
  const readinessSpark = trend.map((point) => point.totalWindows ? (point.readyWindows / point.totalWindows) * 100 : 0);
  const balanceSpark = trend.map((point) => point.outstandingBalance ?? 0);
  const installedSpark = trend.map((point) => point.installedOrders);
  const ordersHref = makeOrdersHref(filters);
  const activeFilterCount = [
    filters.q, filters.stage, filters.clientId, filters.locationCode, filters.installerId,
    filters.paymentStatus, filters.assignment, filters.glassStatus,
  ].filter(Boolean).length + (filters.compare ? 1 : 0);
  const activeAttention = (data?.attention ?? []).slice().sort((a, b) =>
    Number(a.count === 0) - Number(b.count === 0)
    || severityOrder[a.severity] - severityOrder[b.severity]
    || b.count - a.count
    || a.title.localeCompare(b.title));
  const visibleAttention = activeAttention.filter((item) => attentionAllowed(item.href, permissions));
  const attentionError = [
    permissions?.orders && errorFor('orders'),
    permissions?.finance && errorFor('finance'),
    permissions?.dispatch && errorFor('dispatch'),
    permissions?.installation && errorFor('installation'),
    permissions?.glass && errorFor('glass'),
    permissions?.approvals && errorFor('approvals'),
    permissions?.readiness && errorFor('windows'),
  ].find(Boolean) || null;
  const trendError = [
    permissions?.orders && errorFor('orders'),
    permissions?.finance && errorFor('finance'),
  ].find(Boolean) || null;
  const secondaryHasData = Boolean(
    (permissions?.dispatch && data?.dispatchQueue.length)
    || (permissions?.finance && (data?.reminderCandidates.length || (data?.summary.outstandingBalance ?? 0) > 0))
    || (permissions?.installation && data?.installationSchedule.length)
    || (permissions?.orders && data?.topClients.length)
    || (permissions?.measurements && data?.recentMeasurements.length),
  );
  const secondaryHasError = Boolean(
    (permissions?.dispatch && errorFor('dispatch'))
    || (permissions?.finance && errorFor('finance'))
    || (permissions?.installation && errorFor('installation'))
    || (permissions?.orders && errorFor('orders'))
    || (permissions?.measurements && errorFor('measurements')),
  );
  const canViewAnyDashboard = Boolean(permissions && Object.values(permissions).some(Boolean));
  const formatCompare = (current: number | null | undefined, before: number | null | undefined) =>
    filters.compare ? comparisonText(current, before) : undefined;

  const chip = (label: string, onRemove: () => void, key: string) => (
    <span key={key} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary/[.07] px-2.5 py-1 text-[10px] font-medium text-primary">
      <span className="max-w-[220px] truncate">{label}</span>
      <button type="button" onClick={onRemove} className="grid size-4 shrink-0 place-items-center rounded-full hover:bg-primary/15" aria-label={`Remove ${label} filter`}><X size={10} /></button>
    </span>
  );

  const recentOrders = data?.recentOrders ?? [];
  const reminders = data?.reminderCandidates ?? [];
  const activity = data?.activity ?? [];
  const donutData = (data?.pipeline ?? []).filter((item) => item.count > 0);
  const trendCsv = trend.map((point) => ({
    date: point.bucket,
    ...(permissions?.orders ? { orders: point.orderCount } : {}),
    ...(permissions?.finance ? { orderValueINR: point.orderValue } : {}),
  }));
  const stageCsv = (data?.pipeline ?? []).map((item) => ({
    stage: item.label,
    orders: item.count,
    ...(permissions?.finance ? { orderValueINR: item.orderValue } : {}),
  }));
  const chooseChartRange = (preset: 'last7' | 'last30' | 'last90') => chooseRange(preset);
  const chooseSixMonths = () => chooseRange('last6');
  const dateChipLabel = () => presetOptions.find((option) => option.value === rangePreset)?.label
    || `${dateLabel(filters.from)} – ${dateLabel(filters.to)}`;

  return (
    <AppShell user={user} title="Operations dashboard" eyebrow="Live operations · India">
      <div className="dashboard-page -mx-5 -my-6 min-h-[calc(100dvh-76px)] px-5 py-6 md:-mx-8 md:-my-8 md:px-8 md:py-8">
        <div className="mx-auto max-w-[1600px] space-y-5 pb-8">
          <DashboardWidgetBoundary name="Dashboard overview" onRetry={refresh}>
            <header className="dashboard-hero relative overflow-hidden rounded-[24px] px-5 py-5 shadow-lg md:px-7 md:py-6">
              <div className="pointer-events-none absolute -right-12 -top-20 size-72 rounded-full border border-white/10" />
              <div className="pointer-events-none absolute right-16 top-10 size-28 rounded-full border border-white/10" />
              <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.2em] text-teal-200"><span className="size-1.5 rounded-full bg-teal-300" />Live Order Overview</p>
                  <h2 className="mt-2 max-w-3xl text-[27px] font-semibold leading-tight tracking-[-.045em] md:text-[36px]">Every order, one clear view</h2>
                  <p className="mt-2 max-w-2xl text-xs leading-5 text-white/70 md:text-sm">Follow order value, window readiness, payments and field installation from a single live dashboard.</p>
                  <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {permissions?.orders && <HeroStat label="Matching orders" value={formatNumber(data?.summary.activeOrders)} icon={Layers3} />}
                    {permissions?.readiness && <HeroStat label="Window readiness" value={data?.summary.readyWindowPercent == null ? '—' : `${data.summary.readyWindowPercent}%`} icon={Gauge} />}
                    {permissions?.installation && <HeroStat label="Installed orders" value={formatNumber(data?.summary.installedOrders)} icon={PackageCheck} />}
                    {!permissions?.orders && !permissions?.readiness && !permissions?.installation && <HeroStat label="Selected date range" value={`${dateLabel(filters.from)} – ${dateLabel(filters.to)}`} icon={CalendarDays} />}
                  </div>
                </div>
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-stretch xl:justify-end">
                  <MemoizedLiveClock lastRefresh={updatedAt || null} refreshSeconds={refreshSeconds} />
                  <div className="flex flex-wrap items-center gap-2 sm:content-start sm:justify-end print:hidden">
                    <button type="button" onClick={refresh} disabled={query.isFetching} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-60" data-testid="button-refresh-dashboard">
                      <RefreshCw size={14} className={query.isFetching ? 'animate-spin' : ''} />Refresh
                    </button>
                    <label className="relative inline-flex h-9 items-center rounded-xl border border-white/20 bg-white/10 px-2.5 text-white">
                      <span className="sr-only">Auto-refresh interval</span>
                      <select value={refreshSeconds} onChange={(event) => setRefreshSeconds(Number(event.target.value))} className="h-full appearance-none bg-transparent pr-5 text-[11px] font-semibold outline-none [&>option]:text-foreground" aria-label="Auto-refresh interval" data-testid="select-dashboard-auto-refresh">
                        <option value={0}>Auto: Off</option><option value={30}>Auto: 30s</option><option value={60}>Auto: 60s</option>
                      </select>
                      <ChevronDown size={12} className="pointer-events-none absolute right-2.5" />
                    </label>
                    <button type="button" disabled={!data} onClick={() => window.print()} aria-label="Print dashboard" className="grid size-9 place-items-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/15 disabled:opacity-50" data-testid="button-print-dashboard"><Printer size={15} /></button>
                    <button type="button" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`} className="grid size-9 place-items-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/15" data-testid="button-toggle-theme">{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
                  </div>
                </div>
              </div>
            </header>
          </DashboardWidgetBoundary>

          <DashboardWidgetBoundary name="Dashboard filters" onRetry={refresh}>
            <section className="dashboard-filterbar sticky top-[76px] z-30 -mx-2 rounded-2xl border border-border/80 bg-card/95 p-3 shadow-md backdrop-blur-xl sm:mx-0 sm:p-3.5" aria-label="Dashboard filters">
              <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(190px,1.5fr)_150px_150px_170px_auto]">
                <label className="relative block min-w-0">
                  <span className="sr-only">Search dashboard records</span>
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input ref={searchInputRef} aria-label="Search orders and clients" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search orders, clients or locations" className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-14 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" data-testid="input-dashboard-search" />
                  <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">⌘K</kbd>
                </label>
                <label className="relative min-w-0">
                  <span className="sr-only">Date range</span>
                  <CalendarDays size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <select value={rangePreset} onChange={(event) => chooseRange(event.target.value as RangePreset)} className="h-10 w-full appearance-none rounded-xl border border-input bg-background pl-9 pr-7 text-xs font-medium" data-testid="select-dashboard-date-range">
                    {presetOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                </label>
                {permissions?.orders && <label className="relative min-w-0">
                  <span className="sr-only">Order stage</span>
                  <select value={filters.stage || ''} onChange={(event) => setFilter('stage', (event.target.value || undefined) as Filters['stage'])} className="h-10 w-full appearance-none rounded-xl border border-input bg-background px-3 pr-7 text-xs" data-testid="select-filter-stage">
                    <option value="">All stages</option>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                </label>}
                {permissions?.orders && <label className="relative min-w-0">
                  <span className="sr-only">Client</span>
                  <select value={filters.clientId || ''} onChange={(event) => setFilter('clientId', event.target.value || undefined)} className="h-10 w-full appearance-none rounded-xl border border-input bg-background px-3 pr-7 text-xs" data-testid="select-filter-client">
                    <option value="">All clients</option>{data?.filterOptions.clients.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                </label>}
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setMoreFiltersOpen((value) => !value)} aria-expanded={moreFiltersOpen} className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition ${moreFiltersOpen || activeFilterCount ? 'border-primary/30 bg-primary/[.07] text-primary' : 'border-input bg-background text-muted-foreground hover:text-foreground'}`} data-testid="button-dashboard-more-filters"><Filter size={14} />More filters{activeFilterCount > 0 && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px]">{activeFilterCount}</span>}<ChevronDown size={12} className={moreFiltersOpen ? 'rotate-180' : ''} /></button>
                  <button type="button" onClick={clearFilters} className="h-10 rounded-xl px-2.5 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground" data-testid="button-clear-filters">Reset</button>
                </div>
              </div>
              {rangePreset === 'custom' && <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-md">
                <label className="flex min-w-0 items-center gap-2 rounded-xl border border-input bg-background px-3">
                  <span className="text-[10px] text-muted-foreground">From</span>
                  <input aria-label="From date" type="date" value={filters.from} max={filters.to} onChange={(event) => setFilter('from', event.target.value)} className="h-9 min-w-0 flex-1 bg-transparent text-xs" data-testid="input-filter-from" />
                </label>
                <label className="flex min-w-0 items-center gap-2 rounded-xl border border-input bg-background px-3">
                  <span className="text-[10px] text-muted-foreground">To</span>
                  <input aria-label="To date" type="date" value={filters.to} min={filters.from} onChange={(event) => setFilter('to', event.target.value)} className="h-9 min-w-0 flex-1 bg-transparent text-xs" data-testid="input-filter-to" />
                </label>
              </div>}
              {moreFiltersOpen && <div className="mt-3 grid gap-2 border-t border-border/70 pt-3 sm:grid-cols-2 lg:grid-cols-4">
                {permissions?.orders && <label className="relative min-w-0">
                  <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Location</span>
                  <select value={filters.locationCode || ''} onChange={(event) => setFilter('locationCode', event.target.value || undefined)} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-location"><option value="">All locations</option>{data?.filterOptions.locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}</select>
                </label>}
                {permissions?.installation && <label className="relative min-w-0">
                  <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Installer</span>
                  <select value={filters.installerId || ''} onChange={(event) => setFilter('installerId', event.target.value || undefined)} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-installer"><option value="">All installers</option>{data?.filterOptions.installers.map((installer) => <option key={installer.id} value={installer.id}>{installer.label}</option>)}</select>
                </label>}
                {permissions?.finance && <label className="relative min-w-0">
                  <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Payment status</span>
                  <select value={filters.paymentStatus || ''} onChange={(event) => setFilter('paymentStatus', (event.target.value || undefined) as Filters['paymentStatus'])} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-payment"><option value="">Any payment status</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="unpaid">Unpaid</option></select>
                </label>}
                {permissions?.installation && <label className="relative min-w-0">
                  <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Team assignment</span>
                  <select value={filters.assignment || ''} onChange={(event) => setFilter('assignment', (event.target.value || undefined) as Filters['assignment'])} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-assignment"><option value="">Any assignment</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option></select>
                </label>}
                {(permissions?.glass || permissions?.readiness) && <label className="relative min-w-0">
                  <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Glass status</span>
                  <select value={filters.glassStatus || ''} onChange={(event) => setFilter('glassStatus', (event.target.value || undefined) as Filters['glassStatus'])} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-glass"><option value="">Any glass status</option><option value="untracked">Untracked</option><option value="pending">Pending</option><option value="partial">Partial</option><option value="received">Received</option><option value="broken">Broken</option></select>
                </label>}
                <button type="button" onClick={() => setFilter('compare', !filters.compare)} aria-pressed={Boolean(filters.compare)} className={`flex h-9 items-center justify-center gap-2 self-end rounded-lg border px-3 text-xs font-semibold transition ${filters.compare ? 'border-primary/30 bg-primary/[.07] text-primary' : 'border-input bg-background text-muted-foreground hover:bg-muted'}`} data-testid="button-toggle-compare">
                  <span className={`grid size-4 place-items-center rounded border ${filters.compare ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{filters.compare && <Check size={11} />}</span>Compare previous period
                </button>
              </div>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
                {chip(dateChipLabel(), () => chooseRange('last30'), 'date')}
                {filters.q && chip(`Search: ${filters.q}`, () => { setSearchDraft(''); clearAdvancedFilter('q'); }, 'q')}
                {filters.stage && chip(`Stage: ${statuses.find(([value]) => value === filters.stage)?.[1] || filters.stage}`, () => clearAdvancedFilter('stage'), 'stage')}
                {filters.clientId && chip(`Client: ${data?.filterOptions.clients.find((item) => item.id === filters.clientId)?.label || filters.clientId}`, () => clearAdvancedFilter('clientId'), 'client')}
                {filters.locationCode && chip(`Location: ${data?.filterOptions.locations.find((item) => item.id === filters.locationCode)?.label || filters.locationCode}`, () => clearAdvancedFilter('locationCode'), 'location')}
                {filters.installerId && chip(`Installer: ${data?.filterOptions.installers.find((item) => item.id === filters.installerId)?.label || 'Selected'}`, () => clearAdvancedFilter('installerId'), 'installer')}
                {filters.paymentStatus && chip(`Payment: ${filters.paymentStatus}`, () => clearAdvancedFilter('paymentStatus'), 'payment')}
                {filters.assignment && chip(`Assignment: ${filters.assignment}`, () => clearAdvancedFilter('assignment'), 'assignment')}
                {filters.glassStatus && chip(`Glass: ${filters.glassStatus}`, () => clearAdvancedFilter('glassStatus'), 'glass')}
                {filters.compare && chip('Compare previous period', () => clearAdvancedFilter('compare'), 'compare')}
              </div>
            </section>
          </DashboardWidgetBoundary>

          {query.isError && !data ? (
            <DashboardWidgetBoundary name="Live dashboard data" onRetry={refresh}>
              <div className="flex min-h-72 flex-col items-center justify-center rounded-[22px] border border-destructive/25 bg-card p-8 text-center">
                <AlertCircle size={25} className="text-destructive" />
                <h2 className="mt-3 text-xl font-semibold">Live view unavailable</h2>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">The operations dashboard did not respond. Your filters remain in this URL; retry when ready.</p>
                <button type="button" onClick={refresh} className="mt-4 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground" data-testid="button-retry-dashboard">Retry dashboard</button>
              </div>
            </DashboardWidgetBoundary>
          ) : <>
            <DashboardWidgetBoundary name="Key performance indicators" onRetry={refresh}>
              {loading && !data ? <div className="dashboard-kpi-grid gap-3" aria-label="Loading key figures">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-[132px] animate-pulse rounded-[20px] border border-border bg-card/80" />)}</div> : permissions && <section className="dashboard-kpi-grid gap-3" aria-label="Key performance indicators">
                {permissions.orders && <MetricCard label="Orders" value={data?.summary.activeOrders} format={formatNumber} note="Created in selected period" icon={Layers3} tint="#3B82F6" spark={orderSpark} comparison={formatCompare(data?.summary.activeOrders, previous?.activeOrders)} onClick={() => setFilter('stage', undefined)} />}
                {permissions.finance && <MetricCard label="Order value" value={data?.summary.orderValue} format={compactCurrency} note="Recorded order value · not collected revenue" icon={CircleDollarSign} tint="#14B8A6" spark={valueSpark} comparison={formatCompare(data?.summary.orderValue, previous?.orderValue)} onClick={() => setLocation('/payments')} />}
                {permissions.readiness && <MetricCard label="Windows ready" value={data?.summary.readyWindows} format={(value) => `${formatNumber(value)} / ${formatNumber(data?.summary.totalWindows)}`} note={data?.summary.readyWindowPercent == null ? 'No window totals in this range' : `${data.summary.readyWindowPercent}% of matching windows`} icon={Gauge} tint="#10B981" spark={readinessSpark} comparison={filters.compare ? `${formatNumber(previous?.readyWindows)} / ${formatNumber(previous?.totalWindows)} previously` : undefined} />}
                {permissions.finance && <MetricCard label="Outstanding balance" value={data?.summary.outstandingBalance} format={compactCurrency} note="Known balance · not an overdue total" icon={CircleDollarSign} tint="#EF4444" spark={balanceSpark} comparison={formatCompare(data?.summary.outstandingBalance, previous?.outstandingBalance)} onClick={() => setLocation('/balance-payment')} />}
                {permissions.orders && permissions.installation && <MetricCard label="Installed orders" value={data?.summary.installedOrders} format={formatNumber} note="Installed in matching orders" icon={PackageCheck} tint="#8B5CF6" spark={installedSpark} comparison={formatCompare(data?.summary.installedOrders, previous?.installedOrders)} onClick={() => setLocation('/installation')} />}
              </section>}
            </DashboardWidgetBoundary>

            {(permissions?.orders || permissions?.finance) && <div className={`grid min-w-0 gap-4 ${permissions?.orders ? 'xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]' : ''}`}>
              <DashboardWidgetBoundary name="Order and value trend" onRetry={refresh}>
                <section className="dashboard-card min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-[.16em] text-primary">Throughput</p>
                      <h2 className="mt-1 text-base font-semibold">Orders &amp; order value trend</h2>
                      <p className="mt-1 text-[10px] text-muted-foreground">Order value is the recorded value of matching orders, not recognized or collected revenue.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-lg border border-border bg-background p-0.5" role="group" aria-label="Trend date range">
                        {(['last7', 'last30', 'last90'] as const).map((preset) => <button key={preset} type="button" onClick={() => chooseChartRange(preset)} className={`rounded-md px-2 py-1.5 text-[9px] font-semibold ${rangePreset === preset ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`} data-testid={`button-chart-range-${preset}`}>{preset === 'last7' ? '7D' : preset === 'last30' ? '30D' : '90D'}</button>)}
                        <button type="button" onClick={chooseSixMonths} className={`rounded-md px-2 py-1.5 text-[9px] font-semibold ${rangePreset === 'last6' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`} data-testid="button-chart-range-6m">6M</button>
                      </div>
                      <ExportMenu title="Trend" onCsv={() => downloadCsv('operations-order-value-trend.csv', trendCsv)} onPng={() => exportChartPng(trendChartRef.current, 'operations-order-value-trend.png')} />
                    </div>
                  </div>
                  {loading || trendError ? <SectionState loading={loading} error={trendError} empty={false} retry={refresh} /> : trend.length ? <>
                    <div ref={trendChartRef} className="h-[245px] min-w-0 w-full" role="img" aria-label="Order count and recorded order value for the selected date range">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={trend} margin={{ top: 8, right: 2, left: -16, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 5" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="label" interval="preserveStartEnd" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                          {permissions?.orders && <YAxis yAxisId="orders" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} allowDecimals={false} width={36} />}
                          {permissions?.finance && <YAxis yAxisId="value" orientation="right" tickFormatter={(value) => compactCurrency(Number(value))} tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={56} />}
                          <Tooltip cursor={{ fill: 'hsl(var(--primary) / .06)', stroke: 'none' }} contentStyle={{ borderRadius: 12, borderColor: 'hsl(var(--border))', backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--foreground))', fontSize: 11 }} formatter={(value, name) => [name === 'Order value' ? compactCurrency(Number(value)) : formatNumber(Number(value)), name]} />
                          {permissions?.finance && <Area yAxisId="value" type="monotone" dataKey="orderValue" name="Order value" stroke="#14B8A6" strokeWidth={2.5} fill="#14B8A6" fillOpacity={0.13} connectNulls isAnimationActive={false} />}
                          {permissions?.orders && <Line yAxisId="orders" type="monotone" dataKey="orderCount" name="Orders" stroke="#3B82F6" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 border-t border-border/70 pt-3 text-[10px] text-muted-foreground">
                      {permissions?.orders && <span className="inline-flex items-center gap-2"><i className="h-0.5 w-4 rounded bg-[#3B82F6]" />Orders</span>}
                      {permissions?.finance && <span className="inline-flex items-center gap-2"><i className="h-0.5 w-4 rounded bg-[#14B8A6]" />Order value (INR)</span>}
                      <span className="ml-auto">Clicking the range above also updates all dashboard sections.</span>
                    </div>
                  </> : <SectionState loading={false} error={null} empty retry={refresh} emptyTitle="No trend data for this range" />}
                </section>
              </DashboardWidgetBoundary>

              {permissions?.orders && <DashboardWidgetBoundary name="Order-stage distribution" onRetry={refresh}>
                <section className="dashboard-card min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[.16em] text-primary">Live pipeline</p>
                      <h2 className="mt-1 text-base font-semibold">Orders by stage</h2>
                      <p className="mt-1 text-[10px] text-muted-foreground">Select a segment or stage to filter the dashboard.</p>
                    </div>
                    <ExportMenu title="Stage distribution" onCsv={() => downloadCsv('operations-stage-distribution.csv', stageCsv)} onPng={() => exportChartPng(stageChartRef.current, 'operations-stage-distribution.png')} />
                  </div>
                  {loading || errorFor('orders') ? <SectionState loading={loading} error={errorFor('orders')} empty={false} retry={refresh} /> : donutData.length ? <>
                    <div className="relative mx-auto h-[178px] max-w-[240px]" ref={stageChartRef} role="img" aria-label="Donut chart of matching orders by actual order stage">
                      <ResponsiveContainer width="100%" height="100%"><PieChart>
                        <Tooltip contentStyle={{ borderRadius: 12, borderColor: 'hsl(var(--border))', backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--foreground))', fontSize: 11 }} formatter={(value) => [formatNumber(Number(value)), 'Orders']} />
                        <Pie data={donutData} dataKey="count" nameKey="label" innerRadius={55} outerRadius={77} paddingAngle={2} stroke="none" isAnimationActive={false} onClick={(entry) => setFilter('stage', entry.status as Filters['stage'])}>
                          {donutData.map((entry) => <Cell key={entry.status} fill={statusColors[entry.status] || '#14B8A6'} className="cursor-pointer" />)}
                        </Pie>
                      </PieChart></ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Orders</span>
                        <span className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(stageTotal)}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 border-t border-border/70 pt-3">
                      {data?.pipeline.map((stage) => <button key={stage.status} type="button" onClick={() => setFilter('stage', filters.stage === stage.status ? undefined : stage.status)} className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted ${filters.stage === stage.status ? 'bg-primary/[.08]' : ''}`} data-testid={`button-donut-legend-${stage.status}`}>
                        <i className="size-2 shrink-0 rounded-full" style={{ backgroundColor: statusColors[stage.status] || '#14B8A6' }} />
                        <span className="min-w-0 flex-1 truncate text-[9px] text-muted-foreground">{stage.label}</span>
                        <span className="font-mono text-[10px] font-semibold">{formatNumber(stage.count)}</span>
                      </button>)}
                    </div>
                  </> : <SectionState loading={false} error={null} empty retry={refresh} emptyTitle="No orders in this range" />}
                </section>
              </DashboardWidgetBoundary>}
            </div>}

            {permissions?.orders && <DashboardWidgetBoundary name="Order pipeline" onRetry={refresh}>
              <section className="dashboard-card rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5">
                <SectionHeading eyebrow="Order pipeline" title="Move work through each stage" icon={Factory} action={<span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{loading ? '—' : `${formatNumber(stageTotal)} orders`}</span>} />
                {loading || errorFor('orders') ? <SectionState loading={loading} error={errorFor('orders')} empty={false} retry={refresh} /> : data?.pipeline.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
                  {data.pipeline.map((stage) => {
                    const share = stageTotal ? (stage.count / stageTotal) * 100 : 0;
                    const selected = filters.stage === stage.status;
                    return <button key={stage.status} type="button" onClick={() => setFilter('stage', selected ? undefined : stage.status)} className={`min-w-0 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${selected ? 'border-primary/40 bg-primary/[.07]' : 'border-border/75 bg-background hover:border-primary/30'}`} data-testid={`button-pipeline-${stage.status}`}>
                      <div className="flex items-center justify-between gap-2"><span className="h-1.5 w-9 rounded-full" style={{ backgroundColor: statusColors[stage.status] || '#14B8A6' }} /><span className="text-[9px] font-semibold text-muted-foreground">{share.toFixed(0)}%</span></div>
                      <p className="mt-3 truncate text-[9px] font-bold uppercase tracking-[.1em] text-muted-foreground">{stage.label}</p>
                      <div className="mt-1 flex items-end justify-between gap-2"><span className="text-2xl font-semibold tabular-nums">{formatNumber(stage.count)}</span>{permissions?.finance && <span className="truncate text-[9px] text-muted-foreground">{compactCurrency(stage.orderValue)}</span>}</div>
                      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, share)}%`, backgroundColor: statusColors[stage.status] || '#14B8A6' }} /></div>
                    </button>;
                  })}
                </div> : <SectionState loading={false} error={null} empty retry={refresh} />}
              </section>
            </DashboardWidgetBoundary>}

            {(canViewAnyDashboard) && <div className={`grid min-w-0 gap-4 ${permissions?.orders ? 'xl:grid-cols-2' : ''}`}>
              <DashboardWidgetBoundary name="Needs attention" onRetry={refresh}>
                <section className="dashboard-card h-full min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5">
                  <SectionHeading eyebrow="Priority work" title="Needs attention" icon={AlertCircle} action={<span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${activeAttention.some((item) => item.count > 0 && item.severity !== 'success') ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`}>{activeAttention.filter((item) => item.count > 0 && item.severity !== 'success').length} active</span>} />
                  {loading || attentionError ? <SectionState loading={loading} error={attentionError} empty={false} retry={refresh} /> : visibleAttention.length ? <div className="space-y-2">
                    {visibleAttention.map((item) => {
                      const quiet = item.count === 0;
                      const row = <span className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl border p-3 text-left transition ${quiet ? 'border-border/50 bg-muted/20 opacity-60' : 'border-border/75 bg-background hover:border-primary/30 hover:bg-primary/[.025]'}`}>
                        <span className={`size-2 shrink-0 rounded-full ${item.severity === 'critical' ? 'bg-red-500' : item.severity === 'warning' ? 'bg-orange-500' : item.severity === 'success' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{item.title}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{item.description}</span></span>
                        <span className="shrink-0 text-right"><span className="block font-mono text-sm font-semibold">{formatNumber(item.count)}</span>{permissions?.finance && item.amount != null && <span className="text-[9px] text-muted-foreground">{compactCurrency(item.amount)}</span>}</span>
                        <ArrowUpRight size={13} className="shrink-0 text-muted-foreground" />
                      </span>;
                      return <div key={item.id} className="flex items-center gap-2">
                        <button type="button" onClick={() => setLocation(item.href)} className="min-w-0 flex-1 text-left" data-testid={`button-attention-${item.id}`}>{row}</button>
                        {item.id === 'outstanding-payments' && reminders[0] && <form method="post" action={`/api/orders/${encodeURIComponent(reminders[0].orderRecordId)}/payment-reminder`} target="_blank" rel="noreferrer" className="shrink-0">
                          <button type="submit" disabled={!reminders[0].canOpenWhatsApp} aria-label={`Open WhatsApp reminder draft for ${reminders[0].orderId}`} title="Open a manual WhatsApp reminder draft for staff review" className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-40" data-testid={`button-dashboard-reminder-${reminders[0].orderRecordId}`}><Activity size={14} /></button>
                        </form>}
                      </div>;
                    })}
                  </div> : <SectionState loading={false} error={null} empty retry={refresh} emptyTitle="No attention items" emptyDetail="No active follow-up items match the current filters." />}
                </section>
              </DashboardWidgetBoundary>

              {permissions?.orders && <DashboardWidgetBoundary name="Live activity" onRetry={refresh}>
                <section className="dashboard-card h-full min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5">
                  <SectionHeading eyebrow="Live activity" title="Latest changes" icon={Activity} action={<span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[.07] px-2.5 py-1 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300"><i className={`size-1.5 rounded-full ${refreshSeconds ? 'animate-pulse bg-emerald-500' : 'bg-amber-500'}`} />{refreshSeconds ? 'Live' : 'Paused'}</span>} />
                  {loading || errorFor('activity') ? <SectionState loading={loading} error={errorFor('activity')} empty={false} retry={refresh} /> : activity.length ? <div className="space-y-1">
                    {activity.slice(0, 8).map((item) => <Link key={item.id} href={`/order-hub/${encodeURIComponent(item.orderRecordId)}`} className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-primary/[.04]" data-testid={`button-activity-${item.id}`}>
                      <ActionIcon action={item.action} />
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{item.summary}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{item.actorName} · {item.clientName} · {item.orderId}</span></span>
                      <time className="shrink-0 text-[9px] text-muted-foreground" dateTime={new Date(item.createdAt).toISOString()}>{relativeTime(item.createdAt)}</time>
                    </Link>)}
                  </div> : <SectionState loading={false} error={null} empty retry={refresh} emptyTitle="No activity in this period" />}
                </section>
              </DashboardWidgetBoundary>}
            </div>}

            {(permissions?.orders || permissions?.installation) && <div className={`grid min-w-0 gap-4 ${permissions?.orders && permissions?.installation ? 'xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,.85fr)]' : ''}`}>
              {permissions?.orders && <DashboardWidgetBoundary name="Recent orders" onRetry={refresh}>
                <section className="dashboard-card min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5">
                  <SectionHeading eyebrow="Order register" title="Recent orders" icon={Layers3} action={<Link href={ordersHref} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-primary hover:bg-primary/[.06]" data-testid="link-dashboard-all-orders">View all <ArrowUpRight size={13} /></Link>} />
                  {loading || errorFor('orders') ? <SectionState loading={loading} error={errorFor('orders')} empty={false} retry={refresh} /> : recentOrders.length ? <>
                    <div className="space-y-2 xl:hidden">
                      {recentOrders.slice(0, 8).map((order) => <button type="button" key={order.id} onClick={() => setLocation(`/order-hub/${encodeURIComponent(order.id)}`)} className={`w-full min-w-0 rounded-xl border border-border/70 bg-background p-3 text-left transition hover:border-primary/30 ${flashedRows.includes(order.id) ? 'dashboard-row-flash' : ''}`} data-testid={`card-dashboard-order-${order.id}`}>
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{initials(order.clientName)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[11px] font-bold text-primary">{order.orderId}</span><StatusPill status={order.status} /></span>
                            <span className="mt-1 block truncate text-xs font-semibold">{order.clientName}</span>
                            <span className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground"><MapPin size={10} />{order.locationName}</span>
                            <span className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                              <span>Windows {formatNumber(order.readyWindows)}/{formatNumber(order.totalWindows)}</span>
                              {permissions.finance && <span className="font-mono font-semibold text-foreground">{compactCurrency(order.orderValue)}</span>}
                              <span>{dateLabel(order.createdAt)}</span>
                            </span>
                          </span>
                        </div>
                      </button>)}
                    </div>
                    <div className="hidden xl:block">
                      <table className="w-full table-fixed text-left">
                        <thead><tr className="border-b border-border text-[9px] font-bold uppercase tracking-[.12em] text-muted-foreground"><th className="w-[38%] pb-2 pr-3">Order / client</th><th className="w-[18%] pb-2 pr-3">Stage</th><th className="w-[14%] pb-2 pr-3">Windows</th><th className="w-[18%] pb-2 pr-3">Fulfillment</th>{permissions.finance && <th className="w-[12%] pb-2 text-right">Value</th>}</tr></thead>
                        <tbody className="divide-y divide-border/60">
                          {recentOrders.slice(0, 8).map((order) => <tr key={order.id} tabIndex={0} onClick={() => setLocation(`/order-hub/${encodeURIComponent(order.id)}`)} onKeyDown={(event) => { if (event.key === 'Enter') setLocation(`/order-hub/${encodeURIComponent(order.id)}`); }} className={`cursor-pointer transition hover:bg-primary/[.025] ${flashedRows.includes(order.id) ? 'dashboard-row-flash' : ''}`} data-testid={`row-dashboard-order-${order.id}`}>
                            <td className="py-3 pr-3"><div className="flex min-w-0 items-center gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">{initials(order.clientName)}</span><span className="min-w-0"><span className="block truncate font-mono text-[10px] font-semibold text-primary">{order.orderId}</span><span className="mt-0.5 block truncate text-xs font-medium">{order.clientName}</span><span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{order.locationName} · {dateLabel(order.createdAt)}</span></span></div></td>
                            <td className="py-3 pr-3"><StatusPill status={order.status} /></td>
                            <td className="py-3 pr-3"><span className="font-mono text-[10px]">{formatNumber(order.readyWindows)}<span className="text-muted-foreground"> / {formatNumber(order.totalWindows)}</span></span><div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${order.totalWindows ? Math.min(100, (order.readyWindows / order.totalWindows) * 100) : 0}%` }} /></div></td>
                            <td className="py-3 pr-3"><span className="block truncate text-[9px] capitalize text-muted-foreground">{order.dispatchStatus?.replaceAll('_', ' ') ?? 'Dispatch —'}</span><span className="mt-1 block truncate text-[9px] capitalize">{order.installationStatus ?? 'Installation —'}</span></td>
                            {permissions.finance && <td className="py-3 text-right font-mono text-[10px]">{compactCurrency(order.orderValue)}</td>}
                          </tr>)}
                        </tbody>
                      </table>
                    </div>
                  </> : <SectionState loading={false} error={null} empty retry={refresh} emptyTitle="No recent orders" />}
                </section>
              </DashboardWidgetBoundary>}

              {permissions?.installation && <DashboardWidgetBoundary name="Installer capacity" onRetry={refresh}>
                <section className="dashboard-card min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5">
                  <SectionHeading eyebrow="Field team" title="Installer capacity" icon={Wrench} action={<Link href="/installation" className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-primary hover:bg-primary/[.06]" data-testid="link-dashboard-installation">Installation <ArrowUpRight size={13} /></Link>} />
                  <p className="-mt-2 mb-3 text-[10px] text-muted-foreground">Peak scheduled orders per day in the selected range · sorted by load.</p>
                  {loading || errorFor('installation') ? <SectionState loading={loading} error={errorFor('installation')} empty={false} retry={refresh} /> : data?.installerCapacity.length ? <div className="space-y-1.5">
                    {data.installerCapacity.slice(0, 8).map((installer) => {
                      const ratio = installer.capacity > 0 ? installer.assigned / installer.capacity : 0;
                      const full = ratio >= 1;
                      const color = full ? '#EF4444' : ratio >= 0.8 ? '#F97316' : '#14B8A6';
                      return <button type="button" key={installer.id} onClick={() => setFilter('installerId', filters.installerId === installer.id ? undefined : installer.id)} className={`w-full rounded-xl px-2.5 py-2 text-left transition hover:bg-primary/[.04] ${filters.installerId === installer.id ? 'bg-primary/[.07]' : ''}`} data-testid={`button-installer-capacity-${installer.id}`}>
                        <span className="flex items-center gap-2.5">
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-[9px] font-bold text-secondary-foreground">{initials(installer.name)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold">{installer.name}</span><span className="shrink-0 font-mono text-[10px] font-semibold" style={{ color }}>{formatNumber(installer.assigned)} / {formatNumber(installer.capacity)}</span></span>
                            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full transition-all" style={{ width: `${Math.min(100, ratio * 100)}%`, backgroundColor: color }} /></span>
                            <span className="mt-1 flex justify-between gap-2 text-[9px] text-muted-foreground"><span>{installer.peakDay ? `Peak day · ${dateLabel(installer.peakDay)}` : 'No scheduled work in range'}</span><span>{formatNumber(installer.scheduledCount)} total</span></span>
                          </span>
                        </span>
                      </button>;
                    })}
                  </div> : <SectionState loading={false} error={null} empty retry={refresh} emptyTitle="No installers in view" emptyDetail="Add eligible installation users to a team to see capacity." />}
                </section>
              </DashboardWidgetBoundary>}
            </div>}

            {secondaryHasData || secondaryHasError ? <section className="grid min-w-0 gap-4 lg:grid-cols-2" aria-label="Additional operational activity">
              {permissions?.dispatch && ((data?.dispatchQueue.length ?? 0) > 0 || errorFor('dispatch')) && <DashboardWidgetBoundary name="Dispatch queue" onRetry={refresh}>
                <CompactPanel title="Dispatch queue" eyebrow="Dispatch" icon={Truck} count={formatNumber(data?.dispatchQueue.length)} href="/dispatch" hrefLabel="Open dispatch">
                  {loading || errorFor('dispatch') || errorFor('orders') ? <SectionState loading={loading} error={errorFor('dispatch') || errorFor('orders')} empty={false} retry={refresh} /> : data?.dispatchQueue.length ? <div className="space-y-1">{data.dispatchQueue.slice(0, 4).map((order) => <button type="button" key={order.id} onClick={() => setLocation('/dispatch')} className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-primary/[.04]" data-testid={`button-dispatch-order-${order.id}`}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Truck size={14} /></span><span className="min-w-0 flex-1"><span className="block truncate font-mono text-[10px] font-semibold text-primary">{order.orderId}</span><span className="mt-0.5 block truncate text-[10px]">{order.clientName} · {order.locationName}</span></span><span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-semibold capitalize text-amber-700 dark:text-amber-300">{order.dispatchStatus.replaceAll('_', ' ')}</span></button>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} />}
                </CompactPanel>
              </DashboardWidgetBoundary>}

              {permissions?.finance && (((data?.summary.outstandingBalance ?? 0) > 0) || (data?.reminderCandidates.length ?? 0) > 0 || errorFor('finance')) && <DashboardWidgetBoundary name="Payment follow-through" onRetry={refresh}>
                <CompactPanel title="Payment follow-through" eyebrow="Accounts" icon={CircleDollarSign} count={compactCurrency(data?.summary.outstandingBalance)} href="/payments" hrefLabel="Open payments">
                  {loading || errorFor('finance') || errorFor('orders') ? <SectionState loading={loading} error={errorFor('finance') || errorFor('orders')} empty={false} retry={refresh} /> : reminders.length ? <div className="space-y-1.5">
                    {reminders.slice(0, 4).map((candidate) => <div key={candidate.orderRecordId} className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-2">
                      <button type="button" onClick={() => { setFilter('paymentStatus', 'unpaid'); setFilter('q', candidate.orderId); setSearchDraft(candidate.orderId); }} className="min-w-0 flex-1 text-left" data-testid={`button-reminder-candidate-${candidate.orderRecordId}`}><span className="block truncate font-mono text-[10px] font-semibold text-primary">{candidate.orderId} · {candidate.clientName}</span><span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{candidate.locationName} · open balance</span></button>
                      <span className="shrink-0 text-right font-mono text-[10px] font-semibold">{compactCurrency(candidate.balance)}</span>
                      <form method="post" action={`/api/orders/${encodeURIComponent(candidate.orderRecordId)}/payment-reminder`} target="_blank" rel="noreferrer"><button type="submit" disabled={!candidate.canOpenWhatsApp} title="Open a manual WhatsApp reminder draft for staff review" aria-label={`Draft reminder for ${candidate.orderId}`} className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition hover:border-primary/30 hover:text-primary disabled:opacity-40"><Activity size={13} /></button></form>
                    </div>)}
                  </div> : <p className="rounded-xl border border-border/60 bg-background p-3 text-[10px] text-muted-foreground">Outstanding balance is present, but no orders currently meet the reminder criteria.</p>}
                </CompactPanel>
              </DashboardWidgetBoundary>}

              {permissions?.installation && ((data?.installationSchedule.length ?? 0) > 0 || errorFor('installation')) && <DashboardWidgetBoundary name="Installation schedule" onRetry={refresh}>
                <CompactPanel title="Installation schedule" eyebrow="Field work" icon={Wrench} count={formatNumber(data?.installationSchedule.length)} href="/installation" hrefLabel="Open installations">
                  {loading || errorFor('installation') ? <SectionState loading={loading} error={errorFor('installation')} empty={false} retry={refresh} /> : data?.installationSchedule.length ? <div className="space-y-1">{data.installationSchedule.slice(0, 4).map((item) => <button type="button" key={item.orderRecordId} onClick={() => setLocation('/installation')} className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-primary/[.04]" data-testid={`button-installation-schedule-${item.orderRecordId}`}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><CalendarDays size={14} /></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="font-mono text-[10px] font-semibold text-primary">{item.orderId}</span><span className="shrink-0 text-[9px] text-muted-foreground">{dateLabel(item.scheduledDate)}</span></span><span className="mt-0.5 block truncate text-[10px] font-medium">{item.clientName} · {item.locationName}</span><span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{item.teamName || 'Team pending'}{item.subteamName ? ` · ${item.subteamName}` : ''}{item.assignedMembers.length ? ` · ${item.assignedMembers.join(', ')}` : ''}</span></span></button>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} />}
                </CompactPanel>
              </DashboardWidgetBoundary>}

              {permissions?.orders && ((data?.topClients.length ?? 0) > 0 || errorFor('orders')) && <DashboardWidgetBoundary name="Top clients" onRetry={refresh}>
                <CompactPanel title="Top clients" eyebrow="Relationships" icon={Users} count={formatNumber(data?.topClients.length)} href="/order-hub" hrefLabel="Open orders">
                  {loading || errorFor('orders') ? <SectionState loading={loading} error={errorFor('orders')} empty={false} retry={refresh} /> : data?.topClients.length ? <div className="space-y-0.5">{data.topClients.slice(0, 5).map((client, index) => <button type="button" key={client.clientId} onClick={() => setFilter('clientId', client.clientId)} className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-primary/[.04]" data-testid={`button-top-client-${client.clientId}`}><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-secondary font-mono text-[9px] font-bold text-secondary-foreground">{String(index + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1 truncate text-[10px] font-semibold">{client.clientName}</span><span className="shrink-0 text-right"><span className="block font-mono text-[10px] font-semibold">{formatNumber(client.orderCount)} orders</span>{permissions.finance && <span className="text-[9px] text-muted-foreground">{compactCurrency(client.orderValue)}</span>}</span></button>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} />}
                </CompactPanel>
              </DashboardWidgetBoundary>}

              {permissions?.measurements && ((data?.recentMeasurements.length ?? 0) > 0 || errorFor('measurements')) && <DashboardWidgetBoundary name="Measurement uploads" onRetry={refresh}>
                <CompactPanel title="Measurement uploads" eyebrow="Production intake" icon={FileSpreadsheet} count={formatNumber(data?.recentMeasurements.length)} href="/measurements" hrefLabel="Open measurements">
                  {loading || errorFor('measurements') ? <SectionState loading={loading} error={errorFor('measurements')} empty={false} retry={refresh} /> : data?.recentMeasurements.length ? <div className="space-y-1">{data.recentMeasurements.slice(0, 4).map((upload) => <button type="button" key={upload.id} onClick={() => setLocation('/measurements')} className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-primary/[.04]" data-testid={`button-measurement-upload-${upload.id}`}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><FileSpreadsheet size={14} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-semibold">{upload.filename}</span><span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{upload.clientName}{upload.location ? ` · ${upload.location}` : ''}</span></span><time className="shrink-0 text-[9px] text-muted-foreground">{relativeTime(upload.uploadedAt)}</time></button>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} />}
                </CompactPanel>
              </DashboardWidgetBoundary>}
            </section> : !loading && data && <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-5 text-center text-xs text-muted-foreground">No additional activity yet.</div>}
          </>}

          {!loading && data && !canViewAnyDashboard && <div className="rounded-[20px] border border-dashed border-border bg-card p-10 text-center">
            <span className="mx-auto grid size-11 place-items-center rounded-xl bg-secondary text-secondary-foreground"><Filter size={18} /></span>
            <h2 className="mt-3 text-lg font-semibold">No dashboard sections assigned</h2>
            <p className="mt-1 text-sm text-muted-foreground">Ask a workspace administrator to review your operational access.</p>
          </div>}

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-1 pt-3 text-[10px] text-muted-foreground">
            <span>Live operational view · Values and records reflect the filters above</span>
            <span className="inline-flex items-center gap-1.5"><Clock3 size={11} />{updatedAt ? `Snapshot ${dateLabel(new Date(updatedAt))} · ${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(new Date(updatedAt))}` : 'No snapshot yet'}</span>
          </footer>
        </div>
      </div>
    </AppShell>
  );
}

function HeroStat({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/12 bg-white/[.08] px-3 py-2.5">
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 text-teal-200"><Icon size={15} /></span>
    <span className="min-w-0"><span className="block truncate text-[9px] text-white/60">{label}</span><span className="mt-0.5 block truncate text-sm font-semibold tabular-nums text-white">{value}</span></span>
  </div>;
}

function CompactPanel({ children, title, eyebrow, icon: Icon, count, href, hrefLabel }: {
  children: React.ReactNode;
  title: string;
  eyebrow: string;
  icon: LucideIcon;
  count: string;
  href: string;
  hrefLabel: string;
}) {
  return <section className="dashboard-card min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5">
    <SectionHeading eyebrow={eyebrow} title={title} icon={Icon} action={<span className="shrink-0 rounded-full border border-border bg-background px-2 py-1 font-mono text-[9px] text-muted-foreground">{count}</span>} />
    {children}
    <Link href={href} className="mt-2 flex items-center justify-between border-t border-border/70 pt-2.5 text-[10px] font-semibold text-primary hover:underline">{hrefLabel}<ArrowUpRight size={12} /></Link>
  </section>;
}
