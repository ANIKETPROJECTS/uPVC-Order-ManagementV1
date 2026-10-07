import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  Edit3,
  FileText,
  MapPin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import {
  getListClientsQueryKey,
  getListOrderLocationsQueryKey,
  getListOrdersQueryKey,
  getListOrderMessageTemplatesQueryKey,
  getListQuotationsQueryKey,
  OrderStatus,
  useCreateClient,
  useCreateOrder,
  useCreateOrderLocation,
  useDeleteOrder,
  useListClients,
  useListOrderLocations,
  useListOrders,
  useListOrderMessageTemplates,
  useListQuotations,
  useUpdateClient,
  useUpdateOrder,
  useUpdateOrderMessageTemplate,
  useUpdateOrderLocation,
} from '@workspace/api-client-react';
import type { Client, Order, OrderLocation, OrderMessageTemplate, Quotation, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

type Status = (typeof OrderStatus)[keyof typeof OrderStatus];

const STATUS_OPTIONS: { value: Status; label: string; tone: string }[] = [
  { value: OrderStatus.quotation_stage, label: 'Quotation stage', tone: 'bg-slate-100 text-slate-700' },
  { value: OrderStatus.confirmed, label: 'Confirmed', tone: 'bg-cyan-100 text-cyan-800' },
  { value: OrderStatus.in_production, label: 'In production', tone: 'bg-amber-100 text-amber-800' },
  { value: OrderStatus.ready, label: 'Ready', tone: 'bg-lime-100 text-lime-800' },
  { value: OrderStatus.dispatched, label: 'Dispatched', tone: 'bg-orange-100 text-orange-800' },
  { value: OrderStatus.installed, label: 'Installed', tone: 'bg-emerald-100 text-emerald-800' },
];

const statusLabel = (status: string) => STATUS_OPTIONS.find((item) => item.value === status)?.label || status.replaceAll('_', ' ');
const statusTone = (status: string) => STATUS_OPTIONS.find((item) => item.value === status)?.tone || 'bg-muted text-muted-foreground';
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
const shortDate = (value: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(value));

function OrderRowActions({
  order,
  canEdit,
  pending,
  onArchive,
  onRestore,
}: {
  order: Order;
  canEdit: boolean;
  pending: boolean;
  onArchive: (order: Order) => void;
  onRestore: (order: Order) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Link
        href={`/order-hub/${order.id}`}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-bold text-primary hover:bg-primary/10"
        data-testid={`button-open-order-${order.id}`}
      >
        View <ArrowRight size={13} />
      </Link>
      {canEdit && (
        <>
          {order.isActive && (
            <Link
              href={`/order-hub/${order.id}?edit=true`}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-bold text-foreground hover:bg-muted"
              data-testid={`button-edit-order-${order.id}`}
            >
              <Edit3 size={12} /> Edit
            </Link>
          )}
          {order.isActive ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => onArchive(order)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-bold text-destructive hover:bg-destructive/10 disabled:opacity-50"
              aria-label={`Delete ${order.orderId}`}
              data-testid={`button-delete-order-${order.id}`}
            >
              <Trash2 size={12} /> Delete
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => onRestore(order)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-bold text-primary hover:bg-primary/10 disabled:opacity-50"
              aria-label={`Restore ${order.orderId}`}
              data-testid={`button-restore-order-${order.id}`}
            >
              <RotateCcw size={12} /> Restore
            </button>
          )}
        </>
      )}
    </div>
  );
}

const orderIdPreview = (type: Client['type'], quoteNo: string | undefined) => {
  if (!type || !quoteNo) return null;
  const match = /^QT-(\d+)$/i.exec(quoteNo.trim());
  if (!match) return null;
  return `${type === 'Project' ? 'P' : 'R'}${match[1].replace(/^0+/, '') || '0'}`;
};

const clientSchema = z.object({
  type: z.enum(['Project', 'Retail'], { required_error: 'Choose Project or Retail.' }),
  name: z.string().min(2, 'Enter the client or company name.'),
  phone: z.string().min(7, 'Enter a valid phone number.'),
  address: z.string().min(3, 'Add a delivery or billing address.'),
  gstin: z.string().max(15, 'GSTIN can be 15 characters.').optional(),
  prefix: z.string().min(1).max(8).regex(/^[A-Za-z0-9]+$/, 'Use letters and numbers only.'),
});
const locationSchema = z.object({
  code: z.string().min(2).max(5).regex(/^[A-Za-z0-9]+$/, 'Use letters and numbers only.'),
  name: z.string().min(2, 'Enter a location name.'),
});
const orderSchema = z.object({
  clientId: z.string().min(1, 'Select a client.'),
  quotationId: z.string().min(1, 'Select a quotation before creating the order.'),
  locationCode: z.string().min(2, 'Select a location.'),
  notes: z.string().max(2000).optional(),
});
const templateSchema = z.object({ template: z.string().min(10, 'Message template is too short.') });

