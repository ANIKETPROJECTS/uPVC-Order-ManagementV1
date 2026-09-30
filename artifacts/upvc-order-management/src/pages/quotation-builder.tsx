import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  BookOpen,
  Calculator,
  CircleAlert,
  Copy,
  FilePlus2,
  FileText,
  LayoutGrid,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  UserRound,
} from 'lucide-react';
import {
  getGetQuotationQueryKey,
  getListClientsQueryKey,
  getListQuotationsQueryKey,
  getListWindowProfilesQueryKey,
  useArchiveQuotation,
  useArchiveWindowProfile,
  useCreateQuotation,
  useCreateWindowProfile,
  useGetQuotation,
  useListClients,
  useListQuotations,
  useListWindowProfiles,
  useUpdateQuotation,
  useUpdateWindowProfile,
} from '@workspace/api-client-react';
import type {
  Client,
  Quotation,
  QuotationInput,
  QuotationItem,
  User,
  WindowProfile,
  WindowProfileInput,
} from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

const drawingTypes = ['casement', 'sliding', 'mixed', 'louvre'] as const;
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const money = (value: number | null | undefined) => `₹${(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
const roundTo = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const SQ_FT_PER_SQUARE_MM = 92903.04;

const profileSchema = z.object({
  code: z.string().min(1, 'Add a catalogue code.').max(24),
  name: z.string().min(2, 'Add a profile name.').max(120),
  profileSystem: z.string().min(1, 'Add the profile system.').max(240),
  glass: z.string().max(120),
  profileColor: z.string().max(80),
  meshType: z.string().max(120),
  specifications: z.string().max(3000),
  accessories: z.string().max(1500),
  drawingType: z.enum(drawingTypes),
  ratePerSqFt: z.coerce.number().min(0),
  weightKgPerSqFt: z.coerce.number().min(0),
});

const quoteSchema = z.object({
  clientId: z.string(),
  customerName: z.string().min(1, 'Customer name is required.').max(160),
  customerPhone: z.string().max(40),
  customerAddress: z.string().max(600),
  customerGstin: z.string().max(20),
  projectName: z.string().max(160),
  quotationDate: z.string().min(1),
  transportationCost: z.coerce.number().min(0),
  loadingUnloadingCost: z.coerce.number().min(0),
  additionalChargeDescription: z.string().max(160),
  additionalChargeRate: z.coerce.number().min(0),
  additionalChargeAreaSqFt: z.coerce.number().min(0),
  gstPercent: z.coerce.number().min(0).max(100),
  notes: z.string().max(2000),
});

type ProfileValues = z.infer<typeof profileSchema>;
type QuoteValues = z.infer<typeof quoteSchema>;
type EditableLine = {
  profileId: string;
  profileName?: string;
  code: string;
  location: string;
  widthMm: number;
  heightMm: number;
  quantity: number;
  ratePerSqFt?: number;
  weightKgPerWindow?: number;
};

const blankProfile: ProfileValues = {
  code: '',
  name: '',
  profileSystem: 'SIMTA 60MM CASEMENT SERIES',
  glass: '',
  profileColor: 'White',
  meshType: 'None',
  specifications: '',
  accessories: '',
  drawingType: 'casement',
  ratePerSqFt: 0,
  weightKgPerSqFt: 0,
};

const blankQuote: QuoteValues = {
  clientId: '',
  customerName: '',
  customerPhone: '',
  customerAddress: '',
  customerGstin: '',
  projectName: '',
  quotationDate: today(),
  transportationCost: 0,
  loadingUnloadingCost: 0,
  additionalChargeDescription: '',
  additionalChargeRate: 0,
  additionalChargeAreaSqFt: 0,
  gstPercent: 18,
  notes: '',
};

function StatePanel({ kind, onRetry }: { kind: 'loading' | 'error' | 'empty'; onRetry?: () => void }) {
  if (kind === 'loading') {
    return <div className="space-y-3" data-testid="state-quotation-loading"><div className="h-16 animate-pulse rounded-xl bg-muted" /><div className="h-16 animate-pulse rounded-xl bg-muted/80" /><div className="h-16 animate-pulse rounded-xl bg-muted/60" /></div>;
  }
  if (kind === 'empty') {
    return <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-border bg-card/60 p-8 text-center" data-testid="state-quotation-empty"><div><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-secondary text-primary"><FileText size={20} /></div><h3 className="mt-3 font-display text-sm font-bold">No saved drafts yet</h3><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Start with a blank customer-ready quote or select a reusable profile below.</p></div></div>;
  }
  return <div className="grid min-h-56 place-items-center rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center" data-testid="state-quotation-error"><div><CircleAlert className="mx-auto text-destructive" size={22} /><h3 className="mt-3 font-display text-sm font-bold">Quotation desk is offline</h3><p className="mt-1 text-xs text-muted-foreground">The saved records could not be loaded.</p><Button size="sm" variant="outline" className="mt-4" onClick={onRetry} data-testid="button-retry-quotations"><RefreshCw size={13} /> Retry</Button></div></div>;
}

function ProfileDialog({ open, onOpenChange, editing, onDone }: { open: boolean; onOpenChange: (value: boolean) => void; editing: WindowProfile | null; onDone: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateWindowProfile();
  const update = useUpdateWindowProfile();
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: blankProfile });

  useEffect(() => {
    if (open) form.reset(editing ? {
      code: editing.code,
      name: editing.name,
      profileSystem: editing.profileSystem,
      glass: editing.glass,
      profileColor: editing.profileColor,
      meshType: editing.meshType,
      specifications: editing.specifications,
      accessories: editing.accessories,
      drawingType: editing.drawingType,
      ratePerSqFt: editing.ratePerSqFt,
      weightKgPerSqFt: editing.weightKgPerSqFt,
    } : blankProfile);
  }, [editing, form, open]);

  const save = (values: ProfileValues) => {
    const data: WindowProfileInput = values;
    const done = () => {
      void queryClient.invalidateQueries({ queryKey: getListWindowProfilesQueryKey() });
      toast({ title: editing ? 'Profile updated' : 'Profile added', description: `${values.code} is ready for quoting.` });
      onDone();
    };
    if (editing) update.mutate({ profileId: editing.id, data }, { onSuccess: done });
    else create.mutate({ data }, { onSuccess: done });
  };
  const busy = create.isPending || update.isPending;
  const field = (name: keyof ProfileValues, label: string, placeholder: string, type = 'text') => (
    <FormField control={form.control} name={name} render={({ field: input }) => <FormItem><FormLabel>{label}</FormLabel><FormControl><Input {...input} type={type} value={input.value as string | number} placeholder={placeholder} data-testid={`input-profile-${name}`} /></FormControl><FormMessage /></FormItem>}
    />
  );

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>{editing ? 'Edit window profile' : 'Add window profile'}</DialogTitle><DialogDescription>Catalogue the exact profile snapshot that quoting staff can reuse on every proposal.</DialogDescription></DialogHeader><Form {...form}><form onSubmit={form.handleSubmit(save)} className="space-y-4" data-testid="form-window-profile"><div className="grid gap-4 sm:grid-cols-3">{field('code', 'Catalogue code', 'SIM-060-CAS')}{field('name', 'Profile name', 'OPANABLE AND EXZ')}{field('profileSystem', 'Profile system', 'SIMTA 60MM CASEMENT SERIES')}</div><div className="grid gap-4 sm:grid-cols-3">{field('glass', 'Glass', '4 MM frosted glass')}{field('profileColor', 'Profile colour', 'White')}{field('meshType', 'Mesh', '1 mesh / None')}</div><div className="grid gap-4 sm:grid-cols-2">{field('ratePerSqFt', 'Rate / sq.ft.', '644.97', 'number')}{field('weightKgPerSqFt', 'Weight kg / sq.ft.', '2.80', 'number')}</div><div className="grid gap-4 sm:grid-cols-2"><FormField control={form.control} name="drawingType" render={({ field: input }) => <FormItem><FormLabel>Drawing type</FormLabel><Select value={input.value} onValueChange={input.onChange}><FormControl><SelectTrigger data-testid="select-profile-drawing-type"><SelectValue /></SelectTrigger></FormControl><SelectContent>{drawingTypes.map((value) => <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} /><div /></div><div className="grid gap-4 sm:grid-cols-2"><FormField control={form.control} name="specifications" render={({ field: input }) => <FormItem><FormLabel>Specifications</FormLabel><FormControl><Textarea {...input} rows={4} placeholder="Frame, shutter, reinforcement and hardware detail" data-testid="input-profile-specifications" /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="accessories" render={({ field: input }) => <FormItem><FormLabel>Accessories</FormLabel><FormControl><Textarea {...input} rows={4} placeholder="Handle, stopper, roller, fasteners..." data-testid="input-profile-accessories" /></FormControl><FormMessage /></FormItem>} /></div><DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel-profile">Cancel</Button><Button type="submit" disabled={busy} data-testid="button-save-profile">{busy ? 'Saving…' : editing ? 'Save profile' : 'Add profile'}</Button></DialogFooter></form></Form></DialogContent></Dialog>;
}

function ProfileCatalogue({ profiles, canEdit, loading, error, onRetry, onEdit, onAdd }: { profiles: WindowProfile[]; canEdit: boolean; loading: boolean; error: boolean; onRetry: () => void; onEdit: (profile: WindowProfile) => void; onAdd: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const archive = useArchiveWindowProfile();
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => profiles.filter((profile) => `${profile.code} ${profile.name} ${profile.profileSystem}`.toLowerCase().includes(search.toLowerCase())), [profiles, search]);
  const archiveProfile = (profile: WindowProfile) => {
    if (!window.confirm(`Archive ${profile.code} · ${profile.name}? Existing saved quotations keep their snapshot.`)) return;
    archive.mutate({ profileId: profile.id }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListWindowProfilesQueryKey() }); toast({ title: 'Profile archived', description: `${profile.code} was removed from new quotes.` }); } });
  };
  return <Card className="border-border/80" data-testid="card-profile-catalogue"><CardHeader className="border-b border-border/70 pb-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Reusable rate book</p><CardTitle className="mt-1 font-display text-lg">Window profiles</CardTitle><p className="mt-1 text-xs text-muted-foreground">Rates are starting defaults. A quotation line can override them.</p></div>{canEdit && <Button size="sm" onClick={onAdd} data-testid="button-add-profile"><Plus size={15} /> Add profile</Button>}</div><div className="relative mt-3 max-w-sm"><Search size={15} className="absolute left-3 top-2.5 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search code, name or system" data-testid="input-search-profiles" /></div></CardHeader><CardContent className="p-0">{loading ? <div className="p-5"><StatePanel kind="loading" /></div> : error ? <div className="p-5"><StatePanel kind="error" onRetry={onRetry} /></div> : !filtered.length ? <div className="p-8 text-center text-xs text-muted-foreground" data-testid="state-profile-empty">No active profiles match this search.</div> : <div className="divide-y divide-border/70">{filtered.map((profile) => <div key={profile.id} className="group grid gap-3 p-4 transition-colors hover:bg-secondary/30 sm:grid-cols-[1fr_auto] sm:items-center" data-testid={`row-profile-${profile.id}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-secondary px-2 py-1 font-mono text-[10px] font-bold tracking-wide text-secondary-foreground">{profile.code}</span><span className="text-sm font-semibold">{profile.name}</span><span className="rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">{profile.drawingType}</span></div><p className="mt-1 text-xs text-muted-foreground">{profile.profileSystem} · {profile.glass || 'Glass to be specified'} · {profile.meshType || 'No mesh'}</p><p className="mt-2 text-[11px] text-muted-foreground">{profile.specifications || 'No specification note'} {profile.accessories ? ` · ${profile.accessories}` : ''}</p></div><div className="flex items-center justify-between gap-3 sm:justify-end"><div className="text-right"><p className="font-display text-sm font-bold text-foreground">{money(profile.ratePerSqFt)}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">per sq.ft.</p></div>{canEdit && <div className="flex gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"><Button size="icon" variant="ghost" onClick={() => onEdit(profile)} aria-label={`Edit ${profile.code}`} data-testid={`button-edit-profile-${profile.id}`}><Pencil size={15} /></Button><Button size="icon" variant="ghost" onClick={() => archiveProfile(profile)} aria-label={`Archive ${profile.code}`} data-testid={`button-archive-profile-${profile.id}`}><Archive size={15} /></Button></div>}</div></div>)}</div>}</CardContent></Card>;
}

