import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import {
  ArrowLeft,
  Archive,
  Check,
  Clipboard,
  ClipboardCheck,
  CircleAlert,
  Download,
  Eye,
  Flag,
  FileText,
  IndianRupee,
  Grid2X2,
  List,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Settings2,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import {
  getDownloadOrderDocumentQueryKey,
  getGetPaymentOverviewQueryKey,
  getGetOrderQueryKey,
  getListQuotationsQueryKey,
  getListOrderDocumentCategoriesQueryKey,
  getListOrderActivityQueryKey,
  getListOrderGrievancesQueryKey,
  getListInstallationOrdersQueryKey,
  getListOrderDocumentsQueryKey,
  getListOrderMessageTemplatesQueryKey,
  getListOrderPaymentFlagsQueryKey,
  getListOrderPaymentsQueryKey,
  getListOrderRefundsQueryKey,
  getListPaymentFlagsQueryKey,
  getListOrderWindowsQueryKey,
  getListOrdersQueryKey,
  useAddOrderLot,
  OrderGlassStatus,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderStatus,
  OrderWindowReadiness,
  useArchiveOrderDocument,
  useArchiveOrderWindow,
  useBounceOrderPayment,
  useCreateOrderDocumentCategory,
  useCreateOrderGrievance,
  useCreateOrderWindow,
  useCreateOrderPaymentFlag,
  useDeleteOrderDocumentCategory,
  useDownloadOrderDocument,
  useGetOrder,
  useListOrderActivity,
  useListOrderDocumentCategories,
  useListOrderDocuments,
  useListOrderGrievances,
  useListOrderMessageTemplates,
  useListQuotations,
  useListOrderPaymentFlags,
  useListOrderPayments,
  useListOrderRefunds,
  useListOrderWindows,
  useRecordOrderPayment,
  useRecordOrderRefund,
  useReplaceOrderDocument,
  useUpdateOrder,
  useUpdateOrderBilling,
  useUpdateOrderDocumentCategory,
  useUpdateOrderWindow,
  useUploadOrderDocument,
  useVoidOrderPayment,
} from '@workspace/api-client-react';
import type {
  Order,
  OrderDocument,
  OrderDocumentCategory,
  OrderDocumentCategoryConfig,
  OrderGrievance,
  PaymentFlag,
  OrderPayment,
  OrderWindow,
  Quotation,
  User,
} from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { LifecycleMessageTemplates } from '@/components/lifecycle-message-templates';
import { OrderQrCard } from '@/components/order-qr-card';
import { SiteLocation } from '@/components/site-location';
import { SiteMapPicker } from '@/components/site-map-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { DocumentPreviewDialog } from '@/components/document-preview';
import { PaymentFlagBadge } from '@/components/payment-flag-badge';
import { PaymentFlagDialog } from '@/components/payment-flag-dialog';
import { PaymentFlagDetails } from '@/components/payment-flag-details';
import { PaymentProgressBar } from '@/components/payment-progress-bar';
import { formatInr, formatIstDate, formatIstDateTime } from '@/lib/formatters';
import { calculatePaymentProgress } from '@/lib/payment-progress';

type Status = (typeof OrderStatus)[keyof typeof OrderStatus];
type Readiness = (typeof OrderWindowReadiness)[keyof typeof OrderWindowReadiness];
type GlassStatus = (typeof OrderGlassStatus)[keyof typeof OrderGlassStatus];
type PaymentMethod = (typeof OrderPaymentMethod)[keyof typeof OrderPaymentMethod];
type DocumentCategory = OrderDocumentCategory;

const STATUS_OPTIONS: { value: Status; label: string; tone: string }[] = [
  { value: OrderStatus.quotation_stage, label: 'Quotation stage', tone: 'bg-slate-100 text-slate-700' },
  { value: OrderStatus.confirmed, label: 'Confirmed', tone: 'bg-cyan-100 text-cyan-800' },
  { value: OrderStatus.in_production, label: 'In production', tone: 'bg-amber-100 text-amber-800' },
  { value: OrderStatus.ready, label: 'Ready', tone: 'bg-lime-100 text-lime-800' },
  { value: OrderStatus.dispatched, label: 'Dispatched', tone: 'bg-orange-100 text-orange-800' },
  { value: OrderStatus.installed, label: 'Installed', tone: 'bg-emerald-100 text-emerald-800' },
];

const READINESS_OPTIONS: { value: Readiness; label: string }[] = [
  { value: OrderWindowReadiness.pending, label: 'Pending' },
  { value: OrderWindowReadiness.in_progress, label: 'In progress' },
  { value: OrderWindowReadiness.ready, label: 'Ready' },
];

const GLASS_OPTIONS: { value: GlassStatus; label: string }[] = [
  { value: OrderGlassStatus.pending, label: 'Pending' },
  { value: OrderGlassStatus.partial, label: 'Partial' },
  { value: OrderGlassStatus.received, label: 'Received' },
];

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: OrderPaymentMethod.bank_transfer, label: 'Bank transfer' },
  { value: OrderPaymentMethod.upi, label: 'UPI' },
  { value: OrderPaymentMethod.cash, label: 'Cash' },
  { value: OrderPaymentMethod.cheque, label: 'Cheque' },
  { value: OrderPaymentMethod.other, label: 'Other' },
];

const statusLabel = (status: string) => STATUS_OPTIONS.find((item) => item.value === status)?.label || status.replaceAll('_', ' ');
const statusTone = (status: string) => STATUS_OPTIONS.find((item) => item.value === status)?.tone || 'bg-muted text-muted-foreground';
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const inr = (value: number | null | undefined) => formatInr(value, 'Not set');
const plainInr = (value: number) => formatInr(value);
const readable = (value: string) => value === 'drawing' ? 'Elevation' : value.replaceAll('_', ' ');
const localDateInput = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
};
const grievanceFormSchema = z.object({
  description: z.string().trim().min(1, 'Describe the customer’s grievance.').max(3000, 'Keep the description under 3,000 characters.'),
  reportedAt: z.string().min(1, 'Choose the date the grievance was reported.'),
});
type GrievanceFormValues = z.infer<typeof grievanceFormSchema>;

function hasPermission(user: User, module: string, level: 'view' | 'edit' = 'edit') {
  return user.roleId === 'master-admin' || user.permissions?.[module] === 'edit' || (level === 'view' && user.permissions?.[module] === 'view');
}

function DetailLoading() {
  return <div className="space-y-5" data-testid="state-order-detail-loading"><div className="h-36 animate-pulse rounded-2xl bg-card/80" /><div className="h-12 animate-pulse rounded-xl bg-card/70" /><div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]"><div className="h-72 animate-pulse rounded-2xl bg-card/70" /><div className="h-72 animate-pulse rounded-2xl bg-card/70" /></div></div>;
}

function DetailError({ onRetry }: { onRetry: () => void }) {
  return <div className="flex min-h-[520px] items-center justify-center" data-testid="state-order-detail-error"><div className="max-w-sm rounded-2xl border border-destructive/20 bg-card p-7 text-center"><CircleAlert className="mx-auto text-destructive" size={28} /><h2 className="mt-4 font-display text-lg font-bold">Order record unavailable</h2><p className="mt-2 text-sm text-muted-foreground">We couldn't load this central order record.</p><Button onClick={onRetry} variant="outline" size="sm" className="mt-5" data-testid="button-retry-order-detail"><RefreshCw size={13} /> Try again</Button></div></div>;
}