function StatePanel({ type, onRetry }: { type: 'loading' | 'error' | 'empty'; onRetry?: () => void }) {
  if (type === 'loading') return <div className="space-y-3" data-testid="state-orders-loading"><div className="h-12 animate-pulse rounded-xl bg-muted/70" /><div className="h-12 animate-pulse rounded-xl bg-muted/60" /><div className="h-12 animate-pulse rounded-xl bg-muted/50" /></div>;
  if (type === 'empty') return <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center" data-testid="state-orders-empty"><div><div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary"><ClipboardList size={19} /></div><h3 className="mt-3 font-display text-sm font-bold">No orders match this view</h3><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Try a different search or clear one of the filters.</p></div></div>;
  return <div className="grid min-h-56 place-items-center rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center" data-testid="state-orders-error"><div><CircleAlert className="mx-auto text-destructive" size={23} /><h3 className="mt-3 font-display text-sm font-bold">Order register unavailable</h3><p className="mt-1 text-xs text-muted-foreground">The latest records could not be loaded.</p><Button onClick={onRetry} size="sm" variant="outline" className="mt-4" data-testid="button-retry-orders"><RefreshCw size={13} /> Retry</Button></div></div>;
}

function SectionHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: React.ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{eyebrow}</p><h2 className="mt-1 font-display text-lg font-bold tracking-tight">{title}</h2>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>{action}</div>;
}

function ClientDialog({ open, onOpenChange, editing, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; editing: Client | null; onDone: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateClient();
  const update = useUpdateClient();
  const form = useForm<z.infer<typeof clientSchema>>({ resolver: zodResolver(clientSchema), defaultValues: { type: undefined, name: '', phone: '', address: '', gstin: '', prefix: '' } });
  const busy = create.isPending || update.isPending;

  useEffect(() => {
    if (open) form.reset(editing ? { type: editing.type === 'Project' || editing.type === 'Retail' ? editing.type : undefined, name: editing.name, phone: editing.phone, address: editing.address, gstin: editing.gstin || '', prefix: editing.prefix } : { type: undefined, name: '', phone: '', address: '', gstin: '', prefix: '' });
  }, [open, editing, form]);

  const submit = (values: z.infer<typeof clientSchema>) => {
    const data = { ...values, gstin: values.gstin || null };
    if (editing) {
      update.mutate({ clientId: editing.id, data }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }); toast({ title: 'Client record updated', description: `${values.name} is ready for new orders.` }); onDone(); } });
    } else {
      create.mutate({ data }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }); toast({ title: 'Client added', description: `${values.prefix} prefix is now reserved.` }); onDone(); } });
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit client record' : 'Add a client'}</DialogTitle>
          <DialogDescription>Choose a client type before creating orders. Existing unset types must be selected manually.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4" data-testid="form-client">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Client / company name</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. Meridian Habitat" data-testid="input-client-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input {...field} placeholder="+91 98…" data-testid="input-client-phone" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="prefix" render={({ field }) => (
                <FormItem>
                  <FormLabel>Unique order prefix</FormLabel>
                  <FormControl><Input {...field} maxLength={8} placeholder="MHAB" data-testid="input-client-prefix" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Client type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ''}>
                    <FormControl><SelectTrigger data-testid="select-client-type"><SelectValue placeholder="Choose Project or Retail" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="Project">Project</SelectItem>
                      <SelectItem value="Retail">Retail</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="address" render={({ field }) => (
              <FormItem>
                <FormLabel>Address</FormLabel>
                <FormControl><Textarea {...field} rows={3} placeholder="Site or billing address" data-testid="input-client-address" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="gstin" render={({ field }) => (
              <FormItem>
                <FormLabel>GSTIN <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
                <FormControl><Input {...field} value={field.value || ''} maxLength={15} data-testid="input-client-gstin" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel-client">Cancel</Button>
              <Button type="submit" disabled={busy} data-testid="button-save-client">{busy ? 'Saving…' : editing ? 'Save changes' : 'Add client'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function LocationDialog({ open, onOpenChange, editing, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; editing: OrderLocation | null; onDone: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateOrderLocation();
  const update = useUpdateOrderLocation();
  const form = useForm<z.infer<typeof locationSchema>>({ resolver: zodResolver(locationSchema), defaultValues: { code: '', name: '' } });
  const busy = create.isPending || update.isPending;
  useMemo(() => { if (open) form.reset(editing ? { code: editing.code, name: editing.name } : { code: '', name: '' }); }, [open, editing, form]);
  const submit = (values: z.infer<typeof locationSchema>) => {
    if (editing) update.mutate({ locationId: editing.id, data: values }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListOrderLocationsQueryKey() }); toast({ title: 'Location updated' }); onDone(); } });
    else create.mutate({ data: values }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListOrderLocationsQueryKey() }); toast({ title: 'Location added' }); onDone(); } });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editing ? 'Edit location code' : 'Add location code'}</DialogTitle><DialogDescription>Location codes make order IDs traceable to the operating branch or site.</DialogDescription></DialogHeader><Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-4" data-testid="form-location"><div className="grid gap-4 sm:grid-cols-[130px_1fr]"><FormField control={form.control} name="code" render={({ field }) => <FormItem><FormLabel>Code</FormLabel><FormControl><Input {...field} maxLength={5} placeholder="BLR" data-testid="input-location-code" /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Location name</FormLabel><FormControl><Input {...field} placeholder="Bengaluru" data-testid="input-location-name" /></FormControl><FormMessage /></FormItem>} /></div><DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel-location">Cancel</Button><Button type="submit" disabled={busy} data-testid="button-save-location">{busy ? 'Saving…' : editing ? 'Save changes' : 'Add location'}</Button></DialogFooter></form></Form></DialogContent></Dialog>;
}