function ClientSelect({ form, clients }: { form: ReturnType<typeof useForm<QuoteValues>>; clients: Client[] }) {
  const selectedId = form.watch('clientId');
  const locked = Boolean(selectedId);
  const chooseClient = (value: string) => {
    if (value === 'manual') {
      form.resetField('clientId');
      form.setValue('customerName', '');
      form.setValue('customerPhone', '');
      form.setValue('customerAddress', '');
      form.setValue('customerGstin', '');
      return;
    }
    const client = clients.find((item) => item.id === value);
    form.setValue('clientId', value);
    if (client) {
      form.setValue('customerName', client.name);
      form.setValue('customerPhone', client.phone);
      form.setValue('customerAddress', client.address);
      form.setValue('customerGstin', client.gstin || '');
    }
  };
  return <FormField control={form.control} name="clientId" render={({ field }) => <FormItem><FormLabel>Customer source</FormLabel><Select value={field.value || 'manual'} onValueChange={chooseClient}><FormControl><SelectTrigger data-testid="select-quotation-client"><SelectValue placeholder="Enter manually" /></SelectTrigger></FormControl><SelectContent><SelectItem value="manual">Manual customer details</SelectItem>{clients.filter((client) => client.isActive).map((client) => <SelectItem key={client.id} value={client.id}>{client.name} · {client.phone}</SelectItem>)}</SelectContent></Select><p className="text-[10px] text-muted-foreground">{locked ? 'Linked client record is locked; update it in Client & orders.' : 'Select a client to keep identity consistent, or enter details manually.'}</p><FormMessage /></FormItem>} />;
}

