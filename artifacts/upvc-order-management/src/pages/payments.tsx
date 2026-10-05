import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowDownLeft,
  ArrowRight,
  BadgeIndianRupee,
  Banknote,
  Building2,
  CalendarDays,
  CalendarClock,
  Check,
  CircleAlert,
  Clock3,
  CreditCard,
  Flag,
  Grid2X2,
  List,
  MapPin,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {
  getGetPaymentOverviewQueryKey,
  getListPaymentFlagsQueryKey,
  useGetPaymentOverview,
  useListPaymentFlags,
} from '@workspace/api-client-react';
import type { PaymentFlag, PaymentReminderOrder, RecentPaymentUpdate, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FlaggedPaymentsSection } from '@/components/flagged-payments';
import { PaymentFlagBadge } from '@/components/payment-flag-badge';
import { PaymentProgressBar } from '@/components/payment-progress-bar';
import { PaymentFlagDetails } from '@/components/payment-flag-details';
import { PaymentFlagDialog } from '@/components/payment-flag-dialog';
import { formatInr, formatIstDateTime } from '@/lib/formatters';

type PaymentLayout = 'list' | 'grid';
type ReminderSort = 'oldest' | 'balance' | 'newest' | 'client' | 'order';
type ReminderPaymentFilter = 'all' | 'unpaid' | 'partial';
type ReminderReadinessFilter = 'all' | 'ready' | 'production' | 'phone';
type ReceiptSort = 'entry_newest' | 'entry_oldest' | 'paid_newest' | 'paid_oldest' | 'highest' | 'lowest' | 'client' | 'order';

const controlClass = 'h-9 rounded-lg border border-input bg-background px-3 text-xs text-foreground outline-none transition focus:border-primary';
const dateStart = (value: string) => value ? new Date(`${value}T00:00:00`).getTime() : null;
const dateEnd = (value: string) => value ? new Date(`${value}T23:59:59.999`).getTime() : null;

const lifecycleStatusLabel = (status: string) => ({
  quotation_stage: 'Quotation stage',
  confirmed: 'Confirmed',
  in_production: 'In production',
  ready: 'Ready',
  dispatched: 'Dispatched',
  installed: 'Installed',
}[status] ?? status.replaceAll('_', ' '));

const dateTime = (value: string) => {
  return formatIstDateTime(value);
};

const methodLabel = (method: string) => method.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

function PaymentSkeleton() {
  return <div className="space-y-6 animate-pulse" data-testid="loading-payment-overview">
    <div className="h-32 rounded-2xl bg-muted" />
    <div className="grid gap-4 sm:grid-cols-3">
      {[0, 1, 2].map((item) => <div key={item} className="h-28 rounded-xl bg-muted" />)}
    </div>
    <div className="h-64 rounded-xl bg-muted" />
  </div>;
}

