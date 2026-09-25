import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import {
  ArrowLeft,
  Check,
  Clipboard,
  ClipboardCheck,
  CircleAlert,
  FileText,
  LockKeyhole,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Save,
  Wrench,
} from 'lucide-react';
import {
  getGetOrderQueryKey,
  getListOrdersQueryKey,
  getListOrderMessageTemplatesQueryKey,
  OrderStatus,
  useGetOrder,
  useListOrderMessageTemplates,
  useUpdateOrder,
} from '@workspace/api-client-react';
import type { Order, OrderMessageTemplate, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
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
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const detailSchema = z.object({ status: z.string(), notes: z.string().max(2000).nullable().optional() });

function DetailLoading() {
  return <div className="space-y-5" data-testid="state-order-detail-loading"><div className="h-36 animate-pulse rounded-2xl bg-card/80" /><div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]"><div className="h-72 animate-pulse rounded-2xl bg-card/70" /><div className="h-72 animate-pulse rounded-2xl bg-card/70" /></div></div>;
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

function FutureModule({ label, description, index }: { label: string; description: string; index: string }) {
  return <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-3" data-testid={`placeholder-module-${index}`}><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted font-mono text-[10px] font-bold text-muted-foreground">{index}</div><div><p className="text-xs font-semibold text-muted-foreground">{label}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground/75">{description}</p></div><LockKeyhole size={13} className="ml-auto mt-1 shrink-0 text-muted-foreground/55" /></div>;
}

function MessagePreview({ order, templates, canEdit }: { order: Order; templates: OrderMessageTemplate[]; canEdit: boolean }) {
  const { toast } = useToast();
  const template = templates.find((item) => item.status === order.status);
  const initialMessage = template ? fillTemplate(template.template, order) : 'No centrally stored message template is available for this stage.';
  const [message, setMessage] = useState(initialMessage);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  useMemo(() => setMessage(initialMessage), [initialMessage]);
  const copy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    toast({ title: 'Message copied', description: 'The editable stage message is on your clipboard.' });
    window.setTimeout(() => setCopied(false), 1800);
  };
  return <Card className="border-border/80"><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Stage communication</p><CardTitle className="mt-1 text-base">Message preview</CardTitle><p className="mt-1 text-xs text-muted-foreground">{template ? `Centrally stored · ${template.label}` : 'Template not configured for this stage'}</p></div><MessageSquareText size={18} className="text-primary" /></div></CardHeader><CardContent><Textarea value={message} onChange={(event) => setMessage(event.target.value)} readOnly={!editing || !canEdit} rows={7} className="resize-y text-sm leading-6" data-testid="textarea-order-message" /><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] text-muted-foreground">Variables are resolved from this order. You can make a one-off edit before copying.</p><div className="flex gap-2">{canEdit && <Button type="button" size="sm" variant="outline" onClick={() => setEditing((value) => !value)} data-testid="button-edit-order-message"><Pencil size={13} /> {editing ? 'Lock message' : 'Edit copy'}</Button>}<Button type="button" size="sm" onClick={copy} data-testid="button-copy-order-message">{copied ? <Check size={13} /> : <Clipboard size={13} />} {copied ? 'Copied' : 'Copy message'}</Button></div></div></CardContent></Card>;
}