function QuoteEditor({ quote, clients, profiles, canEdit, onSaved, onNew }: { quote: Quotation | null; clients: Client[]; profiles: WindowProfile[]; canEdit: boolean; onSaved: (saved: Quotation) => void; onNew: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateQuotation();
  const update = useUpdateQuotation();
  const form = useForm<QuoteValues>({ resolver: zodResolver(quoteSchema), defaultValues: blankQuote });
  const [items, setItems] = useState<EditableLine[]>([]);
  const [draft, setDraft] = useState<EditableLine>({ profileId: '', code: '', location: '', widthMm: 0, heightMm: 0, quantity: 1, ratePerSqFt: undefined });
  const watched = form.watch();
  const selectedProfile = profiles.find((profile) => profile.id === draft.profileId);

  useEffect(() => {
    if (!quote) {
      form.reset(blankQuote);
      setItems([]);
    } else {
      form.reset({ clientId: quote.clientId || '', customerName: quote.customerName, customerPhone: quote.customerPhone, customerAddress: quote.customerAddress, customerGstin: quote.customerGstin || '', projectName: quote.projectName, quotationDate: quote.quotationDate.slice(0, 10), transportationCost: quote.transportationCost, loadingUnloadingCost: quote.loadingUnloadingCost, additionalChargeDescription: quote.additionalChargeDescription, additionalChargeRate: quote.additionalChargeRate, additionalChargeAreaSqFt: quote.additionalChargeAreaSqFt, gstPercent: quote.gstPercent, notes: quote.notes || '' });
       setItems(quote.items.map((item) => ({ profileId: item.profileId, profileName: item.profileName, code: item.code, location: item.location, widthMm: item.widthMm, heightMm: item.heightMm, quantity: item.quantity, ratePerSqFt: item.ratePerSqFt, weightKgPerWindow: item.weightKgPerWindow })));
    }
    setDraft({ profileId: '', code: '', location: '', widthMm: 0, heightMm: 0, quantity: 1, ratePerSqFt: undefined });
  }, [form, quote]);

  const estimate = useMemo(() => {
    const lines = items.map((line) => {
      const profile = profiles.find((item) => item.id === line.profileId);
      const sqFtPerWindow = roundTo((Number(line.widthMm) * Number(line.heightMm)) / SQ_FT_PER_SQUARE_MM, 3);
      const ratePerSqFt = line.ratePerSqFt === undefined || Number.isNaN(line.ratePerSqFt) ? (profile?.ratePerSqFt || 0) : Number(line.ratePerSqFt);
      const unitPrice = roundTo(sqFtPerWindow * ratePerSqFt, 2);
      const value = roundTo(unitPrice * Number(line.quantity), 2);
       const weightKgPerWindow = line.weightKgPerWindow ?? roundTo(sqFtPerWindow * (profile?.weightKgPerSqFt || 0), 3);
      return { ...line, profile, sqFtPerWindow, ratePerSqFt, unitPrice, value, weightKgPerWindow };
    });
    const componentCount = lines.reduce((sum, line) => sum + Number(line.quantity), 0);
    const totalAreaSqFt = roundTo(lines.reduce((sum, line) => sum + line.sqFtPerWindow * Number(line.quantity), 0), 2);
    const basicValue = roundTo(lines.reduce((sum, line) => sum + line.value, 0), 2);
    const transportationCost = roundTo(Number(watched.transportationCost) || 0, 2);
    const loadingUnloadingCost = roundTo(Number(watched.loadingUnloadingCost) || 0, 2);
    const additionalCharge = roundTo((Number(watched.additionalChargeRate) || 0) * (Number(watched.additionalChargeAreaSqFt) || 0), 2);
    const subtotal = roundTo(basicValue + transportationCost + loadingUnloadingCost + additionalCharge, 2);
    const gstPercent = Number(watched.gstPercent) || 0;
    const gstAmount = roundTo((subtotal * gstPercent) / 100, 2);
    return { lines, componentCount, totalAreaSqFt, subtotal, gstPercent, gstAmount, grandTotal: roundTo(subtotal + gstAmount, 2) };
  }, [items, profiles, watched.additionalChargeAreaSqFt, watched.additionalChargeRate, watched.gstPercent, watched.loadingUnloadingCost, watched.transportationCost]);

  const setDraftValue = (key: keyof EditableLine, value: string) => setDraft((current) => ({ ...current, [key]: ['profileId', 'code', 'location'].includes(key) ? value : key === 'ratePerSqFt' && value.trim() === '' ? undefined : Number(value) }));
  const addLine = () => {
    if (!selectedProfile || draft.widthMm <= 0 || draft.heightMm <= 0 || draft.quantity <= 0) {
      toast({ title: 'Complete the window line', description: 'Choose a profile and enter positive dimensions and quantity.', variant: 'destructive' });
      return;
    }
     setItems((current) => [...current, { ...draft, profileName: selectedProfile.name, code: draft.code || selectedProfile.code }]);
    setDraft({ profileId: '', code: '', location: '', widthMm: 0, heightMm: 0, quantity: 1, ratePerSqFt: undefined });
  };
  const save = (values: QuoteValues) => {
    if (!items.length) {
      toast({ title: 'Add at least one window line', description: 'The API needs one component to calculate a quotation.', variant: 'destructive' });
      return;
    }
    const data: QuotationInput = { ...values, clientId: values.clientId || null, customerGstin: values.customerGstin || null, notes: values.notes || null, items: items.map((item) => ({ profileId: item.profileId, code: item.code, location: item.location, widthMm: Number(item.widthMm), heightMm: Number(item.heightMm), quantity: Number(item.quantity), ratePerSqFt: item.ratePerSqFt === undefined || Number.isNaN(item.ratePerSqFt) ? undefined : Number(item.ratePerSqFt) })) };
    const done = (saved: Quotation) => {
      void queryClient.invalidateQueries({ queryKey: getListQuotationsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetQuotationQueryKey(saved.id) });
      toast({ title: quote ? 'Quotation updated' : 'Draft quotation saved', description: `${saved.quoteNo} is ready to inspect or print.` });
      onSaved(saved);
    };
    if (quote) update.mutate({ quotationId: quote.id, data }, { onSuccess: done });
    else create.mutate({ data }, { onSuccess: done });
  };
  const customerField = (name: 'customerName' | 'customerPhone' | 'customerAddress' | 'customerGstin', label: string, multiline = false) => <FormField control={form.control} name={name} render={({ field }) => <FormItem className={multiline ? 'sm:col-span-2' : ''}><FormLabel>{label}</FormLabel><FormControl>{multiline ? <Textarea {...field} rows={2} readOnly={Boolean(form.watch('clientId'))} data-testid={`input-quotation-${name}`} /> : <Input {...field} readOnly={Boolean(form.watch('clientId'))} data-testid={`input-quotation-${name}`} />}</FormControl><FormMessage /></FormItem>} />;
  const busy = create.isPending || update.isPending;

  return <Card className="border-border/80" data-testid="card-quote-editor"><CardHeader className="border-b border-border/70 pb-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{quote ? quote.quoteNo : 'New quotation'}</p><CardTitle className="mt-1 font-display text-lg">{quote ? 'Edit quotation draft' : 'Prepare a new quotation'}</CardTitle><p className="mt-1 text-xs text-muted-foreground">Server-calculated totals are authoritative after save.</p></div>{canEdit && <Button variant="outline" size="sm" onClick={onNew} data-testid="button-new-quotation"><FilePlus2 size={15} /> New draft</Button>}</div></CardHeader><CardContent className="p-5"><Form {...form}><form onSubmit={form.handleSubmit(save)} data-testid="form-quotation"><fieldset disabled={!canEdit} className="space-y-6"><section><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground"><UserRound size={14} className="text-primary" /> Customer & project</div><div className="grid gap-4 sm:grid-cols-2"><ClientSelect form={form} clients={clients} />{customerField('customerName', 'Customer name')}{customerField('customerPhone', 'Phone')}{customerField('customerGstin', 'GSTIN')}{customerField('customerAddress', 'Address', true)}<FormField control={form.control} name="projectName" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>Project name</FormLabel><FormControl><Input {...field} data-testid="input-quotation-project" /></FormControl></FormItem>} /><FormField control={form.control} name="quotationDate" render={({ field }) => <FormItem><FormLabel>Quotation date</FormLabel><FormControl><Input {...field} type="date" data-testid="input-quotation-date" /></FormControl></FormItem>} /></div></section>
<section><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground"><LayoutGrid size={14} className="text-primary" /> Window schedule</div><span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-bold">{items.length} lines</span></div><div className="grid gap-3 rounded-xl border border-border/80 bg-muted/20 p-3 md:grid-cols-[1.5fr_1fr_.7fr_.7fr_.55fr_.8fr_auto]"><Select value={draft.profileId} onValueChange={(value) => setDraftValue('profileId', value)}><SelectTrigger data-testid="select-line-profile"><SelectValue placeholder="Choose profile" /></SelectTrigger><SelectContent>{profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.code} · {profile.name}</SelectItem>)}</SelectContent></Select><Input value={draft.location} onChange={(event) => setDraftValue('location', event.target.value)} placeholder="Location" data-testid="input-line-location" /><Input type="number" value={draft.widthMm || ''} onChange={(event) => setDraftValue('widthMm', event.target.value)} placeholder="W mm" data-testid="input-line-width" /><Input type="number" value={draft.heightMm || ''} onChange={(event) => setDraftValue('heightMm', event.target.value)} placeholder="H mm" data-testid="input-line-height" /><Input type="number" min="1" value={draft.quantity} onChange={(event) => setDraftValue('quantity', event.target.value)} data-testid="input-line-quantity" /><Input type="number" value={draft.ratePerSqFt ?? ''} onChange={(event) => setDraftValue('ratePerSqFt', event.target.value)} placeholder="Rate override" data-testid="input-line-rate" /><Button type="button" size="icon" onClick={addLine} aria-label="Add window line" data-testid="button-add-window-line"><Plus size={16} /></Button></div>{items.length > 0 && <div className="mt-3 overflow-x-auto rounded-xl border border-border/80"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-secondary/60 text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Profile</th><th className="p-3">Location</th><th className="p-3">Dimensions</th><th className="p-3">Qty</th><th className="p-3">Rate</th><th /></tr></thead><tbody className="divide-y divide-border/70">{items.map((line, index) => <tr key={`${line.profileId}-${index}`} data-testid={`row-quotation-line-${index}`}><td className="p-3 font-semibold">{line.profileName || profiles.find((profile) => profile.id === line.profileId)?.name || profiles.find((profile) => profile.id === line.profileId)?.code || line.code}</td><td className="p-3">{line.location || '—'}</td><td className="p-3 font-mono">{line.widthMm} × {line.heightMm} mm</td><td className="p-3">{line.quantity}</td><td className="p-3">{line.ratePerSqFt === undefined ? 'Profile default' : money(line.ratePerSqFt)}</td><td className="p-3 text-right"><Button type="button" size="icon" variant="ghost" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} data-testid={`button-remove-line-${index}`}><Trash2 size={14} /></Button></td></tr>)}</tbody></table></div>}</section>
<section className="rounded-xl border border-primary/20 bg-primary/5 p-4" data-testid="card-quotation-estimate"><div className="flex items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-primary"><Calculator size={14} /> Live calculation estimate</div><p className="mt-1 text-[11px] text-muted-foreground">Preview only; API totals are authoritative after save.</p></div><span className="rounded-full border border-primary/20 bg-card px-2 py-1 text-[10px] font-bold text-primary">Estimate</span></div><div className="mt-3 overflow-x-auto rounded-lg border border-primary/10 bg-card"><table className="w-full min-w-[760px] text-left text-[11px]"><thead className="bg-secondary/50 text-[9px] uppercase tracking-wide text-muted-foreground"><tr><th className="p-2.5">Line</th><th className="p-2.5">Area / window</th><th className="p-2.5">Rate / sq.ft.</th><th className="p-2.5">Unit price</th><th className="p-2.5">Qty</th><th className="p-2.5">Line value</th><th className="p-2.5">Weight / window</th></tr></thead><tbody className="divide-y divide-border/60">{estimate.lines.length ? estimate.lines.map((line, index) => <tr key={`${line.profileId}-${index}`} data-testid={`row-estimate-line-${index}`}><td className="p-2.5 font-semibold">{line.profileName || line.profile?.name || line.profile?.code || line.code || '—'}</td><td className="p-2.5 font-mono">{line.sqFtPerWindow.toFixed(3)} sq.ft.</td><td className="p-2.5">{money(line.ratePerSqFt)}</td><td className="p-2.5">{money(line.unitPrice)}</td><td className="p-2.5">{line.quantity}</td><td className="p-2.5 font-semibold">{money(line.value)}</td><td className="p-2.5">{line.weightKgPerWindow.toFixed(3)} kg</td></tr>) : <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">Add a window line to see the estimate.</td></tr>}</tbody></table></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><div className="rounded-lg bg-card px-3 py-2"><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Components</span><strong className="font-display text-sm" data-testid="estimate-component-count">{estimate.componentCount}</strong></div><div className="rounded-lg bg-card px-3 py-2"><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Area</span><strong className="font-display text-sm" data-testid="estimate-total-area">{estimate.totalAreaSqFt.toFixed(2)} sq.ft.</strong></div><div className="rounded-lg bg-card px-3 py-2"><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Subtotal</span><strong className="font-display text-sm" data-testid="estimate-subtotal">{money(estimate.subtotal)}</strong></div><div className="rounded-lg bg-card px-3 py-2"><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">GST ({estimate.gstPercent}%)</span><strong className="font-display text-sm" data-testid="estimate-gst">{money(estimate.gstAmount)}</strong></div><div className="rounded-lg bg-primary px-3 py-2 text-primary-foreground"><span className="block text-[9px] uppercase tracking-wide opacity-75">Grand total</span><strong className="font-display text-sm" data-testid="estimate-grand-total">{money(estimate.grandTotal)}</strong></div></div></section>
<section><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground"><Calculator size={14} className="text-primary" /> Charges & notes</div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><FormField control={form.control} name="transportationCost" render={({ field }) => <FormItem><FormLabel>Transportation</FormLabel><FormControl><Input {...field} type="number" min="0" data-testid="input-quotation-transportation" /></FormControl></FormItem>} /><FormField control={form.control} name="loadingUnloadingCost" render={({ field }) => <FormItem><FormLabel>Loading / unloading</FormLabel><FormControl><Input {...field} type="number" min="0" data-testid="input-quotation-loading" /></FormControl></FormItem>} /><FormField control={form.control} name="additionalChargeRate" render={({ field }) => <FormItem><FormLabel>Additional rate</FormLabel><FormControl><Input {...field} type="number" min="0" data-testid="input-quotation-additional-rate" /></FormControl></FormItem>} /><FormField control={form.control} name="additionalChargeAreaSqFt" render={({ field }) => <FormItem><FormLabel>Additional area sq.ft.</FormLabel><FormControl><Input {...field} type="number" min="0" data-testid="input-quotation-additional-area" /></FormControl></FormItem>} /><FormField control={form.control} name="additionalChargeDescription" render={({ field }) => <FormItem><FormLabel>Additional charge</FormLabel><FormControl><Input {...field} data-testid="input-quotation-additional-description" /></FormControl></FormItem>} /><FormField control={form.control} name="gstPercent" render={({ field }) => <FormItem><FormLabel>GST %</FormLabel><FormControl><Input {...field} type="number" min="0" max="100" data-testid="input-quotation-gst" /></FormControl></FormItem>} /><FormField control={form.control} name="notes" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>Internal / customer note</FormLabel><FormControl><Textarea {...field} rows={2} data-testid="input-quotation-notes" /></FormControl></FormItem>} /></div></section><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4"><p className="text-[11px] text-muted-foreground">{canEdit ? 'Save to let the API calculate authoritative values and totals.' : 'View-only access: inspect saved data and print.'}</p>{canEdit && <Button type="submit" disabled={busy} data-testid="button-save-quotation">{busy ? 'Saving…' : quote ? 'Save quotation' : 'Save draft quotation'}</Button>}</div></fieldset></form></Form></CardContent></Card>;
}

