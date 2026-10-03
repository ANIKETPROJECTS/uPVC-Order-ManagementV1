import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { z } from 'zod';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleAlert,
  ClipboardCheck,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import {
  getGetOrderQueryKey,
  getListDispatchOrdersQueryKey,
  getListInstallationOrdersQueryKey,
  getListOrderActivityQueryKey,
  useListInstallationOrders,
  useUpdateInstallationOrder,
} from '@workspace/api-client-react';
import type { InstallationOrder, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

const installationFormSchema = z.object({
  installationStatus: z.enum(['issue', 'installed']),
  installationDate: z.string().min(1, 'Choose the installation or issue date.'),
  issueReason: z.string().max(2000, 'Keep the reason under 2,000 characters.'),
}).superRefine((value, context) => {
  if (value.installationStatus === 'issue' && !value.issueReason.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['issueReason'], message: 'Add a reason for the issue.' });
  }
});

type InstallationFormValues = z.infer<typeof installationFormSchema>;
type StatusFilter = 'all' | 'pending' | 'issue' | 'installed';

const localDateInput = (value?: Date | string | null) => {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
};

function hasPermission(user: User, level: 'view' | 'edit' = 'view') {
  const permission = user.permissions?.installation;
  return user.roleId === 'master-admin'
    || permission === 'edit'
    || (level === 'view' && permission === 'view');
}

function hasOrderView(user: User) {
  return user.roleId === 'master-admin'
    || user.permissions?.['order-hub'] === 'edit'
    || user.permissions?.['order-hub'] === 'view';
}

function formatDate(value: Date | string | null) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Update time unavailable';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function readableStatus(value: string) {
  return value.replaceAll('_', ' ');
}

const statusLabels: Record<InstallationOrder['installationStatus'], string> = {
  pending: 'Awaiting installation',
  issue: 'Issue reported',
  installed: 'Installed',
};

function statusTone(status: InstallationOrder['installationStatus']) {
  if (status === 'installed') return 'bg-emerald-100 text-emerald-800 ring-emerald-200';
  if (status === 'issue') return 'bg-amber-100 text-amber-900 ring-amber-200';
  return 'bg-slate-100 text-slate-700 ring-slate-200';
}

function LoadingRows() {
  return <div className="space-y-3" aria-label="Loading installation orders" data-testid="state-installation-loading">
    {[0, 1, 2].map((row) => <div key={row} className="h-36 animate-pulse rounded-2xl border border-border/70 bg-card/70" />)}
  </div>;
}