export default function OrderDetailPage({ user }: { user: User }) {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const id = params.id || '';
  const canEdit = user.roleId === 'master-admin' || user.permissions?.['order-hub'] === 'edit';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const order = useGetOrder(id, { query: { enabled: Boolean(id), queryKey: getGetOrderQueryKey(id) } });
  const templates = useListOrderMessageTemplates({ query: { queryKey: getListOrderMessageTemplatesQueryKey() } });
  const update = useUpdateOrder();
  const [editingFacts, setEditingFacts] = useState(false);
  const record = order.data;
  const form = useForm<z.infer<typeof detailSchema>>({ resolver: zodResolver(detailSchema), defaultValues: { status: '', notes: '' } });
  useMemo(() => { if (record) form.reset({ status: record.status, notes: record.notes || '' }); }, [record, form]);

  if (order.isLoading) return <AppShell user={user} title="Order detail" eyebrow="Central order register"><DetailLoading /></AppShell>;
  if (order.isError || !record) return <AppShell user={user} title="Order detail" eyebrow="Central order register"><DetailError onRetry={() => void order.refetch()} /></AppShell>;

  const save = (values: z.infer<typeof detailSchema>) => update.mutate({ id: record.id, data: { status: values.status as Status, notes: values.notes || null } }, { onSuccess: (updated) => { queryClient.setQueryData(getGetOrderQueryKey(id), updated); void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }); setEditingFacts(false); toast({ title: 'Order record updated', description: `${updated.orderId} is now ${statusLabel(updated.status)}.` }); } });
  const timeline = STATUS_OPTIONS.map((item) => ({ ...item, active: STATUS_OPTIONS.findIndex((status) => status.value === record.status) >= STATUS_OPTIONS.findIndex((status) => status.value === item.value), current: item.value === record.status }));

  return <AppShell user={user} title={record.orderId} eyebrow="Module 2 · order record"><div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/order-hub" className="inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline" data-testid="link-back-order-hub"><ArrowLeft size={15} /> Back to order hub</Link><div className="flex items-center gap-2 text-[10px] text-muted-foreground"><span className="h-2 w-2 rounded-full bg-primary" /> Last updated {dateLabel(record.updatedAt)}</div></div>
     <section className="order-hub-accent relative overflow-hidden rounded-2xl p-6 text-white shadow-sm md:p-8"><div className="absolute right-10 top-8 h-28 w-28 rounded-full border border-sidebar-primary/20" /><div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end"><div><p className="font-mono text-xs font-bold tracking-[0.13em] text-sidebar-primary" data-testid="text-order-id">{record.orderId}</p><h2 className="mt-3 font-display text-3xl font-bold tracking-[-0.04em] md:text-4xl" data-testid="text-order-client">{record.clientName}</h2><p className="mt-2 flex items-center gap-2 text-sm text-white/70"><span className="font-mono text-sidebar-primary">{record.locationCode}</span> {record.locationName} <span className="text-white/40">·</span> created {dateLabel(record.createdAt)}</p></div><span className={`inline-flex w-fit rounded-full px-3 py-1.5 text-xs font-bold ${statusTone(record.status)}`} data-testid="status-order-detail">{statusLabel(record.status)}</span></div></section>
     <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
       <div className="flex items-center justify-between gap-4">
         <div>
           <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Lifecycle trace</p>
           <h2 className="mt-1 font-display text-base font-bold">Where this order is now</h2>
         </div>
         <span className="font-mono text-[10px] text-muted-foreground">SEQ {String(record.sequenceNo).padStart(3, '0')}</span>
       </div>
       <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
         {timeline.map((item, index) => (
           <div key={item.value} className="relative min-w-0" data-testid={`timeline-stage-${item.value}`}>
             {index < timeline.length - 1 && (
               <div
                 aria-hidden="true"
                 className={`absolute left-7 -right-4 top-3.5 z-0 hidden h-px lg:block ${item.active ? 'bg-primary/35' : 'bg-border'}`}
               />
             )}
             <span className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${item.current ? 'border-primary bg-primary text-primary-foreground' : item.active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'}`}>
               {item.current ? <Check size={13} /> : String(index + 1).padStart(2, '0')}
             </span>
             <p className={`mt-2 min-h-8 text-[10px] font-bold leading-4 ${item.active ? 'text-primary' : 'text-muted-foreground'}`}>
               {item.label}
             </p>
           </div>
         ))}
       </div>
     </section>
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]"><Card className="border-border/80"><CardHeader className="flex-row items-start justify-between pb-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Order facts</p><CardTitle className="mt-1 text-base">Central record</CardTitle></div>{canEdit && <Button variant="outline" size="sm" onClick={() => setEditingFacts((value) => !value)} data-testid="button-toggle-order-edit"><Pencil size={13} /> {editingFacts ? 'Cancel' : 'Edit record'}</Button>}</CardHeader><CardContent>{editingFacts && canEdit ? <Form {...form}><form onSubmit={form.handleSubmit(save)} className="space-y-4" data-testid="form-order-detail"><FormField control={form.control} name="status" render={({ field }) => <FormItem><FormLabel>Lifecycle status</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger data-testid="select-order-status"><SelectValue /></SelectTrigger></FormControl><SelectContent>{STATUS_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} /><FormField control={form.control} name="notes" render={({ field }) => <FormItem><FormLabel>Internal notes</FormLabel><FormControl><Textarea {...field} value={field.value || ''} rows={5} placeholder="Notes for the office and factory teams" data-testid="textarea-order-notes" /></FormControl><FormMessage /></FormItem>} /><div className="flex justify-end"><Button type="submit" disabled={update.isPending} data-testid="button-save-order-detail"><Save size={14} /> {update.isPending ? 'Saving…' : 'Save order record'}</Button></div></form></Form> : <div className="grid gap-5 sm:grid-cols-2"><div className="order-rule pl-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Client contact</p><p className="mt-2 text-sm font-semibold">{record.clientPhone || 'Not provided'}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{record.clientAddress || 'No address on record'}</p></div><div className="order-rule pl-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Tax identity</p><p className="mt-2 font-mono text-sm font-semibold">{record.clientGstin || 'Not provided'}</p><p className="mt-1 text-xs text-muted-foreground">Client prefix · {record.clientPrefix}</p></div><div className="order-rule pl-4 sm:col-span-2"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Internal notes</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/80">{record.notes || 'No notes have been added to this record.'}</p></div><div className="border-t border-border/70 pt-4 text-[10px] text-muted-foreground sm:col-span-2"><span className="font-semibold text-foreground">Created by</span> {record.createdBy} · <span className="font-semibold text-foreground">Last updated by</span> {record.updatedBy || 'System'}</div></div>}</CardContent></Card><MessagePreview order={record} templates={templates.data || []} canEdit={canEdit} /></div>
    <section><div className="mb-4 flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Connected workbench</p><h2 className="mt-1 font-display text-xl font-bold">What comes next</h2><p className="mt-1 text-xs text-muted-foreground">The same order ID will carry through every specialist module.</p></div><Wrench size={19} className="text-muted-foreground" /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><FutureModule index="01" label="Quotation & documents" description="Quotation builder and central document repository." /><FutureModule index="02" label="Rate approval" description="Approval trail for exceptional rates and margins." /><FutureModule index="03" label="Confirmation / PO" description="Digital confirmation and purchase order generation." /><FutureModule index="04" label="Measurements" description="Versioned site measurements tied to this order." /><FutureModule index="05" label="QR / assembly" description="QR generation and assembly station tracking." /><FutureModule index="06" label="Window readiness" description="Window-wise production readiness." /><FutureModule index="07" label="Glass procurement" description="Glass requirement, delivery, and receipt." /><FutureModule index="08" label="Payments" description="Order value, advances, and balance payments." /><FutureModule index="09" label="Dispatch" description="Dispatch gate, QR scan, and payment alert." /><FutureModule index="10" label="Installation" description="Installation scheduling and completion." /></div></section>
  </div></AppShell>;
}