function QuotationPrintDocument({ quote }: { quote: Quotation }) {
  const chunks: QuotationItem[][] = [];
  for (let index = 0; index < quote.items.length; index += 2) chunks.push(quote.items.slice(index, index + 2));
  const totalPages = chunks.length + 3;
  const footer = (page: number) => <div className="print-footer">powered by Framewise Order Operations · {quote.quoteNo} · page {page} of {totalPages}</div>;
  const printHeader = (label: string) => <div className="print-header"><div className="print-mark"><span className="print-roof" /> <strong>The Shree Creations</strong></div><div className="print-contact">+91 7057814114 · shreesaiwintech@gmail.com<br />Website: — · GSTIN: —</div><div className="print-meta"><strong>{quote.quoteNo}</strong><br />{quote.projectName || 'Quotation'} · {dateLabel(quote.quotationDate)}</div><div className="print-section-label">{label}</div></div>;
  const diagram = (item: QuotationItem) => <div className="window-diagram"><div className={`window-drawing ${item.drawingType}`}><span /><span /><span /></div><div className="dimension dimension-width">{item.widthMm} mm</div><div className="dimension dimension-height">{item.heightMm} mm</div><div className="diagram-caption">View From Inside</div></div>;
  return <div className="quotation-print-document" data-testid="quotation-print-document"><section className="print-page">{printHeader('Quotation proposal')}<div className="print-cover"><p className="print-kicker">Prepared for</p><h1>{quote.customerName}</h1><p className="print-address">{quote.customerAddress || 'Customer address on file'}<br />{quote.customerPhone}{quote.customerGstin ? ` · GSTIN ${quote.customerGstin}` : ''}</p><div className="print-cover-rule" /><p>Dear Customer, We are delighted that you are considering our range of Windows and Doors for your premises. It has gained rapid acceptance across all cities of India for the overwhelming advantages of better protection from noise, heat, rain, dust and pollution. In drawing this proposal, it has been our endeavor to suggest designs which would enhance your comfort and aesthetics from inside and improve the facade of the building. It has a well-established service network to deliver seamless service at your doorstep. Our offer comprises of the following in enclosure for your kind perusal: a. Window design, specification and value; b. Terms and Conditions. We now look forward to be of service to you. For The Shree Creations, Authorized Signatory.</p><div className="print-cover-note"><span>PROJECT</span><strong>{quote.projectName || 'Window proposal'}</strong><span>QUOTE DATE</span><strong>{dateLabel(quote.quotationDate)}</strong></div></div>{footer(1)}</section>{chunks.map((chunk, pageIndex) => <section className="print-page" key={pageIndex}>{printHeader(`Window details · ${pageIndex + 1}`)}<div className="print-window-grid">{chunk.map((item, itemIndex) => <article className="print-window-card" key={`${item.code}-${itemIndex}`}><div className="print-window-title"><span>{String(pageIndex * 2 + itemIndex + 1).padStart(2, '0')}</span><h2>{item.profileName}</h2><strong>{item.code}</strong></div>{diagram(item)}<div className="print-window-spec"><p><b>Location</b>{item.location || '—'}</p><p><b>Dimensions</b>{item.widthMm} × {item.heightMm} mm</p><p><b>Sq.ft. / window</b>{item.sqFtPerWindow.toFixed(3)}</p><p><b>Rate / sq.ft.</b>{money(item.ratePerSqFt)}</p><p><b>Unit price</b>{money(item.unitPrice)}</p><p><b>Quantity</b>{item.quantity}</p><p><b>Line value</b>{money(item.value)}</p><p><b>Weight / window</b>{item.weightKgPerWindow.toFixed(3)} kg</p><p><b>Profile system</b>{item.profileSystem}</p><p><b>Glass</b>{item.glass}</p><p><b>Profile colour</b>{item.profileColor}</p><p><b>Mesh</b>{item.meshType}</p><p><b>Drawing</b>{item.drawingType}</p><p><b>Specifications</b>{item.specifications || 'As per selected profile'}</p><p><b>Accessories</b>{item.accessories || 'Standard accessories'}</p></div><div className="print-window-values"><span>{item.sqFtPerWindow.toFixed(3)} sq.ft. / window</span><span>{item.quantity} no.</span><strong>{money(item.value)}</strong></div></article>)}</div>{footer(pageIndex + 2)}</section>)}<section className="print-page">{printHeader('Quote totals')}<div className="print-total-intro"><p className="print-kicker">Commercial summary</p><h1>{quote.quoteNo}</h1><p>{quote.customerName} · {quote.projectName || 'Window proposal'}</p></div><div className="print-summary-table"><p><span>Component count</span><strong>{quote.totals.componentCount}</strong></p><p><span>Total area</span><strong>{quote.totals.totalAreaSqFt.toFixed(2)} sq.ft.</strong></p><p><span>Basic value</span><strong>{money(quote.totals.basicValue)}</strong></p><p><span>Transportation</span><strong>{money(quote.totals.transportationCost)}</strong></p><p><span>Loading / unloading</span><strong>{money(quote.totals.loadingUnloadingCost)}</strong></p><p><span>Additional charge</span><strong>{money(quote.totals.additionalCharge)}</strong></p><p><span>Subtotal</span><strong>{money(quote.totals.subtotal)}</strong></p><p><span>GST ({quote.totals.gstPercent}%)</span><strong>{money(quote.totals.gstAmount)}</strong></p><p className="grand-total"><span>Grand total</span><strong>{money(quote.totals.grandTotal)}</strong></p></div><div className="print-average">Average price / sq.ft. <strong>{money(quote.totals.averagePricePerSqFt)}</strong></div>{footer(chunks.length + 2)}</section><section className="print-page">{printHeader('Terms, prerequisites & acceptance')}<div className="print-terms"><h2>Terms and Conditions:-</h2><p>1. Payments terms: a. 100% Advance along with order, if it is less than INR 100000. b. 50% advance along with order, 50% before delivery, if it is more than INR 100000.</p><p>2. Validation of quote 30 days, total execution of project should be completed latest by 3-months.</p><p>3. P.O & Payments should made in the name of The Shree Creations.</p><p>4. The prices are based on the sizes provided by the customer. The prices are valid for variation in sizes up to +/- 30mm per window provided the design and style of product remains unchanged. The customer will be charged on pro-rate basis for difference between the actual sizes and given sizes, if any, beyond the above variation.</p><p>5. After handovering the windows, cleaning not our scope.</p><p>6. Windows security tape should be remove while installing windows freely, After installation security tape will be removed by us that should be chargeable per window INR 100.</p><p>7. If any other commitments given by our sales team, before placing order please call us . Cell : +91 7057814114.</p><p>8. After handovering windows, If any service require related to windows & doors , that should be chargeable. Per visit - INR 350.</p><p>9. Material unloading & storage should be your scope.</p><p>10. All disputes shall be subject jurisdiction only.</p><h2>Pre-Requisites for installation of Windows:-</h2><p>1. Walls should be plastered from inside and outside, with inside POP complete.<br />2. All jams, sills and soffits should be plastered.<br />3. Flooring (where doors have to be installed) should be complete.<br />4. Aperture should be smooth.<br />5. Base and top of window should be water leveled and sides should be in vertical plump.<br />6. Sill width should be more than the window width.<br />7. Opening should be accessible from inside for installation.<br />8. Grills: Adequate care should be taken if grills have to be installed.<br />a. For Horizontal slider Window: Grill should be provided on the outer face of slider before the installation of the window.<br />b. For Casement windows: Screw type grill is recommended after installation of casement window.<br />9. Installation should happen before the last coat of paint. At least one coat of paint should be done before installation begins.<br />10. Scaffoldings/ bracing should not interrupt the window openings where openings where windows are supposed to be installed.</p></div><p className="print-acceptance">I hereby accept the estimate as per above mentioned price and specifications. I have read and understood the terms & conditions and agree to them.</p><div className="print-signatures"><span>Authorized Signatory<br /><br />____________________________</span><span>Signature of Customer<br /><br />____________________________</span></div>{footer(totalPages)}</section></div>;
}