function NewOrderDialog({ open, onOpenChange, clients, locations, onDone, onEditClient }: { open: boolean; onOpenChange: (open: boolean) => void; clients: Client[]; locations: OrderLocation[]; onDone: () => void; onEditClient: (client: Client) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateOrder();
  const quotationsQuery = useListQuotations({
    query: { queryKey: getListQuotationsQueryKey(), enabled: open },
  });
  const form = useForm<z.infer<typeof orderSchema>>({
    resolver: zodResolver(orderSchema),
    defaultValues: { clientId: '', quotationId: '', locationCode: '', notes: '' },
  });
  const selectedClient = clients.find((client) => client.id === form.watch('clientId'));
  const clientQuotations = (quotationsQuery.data ?? []).filter((quotation: Quotation) =>
    quotation.clientId === selectedClient?.id &&
    !quotation.sampleOnly &&
    /^QT-\d+$/i.test(quotation.quoteNo.trim()),
  );
  const selectedQuotation = clientQuotations.find((quotation) => quotation.id === form.watch('quotationId'));
  const previewId = orderIdPreview(selectedClient?.type ?? null, selectedQuotation?.quoteNo);
  const canCreate =
    Boolean(selectedClient?.type && selectedQuotation && form.watch('locationCode')) &&
    !create.isPending;

  useEffect(() => {
    if (open) form.reset({ clientId: '', quotationId: '', locationCode: '', notes: '' });
  }, [open, form]);

  const submit = (values: z.infer<typeof orderSchema>) => {
    if (!selectedClient?.type) {
      toast({ title: 'Client type required', description: 'Choose Project or Retail on the client record before creating an order.', variant: 'destructive' });
      return;
    }
    if (!values.quotationId) {
      toast({ title: 'Quotation required', description: 'Select a quotation before saving this order.', variant: 'destructive' });
      return;
    }
    create.mutate(
      { data: { ...values, notes: values.notes || null } },
      {
        onSuccess: (order) => {
          void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          toast({ title: 'Order created', description: order.orderId });
          onDone();
        },
        onError: (error) => toast({
          title: 'Order could not be created',
          description: error instanceof Error ? error.message : 'Check the client type and linked quotation.',
          variant: 'destructive',
        }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create central order</DialogTitle>
          <DialogDescription>Link a quotation. The server generates and stores the order ID from its quotation number.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4" data-testid="form-order">
            <FormField control={form.control} name="clientId" render={({ field }) => (
              <FormItem>
                <FormLabel>Client</FormLabel>
                <Select
                  onValueChange={(value) => {
                    field.onChange(value);
                    form.setValue('quotationId', '', { shouldValidate: true });
                  }}
                  value={field.value}
                >
                  <FormControl><SelectTrigger data-testid="select-order-client"><SelectValue placeholder="Choose a client" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {clients.filter((client) => client.isActive).map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name} · {client.prefix} · {client.type ?? 'Type not set'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {selectedClient && !selectedClient.type && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-xs text-amber-900" role="status" data-testid="notice-order-client-type">
                <p><strong>Type not set.</strong> Choose Project or Retail before creating an order.</p>
                <Button type="button" size="sm" variant="outline" onClick={() => onEditClient(selectedClient)} data-testid="button-set-client-type">
                  Set client type
                </Button>
              </div>
            )}

            <FormField control={form.control} name="quotationId" render={({ field }) => (
              <FormItem>
                <FormLabel>Linked quotation</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled={!selectedClient || quotationsQuery.isLoading || clientQuotations.length === 0}
                >
                  <FormControl><SelectTrigger data-testid="select-order-quotation"><SelectValue placeholder="Choose a quotation" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {clientQuotations.map((quotation) => (
                      <SelectItem key={quotation.id} value={quotation.id}>
                        {quotation.quoteNo} · {quotation.projectName || quotation.customerName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {selectedClient && quotationsQuery.isLoading && (
              <p className="text-xs text-muted-foreground" role="status">Loading this client’s quotations…</p>
            )}
            {selectedClient && quotationsQuery.isError && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs" role="alert">
                <span>Quotations could not be loaded. Try again before creating the order.</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void quotationsQuery.refetch()}>Retry</Button>
              </div>
            )}
            {selectedClient && !quotationsQuery.isLoading && !quotationsQuery.isError && clientQuotations.length === 0 && (
              <p className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-xs text-amber-900" role="status" data-testid="notice-order-no-quotation">
                No usable QT-numbered quotation is linked to this client. Select or create a quotation before saving an order.
              </p>
            )}
            {previewId && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs" data-testid="text-order-id-preview">
                <p className="font-semibold text-primary">Order ID preview · <span className="font-mono">{previewId}</span></p>
                <p className="mt-1 text-muted-foreground">
                  {selectedClient?.type === 'Project'
                    ? `A Project order starts with lot ${previewId}-L01.`
                    : 'A Retail order starts without a lot; lots can be added later.'}
                </p>
              </div>
            )}

            <FormField control={form.control} name="locationCode" render={({ field }) => (
              <FormItem>
                <FormLabel>Order location</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-order-location"><SelectValue placeholder="Choose a location" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {locations.filter((location) => location.isActive).map((location) => (
                      <SelectItem key={location.code} value={location.code}>{location.code} · {location.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Initial notes <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
                <FormControl><Textarea {...field} rows={3} placeholder="Context the office team should see first" data-testid="input-order-notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel-order">Cancel</Button>
              <Button type="submit" disabled={!canCreate} data-testid="button-save-order">{create.isPending ? 'Creating…' : 'Create order'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function TemplateEditor({ templates, canEdit, loading, error, onRetry }: { templates: OrderMessageTemplate[]; canEdit: boolean; loading: boolean; error: boolean; onRetry: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdateOrderMessageTemplate();
  const [selected, setSelected] = useState<Status | null>(null);
  const template = templates.find((item) => item.status === selected) || templates[0];
  const form = useForm<z.infer<typeof templateSchema>>({ resolver: zodResolver(templateSchema), defaultValues: { template: '' } });
  useMemo(() => { if (template) form.reset({ template: template.template }); }, [template, form]);
  if (loading) return <Card className="border-border/80" data-testid="state-templates-loading"><CardContent className="space-y-3 p-6"><div className="h-4 w-44 animate-pulse rounded bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted/70" /></CardContent></Card>;
  if (error) return <Card className="border-destructive/20 bg-destructive/5" data-testid="state-templates-error"><CardContent className="flex items-center justify-between gap-4 p-6"><div><p className="text-sm font-bold">Templates unavailable</p><p className="mt-1 text-xs text-muted-foreground">Shared lifecycle copy could not be loaded.</p></div><Button onClick={onRetry} size="sm" variant="outline" data-testid="button-retry-templates"><RefreshCw size={13} /> Retry</Button></CardContent></Card>;
  if (!templates.length) return <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground" data-testid="state-templates-empty">No lifecycle templates have been configured.</div>;
  const active = template || templates[0];
  const save = (values: z.infer<typeof templateSchema>) => update.mutate({ status: active.status, data: values }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListOrderMessageTemplatesQueryKey() }); toast({ title: 'Template saved', description: `${active.label} now uses the updated message.` }); } });
  return <Card className="border-border/80"><CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Master Admin control</p><CardTitle className="mt-1 text-base">Lifecycle message templates</CardTitle><p className="mt-1 text-xs text-muted-foreground">Shared copy used in each order's stage preview. Variables are replaced when an order is open.</p></div><div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[10px] font-bold text-primary"><ShieldCheck size={13} /> Shared record</div></div></CardHeader><CardContent><div className="grid gap-4 lg:grid-cols-[220px_1fr]"><div className="space-y-1" role="tablist" aria-label="Lifecycle stages">{templates.map((item) => <button type="button" key={item.status} onClick={() => setSelected(item.status)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs transition-colors ${item.status === active.status ? 'bg-sidebar text-sidebar-foreground' : 'hover:bg-muted'}`} data-testid={`button-template-stage-${item.status}`}><span>{item.label}</span><ChevronDown size={13} className="-rotate-90 opacity-50" /></button>)}</div><Form {...form}><form onSubmit={form.handleSubmit(save)} className="space-y-3" data-testid="form-template"><FormField control={form.control} name="template" render={({ field }) => <FormItem><FormLabel>{active.label} message</FormLabel><FormControl><Textarea {...field} rows={6} readOnly={!canEdit} className="resize-y font-mono text-xs leading-5" data-testid={`input-template-${active.status}`} /></FormControl><FormMessage /></FormItem>} /><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[10px] leading-4 text-muted-foreground"><span className="font-semibold text-foreground">Variables:</span> {'{{clientName}}'} · {'{{orderId}}'} · {'{{locationName}}'} · {'{{status}}'}</p>{canEdit && <Button type="submit" size="sm" disabled={update.isPending} data-testid="button-save-template">{update.isPending ? 'Saving…' : 'Save shared template'}</Button>}</div></form></Form></div></CardContent></Card>;
}

export default function OrderHubPage({ user }: { user: User }) {
  const canEdit = user.roleId === 'master-admin' || user.permissions?.['order-hub'] === 'edit';
  const isMasterAdmin = user.roleId === 'master-admin';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
  const [status, setStatus] = useState<string>(() => new URLSearchParams(window.location.search).get('status') || 'all');
  const [clientId, setClientId] = useState(() => new URLSearchParams(window.location.search).get('clientId') || 'all');
  const [locationCode, setLocationCode] = useState(() => new URLSearchParams(window.location.search).get('locationCode') || 'all');
  const [from, setFrom] = useState(() => new URLSearchParams(window.location.search).get('from') || '');
  const [to, setTo] = useState(() => new URLSearchParams(window.location.search).get('to') || '');
  const [clientOpen, setClientOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editingLocation, setEditingLocation] = useState<OrderLocation | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const clientParams = useMemo(() => ({ includeInactive: showInactive, q: undefined }), [showInactive]);
  const orderParams = useMemo(() => ({ q: search || undefined, status: status === 'all' ? undefined : status as Status, clientId: clientId === 'all' ? undefined : clientId, locationCode: locationCode === 'all' ? undefined : locationCode, from: from || undefined, to: to || undefined, includeInactive: showInactive }), [search, status, clientId, locationCode, from, to, showInactive]);
  const clients = useListClients(clientParams, { query: { queryKey: getListClientsQueryKey(clientParams) } });
  const locations = useListOrderLocations({ includeInactive: showInactive }, { query: { queryKey: getListOrderLocationsQueryKey({ includeInactive: showInactive }) } });
  const orders = useListOrders(orderParams, { query: { queryKey: getListOrdersQueryKey(orderParams) } });
  const templates = useListOrderMessageTemplates({ query: { queryKey: getListOrderMessageTemplatesQueryKey() } });
  const updateClient = useUpdateClient();
  const updateLocation = useUpdateOrderLocation();
  const deleteOrder = useDeleteOrder();
  const updateOrder = useUpdateOrder();
  const orderActionsPending = deleteOrder.isPending || updateOrder.isPending;
  const clientList = clients.data || [];
  const locationList = locations.data || [];
  const orderList = orders.data || [];

  const deactivateClient = (client: Client) => {
    if (!window.confirm(`Deactivate ${client.name}? Existing order history will remain intact.`)) return;
    updateClient.mutate({ clientId: client.id, data: { isActive: false } }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }); toast({ title: 'Client deactivated' }); } });
  };
  const deactivateLocation = (location: OrderLocation) => {
    if (!window.confirm(`Deactivate ${location.code} · ${location.name}?`)) return;
    updateLocation.mutate({ locationId: location.id, data: { isActive: false } }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListOrderLocationsQueryKey() }); toast({ title: 'Location deactivated' }); } });
  };
  const archiveOrder = (order: Order) => {
    if (!window.confirm(`Delete ${order.orderId} from the active register? Its linked payment, production, installation, and document history will be kept. You can restore it with “Include inactive”.`)) return;
    deleteOrder.mutate({ id: order.id }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        toast({ title: 'Order deleted', description: 'It was removed from the active register. Linked history is preserved.' });
      },
      onError: () => toast({ title: 'Order could not be deleted', description: 'Please try again.' }),
    });
  };
  const restoreOrder = (order: Order) => {
    updateOrder.mutate({ id: order.id, data: { isActive: true } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        toast({ title: 'Order restored', description: `${order.orderId} is back in the active register.` });
      },
      onError: () => toast({ title: 'Order could not be restored', description: 'Please try again.' }),
    });
  };
  const clearFilters = () => { setSearch(''); setStatus('all'); setClientId('all'); setLocationCode('all'); setFrom(''); setTo(''); };

  return <AppShell user={user} title="Order hub" eyebrow="Module 2 · central register"><div className="space-y-6">
    <section className="order-hub-accent animate-enter-up relative overflow-hidden rounded-2xl p-6 text-white shadow-sm md:p-8"><div className="absolute right-9 top-7 h-24 w-24 rounded-full border border-sidebar-primary/20" /><div className="absolute right-16 top-14 h-10 w-10 rounded-full border border-accent/30" /><div className="relative max-w-3xl"><div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-primary"><span>Framewise workbench</span><span className="h-1 w-1 rounded-full bg-accent" /><span>Traceable records</span></div><h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-[-0.045em] md:text-4xl">One register for every client, location, and order.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">Create a reliable central order ID before specialist workflows begin. Every status change and note stays anchored to the same client record.</p><div className="mt-6 flex flex-wrap gap-2"><div className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs"><ClipboardList size={14} className="text-sidebar-primary" /> {orderList.length} visible orders</div><div className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs"><UsersRound size={14} className="text-sidebar-primary" /> {clientList.filter((item) => item.isActive).length} active clients</div><div className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs"><MapPin size={14} className="text-sidebar-primary" /> {locationList.filter((item) => item.isActive).length} locations</div></div></div></section>

    <section className="grid gap-4 sm:grid-cols-3"><Card className="animate-enter-up delay-1 border-border/80"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Order register</p><ClipboardList size={16} className="text-primary" /></div><p className="mt-3 font-display text-3xl font-bold" data-testid="metric-orders-visible">{orderList.length}</p><p className="mt-1 text-xs text-muted-foreground">matching current filters</p></CardContent></Card><Card className="animate-enter-up delay-2 border-border/80"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">In production</p><Settings2 size={16} className="text-accent-foreground" /></div><p className="mt-3 font-display text-3xl font-bold" data-testid="metric-orders-production">{orderList.filter((item) => item.status === OrderStatus.in_production).length}</p><p className="mt-1 text-xs text-muted-foreground">active factory handoffs</p></CardContent></Card><Card className="animate-enter-up delay-3 border-border/80"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Installed</p><Check size={17} className="text-primary" /></div><p className="mt-3 font-display text-3xl font-bold" data-testid="metric-orders-installed">{orderList.filter((item) => item.status === OrderStatus.installed).length}</p><p className="mt-1 text-xs text-muted-foreground">closed lifecycle records</p></CardContent></Card></section>

    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          eyebrow="Central register"
          title="Orders"
          detail="Search by order ID, lot ID, client, phone, or address."
          action={canEdit ? <Button onClick={() => setOrderOpen(true)} data-testid="button-create-order"><Plus size={15} /> Create order</Button> : undefined}
        />
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><span className="h-2 w-2 rounded-full bg-primary" /> Live query</div>
      </div>
      <div className="mt-5 grid gap-2 md:grid-cols-[minmax(220px,1.4fr)_repeat(2,minmax(150px,0.7fr))]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order register" className="pl-9" data-testid="input-search-orders" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger data-testid="select-filter-status"><SelectValue placeholder="Any status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Any status</SelectItem>{STATUS_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={locationCode} onValueChange={setLocationCode}>
          <SelectTrigger data-testid="select-filter-location"><SelectValue placeholder="Any location" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Any location</SelectItem>{locationList.filter((item) => item.isActive).map((item) => <SelectItem key={item.code} value={item.code}>{item.code} · {item.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger data-testid="select-filter-client"><SelectValue placeholder="Any client" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Any client</SelectItem>{clientList.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" data-testid="input-filter-from" />
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" data-testid="input-filter-to" />
        </div>
        <Button variant="ghost" onClick={clearFilters} className="text-xs" data-testid="button-clear-order-filters"><X size={14} /> Clear</Button>
        <label className="flex min-h-9 items-center justify-center gap-2 rounded-md border border-border px-3 py-1 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} className="accent-primary" data-testid="checkbox-show-inactive" />
          Include inactive
        </label>
      </div>
      <div className="mt-5 overflow-hidden rounded-xl border border-border/80">
        {orders.isLoading ? (
          <div className="p-4"><StatePanel type="loading" /></div>
        ) : orders.isError ? (
          <div className="p-4"><StatePanel type="error" onRetry={() => void orders.refetch()} /></div>
        ) : orderList.length === 0 ? (
          <div className="p-4"><StatePanel type="empty" /></div>
        ) : (
          <>
            <div className="divide-y divide-border/70 md:hidden">
              {orderList.map((order) => (
                <article key={order.id} className="space-y-3 p-4 transition-colors hover:bg-primary/[0.025]" data-testid={`card-order-${order.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-[11px] font-bold text-primary">{order.orderId}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!order.isActive && <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold text-muted-foreground">Inactive</span>}
                        {order.needsReview && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-900" data-testid={`badge-order-review-${order.id}`}>Needs review</span>}
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold">{order.clientName}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${statusTone(order.status)}`} data-testid={`status-order-mobile-${order.id}`}>{statusLabel(order.status)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-[10px]">
                    <div><p className="uppercase tracking-wider text-muted-foreground">Location</p><p className="mt-1 font-mono font-bold">{order.locationCode} <span className="font-sans font-normal text-muted-foreground">{order.locationName}</span></p></div>
                    <div><p className="uppercase tracking-wider text-muted-foreground">Created</p><p className="mt-1 font-medium">{shortDate(order.createdAt)}</p></div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2">
                    <span className="text-[10px] text-muted-foreground">{order.clientPhone || 'No phone recorded'}</span>
                    <OrderRowActions order={order} canEdit={canEdit} pending={orderActionsPending} onArchive={archiveOrder} onRestore={restoreOrder} />
                  </div>
                </article>
              ))}
            </div>
            <table className="hidden w-full min-w-[900px] text-left text-xs md:table">
              <thead className="border-b border-border bg-muted/35 text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-bold">Order</th>
                  <th className="px-4 py-3 font-bold">Client</th>
                  <th className="px-4 py-3 font-bold">Location</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 font-bold">Created</th>
                  <th className="px-4 py-3 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {orderList.map((order) => (
                  <tr key={order.id} className="group hover:bg-primary/[0.025]" data-testid={`row-order-${order.id}`}>
                    <td className="px-4 py-3.5">
                      <Link href={`/order-hub/${order.id}`} className="font-mono text-[11px] font-bold text-primary hover:underline" data-testid={`link-order-${order.id}`}>{order.orderId}</Link>
                      <p className="mt-1 text-[10px] text-muted-foreground">Sequence {String(order.sequenceNo).padStart(3, '0')}</p>
                      {!order.isActive && <span className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold text-muted-foreground">Inactive</span>}
                      {order.needsReview && <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-900" data-testid={`badge-order-review-${order.id}`}>Needs review</span>}
                    </td>
                    <td className="px-4 py-3.5"><p className="font-semibold">{order.clientName}</p><p className="mt-1 text-[10px] text-muted-foreground">{order.clientPrefix}{order.clientPhone ? ` · ${order.clientPhone}` : ''}</p></td>
                    <td className="px-4 py-3.5"><span className="font-mono text-[11px] font-bold">{order.locationCode}</span><p className="mt-1 text-[10px] text-muted-foreground">{order.locationName}</p></td>
                    <td className="px-4 py-3.5"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusTone(order.status)}`} data-testid={`status-order-${order.id}`}>{statusLabel(order.status)}</span></td>
                    <td className="px-4 py-3.5 text-muted-foreground">{shortDate(order.createdAt)}<p className="mt-1 text-[10px]">{order.createdBy}</p></td>
                    <td className="px-4 py-3.5"><OrderRowActions order={order} canEdit={canEdit} pending={orderActionsPending} onArchive={archiveOrder} onRestore={restoreOrder} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>

    <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
      <Card>
        <CardHeader className="pb-3">
          <SectionHeading
            eyebrow="Directory"
            title="Client records"
            detail="Prefixes are unique and stay attached to order history."
            action={canEdit ? <Button size="sm" variant="outline" onClick={() => { setEditingClient(null); setClientOpen(true); }} data-testid="button-add-client"><Plus size={14} /> Add client</Button> : undefined}
          />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {clients.isLoading ? (
              <StatePanel type="loading" />
            ) : clients.isError ? (
              <StatePanel type="error" onRetry={() => void clients.refetch()} />
            ) : clientList.length === 0 ? (
              <StatePanel type="empty" />
            ) : (
              clientList.map((client) => (
                <div
                  key={client.id}
                  className={`flex min-w-0 flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:gap-3 ${client.isActive ? 'border-border/75 bg-background' : 'border-dashed border-border bg-muted/20 opacity-65'}`}
                  data-testid={`row-client-${client.id}`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                      <UserRound size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="min-w-0 break-words text-xs font-bold" data-testid={`text-client-${client.id}`}>
                          {client.name}
                        </p>
                        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                          {client.prefix}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${client.type ? 'bg-secondary text-secondary-foreground' : 'bg-amber-100 text-amber-900'}`}
                          data-testid={`badge-client-type-${client.id}`}
                        >
                          {client.type || 'Type not set'}
                        </span>
                        {!client.isActive && <span className="text-[10px] font-bold text-muted-foreground">Inactive</span>}
                      </div>
                      <div className="mt-1 grid gap-0.5 sm:hidden">
                        <p className="break-words text-[10px] leading-4 text-muted-foreground">
                          {client.phone || 'No phone recorded'}
                        </p>
                        <p className="break-words text-[10px] leading-4 text-muted-foreground">
                          {client.address || 'No address recorded'}
                        </p>
                      </div>
                      <p className="mt-1 hidden truncate text-[10px] text-muted-foreground sm:block">
                        {client.phone} · {client.address}
                      </p>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center justify-end gap-1 self-end sm:self-auto">
                      <button
                        type="button"
                        onClick={() => { setEditingClient(client); setClientOpen(true); }}
                        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Edit ${client.name}`}
                        data-testid={`button-edit-client-${client.id}`}
                      >
                        <Edit3 size={14} />
                      </button>
                      {client.isActive && (
                        <button
                          type="button"
                          onClick={() => deactivateClient(client)}
                          className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Deactivate ${client.name}`}
                          data-testid={`button-deactivate-client-${client.id}`}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <SectionHeading
            eyebrow="Operating map"
            title="Location codes"
            detail="Keep the branch vocabulary short and unambiguous."
            action={canEdit ? <Button size="sm" variant="outline" onClick={() => { setEditingLocation(null); setLocationOpen(true); }} data-testid="button-add-location"><Plus size={14} /> Add location</Button> : undefined}
          />
        </CardHeader>
        <CardContent>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            {locations.isLoading ? (
              <div className="sm:col-span-2"><StatePanel type="loading" /></div>
            ) : locations.isError ? (
              <div className="sm:col-span-2"><StatePanel type="error" onRetry={() => void locations.refetch()} /></div>
            ) : locationList.length === 0 ? (
              <div className="sm:col-span-2"><StatePanel type="empty" /></div>
            ) : (
              locationList.map((location) => (
                <div
                  key={location.id}
                  className={`group min-w-0 rounded-xl border p-3 ${location.isActive ? 'border-border/75' : 'border-dashed border-border bg-muted/20 opacity-65'}`}
                  data-testid={`row-location-${location.id}`}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/25 text-accent-foreground">
                        <MapPin size={15} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-bold">{location.code}</p>
                        <p className="break-words text-[10px] text-muted-foreground">{location.name}</p>
                      </div>
                    </div>
                    {!location.isActive && (
                      <span className="shrink-0 text-[10px] font-bold text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </div>
                  {canEdit && (
                    <div className="hover-reveal-actions mt-3 flex min-h-7 items-center gap-3 border-t border-border/60 pt-2">
                      <button
                        type="button"
                        onClick={() => { setEditingLocation(location); setLocationOpen(true); }}
                        className="text-[10px] font-bold text-primary"
                        data-testid={`button-edit-location-${location.id}`}
                      >
                        Edit
                      </button>
                      {location.isActive && (
                        <button
                          type="button"
                          onClick={() => deactivateLocation(location)}
                          className="text-[10px] font-bold text-destructive"
                          data-testid={`button-deactivate-location-${location.id}`}
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </section>

    {isMasterAdmin && <TemplateEditor templates={templates.data || []} canEdit={isMasterAdmin} loading={templates.isLoading} error={templates.isError} onRetry={() => void templates.refetch()} />}
    <ClientDialog open={clientOpen} onOpenChange={setClientOpen} editing={editingClient} onDone={() => { setClientOpen(false); setEditingClient(null); }} />
    <LocationDialog open={locationOpen} onOpenChange={setLocationOpen} editing={editingLocation} onDone={() => { setLocationOpen(false); setEditingLocation(null); }} />
    <NewOrderDialog open={orderOpen} onOpenChange={setOrderOpen} clients={clientList} locations={locationList} onDone={() => setOrderOpen(false)} onEditClient={(client) => { setEditingClient(client); setOrderOpen(false); setClientOpen(true); }} />
  </div></AppShell>;
}