import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowDownLeft,
  ArrowRight,
  BadgeIndianRupee,
  Banknote,
  Building2,
  CalendarClock,
  Check,
  CircleAlert,
  Clock3,
  CreditCard,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {
  getGetPaymentOverviewQueryKey,
  useGetPaymentOverview,
  useSendPaymentReminder,
} from '@workspace/api-client-react';
import type { RecentPaymentUpdate, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const money = (amount: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
}).format(amount);

const dateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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
  const queryClient = useQueryClient();
  const overview = useGetPaymentOverview();
  const reminder = useSendPaymentReminder();
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [reminderResult, setReminderResult] = useState<{ orderId: string; clientName: string; balance: number; acceptedAt: string } | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);

  const recentPayments = useMemo(
    () => [...(overview.data?.recentPayments ?? [])].sort(
      (a: RecentPaymentUpdate, b: RecentPaymentUpdate) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime(),
    ),
    [overview.data?.recentPayments],
  );

  const sendReminder = (orderRecordId: string) => {
    if (!overview.data?.reminderAvailable || reminder.isPending) return;
    setSelectedOrder(orderRecordId);
    setReminderResult(null);
    setReminderError(null);
    reminder.mutate({ id: orderRecordId }, {
      onSuccess: (result) => {
        setSelectedOrder(null);
        setReminderResult(result);
        void queryClient.invalidateQueries({ queryKey: getGetPaymentOverviewQueryKey() });
      },
      onError: (error) => {
        setSelectedOrder(null);
        setReminderError(error instanceof Error ? error.message : 'The reminder could not be sent. Please try again.');
      },
    });
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
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-foreground/75">Total collected</span>
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-foreground/15"><ArrowDownLeft size={18} /></span>
              </div>
              <div className="relative">
                <p className="font-display text-3xl font-bold tracking-tight sm:text-[34px]" data-testid="value-total-collected">{money(overview.data.totalCollected)}</p>
                <p className="mt-1 text-xs text-primary-foreground/70">Received across all tracked orders</p>
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
                <p className="font-display text-3xl font-bold tracking-tight sm:text-[34px]" data-testid="value-total-outstanding">{money(overview.data.totalOutstanding)}</p>
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
                <p className="mt-1 text-xs text-muted-foreground">Production-ready orders eligible for follow-up</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
          <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm" data-testid="section-reminder-orders">
            <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2"><h2 className="font-display text-lg font-bold">Balance follow-up</h2><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground" data-testid="count-reminder-orders">{overview.data.reminderOrders.length}</span></div>
                <p className="mt-1 text-xs text-muted-foreground">Ready frames, shutters and received glass with an unpaid balance.</p>
              </div>
              <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${overview.data.reminderAvailable ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`} data-testid="status-reminder-availability">
                <span className={`h-1.5 w-1.5 rounded-full ${overview.data.reminderAvailable ? 'bg-primary' : 'bg-muted-foreground/60'}`} />
                {overview.data.reminderAvailable ? 'Reminder ready' : 'Sending unavailable'}
              </span>
            </div>
            {!overview.data.reminderAvailable && <div className="flex gap-2.5 border-b border-accent/30 bg-accent/10 px-5 py-3 text-xs leading-5 text-foreground" data-testid="notice-reminder-unavailable">
              <CircleAlert size={15} className="mt-0.5 shrink-0 text-accent-foreground" />
              <p><span className="font-bold">Reminders are disabled.</span> {overview.data.reminderUnavailableReason || 'No approved balance-reminder template is configured.'}</p>
            </div>}
            {reminderResult && <div className="flex items-start gap-2.5 border-b border-primary/20 bg-primary/[0.06] px-5 py-3 text-xs text-foreground" role="status" data-testid="status-reminder-success">
              <Check size={15} className="mt-0.5 shrink-0 text-primary" />
              <p>Reminder accepted for <strong>{reminderResult.clientName}</strong> ({reminderResult.orderId}) — balance {money(reminderResult.balance)}. Sent {dateTime(reminderResult.acceptedAt)}.</p>
            </div>}
            {reminderError && <div className="flex items-start justify-between gap-3 border-b border-destructive/20 bg-destructive/5 px-5 py-3 text-xs" role="alert" data-testid="status-reminder-error"><p className="text-destructive">{reminderError}</p><button type="button" onClick={() => setReminderError(null)} className="font-bold text-muted-foreground" aria-label="Dismiss reminder error" data-testid="button-dismiss-reminder-error">Dismiss</button></div>}
            {overview.data.reminderOrders.length === 0 ? <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center" data-testid="state-no-reminder-orders">
              <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-secondary text-secondary-foreground"><Check size={20} /></span>
              <p className="font-semibold">No balances need follow-up</p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Orders appear here once every window is ready and a balance remains.</p>
            </div> : <div className="divide-y divide-border/70">
              {overview.data.reminderOrders.map((order) => <article key={order.orderRecordId} className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid={`row-reminder-order-${order.orderRecordId}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link href={`/order-hub/${order.orderRecordId}`} className="font-mono text-xs font-bold text-primary hover:underline" data-testid={`link-reminder-order-${order.orderRecordId}`}>{order.orderId}<ArrowRight size={12} className="ml-1 inline" /></Link>
                    <span className="text-[10px] text-muted-foreground">{order.windowCount} windows</span>
                  </div>
                  <p className="mt-1 truncate text-sm font-semibold" data-testid={`text-reminder-client-${order.orderRecordId}`}>{order.clientName}</p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><MapPin size={12} />{order.locationName} <span className="mx-1 text-border">/</span> Order {money(order.orderValue)} · Paid {money(order.totalCollected)}</p>
                </div>
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <div className="sm:text-right">
                    <p className="font-display text-lg font-bold tabular-nums" data-testid={`value-balance-${order.orderRecordId}`}>{money(order.balance)}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance due</p>
                  </div>
                  <Button size="sm" variant="outline" disabled={!overview.data.reminderAvailable || reminder.isPending} onClick={() => sendReminder(order.orderRecordId)} data-testid={`button-send-reminder-${order.orderRecordId}`} title={!overview.data.reminderAvailable ? (overview.data.reminderUnavailableReason || 'No approved reminder template is configured.') : 'Send balance reminder'}>
                    {selectedOrder === order.orderRecordId && reminder.isPending ? <LoaderCircle size={14} className="mr-1.5 animate-spin" /> : <Send size={14} className="mr-1.5" />}
                    Send
                  </Button>
                </div>
              </article>)}
            </div>}
          </section>

          <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm" data-testid="section-recent-payments">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div><h2 className="font-display text-lg font-bold">Recent receipts</h2><p className="mt-1 text-xs text-muted-foreground">Latest received payments, newest first.</p></div>
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Clock3 size={17} /></span>
            </div>
            {recentPayments.length === 0 ? <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center" data-testid="state-no-recent-payments">
              <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground"><Banknote size={19} /></span>
              <p className="font-semibold">No received payments yet</p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Newly recorded receipts will appear here for quick reconciliation.</p>
            </div> : <div className="divide-y divide-border/70">
              {recentPayments.map((payment) => <RecentPaymentRow key={payment.id} payment={payment} />)}
            </div>}
            {recentPayments.length > 0 && <div className="flex items-center gap-2 border-t border-border bg-muted/25 px-5 py-3 text-[10px] text-muted-foreground"><CalendarClock size={13} /> Sorted by payment date</div>}
          </section>
        </div>
      </> : null}
    </main>
  </AppShell>;
}