export default function QuotationBuilderPage({ user }: { user: User }) {
  const canEdit = user.roleId === 'master-admin' || user.permissions?.['quotation-builder'] === 'edit';
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState(false);
  const [search, setSearch] = useState('');
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<WindowProfile | null>(null);
  const quotationQuery = useListQuotations({ query: { queryKey: getListQuotationsQueryKey() } });
  const profilesQuery = useListWindowProfiles({ query: { queryKey: getListWindowProfilesQueryKey() } });
  const clientsQuery = useListClients({ includeInactive: false }, { query: { queryKey: getListClientsQueryKey({ includeInactive: false }) } });
  const selectedQuery = useGetQuotation(selectedQuoteId || '', { query: { enabled: Boolean(selectedQuoteId), queryKey: getGetQuotationQueryKey(selectedQuoteId || '') } });
  const archive = useArchiveQuotation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const quotations = quotationQuery.data || [];
  const profiles = profilesQuery.data || [];
  const clients = clientsQuery.data || [];
  const selectedQuote = selectedQuery.data || (selectedQuoteId ? quotations.find((quote) => quote.id === selectedQuoteId) || null : null);
  const visibleQuotes = useMemo(() => quotations.filter((quote) => `${quote.quoteNo} ${quote.customerName} ${quote.projectName}`.toLowerCase().includes(search.toLowerCase())), [quotations, search]);

  useEffect(() => {
    const remove = () => document.body.classList.remove('print-quotation');
    return remove;
  }, []);

  const print = () => {
    if (!selectedQuote) return;
    document.body.classList.add('print-quotation');
    window.setTimeout(() => { window.print(); window.setTimeout(() => document.body.classList.remove('print-quotation'), 300); }, 80);
  };
  const archiveQuote = (quote: Quotation) => {
    if (!window.confirm(`Archive ${quote.quoteNo}? It will no longer appear in the draft register.`)) return;
    archive.mutate({ quotationId: quote.id }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListQuotationsQueryKey() }); if (selectedQuoteId === quote.id) { setSelectedQuoteId(null); setNewDraft(false); } toast({ title: 'Quotation archived', description: quote.quoteNo }); } });
  };
  const openNew = () => { setSelectedQuoteId(null); setNewDraft(true); };
  const openQuote = (quote: Quotation) => { setSelectedQuoteId(quote.id); setNewDraft(false); };

  return <AppShell user={user} title="Quotation builder" eyebrow="Module 3 · quotation desk"><div className="quotation-builder-page space-y-6">
    <section className="quotation-hero animate-enter-up overflow-hidden rounded-2xl p-6 text-white shadow-sm md:p-8"><div className="relative z-10 max-w-4xl"><div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-primary"><span>Framewise quoting desk</span><span className="h-1 w-1 rounded-full bg-accent" /><span>{canEdit ? 'Edit access' : 'View only'}</span></div><h2 className="mt-3 max-w-3xl font-display text-3xl font-bold tracking-[-0.05em] md:text-4xl">Make every opening measurable, priced, and ready to send.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">Start from a trusted profile, capture the customer context, and let the quotation API lock the arithmetic before you print.</p><div className="mt-6 flex flex-wrap gap-2"><div className="rounded-lg bg-white/10 px-3 py-2 text-xs"><strong className="font-display text-base">{quotations.length}</strong><span className="ml-2 text-white/65">saved drafts</span></div><div className="rounded-lg bg-white/10 px-3 py-2 text-xs"><strong className="font-display text-base">{profiles.length}</strong><span className="ml-2 text-white/65">active profiles</span></div><div className="rounded-lg bg-white/10 px-3 py-2 text-xs"><strong className="font-display text-base">THE-QT</strong><span className="ml-2 text-white/65">quote series</span></div></div></div><div className="quotation-hero-mark" aria-hidden="true"><span /><span /><span /><span /></div></section>
    <section className="grid gap-4 sm:grid-cols-3"><Card className="animate-enter-up delay-1 border-border/80"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Draft register</p><FileText size={16} className="text-primary" /></div><p className="mt-3 font-display text-3xl font-bold" data-testid="metric-quotation-drafts">{quotations.length}</p><p className="mt-1 text-xs text-muted-foreground">saved customer proposals</p></CardContent></Card><Card className="animate-enter-up delay-2 border-border/80"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Catalogue</p><BookOpen size={16} className="text-accent-foreground" /></div><p className="mt-3 font-display text-3xl font-bold" data-testid="metric-window-profiles">{profiles.length}</p><p className="mt-1 text-xs text-muted-foreground">active reusable profiles</p></CardContent></Card><Card className="animate-enter-up delay-3 border-border/80"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Default series</p><Settings2 size={16} className="text-primary" /></div><p className="mt-3 font-display text-xl font-bold">₹644.97</p><p className="mt-1 text-xs text-muted-foreground">editable starting rate / sq.ft.</p></CardContent></Card></section>
    <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]"><Card className="border-border/80" data-testid="card-quotation-register"><CardHeader className="border-b border-border/70 pb-4"><div className="flex items-start justify-between gap-2"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Saved work</p><CardTitle className="mt-1 font-display text-lg">Quotation register</CardTitle></div>{canEdit && <Button size="icon" onClick={openNew} aria-label="Create quotation" data-testid="button-create-quotation"><Plus size={17} /></Button>}</div><div className="relative mt-3"><Search size={15} className="absolute left-3 top-2.5 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search quote or customer" data-testid="input-search-quotations" /></div></CardHeader><CardContent className="p-0">{quotationQuery.isLoading ? <div className="p-5"><StatePanel kind="loading" /></div> : quotationQuery.isError ? <div className="p-5"><StatePanel kind="error" onRetry={() => void quotationQuery.refetch()} /></div> : !visibleQuotes.length ? <div className="p-6"><StatePanel kind="empty" /></div> : <div className="divide-y divide-border/70">{visibleQuotes.map((quote) => <button key={quote.id} type="button" onClick={() => openQuote(quote)} className={`group w-full p-4 text-left transition-colors hover:bg-secondary/35 ${selectedQuoteId === quote.id ? 'bg-secondary/50' : ''}`} data-testid={`button-open-quotation-${quote.id}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-[10px] font-bold text-primary">{quote.quoteNo}</span><span className="rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-foreground">Draft</span></div><p className="mt-2 truncate text-sm font-semibold">{quote.customerName || 'Unnamed customer'}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{quote.projectName || 'No project name'} · {dateLabel(quote.quotationDate)}</p></div><span className="text-right font-display text-sm font-bold">{money(quote.totals.grandTotal)}<span className="mt-1 block font-sans text-[10px] font-normal text-muted-foreground">{quote.totals.componentCount} windows</span></span></div></button>)}</div>}</CardContent></Card>
      <div className="min-w-0 space-y-6">{(newDraft || selectedQuote) ? <QuoteEditor quote={newDraft ? null : selectedQuote} clients={clients} profiles={profiles} canEdit={canEdit} onNew={openNew} onSaved={(saved) => { setSelectedQuoteId(saved.id); setNewDraft(false); }} /> : <div className="grid min-h-[420px] place-items-center rounded-xl border border-dashed border-border bg-card/60 p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-secondary text-primary"><Copy size={21} /></div><h3 className="mt-4 font-display text-lg font-bold">Choose a draft or start fresh</h3><p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">The register keeps saved drafts on the left. A blank quotation on the right is ready for your next customer conversation.</p>{canEdit && <Button className="mt-5" onClick={openNew} data-testid="button-start-quotation"><FilePlus2 size={15} /> Start quotation</Button>}</div></div>}
        {selectedQuote && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-card px-4 py-3 shadow-sm"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Saved document</p><p className="mt-1 text-xs text-foreground">{selectedQuote.quoteNo} · {selectedQuote.totals.componentCount} components · {money(selectedQuote.totals.grandTotal)}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={print} disabled={selectedQuery.isLoading} data-testid="button-print-quotation"><Printer size={14} /> Print / PDF</Button>{canEdit && <Button variant="ghost" size="sm" onClick={() => archiveQuote(selectedQuote)} data-testid="button-archive-quotation"><Archive size={14} /> Archive</Button>}</div></div>}
        <ProfileCatalogue profiles={profiles} canEdit={canEdit} loading={profilesQuery.isLoading} error={Boolean(profilesQuery.isError)} onRetry={() => void profilesQuery.refetch()} onAdd={() => { setEditingProfile(null); setProfileDialogOpen(true); }} onEdit={(profile) => { setEditingProfile(profile); setProfileDialogOpen(true); }} />
      </div></div>
    <ProfileDialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen} editing={editingProfile} onDone={() => setProfileDialogOpen(false)} />
    {selectedQuote && <QuotationPrintDocument quote={selectedQuote} />}
  </div></AppShell>;
}