function fillTemplate(template: string, order: Order) {
  const values: Record<string, string> = {
    clientName: order.clientName,
    orderId: order.orderId,
    locationName: order.locationName,
    status: statusLabel(order.status),
    locationCode: order.locationCode,
    createdAt: dateLabel(order.createdAt),
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`);
}

function MessagePreview({ order, templates, canEdit }: { order: Order; templates: { status: Status; label: string; template: string }[]; canEdit: boolean }) {
  const { toast } = useToast();
  const template = templates.find((item) => item.status === order.status);
  const initialMessage = template ? fillTemplate(template.template, order) : 'No centrally stored message template is available for this stage.';
  const [message, setMessage] = useState(initialMessage);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => setMessage(initialMessage), [initialMessage]);
  const copy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    toast({ title: 'Message copied', description: 'The stage message is on your clipboard.' });
    window.setTimeout(() => setCopied(false), 1800);
  };
  return <Card className="border-border/80"><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Stage communication</p><CardTitle className="mt-1 text-base">Message preview</CardTitle><p className="mt-1 text-xs text-muted-foreground">{template ? `Centrally stored · ${template.label}` : 'Template not configured for this stage'}</p></div><MessageSquareText size={18} className="text-primary" /></div></CardHeader><CardContent><Textarea value={message} onChange={(event) => setMessage(event.target.value)} readOnly={!editing || !canEdit} rows={6} className="resize-y text-sm leading-6" data-testid="textarea-order-message" /><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] text-muted-foreground">Variables resolve from this order. One-off edits are not saved.</p><div className="flex gap-2">{canEdit && <Button type="button" size="sm" variant="outline" onClick={() => setEditing((value) => !value)} data-testid="button-edit-order-message"><Pencil size={13} /> {editing ? 'Lock message' : 'Edit copy'}</Button>}<Button type="button" size="sm" onClick={copy} data-testid="button-copy-order-message">{copied ? <ClipboardCheck size={13} /> : <Clipboard size={13} />} {copied ? 'Copied' : 'Copy message'}</Button></div></div></CardContent></Card>;
}

function SummaryStat({ label, value, detail, testId }: { label: string; value: string; detail: string; testId: string }) {
  return <div className="rounded-xl border border-border/70 bg-background/45 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl font-bold tracking-[-0.03em]" data-testid={testId}>{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>;
}

const detailSchema = z.object({
  clientName: z.string().trim().min(2, 'Enter the client name.').max(120),
  clientType: z.enum(['Project', 'Retail', 'unassigned']),
  clientPhone: z.string().max(30),
  clientAddress: z.string().max(500),
  clientGstin: z.string().max(15),
  quotationId: z.string(),
  locationName: z.string().trim().min(2, 'Enter a city or location name.').max(120),
  siteAddress: z.string().trim().min(3, 'Enter the order’s site address.').max(500, 'Keep the address under 500 characters.'),
  sameAsClientAddress: z.boolean(),
  siteLatitude: z.number().min(-90).max(90).nullable(),
  siteLongitude: z.number().min(-180).max(180).nullable(),
  status: z.string(),
  notes: z.string().max(2000).nullable().optional(),
});

function orderDetailValues(order: Order): z.infer<typeof detailSchema> {
  const siteAddress = order.siteAddress || order.clientAddress || '';
  return {
    clientName: order.clientName || '',
    clientType: order.clientType === 'Project' || order.clientType === 'Retail' ? order.clientType : 'unassigned',
    clientPhone: order.clientPhone || '',
    clientAddress: order.clientAddress || '',
    clientGstin: order.clientGstin || '',
    quotationId: order.quotationId || '',
    locationName: order.locationName || '',
    siteAddress,
    sameAsClientAddress: Boolean(order.clientAddress?.trim() && siteAddress.trim() === order.clientAddress.trim()),
    siteLatitude: order.siteLatitude ?? null,
    siteLongitude: order.siteLongitude ?? null,
    status: order.status,
    notes: order.notes || '',
  };
}

function OrderRecordCard({ order, user, id }: { order: Order; user: User; id: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canEdit = hasPermission(user, 'order-hub');
  const update = useUpdateOrder();
  const quotationsQuery = useListQuotations({
    query: { queryKey: getListQuotationsQueryKey(), enabled: canEdit },
  });
  const [selectedQuotationId, setSelectedQuotationId] = useState('');
  const availableQuotations = (quotationsQuery.data ?? []).filter((quotation: Quotation) =>
    quotation.clientId === order.clientId &&
    !quotation.sampleOnly &&
    /^QT-\d+$/i.test(quotation.quoteNo.trim()),
  );
  const [editing, setEditing] = useState(
    () => new URLSearchParams(window.location.search).get('edit') === 'true',
  );
  const form = useForm<z.infer<typeof detailSchema>>({
    resolver: zodResolver(detailSchema),
    defaultValues: orderDetailValues(order),
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('edit')) {
      url.searchParams.delete('edit');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);
  const initializedForId = useRef<string | null>(null);
  useEffect(() => {
    if (initializedForId.current !== order.id) {
      initializedForId.current = order.id;
      form.reset(orderDetailValues(order));
    }
  }, [form, order.id, order.locationName, order.siteAddress, order.clientAddress, order.siteLatitude, order.siteLongitude, order.notes, order.status]);
  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector('[data-testid="card-order-record"]')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);
  const save = (values: z.infer<typeof detailSchema>) => {
    const existingClientType = order.clientType ?? 'unassigned';
    if (values.clientType === 'unassigned' && values.quotationId) {
      toast({
        title: 'Client type is required for a linked quotation',
        description: 'Remove the quotation or choose Project or Retail before saving.',
        variant: 'destructive',
      });
      return;
    }
    const data = {
      clientName: values.clientName.trim(),
      clientPhone: values.clientPhone.trim() || null,
      clientAddress: values.clientAddress.trim() || null,
      clientGstin: values.clientGstin.trim().toUpperCase() || null,
      ...(values.clientType !== existingClientType
        ? { clientType: values.clientType === 'unassigned' ? null : values.clientType as 'Project' | 'Retail' }
        : {}),
      ...(values.quotationId !== (order.quotationId || '')
        ? { quotationId: values.quotationId || null }
        : {}),
      locationName: values.locationName.trim(),
      siteAddress: values.siteAddress.trim(),
      siteLatitude: values.siteLatitude,
      siteLongitude: values.siteLongitude,
      status: values.status as Status,
      notes: values.notes || null,
    };
    update.mutate({ id: order.id, data }, {
    onSuccess: (updated) => {
      queryClient.setQueryData(getGetOrderQueryKey(id), updated);
      void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getListInstallationOrdersQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetPaymentOverviewQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(id) });
      setEditing(false);
      toast({ title: 'Order record updated', description: `${updated.orderId} is now ${statusLabel(updated.status)}.` });
    },
    onError: (cause) => toast({
      title: 'Order record could not be updated',
      description: cause instanceof Error ? cause.message : 'Check the order fields and try again.',
      variant: 'destructive',
    }),
  });
  };
  const linkQuotation = () => {
    if (!selectedQuotationId) return;
    update.mutate({ id: order.id, data: { quotationId: selectedQuotationId } }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetOrderQueryKey(id), updated);
        void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(id) });
        toast({ title: 'Quotation linked', description: `Order ID updated to ${updated.orderId}.` });
        setSelectedQuotationId('');
      },
      onError: (cause) => toast({
        title: 'Quotation could not be linked',
        description: cause instanceof Error ? cause.message : 'Please check the selected quotation.',
        variant: 'destructive',
      }),
    });
  };
  return (
    <Card id="order-record-card" className={`scroll-mt-24 border-border/80 ${editing ? 'ring-2 ring-primary/20' : ''}`} data-testid="card-order-record">
      <CardHeader className="flex-row items-start justify-between pb-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{editing ? 'Editing order' : 'Order facts'}</p>
          <CardTitle className="mt-1 text-base">{editing ? 'Edit order details' : 'Central record'}</CardTitle>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => {
            setEditing((value) => !value);
            form.reset(orderDetailValues(order));
          }} data-testid="button-toggle-order-edit">
            <Pencil size={13} /> {editing ? 'Cancel' : 'Edit record'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {order.quotationNo ? (
          <div className="mb-4 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5 text-xs" data-testid="text-linked-quotation">
            <span className="text-muted-foreground">Linked quotation</span>
            <span className="ml-2 font-mono font-bold text-primary">{order.quotationNo}</span>
          </div>
        ) : canEdit ? (
          <div className="mb-4 space-y-2 rounded-lg border border-dashed border-border p-3" data-testid="panel-link-quotation">
            <div>
              <p className="text-xs font-semibold">Link a quotation later</p>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Link a QT quotation for this client to replace the temporary Order ID with its canonical ID.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select
                value={selectedQuotationId || 'none'}
                onValueChange={(value) => setSelectedQuotationId(value === 'none' ? '' : value)}
                disabled={quotationsQuery.isLoading}
              >
                <SelectTrigger className="min-w-0 flex-1" data-testid="select-link-order-quotation">
                  <SelectValue placeholder="Choose a quotation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Choose a quotation</SelectItem>
                  {availableQuotations.map((quotation) => (
                    <SelectItem key={quotation.id} value={quotation.id}>
                      {quotation.quoteNo} · {quotation.projectName || quotation.customerName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" disabled={!selectedQuotationId || update.isPending} onClick={linkQuotation} data-testid="button-link-order-quotation">
                {update.isPending ? 'Linking…' : 'Link quotation'}
              </Button>
            </div>
            {!quotationsQuery.isLoading && availableQuotations.length === 0 && (
              <p className="text-[10px] text-muted-foreground">No QT-numbered quotations are available for this client yet.</p>
            )}
            {quotationsQuery.isError && (
              <Button type="button" variant="outline" size="sm" onClick={() => void quotationsQuery.refetch()}>Retry loading quotations</Button>
            )}
          </div>
        ) : null}
        {editing && canEdit ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(save)} className="space-y-4" data-testid="form-order-detail">
              <div className="rounded-xl border border-border/70 bg-muted/15 p-4">
                <p className="text-xs font-semibold">Client details for this order</p>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">These edits apply to this order only. The saved client profile and other orders will not change.</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="clientName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client / company name</FormLabel>
                      <FormControl><Input {...field} maxLength={120} data-testid="input-edit-order-client-name" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="clientType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger data-testid="select-edit-order-client-type"><SelectValue placeholder="Choose a type" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="unassigned">Not set</SelectItem>
                          <SelectItem value="Project">Project</SelectItem>
                          <SelectItem value="Retail">Retail</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="clientPhone" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl><Input {...field} type="tel" maxLength={30} placeholder="+91" data-testid="input-edit-order-client-phone" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="clientGstin" render={({ field }) => (
                    <FormItem>
                      <FormLabel>GSTIN</FormLabel>
                      <FormControl><Input {...field} maxLength={15} data-testid="input-edit-order-client-gstin" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="clientAddress" render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Client address</FormLabel>
                      <FormControl><Textarea {...field} rows={2} maxLength={500} placeholder="Billing or registered address" onChange={(event) => {
                        field.onChange(event);
                        if (form.getValues('sameAsClientAddress')) {
                          form.setValue('siteAddress', event.target.value, { shouldDirty: true, shouldValidate: true });
                          form.setValue('siteLatitude', null, { shouldDirty: true });
                          form.setValue('siteLongitude', null, { shouldDirty: true });
                        }
                      }} data-testid="input-edit-order-client-address" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="quotationId" render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Quotation (optional)</FormLabel>
                      <Select value={field.value || 'none'} onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}>
                        <FormControl><SelectTrigger data-testid="select-edit-order-quotation"><SelectValue placeholder="No quotation linked" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">No quotation linked</SelectItem>
                          {order.quotationId && !availableQuotations.some((quotation) => quotation.id === order.quotationId) && (
                            <SelectItem value={order.quotationId}>{order.quotationNo || 'Current quotation'} · currently linked</SelectItem>
                          )}
                          {availableQuotations.map((quotation) => (
                            <SelectItem key={quotation.id} value={quotation.id}>
                              {quotation.quoteNo} · {quotation.projectName || quotation.customerName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] leading-4 text-muted-foreground">Linking or removing a quotation may change this order’s ID. A QT quotation must belong to this client.</p>
                      {quotationsQuery.isError && <Button type="button" variant="outline" size="sm" onClick={() => void quotationsQuery.refetch()}>Retry loading quotations</Button>}
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField control={form.control} name="locationName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>City / location</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. Pune" data-testid="input-edit-order-location-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-background px-3 py-2.5 sm:mt-7">
                  <FormField control={form.control} name="sameAsClientAddress" render={({ field }) => (
                    <>
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={(checked) => {
                          const isSameAddress = checked === true;
                          field.onChange(isSameAddress);
                          if (isSameAddress) {
                            form.setValue('siteAddress', form.getValues('clientAddress'), { shouldDirty: true, shouldValidate: true });
                            form.setValue('siteLatitude', null, { shouldDirty: true });
                            form.setValue('siteLongitude', null, { shouldDirty: true });
                          }
                        }} data-testid="checkbox-edit-order-same-client-address" />
                      </FormControl>
                      <div>
                        <FormLabel className="cursor-pointer text-xs">Order site address is the same as client address</FormLabel>
                        <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">Keeps the two address fields in sync.</p>
                      </div>
                    </>
                  )} />
                </div>
              </div>
              <FormField control={form.control} name="siteAddress" render={({ field }) => (
                <FormItem>
                  <FormLabel>Order site address</FormLabel>
                  <FormControl><Textarea {...field} onChange={(event) => {
                    field.onChange(event);
                    if (form.getValues('sameAsClientAddress')) {
                      form.setValue('sameAsClientAddress', false, { shouldDirty: true });
                    }
                    if (form.getValues('siteLatitude') !== null || form.getValues('siteLongitude') !== null) {
                      form.setValue('siteLatitude', null, { shouldDirty: true });
                      form.setValue('siteLongitude', null, { shouldDirty: true });
                    }
                  }} disabled={form.watch('sameAsClientAddress')} rows={3} maxLength={500} placeholder="Building, street, area, city, state, PIN code" data-testid="input-edit-order-site-address" /></FormControl>
                  <p className="text-[10px] leading-4 text-muted-foreground">This address belongs to this order; editing the text after pinning clears the map pin.</p>
                  {field.value.trim().length >= 3 && <SiteLocation address={field.value} latitude={form.watch('siteLatitude')} longitude={form.watch('siteLongitude')} compact testId="preview-edit-order-site-address" />}
                  <FormMessage />
                </FormItem>
              )} />
              <SiteMapPicker
                address={form.watch('siteAddress')}
                latitude={form.watch('siteLatitude')}
                longitude={form.watch('siteLongitude')}
                onSelect={(point) => {
                  form.setValue('siteLatitude', point.latitude, { shouldValidate: true, shouldDirty: true });
                  form.setValue('siteLongitude', point.longitude, { shouldValidate: true, shouldDirty: true });
                  if (point.address) {
                    form.setValue('sameAsClientAddress', false, { shouldDirty: true });
                    form.setValue('siteAddress', point.address, { shouldValidate: true, shouldDirty: true });
                  }
                }}
                onClear={() => {
                  form.setValue('siteLatitude', null, { shouldValidate: true, shouldDirty: true });
                  form.setValue('siteLongitude', null, { shouldValidate: true, shouldDirty: true });
                }}
                testId="edit-order-site-map-picker"
              />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Lifecycle status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger data-testid="select-order-status"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{STATUS_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Internal notes</FormLabel>
                  <FormControl><Textarea {...field} value={field.value || ''} rows={5} placeholder="Notes for the office and factory teams" data-testid="textarea-order-notes" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="flex justify-end">
                <Button type="submit" disabled={update.isPending} data-testid="button-save-order-detail">
                  {update.isPending ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                  {update.isPending ? 'Saving…' : 'Save order record'}
                </Button>
              </div>
            </form>
          </Form>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="order-rule pl-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Client contact</p>
              <p className="mt-2 text-sm font-semibold" data-testid="text-client-phone">{order.clientPhone || 'Not provided'}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground" data-testid="text-client-address">{order.clientAddress || 'No address on record'}</p>
            </div>
            <div className="order-rule pl-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Order site address</p>
              <SiteLocation address={order.siteAddress || order.clientAddress} latitude={order.siteLatitude} longitude={order.siteLongitude} showMap testId="order-site-location" />
            </div>
            <div className="order-rule pl-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Tax identity</p>
              <p className="mt-2 font-mono text-sm font-semibold" data-testid="text-client-gstin">{order.clientGstin || 'Not provided'}</p>
              <p className="mt-1 text-xs text-muted-foreground">Client prefix · {order.clientPrefix}</p>
            </div>
            <div className="order-rule pl-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Client type</p>
              <p className="mt-2 text-sm font-semibold" data-testid="text-order-client-type">{order.clientType || 'Type not set'}</p>
            </div>
            <div className="order-rule pl-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Linked quotation</p>
              <p className="mt-2 font-mono text-sm font-semibold" data-testid="text-order-quotation">{order.quotationNo || 'Not linked'}</p>
            </div>
            {order.legacyOrderId && order.legacyOrderId !== order.orderId && (
              <div className="order-rule pl-4 sm:col-span-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Legacy order ID</p>
                <p className="mt-2 break-all font-mono text-sm font-semibold" data-testid="text-order-legacy-id">{order.legacyOrderId}</p>
              </div>
            )}
            <div className="order-rule pl-4 sm:col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Internal notes</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/80" data-testid="text-order-notes">{order.notes || 'No notes have been added to this record.'}</p>
            </div>
            <div className="border-t border-border/70 pt-4 text-[10px] text-muted-foreground sm:col-span-2">
              <span className="font-semibold text-foreground">Created by</span> {order.createdBy} · <span className="font-semibold text-foreground">Last updated by</span> {order.updatedBy || 'System'}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OrderLotsCard({ order, user, id }: { order: Order; user: User; id: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canEdit = hasPermission(user, 'order-hub');
  const addLot = useAddOrderLot();
  const lots = [...(order.lots ?? [])].sort((left, right) => left.sequence - right.sequence);
  const canManageLots = canEdit && !order.needsReview && Boolean(order.clientType && order.quotationId);

  const onSuccess = (updated: Order, message: string) => {
    queryClient.setQueryData(getGetOrderQueryKey(id), updated);
    void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    toast({ title: message, description: updated.orderId });
  };

  const add = () => addLot.mutate(
    { id },
    {
      onSuccess: (updated) => onSuccess(updated, 'Lot added'),
      onError: (error) => toast({
        title: 'Lot could not be added',
        description: error instanceof Error ? error.message : 'Try again after checking the order.',
        variant: 'destructive',
      }),
    },
  );

  return (
    <Card className="border-border/80" data-testid="card-order-lots">
      <CardHeader className="flex-row items-start justify-between gap-4 pb-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Lot register</p>
          <CardTitle className="mt-1 text-base">Order lots <span className="font-mono text-xs text-muted-foreground">({lots.length})</span></CardTitle>
        </div>
        {canManageLots && (
          <Button size="sm" onClick={add} disabled={addLot.isPending} data-testid="button-add-order-lot">
            {addLot.isPending ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
            Add lot
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {order.needsReview && (
          <p className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-xs text-amber-900" role="status" data-testid="notice-order-lots-review">
            Needs review. Resolve this order’s client type and quotation before adding or changing lots.
          </p>
        )}
        {lots.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground" data-testid="empty-order-lots">
            {order.clientType === 'Project' ? 'No lots are recorded for this Project order.' : 'This Retail order has no lots.'}
          </p>
        ) : (
          <div className="divide-y divide-border/70 rounded-xl border border-border/70">
            {lots.map((lot) => {
              return (
                <div key={lot.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3" data-testid={`row-order-lot-${lot.id}`}>
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm font-bold text-primary" data-testid={`text-lot-id-${lot.id}`}>{lot.lotId}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">Lot {String(lot.sequence).padStart(2, '0')} · created {formatIstDate(lot.createdAt)}</p>
                  </div>
                  {order.clientType === 'Project' && lots.length === 1 ? (
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold text-secondary-foreground">Required lot</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const windowSchema = z.object({
  windowNo: z.string().min(1, 'Window number is required').max(20),
  widthMm: z.coerce.number().positive('Enter a width').max(10000),
  heightMm: z.coerce.number().positive('Enter a height').max(10000),
  windowType: z.string().min(1, 'Window type is required').max(100),
  frameStatus: z.string(),
  shutterStatus: z.string(),
  glassStatus: z.string(),
  pendingReason: z.string().max(500).optional(),
});
type WindowFormValues = z.infer<typeof windowSchema>;

function WindowDialog({ orderId, window, user, open, onOpenChange, onComplete }: { orderId: string; window: OrderWindow | null; user: User; open: boolean; onOpenChange: (open: boolean) => void; onComplete: () => void }) {
  const { toast } = useToast();
  const canMeasure = hasPermission(user, 'measurements');
  const canReadiness = hasPermission(user, 'window-readiness');
  const canGlass = hasPermission(user, 'glass-procurement');
  const create = useCreateOrderWindow();
  const update = useUpdateOrderWindow();
  const form = useForm<WindowFormValues>({ resolver: zodResolver(windowSchema), defaultValues: { windowNo: '', widthMm: 0, heightMm: 0, windowType: '', frameStatus: OrderWindowReadiness.pending, shutterStatus: OrderWindowReadiness.pending, glassStatus: OrderGlassStatus.pending, pendingReason: '' } });
  useEffect(() => {
    if (open) form.reset(window ? { windowNo: window.windowNo, widthMm: window.widthMm, heightMm: window.heightMm, windowType: window.windowType, frameStatus: window.frameStatus, shutterStatus: window.shutterStatus, glassStatus: window.glassStatus, pendingReason: window.pendingReason || '' } : { windowNo: '', widthMm: 0, heightMm: 0, windowType: '', frameStatus: OrderWindowReadiness.pending, shutterStatus: OrderWindowReadiness.pending, glassStatus: OrderGlassStatus.pending, pendingReason: '' });
  }, [form, open, window]);
  const save = (values: WindowFormValues) => {
    const options = { onSuccess: () => { toast({ title: window ? 'Window updated' : 'Window added', description: 'The order window record is now current.' }); onOpenChange(false); onComplete(); }, onError: () => toast({ title: 'Window could not be saved', description: 'Check your permissions and the entered values.', variant: 'destructive' as const }) };
    if (window) {
      const data = {
        ...(canMeasure ? { windowNo: values.windowNo, widthMm: values.widthMm, heightMm: values.heightMm, windowType: values.windowType } : {}),
        ...(canReadiness ? { frameStatus: values.frameStatus as Readiness, shutterStatus: values.shutterStatus as Readiness, pendingReason: values.pendingReason || null } : {}),
        ...(canGlass ? { glassStatus: values.glassStatus as GlassStatus } : {}),
      };
      update.mutate({ id: orderId, windowId: window.id, data }, options);
    } else if (canMeasure) {
      create.mutate({ id: orderId, data: { windowNo: values.windowNo, widthMm: values.widthMm, heightMm: values.heightMm, windowType: values.windowType, frameStatus: (canReadiness ? values.frameStatus : OrderWindowReadiness.pending) as Readiness, shutterStatus: (canReadiness ? values.shutterStatus : OrderWindowReadiness.pending) as Readiness, glassStatus: (canGlass ? values.glassStatus : OrderGlassStatus.pending) as GlassStatus, pendingReason: canReadiness ? values.pendingReason || null : null } }, options);
    }
  };
  const pending = create.isPending || update.isPending;
  return <div className={open ? 'fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 sm:items-center' : 'hidden'} role="dialog" aria-modal="true" aria-labelledby="window-dialog-title" data-testid="dialog-window"><div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-xl sm:p-6"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Window register</p><h2 id="window-dialog-title" className="mt-1 font-display text-xl font-bold">{window ? 'Edit window' : 'Add window'}</h2><p className="mt-1 text-xs text-muted-foreground">Dimensions are recorded in millimetres.</p></div><Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} data-testid="button-close-window-dialog">Close</Button></div><Form {...form}><form onSubmit={form.handleSubmit(save)} className="mt-6 space-y-4" data-testid="form-window"><div className="grid gap-4 sm:grid-cols-2"><FormField control={form.control} name="windowNo" render={({ field }) => <FormItem><FormLabel>Window no.</FormLabel><FormControl><Input {...field} disabled={!canMeasure} data-testid="input-window-no" /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="windowType" render={({ field }) => <FormItem><FormLabel>Window type</FormLabel><FormControl><Input {...field} disabled={!canMeasure} data-testid="input-window-type" /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="widthMm" render={({ field }) => <FormItem><FormLabel>Width (mm)</FormLabel><FormControl><Input {...field} type="number" min="1" disabled={!canMeasure} data-testid="input-window-width" /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="heightMm" render={({ field }) => <FormItem><FormLabel>Height (mm)</FormLabel><FormControl><Input {...field} type="number" min="1" disabled={!canMeasure} data-testid="input-window-height" /></FormControl><FormMessage /></FormItem>} /></div><div className="grid gap-4 sm:grid-cols-3"><WindowSelectField control={form.control} name="frameStatus" label="Frame" options={READINESS_OPTIONS} disabled={!canReadiness} testId="select-window-frame" /><WindowSelectField control={form.control} name="shutterStatus" label="Shutter" options={READINESS_OPTIONS} disabled={!canReadiness} testId="select-window-shutter" /><WindowSelectField control={form.control} name="glassStatus" label="Glass" options={GLASS_OPTIONS} disabled={!canGlass} testId="select-window-glass" /></div><FormField control={form.control} name="pendingReason" render={({ field }) => <FormItem><FormLabel>Pending reason <span className="font-normal text-muted-foreground">(optional)</span></FormLabel><FormControl><Textarea {...field} value={field.value || ''} disabled={!canReadiness} rows={3} data-testid="textarea-window-pending-reason" /></FormControl><FormMessage /></FormItem>} /><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4"><p className="text-[11px] text-muted-foreground">{!canMeasure ? 'Measurement fields are read-only for your role.' : !canReadiness || !canGlass ? 'Some readiness fields are read-only for your role.' : 'Changes are written to the order register.'}</p><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-window">Cancel</Button><Button type="submit" disabled={pending || (!window && !canMeasure)} data-testid="button-save-window">{pending ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} {pending ? 'Saving…' : window ? 'Save window' : 'Add window'}</Button></div></div></form></Form></div></div>;
}

function WindowSelectField({ control, name, label, options, disabled, testId }: { control: ReturnType<typeof useForm<WindowFormValues>>['control']; name: 'frameStatus' | 'shutterStatus' | 'glassStatus'; label: string; options: { value: string; label: string }[]; disabled: boolean; testId: string }) {
  return <FormField control={control} name={name} render={({ field }) => <FormItem><FormLabel>{label}</FormLabel><Select value={field.value} onValueChange={field.onChange} disabled={disabled}><FormControl><SelectTrigger data-testid={testId}><SelectValue /></SelectTrigger></FormControl><SelectContent>{options.map((item) => <SelectItem value={item.value} key={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />;
}

function WindowsPanel({ orderId, user }: { orderId: string; user: User }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const query = useListOrderWindows(orderId, { query: { queryKey: getListOrderWindowsQueryKey(orderId) } });
  const archive = useArchiveOrderWindow();
  const canMeasure = hasPermission(user, 'measurements');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWindow, setEditingWindow] = useState<OrderWindow | null>(null);
  const windows = query.data || [];
  const readyCount = windows.filter((item) => item.frameStatus === OrderWindowReadiness.ready && item.shutterStatus === OrderWindowReadiness.ready && item.glassStatus === OrderGlassStatus.received).length;
  const openAdd = () => { setEditingWindow(null); setDialogOpen(true); };
  const archiveWindow = (window: OrderWindow) => {
    if (!globalThis.confirm(`Archive window ${window.windowNo}?`)) return;
    archive.mutate({ id: orderId, windowId: window.id }, { onSuccess: () => { toast({ title: 'Window archived' }); void queryClient.invalidateQueries({ queryKey: getListOrderWindowsQueryKey(orderId) }); void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(orderId) }); }, onError: () => toast({ title: 'Window could not be archived', variant: 'destructive' as const }) });
  };
  return <Card className="border-border/80" data-testid="card-order-windows"><CardHeader className="flex-row items-start justify-between gap-3 pb-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Manufacturing register</p><CardTitle className="mt-1 text-base">Windows <span className="font-mono text-xs font-normal text-muted-foreground">{windows.length} · {readyCount} fully ready</span></CardTitle><p className="mt-1 text-xs text-muted-foreground">Measurements, frame, shutter, and glass state per opening.</p></div>{canMeasure && <Button size="sm" onClick={openAdd} data-testid="button-add-window"><Plus size={14} /> Add window</Button>}</CardHeader><CardContent>{query.isLoading ? <div className="space-y-3" data-testid="state-windows-loading">{[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-muted/55" />)}</div> : query.isError ? <InlineError onRetry={() => void query.refetch()} label="Windows could not be loaded." testId="state-windows-error" /> : windows.length === 0 ? <ZeroState icon={Wrench} title="No window records yet" description={canMeasure ? 'Add the first opening to begin the manufacturing register.' : 'No window records have been persisted for this order.'} testId="state-windows-empty" /> : <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead><tr className="border-b border-border/70 text-[10px] uppercase tracking-[0.13em] text-muted-foreground"><th className="px-3 py-3">Window</th><th className="px-3 py-3">Dimensions</th><th className="px-3 py-3">Area</th><th className="px-3 py-3">Frame</th><th className="px-3 py-3">Shutter</th><th className="px-3 py-3">Glass</th><th className="px-3 py-3 text-right">Actions</th></tr></thead><tbody>{windows.map((item) => <tr key={item.id} className="group border-b border-border/50 last:border-0" data-testid={`row-window-${item.id}`}><td className="px-3 py-3"><p className="font-semibold" data-testid={`text-window-no-${item.id}`}>{item.windowNo}</p><p className="mt-1 text-[11px] text-muted-foreground">{item.windowType}</p>{item.pendingReason && <p className="mt-1 max-w-[180px] truncate text-[10px] text-amber-700" title={item.pendingReason}>{item.pendingReason}</p>}</td><td className="px-3 py-3 font-mono text-[11px]">{item.widthMm} × {item.heightMm} mm</td><td className="px-3 py-3 font-mono">{item.sqFt.toFixed(2)} sq ft</td><td className="px-3 py-3"><ReadinessPill value={item.frameStatus} /></td><td className="px-3 py-3"><ReadinessPill value={item.shutterStatus} /></td><td className="px-3 py-3"><GlassPill value={item.glassStatus} /></td><td className="px-3 py-3"><div className="flex justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"><Button variant="ghost" size="icon" disabled={!canMeasure && !hasPermission(user, 'window-readiness') && !hasPermission(user, 'glass-procurement')} onClick={() => { setEditingWindow(item); setDialogOpen(true); }} data-testid={`button-edit-window-${item.id}`}><Pencil size={14} /></Button>{canMeasure && <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" disabled={archive.isPending} onClick={() => archiveWindow(item)} data-testid={`button-archive-window-${item.id}`}><Archive size={14} /></Button>}</div></td></tr>)}</tbody></table></div>}</CardContent><WindowDialog orderId={orderId} window={editingWindow} user={user} open={dialogOpen} onOpenChange={setDialogOpen} onComplete={() => { void queryClient.invalidateQueries({ queryKey: getListOrderWindowsQueryKey(orderId) }); void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(orderId) }); }} /></Card>;
}

function ReadinessPill({ value }: { value: string }) {
  const tone = value === OrderWindowReadiness.ready ? 'bg-emerald-100 text-emerald-800' : value === OrderWindowReadiness.in_progress ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700';
  return <span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold capitalize ${tone}`}>{readable(value)}</span>;
}

