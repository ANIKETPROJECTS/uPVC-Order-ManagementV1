import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowRight,
  Check,
  CircleAlert,
  ClipboardList,
  Edit3,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import {
  getListClientsQueryKey,
  getListOrdersQueryKey,
  getGetDispatchSummaryQueryKey,
  getListQuotationsQueryKey,
  OrderStatus,
  useCreateOrder,
  useDeleteOrder,
  useListClients,
  useListOrders,
  useGetDispatchSummary,
  useListQuotations,
  useUpdateOrder,
} from '@workspace/api-client-react';
import type { Client, Order, Quotation, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { SiteLocation } from '@/components/site-location';
import { SiteMapPicker } from '@/components/site-map-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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
const quotationOptionLabel = (quotation: Quotation) =>
  `${quotation.quoteNo} · ${quotation.customerName}${quotation.projectName && quotation.projectName !== quotation.customerName ? ` — ${quotation.projectName}` : ''}`;
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
              href={`/order-hub/${order.id}?edit=true#order-record-card`}
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

const orderSchema = z.object({
  clientMode: z.enum(['existing', 'manual']),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  clientType: z.enum(['Project', 'Retail']).optional(),
  clientPhone: z.string().max(30).optional(),
  clientAddress: z.string().max(500).optional(),
  clientGstin: z.string().max(15).optional(),
  quotationId: z.string().optional(),
  locationName: z.string().trim().min(2, 'Enter a city or location name.').max(120),
  siteAddress: z.string().trim().min(3, 'Enter the order’s site address.').max(500, 'Keep the address under 500 characters.'),
  sameAsClientAddress: z.boolean(),
  siteLatitude: z.number().min(-90).max(90).nullable(),
  siteLongitude: z.number().min(-180).max(180).nullable(),
  notes: z.string().max(2000).optional(),
}).superRefine((values, context) => {
  if (values.clientMode === 'existing' && !values.clientId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Select a client.', path: ['clientId'] });
  }
  if (values.clientMode === 'manual' && (values.clientName?.trim().length ?? 0) < 2) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter the client or company name.', path: ['clientName'] });
  }
  if (values.clientMode === 'manual' && !values.clientType) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose Project or Retail.', path: ['clientType'] });
  }
});

function StatePanel({ type, onRetry }: { type: 'loading' | 'error' | 'empty'; onRetry?: () => void }) {
  if (type === 'loading') return <div className="space-y-3" data-testid="state-orders-loading"><div className="h-12 animate-pulse rounded-xl bg-muted/70" /><div className="h-12 animate-pulse rounded-xl bg-muted/60" /><div className="h-12 animate-pulse rounded-xl bg-muted/50" /></div>;
  if (type === 'empty') return <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center" data-testid="state-orders-empty"><div><div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary"><ClipboardList size={19} /></div><h3 className="mt-3 font-display text-sm font-bold">No orders match this view</h3><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Try a different search or clear one of the filters.</p></div></div>;
  return <div className="grid min-h-56 place-items-center rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center" data-testid="state-orders-error"><div><CircleAlert className="mx-auto text-destructive" size={23} /><h3 className="mt-3 font-display text-sm font-bold">Order register unavailable</h3><p className="mt-1 text-xs text-muted-foreground">The latest records could not be loaded.</p><Button onClick={onRetry} size="sm" variant="outline" className="mt-4" data-testid="button-retry-orders"><RefreshCw size={13} /> Retry</Button></div></div>;
}

function SectionHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: React.ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{eyebrow}</p><h2 className="mt-1 font-display text-lg font-bold tracking-tight">{title}</h2>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>{action}</div>;
}