function InstallationDialog({ order, canEdit, pending, onClose, onSave }: {
  order: InstallationOrder | null;
  canEdit: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (order: InstallationOrder, values: InstallationFormValues) => void;
}) {
  const form = useForm<InstallationFormValues>({
    resolver: zodResolver(installationFormSchema),
    defaultValues: { installationStatus: 'installed', installationDate: localDateInput(), issueReason: '' },
  });
  const outcome = form.watch('installationStatus');

  useEffect(() => {
    if (!order) return;
    form.reset({
      installationStatus: order.installationStatus === 'issue' ? 'issue' : 'installed',
      installationDate: localDateInput(order.installationDate),
      issueReason: order.issueReason || '',
    });
  }, [form.reset, order?.id, order?.installationDate, order?.installationStatus, order?.issueReason]);

  return <Dialog open={Boolean(order)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Wrench size={19} /></div>
        <DialogTitle>Installation update</DialogTitle>
        <DialogDescription>{order ? `${order.orderId} · ${order.clientName} · ${order.locationName}` : 'Record an installation result.'}</DialogDescription>
      </DialogHeader>
      {order && <Form {...form}>
        <form className="space-y-4" onSubmit={form.handleSubmit((values) => onSave(order, values))} data-testid="form-installation-update">
          {!canEdit && <div className="flex gap-2 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-xs leading-5 text-amber-950"><ShieldCheck size={15} className="mt-0.5 shrink-0" />Your Installation access is view-only.</div>}
          <FormField control={form.control} name="installationStatus" render={({ field }) => <FormItem>
            <FormLabel>Installation result</FormLabel>
            <Select value={field.value} onValueChange={field.onChange} disabled={!canEdit || order.installationStatus === 'installed'}>
              <FormControl><SelectTrigger data-testid="select-installation-result"><SelectValue placeholder="Choose result" /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="installed">Mark as installed</SelectItem>
                {order.installationStatus !== 'installed' && <SelectItem value="issue">Report an issue</SelectItem>}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>} />
          <FormField control={form.control} name="installationDate" render={({ field }) => <FormItem>
            <FormLabel>{outcome === 'issue' ? 'Issue date' : 'Installation date'}</FormLabel>
            <FormControl><Input type="date" {...field} disabled={!canEdit} data-testid="input-installation-date" /></FormControl>
            <FormMessage />
          </FormItem>} />
          {outcome === 'issue' && <FormField control={form.control} name="issueReason" render={({ field }) => <FormItem>
            <FormLabel>Issue reason</FormLabel>
            <FormControl><Textarea {...field} rows={4} maxLength={2000} placeholder="Describe what prevented or affected installation…" disabled={!canEdit} data-testid="textarea-installation-issue-reason" /></FormControl>
            <p className="text-[10px] text-muted-foreground">Required to record an installation issue.</p>
            <FormMessage />
          </FormItem>} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-installation-update">Cancel</Button>
            {canEdit && <Button type="submit" disabled={pending} data-testid="button-save-installation-update">{pending ? 'Saving…' : 'Save update'}</Button>}
          </DialogFooter>
        </form>
      </Form>}
    </DialogContent>
  </Dialog>;
}

export default function InstallationPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canView = hasPermission(user);
  const canEdit = hasPermission(user, 'edit');
  const canViewOrders = hasOrderView(user);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [activeOrder, setActiveOrder] = useState<InstallationOrder | null>(null);
  const query = useListInstallationOrders({ query: { enabled: canView, queryKey: getListInstallationOrdersQueryKey() } });
  const update = useUpdateInstallationOrder();
  const orders = query.data || [];

  const counts = useMemo(() => ({
    pending: orders.filter((order) => order.installationStatus === 'pending').length,
    issue: orders.filter((order) => order.installationStatus === 'issue').length,
    installed: orders.filter((order) => order.installationStatus === 'installed').length,
  }), [orders]);
  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return orders.filter((order) => {
      if (filter !== 'all' && order.installationStatus !== filter) return false;
      return !needle || `${order.orderId} ${order.clientName} ${order.locationName} ${order.issueReason || ''}`.toLocaleLowerCase().includes(needle);
    });
  }, [filter, orders, search]);

  const saveUpdate = (order: InstallationOrder, values: InstallationFormValues) => {
    if (!canEdit) return;
    update.mutate({
      id: order.id,
      data: {
        installationStatus: values.installationStatus,
        installationDate: values.installationDate,
        ...(values.installationStatus === 'issue' ? { issueReason: values.issueReason.trim() } : {}),
      },
    }, {
      onSuccess: (updated) => {
        setActiveOrder(null);
        toast({
          title: updated.installationStatus === 'installed' ? 'Installation recorded' : 'Installation issue recorded',
          description: `${updated.orderId} · ${formatDate(updated.installationDate)}`,
        });
        void queryClient.invalidateQueries({ queryKey: getListInstallationOrdersQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListDispatchOrdersQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) });
        void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(order.id) });
      },
      onError: () => toast({ title: 'Installation update could not be saved', description: 'Refresh and try again.', variant: 'destructive' }),
    });
  };

  return <AppShell user={user} title="Installation" eyebrow="Fulfillment · post-delivery tracking">
    <div className="mx-auto w-full max-w-[1440px] space-y-5 pb-8">
      <section className="order-hub-accent relative overflow-hidden rounded-2xl border border-primary/10 px-5 py-5 shadow-sm md:px-7 md:py-6" data-testid="panel-installation-intro">
        <div className="absolute -right-10 -top-14 h-56 w-56 rounded-full border border-primary/15" />
        <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Fulfillment · service completion</p>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-[-.05em] md:text-[2.65rem]">Delivered orders, through installation.</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Orders enter this register when Dispatch marks them delivered. Record the installation date or note an issue that needs follow-up.</p>
          </div>
          <Link href="/dispatch" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background/80 px-4 text-xs font-bold text-foreground transition hover:border-primary/35 hover:text-primary" data-testid="link-back-to-dispatch">Dispatch register <ArrowRight size={14} /></Link>
        </div>
      </section>

      <section aria-label="Installation totals" className="grid grid-cols-3 gap-2 sm:gap-3">
        {([
          { key: 'pending', label: 'Awaiting installation', count: counts.pending, tone: 'text-slate-700', icon: CalendarDays },
          { key: 'issue', label: 'Issues to follow up', count: counts.issue, tone: 'text-amber-800', icon: CircleAlert },
          { key: 'installed', label: 'Installed', count: counts.installed, tone: 'text-emerald-800', icon: ClipboardCheck },
        ] as const).map((item) => <button type="button" key={item.key} onClick={() => setFilter(filter === item.key ? 'all' : item.key)} aria-pressed={filter === item.key} className={`group rounded-xl border bg-card px-3 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:px-4 sm:py-4 ${filter === item.key ? 'border-primary/40 ring-2 ring-primary/10' : 'border-border/80'}`} data-testid={`filter-installation-${item.key}`}>
          <div className="flex items-center justify-between gap-2"><span className="truncate text-[9px] font-bold uppercase tracking-[.11em] text-muted-foreground sm:text-[10px]">{item.label}</span><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted/70 transition group-hover:bg-primary/10"><item.icon size={15} className={item.tone} /></span></div>
          <div className={`mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl ${item.tone}`} data-testid={`metric-installation-${item.key}`}>{query.isLoading ? '—' : item.count}</div>
        </button>)}
      </section>

      <Card className="overflow-hidden border-border/80 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/75 p-4 md:p-5">
          <div><div className="flex items-center gap-2"><span className="h-5 w-1 rounded-full bg-primary" /><h2 className="font-display text-lg font-bold tracking-tight">Installation register</h2><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground" data-testid="text-installation-count">{filteredOrders.length} / {orders.length}</span></div><p className="ml-3 mt-1 text-xs text-muted-foreground">Only orders marked delivered in Dispatch appear here.</p></div>
          {!canEdit && canView && <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-900"><ShieldCheck size={13} /> View-only access</span>}
        </div>
        {canView && <div className="border-b border-border/60 p-3">
          <label className="relative block w-full sm:max-w-md">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an order, client, location, or issue" aria-label="Search installation orders" className="h-10 pl-9 text-xs" data-testid="input-installation-search" />
          </label>
        </div>}
        <CardContent className="space-y-3 p-3 sm:p-4">
          {!canView ? <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-muted/15 p-6 text-center" data-testid="state-installation-access-denied">
            <div><ShieldCheck size={24} className="mx-auto text-muted-foreground" /><h3 className="mt-3 font-display text-sm font-bold">Installation access required</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Your role does not have permission to view installation records. Ask an administrator for Installation access.</p></div>
          </div> : query.isLoading ? <LoadingRows /> : query.isError ? <div className="grid min-h-64 place-items-center rounded-xl border border-destructive/20 bg-destructive/[.035] p-6 text-center" data-testid="state-installation-error">
            <div><CircleAlert size={24} className="mx-auto text-destructive" /><h3 className="mt-3 font-display text-sm font-bold">Installation records unavailable</h3><p className="mt-1 text-xs text-muted-foreground">Delivered orders could not be loaded.</p><Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void query.refetch()} data-testid="button-retry-installation"><RefreshCw size={13} /> Try again</Button></div>
          </div> : filteredOrders.length === 0 ? <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-muted/15 p-6 text-center" data-testid="state-installation-empty">
            <div><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-secondary text-primary"><Wrench size={20} /></div><h3 className="mt-3 font-display text-sm font-bold">{orders.length ? 'No orders match this view' : 'No delivered orders yet'}</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{orders.length ? 'Try another search or select a different installation status.' : 'Once Dispatch marks an order delivered, it will appear here automatically.'}</p>{orders.length > 0 && <Button type="button" size="sm" variant="outline" className="mt-4" onClick={() => { setSearch(''); setFilter('all'); }} data-testid="button-reset-installation-filters">Clear filters</Button>}</div>
          </div> : filteredOrders.map((order) => <article key={order.id} className="group grid gap-x-4 gap-y-3 rounded-xl border border-border/75 bg-background/70 p-4 transition duration-200 hover:border-primary/25 hover:bg-primary/[.015] hover:shadow-sm md:grid-cols-[minmax(190px,1.1fr)_minmax(170px,.9fr)_minmax(180px,1fr)_auto] md:items-center" data-testid={`row-installation-order-${order.id}`}>
            <div className="min-w-0">
               <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                 {canViewOrders ? <Link href={`/order-hub/${encodeURIComponent(order.id)}`} className="font-mono text-sm font-bold tracking-tight text-primary underline-offset-4 hover:underline" data-testid={`link-installation-order-${order.id}`}>{order.orderId}</Link> : <p className="font-mono text-sm font-bold tracking-tight">{order.orderId}</p>}
                 <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold capitalize text-emerald-800 ring-1 ring-inset ring-emerald-200/80"><span className="h-1 w-1 rounded-full bg-emerald-600" />{readableStatus(order.dispatchStatus)}</span>
               </div>
               <p className="mt-1 truncate text-xs font-semibold">{order.clientName}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{order.locationName}</p>
               <p className="mt-2 text-[9px] text-muted-foreground">Order stage · <span className="font-semibold capitalize text-foreground/75">{readableStatus(order.orderStatus)}</span><span className="px-1.5">·</span>Updated {formatUpdatedAt(order.updatedAt)}</p>
            </div>
            <div className="space-y-1.5">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset ${statusTone(order.installationStatus)}`} data-testid={`status-installation-${order.id}`}>{statusLabels[order.installationStatus]}</span>
              <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><CalendarDays size={12} />{order.installationStatus === 'issue' ? 'Issue date' : 'Installation date'} · {formatDate(order.installationDate)}</p>
            </div>
            {order.installationStatus === 'issue' ? <p className="rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-[11px] leading-5 text-amber-950" data-testid={`text-installation-issue-${order.id}`}>{order.issueReason}</p> : <p className="text-[11px] leading-5 text-muted-foreground">{order.installationStatus === 'installed' ? 'Installation completion recorded.' : 'Ready for installation scheduling and completion.'}</p>}
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              {canEdit && <Button type="button" size="sm" className="h-9 text-[11px]" onClick={() => setActiveOrder(order)} disabled={update.isPending} data-testid={`button-update-installation-${order.id}`}>{order.installationStatus === 'installed' ? 'Edit date' : 'Record result'}<ArrowRight size={13} /></Button>}
              {order.installationStatus === 'installed' && canViewOrders && <Link href={`/order-hub/${encodeURIComponent(order.id)}?tab=grievances`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[11px] font-semibold transition hover:border-primary/35 hover:text-primary" data-testid={`link-installation-grievance-${order.id}`}><MessageSquareText size={13} /> Add grievance</Link>}
            </div>
          </article>)}
        </CardContent>
      </Card>
      <p className="px-1 text-[10px] text-muted-foreground">Installation issues are recorded here. Customer grievances after installation stay in the order’s dedicated Grievances tab.</p>
    </div>
    <InstallationDialog order={activeOrder} canEdit={canEdit} pending={update.isPending} onClose={() => { setActiveOrder(null); update.reset(); }} onSave={saveUpdate} />
  </AppShell>;
}