function GlassPill({ value }: { value: string }) {
  const tone = value === OrderGlassStatus.received ? 'bg-emerald-100 text-emerald-800' : value === OrderGlassStatus.partial ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700';
  return <span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold capitalize ${tone}`}>{readable(value)}</span>;
}

const paymentSchema = z.object({ amount: z.coerce.number().positive('Enter an amount'), method: z.string(), reference: z.string().max(120).optional(), notes: z.string().max(500).optional(), paidAt: z.string().min(1, 'Select a payment date') });
type PaymentFormValues = z.infer<typeof paymentSchema>;

function PaymentDialog({ orderId, open, onOpenChange, onComplete }: { orderId: string; open: boolean; onOpenChange: (open: boolean) => void; onComplete: () => void }) {
  const { toast } = useToast();
  const record = useRecordOrderPayment();
  const form = useForm<PaymentFormValues>({ resolver: zodResolver(paymentSchema), defaultValues: { amount: 0, method: OrderPaymentMethod.bank_transfer, reference: '', notes: '', paidAt: '' } });
  useEffect(() => { if (open) form.reset({ amount: 0, method: OrderPaymentMethod.bank_transfer, reference: '', notes: '', paidAt: new Date().toISOString().slice(0, 16) }); }, [form, open]);
  const save = (values: PaymentFormValues) => record.mutate({ id: orderId, data: { amount: values.amount, method: values.method as PaymentMethod, reference: values.reference || null, notes: values.notes || null, paidAt: new Date(values.paidAt).toISOString() } }, { onSuccess: () => { toast({ title: 'Payment recorded' }); onOpenChange(false); onComplete(); }, onError: () => toast({ title: 'Payment could not be recorded', variant: 'destructive' as const }) });
  return <div className={open ? 'fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 sm:items-center' : 'hidden'} role="dialog" aria-modal="true" data-testid="dialog-payment"><div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-xl sm:p-6"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Payment register</p><h2 className="mt-1 font-display text-xl font-bold">Record payment</h2><p className="mt-1 text-xs text-muted-foreground">Received payments update the order balance immediately.</p></div><Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} data-testid="button-close-payment-dialog">Close</Button></div><Form {...form}><form onSubmit={form.handleSubmit(save)} className="mt-6 space-y-4" data-testid="form-payment"><div className="grid gap-4 sm:grid-cols-2"><FormField control={form.control} name="amount" render={({ field }) => <FormItem><FormLabel>Amount (INR)</FormLabel><FormControl><Input {...field} type="number" min="0.01" step="0.01" data-testid="input-payment-amount" /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="paidAt" render={({ field }) => <FormItem><FormLabel>Paid at</FormLabel><FormControl><Input {...field} type="datetime-local" data-testid="input-payment-date" /></FormControl><FormMessage /></FormItem>} /></div><FormField control={form.control} name="method" render={({ field }) => <FormItem><FormLabel>Method</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger data-testid="select-payment-method"><SelectValue /></SelectTrigger></FormControl><SelectContent>{PAYMENT_METHODS.map((item) => <SelectItem value={item.value} key={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} /><FormField control={form.control} name="reference" render={({ field }) => <FormItem><FormLabel>Reference <span className="font-normal text-muted-foreground">(optional)</span></FormLabel><FormControl><Input {...field} data-testid="input-payment-reference" /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="notes" render={({ field }) => <FormItem><FormLabel>Notes <span className="font-normal text-muted-foreground">(optional)</span></FormLabel><FormControl><Textarea {...field} rows={3} data-testid="textarea-payment-notes" /></FormControl><FormMessage /></FormItem>} /><div className="flex justify-end gap-2 border-t border-border/70 pt-4"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-payment">Cancel</Button><Button type="submit" disabled={record.isPending} data-testid="button-save-payment">{record.isPending ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} {record.isPending ? 'Recording…' : 'Record payment'}</Button></div></form></Form></div></div>;
}

function OrderPaymentFlagsPanel({ orderId, user }: { orderId: string; user: User }) {
  const query = useListOrderPaymentFlags(orderId, { query: { enabled: hasPermission(user, 'payments', 'view'), queryKey: getListOrderPaymentFlagsQueryKey(orderId) } });
  const [selectedFlag, setSelectedFlag] = useState<PaymentFlag | null>(null);
  const flags = query.data ?? [];
  const activeCount = flags.filter((flag) => flag.status === 'active').length;
  if (!hasPermission(user, 'payments', 'view')) return null;
  return <Card className="border-border/80" data-testid="card-order-payment-flags">
    <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-700">Issue tracking</p>
        <div className="mt-1 flex flex-wrap items-center gap-2"><CardTitle className="text-base">Payment flags</CardTitle>{activeCount > 0 && <PaymentFlagBadge count={activeCount} />}</div>
        <p className="mt-1 text-xs text-muted-foreground">Bounced payments and client refusals are tracked separately from received receipts.</p>
      </div>
      {hasPermission(user, 'payments') && activeCount === 0 && <PaymentFlagDialog orderId={orderId} flaggedBy={user.name} onOpening={() => setSelectedFlag(null)} />}
    </CardHeader>
    <CardContent>
      {query.isLoading ? <div className="space-y-2" data-testid="state-order-payment-flags-loading"><div className="h-16 animate-pulse rounded-xl bg-muted/55" /><div className="h-16 animate-pulse rounded-xl bg-muted/55" /></div>
        : query.isError ? <InlineError onRetry={() => void query.refetch()} label="Payment flags could not be loaded." testId="state-order-payment-flags-error" />
          : flags.length === 0 ? <ZeroState icon={Flag} title="No payment flags" description="Use Flag to track a returned payment or refusal to pay." testId="state-order-payment-flags-empty" />
            : <div className="space-y-3" data-testid="list-order-payment-flags">{flags.map((flag) => <article key={flag.id} className="rounded-xl border border-border/70 bg-muted/15 p-4" data-testid={`order-payment-flag-${flag.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {flag.status === 'active'
                    ? <button type="button" onClick={() => setSelectedFlag(flag)} aria-label={`View ${flag.flagType === 'bounced_payment' ? 'bounced payment' : 'refusal to pay'} flag details`} className="rounded-full transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`button-view-order-flag-${flag.id}`}><PaymentFlagBadge status={flag.status} label={`Flagged: ${flag.flagType === 'bounced_payment' ? 'Bounced' : 'Refusal to Pay'}`} /></button>
                    : <><PaymentFlagBadge status={flag.status} /><span className="text-xs font-bold">{flag.flagType === 'bounced_payment' ? 'Bounced Payment' : 'Refusal to Pay'}</span></>}
                </div>
                <span className="font-display text-sm font-bold tabular-nums">{plainInr(flag.flaggedAmount)}</span>
              </div>
               {flag.remarks && <p className="mt-2 text-xs leading-5">{flag.remarks}</p>}
               <p className="mt-1 text-[10px] text-muted-foreground">Flagged {formatIstDateTime(flag.flaggedAt)} by {flag.flaggedBy}</p>
              {flag.flagType === 'bounced_payment'
                 ? <p className="mt-2 text-[11px] text-muted-foreground">{flag.bounceReason} · Bounced {flag.bouncedAmount == null ? '—' : plainInr(flag.bouncedAmount)} · Bank charges {flag.bankCharges == null ? '—' : plainInr(flag.bankCharges)}</p>
                 : <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{flag.followUpCount} follow-ups · last on {flag.lastFollowUpDate ? formatIstDate(flag.lastFollowUpDate) : '—'}{flag.followUpNotes ? ` · ${flag.followUpNotes}` : ''}</p>}
               {flag.resolutionDate && <p className="mt-2 rounded-lg bg-primary/5 px-3 py-2 text-[11px] leading-5"><span className="font-semibold">Resolved {formatIstDate(flag.resolutionDate)}</span>{flag.resolutionNotes && <>: {flag.resolutionNotes}</>}</p>}
               {flag.removedAt && <p className="mt-2 text-[10px] text-muted-foreground">Removed {formatIstDateTime(flag.removedAt)} by {flag.removedBy || 'Former user'}; history retained.</p>}
              <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => setSelectedFlag(flag)} data-testid={`button-open-order-flag-details-${flag.id}`}>View flag details</Button>
              <details className="mt-2 text-[11px]">
                <summary className="w-fit cursor-pointer font-semibold text-primary">Action history ({flag.actions.length})</summary>
                <ol className="mt-2 space-y-2 border-l border-border pl-3">
                  {[...flag.actions].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).map((action) => <li key={action.id} className="text-muted-foreground"><span className="font-semibold text-foreground">{action.action === 'created' ? 'Flag created' : action.action === 'edited' ? 'Flag edited' : action.action === 'follow_up_added' ? 'Follow-up added' : action.action === 'resolved' ? 'Flag resolved' : 'Flag removed'}</span><span> · {action.actorName} · {formatIstDateTime(action.occurredAt)}</span>{action.summary && <p className="mt-0.5 leading-4">{action.summary}</p>}</li>)}
                </ol>
              </details>
            </article>)}</div>}
    </CardContent>
    <PaymentFlagDetails flag={selectedFlag} canEdit={hasPermission(user, 'payments')} onClose={() => setSelectedFlag(null)} onFlagUpdated={setSelectedFlag} />
  </Card>;
}