export default function PaymentsPage({ user }: { user: User }) {
  const overview = useGetPaymentOverview({ query: { queryKey: getGetPaymentOverviewQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true } });
  const flagsQuery = useListPaymentFlags({ query: { queryKey: getListPaymentFlagsQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true } });

  const reminderOrders = overview.data?.reminderOrders ?? [];
  const allRecentPayments = overview.data?.recentPayments ?? [];
  const activeFlagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const flag of flagsQuery.data ?? []) {
      if (flag.status === 'active') counts.set(flag.orderRecordId, (counts.get(flag.orderRecordId) ?? 0) + 1);
    }
    return counts;
  }, [flagsQuery.data]);
  const activeFlagByOrder = useMemo(() => {
    const map = new Map<string, PaymentFlag>();
    for (const flag of flagsQuery.data ?? []) {
      if (flag.status === 'active' && !map.has(flag.orderRecordId)) map.set(flag.orderRecordId, flag);
    }
    return map;
  }, [flagsQuery.data]);
  const [selectedFlag, setSelectedFlag] = useState<PaymentFlag | null>(null);
  const canEditFlags = user.roleId === 'master-admin' || user.permissions.payments === 'edit';
  const [reminderSearch, setReminderSearch] = useState('');
  const [reminderLocation, setReminderLocation] = useState('all');
  const [reminderLifecycle, setReminderLifecycle] = useState('all');
  const [reminderPayment, setReminderPayment] = useState<ReminderPaymentFilter>('all');
  const [reminderReadiness, setReminderReadiness] = useState<ReminderReadinessFilter>('all');
  const [reminderSort, setReminderSort] = useState<ReminderSort>('oldest');
  const [reminderLayout, setReminderLayout] = useState<PaymentLayout>('list');
  const [receiptSearch, setReceiptSearch] = useState('');
  const [receiptLocation, setReceiptLocation] = useState('all');
  const [receiptMethod, setReceiptMethod] = useState('all');
  const [receiptRecorder, setReceiptRecorder] = useState('all');
  const [receiptFrom, setReceiptFrom] = useState('');
  const [receiptTo, setReceiptTo] = useState('');
  const [receiptSort, setReceiptSort] = useState<ReceiptSort>('entry_newest');
  const [receiptLayout, setReceiptLayout] = useState<PaymentLayout>('list');

  const reminderLocations = useMemo(
    () => [...new Set(reminderOrders.map((order) => order.locationName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [reminderOrders],
  );
  const reminderLifecycles = useMemo(
    () => [...new Set(reminderOrders.map((order) => order.orderStatus))].sort(),
    [reminderOrders],
  );
  const receiptLocations = useMemo(
    () => [...new Set(allRecentPayments.map((payment) => payment.locationName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [allRecentPayments],
  );
  const receiptMethods = useMemo(
    () => [...new Set(allRecentPayments.map((payment) => payment.method))].sort(),
    [allRecentPayments],
  );
  const receiptRecorders = useMemo(
    () => [...new Set(allRecentPayments.map((payment) => payment.recordedBy).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [allRecentPayments],
  );

  const filteredReminderOrders = useMemo(() => {
    const query = reminderSearch.trim().toLocaleLowerCase();
    return reminderOrders.filter((order) => {
      const matchesSearch = !query || [
        order.orderId,
        order.clientName,
        order.locationName,
        lifecycleStatusLabel(order.orderStatus),
        formatInr(order.balance),
      ].some((value) => value.toLocaleLowerCase().includes(query));
      const matchesPayment = reminderPayment === 'all'
        || (reminderPayment === 'unpaid' ? order.totalCollected <= 0 : order.totalCollected > 0);
      const matchesReadiness = reminderReadiness === 'all'
        || (reminderReadiness === 'ready' && order.canOpenWhatsApp)
        || (reminderReadiness === 'production' && !order.productionReady)
        || (reminderReadiness === 'phone' && order.productionReady && !order.canOpenWhatsApp);
      return matchesSearch
        && (reminderLocation === 'all' || order.locationName === reminderLocation)
        && (reminderLifecycle === 'all' || order.orderStatus === reminderLifecycle)
        && matchesPayment
        && matchesReadiness;
    }).sort((a, b) => {
      const oldestFirst = new Date(a.orderCreatedAt).getTime() - new Date(b.orderCreatedAt).getTime();
      const balanceFirst = b.balance - a.balance;
      if (reminderSort === 'oldest') return oldestFirst || balanceFirst || a.orderId.localeCompare(b.orderId);
      if (reminderSort === 'balance') return balanceFirst || oldestFirst || a.orderId.localeCompare(b.orderId);
      if (reminderSort === 'newest') return -oldestFirst || balanceFirst || a.orderId.localeCompare(b.orderId);
      if (reminderSort === 'client') return a.clientName.localeCompare(b.clientName) || oldestFirst;
      return a.orderId.localeCompare(b.orderId);
    });
  }, [reminderOrders, reminderSearch, reminderLocation, reminderLifecycle, reminderPayment, reminderReadiness, reminderSort]);

  const recentPayments = useMemo(() => {
    const query = receiptSearch.trim().toLocaleLowerCase();
    const from = dateStart(receiptFrom);
    const to = dateEnd(receiptTo);
    return allRecentPayments.filter((payment) => {
      const matchesSearch = !query || [
        payment.orderId,
        payment.clientName,
        payment.locationName,
        methodLabel(payment.method),
        payment.recordedBy,
      ].some((value) => value.toLocaleLowerCase().includes(query));
      const paidAt = new Date(payment.paidAt).getTime();
      return matchesSearch
        && (receiptLocation === 'all' || payment.locationName === receiptLocation)
        && (receiptMethod === 'all' || payment.method === receiptMethod)
        && (receiptRecorder === 'all' || payment.recordedBy === receiptRecorder)
        && (from === null || paidAt >= from)
        && (to === null || paidAt <= to);
    }).sort((a, b) => {
      const entryNewest = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      const paidNewest = new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime();
      if (receiptSort === 'entry_oldest') return -entryNewest;
      if (receiptSort === 'paid_newest') return paidNewest;
      if (receiptSort === 'paid_oldest') return -paidNewest;
      if (receiptSort === 'highest') return b.amount - a.amount || entryNewest;
      if (receiptSort === 'lowest') return a.amount - b.amount || entryNewest;
      if (receiptSort === 'client') return a.clientName.localeCompare(b.clientName);
      if (receiptSort === 'order') return a.orderId.localeCompare(b.orderId);
      return entryNewest;
    });
  }, [allRecentPayments, receiptSearch, receiptLocation, receiptMethod, receiptRecorder, receiptFrom, receiptTo, receiptSort]);

  const clearReminderFilters = () => {
    setReminderSearch('');
    setReminderLocation('all');
    setReminderLifecycle('all');
    setReminderPayment('all');
    setReminderReadiness('all');
  };
  const clearReceiptFilters = () => {
    setReceiptSearch('');
    setReceiptLocation('all');
    setReceiptMethod('all');
    setReceiptRecorder('all');
    setReceiptFrom('');
    setReceiptTo('');
  };

  return <AppShell user={user} title="Payments" eyebrow="Finance workspace">
    <main className="mx-auto w-full max-w-[1440px] space-y-6 pb-10" data-testid="page-payments">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card px-5 py-6 shadow-sm sm:px-8 sm:py-7" data-testid="panel-payment-summary">
        <div className="pointer-events-none absolute -right-14 -top-24 h-64 w-64 rounded-full border-[28px] border-primary/[0.07]" />
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
              <ShieldCheck size={13} /> Accounts ledger
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-[38px]">Payments</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Collected receipts, open balances and payment follow-up for active orders.</p>
          </div>
          {overview.data && <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="text-ledger-status">
            <span className="h-2 w-2 rounded-full bg-primary" /> Live overview
          </div>}
        </div>
      </section>

      {overview.isLoading ? <PaymentSkeleton /> : overview.isError ? <Card className="border-destructive/30 bg-card" data-testid="state-payment-error">
        <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 text-destructive" size={20} />
            <div><h2 className="font-display text-lg font-semibold">Payment overview unavailable</h2><p className="mt-1 text-sm text-muted-foreground">The ledger could not be loaded. Check your connection and retry.</p></div>
          </div>
          <Button variant="outline" onClick={() => void overview.refetch()} data-testid="button-retry-payment-overview"><RefreshCw size={15} className="mr-2" />Retry</Button>
        </CardContent>
      </Card> : overview.data ? <>
        <section className="grid gap-4 md:grid-cols-[1.2fr_1fr_1fr]">
          <Card className="overflow-hidden border-primary/20 bg-primary text-primary-foreground shadow-sm" data-testid="card-total-collected">
            <CardContent className="relative flex min-h-[148px] flex-col justify-between p-5 sm:p-6">
              <div className="absolute -right-4 -top-5 opacity-[0.12]"><Wallet size={112} strokeWidth={1} /></div>
              <div className="relative flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-foreground/75">Net paid</span>
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-foreground/15"><ArrowDownLeft size={18} /></span>
              </div>
              <div className="relative">
                <p className="font-display text-3xl font-bold tracking-tight sm:text-[34px]" data-testid="value-total-collected">{formatInr(overview.data.totalCollected)}</p>
                <p className="mt-1 text-xs text-primary-foreground/70">Received receipts less refunds</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card shadow-sm" data-testid="card-total-outstanding">
            <CardContent className="flex min-h-[148px] flex-col justify-between p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Total outstanding</span>
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/20 text-accent-foreground"><BadgeIndianRupee size={18} /></span>
              </div>
              <div>
                <p className="font-display text-3xl font-bold tracking-tight sm:text-[34px]" data-testid="value-total-outstanding">{formatInr(overview.data.totalOutstanding)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Remaining client balances</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card shadow-sm" data-testid="card-orders-with-balance">
            <CardContent className="flex min-h-[148px] flex-col justify-between p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Orders with balance</span>
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-secondary-foreground"><CreditCard size={18} /></span>
              </div>
              <div>
                <p className="font-display text-3xl font-bold tracking-tight sm:text-[34px]" data-testid="value-orders-with-balance">{overview.data.ordersWithBalance}</p>
                <p className="mt-1 text-xs text-muted-foreground">Orders with a remaining balance</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <Tabs defaultValue="balance" className="space-y-4" data-testid="tabs-payment-sections">
         <TabsList className="grid h-auto w-full max-w-3xl grid-cols-3 rounded-xl bg-secondary/70 p-1">
            <TabsTrigger value="balance" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-payment-balances">
              Balance follow-up <span className="rounded-full bg-background/70 px-2 py-0.5 text-[10px]">{overview.data.reminderOrders.length}</span>
            </TabsTrigger>
            <TabsTrigger value="receipts" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-payment-receipts">
              Recent receipts <span className="rounded-full bg-background/70 px-2 py-0.5 text-[10px]">{allRecentPayments.length}</span>
            </TabsTrigger>
            <TabsTrigger value="flags" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-payment-flags">
              Flagged payments <span className="rounded-full bg-background/70 px-2 py-0.5 text-[10px]">{flagsQuery.data?.filter((flag) => flag.status !== 'removed').length ?? 0}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="balance" className="mt-0" data-testid="section-payment-balances-tab">
           <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm" data-testid="section-reminder-orders">
             <div className="space-y-3 border-b border-border px-4 py-4 sm:px-5">
               <div className="flex flex-wrap items-start justify-between gap-3">
                 <div>
                   <div className="flex items-center gap-2"><h2 className="font-display text-lg font-bold">Balance follow-up</h2><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground" data-testid="count-reminder-orders">{filteredReminderOrders.length}</span></div>
                   <p className="mt-1 text-xs text-muted-foreground">Only orders with a remaining balance. Completed payment history is kept in the separate Balance Payment register.</p>
                 </div>
                 <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary" data-testid="status-reminder-availability">
                   <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                   Manual WhatsApp
                 </span>
               </div>
               <div className="flex flex-col gap-2 sm:flex-row">
                 <label className="relative min-w-0 flex-1">
                   <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                   <input value={reminderSearch} onChange={(event) => setReminderSearch(event.target.value)} placeholder="Search order, client or location" aria-label="Search balance follow-up orders" data-testid="input-reminder-search" className={`${controlClass} w-full pl-9 pr-3`} />
                 </label>
                 <LayoutToggle view={reminderLayout} onChange={setReminderLayout} testId="reminder" />
               </div>
               <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                 <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted-foreground"><span className="inline-flex items-center gap-1"><MapPin size={11} />Location</span><select value={reminderLocation} onChange={(event) => setReminderLocation(event.target.value)} className={controlClass} data-testid="select-reminder-location"><option value="all">All locations</option>{reminderLocations.map((location) => <option key={location} value={location}>{location}</option>)}</select></label>
                 <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted-foreground"><span>Order stage</span><select value={reminderLifecycle} onChange={(event) => setReminderLifecycle(event.target.value)} className={controlClass} data-testid="select-reminder-lifecycle"><option value="all">All stages</option>{reminderLifecycles.map((status) => <option key={status} value={status}>{lifecycleStatusLabel(status)}</option>)}</select></label>
                 <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted-foreground"><span>Payment progress</span><select value={reminderPayment} onChange={(event) => setReminderPayment(event.target.value as ReminderPaymentFilter)} className={controlClass} data-testid="select-reminder-payment"><option value="all">Any progress</option><option value="unpaid">No receipts yet</option><option value="partial">Partially paid</option></select></label>
                 <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted-foreground"><span>Reminder readiness</span><select value={reminderReadiness} onChange={(event) => setReminderReadiness(event.target.value as ReminderReadinessFilter)} className={controlClass} data-testid="select-reminder-readiness"><option value="all">Any readiness</option><option value="ready">Draft ready</option><option value="production">Production incomplete</option><option value="phone">WhatsApp number needed</option></select></label>
                 <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted-foreground"><span className="inline-flex items-center gap-1"><SlidersHorizontal size={11} />Sort by</span><select value={reminderSort} onChange={(event) => setReminderSort(event.target.value as ReminderSort)} className={controlClass} data-testid="select-reminder-sort"><option value="oldest">Most late · oldest order</option><option value="balance">Most remaining · highest balance</option><option value="newest">Newest order</option><option value="client">Client A–Z</option><option value="order">Order ID</option></select></label>
                 <div className="flex items-end"><Button type="button" variant="ghost" size="sm" onClick={clearReminderFilters} className="h-9 px-2 text-xs" data-testid="button-clear-reminder-filters">Clear filters</Button></div>
               </div>
               <p className="text-[10px] leading-4 text-muted-foreground">“Most late” uses order creation date because payment due dates aren’t recorded; ties put the highest remaining balance first.</p>
             </div>
             <div className="flex gap-2.5 border-b border-border bg-muted/30 px-5 py-3 text-xs leading-5 text-muted-foreground" data-testid="notice-reminder-manual">
               <Send size={15} className="mt-0.5 shrink-0 text-primary" />
               <p>Open a prefilled WhatsApp draft, review it, then press Send in WhatsApp. This app does not send messages or track delivery.</p>
             </div>
             {overview.data.reminderUnavailableReason && <div className="flex gap-2.5 border-b border-accent/30 bg-accent/10 px-5 py-3 text-xs leading-5 text-foreground" data-testid="notice-reminder-unavailable">
               <CircleAlert size={15} className="mt-0.5 shrink-0 text-accent-foreground" />
               <p><span className="font-bold">Reminder drafts unavailable.</span> {overview.data.reminderUnavailableReason}</p>
             </div>}
             <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20 px-4 py-2.5 text-[10px] text-muted-foreground sm:px-5">
               <span>{filteredReminderOrders.length} of {reminderOrders.length} orders · {formatInr(filteredReminderOrders.reduce((sum, order) => sum + order.balance, 0))} remaining</span>
               <span>Oldest outstanding orders are prioritized</span>
             </div>
             {filteredReminderOrders.length === 0 ? <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center" data-testid="state-no-reminder-orders">
               <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-secondary text-secondary-foreground"><Check size={20} /></span>
               <p className="font-semibold">{reminderOrders.length === 0 ? 'No balances need follow-up' : 'No orders match these filters'}</p>
               <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{reminderOrders.length === 0 ? 'Orders with outstanding balances will appear here.' : 'Try changing your search or filters to see more outstanding orders.'}</p>
               {reminderOrders.length > 0 && <Button type="button" variant="outline" size="sm" className="mt-4" onClick={clearReminderFilters}>Clear filters</Button>}
             </div> : reminderLayout === 'list' ? <div className="divide-y divide-border/70">
               {filteredReminderOrders.map((order) => <ReminderOrderEntry
                 key={order.orderRecordId}
                 order={order}
                 layout="list"
                 userName={user.name}
                 activeFlag={activeFlagByOrder.get(order.orderRecordId) ?? null}
                 flagCount={activeFlagCounts.get(order.orderRecordId) ?? 0}
                 onViewFlag={() => setSelectedFlag(activeFlagByOrder.get(order.orderRecordId) ?? null)}
                 onAddFlag={() => setSelectedFlag(null)}
               />)}
             </div> : <div className="grid gap-3 bg-muted/20 p-3 sm:grid-cols-2 xl:grid-cols-3">
               {filteredReminderOrders.map((order) => <ReminderOrderEntry
                 key={order.orderRecordId}
                 order={order}
                 layout="grid"
                 userName={user.name}
                 activeFlag={activeFlagByOrder.get(order.orderRecordId) ?? null}
                 flagCount={activeFlagCounts.get(order.orderRecordId) ?? 0}
                 onViewFlag={() => setSelectedFlag(activeFlagByOrder.get(order.orderRecordId) ?? null)}
                 onAddFlag={() => setSelectedFlag(null)}
               />)}
             </div>}
           </section>

          </TabsContent>
          <TabsContent value="receipts" className="mt-0" data-testid="section-payment-receipts-tab">
          <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm" data-testid="section-recent-payments">
             <div className="space-y-3 border-b border-border px-4 py-4 sm:px-5">
               <div className="flex flex-wrap items-start justify-between gap-3">
                 <div><div className="flex items-center gap-2"><h2 className="font-display text-lg font-bold">Recent receipts</h2><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground" data-testid="count-recent-receipts">{recentPayments.length} / {allRecentPayments.length}</span></div><p className="mt-1 text-xs text-muted-foreground">Search and sort the latest received payments. Full payment history is in the separate Balance Payment register.</p></div>
                 <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Clock3 size={17} /></span>
               </div>
               <div className="flex flex-col gap-2 sm:flex-row">
                 <label className="relative min-w-0 flex-1">
                   <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                   <input value={receiptSearch} onChange={(event) => setReceiptSearch(event.target.value)} placeholder="Search order, client, method or recorder" aria-label="Search recent receipts" data-testid="input-receipt-search" className={`${controlClass} w-full pl-9 pr-3`} />
                 </label>
                 <LayoutToggle view={receiptLayout} onChange={setReceiptLayout} testId="receipt" />
               </div>
               <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                 <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted-foreground"><span className="inline-flex items-center gap-1"><MapPin size={11} />Location</span><select value={receiptLocation} onChange={(event) => setReceiptLocation(event.target.value)} className={controlClass} data-testid="select-receipt-location"><option value="all">All locations</option>{receiptLocations.map((location) => <option key={location} value={location}>{location}</option>)}</select></label>
                 <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted-foreground"><span>Payment method</span><select value={receiptMethod} onChange={(event) => setReceiptMethod(event.target.value)} className={controlClass} data-testid="select-receipt-method"><option value="all">All methods</option>{receiptMethods.map((method) => <option key={method} value={method}>{methodLabel(method)}</option>)}</select></label>
                 <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted-foreground"><span>Recorded by</span><select value={receiptRecorder} onChange={(event) => setReceiptRecorder(event.target.value)} className={controlClass} data-testid="select-receipt-recorder"><option value="all">Anyone</option>{receiptRecorders.map((recorder) => <option key={recorder} value={recorder}>{recorder}</option>)}</select></label>
                 <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted-foreground"><span>Paid from</span><input type="date" value={receiptFrom} max={receiptTo || undefined} onChange={(event) => setReceiptFrom(event.target.value)} className={controlClass} aria-label="Receipt paid from date" data-testid="input-receipt-date-from" /></label>
                 <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted-foreground"><span>Paid to</span><input type="date" value={receiptTo} min={receiptFrom || undefined} onChange={(event) => setReceiptTo(event.target.value)} className={controlClass} aria-label="Receipt paid to date" data-testid="input-receipt-date-to" /></label>
                 <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted-foreground"><span className="inline-flex items-center gap-1"><SlidersHorizontal size={11} />Sort by</span><select value={receiptSort} onChange={(event) => setReceiptSort(event.target.value as ReceiptSort)} className={controlClass} data-testid="select-receipt-sort"><option value="entry_newest">Latest recorded</option><option value="entry_oldest">Oldest recorded</option><option value="paid_newest">Latest payment date</option><option value="paid_oldest">Oldest payment date</option><option value="highest">Highest amount</option><option value="lowest">Lowest amount</option><option value="client">Client A–Z</option><option value="order">Order ID</option></select></label>
                 <div className="flex items-end"><Button type="button" variant="ghost" size="sm" onClick={clearReceiptFilters} className="h-9 px-2 text-xs" data-testid="button-clear-receipt-filters">Clear filters</Button></div>
               </div>
             </div>
             {allRecentPayments.length === 0 ? <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center" data-testid="state-no-recent-payments">
              <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground"><Banknote size={19} /></span>
              <p className="font-semibold">No received payments yet</p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Newly recorded receipts will appear here for quick reconciliation.</p>
             </div> : recentPayments.length === 0 ? <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center" data-testid="state-no-matching-receipts">
               <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground"><Search size={19} /></span>
               <p className="font-semibold">No receipts match these filters</p>
               <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Change the search, date range or filters to see more recent receipts.</p>
               <Button type="button" variant="outline" size="sm" className="mt-4" onClick={clearReceiptFilters}>Clear filters</Button>
             </div> : receiptLayout === 'list' ? <div className="divide-y divide-border/70">
               {recentPayments.map((payment) => {
                const activeFlag = activeFlagByOrder.get(payment.orderRecordId) ?? null;
                return <RecentPaymentRow
                  key={payment.id}
                  payment={payment}
                   layout="list"
                  flagCount={activeFlagCounts.get(payment.orderRecordId) ?? 0}
                  activeFlag={activeFlag}
                  onViewFlag={() => setSelectedFlag(activeFlag)}
                />;
              })}
             </div> : <div className="grid gap-3 bg-muted/20 p-3 sm:grid-cols-2 xl:grid-cols-3">
               {recentPayments.map((payment) => {
                 const activeFlag = activeFlagByOrder.get(payment.orderRecordId) ?? null;
                 return <RecentPaymentRow
                   key={payment.id}
                   payment={payment}
                   layout="grid"
                   flagCount={activeFlagCounts.get(payment.orderRecordId) ?? 0}
                   activeFlag={activeFlag}
                   onViewFlag={() => setSelectedFlag(activeFlag)}
                 />;
               })}
             </div>}
             {recentPayments.length > 0 && <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/25 px-5 py-3 text-[10px] text-muted-foreground"><CalendarClock size={13} />Showing {recentPayments.length} of {allRecentPayments.length} recent receipts · date range uses payment date · sort: {({ entry_newest: 'latest recorded', entry_oldest: 'oldest recorded', paid_newest: 'latest payment date', paid_oldest: 'oldest payment date', highest: 'highest amount', lowest: 'lowest amount', client: 'client A–Z', order: 'order ID' })[receiptSort]}</div>}
          </section>
          </TabsContent>
          <TabsContent value="flags" className="mt-0" data-testid="section-payment-flags-tab">
            <FlaggedPaymentsSection
              flags={(flagsQuery.data ?? []) as PaymentFlag[]}
              canEdit={canEditFlags}
              isLoading={flagsQuery.isLoading}
              isError={flagsQuery.isError}
              onRetry={() => void flagsQuery.refetch()}
            />
          </TabsContent>
        </Tabs>
        <PaymentFlagDetails flag={selectedFlag} canEdit={canEditFlags} onClose={() => setSelectedFlag(null)} onFlagUpdated={setSelectedFlag} />
      </> : null}
    </main>
  </AppShell>;
}

function LayoutToggle({ view, onChange, testId }: { view: PaymentLayout; onChange: (view: PaymentLayout) => void; testId: string }) {
  return <div className="inline-flex h-9 shrink-0 items-center gap-0.5 self-end rounded-lg border border-border bg-background p-0.5" role="group" aria-label="Choose layout">
    <button type="button" onClick={() => onChange('list')} aria-pressed={view === 'list'} aria-label="List layout" title="List layout" className={`grid size-8 place-items-center rounded-md transition-colors ${view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} data-testid={`button-${testId}-list-layout`}><List size={15} /></button>
    <button type="button" onClick={() => onChange('grid')} aria-pressed={view === 'grid'} aria-label="Grid layout" title="Grid layout" className={`grid size-8 place-items-center rounded-md transition-colors ${view === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} data-testid={`button-${testId}-grid-layout`}><Grid2X2 size={14} /></button>
  </div>;
}

function ReminderOrderEntry({
  order,
  layout,
  userName,
  activeFlag,
  flagCount,
  onViewFlag,
  onAddFlag,
}: {
  order: PaymentReminderOrder;
  layout: PaymentLayout;
  userName: string;
  activeFlag: PaymentFlag | null;
  flagCount: number;
  onViewFlag: () => void;
  onAddFlag: () => void;
}) {
  const isGrid = layout === 'grid';
  const createdAt = new Date(order.orderCreatedAt);
  const orderDateLabel = Number.isNaN(createdAt.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(createdAt);
  const ageDays = Number.isNaN(createdAt.getTime())
    ? null
    : Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86_400_000));

  return <article
    className={isGrid
      ? 'flex h-full flex-col justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-sm'
      : 'grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'}
    data-testid={`row-reminder-order-${order.orderRecordId}`}
  >
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link href={`/order-hub/${order.orderRecordId}`} className="font-mono text-xs font-bold text-primary hover:underline" data-testid={`link-reminder-order-${order.orderRecordId}`}>{order.orderId}<ArrowRight size={12} className="ml-1 inline" /></Link>
        {activeFlag && <button type="button" onClick={(event) => { event.stopPropagation(); onViewFlag(); }} aria-label="View flag details" className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`button-view-order-flag-${order.orderRecordId}`}><Flag size={11} fill="currentColor" />Flagged: {activeFlag.flagType === 'bounced_payment' ? 'Bounced' : 'Refusal to Pay'}</button>}
        <span className="text-[10px] text-muted-foreground">{order.windowCount === 0 ? 'No active windows' : `${order.windowCount} windows`}</span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary" data-testid={`status-order-lifecycle-${order.orderRecordId}`}>Lifecycle: {lifecycleStatusLabel(order.orderStatus)}</span>
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${order.productionReady ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`} data-testid={`status-production-ready-${order.orderRecordId}`}>Window readiness: {order.productionReady ? 'Complete' : 'Incomplete'}</span>
      </div>
      <p className="mt-1 truncate text-sm font-semibold" data-testid={`text-reminder-client-${order.orderRecordId}`}>{order.clientName}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground">
        <MapPin size={12} />{order.locationName}<span className="mx-1 text-border">/</span>
        Order {formatInr(order.orderValue)} · Paid {formatInr(order.totalCollected)}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground" data-testid={`text-reminder-order-age-${order.orderRecordId}`}>
        <span className="inline-flex items-center gap-1"><CalendarDays size={11} />Order date {orderDateLabel}</span>
        {ageDays !== null && <span>{ageDays} days old</span>}
      </div>
      <PaymentProgressBar percentage={order.percentage} compact testId={`progress-reminder-order-${order.orderRecordId}`} />
      {!order.productionReady && <p className="mt-1 text-[10px] text-muted-foreground">Add at least one window, then complete frame, shutter and glass readiness to enable a draft.</p>}
      {order.productionReady && !order.canOpenWhatsApp && <p className="mt-1 text-[10px] text-muted-foreground">Add a valid WhatsApp number to enable the draft.</p>}
    </div>
    <div className={`flex flex-wrap items-center gap-3 ${isGrid ? 'mt-auto justify-between border-t border-border pt-3' : 'justify-between sm:justify-end'}`}>
      <div className={isGrid ? '' : 'sm:text-right'}>
        <p className="font-display text-lg font-bold tabular-nums" data-testid={`value-balance-${order.orderRecordId}`}>{formatInr(order.balance)}</p>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance due</p>
      </div>
      {flagCount === 0 && <PaymentFlagDialog orderId={order.orderRecordId} flaggedBy={userName} onOpening={onAddFlag} />}
      <form method="post" action={`/api/orders/${encodeURIComponent(order.orderRecordId)}/payment-reminder`} target="_blank" rel="noreferrer">
        <Button type="submit" size="sm" variant="outline" disabled={!order.canOpenWhatsApp} data-testid={`button-send-reminder-${order.orderRecordId}`} title={!order.canOpenWhatsApp ? !order.productionReady ? 'Every active window must be ready and glass received before opening a reminder.' : 'Add a valid WhatsApp number to this order.' : 'Open a draft for manual sending in WhatsApp'}>
          <Send size={14} className="mr-1.5" /> Open WhatsApp
        </Button>
      </form>
    </div>
  </article>;
}

function RecentPaymentRow({ payment, flagCount, activeFlag, onViewFlag, layout }: { payment: RecentPaymentUpdate; flagCount: number; activeFlag: PaymentFlag | null; onViewFlag: () => void; layout: PaymentLayout }) {
  const isGrid = layout === 'grid';
  return <article className={isGrid
    ? 'flex h-full flex-col justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-sm'
    : 'flex items-start justify-between gap-3 px-5 py-4'}
    data-testid={`row-recent-payment-${payment.id}`}
  >
    <div className="flex min-w-0 gap-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Banknote size={15} /></span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/order-hub/${payment.orderRecordId}`} className="font-mono text-[11px] font-bold text-primary hover:underline" data-testid={`link-payment-order-${payment.id}`}>{payment.orderId}<ArrowRight size={11} className="ml-1 inline" /></Link>
          {activeFlag && <button type="button" onClick={onViewFlag} aria-label={`View ${activeFlag.flagType === 'bounced_payment' ? 'bounced payment' : 'refusal to pay'} flag details`} className="rounded-full transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`button-view-receipt-flag-${payment.id}`}>
            <PaymentFlagBadge count={flagCount} label={activeFlag.flagType === 'bounced_payment' ? 'Flagged: Bounced' : 'Flagged: Refusal to Pay'} />
          </button>}
        </div>
        <p className="mt-1 truncate text-sm font-semibold" data-testid={`text-payment-client-${payment.id}`}>{payment.clientName}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] leading-4 text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Building2 size={11} />{payment.locationName}</span><span aria-hidden="true">·</span><span>{methodLabel(payment.method)}</span>
        </p>
        <p className="mt-1.5 text-[10px] text-muted-foreground" data-testid={`text-payment-date-${payment.id}`}>{dateTime(payment.paidAt)} <span className="mx-1">·</span> Recorded by {payment.recordedBy}</p>
      </div>
    </div>
    <p className={`shrink-0 pt-0.5 font-display text-sm font-bold tabular-nums ${isGrid ? 'mt-auto border-t border-border pt-3' : ''}`} data-testid={`value-payment-amount-${payment.id}`}>{formatInr(payment.amount)}</p>
  </article>;
}