function NewOrderDialog({ open, onOpenChange, clients, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; clients: Client[]; onDone: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateOrder();
  const quotationsQuery = useListQuotations({
    query: { queryKey: getListQuotationsQueryKey(), enabled: open },
  });
  const form = useForm<z.infer<typeof orderSchema>>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      clientMode: 'existing',
      clientId: '',
      clientName: '',
      clientPhone: '',
      clientAddress: '',
      clientGstin: '',
      quotationId: '',
      locationName: '',
      siteAddress: '',
      sameAsClientAddress: false,
      siteLatitude: null,
      siteLongitude: null,
      notes: '',
    },
  });
  const clientMode = form.watch('clientMode');
  const selectedClient = clients.find((client) => client.id === form.watch('clientId'));
  const clientName = form.watch('clientName') || '';
  const clientType = clientMode === 'manual' ? form.watch('clientType') : selectedClient?.type ?? form.watch('clientType');
  const clientAddress = clientMode === 'manual' ? form.watch('clientAddress') || '' : selectedClient?.address || '';
  const sameAsClientAddress = form.watch('sameAsClientAddress');
  const locationName = form.watch('locationName') || '';
  const siteAddress = form.watch('siteAddress');
  const siteLatitude = form.watch('siteLatitude');
  const siteLongitude = form.watch('siteLongitude');
  const availableQuotations = (quotationsQuery.data ?? []).filter((quotation: Quotation) =>
    !quotation.sampleOnly &&
    /^QT-\d+$/i.test(quotation.quoteNo.trim()),
  );
  const selectedQuotation = availableQuotations.find((quotation) => quotation.id === form.watch('quotationId'));
  const previewId = orderIdPreview(clientType ?? null, selectedQuotation?.quoteNo);
  const clientIsReady = clientMode === 'manual'
    ? clientName.trim().length >= 2 && Boolean(clientType)
    : Boolean(selectedClient && clientType);
  const canCreate =
    clientIsReady &&
    locationName.trim().length >= 2 &&
    siteAddress.trim().length >= 3 &&
    !create.isPending;

  useEffect(() => {
    if (open) form.reset({
      clientMode: 'existing',
      clientId: '',
      clientName: '',
      clientType: undefined,
      clientPhone: '',
      clientAddress: '',
      clientGstin: '',
      quotationId: '',
      locationName: '',
      siteAddress: '',
      sameAsClientAddress: false,
      siteLatitude: null,
      siteLongitude: null,
      notes: '',
    });
  }, [open, form]);

  const submit = (values: z.infer<typeof orderSchema>) => {
    const selectedType = values.clientMode === 'manual'
      ? values.clientType
      : selectedClient?.type ?? values.clientType;
    if (!selectedType) {
      toast({ title: 'Client type required', description: 'Choose Project or Retail before creating the order.', variant: 'destructive' });
      return;
    }
    const data = {
      ...(values.clientMode === 'existing' && selectedClient
        ? { clientId: selectedClient.id, clientType: selectedType }
        : {
            clientName: values.clientName?.trim(),
            clientType: selectedType,
            clientPhone: values.clientPhone?.trim() || null,
            clientAddress: values.clientAddress?.trim() || null,
            clientGstin: values.clientGstin?.trim().toUpperCase() || null,
          }),
      ...(values.quotationId ? { quotationId: values.quotationId } : {}),
      locationName: values.locationName.trim(),
      siteAddress: values.siteAddress.trim(),
      siteLatitude: values.siteLatitude,
      siteLongitude: values.siteLongitude,
      notes: values.notes?.trim() || null,
    };
    create.mutate(
      { data },
      {
        onSuccess: (order) => {
          void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          toast({ title: 'Order created', description: order.orderId });
          onDone();
        },
        onError: (error) => toast({
          title: 'Order could not be created',
          description: error instanceof Error ? error.message : 'Check the client and site details.',
          variant: 'destructive',
        }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Create Client &amp; Order</DialogTitle>
          <DialogDescription>Enter a client and job site. A quotation can be linked now or added later from the order page.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4" data-testid="form-order">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-1">
              <Button type="button" variant={clientMode === 'existing' ? 'default' : 'ghost'} onClick={() => {
                form.setValue('clientMode', 'existing', { shouldValidate: true });
                form.setValue('clientName', '');
                form.setValue('clientType', undefined);
                form.setValue('clientPhone', '');
                form.setValue('clientAddress', '');
                form.setValue('clientGstin', '');
                form.setValue('quotationId', '');
                form.setValue('sameAsClientAddress', false);
              }} data-testid="button-existing-client">Choose existing client</Button>
              <Button type="button" variant={clientMode === 'manual' ? 'default' : 'ghost'} onClick={() => {
                form.setValue('clientMode', 'manual', { shouldValidate: true });
                form.setValue('clientId', '');
                form.setValue('quotationId', '');
                form.setValue('siteAddress', '');
                form.setValue('sameAsClientAddress', false);
                form.setValue('siteLatitude', null);
                form.setValue('siteLongitude', null);
              }} data-testid="button-manual-client">Enter new client</Button>
            </div>
            <input type="hidden" {...form.register('clientMode')} />

            {clientMode === 'existing' ? (
              <>
                <FormField control={form.control} name="clientId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client</FormLabel>
                    <Select
                      onValueChange={(value) => {
                        field.onChange(value);
                        const client = clients.find((item) => item.id === value);
                        form.setValue('clientType', client?.type ?? undefined, { shouldValidate: true });
                        form.setValue('quotationId', '', { shouldValidate: true });
                        form.setValue('siteAddress', client?.address || '', { shouldValidate: true });
                        form.setValue('siteLatitude', null, { shouldValidate: true });
                        form.setValue('siteLongitude', null, { shouldValidate: true });
                      }}
                      value={field.value || ''}
                    >
                      <FormControl><SelectTrigger data-testid="select-order-client"><SelectValue placeholder="Choose a client" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {clients.filter((client) => client.isActive).map((client) => (
                          <SelectItem key={client.id} value={client.id}>{client.name} · {client.type ?? 'Type not set'}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                {selectedClient && !selectedClient.type && (
                  <FormField control={form.control} name="clientType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl><SelectTrigger data-testid="select-order-client-type"><SelectValue placeholder="Choose Project or Retail" /></SelectTrigger></FormControl>
                        <SelectContent><SelectItem value="Project">Project</SelectItem><SelectItem value="Retail">Retail</SelectItem></SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </>
            ) : (
              <div className="space-y-4 rounded-xl border border-border/70 bg-muted/15 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="clientName" render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Client / company name</FormLabel>
                      <FormControl><Input {...field} value={field.value || ''} onChange={(event) => {
                        field.onChange(event);
                        form.setValue('quotationId', '');
                      }} placeholder="e.g. Meridian Habitat" data-testid="input-order-client-name" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="clientType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client type</FormLabel>
                      <Select onValueChange={(value) => {
                        field.onChange(value);
                        form.setValue('quotationId', '');
                      }} value={field.value || ''}>
                        <FormControl><SelectTrigger data-testid="select-order-client-type"><SelectValue placeholder="Choose Project or Retail" /></SelectTrigger></FormControl>
                        <SelectContent><SelectItem value="Project">Project</SelectItem><SelectItem value="Retail">Retail</SelectItem></SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="clientPhone" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
                      <FormControl><Input {...field} value={field.value || ''} placeholder="+91 98…" data-testid="input-order-client-phone" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="clientAddress" render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Client address <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
                      <FormControl><Textarea {...field} value={field.value || ''} onChange={(event) => {
                        field.onChange(event);
                        if (form.getValues('sameAsClientAddress')) form.setValue('siteAddress', event.target.value, { shouldValidate: true, shouldDirty: true });
                      }} rows={2} placeholder="Billing or registered address" data-testid="input-order-client-address" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="clientGstin" render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>GSTIN <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
                      <FormControl><Input {...field} value={field.value || ''} maxLength={15} data-testid="input-order-client-gstin" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
            )}

            {clientMode === 'existing' && (
              <>
                <FormField control={form.control} name="quotationId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quotation <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}
                      value={field.value || 'none'}
                      disabled={!selectedClient || quotationsQuery.isLoading}
                    >
                      <FormControl><SelectTrigger data-testid="select-order-quotation"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="none">Create without a quotation</SelectItem>
                        {availableQuotations.map((quotation) => (
                          <SelectItem key={quotation.id} value={quotation.id}>{quotationOptionLabel(quotation)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <p className="text-[10px] leading-4 text-muted-foreground">Choose any active quotation. Its customer name does not need to match this order’s client.</p>
                {selectedClient && quotationsQuery.isLoading && <p className="text-xs text-muted-foreground" role="status">Loading available quotations…</p>}
                {selectedClient && quotationsQuery.isError && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs" role="alert">
                    <span>Quotations could not be loaded. You can still create the order without one.</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => void quotationsQuery.refetch()}>Retry</Button>
                  </div>
                )}
                {selectedClient && !quotationsQuery.isLoading && !quotationsQuery.isError && availableQuotations.length === 0 && (
                  <p className="rounded-lg border border-border bg-muted/25 px-3 py-2.5 text-xs text-muted-foreground" role="status" data-testid="notice-order-no-quotation">
                    No active QT-numbered quotations are available. You can create this order now and link one later.
                  </p>
                )}
              </>
            )}
            {clientMode === 'manual' && (
              <div className="space-y-2">
                <FormField control={form.control} name="quotationId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quotation <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}
                      value={field.value || 'none'}
                      disabled={quotationsQuery.isLoading}
                    >
                      <FormControl><SelectTrigger data-testid="select-manual-order-quotation"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="none">Create without a quotation</SelectItem>
                        {availableQuotations.map((quotation) => (
                          <SelectItem key={quotation.id} value={quotation.id}>{quotationOptionLabel(quotation)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <p className="rounded-lg border border-border bg-muted/25 px-3 py-2.5 text-xs text-muted-foreground">
                  Any active QT quotation can be linked, even if its customer name differs. The order keeps the client details entered above.
                </p>
                {quotationsQuery.isLoading && <p className="text-xs text-muted-foreground" role="status">Loading available quotations…</p>}
                {quotationsQuery.isError && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs" role="alert">
                    <span>Quotations could not be loaded. You can still create the order without one.</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => void quotationsQuery.refetch()}>Retry</Button>
                  </div>
                )}
                {!quotationsQuery.isLoading && !quotationsQuery.isError && availableQuotations.length === 0 && (
                  <p className="text-xs text-muted-foreground" role="status">No active QT-numbered quotations are available.</p>
                )}
              </div>
            )}
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs" data-testid="text-order-id-preview">
              {previewId ? (
                <>
                  <p className="font-semibold text-primary">Order ID preview · <span className="font-mono">{previewId}</span></p>
                  <p className="mt-1 text-muted-foreground">This order will use the linked quotation number.</p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-primary">Temporary Order ID assigned on save</p>
                  <p className="mt-1 text-muted-foreground">After a quotation is linked, the ID changes to the standard P/R + QT number format.</p>
                </>
              )}
            </div>

            <FormField control={form.control} name="locationName" render={({ field }) => (
              <FormItem>
                <FormLabel>City / location</FormLabel>
                <FormControl><Input {...field} placeholder="e.g. Pune" data-testid="input-order-location-name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="siteAddress" render={({ field }) => (
              <FormItem>
                <FormLabel>Order site address</FormLabel>
                <FormControl>
                    <Textarea
                    {...field}
                      disabled={sameAsClientAddress}
                    onChange={(event) => {
                      field.onChange(event);
                      if (form.getValues('siteLatitude') !== null || form.getValues('siteLongitude') !== null) {
                        form.setValue('siteLatitude', null, { shouldDirty: true });
                        form.setValue('siteLongitude', null, { shouldDirty: true });
                      }
                    }}
                    rows={3}
                    maxLength={500}
                    placeholder="Building, street, area, city, state, PIN code"
                    data-testid="input-order-site-address"
                  />
                </FormControl>
                <p className="text-[10px] leading-4 text-muted-foreground">This address belongs to the order. Editing it after pinning clears the pin.</p>
                {siteAddress.trim().length >= 3 && <SiteLocation address={siteAddress} latitude={siteLatitude} longitude={siteLongitude} compact testId="preview-order-site-address" />}
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
              <Checkbox
                id="order-site-same-as-client"
                checked={sameAsClientAddress}
                onCheckedChange={(checked) => {
                  const useClientAddress = checked === true;
                  form.setValue('sameAsClientAddress', useClientAddress, { shouldDirty: true });
                  if (useClientAddress) {
                    form.setValue('siteAddress', clientAddress, { shouldValidate: true, shouldDirty: true });
                    form.setValue('siteLatitude', null, { shouldDirty: true });
                    form.setValue('siteLongitude', null, { shouldDirty: true });
                  }
                }}
                data-testid="checkbox-order-site-same-as-client"
              />
              <div>
                <label htmlFor="order-site-same-as-client" className="cursor-pointer text-xs font-medium">Order site address is same as client address</label>
                <p className="mt-1 text-[10px] text-muted-foreground">When checked, the site address follows the client address entered above or saved on the selected client.</p>
              </div>
            </div>
            <SiteMapPicker
              address={siteAddress}
              latitude={siteLatitude}
              longitude={siteLongitude}
              onSelect={(point) => {
                form.setValue('siteLatitude', point.latitude, { shouldValidate: true, shouldDirty: true });
                form.setValue('siteLongitude', point.longitude, { shouldValidate: true, shouldDirty: true });
                if (point.address && !form.getValues('sameAsClientAddress')) form.setValue('siteAddress', point.address, { shouldValidate: true, shouldDirty: true });
              }}
              onClear={() => {
                form.setValue('siteLatitude', null, { shouldValidate: true, shouldDirty: true });
                form.setValue('siteLongitude', null, { shouldValidate: true, shouldDirty: true });
              }}
              testId="order-site-map-picker"
            />
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

export default function OrderHubPage({ user }: { user: User }) {
  const canEdit = user.roleId === 'master-admin' || user.permissions?.['order-hub'] === 'edit';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
  const [status, setStatus] = useState<string>(() => new URLSearchParams(window.location.search).get('status') || 'all');
  const [clientId, setClientId] = useState(() => new URLSearchParams(window.location.search).get('clientId') || 'all');
  const [locationName, setLocationName] = useState(() => new URLSearchParams(window.location.search).get('locationName') || '');
  const [from, setFrom] = useState(() => new URLSearchParams(window.location.search).get('from') || '');
  const [to, setTo] = useState(() => new URLSearchParams(window.location.search).get('to') || '');
  const [orderOpen, setOrderOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);

  const clientParams = useMemo(() => ({ includeInactive: showInactive, q: undefined }), [showInactive]);
  const orderParams = useMemo(() => ({ q: search || undefined, status: status === 'all' ? undefined : status as Status, clientId: clientId === 'all' ? undefined : clientId, locationName: locationName.trim() || undefined, from: from || undefined, to: to || undefined, includeInactive: showInactive }), [search, status, clientId, locationName, from, to, showInactive]);
  const clients = useListClients(clientParams, { query: { queryKey: getListClientsQueryKey(clientParams) } });
  const orders = useListOrders(orderParams, { query: { queryKey: getListOrdersQueryKey(orderParams) } });
  const dispatchSummary = useGetDispatchSummary({ query: { queryKey: getGetDispatchSummaryQueryKey(), enabled: user.roleId === 'master-admin' || ['view', 'edit'].includes(user.permissions?.dispatch || '') } });
  const dispatchForOrder = (orderRecordId: string) => dispatchSummary.data?.orders.find((item) => item.orderRecordId === orderRecordId);
  const deleteOrder = useDeleteOrder();
  const updateOrder = useUpdateOrder();
  const orderActionsPending = deleteOrder.isPending || updateOrder.isPending;
  const clientList = clients.data || [];
  const orderList = orders.data || [];
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(orderList.length / pageSize));
  const pageOrders = useMemo(() => orderList.slice((page - 1) * pageSize, page * pageSize), [orderList, page]);

  useEffect(() => { setPage(1); }, [search, status, clientId, locationName, from, to, showInactive]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
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
  const clearFilters = () => { setSearch(''); setStatus('all'); setClientId('all'); setLocationName(''); setFrom(''); setTo(''); };

  return <AppShell user={user} title="Client & Orders" eyebrow="Central order register"><div className="space-y-6">
    <section className="order-hub-accent animate-enter-up relative overflow-hidden rounded-2xl p-6 text-white shadow-sm md:p-8">
      <div className="absolute right-9 top-7 h-24 w-24 rounded-full border border-sidebar-primary/20" />
      <div className="absolute right-16 top-14 h-10 w-10 rounded-full border border-accent/30" />
      <div className="relative max-w-3xl">
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-primary">
          <span>Framewise workbench</span><span className="h-1 w-1 rounded-full bg-accent" /><span>Traceable records</span>
        </div>
        <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-[-0.045em] md:text-4xl">Every order, one clear view.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">Search and manage orders with their own client, city, site address, and quotation details.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <div className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs"><ClipboardList size={14} className="text-sidebar-primary" /> {orderList.length} matching orders</div>
        </div>
      </div>
    </section>

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
        <Input value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder="Filter by city / location" aria-label="Filter by city or location" data-testid="input-filter-location" />
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
              {pageOrders.map((order) => (
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
                  <div className="grid grid-cols-2 divide-x divide-border/70 text-[10px]">
                    <div className="pr-3"><p className="uppercase tracking-wider text-muted-foreground">City / location</p><p className="mt-1 font-medium">{order.locationName}</p><SiteLocation address={order.siteAddress} latitude={order.siteLatitude} longitude={order.siteLongitude} compact testId={`order-mobile-site-${order.id}`} /></div>
                    <div className="pl-3"><p className="uppercase tracking-wider text-muted-foreground">Created</p><p className="mt-1 font-medium">{shortDate(order.createdAt)}</p></div>
                  </div>
                  {(() => { const summary = dispatchForOrder(order.id); const count = summary?.lots.reduce((total, lot) => total + lot.dispatchCount, 0) ?? 0; const latest = summary?.lots.map((lot) => lot.latestDispatchCode).filter(Boolean).slice(-1)[0]; return <Link href={`/order-hub/${order.id}?tab=dispatches`} className="block rounded-lg border border-primary/10 bg-primary/[.035] px-3 py-2 text-[10px] hover:border-primary/30" data-testid={`link-order-dispatches-mobile-${order.id}`}><span className="font-bold text-primary">{count} dispatch records</span><span className="text-muted-foreground">{latest ? ` · Latest ${latest}` : ' · No dispatch yet'}</span></Link>; })()}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2">
                    <span className="text-[10px] text-muted-foreground">{order.clientPhone || 'No phone recorded'}</span>
                    <OrderRowActions order={order} canEdit={canEdit} pending={orderActionsPending} onArchive={archiveOrder} onRestore={restoreOrder} />
                  </div>
                </article>
              ))}
            </div>
            <table className="hidden w-full min-w-[1020px] border-collapse text-left text-xs md:table">
              <thead className="border-b border-border bg-muted/35 text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
                <tr>
                  <th className="border-b border-r border-border/80 px-4 py-3 font-bold">Order</th>
                  <th className="border-b border-r border-border/80 px-4 py-3 font-bold">Client</th>
                  <th className="border-b border-r border-border/80 px-4 py-3 font-bold">Location</th>
                  <th className="border-b border-r border-border/80 px-4 py-3 font-bold">Status</th>
                  <th className="border-b border-r border-border/80 px-4 py-3 font-bold">Dispatches</th>
                  <th className="border-b border-r border-border/80 px-4 py-3 font-bold">Created</th>
                  <th className="border-b border-border/80 px-4 py-3 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageOrders.map((order) => (
                  <tr key={order.id} className="group hover:bg-primary/[0.025]" data-testid={`row-order-${order.id}`}>
                    <td className="border-b border-r border-border/70 px-4 py-3.5">
                      <Link href={`/order-hub/${order.id}`} className="font-mono text-[11px] font-bold text-primary hover:underline" data-testid={`link-order-${order.id}`}>{order.orderId}</Link>
                      <p className="mt-1 text-[10px] text-muted-foreground">Sequence {String(order.sequenceNo).padStart(3, '0')}</p>
                      {!order.isActive && <span className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold text-muted-foreground">Inactive</span>}
                      {order.needsReview && <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-900" data-testid={`badge-order-review-${order.id}`}>Needs review</span>}
                    </td>
                    <td className="border-b border-r border-border/70 px-4 py-3.5"><p className="font-semibold">{order.clientName}</p><p className="mt-1 text-[10px] text-muted-foreground">{order.clientPrefix}{order.clientPhone ? ` · ${order.clientPhone}` : ''}</p></td>
                    <td className="border-b border-r border-border/70 px-4 py-3.5"><p className="font-semibold">{order.locationName}</p><SiteLocation address={order.siteAddress} latitude={order.siteLatitude} longitude={order.siteLongitude} compact testId={`order-table-site-${order.id}`} /></td>
                    <td className="border-b border-r border-border/70 px-4 py-3.5"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusTone(order.status)}`} data-testid={`status-order-${order.id}`}>{statusLabel(order.status)}</span></td>
                    <td className="border-b border-r border-border/70 px-4 py-3.5">{(() => { const summary = dispatchForOrder(order.id); const latest = summary?.lots.map((lot) => lot.latestDispatchCode).filter(Boolean).slice(-1)[0]; const count = summary?.lots.reduce((total, lot) => total + lot.dispatchCount, 0) ?? 0; return <Link href={`/order-hub/${order.id}?tab=dispatches`} className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline" data-testid={`link-order-dispatches-${order.id}`}>{count} records{latest ? ` · ${latest}` : ''}</Link>; })()}</td>
                    <td className="border-b border-r border-border/70 px-4 py-3.5 text-muted-foreground">{shortDate(order.createdAt)}<p className="mt-1 text-[10px]">{order.createdBy}</p></td>
                    <td className="border-b border-border/70 px-4 py-3.5"><OrderRowActions order={order} canEdit={canEdit} pending={orderActionsPending} onArchive={archiveOrder} onRestore={restoreOrder} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      {orderList.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-label="Order table pagination">
          <p className="text-xs text-muted-foreground" data-testid="text-order-pagination">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, orderList.length)} of {orderList.length} orders
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} data-testid="button-orders-previous">Previous</Button>
            <span className="min-w-16 text-center text-xs text-muted-foreground">Page {page} of {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} data-testid="button-orders-next">Next</Button>
          </div>
        </div>
      )}
    </section>

    <NewOrderDialog open={orderOpen} onOpenChange={setOrderOpen} clients={clientList} onDone={() => setOrderOpen(false)} />
  </div></AppShell>;
}