function BillingPanel({ order, user, id }: { order: Order; user: User; id: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = hasPermission(user, 'payments');
  const update = useUpdateOrderBilling();
  const [editing, setEditing] = useState(false);
  const form = useForm<{ orderValue: string }>({ defaultValues: { orderValue: order.orderValue == null ? '' : String(order.orderValue) } });
  useEffect(() => { if (!editing) form.reset({ orderValue: order.orderValue == null ? '' : String(order.orderValue) }); }, [editing, form, order.orderValue]);
  const save = (values: { orderValue: string }) => update.mutate({ id, data: { orderValue: values.orderValue.trim() === '' ? null : Number(values.orderValue) } }, { onSuccess: (updated) => { queryClient.setQueryData(getGetOrderQueryKey(id), updated); void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }); void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(id) }); void queryClient.invalidateQueries({ queryKey: getGetPaymentOverviewQueryKey() }); void queryClient.invalidateQueries({ queryKey: getListPaymentFlagsQueryKey() }); void queryClient.invalidateQueries({ queryKey: getListOrderPaymentFlagsQueryKey(id) }); setEditing(false); toast({ title: 'Order value updated' }); }, onError: () => toast({ title: 'Order value could not be updated', variant: 'destructive' as const }) });
  return <Card className="border-border/80" data-testid="card-billing-value"><CardHeader className="flex-row items-start justify-between pb-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Commercial record</p><CardTitle className="mt-1 text-base">Order value</CardTitle><p className="mt-1 text-xs text-muted-foreground">The agreed value used for balance calculation.</p></div>{canEdit && <Button size="sm" variant="outline" onClick={() => setEditing((value) => !value)} data-testid="button-edit-order-value"><Pencil size={13} /> {editing ? 'Cancel' : 'Edit value'}</Button>}</CardHeader><CardContent>{editing && canEdit ? <Form {...form}><form onSubmit={form.handleSubmit(save)} className="flex flex-wrap items-end gap-3" data-testid="form-order-billing"><FormField control={form.control} name="orderValue" render={({ field }) => <FormItem className="min-w-[220px] flex-1"><FormLabel>Order value (INR)</FormLabel><FormControl><Input {...field} type="number" min="0" step="0.01" placeholder="Leave blank if not agreed" data-testid="input-order-value" /></FormControl><FormMessage /></FormItem>} /><Button type="submit" disabled={update.isPending} data-testid="button-save-order-value">{update.isPending ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Save</Button></form></Form> : <div className="flex items-end justify-between gap-4"><div><p className="font-display text-3xl font-bold tracking-[-0.04em]" data-testid="text-order-value">{inr(order.orderValue)}</p><p className="mt-1 text-xs text-muted-foreground">{order.orderValue == null ? 'Balance remains unknown until an order value is set.' : 'Persisted on the central order record.'}</p></div><IndianRupee className="mb-1 text-primary/70" size={28} /></div>}</CardContent></Card>;
}

