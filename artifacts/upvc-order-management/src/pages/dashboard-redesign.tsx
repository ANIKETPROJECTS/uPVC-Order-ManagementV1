import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { Link, useLocation } from 'wouter';
import {
  Activity, AlertCircle, ArrowUpRight, BadgeCheck, CalendarDays, Check, ChevronDown, ChevronUp,
  CircleDollarSign, Clock3, CreditCard, Download, Factory, FileSpreadsheet, Filter,
  Eye, EyeOff, Gauge, Layers3, MapPin, Moon, PackageCheck, Printer, QrCode, RefreshCw, Search,
  SlidersHorizontal, Sun, Truck, Users, Wrench, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  getGetDispatchSummaryQueryKey, getGetOperationsDashboardQueryKey, getListDispatchRecordsQueryKey, useGetDashboardPreferences, useGetDispatchSummary, useGetOperationsDashboard, useListDispatchRecords,
  useUpdateDashboardPreferences,
} from '@workspace/api-client-react';
import type { DashboardAttentionItem, GetOperationsDashboardParams, OperationsDashboard, User } from '@workspace/api-client-react';
import {
  Area, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { AppShell } from '@/components/app-shell';
import { DashboardWidgetBoundary } from '@/components/dashboard-widget-boundary';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type Filters = GetOperationsDashboardParams;
type RangePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'last6' | 'thisMonth' | 'lastMonth' | 'thisFY' | 'custom';

const DEFAULT_REFRESH_SECONDS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
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
type DashboardPermission = keyof OperationsDashboard['permissions'];
function dispatchActivityTitle(action: string, summary: string, dispatchCode: string) {
  if (action === 'dispatch.created') return `Dispatch ${dispatchCode} created`;
  if (action === 'dispatch.cancelled') return `Dispatch ${dispatchCode} cancelled`;
  if (action === 'dispatch.updated') return `Dispatch ${dispatchCode} updated`;
  if (action === 'dispatch.status_changed') {
    const status = summary.match(/\bto\s+(planned|dispatched|delivered|returned|cancelled)\b/i)?.[1]?.toLowerCase();
    if (status) return `Dispatch ${dispatchCode} ${status === 'dispatched' ? 'dispatched' : status}`;
  }
  return summary;
}
type DashboardWidgetDefinition = {
  id: string;
  title: string;
  permission?: DashboardPermission;
  endpoint: string;
  defaultVisible: boolean;
  defaultOrder: number;
  size: 'full' | 'wide' | 'compact';
  group: 'summary' | 'charts' | 'pipeline' | 'priority' | 'field' | 'dispatch' | 'follow-ups';
};
type DashboardWidgetPreferences = { order: string[]; hidden: string[] };
const DASHBOARD_WIDGETS: DashboardWidgetDefinition[] = [
  { id: 'kpis', title: 'Key figures', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 0, size: 'full', group: 'summary' },
  { id: 'trend', title: 'Order trends', permission: 'orders', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 1, size: 'wide', group: 'charts' },
  { id: 'stage-mix', title: 'Stage distribution', permission: 'orders', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 2, size: 'compact', group: 'charts' },
  { id: 'pipeline', title: 'Order pipeline', permission: 'orders', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 3, size: 'full', group: 'pipeline' },
  { id: 'attention', title: 'Needs attention', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 4, size: 'wide', group: 'priority' },
  { id: 'activity', title: 'Live activity', permission: 'orders', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 5, size: 'wide', group: 'priority' },
  { id: 'recent-orders', title: 'Recent orders', permission: 'orders', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 6, size: 'wide', group: 'field' },
  { id: 'capacity', title: 'Installer capacity', permission: 'installation', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 7, size: 'compact', group: 'field' },
  { id: 'dispatch', title: 'Dispatch queue', permission: 'dispatch', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 8, size: 'wide', group: 'dispatch' },
  { id: 'top-clients', title: 'Top clients', permission: 'orders', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 9, size: 'wide', group: 'dispatch' },
  { id: 'payments', title: 'Payment follow-through', permission: 'finance', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 10, size: 'compact', group: 'follow-ups' },
  { id: 'installation', title: 'Installation schedule', permission: 'installation', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 11, size: 'compact', group: 'follow-ups' },
  { id: 'measurements', title: 'Measurement uploads', permission: 'measurements', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 12, size: 'compact', group: 'follow-ups' },
  { id: 'approvals', title: 'Quotation approvals', permission: 'approvals', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 13, size: 'compact', group: 'follow-ups' },
  { id: 'glass', title: 'Glass status', permission: 'glass', endpoint: '/api/dashboard/operations', defaultVisible: true, defaultOrder: 14, size: 'compact', group: 'follow-ups' },
];
const widgetGroupLabels: Record<DashboardWidgetDefinition['group'], string> = {
  summary: 'Key figures',
  charts: 'Charts',
  pipeline: 'Order pipeline',
  priority: 'Priority and activity',
  field: 'Orders and field team',
  dispatch: 'Dispatch and clients',
  'follow-ups': 'Additional follow-up',
};
const stagePalette = ['#0F766E', '#2563EB', '#7C3AED', '#16A34A', '#D97706', '#DB2777', '#475569', '#0891B2'];
const normalizeWidgetPreferences = (value?: DashboardWidgetPreferences | null): DashboardWidgetPreferences => {
  const registered = new Set(DASHBOARD_WIDGETS.map((widget) => widget.id));
  const savedOrder = (value?.order ?? []).filter((id) => registered.has(id));
  const order = [...savedOrder, ...DASHBOARD_WIDGETS
    .filter((widget) => !savedOrder.includes(widget.id))
    .sort((left, right) => left.defaultOrder - right.defaultOrder)
    .map((widget) => widget.id)];
  return {
    order,
    hidden: (value?.hidden ?? DASHBOARD_WIDGETS.filter((widget) => !widget.defaultVisible).map((widget) => widget.id))
      .filter((id) => registered.has(id)),
  };
};
const widgetById = (id: string) => DASHBOARD_WIDGETS.find((widget) => widget.id === id)!;
const stageColor = (status: string, pipeline: OperationsDashboard['pipeline'] = []) => {
  const index = pipeline.findIndex((stage) => stage.status === status);
  return stagePalette[(index < 0 ? 0 : index) % stagePalette.length];
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
    ...(candidateStage ? { stage: candidateStage as Filters['stage'] } : {}),
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
function makeDashboardHref(path: string, filters: Filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.stage) params.set(path === '/order-hub' || path.startsWith('/order-hub/') ? 'status' : 'stage', filters.stage);
  if (filters.clientId) params.set('clientId', filters.clientId);
  if (filters.locationCode) params.set('locationCode', filters.locationCode);
  if (filters.installerId) params.set('installerId', filters.installerId);
  if (filters.paymentStatus) params.set('paymentStatus', filters.paymentStatus);
  if (filters.assignment) params.set('assignment', filters.assignment);
  if (filters.glassStatus) params.set('glassStatus', filters.glassStatus);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.compare) params.set('compare', 'true');
  const query = params.toString();
  return `${path}${query ? `${path.includes('?') ? '&' : '?'}${query}` : ''}`;
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
  const samples = finite.length >= 7 ? finite : Array.from({ length: 7 }, (_, index) => {
    const position = (index / 6) * (finite.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(finite.length - 1, Math.ceil(position));
    const fraction = position - lower;
    return Math.max(0, finite[lower] + (finite[upper] - finite[lower]) * fraction);
  });
  const min = Math.min(0, ...samples);
  const max = Math.max(...samples);
  const range = max - min || 1;
  const points = samples.map((value, index) => {
    const x = (index / (samples.length - 1)) * 64;
    const y = 22 - ((Math.max(0, value) - min) / range) * 18;
    return { x, y };
  });
  const line = points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const control = (point.x - previous.x) / 3;
    return `${path} C ${(previous.x + control).toFixed(1)},${previous.y.toFixed(1)} ${(point.x - control).toFixed(1)},${point.y.toFixed(1)} ${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }, `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`);
  return <svg className="h-7 w-16 shrink-0" viewBox="0 0 64 24" role="img" aria-label="Trend sparkline">
    <path d={`${line} L 64 24 L 0 24 Z`} fill={color} fillOpacity=".12" />
    <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
          <p className="line-clamp-2 min-h-6 whitespace-normal break-words text-[9px] font-bold uppercase leading-[1.25] tracking-[.08em] text-muted-foreground">{label}</p>
          <p className="mt-3 truncate text-[25px] font-semibold leading-none tracking-[-.04em] tabular-nums sm:text-[28px]">
            <AnimatedValue value={value} format={format} />
          </p>
        </div>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${tint}18`, color: tint }}><Icon size={18} /></span>
      </div>
      <div className="mt-3 flex min-h-9 items-start justify-between gap-2">
        <span className="min-w-0 flex-1 whitespace-normal text-[9px] leading-4 text-muted-foreground">{comparison || note}</span>
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
    <div className="w-full min-w-0 rounded-xl border border-white/15 bg-white/[.08] px-3 py-2 text-white/90">
      <div className="flex min-w-0 items-center gap-2 text-[9px] font-semibold uppercase tracking-[.12em] text-white/70">
        <span className={`size-1.5 shrink-0 rounded-full ${refreshSeconds ? 'animate-pulse bg-emerald-300' : 'bg-amber-300'}`} />
        India Standard Time
      </div>
      <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
        <time className="font-mono text-[17px] font-semibold tabular-nums tracking-tight" dateTime={now.toISOString()}>{time}</time>
        <p className="whitespace-nowrap text-[9px] text-white/70">{date}</p>
      </div>
      <p className="mt-1 truncate border-t border-white/15 pt-1 text-[8px] text-white/65">{refreshSeconds ? `Live · refreshes every ${refreshSeconds}s` : 'Auto-refresh is off'} · {refreshText}</p>
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
function StatusPill({ status, label, color }: { status: string; label?: string; color?: string }) {
  return <span className="inline-flex w-max max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-secondary/80 px-2.5 py-1 text-[10px] font-semibold capitalize">
    <i className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color || stagePalette[0] }} />
    <span className="whitespace-nowrap">{label || status.replaceAll('_', ' ')}</span>
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
  const [widgetDrawerOpen, setWidgetDrawerOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const dispatchAccess = user.roleId === 'master-admin' || ['view', 'edit'].includes(user.permissions?.dispatch || '');
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
  const dispatchRecordQuery = useListDispatchRecords(undefined, { query: { enabled: dispatchAccess, queryKey: getListDispatchRecordsQueryKey() } });
  const dispatchSummaryQuery = useGetDispatchSummary({ query: { enabled: dispatchAccess, queryKey: getGetDispatchSummaryQueryKey() } });
  const widgetPreferencesQuery = useGetDashboardPreferences();
  const widgetPreferencesMutation = useUpdateDashboardPreferences();
  const [widgetPreferences, setWidgetPreferences] = useState<DashboardWidgetPreferences>(() => normalizeWidgetPreferences());
  const data = query.data as OperationsDashboard | undefined;
  const permissions = data?.permissions;
  const loading = query.isLoading;
  const updatedAt = query.dataUpdatedAt || (data?.updatedAt ? new Date(data.updatedAt).getTime() : 0);
  const retry = () => { void query.refetch(); };
  const errorFor = (key: keyof OperationsDashboard['sectionErrors']) => data?.sectionErrors[key] || null;
  const stageTotal = data?.pipeline.reduce((total, stage) => total + stage.count, 0) ?? 0;
  const rangePreset = inferPreset(filters.from, filters.to);
  useEffect(() => {
    if (widgetPreferencesQuery.data) {
      setWidgetPreferences(normalizeWidgetPreferences(widgetPreferencesQuery.data));
    }
  }, [widgetPreferencesQuery.data]);
  const saveWidgetPreferences = async (next: DashboardWidgetPreferences) => {
    setWidgetPreferences(next);
    try {
      const saved = await widgetPreferencesMutation.mutateAsync({ data: next });
      setWidgetPreferences(normalizeWidgetPreferences(saved));
    } catch {
      setWidgetPreferences(normalizeWidgetPreferences(widgetPreferencesQuery.data));
    }
  };
  const isWidgetVisible = (id: string) => !widgetPreferences.hidden.includes(id);
  const widgetOrder = (id: string) => {
    const position = widgetPreferences.order.indexOf(id);
    return position < 0 ? widgetById(id).defaultOrder : position;
  };
  const toggleWidget = (id: string) => {
    const hidden = new Set(widgetPreferences.hidden);
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    void saveWidgetPreferences({ ...widgetPreferences, hidden: [...hidden] });
  };
  const moveWidget = (id: string, delta: -1 | 1) => {
    const widget = widgetById(id);
    const groupWidgets = DASHBOARD_WIDGETS
      .filter((item) => item.group === widget.group)
      .sort((left, right) => widgetOrder(left.id) - widgetOrder(right.id));
    const position = groupWidgets.findIndex((item) => item.id === id);
    const target = position + delta;
    if (target < 0 || target >= groupWidgets.length) return;
    const order = [...widgetPreferences.order];
    const fromIndex = order.indexOf(id);
    const toIndex = order.indexOf(groupWidgets[target].id);
    [order[fromIndex], order[toIndex]] = [order[toIndex], order[fromIndex]];
    void saveWidgetPreferences({ ...widgetPreferences, order });
  };
  const resetWidgetPreferences = () => {
    void saveWidgetPreferences(normalizeWidgetPreferences());
  };

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
  const hasOrderValue = Boolean(permissions?.finance && trend.some((point) => Number(point.orderValue) > 0));
  const orderSpark = trend.map((point) => point.orderCount);
  const valueSpark = trend.map((point) => point.orderValue ?? 0);
  const readinessSpark = trend.map((point) => point.totalWindows ? (point.readyWindows / point.totalWindows) * 100 : 0);
  const balanceSpark = trend.map((point) => point.outstandingBalance ?? 0);
  const installedSpark = trend.map((point) => point.installedOrders);
  const ordersHref = makeDashboardHref('/order-hub', filters);
  const dispatchRecords = dispatchRecordQuery.data?.records ?? [];
  const readyDispatchLots = dispatchSummaryQuery.data?.readyLotsAwaitingDispatch ?? [];
  const dispatchStatusCount = (status: 'planned' | 'dispatched' | 'delivered' | 'returned') =>
    dispatchSummaryQuery.data?.statusCounts[status] ?? dispatchRecords.filter((record) => record.status === status).length;
  const oldPlannedDispatches = dispatchRecords.filter((record) => record.status === 'planned'
    && Date.parse(record.plannedAt || record.createdAt) < Date.now() - DAY_MS);
  const longInTransitDispatches = dispatchRecords.filter((record) => record.status === 'dispatched'
    && Date.parse(record.dispatchedAt || record.createdAt) < Date.now() - 3 * DAY_MS);
  const dispatchAttention: DashboardAttentionItem[] = [];
  if (readyDispatchLots.length) dispatchAttention.push({
    id: 'dispatch-ready-lots',
    title: 'Ready lots not yet dispatched',
    description: 'Production-ready lots have no dispatch record yet.',
    count: readyDispatchLots.length,
    amount: null,
    href: '/dispatch',
    severity: 'warning',
  });
  if (oldPlannedDispatches.length || longInTransitDispatches.length) dispatchAttention.push({
    id: 'dispatch-overdue-handoffs',
    title: 'Dispatches need follow-up',
    description: `${oldPlannedDispatches.length} planned over 1 day · ${longInTransitDispatches.length} in transit over 3 days.`,
    count: oldPlannedDispatches.length + longInTransitDispatches.length,
    amount: null,
    href: '/dispatch',
    severity: oldPlannedDispatches.length + longInTransitDispatches.length > 0 ? 'warning' : 'success',
  });
  const activeFilterCount = [
    filters.q, filters.stage, filters.clientId, filters.locationCode, filters.installerId,
    filters.paymentStatus, filters.assignment, filters.glassStatus,
  ].filter(Boolean).length
    + (filters.compare ? 1 : 0)
    + (filters.from !== dateRangeFor('last30').from || filters.to !== dateRangeFor('last30').to ? 1 : 0);
  const activeAttention = [
    ...(data?.attention ?? []).filter((item) => item.id !== 'pending-dispatch'),
    ...(dispatchAccess ? dispatchAttention : []),
  ].slice().sort((a, b) =>
    Number(a.count === 0) - Number(b.count === 0)
    || severityOrder[a.severity] - severityOrder[b.severity]
    || b.count - a.count
    || a.title.localeCompare(b.title));
  const visibleAttention = activeAttention.filter((item) => item.count > 0 && item.severity !== 'success' && attentionAllowed(item.href, permissions));
  const approvalItems = activeAttention.filter((item) => item.count > 0 && /quote|approval/i.test(`${item.id} ${item.href}`));
  const glassItems = activeAttention.filter((item) => item.count > 0 && /glass/i.test(`${item.id} ${item.href}`));
  const attentionError = [
    permissions?.orders && errorFor('orders'),
    permissions?.finance && errorFor('finance'),
    permissions?.dispatch && errorFor('dispatch'),
    permissions?.dispatch && dispatchSummaryQuery.isError && 'Dispatch ready-lot summary unavailable.',
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
    (isWidgetVisible('payments') && permissions?.finance && (data?.reminderCandidates.length || (data?.summary.outstandingBalance ?? 0) > 0))
    || (isWidgetVisible('installation') && permissions?.installation && data?.installationSchedule.length)
    || (isWidgetVisible('measurements') && permissions?.measurements && data?.recentMeasurements.length)
    || (isWidgetVisible('approvals') && permissions?.approvals && approvalItems.length)
    || (isWidgetVisible('glass') && permissions?.glass && glassItems.length),
  );
  const secondaryHasError = Boolean(
    (isWidgetVisible('payments') && permissions?.finance && errorFor('finance'))
    || (isWidgetVisible('installation') && permissions?.installation && errorFor('installation'))
    || (isWidgetVisible('measurements') && permissions?.measurements && errorFor('measurements'))
    || (isWidgetVisible('approvals') && permissions?.approvals && errorFor('approvals'))
    || (isWidgetVisible('glass') && permissions?.glass && errorFor('glass')),
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
  const isDefaultRange = filters.from === dateRangeFor('last30').from && filters.to === dateRangeFor('last30').to;
  const dateChipLabel = () => rangePreset === 'custom'
    ? `${dateLabel(filters.from)} – ${dateLabel(filters.to)}`
    : presetOptions.find((option) => option.value === rangePreset)?.label || `${dateLabel(filters.from)} – ${dateLabel(filters.to)}`;
  const statusLabel = (status: string) => data?.filterOptions.stages.find((option) => option.id === status)?.label
    || status.replaceAll('_', ' ');
  const filterLabel = (options: Array<{ id: string; label: string }> | undefined, id: string) =>
    options?.find((option) => option.id === id)?.label || id.replaceAll('_', ' ');
  const exportDashboardCsv = () => {
    const rows: Array<Record<string, string | number | null>> = [
      ...recentOrders.map((order) => ({
        section: 'Recent orders',
        orderId: order.orderId,
        client: order.clientName,
        location: order.locationName,
        status: statusLabel(order.status),
        detail: `Windows ${order.readyWindows}/${order.totalWindows}`,
        date: dateLabel(order.createdAt),
        valueINR: permissions?.finance ? order.orderValue : null,
      })),
      ...visibleAttention.map((item) => ({
        section: 'Needs attention',
        orderId: '',
        client: '',
        location: '',
        status: item.title,
        detail: item.description,
        date: '',
        valueINR: permissions?.finance ? item.amount : null,
      })),
    ];
    downloadCsv(`operations-dashboard-${filters.from}-${filters.to}.csv`, rows);
  };

  return (
    <AppShell user={user} title="Operations dashboard" eyebrow="Live operations · India">
      <div className="dashboard-page -mx-5 -my-6 min-h-[calc(100dvh-76px)] px-5 py-6 md:-mx-8 md:-my-8 md:px-8 md:py-8">
        <div className="dashboard-layout mx-auto max-w-[1600px] pb-8">
          <DashboardWidgetBoundary name="Dashboard overview" onRetry={refresh}>
            <header className="dashboard-hero relative z-20 col-span-12 rounded-[24px] px-5 py-4 shadow-lg md:px-7 md:py-5">
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
                <div className="absolute -right-12 -top-20 size-72 rounded-full border border-white/10" />
                <div className="absolute right-16 top-10 size-28 rounded-full border border-white/10" />
              </div>
              <div className="relative flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 whitespace-nowrap text-[9px] font-bold uppercase tracking-[.2em] text-teal-200"><span className="size-1.5 shrink-0 rounded-full bg-teal-300" />Live Order Overview</p>
                  <h2 className="mt-1.5 line-clamp-2 max-w-3xl text-[25px] font-semibold leading-tight tracking-[-.045em] md:text-[32px] xl:line-clamp-1 xl:whitespace-nowrap">Every order, one clear view</h2>
                  <p className="mt-1.5 max-w-full truncate whitespace-nowrap text-xs leading-5 text-white/70">Track orders, readiness, payments and field work for {dateLabel(filters.from)} – {dateLabel(filters.to)}.</p>
                </div>
                <div className="flex min-w-0 flex-col gap-2 xl:w-[490px] xl:shrink-0 xl:items-end">
                  <MemoizedLiveClock lastRefresh={updatedAt || null} refreshSeconds={refreshSeconds} />
                  <div className="flex w-full min-w-0 flex-nowrap items-center gap-1.5 print:hidden xl:justify-end">
                    {user.roleId === 'master-admin' && <button type="button" title="Customize dashboard" aria-label="Customize dashboard" disabled={widgetPreferencesQuery.isLoading} onClick={() => setWidgetDrawerOpen(true)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-2.5 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-50 sm:px-3" data-testid="button-customize-dashboard"><SlidersHorizontal size={14} /><span className="hidden sm:inline">Customize</span></button>}
                    <button type="button" title="Refresh dashboard" aria-label="Refresh dashboard" onClick={refresh} disabled={query.isFetching} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-2.5 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-60 sm:px-3" data-testid="button-refresh-dashboard">
                      <RefreshCw size={14} className={query.isFetching ? 'animate-spin' : ''} /><span className="hidden sm:inline">Refresh</span>
                    </button>
                    <label title="Automatic refresh interval" className="relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-2 text-white">
                      <span className="sr-only">Auto-refresh interval</span>
                      <Clock3 size={14} aria-hidden="true" />
                      <span className="hidden text-[10px] font-semibold sm:inline">Auto:</span>
                      <select value={refreshSeconds} onChange={(event) => setRefreshSeconds(Number(event.target.value))} className="h-full max-w-[48px] appearance-none bg-transparent pr-3 text-[10px] font-semibold outline-none sm:max-w-none sm:text-[11px] sm:pr-5 [&>option]:text-foreground" aria-label="Auto-refresh interval" data-testid="select-dashboard-auto-refresh">
                        <option value={0}>Off</option><option value={30}>30s</option><option value={60}>60s</option>
                      </select>
                      <ChevronDown size={11} className="pointer-events-none absolute right-1.5" />
                    </label>
                    <div className="relative">
                      <button type="button" title="Export dashboard" aria-label="Export dashboard" aria-expanded={exportMenuOpen} onClick={() => setExportMenuOpen((open) => !open)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-2.5 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-50 sm:px-3" disabled={!data} data-testid="button-export-dashboard"><Download size={14} /><span className="hidden sm:inline">Export</span><ChevronDown size={12} className="hidden sm:block" /></button>
                      {exportMenuOpen && <div className="absolute right-0 top-10 z-40 w-52 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl" role="menu">
                        <button type="button" onClick={() => { window.print(); setExportMenuOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-muted" role="menuitem"><Printer size={13} className="mr-2 inline" />Print / Save as PDF</button>
                        <button type="button" onClick={() => { exportDashboardCsv(); setExportMenuOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-muted" role="menuitem"><Download size={13} className="mr-2 inline" />Download orders + attention CSV</button>
                      </div>}
                    </div>
                    <button type="button" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`} className="grid size-9 place-items-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/15" data-testid="button-toggle-theme">{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
                  </div>
                </div>
              </div>
              <Sheet open={widgetDrawerOpen} onOpenChange={setWidgetDrawerOpen}>
                <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
                  <SheetHeader>
                    <SheetTitle>Dashboard widgets</SheetTitle>
                    <SheetDescription>Show or hide widgets and reorder them within each dashboard row. Your choices are saved to your user account.</SheetDescription>
                  </SheetHeader>
                  <div className="mt-5 space-y-5">
                    {(Object.keys(widgetGroupLabels) as DashboardWidgetDefinition['group'][]).map((group) => {
                      const groupWidgets = DASHBOARD_WIDGETS
                        .filter((widget) => widget.group === group && (!widget.permission || permissions?.[widget.permission]))
                        .sort((left, right) => widgetOrder(left.id) - widgetOrder(right.id));
                      if (!groupWidgets.length) return null;
                      return <section key={group} aria-label={widgetGroupLabels[group]}>
                        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{widgetGroupLabels[group]}</h3>
                        <div className="space-y-2">
                          {groupWidgets.map((widget, index) => <div key={widget.id} className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5">
                            <button type="button" disabled={widgetPreferencesMutation.isPending} onClick={() => toggleWidget(widget.id)} aria-label={`${isWidgetVisible(widget.id) ? 'Hide' : 'Show'} ${widget.title}`} aria-pressed={isWidgetVisible(widget.id)} className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground disabled:opacity-50" data-testid={`button-toggle-widget-${widget.id}`}>{isWidgetVisible(widget.id) ? <Eye size={15} /> : <EyeOff size={15} />}</button>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold">{widget.title}</span>
                              <span className="block truncate text-[9px] text-muted-foreground">{widget.endpoint} · {widget.size} layout</span>
                            </span>
                            <button type="button" disabled={index === 0 || widgetPreferencesMutation.isPending} onClick={() => moveWidget(widget.id, -1)} aria-label={`Move ${widget.title} up`} className="grid size-7 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-35" data-testid={`button-widget-up-${widget.id}`}><ChevronUp size={14} /></button>
                            <button type="button" disabled={index === groupWidgets.length - 1 || widgetPreferencesMutation.isPending} onClick={() => moveWidget(widget.id, 1)} aria-label={`Move ${widget.title} down`} className="grid size-7 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-35" data-testid={`button-widget-down-${widget.id}`}><ChevronDown size={14} /></button>
                          </div>)}
                        </div>
                      </section>;
                    })}
                    {widgetPreferencesMutation.isError && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">Dashboard preferences could not be saved. Please try again.</p>}
                    <button type="button" disabled={widgetPreferencesMutation.isPending} onClick={resetWidgetPreferences} className="w-full rounded-xl border border-border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50" data-testid="button-reset-dashboard-widgets">Reset to defaults</button>
                  </div>
                </SheetContent>
              </Sheet>
            </header>
          </DashboardWidgetBoundary>

          <DashboardWidgetBoundary name="Dashboard filters" onRetry={refresh}>
            <section className="dashboard-filterbar col-span-12 rounded-2xl border border-border/80 bg-card/95 p-3 shadow-sm sm:p-3.5" aria-label="Dashboard filters">
                  <div className="grid min-w-0 gap-2 md:grid-cols-2 xl:grid-cols-[minmax(280px,1.8fr)_160px_minmax(150px,1fr)_minmax(150px,1fr)_auto]">
                <label className="relative block min-w-0">
                  <span className="sr-only">Search dashboard records</span>
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input ref={searchInputRef} aria-label="Search orders, clients, locations" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search orders, clients, locations" className="h-9 w-full rounded-xl border border-input bg-background pl-9 pr-14 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" data-testid="input-dashboard-search" />
                  <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">⌘K</kbd>
                </label>
                <label className="relative min-w-0">
                  <span className="sr-only">Date range</span>
                  <CalendarDays size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <select value={rangePreset} onChange={(event) => chooseRange(event.target.value as RangePreset)} className="h-9 w-full appearance-none rounded-xl border border-input bg-background pl-9 pr-7 text-xs font-medium" data-testid="select-dashboard-date-range">
                    {presetOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                </label>
                {permissions?.orders && <label className="relative min-w-0">
                  <span className="sr-only">Order stage</span>
                  <select value={filters.stage || ''} onChange={(event) => setFilter('stage', (event.target.value || undefined) as Filters['stage'])} className="h-9 w-full appearance-none rounded-xl border border-input bg-background px-3 pr-7 text-xs" data-testid="select-filter-stage">
                    <option value="">All stages</option>{data?.filterOptions.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                </label>}
                {permissions?.orders && <label className="relative min-w-0">
                  <span className="sr-only">Client</span>
                  <select value={filters.clientId || ''} onChange={(event) => setFilter('clientId', event.target.value || undefined)} className="h-9 w-full appearance-none rounded-xl border border-input bg-background px-3 pr-7 text-xs" data-testid="select-filter-client">
                    <option value="">All clients</option>{data?.filterOptions.clients.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                </label>}
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setMoreFiltersOpen((value) => !value)} aria-expanded={moreFiltersOpen} className={`inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition ${moreFiltersOpen || activeFilterCount ? 'border-primary/30 bg-primary/[.07] text-primary' : 'border-input bg-background text-muted-foreground hover:text-foreground'}`} data-testid="button-dashboard-more-filters"><Filter size={14} />More filters{activeFilterCount > 0 && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px]">{activeFilterCount}</span>}<ChevronDown size={12} className={moreFiltersOpen ? 'rotate-180' : ''} /></button>
                  <button type="button" onClick={clearFilters} className="h-9 rounded-xl px-2.5 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground" data-testid="button-clear-filters">Reset</button>
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
                  <select value={filters.paymentStatus || ''} onChange={(event) => setFilter('paymentStatus', (event.target.value || undefined) as Filters['paymentStatus'])} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-payment"><option value="">Any payment status</option>{data?.filterOptions.paymentStates.map((state) => <option key={state.id} value={state.id}>{state.label}</option>)}</select>
                </label>}
                {permissions?.installation && <label className="relative min-w-0">
                  <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Team assignment</span>
                  <select value={filters.assignment || ''} onChange={(event) => setFilter('assignment', (event.target.value || undefined) as Filters['assignment'])} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-assignment"><option value="">Any assignment</option>{data?.filterOptions.assignmentStates.map((state) => <option key={state.id} value={state.id}>{state.label}</option>)}</select>
                </label>}
                {permissions?.glass && <label className="relative min-w-0">
                  <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Glass status</span>
                  <select value={filters.glassStatus || ''} onChange={(event) => setFilter('glassStatus', (event.target.value || undefined) as Filters['glassStatus'])} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-filter-glass"><option value="">Any glass status</option>{data?.filterOptions.glassStates.map((state) => <option key={state.id} value={state.id}>{state.label}</option>)}</select>
                </label>}
                <button type="button" onClick={() => setFilter('compare', !filters.compare)} aria-pressed={Boolean(filters.compare)} className={`flex h-9 items-center justify-center gap-2 self-end rounded-lg border px-3 text-xs font-semibold transition ${filters.compare ? 'border-primary/30 bg-primary/[.07] text-primary' : 'border-input bg-background text-muted-foreground hover:bg-muted'}`} data-testid="button-toggle-compare">
                  <span className={`grid size-4 place-items-center rounded border ${filters.compare ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{filters.compare && <Check size={11} />}</span>Compare previous period
                </button>
              </div>}
              {(activeFilterCount > 0) && <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2" aria-label="Active dashboard filters">
                {!isDefaultRange && chip(dateChipLabel(), () => chooseRange('last30'), 'date')}
                {filters.q && chip(`Search: ${filters.q}`, () => { setSearchDraft(''); clearAdvancedFilter('q'); }, 'q')}
                {filters.stage && chip(`Stage: ${statusLabel(filters.stage)}`, () => clearAdvancedFilter('stage'), 'stage')}
                {filters.clientId && chip(`Client: ${data?.filterOptions.clients.find((item) => item.id === filters.clientId)?.label || filters.clientId}`, () => clearAdvancedFilter('clientId'), 'client')}
                {filters.locationCode && chip(`Location: ${data?.filterOptions.locations.find((item) => item.id === filters.locationCode)?.label || filters.locationCode}`, () => clearAdvancedFilter('locationCode'), 'location')}
                {filters.installerId && chip(`Installer: ${data?.filterOptions.installers.find((item) => item.id === filters.installerId)?.label || 'Selected'}`, () => clearAdvancedFilter('installerId'), 'installer')}
                {filters.paymentStatus && chip(`Payment: ${filterLabel(data?.filterOptions.paymentStates, filters.paymentStatus)}`, () => clearAdvancedFilter('paymentStatus'), 'payment')}
                {filters.assignment && chip(`Assignment: ${filterLabel(data?.filterOptions.assignmentStates, filters.assignment)}`, () => clearAdvancedFilter('assignment'), 'assignment')}
                {filters.glassStatus && chip(`Glass: ${filterLabel(data?.filterOptions.glassStates, filters.glassStatus)}`, () => clearAdvancedFilter('glassStatus'), 'glass')}
                {filters.compare && chip('Compare previous period', () => clearAdvancedFilter('compare'), 'compare')}
              </div>
              }
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
            {isWidgetVisible('kpis') && <DashboardWidgetBoundary name="Key performance indicators" onRetry={refresh}>
              {loading && !data ? <div className="dashboard-kpi-grid" aria-label="Loading key figures">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-[112px] animate-pulse rounded-[20px] border border-border bg-card/80" />)}</div> : permissions && <section className="dashboard-kpi-grid" aria-label="Key performance indicators" data-dashboard-widget="kpis">
                {permissions.orders && <MetricCard label="Orders" value={data?.summary.activeOrders} format={formatNumber} note="Created in selected period" icon={Layers3} tint="#3B82F6" spark={orderSpark} comparison={formatCompare(data?.summary.activeOrders, previous?.activeOrders)} onClick={() => setFilter('stage', undefined)} />}
                {permissions.finance && <MetricCard label="Order value" value={data?.summary.orderValue} format={compactCurrency} note="Recorded order value · not collected revenue" icon={CircleDollarSign} tint="#14B8A6" spark={valueSpark} comparison={formatCompare(data?.summary.orderValue, previous?.orderValue)} onClick={() => setLocation(makeDashboardHref('/payments', filters))} />}
                {permissions.readiness && <MetricCard label="Windows ready" value={data?.summary.readyWindows} format={(value) => `${formatNumber(value)} / ${formatNumber(data?.summary.totalWindows)}`} note={data?.summary.readyWindowPercent == null ? 'No window totals in this range' : `${data.summary.readyWindowPercent}% of matching windows`} icon={Gauge} tint="#10B981" spark={readinessSpark} comparison={filters.compare ? `${formatNumber(previous?.readyWindows)} / ${formatNumber(previous?.totalWindows)} previously` : undefined} />}
                {permissions.finance && <MetricCard label="Outstanding balance" value={data?.summary.outstandingBalance} format={compactCurrency} note="Known balance · not an overdue total" icon={CircleDollarSign} tint="#EF4444" spark={balanceSpark} comparison={formatCompare(data?.summary.outstandingBalance, previous?.outstandingBalance)} onClick={() => setLocation('/balance-payment')} />}
                {permissions.orders && permissions.installation && <MetricCard label="Installed orders" value={data?.summary.installedOrders} format={formatNumber} note="Installed in matching orders" icon={PackageCheck} tint="#8B5CF6" spark={installedSpark} comparison={formatCompare(data?.summary.installedOrders, previous?.installedOrders)} onClick={() => setLocation('/installation')} />}
              </section>}
            </DashboardWidgetBoundary>}

            {(permissions?.orders || permissions?.finance) && (isWidgetVisible('trend') || (permissions?.orders && isWidgetVisible('stage-mix'))) && <div className="dashboard-chart-row grid min-w-0 grid-cols-12 gap-4">
              {(isWidgetVisible('trend')) && <DashboardWidgetBoundary name="Order and value trend" widgetId="trend" onRetry={refresh}>
                <section className="dashboard-card min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5" data-dashboard-widget="trend" style={{ order: widgetOrder('trend') }}>
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
                    <div ref={trendChartRef} className="h-[210px] min-w-0 w-full" role="img" aria-label="Order count and recorded order value for the selected date range">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={trend} margin={{ top: 8, right: 2, left: -16, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 5" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="label" interval="preserveStartEnd" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                          {permissions?.orders && <YAxis yAxisId="orders" domain={[0, 'auto']} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} allowDecimals={false} width={36} />}
                          {hasOrderValue && <YAxis yAxisId="value" orientation="right" domain={[0, 'auto']} tickFormatter={(value) => compactCurrency(Number(value))} tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={56} />}
                          <Tooltip cursor={{ fill: 'hsl(var(--primary) / .06)', stroke: 'none' }} contentStyle={{ borderRadius: 12, borderColor: 'hsl(var(--border))', backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--foreground))', fontSize: 11 }} formatter={(value, name) => [name === 'Order value' ? compactCurrency(Number(value)) : formatNumber(Number(value)), name]} />
                          {hasOrderValue && <Area yAxisId="value" type="monotone" dataKey="orderValue" name="Order value" stroke="#14B8A6" strokeWidth={2.5} fill="#14B8A6" fillOpacity={0.13} connectNulls isAnimationActive={false} />}
                          {permissions?.orders && <Line yAxisId="orders" type="monotone" dataKey="orderCount" name="Orders" stroke="#3B82F6" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 border-t border-border/70 pt-3 text-[10px] text-muted-foreground">
                      {permissions?.orders && <span className="inline-flex items-center gap-2"><i className="h-0.5 w-4 rounded bg-[#3B82F6]" />Orders</span>}
                      {hasOrderValue ? <span className="inline-flex items-center gap-2"><i className="h-0.5 w-4 rounded bg-[#14B8A6]" />Order value (INR)</span> : permissions?.finance && <span>Order value appears once rates are approved.</span>}
                      <span className="ml-auto">Clicking the range above also updates all dashboard sections.</span>
                    </div>
                  </> : <SectionState loading={false} error={null} empty retry={refresh} emptyTitle="No trend data for this range" />}
                </section>
              </DashboardWidgetBoundary>}

              {permissions?.orders && isWidgetVisible('stage-mix') && <DashboardWidgetBoundary name="Order-stage distribution" widgetId="stage-mix" onRetry={refresh}>
                <section className="dashboard-card min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5" data-dashboard-widget="stage-mix" style={{ order: widgetOrder('stage-mix') }}>
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[.16em] text-primary">Live pipeline</p>
                      <h2 className="mt-1 text-base font-semibold">Orders by stage</h2>
                      <p className="mt-1 text-[10px] text-muted-foreground">Select a segment or stage to filter the dashboard.</p>
                    </div>
                    <ExportMenu title="Stage distribution" onCsv={() => downloadCsv('operations-stage-distribution.csv', stageCsv)} onPng={() => exportChartPng(stageChartRef.current, 'operations-stage-distribution.png')} />
                  </div>
                  {loading || errorFor('orders') ? <SectionState loading={loading} error={errorFor('orders')} empty={false} retry={refresh} /> : donutData.length ? <>
                    <div className="relative mx-auto h-[210px] max-w-[240px]" ref={stageChartRef} role="img" aria-label="Donut chart of matching orders by actual order stage">
                      <ResponsiveContainer width="100%" height="100%"><PieChart>
                        <Tooltip contentStyle={{ borderRadius: 12, borderColor: 'hsl(var(--border))', backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--foreground))', fontSize: 11 }} formatter={(value) => [formatNumber(Number(value)), 'Orders']} />
                        <Pie data={donutData} dataKey="count" nameKey="label" innerRadius={55} outerRadius={77} paddingAngle={2} stroke="none" isAnimationActive={false} onClick={(entry) => setFilter('stage', entry.status as Filters['stage'])}>
                          {donutData.map((entry) => <Cell key={entry.status} fill={stageColor(entry.status, data?.pipeline)} className="cursor-pointer" />)}
                        </Pie>
                      </PieChart></ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Orders</span>
                        <span className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(stageTotal)}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 border-t border-border/70 pt-3">
                      {data?.pipeline.map((stage) => <button key={stage.status} type="button" onClick={() => setFilter('stage', filters.stage === stage.status ? undefined : stage.status)} className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted ${filters.stage === stage.status ? 'bg-primary/[.08]' : ''}`} data-testid={`button-donut-legend-${stage.status}`}>
                        <i className="size-2 shrink-0 rounded-full" style={{ backgroundColor: stageColor(stage.status, data?.pipeline) }} />
                        <span className="min-w-0 flex-1 truncate text-[9px] text-muted-foreground">{stage.label}</span>
                        <span className="font-mono text-[10px] font-semibold">{formatNumber(stage.count)}</span>
                      </button>)}
                    </div>
                  </> : <SectionState loading={false} error={null} empty retry={refresh} emptyTitle="No orders in this range" />}
                </section>
              </DashboardWidgetBoundary>}
            </div>}

            {permissions?.orders && isWidgetVisible('pipeline') && <DashboardWidgetBoundary name="Order pipeline" onRetry={refresh}>
              <section className="dashboard-card rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5" data-dashboard-widget="pipeline">
                <SectionHeading eyebrow="Order pipeline" title="Move work through each stage" icon={Factory} action={<span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{loading ? '—' : `${formatNumber(stageTotal)} orders`}</span>} />
                {loading || errorFor('orders') ? <SectionState loading={loading} error={errorFor('orders')} empty={false} retry={refresh} /> : data?.pipeline.length ? <div className="dashboard-pipeline-grid">
                  {data.pipeline.map((stage) => {
                    const share = stageTotal ? (stage.count / stageTotal) * 100 : 0;
                    const selected = filters.stage === stage.status;
                    return <button key={stage.status} type="button" onClick={() => setFilter('stage', selected ? undefined : stage.status)} className={`min-w-0 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${selected ? 'border-primary/40 bg-primary/[.07]' : 'border-border/75 bg-background hover:border-primary/30'}`} data-testid={`button-pipeline-${stage.status}`}>
                      <div className="flex items-center justify-between gap-2"><span className="h-1.5 w-9 rounded-full" style={{ backgroundColor: stageColor(stage.status, data?.pipeline) }} /><span className="text-[9px] font-semibold text-muted-foreground">{share.toFixed(0)}%</span></div>
                      <p className="mt-3 truncate text-[9px] font-bold uppercase tracking-[.1em] text-muted-foreground">{stage.label}</p>
                      <div className="mt-1 flex items-end justify-between gap-2"><span className="text-2xl font-semibold tabular-nums">{formatNumber(stage.count)}</span>{permissions?.finance && <span className="truncate text-[9px] text-muted-foreground">{compactCurrency(stage.orderValue)}</span>}</div>
                      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, share)}%`, backgroundColor: stageColor(stage.status, data?.pipeline) }} /></div>
                    </button>;
                  })}
                </div> : <SectionState loading={false} error={null} empty retry={refresh} />}
              </section>
            </DashboardWidgetBoundary>}

            {(canViewAnyDashboard) && <div className="dashboard-operations-row grid min-w-0 grid-cols-12 gap-4">
              {isWidgetVisible('attention') && <DashboardWidgetBoundary name="Needs attention" widgetId="attention" onRetry={refresh}>
                <section className="dashboard-card h-full min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5" data-dashboard-widget="attention" style={{ order: widgetOrder('attention') }}>
                  <SectionHeading eyebrow="Priority work" title="Needs attention" icon={AlertCircle} action={<span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${activeAttention.some((item) => item.count > 0 && item.severity !== 'success') ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`}>{activeAttention.filter((item) => item.count > 0 && item.severity !== 'success').length} active</span>} />
                  {loading || attentionError ? <SectionState loading={loading} error={attentionError} empty={false} retry={refresh} /> : visibleAttention.length ? <div className="space-y-2">
                    {visibleAttention.map((item) => {
                      const row = <span className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-border/75 bg-background p-3 text-left transition hover:border-primary/30 hover:bg-primary/[.025]">
                        <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${item.severity === 'critical' ? 'bg-red-500/10 text-red-600 dark:text-red-300' : item.severity === 'warning' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-300' : 'bg-blue-500/10 text-blue-600 dark:text-blue-300'}`}><AlertCircle size={15} /></span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{item.title}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{item.description}</span></span>
                        <span className="shrink-0 text-right"><span className="block font-mono text-sm font-semibold">{formatNumber(item.count)}</span>{permissions?.finance && item.amount != null && <span className="text-[9px] text-muted-foreground">{compactCurrency(item.amount)}</span>}</span>
                        <ArrowUpRight size={13} className="shrink-0 text-muted-foreground" />
                      </span>;
                      return <div key={item.id} className="flex items-center gap-2">
                        <button type="button" onClick={() => setLocation(makeDashboardHref(item.href, filters))} className="min-w-0 flex-1 text-left" data-testid={`button-attention-${item.id}`}>{row}</button>
                        {item.id === 'outstanding-payments' && reminders[0] && <form method="post" action={`/api/orders/${encodeURIComponent(reminders[0].orderRecordId)}/payment-reminder`} target="_blank" rel="noreferrer" className="shrink-0">
                          <button type="submit" disabled={!reminders[0].canOpenWhatsApp} aria-label={`Open WhatsApp reminder draft for ${reminders[0].orderId}`} title="Open a manual WhatsApp reminder draft for staff review" className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-40" data-testid={`button-dashboard-reminder-${reminders[0].orderRecordId}`}><Activity size={14} /></button>
                        </form>}
                      </div>;
                    })}
                  </div> : <p className="flex items-center gap-3 rounded-xl border border-emerald-500/15 bg-emerald-500/[.04] px-3 py-4 text-xs text-muted-foreground"><span className="grid size-8 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><Check size={16} /></span>All clear — no active follow-up items match these filters.</p>}
                </section>
              </DashboardWidgetBoundary>}

              {permissions?.orders && isWidgetVisible('activity') && <DashboardWidgetBoundary name="Live activity" widgetId="activity" onRetry={refresh}>
                <section className="dashboard-card h-full min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5" data-dashboard-widget="activity" style={{ order: widgetOrder('activity') }}>
                  <SectionHeading eyebrow="Live activity" title="Latest changes" icon={Activity} action={<span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[.07] px-2.5 py-1 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300"><i className={`size-1.5 rounded-full ${refreshSeconds ? 'animate-pulse bg-emerald-500' : 'bg-amber-500'}`} />{refreshSeconds ? 'Live' : 'Paused'}</span>} />
                  {loading || errorFor('activity') ? <SectionState loading={loading} error={errorFor('activity')} empty={false} retry={refresh} /> : activity.length ? <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
                    {activity.slice(0, 12).map((item) => <Link key={item.id} href={item.dispatchRecordId ? `/dispatch?record=${encodeURIComponent(item.dispatchRecordId)}` : makeDashboardHref(`/order-hub/${encodeURIComponent(item.orderRecordId)}`, filters)} className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-primary/[.04]" data-testid={`button-activity-${item.id}`}>
                      <ActionIcon action={item.action} />
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{item.dispatchCode ? dispatchActivityTitle(item.action, item.summary, item.dispatchCode) : item.summary}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{item.actorName} · {item.clientName} · {item.orderId}</span></span>
                      <time className="shrink-0 text-[9px] text-muted-foreground" dateTime={new Date(item.createdAt).toISOString()}>{relativeTime(item.createdAt)}</time>
                    </Link>)}
                  </div> : <SectionState loading={false} error={null} empty retry={refresh} emptyTitle="No activity in this period" />}
                </section>
              </DashboardWidgetBoundary>}

            </div>}

            {((permissions?.orders && isWidgetVisible('recent-orders')) || (permissions?.installation && isWidgetVisible('capacity'))) && <div className="dashboard-field-row grid min-w-0 grid-cols-12 gap-4">
              {permissions?.orders && isWidgetVisible('recent-orders') && <DashboardWidgetBoundary name="Recent orders" widgetId="recent-orders" onRetry={refresh}>
                <section className="dashboard-card min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5" data-dashboard-widget="recent-orders" style={{ order: widgetOrder('recent-orders') }}>
                  <SectionHeading eyebrow="Order register" title="Recent orders" icon={Layers3} action={<Link href={ordersHref} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-primary hover:bg-primary/[.06]" data-testid="link-dashboard-all-orders">View all <ArrowUpRight size={13} /></Link>} />
                  {loading || errorFor('orders') ? <SectionState loading={loading} error={errorFor('orders')} empty={false} retry={refresh} /> : recentOrders.length ? <>
                    <div className="space-y-2 xl:hidden">
                      {recentOrders.slice(0, 8).map((order) => <button type="button" key={order.id} onClick={() => setLocation(makeDashboardHref(`/order-hub/${encodeURIComponent(order.id)}`, filters))} className={`w-full min-w-0 rounded-xl border border-border/70 bg-background p-3 text-left transition hover:border-primary/30 ${flashedRows.includes(order.id) ? 'dashboard-row-flash' : ''}`} data-testid={`card-dashboard-order-${order.id}`}>
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{initials(order.clientName)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[11px] font-bold text-primary">{order.orderId}</span><StatusPill status={order.status} label={statusLabel(order.status)} color={stageColor(order.status, data?.pipeline)} /></span>
                            <span className="mt-1 block truncate text-xs font-semibold">{order.clientName}</span>
                            <span className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground"><MapPin size={10} />{order.locationName}</span>
                            <span className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                              <span>Windows {formatNumber(order.readyWindows)}/{formatNumber(order.totalWindows)}</span>
                              {permissions.finance && <span className={`font-mono font-semibold ${order.orderValue == null ? 'text-muted-foreground' : 'text-foreground'}`}>{order.orderValue == null ? 'Rate pending' : compactCurrency(order.orderValue)}</span>}
                              <span>{dateLabel(order.createdAt)}</span>
                            </span>
                          </span>
                        </div>
                      </button>)}
                    </div>
                    <div className="hidden xl:block">
                      <table className="w-full table-fixed text-left">
                        <thead><tr className="border-b border-border text-[9px] font-bold uppercase tracking-[.12em] text-muted-foreground"><th className="w-[34%] pb-2 pr-2">Order / client</th><th className="w-[22%] pb-2 pr-2">Stage</th><th className="w-[14%] pb-2 pr-2">Windows</th><th className="w-[18%] pb-2 pr-2">Fulfillment</th>{permissions.finance && <th className="w-[12%] pb-2 text-right">Value</th>}</tr></thead>
                        <tbody className="divide-y divide-border/60">
                          {recentOrders.slice(0, 8).map((order) => <tr key={order.id} tabIndex={0} onClick={() => setLocation(makeDashboardHref(`/order-hub/${encodeURIComponent(order.id)}`, filters))} onKeyDown={(event) => { if (event.key === 'Enter') setLocation(makeDashboardHref(`/order-hub/${encodeURIComponent(order.id)}`, filters)); }} className={`cursor-pointer transition hover:bg-primary/[.025] ${flashedRows.includes(order.id) ? 'dashboard-row-flash' : ''}`} data-testid={`row-dashboard-order-${order.id}`}>
                            <td className="py-3 pr-2"><div className="flex min-w-0 items-center gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">{initials(order.clientName)}</span><span className="min-w-0"><span className="block truncate font-mono text-[10px] font-semibold text-primary">{order.orderId}</span><span className="mt-0.5 block truncate text-xs font-medium">{order.clientName}</span><span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{order.locationName} · {dateLabel(order.createdAt)}</span></span></div></td>
                            <td className="py-3 pr-2"><StatusPill status={order.status} label={statusLabel(order.status)} color={stageColor(order.status, data?.pipeline)} /></td>
                            <td className="py-3 pr-2"><span className="font-mono text-[10px]">{formatNumber(order.readyWindows)}<span className="text-muted-foreground"> / {formatNumber(order.totalWindows)}</span></span><div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${order.totalWindows ? Math.min(100, (order.readyWindows / order.totalWindows) * 100) : 0}%` }} /></div></td>
                            <td className="py-3 pr-2"><span className="block truncate text-[9px] capitalize text-muted-foreground">{order.dispatchStatus?.replaceAll('_', ' ') ?? 'Dispatch —'}</span><span className="mt-1 block truncate text-[9px] capitalize">{order.installationStatus ?? 'Installation —'}</span></td>
                            {permissions.finance && <td className="py-3 text-right font-mono text-[10px]">{order.orderValue == null ? <span className="font-sans text-[9px] text-muted-foreground">Rate pending</span> : compactCurrency(order.orderValue)}</td>}
                          </tr>)}
                        </tbody>
                      </table>
                    </div>
                  </> : <SectionState loading={false} error={null} empty retry={refresh} emptyTitle="No recent orders" />}
                </section>
              </DashboardWidgetBoundary>}
              {permissions?.installation && isWidgetVisible('capacity') && <DashboardWidgetBoundary name="Installer capacity" widgetId="capacity" onRetry={refresh}>
                <section className="dashboard-card h-full min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5" data-dashboard-widget="capacity" style={{ order: widgetOrder('capacity') }}>
                  <SectionHeading eyebrow="Field team" title="Installer capacity" icon={Wrench} action={<Link href={makeDashboardHref('/installation', filters)} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-primary hover:bg-primary/[.06]" data-testid="link-dashboard-installation">Installation <ArrowUpRight size={13} /></Link>} />
                  <p className="-mt-2 mb-3 text-[10px] text-muted-foreground">Peak scheduled orders per day in the selected range · sorted by load.</p>
                  {loading || errorFor('installation') ? <SectionState loading={loading} error={errorFor('installation')} empty={false} retry={refresh} /> : data?.installerCapacity.length ? <div className="space-y-1.5">
                    {data.installerCapacity.slice(0, 6).map((installer) => {
                      const ratio = installer.capacity > 0 ? installer.assigned / installer.capacity : 0;
                      const color = ratio >= 1 ? '#EF4444' : ratio >= 0.8 ? '#F97316' : '#14B8A6';
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

            {((permissions?.dispatch && isWidgetVisible('dispatch')) || (permissions?.orders && isWidgetVisible('top-clients'))) && <div className="dashboard-dispatch-row grid min-w-0 grid-cols-12 gap-4">
              {permissions?.dispatch && isWidgetVisible('dispatch') && <DashboardWidgetBoundary name="Dispatch queue" widgetId="dispatch" onRetry={refresh}>
                <CompactPanel dataWidgetId="dispatch" style={{ order: widgetOrder('dispatch') }} title="Dispatch queue" eyebrow="Lot handoffs" icon={Truck} count={formatNumber(readyDispatchLots.length + dispatchStatusCount('planned') + dispatchStatusCount('dispatched'))} href="/dispatch" hrefLabel="Open dispatch register">
                  {dispatchRecordQuery.isLoading || dispatchSummaryQuery.isLoading ? <SectionState loading empty={false} retry={() => { void dispatchRecordQuery.refetch(); void dispatchSummaryQuery.refetch(); }} /> : dispatchRecordQuery.isError || dispatchSummaryQuery.isError ? <SectionState loading={false} error="Dispatch records or ready lots could not be loaded." empty={false} retry={() => { void dispatchRecordQuery.refetch(); void dispatchSummaryQuery.refetch(); }} /> : <div className="space-y-2">
                    <div className="grid grid-cols-4 gap-1.5" aria-label="Dispatch pipeline" data-testid="dashboard-dispatch-pipeline">
                      {([{ status: 'planned', label: 'Planned' }, { status: 'dispatched', label: 'In transit' }, { status: 'delivered', label: 'Delivered' }, { status: 'returned', label: 'Returned' }] as const).map(({ status, label }) => <div key={status} className="min-w-0 rounded-lg bg-muted/50 px-2 py-1.5 text-center"><span className="block truncate text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span><span className="font-mono text-xs font-bold">{formatNumber(dispatchStatusCount(status))}</span></div>)}
                    </div>
                    {dispatchRecords.filter((record) => record.status === 'planned' || record.status === 'dispatched').slice(0, 3).map((record) => <button type="button" key={record.id} onClick={() => setLocation(`/dispatch?record=${encodeURIComponent(record.id)}`)} className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-primary/[.04]" data-testid={`button-dispatch-record-${record.id}`}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Truck size={14} /></span><span className="min-w-0 flex-1"><span className="block truncate font-mono text-[10px] font-semibold text-primary">{record.dispatchCode}</span><span className="mt-0.5 block truncate text-[10px]">{record.clientName} · {record.lotId} · {record.locationName}</span></span><span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold capitalize ${record.status === 'dispatched' ? 'bg-sky-500/10 text-sky-800 dark:text-sky-300' : 'bg-amber-500/10 text-amber-800 dark:text-amber-300'}`}>{record.status === 'dispatched' ? 'In transit' : record.status}</span></button>)}
                    {readyDispatchLots.slice(0, 3).map((lot) => <button type="button" key={lot.lotRecordId} onClick={() => setLocation(`/dispatch?create=1&orderRecordId=${encodeURIComponent(lot.orderRecordId)}&lotRecordId=${encodeURIComponent(lot.lotRecordId)}`)} className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-dashed border-emerald-500/30 bg-emerald-500/[.035] px-2 py-2 text-left transition hover:bg-emerald-500/[.07]" data-testid={`button-ready-dispatch-lot-${lot.lotRecordId}`}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><PackageCheck size={14} /></span><span className="min-w-0 flex-1"><span className="block truncate font-mono text-[10px] font-semibold text-primary">{lot.orderId} · {lot.lotId}</span><span className="mt-0.5 block truncate text-[10px]">{lot.clientName} · {lot.locationName}</span></span><span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-1 text-[9px] font-semibold text-emerald-800 dark:text-emerald-300">Create</span></button>)}
                    {!dispatchRecords.length && !readyDispatchLots.length && <SectionState loading={false} error={null} empty retry={() => { void dispatchRecordQuery.refetch(); void dispatchSummaryQuery.refetch(); }} emptyTitle="No dispatches in this queue" emptyDetail="Ready lots and planned or in-transit handoffs will appear here." />}
                  </div>}
                </CompactPanel>
              </DashboardWidgetBoundary>}
              {permissions?.orders && isWidgetVisible('top-clients') && <DashboardWidgetBoundary name="Top clients" widgetId="top-clients" onRetry={refresh}>
                <CompactPanel dataWidgetId="top-clients" style={{ order: widgetOrder('top-clients') }} title="Top clients" eyebrow="Relationships" icon={Users} count={formatNumber(data?.topClients.length)} href={ordersHref} hrefLabel="Open orders">
                  {loading || errorFor('orders') ? <SectionState loading={loading} error={errorFor('orders')} empty={false} retry={refresh} /> : data?.topClients.length ? <div className="space-y-0.5">{data.topClients.slice(0, 4).map((client, index) => <button type="button" key={client.clientId} onClick={() => setFilter('clientId', client.clientId)} className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-primary/[.04]" data-testid={`button-top-client-${client.clientId}`}><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-secondary font-mono text-[9px] font-bold text-secondary-foreground">{String(index + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1 truncate text-[10px] font-semibold">{client.clientName}</span><span className="shrink-0 text-right"><span className="block font-mono text-[10px] font-semibold">{formatNumber(client.orderCount)} orders</span>{permissions.finance && <span className="text-[9px] text-muted-foreground">{compactCurrency(client.orderValue)}</span>}</span></button>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} emptyTitle="No top clients in view" emptyDetail="Clients with orders in this range will appear here." />}
                </CompactPanel>
              </DashboardWidgetBoundary>}
            </div>}

            {secondaryHasData || secondaryHasError ? <section className="dashboard-secondary-grid grid min-w-0 gap-4" aria-label="Additional operational activity">
              {isWidgetVisible('payments') && permissions?.finance && (((data?.summary.outstandingBalance ?? 0) > 0) || (data?.reminderCandidates.length ?? 0) > 0 || errorFor('finance')) && <DashboardWidgetBoundary name="Payment follow-through" onRetry={refresh}>
                <CompactPanel dataWidgetId="payments" style={{ order: widgetOrder('payments') }} title="Payment follow-through" eyebrow="Accounts" icon={CircleDollarSign} count={compactCurrency(data?.summary.outstandingBalance)} href={makeDashboardHref('/payments', filters)} hrefLabel="Open payments">
                  {loading || errorFor('finance') || errorFor('orders') ? <SectionState loading={loading} error={errorFor('finance') || errorFor('orders')} empty={false} retry={refresh} /> : reminders.length ? <div className="space-y-1.5">
                    {reminders.slice(0, 4).map((candidate) => <div key={candidate.orderRecordId} className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-2">
                      <button type="button" onClick={() => { setFilter('paymentStatus', 'unpaid'); setFilter('q', candidate.orderId); setSearchDraft(candidate.orderId); }} className="min-w-0 flex-1 text-left" data-testid={`button-reminder-candidate-${candidate.orderRecordId}`}><span className="block truncate font-mono text-[10px] font-semibold text-primary">{candidate.orderId} · {candidate.clientName}</span><span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{candidate.locationName} · open balance</span></button>
                      <span className="shrink-0 text-right font-mono text-[10px] font-semibold">{compactCurrency(candidate.balance)}</span>
                      <form method="post" action={`/api/orders/${encodeURIComponent(candidate.orderRecordId)}/payment-reminder`} target="_blank" rel="noreferrer"><button type="submit" disabled={!candidate.canOpenWhatsApp} title="Open a manual WhatsApp reminder draft for staff review" aria-label={`Draft reminder for ${candidate.orderId}`} className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition hover:border-primary/30 hover:text-primary disabled:opacity-40"><Activity size={13} /></button></form>
                    </div>)}
                  </div> : <p className="rounded-xl border border-border/60 bg-background p-3 text-[10px] text-muted-foreground">Outstanding balance is present, but no orders currently meet the reminder criteria.</p>}
                </CompactPanel>
              </DashboardWidgetBoundary>}

              {isWidgetVisible('installation') && permissions?.installation && ((data?.installationSchedule.length ?? 0) > 0 || errorFor('installation')) && <DashboardWidgetBoundary name="Installation schedule" onRetry={refresh}>
                <CompactPanel dataWidgetId="installation" style={{ order: widgetOrder('installation') }} title="Installation schedule" eyebrow="Field work" icon={Wrench} count={formatNumber(data?.installationSchedule.length)} href={makeDashboardHref('/installation', filters)} hrefLabel="Open installations">
                  {loading || errorFor('installation') ? <SectionState loading={loading} error={errorFor('installation')} empty={false} retry={refresh} /> : data?.installationSchedule.length ? <div className="space-y-1">{data.installationSchedule.slice(0, 4).map((item) => <button type="button" key={item.orderRecordId} onClick={() => setLocation(makeDashboardHref('/installation', filters))} className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-primary/[.04]" data-testid={`button-installation-schedule-${item.orderRecordId}`}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><CalendarDays size={14} /></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="font-mono text-[10px] font-semibold text-primary">{item.orderId}</span><span className="shrink-0 text-[9px] text-muted-foreground">{dateLabel(item.scheduledDate)}</span></span><span className="mt-0.5 block truncate text-[10px] font-medium">{item.clientName} · {item.locationName}</span><span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{item.teamName || 'Team pending'}{item.subteamName ? ` · ${item.subteamName}` : ''}{item.assignedMembers.length ? ` · ${item.assignedMembers.join(', ')}` : ''}</span></span></button>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} />}
                </CompactPanel>
              </DashboardWidgetBoundary>}

              {isWidgetVisible('approvals') && permissions?.approvals && (approvalItems.length > 0 || errorFor('approvals')) && <DashboardWidgetBoundary name="Quotation approvals" onRetry={refresh}>
                <CompactPanel dataWidgetId="approvals" style={{ order: widgetOrder('approvals') }} title="Quotation approvals" eyebrow="Quotation desk" icon={BadgeCheck} count={formatNumber(approvalItems.reduce((total, item) => total + item.count, 0))} href={makeDashboardHref(approvalItems[0]?.href || '/quotation-builder', filters)} hrefLabel="Open approvals">
                  {loading || errorFor('approvals') ? <SectionState loading={loading} error={errorFor('approvals')} empty={false} retry={refresh} /> : <div className="space-y-1">{approvalItems.slice(0, 4).map((item) => <button type="button" key={item.id} onClick={() => setLocation(makeDashboardHref(item.href, filters))} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-primary/[.04]" data-testid={`button-approval-followup-${item.id}`}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300"><BadgeCheck size={14} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-semibold">{item.title}</span><span className="block truncate text-[9px] text-muted-foreground">{item.description}</span></span><span className="font-mono text-[10px] font-semibold">{formatNumber(item.count)}</span></button>)}</div>}
                </CompactPanel>
              </DashboardWidgetBoundary>}

              {isWidgetVisible('glass') && permissions?.glass && (glassItems.length > 0 || errorFor('glass')) && <DashboardWidgetBoundary name="Glass status" onRetry={refresh}>
                <CompactPanel dataWidgetId="glass" style={{ order: widgetOrder('glass') }} title="Glass status" eyebrow="Procurement" icon={Layers3} count={formatNumber(glassItems.reduce((total, item) => total + item.count, 0))} href={makeDashboardHref(glassItems[0]?.href || '/glass-procurement', filters)} hrefLabel="Open glass tracking">
                  {loading || errorFor('glass') ? <SectionState loading={loading} error={errorFor('glass')} empty={false} retry={refresh} /> : <div className="space-y-1">{glassItems.slice(0, 4).map((item) => <button type="button" key={item.id} onClick={() => setLocation(makeDashboardHref(item.href, filters))} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-primary/[.04]" data-testid={`button-glass-followup-${item.id}`}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300"><Layers3 size={14} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-semibold">{item.title}</span><span className="block truncate text-[9px] text-muted-foreground">{item.description}</span></span><span className="font-mono text-[10px] font-semibold">{formatNumber(item.count)}</span></button>)}</div>}
                </CompactPanel>
              </DashboardWidgetBoundary>}

              {isWidgetVisible('measurements') && permissions?.measurements && ((data?.recentMeasurements.length ?? 0) > 0 || errorFor('measurements')) && <DashboardWidgetBoundary name="Measurement uploads" onRetry={refresh}>
                <CompactPanel dataWidgetId="measurements" style={{ order: widgetOrder('measurements') }} title="Measurement uploads" eyebrow="Production intake" icon={FileSpreadsheet} count={formatNumber(data?.recentMeasurements.length)} href={makeDashboardHref('/measurements', filters)} hrefLabel="Open measurements">
                  {loading || errorFor('measurements') ? <SectionState loading={loading} error={errorFor('measurements')} empty={false} retry={refresh} /> : data?.recentMeasurements.length ? <div className="space-y-1">{data.recentMeasurements.slice(0, 4).map((upload) => <button type="button" key={upload.id} onClick={() => setLocation('/measurements')} className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-primary/[.04]" data-testid={`button-measurement-upload-${upload.id}`}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><FileSpreadsheet size={14} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-semibold">{upload.filename}</span><span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{upload.clientName}{upload.location ? ` · ${upload.location}` : ''}</span></span><time className="shrink-0 text-[9px] text-muted-foreground">{relativeTime(upload.uploadedAt)}</time></button>)}</div> : <SectionState loading={false} error={null} empty retry={refresh} />}
                </CompactPanel>
              </DashboardWidgetBoundary>}
            </section> : !loading && data && <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-4 text-center text-xs text-muted-foreground">Nothing else needs follow-up right now.</div>}
          </>}

          {!loading && data && !canViewAnyDashboard && <div className="rounded-[20px] border border-dashed border-border bg-card p-10 text-center">
            <span className="mx-auto grid size-11 place-items-center rounded-xl bg-secondary text-secondary-foreground"><Filter size={18} /></span>
            <h2 className="mt-3 text-lg font-semibold">No dashboard sections assigned</h2>
            <p className="mt-1 text-sm text-muted-foreground">Ask a workspace administrator to review your operational access.</p>
          </div>}

          <footer className="col-span-12 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-1 pt-3 text-[10px] text-muted-foreground">
            <span>Live operational view · Values and records reflect the filters above</span>
            <span className="inline-flex items-center gap-1.5"><Clock3 size={11} />{updatedAt ? `Updated ${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(updatedAt))} · Snapshot ${dateLabel(new Date(updatedAt))}` : 'No snapshot yet'}</span>
          </footer>
        </div>
      </div>
    </AppShell>
  );
}

function CompactPanel({ children, title, eyebrow, icon: Icon, count, href, hrefLabel, dataWidgetId, style }: {
  children: React.ReactNode;
  title: string;
  eyebrow: string;
  icon: LucideIcon;
  count: string;
  href: string;
  hrefLabel: string;
  dataWidgetId?: string;
  style?: React.CSSProperties;
}) {
  return <section className="dashboard-card min-w-0 rounded-[20px] border border-border/80 bg-card p-4 shadow-sm md:p-5" data-dashboard-widget={dataWidgetId} style={style}>
    <SectionHeading eyebrow={eyebrow} title={title} icon={Icon} action={<span className="shrink-0 rounded-full border border-border bg-background px-2 py-1 font-mono text-[9px] text-muted-foreground">{count}</span>} />
    {children}
    <Link href={href} className="mt-2 flex items-center justify-between border-t border-border/70 pt-2.5 text-[10px] font-semibold text-primary hover:underline">{hrefLabel}<ArrowUpRight size={12} /></Link>
  </section>;
}