function RecentPaymentRow({ payment }: { payment: RecentPaymentUpdate }) {
  return <article className="flex items-start justify-between gap-3 px-5 py-4" data-testid={`row-recent-payment-${payment.id}`}>
    <div className="flex min-w-0 gap-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Banknote size={15} /></span>
      <div className="min-w-0">
        <Link href={`/order-hub/${payment.orderRecordId}`} className="font-mono text-[11px] font-bold text-primary hover:underline" data-testid={`link-payment-order-${payment.id}`}>{payment.orderId}<ArrowRight size={11} className="ml-1 inline" /></Link>
        <p className="mt-1 truncate text-sm font-semibold" data-testid={`text-payment-client-${payment.id}`}>{payment.clientName}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] leading-4 text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Building2 size={11} />{payment.locationName}</span><span aria-hidden="true">·</span><span>{methodLabel(payment.method)}</span>
        </p>
        <p className="mt-1.5 text-[10px] text-muted-foreground" data-testid={`text-payment-date-${payment.id}`}>{dateTime(payment.paidAt)} <span className="mx-1">·</span> Recorded by {payment.recordedBy}</p>
      </div>
    </div>
    <p className="shrink-0 pt-0.5 font-display text-sm font-bold tabular-nums" data-testid={`value-payment-amount-${payment.id}`}>{money(payment.amount)}</p>
  </article>;
}