function PaymentsPanel({ orderId, user, order }: { orderId: string; user: User; order: Order }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canView = hasPermission(user, 'payments', 'view');
  const canEdit = hasPermission(user, 'payments');
  const query = useListOrderPayments(orderId, { query: { enabled: canView, queryKey: getListOrderPaymentsQueryKey(orderId) } });
  const refundsQuery = useListOrderRefunds(orderId, { query: { enabled: canView, queryKey: getListOrderRefundsQueryKey(orderId) } });
  const voidPayment = useVoidOrderPayment();
  const bouncePayment = useBounceOrderPayment();
  const createFlag = useCreateOrderPaymentFlag();
  const recordRefund = useRecordOrderRefund();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundDate, setRefundDate] = useState(localDateInput);
  const [refundNotes, setRefundNotes] = useState('');
  const [bounceTarget, setBounceTarget] = useState<OrderPayment | null>(null);
  const [bounceDate, setBounceDate] = useState(localDateInput);
  const [bounceReason, setBounceReason] = useState('');
  const [createBounceFlag, setCreateBounceFlag] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const payments = query.data || [];
  const refunds = refundsQuery.data || [];
  const receiptsTotal = payments.filter((payment) => payment.status === OrderPaymentStatus.received).reduce((sum, payment) => sum + payment.amount, 0);
  const refundTotal = refunds.reduce((sum, refund) => sum + refund.amount, 0);
  const progress = calculatePaymentProgress(order.orderValue, receiptsTotal - refundTotal);
  const refreshLedger = () => {
    void queryClient.invalidateQueries({ queryKey: getListOrderPaymentsQueryKey(orderId) });
    void queryClient.invalidateQueries({ queryKey: getListOrderRefundsQueryKey(orderId) });
    void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(orderId) });
    void queryClient.invalidateQueries({ queryKey: getGetPaymentOverviewQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListOrderPaymentFlagsQueryKey(orderId) });
    void queryClient.invalidateQueries({ queryKey: getListPaymentFlagsQueryKey() });
  };
  const voidPaymentRecord = (payment: OrderPayment) => {
    const reason = window.prompt('Reason for voiding this payment');
    if (!reason || reason.trim().length < 3) return;
    setVoidingId(payment.id);
    voidPayment.mutate({ id: orderId, paymentId: payment.id, data: { voidReason: reason.trim() } }, {
      onSuccess: () => { setVoidingId(null); toast({ title: 'Payment voided' }); refreshLedger(); },
      onError: () => { setVoidingId(null); toast({ title: 'Payment could not be voided', variant: 'destructive' as const }); },
    });
  };
  const submitBounce = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = bounceTarget;
    if (!target || bounceReason.trim().length < 3) return;
    bouncePayment.mutate({ id: orderId, paymentId: target.id, data: { bouncedAt: bounceDate, bounceReason: bounceReason.trim() } }, {
      onSuccess: () => {
        refreshLedger();
        setBounceTarget(null);
        toast({ title: 'Receipt marked as bounced' });
        if (createBounceFlag) {
          createFlag.mutate({
            id: orderId,
            data: {
              flagType: 'bounced_payment',
              remarks: `Receipt of ${plainInr(target.amount)} bounced from the bank.`,
              flaggedAt: bounceDate,
              bounceReason: bounceReason.trim(),
              bouncedAmount: target.amount,
            },
          }, {
            onSuccess: () => {
              void queryClient.invalidateQueries({ queryKey: getListPaymentFlagsQueryKey() });
              void queryClient.invalidateQueries({ queryKey: getListOrderPaymentFlagsQueryKey(orderId) });
              void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(orderId) });
              toast({ title: 'Bounced-payment flag added' });
            },
            onError: () => toast({ title: 'Receipt bounced; the payment flag could not be created', description: 'You can add it separately from Payment flags.', variant: 'destructive' as const }),
          });
        }
      },
      onError: () => toast({ title: 'Receipt could not be marked as bounced', variant: 'destructive' as const }),
    });
  };
  const submitRefund = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > Math.max(0, progress.paid)) return;
    recordRefund.mutate({ id: orderId, data: { amount, refundDate, notes: refundNotes.trim() || null } }, {
      onSuccess: () => {
        refreshLedger();
        setRefundDialogOpen(false);
        setRefundAmount('');
        setRefundNotes('');
        toast({ title: 'Refund recorded' });
      },
      onError: () => toast({ title: 'Refund could not be recorded', variant: 'destructive' as const }),
    });
  };
  if (!canView) return <ZeroState icon={IndianRupee} title="Payment access is restricted" description="You need payments view access to see this order's financial records." testId="state-payments-restricted" />;
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3">
      <SummaryStat label="Order value" value={inr(order.orderValue)} detail={order.orderValue == null ? 'Unknown' : 'Agreed value'} testId="text-billing-order-value" />
      <SummaryStat label="Paid" value={plainInr(progress.paid)} detail="Received receipts less refunds" testId="text-payments-received" />
      <SummaryStat label="Balance" value={progress.balance == null ? 'Unknown' : plainInr(progress.balance)} detail={progress.balance == null ? 'Set order value to calculate' : progress.balance < 0 ? 'Paid exceeds order value' : 'Order value less paid'} testId="text-payment-balance" />
    </div>
    <Card className="border-border/80" data-testid="card-payments">
      <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Payment register</p>
          <CardTitle className="mt-1 text-base">Receipts, bounces and refunds</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Only received receipts count toward Paid; refunds reduce it. Voids and bounces remain in the audit trail.</p>
        </div>
        {canEdit && <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={progress.paid <= 0} onClick={() => { setRefundAmount(''); setRefundDate(localDateInput()); setRefundNotes(''); setRefundDialogOpen(true); }} data-testid="button-record-refund"><RotateCcw size={14} /> Record refund</Button>
          <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="button-record-payment"><Plus size={14} /> Record payment</Button>
        </div>}
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="rounded-xl border border-border/70 bg-muted/15 p-4" data-testid="section-payment-progress">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Payment progress</p><p className="mt-1 text-sm font-semibold">{plainInr(progress.paid)} paid <span className="font-normal text-muted-foreground">of {order.orderValue == null ? 'order value not set' : plainInr(order.orderValue)}</span></p></div>
            <p className="text-xs text-muted-foreground">{progress.balance == null ? 'Balance unavailable' : `Balance ${plainInr(progress.balance)}`}</p>
          </div>
          <PaymentProgressBar percentage={progress.percentage} testId="progress-order-payment" />
        </section>
        {query.isLoading ? <div className="space-y-3" data-testid="state-payments-loading">{[1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-muted/55" />)}</div>
          : query.isError ? <InlineError onRetry={() => void query.refetch()} label="Payment records could not be loaded." testId="state-payments-error" />
            : payments.length === 0 ? <ZeroState icon={IndianRupee} title="No payment records" description={canEdit ? 'Record the first receipt when funds arrive.' : 'No payments have been persisted for this order.'} testId="state-payments-empty" />
              : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs">
                <thead><tr className="border-b border-border/70 text-[10px] uppercase tracking-[0.13em] text-muted-foreground"><th className="px-3 py-3">Paid at</th><th className="px-3 py-3">Amount</th><th className="px-3 py-3">Method</th><th className="px-3 py-3">Reference</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Actions</th></tr></thead>
                <tbody>{payments.map((payment) => <tr key={payment.id} className="border-b border-border/50 last:border-0" data-testid={`row-payment-${payment.id}`}>
                  <td className="px-3 py-3"><p>{dateLabel(payment.paidAt)}</p><p className="mt-1 text-[10px] text-muted-foreground">by {payment.createdBy}</p></td>
                  <td className="px-3 py-3 font-semibold" data-testid={`text-payment-amount-${payment.id}`}>{plainInr(payment.amount)}</td>
                  <td className="px-3 py-3 capitalize">{readable(payment.method)}</td>
                  <td className="px-3 py-3 text-muted-foreground">{payment.reference || '—'}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-md px-2 py-1 text-[10px] font-bold ${payment.status === OrderPaymentStatus.received ? 'bg-emerald-100 text-emerald-800' : payment.status === 'bounced' ? 'bg-rose-100 text-rose-800' : 'bg-muted text-muted-foreground'}`}>{payment.status === OrderPaymentStatus.received ? 'Received' : payment.status === 'bounced' ? 'Bounced' : 'Void'}</span>
                    {payment.voidReason && <p className="mt-1 max-w-[160px] truncate text-[10px] text-muted-foreground" title={payment.voidReason}>{payment.voidReason}</p>}
                    {payment.bounceReason && <p className="mt-1 max-w-[200px] text-[10px] text-rose-700" title={payment.bounceReason}>{payment.bounceReason} · {payment.bouncedAt ? dateLabel(payment.bouncedAt) : 'date unavailable'}</p>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {canEdit && payment.status === OrderPaymentStatus.received && <div className="inline-flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="text-rose-700 hover:text-rose-800" onClick={() => { setBounceTarget(payment); setBounceDate(localDateInput()); setBounceReason(''); setCreateBounceFlag(false); }} data-testid={`button-bounce-payment-${payment.id}`}><RotateCcw size={13} /> Bounce</Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={voidingId === payment.id} onClick={() => voidPaymentRecord(payment)} data-testid={`button-void-payment-${payment.id}`}>{voidingId === payment.id ? <Loader2 className="animate-spin" size={13} /> : <Archive size={13} />} Void</Button>
                    </div>}
                  </td>
                </tr>)}</tbody>
              </table></div>}
      </CardContent>
    </Card>
    <Card className="border-border/80" data-testid="card-order-refunds">
      <CardHeader className="pb-3"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Refund ledger</p><CardTitle className="mt-1 text-base">Refunds</CardTitle></CardHeader>
      <CardContent>
        {refundsQuery.isLoading ? <div className="h-12 animate-pulse rounded-xl bg-muted/55" data-testid="state-refunds-loading" />
          : refundsQuery.isError ? <InlineError onRetry={() => void refundsQuery.refetch()} label="Refund records could not be loaded." testId="state-refunds-error" />
            : refunds.length === 0 ? <p className="text-xs text-muted-foreground" data-testid="state-refunds-empty">No refunds recorded for this order.</p>
              : <div className="divide-y divide-border/60" data-testid="list-order-refunds">{refunds.map((refund) => <div key={refund.id} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0" data-testid={`row-order-refund-${refund.id}`}>
                <div><p className="text-xs font-semibold">{plainInr(refund.amount)} <span className="font-normal text-muted-foreground">· {dateLabel(refund.refundDate)}</span></p>{refund.notes && <p className="mt-1 max-w-xl text-[11px] text-muted-foreground">{refund.notes}</p>}<p className="mt-1 text-[10px] text-muted-foreground">Recorded by {refund.createdBy}</p></div>
              </div>)}</div>}
      </CardContent>
    </Card>
    <PaymentDialog orderId={orderId} open={dialogOpen} onOpenChange={setDialogOpen} onComplete={refreshLedger} />
    {bounceTarget && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="bounce-payment-title" data-testid="dialog-bounce-payment">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-700">Receipt status</p><h2 id="bounce-payment-title" className="mt-1 font-display text-xl font-bold">Mark receipt bounced</h2><p className="mt-1 text-xs text-muted-foreground">{plainInr(bounceTarget.amount)} · {dateLabel(bounceTarget.paidAt)}</p></div><Button type="button" size="sm" variant="ghost" onClick={() => setBounceTarget(null)}>Close</Button></div>
        <form onSubmit={submitBounce} className="mt-5 space-y-4">
          <label className="block"><span className="mb-1.5 block text-xs font-semibold">Bounce date</span><Input type="date" required value={bounceDate} onChange={(event) => setBounceDate(event.target.value)} data-testid="input-payment-bounce-date" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold">Reason</span><Textarea required minLength={3} maxLength={500} rows={3} value={bounceReason} onChange={(event) => setBounceReason(event.target.value)} placeholder="Enter the bank’s reason" data-testid="textarea-payment-bounce-reason" /></label>
          <label className="flex items-start gap-2 rounded-lg border border-border/70 p-3 text-xs leading-5"><input type="checkbox" className="mt-1 accent-primary" checked={createBounceFlag} onChange={(event) => setCreateBounceFlag(event.target.checked)} data-testid="checkbox-create-bounce-flag" /><span><span className="font-semibold">Also create a Bounced Payment flag</span><span className="block text-muted-foreground">Adds an issue-tracking flag with the receipt amount, date and reason. It does not change the ledger.</span></span></label>
          <div className="flex justify-end gap-2 border-t border-border/70 pt-4"><Button type="button" variant="outline" onClick={() => setBounceTarget(null)}>Cancel</Button><Button type="submit" disabled={bouncePayment.isPending || createFlag.isPending} data-testid="button-confirm-bounce-payment">{bouncePayment.isPending ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />} Mark bounced</Button></div>
        </form>
      </div>
    </div>}
    {refundDialogOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="refund-payment-title" data-testid="dialog-record-refund">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Refund ledger</p><h2 id="refund-payment-title" className="mt-1 font-display text-xl font-bold">Record refund</h2><p className="mt-1 text-xs text-muted-foreground">Up to {plainInr(Math.max(0, progress.paid))} can be refunded.</p></div><Button type="button" size="sm" variant="ghost" onClick={() => setRefundDialogOpen(false)}>Close</Button></div>
        <form onSubmit={submitRefund} className="mt-5 space-y-4">
          <label className="block"><span className="mb-1.5 block text-xs font-semibold">Refund amount (INR)</span><Input required type="number" min="0.01" max={Math.max(0, progress.paid)} step="0.01" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} data-testid="input-refund-amount" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold">Refund date</span><Input required type="date" value={refundDate} onChange={(event) => setRefundDate(event.target.value)} data-testid="input-refund-date" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold">Notes <span className="font-normal text-muted-foreground">(optional)</span></span><Textarea maxLength={500} rows={3} value={refundNotes} onChange={(event) => setRefundNotes(event.target.value)} placeholder="Add a note for the audit trail" data-testid="textarea-refund-notes" /></label>
          <div className="flex justify-end gap-2 border-t border-border/70 pt-4"><Button type="button" variant="outline" onClick={() => setRefundDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={recordRefund.isPending || !refundAmount || Number(refundAmount) <= 0 || Number(refundAmount) > Math.max(0, progress.paid)} data-testid="button-save-refund">{recordRefund.isPending ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Save refund</Button></div>
        </form>
      </div>
    </div>}
  </div>;
}

function DocumentsPanel({ orderId, user }: { orderId: string; user: User }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const query = useListOrderDocuments(orderId, { query: { queryKey: getListOrderDocumentsQueryKey(orderId) } });
  const categoryQuery = useListOrderDocumentCategories({ query: { queryKey: getListOrderDocumentCategoriesQueryKey(), refetchOnWindowFocus: true } });
  const upload = useUploadOrderDocument();
  const replace = useReplaceOrderDocument();
  const archive = useArchiveOrderDocument();
  const createCategory = useCreateOrderDocumentCategory();
  const updateCategory = useUpdateOrderDocumentCategory();
  const deleteCategory = useDeleteOrderDocumentCategory();
  const [category, setCategory] = useState<DocumentCategory>('other');
  const [fileKey, setFileKey] = useState(0);
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [replacingDocumentId, setReplacingDocumentId] = useState<string | null>(null);
  const replaceInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const download = useDownloadOrderDocument(orderId, downloadId || '', { query: { enabled: Boolean(downloadId), queryKey: getDownloadOrderDocumentQueryKey(orderId, downloadId || '') } });
  const preview = useDownloadOrderDocument(orderId, previewId || '', { query: { enabled: Boolean(previewId), queryKey: getDownloadOrderDocumentQueryKey(orderId, previewId || '') } });
  const documents = query.data || [];
  const categories = categoryQuery.data || [];
  const categoriesById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);
  const selectedModule = categoriesById.get(category)?.requiredModule || 'order-hub';
  const canConfigureCategories = hasPermission(user, 'order-hub');

  useEffect(() => {
    if (categories.length && !categoriesById.has(category)) {
      setCategory(categoriesById.has('other') ? 'other' : categories[0].id);
    }
  }, [categories, categoriesById, category]);

  useEffect(() => {
    if (!download.data || !downloadId) return;
    const url = URL.createObjectURL(download.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = documents.find((item) => item.id === downloadId)?.filename || 'order-document';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloadId(null);
  }, [download.data, downloadId, documents]);
  useEffect(() => {
    if (!downloadId || !download.isError) return;
    toast({ title: 'Document download failed', description: 'Please try downloading it again.', variant: 'destructive' });
    setDownloadId(null);
  }, [download.isError, downloadId, toast]);
  useEffect(() => {
    if (!previewId || !preview.isError) return;
    toast({ title: 'Document preview failed', description: 'Download the file to open it in another app.', variant: 'destructive' });
    setPreviewId(null);
  }, [preview.isError, previewId, toast]);

  const categoryLabel = (id: string) => categoriesById.get(id)?.label || readable(id);
  const categoryModule = (id: string) => categoriesById.get(id)?.requiredModule || 'order-hub';
  const filteredDocuments = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const result = documents.filter((item) => {
      const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
      const haystack = `${item.filename} ${categoryLabel(item.category)} ${item.contentType} ${item.uploadedBy}`.toLocaleLowerCase();
      return matchesCategory && (!needle || haystack.includes(needle));
    });
    return result.sort((a, b) => {
      if (sortBy === 'name-asc') return a.filename.localeCompare(b.filename);
      if (sortBy === 'name-desc') return b.filename.localeCompare(a.filename);
      if (sortBy === 'size-desc') return b.sizeBytes - a.sizeBytes;
      if (sortBy === 'size-asc') return a.sizeBytes - b.sizeBytes;
      const dateA = new Date(a.uploadedAt).getTime() || 0;
      const dateB = new Date(b.uploadedAt).getTime() || 0;
      return sortBy === 'oldest' ? dateA - dateB : dateB - dateA;
    });
  }, [documents, search, categoryFilter, sortBy, categoriesById]);

  const uploadFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !hasPermission(user, selectedModule)) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'Document is too large', description: 'Choose a file that is 10 MiB or smaller.', variant: 'destructive' });
      return;
    }
    if (!/\.(pdf|png|jpe?g|webp|docx|xlsx)$/i.test(file.name)) {
      toast({ title: 'Unsupported document type', description: 'Choose a PDF, PNG, JPEG, WebP, DOCX, or XLSX file.', variant: 'destructive' });
      return;
    }
    upload.mutate({ id: orderId, category, filename: encodeURIComponent(file.name), data: file }, { onSuccess: () => { toast({ title: 'Document uploaded' }); setFileKey((value) => value + 1); void queryClient.invalidateQueries({ queryKey: getListOrderDocumentsQueryKey(orderId) }); void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(orderId) }); }, onError: () => toast({ title: 'Document could not be uploaded', variant: 'destructive' as const }) });
  };

  const replaceFile = (event: ChangeEvent<HTMLInputElement>, documentRecord: OrderDocument) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !hasPermission(user, categoryModule(documentRecord.category))) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'Document is too large', description: 'Choose a file that is 10 MiB or smaller.', variant: 'destructive' });
      return;
    }
    if (!/\.(pdf|png|jpe?g|webp|docx|xlsx)$/i.test(file.name)) {
      toast({ title: 'Unsupported document type', description: 'Choose a PDF, PNG, JPEG, WebP, DOCX, or XLSX file.', variant: 'destructive' });
      return;
    }
    setReplacingDocumentId(documentRecord.id);
    replace.mutate({ id: orderId, documentId: documentRecord.id, filename: encodeURIComponent(file.name), data: file }, {
      onSuccess: (updated) => {
        setReplacingDocumentId(null);
        setPreviewId(null);
        queryClient.setQueryData<OrderDocument[]>(getListOrderDocumentsQueryKey(orderId), (current) =>
          current?.map((item) => item.id === updated.id ? updated : item) ?? [],
        );
        void queryClient.invalidateQueries({ queryKey: getListOrderDocumentsQueryKey(orderId) });
        void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(orderId) });
        void queryClient.invalidateQueries({ queryKey: getDownloadOrderDocumentQueryKey(orderId, documentRecord.id) });
        toast({ title: 'Document replaced', description: `${updated.filename} now replaces ${documentRecord.filename}.` });
      },
      onError: () => {
        setReplacingDocumentId(null);
        toast({ title: 'Document could not be replaced', description: 'Check the file type, size and your category access.', variant: 'destructive' });
      },
    });
  };

  const remove = (documentRecord: OrderDocument) => {
    if (!hasPermission(user, categoryModule(documentRecord.category)) || !window.confirm(`Remove ${documentRecord.filename}?`)) return;
    archive.mutate({ id: orderId, documentId: documentRecord.id }, { onSuccess: () => { toast({ title: 'Document removed' }); void queryClient.invalidateQueries({ queryKey: getListOrderDocumentsQueryKey(orderId) }); void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(orderId) }); }, onError: () => toast({ title: 'Document could not be removed', variant: 'destructive' as const }) });
  };

  const saveCategory = () => {
    const name = categoryName.trim().replace(/\s+/g, ' ');
    if (!name) { setCategoryError('Enter a category name.'); return; }
    setCategoryError(null);
    const onSuccess = () => {
      setCategoryName('');
      setEditingCategoryId(null);
      setCategoryError(null);
      toast({ title: editingCategoryId ? 'Category updated' : 'Category added' });
      void queryClient.invalidateQueries({ queryKey: getListOrderDocumentCategoriesQueryKey() });
    };
    const onError = (error: Error) => setCategoryError(error.message || 'Category could not be saved.');
    if (editingCategoryId) {
      updateCategory.mutate({ categoryId: editingCategoryId, data: { name } }, { onSuccess, onError });
    } else {
      createCategory.mutate({ data: { name } }, { onSuccess, onError });
    }
  };

  const editCategory = (item: OrderDocumentCategoryConfig) => {
    setEditingCategoryId(item.id);
    setCategoryName(item.label);
    setCategoryError(null);
  };

  const removeCategory = (item: OrderDocumentCategoryConfig) => {
    if (!window.confirm(`Delete the "${item.label}" category? Categories used by documents cannot be deleted.`)) return;
    setCategoryError(null);
    deleteCategory.mutate({ categoryId: item.id }, {
      onSuccess: () => {
        if (category === item.id) setCategory('other');
        setEditingCategoryId(null);
        setCategoryName('');
        setCategoryError(null);
        toast({ title: 'Category deleted' });
        void queryClient.invalidateQueries({ queryKey: getListOrderDocumentCategoriesQueryKey() });
      },
      onError: (error) => setCategoryError(error.message || 'Category could not be deleted.'),
    });
  };

  const canSaveCategory = !createCategory.isPending && !updateCategory.isPending;
  const documentActions = (item: OrderDocument) => <div className="flex shrink-0 flex-wrap justify-end gap-2">
    <Button type="button" variant="outline" size="sm" onClick={() => setPreviewId(item.id)} data-testid={`button-preview-document-${item.id}`}><Eye size={13} /> View</Button>
    <Button type="button" variant="outline" size="sm" disabled={downloadId === item.id} onClick={() => setDownloadId(item.id)} data-testid={`button-download-document-${item.id}`}>{downloadId === item.id ? <Loader2 className="animate-spin" size={13} /> : <Download size={13} />} Download</Button>
    {hasPermission(user, categoryModule(item.category)) && <>
      <input
        ref={(node) => { replaceInputs.current[item.id] = node; }}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx"
        className="sr-only"
        aria-label={`Choose a replacement for ${item.filename}`}
        disabled={replace.isPending}
        onChange={(event) => replaceFile(event, item)}
        data-testid={`input-replace-document-${item.id}`}
      />
      <Button type="button" variant="outline" size="sm" disabled={replace.isPending} onClick={() => replaceInputs.current[item.id]?.click()} data-testid={`button-replace-document-${item.id}`}>
        {replacingDocumentId === item.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {replacingDocumentId === item.id ? 'Replacing…' : 'Replace file'}
      </Button>
      <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" disabled={archive.isPending} onClick={() => remove(item)} aria-label={`Remove ${item.filename}`} data-testid={`button-remove-document-${item.id}`}><Trash2 size={14} /></Button>
    </>}
  </div>;

  return <div className="space-y-5">
    <Card className="border-border/80" data-testid="card-document-upload">
      <CardHeader className="pb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Document intake</p>
        <CardTitle className="mt-1 text-base">Attach to order</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">Category access controls both upload and removal.</p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-[minmax(16rem,24rem)_1fr] sm:items-end">
          <div className="min-w-0">
            <label className="text-xs font-semibold" htmlFor="document-category">Category</label>
            <Select value={category} onValueChange={(value) => setCategory(value)} disabled={categoryQuery.isLoading || categories.length === 0}>
              <SelectTrigger id="document-category" className="mt-1 h-10" data-testid="select-document-category"><SelectValue placeholder="Choose a category" /></SelectTrigger>
              <SelectContent>{categories.map((item) => <SelectItem value={item.id} key={item.id}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 ${!hasPermission(user, selectedModule) || upload.isPending || categories.length === 0 ? 'pointer-events-none opacity-50' : ''}`} data-testid="button-upload-document">
              <Upload size={14} /> {upload.isPending ? 'Uploading…' : 'Choose file'}
              <input key={fileKey} type="file" className="sr-only" disabled={!hasPermission(user, selectedModule) || upload.isPending || categories.length === 0} onChange={uploadFile} data-testid="input-upload-document" />
            </label>
            {canConfigureCategories && <Button type="button" variant="outline" className="h-10" onClick={() => { setCategoryDialogOpen(true); setCategoryError(null); }} data-testid="button-document-category-config"><Settings2 size={14} /> Category configuration</Button>}
          </div>
        </div>
        {categoryQuery.isError && <div className="mt-3"><InlineError onRetry={() => void categoryQuery.refetch()} label="Document categories could not be loaded." testId="state-document-categories-error" /></div>}
      </CardContent>
    </Card>

    <Card className="border-border/80" data-testid="card-documents">
      <CardHeader className="pb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Order repository</p>
        <CardTitle className="mt-1 text-base">Documents <span className="font-mono text-xs font-normal text-muted-foreground" data-testid="count-documents">{documents.length}</span></CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(9rem,12rem)_minmax(9rem,12rem)_auto]">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search documents" aria-label="Search documents" className="pl-9" data-testid="input-document-search" />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger aria-label="Filter documents by category" data-testid="select-document-filter"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((item) => <SelectItem value={item.id} key={item.id}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger aria-label="Sort documents" data-testid="select-document-sort"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="name-asc">Name A–Z</SelectItem>
              <SelectItem value="name-desc">Name Z–A</SelectItem>
              <SelectItem value="size-desc">Largest file</SelectItem>
              <SelectItem value="size-asc">Smallest file</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center justify-end gap-1 rounded-lg border border-border p-1" role="group" aria-label="Document layout">
            <Button type="button" variant={layout === 'list' ? 'secondary' : 'ghost'} size="icon" aria-label="List layout" aria-pressed={layout === 'list'} onClick={() => setLayout('list')} data-testid="button-view-documents-list"><List size={16} /></Button>
            <Button type="button" variant={layout === 'grid' ? 'secondary' : 'ghost'} size="icon" aria-label="Grid layout" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')} data-testid="button-view-documents-grid"><Grid2X2 size={16} /></Button>
          </div>
        </div>

        {query.isLoading ? <div className="space-y-3" data-testid="state-documents-loading">{[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-muted/55" />)}</div>
          : query.isError ? <InlineError onRetry={() => void query.refetch()} label="Documents could not be loaded." testId="state-documents-error" />
            : documents.length === 0 ? <ZeroState icon={FileText} title="No documents attached" description="This order has no persisted documents in its repository." testId="state-documents-empty" />
              : filteredDocuments.length === 0 ? <div className="rounded-xl border border-dashed border-border bg-muted/15 px-5 py-10 text-center" data-testid="state-documents-no-match">
                <Search className="mx-auto text-muted-foreground/60" size={24} /><p className="mt-3 text-sm font-semibold">No matching documents</p><p className="mt-1 text-xs text-muted-foreground">Try another search or category filter.</p>
                <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => { setSearch(''); setCategoryFilter('all'); }} data-testid="button-clear-document-filters">Clear filters</Button>
              </div>
                : layout === 'list' ? <div className="divide-y divide-border/60" data-testid="list-documents">
                  {filteredDocuments.map((item) => <div key={item.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-document-${item.id}`}>
                    <div className="flex min-w-0 items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><FileText size={16} /></div><div className="min-w-0"><p className="truncate text-sm font-semibold" data-testid={`text-document-name-${item.id}`}>{item.filename}</p><p className="mt-1 text-[11px] text-muted-foreground">{categoryLabel(item.category)} · {item.contentType} · {formatBytes(item.sizeBytes)}</p><p className="mt-1 text-[10px] text-muted-foreground">Uploaded by {item.uploadedBy} · {dateLabel(item.uploadedAt)}</p></div></div>
                    {documentActions(item)}
                  </div>)}
                </div> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="grid-documents">
                  {filteredDocuments.map((item) => <article key={item.id} className="flex min-w-0 flex-col justify-between gap-4 rounded-xl border border-border/70 bg-background/40 p-4" data-testid={`row-document-${item.id}`}>
                    <div className="flex min-w-0 items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><FileText size={16} /></div><div className="min-w-0"><p className="break-words text-sm font-semibold" data-testid={`text-document-name-${item.id}`}>{item.filename}</p><p className="mt-1 text-[11px] text-muted-foreground">{categoryLabel(item.category)} · {formatBytes(item.sizeBytes)}</p><p className="mt-1 text-[10px] text-muted-foreground">{item.contentType} · {dateLabel(item.uploadedAt)}</p><p className="mt-1 text-[10px] text-muted-foreground">Uploaded by {item.uploadedBy}</p></div></div>
                    <div className="flex justify-end border-t border-border/60 pt-3">{documentActions(item)}</div>
                  </article>)}
                </div>}
      </CardContent>
    </Card>

    {categoryDialogOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 sm:items-center" data-testid="dialog-document-categories">
      <section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="document-category-dialog-title">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Order documents</p><h2 id="document-category-dialog-title" className="mt-1 font-display text-xl font-bold">Category configuration</h2><p className="mt-1 text-xs text-muted-foreground">Categories are saved for the workspace. Categories assigned to documents cannot be deleted.</p></div><Button type="button" variant="ghost" size="sm" onClick={() => setCategoryDialogOpen(false)} data-testid="button-close-document-category-config">Close</Button></div>
        <form className="mt-5 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); saveCategory(); }} data-testid="form-document-category">
          <Input value={categoryName} onChange={(event) => { setCategoryName(event.target.value); setCategoryError(null); }} maxLength={64} placeholder="Category name" aria-label="Category name" data-testid="input-document-category-name" />
          <div className="flex shrink-0 gap-2"><Button type="submit" disabled={!canSaveCategory} data-testid="button-save-document-category">{createCategory.isPending || updateCategory.isPending ? <Loader2 size={14} className="animate-spin" /> : editingCategoryId ? <Save size={14} /> : <Plus size={14} />}{editingCategoryId ? 'Save changes' : 'Add category'}</Button>{editingCategoryId && <Button type="button" variant="outline" onClick={() => { setEditingCategoryId(null); setCategoryName(''); setCategoryError(null); }} data-testid="button-cancel-edit-document-category">Cancel</Button>}</div>
        </form>
        {categoryError && <p className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert" data-testid="error-document-category">{categoryError}</p>}
        <div className="mt-5 divide-y divide-border rounded-xl border border-border" data-testid="list-document-categories">
          {categoryQuery.isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading categories…</p> : categories.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No categories configured.</p> : categories.map((item) => <div key={item.id} className="flex items-center gap-3 px-3 py-2.5" data-testid={`row-document-category-${item.id}`}>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.label}</p><p className="mt-0.5 text-[10px] text-muted-foreground">Upload access: {readable(item.requiredModule)} edit</p></div>
            <Button type="button" variant="ghost" size="icon" aria-label={`Edit ${item.label}`} title={`Edit ${item.label}`} onClick={() => editCategory(item)} data-testid={`button-edit-document-category-${item.id}`}><Pencil size={14} /></Button>
            <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label={`Delete ${item.label}`} title={`Delete ${item.label}`} disabled={deleteCategory.isPending} onClick={() => removeCategory(item)} data-testid={`button-delete-document-category-${item.id}`}><Trash2 size={14} /></Button>
          </div>)}
        </div>
      </section>
    </div>}
    {previewId && documents.find((item) => item.id === previewId) && <DocumentPreviewDialog
      documentRecord={documents.find((item) => item.id === previewId)!}
      file={preview.data}
      loading={preview.isLoading}
      onClose={() => setPreviewId(null)}
    />}
  </div>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ActivityPanel({ orderId }: { orderId: string }) {
  const query = useListOrderActivity(orderId, { query: { queryKey: getListOrderActivityQueryKey(orderId) } });
  const activity = query.data || [];
  return <Card className="border-border/80" data-testid="card-order-activity"><CardHeader className="pb-3"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Audit trail</p><CardTitle className="mt-1 text-base">User Log</CardTitle><p className="mt-1 text-xs text-muted-foreground">Persisted activity for this order, newest first.</p></CardHeader><CardContent>{query.isLoading ? <div className="space-y-4" data-testid="state-activity-loading">{[1, 2, 3, 4].map((item) => <div key={item} className="h-12 animate-pulse rounded-xl bg-muted/55" />)}</div> : query.isError ? <InlineError onRetry={() => void query.refetch()} label="User Log could not be loaded." testId="state-activity-error" /> : activity.length === 0 ? <ZeroState icon={ClipboardCheck} title="No activity recorded" description="The activity endpoint has no entries for this order yet." testId="state-activity-empty" /> : <div className="relative space-y-0">{activity.map((item, index) => <div key={item.id} className="relative flex gap-4 pb-5 last:pb-0" data-testid={`row-activity-${item.id}`}><div className="relative flex w-8 shrink-0 justify-center"><span className="relative z-10 mt-1 grid h-7 w-7 place-items-center rounded-full border border-primary/30 bg-primary/10 text-[10px] font-bold text-primary">{item.actorName.slice(0, 1).toUpperCase()}</span>{index < activity.length - 1 && <span className="absolute top-8 h-full w-px bg-border" />}</div><div className="min-w-0 flex-1 rounded-xl border border-border/60 bg-background/40 p-3"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="text-xs font-semibold" data-testid={`text-activity-summary-${item.id}`}>{item.summary}</p><time className="shrink-0 text-[10px] text-muted-foreground" dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time></div><p className="mt-1 text-[11px] text-muted-foreground">{item.actorName} · <span className="capitalize">{readable(item.action)}</span></p></div></div>)}</div>}</CardContent></Card>;
}

function GrievancesPanel({ order, user }: { order: Order; user: User }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = hasPermission(user, 'order-hub', 'edit');
  const query = useListOrderGrievances(order.id, { query: { queryKey: getListOrderGrievancesQueryKey(order.id) } });
  const create = useCreateOrderGrievance();
  const grievances = query.data || [];
  const form = useForm<GrievanceFormValues>({
    resolver: zodResolver(grievanceFormSchema),
    defaultValues: { description: '', reportedAt: localDateInput() },
  });
  const descriptionLength = form.watch('description').length;

  const saveGrievance = (values: GrievanceFormValues) => {
    if (!canEdit || order.status !== OrderStatus.installed) return;
    create.mutate({
      id: order.id,
      data: { description: values.description.trim(), reportedAt: values.reportedAt },
    }, {
      onSuccess: () => {
        form.reset({ description: '', reportedAt: localDateInput() });
        toast({ title: 'Grievance recorded', description: 'It is saved in this order’s Grievances tab.' });
        void queryClient.invalidateQueries({ queryKey: getListOrderGrievancesQueryKey(order.id) });
        void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(order.id) });
      },
      onError: () => toast({ title: 'Grievance could not be saved', description: 'Check the order status and try again.', variant: 'destructive' }),
    });
  };

  return <div className="grid gap-5 xl:grid-cols-[minmax(300px,.82fr)_minmax(0,1.18fr)]" data-testid="panel-order-grievances">
    <Card className="h-fit overflow-hidden border-border/80 shadow-sm" data-testid="card-order-grievance-form">
      <CardHeader className="border-b border-border/60 bg-muted/20 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Customer care · order record</p><CardTitle className="mt-1 text-base">Grievances</CardTitle><p className="mt-1 text-xs leading-5 text-muted-foreground">Post-installation concerns stay attached to this order for the team to follow.</p></div>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-primary"><MessageSquareText size={17} /></span>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/70 px-3 py-2">
          <span className="text-[9px] font-bold uppercase tracking-[.13em] text-muted-foreground">Linked order</span>
          <span className="font-mono text-xs font-bold text-foreground">{order.orderId}</span>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {order.status !== OrderStatus.installed
          ? <div className="flex gap-3 rounded-xl border border-dashed border-border bg-muted/15 p-4 text-xs leading-5 text-muted-foreground" data-testid="state-grievance-installation-required"><Wrench className="mt-0.5 shrink-0 text-primary/75" size={16} /><span>A grievance can be added after this order is marked installed in the Installation module.</span></div>
          : !canEdit
            ? <div className="flex gap-3 rounded-xl border border-amber-300/70 bg-amber-50 p-4 text-xs leading-5 text-amber-950" data-testid="state-grievance-read-only"><ShieldCheck className="mt-0.5 shrink-0" size={16} /><span>You can view this grievance record. Order edit access is required to add one.</span></div>
            : <Form {...form}>
              <form className="space-y-4" onSubmit={form.handleSubmit(saveGrievance)} data-testid="form-order-grievance">
                <FormField control={form.control} name="description" render={({ field }) => <FormItem>
                  <div className="flex items-center justify-between gap-3"><FormLabel>Customer grievance</FormLabel><span className="font-mono text-[10px] text-muted-foreground" aria-live="polite">{descriptionLength.toLocaleString()} / 3,000</span></div>
                  <FormControl><Textarea {...field} rows={5} maxLength={3000} placeholder="Describe the customer’s concern and the assistance needed…" className="min-h-32 resize-y leading-6" data-testid="textarea-order-grievance" /></FormControl>
                  <FormMessage />
                </FormItem>} />
                <FormField control={form.control} name="reportedAt" render={({ field }) => <FormItem>
                  <FormLabel>Date reported</FormLabel>
                  <FormControl><Input type="date" {...field} data-testid="input-grievance-reported-date" /></FormControl>
                  <FormMessage />
                </FormItem>} />
                <Button type="submit" disabled={create.isPending} className="w-full sm:w-auto" data-testid="button-add-order-grievance">{create.isPending ? <><Loader2 size={14} className="animate-spin" /> Saving grievance…</> : <><Plus size={14} /> Add grievance</>}</Button>
              </form>
            </Form>}
      </CardContent>
    </Card>

    <Card className="overflow-hidden border-border/80 shadow-sm" data-testid="card-order-grievance-history">
      <CardHeader className="border-b border-border/60 pb-4"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Persistent record</p><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">Grievance history</CardTitle><span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-mono text-[10px] font-semibold text-muted-foreground" data-testid="count-order-grievances"><span className="h-1.5 w-1.5 rounded-full bg-primary" />{grievances.length} {grievances.length === 1 ? 'record' : 'records'}</span></div><p className="text-xs text-muted-foreground">Every report remains connected to {order.orderId}.</p></CardHeader>
      <CardContent>
        {query.isLoading ? <div className="space-y-3" data-testid="state-grievances-loading">{[1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-muted/55" />)}</div>
          : query.isError ? <InlineError onRetry={() => void query.refetch()} label="Grievances could not be loaded." testId="state-grievances-error" />
            : grievances.length === 0 ? <ZeroState icon={MessageSquareText} title="No grievances recorded" description="Post-installation complaints added for this order will be kept here." testId="state-grievances-empty" />
              : <div className="space-y-3">{grievances.map((item: OrderGrievance) => <article key={item.id} className="relative overflow-hidden rounded-xl border border-border/70 bg-background/65 p-4 transition-colors hover:border-primary/25" data-testid={`row-order-grievance-${item.id}`}>
                <span className="absolute inset-y-0 left-0 w-1 bg-amber-400/80" />
                <div className="flex flex-wrap items-start justify-between gap-3 pl-2"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-900">{item.status === 'open' ? 'Open' : item.status}</span><span className="text-[10px] text-muted-foreground">Reported {dateLabel(item.reportedAt)}</span></div><span className="text-[10px] text-muted-foreground">Added by <span className="font-semibold text-foreground/80">{item.createdBy}</span></span></div>
                <p className="mt-3 whitespace-pre-wrap pl-2 text-sm leading-6" data-testid={`text-order-grievance-${item.id}`}>{item.description}</p>
                <p className="mt-3 border-t border-border/50 pl-2 pt-2 text-[9px] text-muted-foreground">Recorded {dateLabel(item.createdAt)}</p>
              </article>)}</div>}
      </CardContent>
    </Card>
  </div>;
}

function InlineError({ onRetry, label, testId }: { onRetry: () => void; label: string; testId: string }) {
  return <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-center" data-testid={testId}><CircleAlert className="mx-auto text-destructive" size={20} /><p className="mt-2 text-sm font-semibold">{label}</p><Button variant="outline" size="sm" className="mt-3" onClick={onRetry} data-testid={`${testId}-retry`}><RefreshCw size={13} /> Retry</Button></div>;
}

function ZeroState({ icon: Icon, title, description, testId }: { icon: typeof FileText; title: string; description: string; testId: string }) {
  return <div className="rounded-xl border border-dashed border-border bg-muted/15 px-5 py-10 text-center" data-testid={testId}><Icon className="mx-auto text-muted-foreground/60" size={25} /><p className="mt-3 text-sm font-semibold">{title}</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{description}</p></div>;
}

export default function OrderDetailPage({ user }: { user: User }) {
  const params = useParams<{ id: string }>();
  const id = params.id || '';
  const order = useGetOrder(id, { query: { enabled: Boolean(id), queryKey: getGetOrderQueryKey(id), refetchInterval: 1000, refetchIntervalInBackground: true } });
  const templates = useListOrderMessageTemplates({ query: { queryKey: getListOrderMessageTemplatesQueryKey() } });
  const record = order.data;
  const windows = useListOrderWindows(id, { query: { queryKey: getListOrderWindowsQueryKey(id) } });
  const payments = useListOrderPayments(id, { query: { enabled: hasPermission(user, 'payments', 'view'), queryKey: getListOrderPaymentsQueryKey(id) } });
  const orderRefunds = useListOrderRefunds(id, { query: { enabled: hasPermission(user, 'payments', 'view'), queryKey: getListOrderRefundsQueryKey(id) } });
  const canReadOrder = hasPermission(user, 'order-hub', 'view');
  const windowRows = windows.data || [];
  const paymentRows = payments.data || [];
  const refundTotal = (orderRefunds.data || []).reduce((sum, refund) => sum + refund.amount, 0);
  const received = paymentRows.filter((payment) => payment.status === OrderPaymentStatus.received).reduce((sum, payment) => sum + payment.amount, 0) - refundTotal;
  const summary = useMemo(() => ({ count: windowRows.length, sqFt: windowRows.reduce((sum, item) => sum + item.sqFt, 0), ready: windowRows.filter((item) => item.frameStatus === OrderWindowReadiness.ready && item.shutterStatus === OrderWindowReadiness.ready && item.glassStatus === OrderGlassStatus.received).length, glass: windowRows.length === 0 ? 'No windows' : windowRows.every((item) => item.glassStatus === OrderGlassStatus.received) ? 'Received' : windowRows.some((item) => item.glassStatus === OrderGlassStatus.partial) ? 'Partial' : 'Pending' }), [windowRows]);
  if (order.isLoading) return <AppShell user={user} title="Order detail" eyebrow="Central order register"><DetailLoading /></AppShell>;
  if (order.isError || !record) return <AppShell user={user} title="Order detail" eyebrow="Central order register"><DetailError onRetry={() => void order.refetch()} /></AppShell>;
  if (!canReadOrder) return <AppShell user={user} title="Order detail" eyebrow="Central order register"><ZeroState icon={CircleAlert} title="Order access is restricted" description="You need order-hub view access to open this order record." testId="state-order-access-restricted" /></AppShell>;
  const timeline = STATUS_OPTIONS.map((item, index) => ({ ...item, active: STATUS_OPTIONS.findIndex((status) => status.value === record.status) >= index, current: item.value === record.status }));
  return <AppShell user={user} title={record.orderId} eyebrow="Module 2 · order record"><div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/order-hub" className="inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline" data-testid="link-back-order-hub"><ArrowLeft size={15} /> Back to order hub</Link><div className="flex items-center gap-2 text-[10px] text-muted-foreground"><span className="h-2 w-2 shrink-0 rounded-full bg-primary" /> <span>Last updated {dateLabel(record.updatedAt)}</span></div></div>
    <section className="order-hub-accent relative overflow-hidden rounded-2xl p-4 text-white shadow-sm sm:p-6 md:p-8" data-testid="section-order-header"><div className="absolute right-10 top-8 h-28 w-28 rounded-full border border-sidebar-primary/20" /><div className="relative flex min-w-0 flex-col justify-between gap-5 lg:flex-row lg:items-end"><div className="min-w-0"><p className="break-all font-mono text-xs font-bold tracking-[0.13em] text-sidebar-primary" data-testid="text-order-id">{record.orderId}</p><h2 className="mt-3 break-words font-display text-2xl font-bold tracking-[-0.04em] sm:text-3xl md:text-4xl" data-testid="text-order-client">{record.clientName}</h2><p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/70"><span className="break-words">{record.locationName}</span> <span className="text-white/40">·</span> <span>created {dateLabel(record.createdAt)}</span></p></div><span className={`inline-flex w-fit shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${statusTone(record.status)}`} data-testid="status-order-detail">{statusLabel(record.status)}</span></div></section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryStat label="Windows" value={String(summary.count)} detail={`${summary.ready} fully ready`} testId="text-summary-window-count" /><SummaryStat label="Total area" value={`${summary.sqFt.toFixed(2)} sq ft`} detail="Summed from window records" testId="text-summary-area" /><SummaryStat label="Glass state" value={summary.glass} detail="Aggregate procurement state" testId="text-summary-glass" /><SummaryStat label="Paid" value={hasPermission(user, 'payments', 'view') ? plainInr(received) : 'Restricted'} detail="Received receipts less refunds" testId="text-summary-received" /></div>
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6" data-testid="section-order-lifecycle"><div className="flex items-center justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Lifecycle trace</p><h2 className="mt-1 font-display text-base font-bold">Where this order is now</h2></div><span className="font-mono text-[10px] text-muted-foreground">SEQ {String(record.sequenceNo).padStart(3, '0')}</span></div><div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">{timeline.map((item, index) => <div key={item.value} className="relative min-w-0" data-testid={`timeline-stage-${item.value}`}>{index < timeline.length - 1 && <div aria-hidden="true" className={`absolute left-7 -right-4 top-3.5 z-0 hidden h-px lg:block ${item.active ? 'bg-primary/35' : 'bg-border'}`} />}<span className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${item.current ? 'border-primary bg-primary text-primary-foreground' : item.active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'}`}>{item.current ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span><p className={`mt-2 min-h-8 text-[10px] font-bold leading-4 ${item.active ? 'text-primary' : 'text-muted-foreground'}`}>{item.label}</p></div>)}</div></section>
    <Tabs key={id} defaultValue={new URLSearchParams(window.location.search).get('tab') === 'documents' ? 'documents' : new URLSearchParams(window.location.search).get('tab') === 'grievances' ? 'grievances' : 'details'} className="w-full" data-testid="tabs-order-detail"><TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-secondary/70 p-1 md:grid-cols-5"><TabsTrigger value="details" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-order-details">Order Details</TabsTrigger><TabsTrigger value="billing" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-billing-payment">Billing &amp; Payment</TabsTrigger><TabsTrigger value="documents" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-order-documents">Order Documents</TabsTrigger><TabsTrigger value="grievances" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-order-grievances">Grievances</TabsTrigger><TabsTrigger value="activity" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-user-log">User Log</TabsTrigger></TabsList>
      <TabsContent value="details" className="space-y-5">
        <OrderQrCard orderId={record.orderId} orderRecordId={record.id} />
        <OrderLotsCard order={record} user={user} id={id} />
        <OrderRecordCard order={record} user={user} id={id} />
        <WindowsPanel orderId={id} user={user} />
        <LifecycleMessageTemplates
          templates={templates.data || []}
          canEdit={user.roleId === 'master-admin'}
          loading={templates.isLoading}
          error={templates.isError}
          onRetry={() => void templates.refetch()}
        />
        <MessagePreview order={record} templates={templates.data || []} canEdit={hasPermission(user, 'order-hub')} />
      </TabsContent>
      <TabsContent value="billing" className="space-y-5"><BillingPanel order={record} user={user} id={id} /><OrderPaymentFlagsPanel orderId={id} user={user} /><PaymentsPanel orderId={id} user={user} order={record} /></TabsContent>
      <TabsContent value="documents"><DocumentsPanel orderId={id} user={user} /></TabsContent>
      <TabsContent value="grievances"><GrievancesPanel order={record} user={user} /></TabsContent>
      <TabsContent value="activity"><ActivityPanel orderId={id} /></TabsContent>
    </Tabs>
  </div></AppShell>;
}