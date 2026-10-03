import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  BookOpen,
  Calculator,
  Check,
  CircleAlert,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FileText,
  LayoutGrid,
  Link2,
  MapPin,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import {
  getGetQuotationQueryKey,
  getListClientsQueryKey,
  getListMeasurementRecordsQueryKey,
  getListOrdersQueryKey,
  getListQuotationRateSubmissionsQueryKey,
  getListQuotationsQueryKey,
  getListWindowProfilesQueryKey,
  getDownloadQuotationRateSubmissionPdfUrl,
  useLinkQuotationRateSubmissionOrder,
  useArchiveQuotation,
  useArchiveWindowProfile,
  useCreateQuotation,
  useCreateQuotationRateSubmission,
  useCreateWindowProfile,
  useDeleteQuotationRateSubmission,
  useDecideQuotationRateSubmission,
  useGetQuotation,
  useListClients,
  useListOrders,
  useListQuotationRateSubmissions,
  useListQuotations,
  useListWindowProfiles,
  useSearchMeasurementRecords,
  useUploadQuotationRateSubmissionPdf,
  useUpdateQuotation,
  useUpdateWindowProfile,
} from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import type {
  Client,
  Quotation,
  QuotationInput,
  QuotationItem,
  QuotationRateSubmission,
  MeasurementRecordLookup,
  Order,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WindowProfileImageInput } from '@/components/window-profile-image-input';
import { measurementSheetIdLabel, MeasurementSheetLookup } from '@/components/link-record-lookups';
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
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const profileSchema = z.object({
  code: z.string().min(1, 'Add a catalogue code.').max(24),
  name: z.string().min(2, 'Add a profile name.').max(120),
  profileSystem: z.string().min(1, 'Add the profile system.').max(240),
  glass: z.string().max(120),
  profileColor: z.string().max(80),
  meshType: z.string().max(120),
  specifications: z.string().max(3000),
  accessories: z.string().max(1500),
  remarks: z.string().max(1000),
  imageDataUrl: z.string().max(220_000).nullable(),
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
  remarks: '',
  imageDataUrl: null,
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
    return <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-border bg-card/60 p-8 text-center" data-testid="state-quotation-empty"><div><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-secondary text-primary"><FileText size={20} /></div><h3 className="mt-3 font-display text-sm font-bold">No saved drafts yet</h3><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Create a quotation in the New quotation tab to add the first draft here.</p></div></div>;
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
    if (!open) return;
    form.reset(editing ? {
      code: editing.code,
      name: editing.name,
      profileSystem: editing.profileSystem,
      glass: editing.glass,
      profileColor: editing.profileColor,
      meshType: editing.meshType,
      specifications: editing.specifications,
      accessories: editing.accessories,
      remarks: editing.remarks || '',
      imageDataUrl: editing.imageDataUrl ?? null,
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
    <FormField control={form.control} name={name} render={({ field: input }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl><Input {...input} type={type} value={input.value as string | number} placeholder={placeholder} data-testid={`input-profile-${name}`} /></FormControl>
        <FormMessage />
      </FormItem>
    )} />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit window profile' : 'Add window profile'}</DialogTitle>
          <DialogDescription>Keep the report labels consistent. Change the profile values, drawing, and notes for this catalogue entry.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(save)} className="space-y-4" data-testid="form-window-profile">
            <div className="grid gap-4 sm:grid-cols-3">
              {field('code', 'Catalogue code', 'SIM-060-CAS')}
              {field('name', 'Profile name', 'OPANABLE AND EXZ')}
              {field('profileSystem', 'Profile system', 'SIMTA 60MM CASEMENT SERIES')}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {field('glass', 'Glass', '4 MM frosted glass')}
              {field('profileColor', 'Profile colour', 'White')}
              {field('meshType', 'Mesh', '1 mesh / None')}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('ratePerSqFt', 'Rate / sq.ft.', '644.97', 'number')}
              {field('weightKgPerSqFt', 'Weight kg / sq.ft.', '2.80', 'number')}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="drawingType" render={({ field: input }) => (
                <FormItem>
                  <FormLabel>Drawing type</FormLabel>
                  <Select value={input.value} onValueChange={input.onChange}>
                    <FormControl><SelectTrigger data-testid="select-profile-drawing-type"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{drawingTypes.map((value) => <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="imageDataUrl" render={({ field: input }) => (
                <FormItem>
                  <FormLabel>Window drawing image</FormLabel>
                  <FormControl><WindowProfileImageInput value={input.value} onChange={input.onChange} disabled={busy} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="specifications" render={({ field: input }) => (
                <FormItem>
                  <FormLabel>Profile</FormLabel>
                  <FormControl><Textarea {...input} rows={4} placeholder="Frame, shutter, reinforcement and profile detail" data-testid="input-profile-specifications" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="accessories" render={({ field: input }) => (
                <FormItem>
                  <FormLabel>Accessories</FormLabel>
                  <FormControl><Textarea {...input} rows={4} placeholder="Handle, stopper, roller, fasteners..." data-testid="input-profile-accessories" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="remarks" render={({ field: input }) => (
              <FormItem>
                <FormLabel>Remarks</FormLabel>
                <FormControl><Textarea {...input} rows={2} placeholder="Optional note printed at the bottom of the window sheet" data-testid="input-profile-remarks" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel-profile">Cancel</Button>
              <Button type="submit" disabled={busy} data-testid="button-save-profile">{busy ? 'Saving…' : editing ? 'Save profile' : 'Add profile'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ProfileCatalogue({ profiles, canEdit, loading, error, onRetry, onEdit, onAdd }: { profiles: WindowProfile[]; canEdit: boolean; loading: boolean; error: boolean; onRetry: () => void; onEdit: (profile: WindowProfile) => void; onAdd: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const archive = useArchiveWindowProfile();
  const [search, setSearch] = useState('');
  const filtered = useMemo(
    () => profiles.filter((profile) => `${profile.code} ${profile.name} ${profile.profileSystem}`.toLowerCase().includes(search.toLowerCase())),
    [profiles, search],
  );
  const removeProfile = (profile: WindowProfile) => {
    if (!window.confirm(`Remove ${profile.code} · ${profile.name} from the active catalogue? Saved quotations keep their snapshot.`)) return;
    archive.mutate({ profileId: profile.id }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListWindowProfilesQueryKey() });
        toast({ title: 'Profile removed', description: `${profile.code} no longer appears in new quotations.` });
      },
    });
  };

  return (
    <Card className="border-border/80" data-testid="card-profile-catalogue">
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Reusable rate book</p>
            <CardTitle className="mt-1 font-display text-lg">Window profiles</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Rates are starting defaults. A quotation line can override them.</p>
          </div>
          {canEdit && <Button size="sm" onClick={onAdd} data-testid="button-add-profile"><Plus size={15} /> Add profile</Button>}
        </div>
        <div className="relative mt-3 max-w-sm">
          <Search size={15} className="absolute left-3 top-2.5 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search code, name or system" data-testid="input-search-profiles" />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? <div className="p-5"><StatePanel kind="loading" /></div>
          : error ? <div className="p-5"><StatePanel kind="error" onRetry={onRetry} /></div>
            : !filtered.length ? <div className="p-8 text-center text-xs text-muted-foreground" data-testid="state-profile-empty">No active profiles match this search.</div>
              : <div className="divide-y divide-border/70">
                {filtered.map((profile) => (
                  <div key={profile.id} className="group grid gap-3 p-4 transition-colors hover:bg-secondary/30 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-center" data-testid={`row-profile-${profile.id}`}>
                    {profile.imageDataUrl
                      ? <img src={profile.imageDataUrl} alt={`${profile.name} drawing`} className="h-[68px] w-[68px] rounded-lg border border-border/70 bg-white object-contain p-1" />
                      : <div className="grid h-[68px] w-[68px] place-items-center rounded-lg border border-dashed border-border bg-muted/40 text-muted-foreground"><FileText size={18} /></div>}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-secondary px-2 py-1 font-mono text-[10px] font-bold tracking-wide text-secondary-foreground">{profile.code}</span>
                        <span className="text-sm font-semibold">{profile.name}</span>
                        <span className="rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">{profile.drawingType}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{profile.profileSystem} · {profile.glass || 'Glass to be specified'} · {profile.meshType || 'No mesh'}</p>
                      <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{profile.specifications || 'No profile details'}{profile.accessories ? ` · ${profile.accessories}` : ''}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <div className="text-right">
                        <p className="font-display text-sm font-bold text-foreground">{money(profile.ratePerSqFt)}</p>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">per sq.ft.</p>
                      </div>
                      {canEdit && <div className="flex gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                        <Button size="icon" variant="ghost" onClick={() => onEdit(profile)} aria-label={`Edit ${profile.code}`} data-testid={`button-edit-profile-${profile.id}`}><Pencil size={15} /></Button>
                        <Button size="icon" variant="ghost" onClick={() => removeProfile(profile)} aria-label={`Remove ${profile.code}`} data-testid={`button-archive-profile-${profile.id}`}><Trash2 size={15} /></Button>
                      </div>}
                    </div>
                  </div>
                ))}
              </div>}
      </CardContent>
    </Card>
  );
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
<section><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground"><LayoutGrid size={14} className="text-primary" /> Window schedule</div><span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-bold">{items.length} lines</span></div><div className="grid gap-3 rounded-xl border border-border/80 bg-muted/20 p-3 md:grid-cols-[1.2fr_.75fr_1fr_.7fr_.7fr_.55fr_.8fr_auto]"><Select value={draft.profileId} onValueChange={(value) => setDraftValue('profileId', value)}><SelectTrigger data-testid="select-line-profile"><SelectValue placeholder="Choose profile" /></SelectTrigger><SelectContent>{profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.code} · {profile.name}</SelectItem>)}</SelectContent></Select><Input value={draft.code} onChange={(event) => setDraftValue('code', event.target.value)} placeholder="Code" data-testid="input-line-code" /><Input value={draft.location} onChange={(event) => setDraftValue('location', event.target.value)} placeholder="Location" data-testid="input-line-location" /><Input type="number" value={draft.widthMm || ''} onChange={(event) => setDraftValue('widthMm', event.target.value)} placeholder="W mm" data-testid="input-line-width" /><Input type="number" value={draft.heightMm || ''} onChange={(event) => setDraftValue('heightMm', event.target.value)} placeholder="H mm" data-testid="input-line-height" /><Input type="number" min="1" value={draft.quantity} onChange={(event) => setDraftValue('quantity', event.target.value)} data-testid="input-line-quantity" /><Input type="number" value={draft.ratePerSqFt ?? ''} onChange={(event) => setDraftValue('ratePerSqFt', event.target.value)} placeholder="Rate override" data-testid="input-line-rate" /><Button type="button" size="icon" onClick={addLine} aria-label="Add window line" data-testid="button-add-window-line"><Plus size={16} /></Button></div>{items.length > 0 && <div className="mt-3 overflow-x-auto rounded-xl border border-border/80"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-secondary/60 text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Profile</th><th className="p-3">Location</th><th className="p-3">Dimensions</th><th className="p-3">Qty</th><th className="p-3">Rate</th><th /></tr></thead><tbody className="divide-y divide-border/70">{items.map((line, index) => <tr key={`${line.profileId}-${index}`} data-testid={`row-quotation-line-${index}`}><td className="p-3 font-semibold">{line.profileName || profiles.find((profile) => profile.id === line.profileId)?.name || profiles.find((profile) => profile.id === line.profileId)?.code || line.code}</td><td className="p-3">{line.location || '—'}</td><td className="p-3 font-mono">{line.widthMm} × {line.heightMm} mm</td><td className="p-3">{line.quantity}</td><td className="p-3">{line.ratePerSqFt === undefined ? 'Profile default' : money(line.ratePerSqFt)}</td><td className="p-3 text-right"><Button type="button" size="icon" variant="ghost" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} data-testid={`button-remove-line-${index}`}><Trash2 size={14} /></Button></td></tr>)}</tbody></table></div>}</section>
<section className="rounded-xl border border-primary/20 bg-primary/5 p-4" data-testid="card-quotation-estimate"><div className="flex items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-primary"><Calculator size={14} /> Live calculation estimate</div><p className="mt-1 text-[11px] text-muted-foreground">Preview only; API totals are authoritative after save.</p></div><span className="rounded-full border border-primary/20 bg-card px-2 py-1 text-[10px] font-bold text-primary">Estimate</span></div><div className="mt-3 overflow-x-auto rounded-lg border border-primary/10 bg-card"><table className="w-full min-w-[760px] text-left text-[11px]"><thead className="bg-secondary/50 text-[9px] uppercase tracking-wide text-muted-foreground"><tr><th className="p-2.5">Line</th><th className="p-2.5">Area / window</th><th className="p-2.5">Rate / sq.ft.</th><th className="p-2.5">Unit price</th><th className="p-2.5">Qty</th><th className="p-2.5">Line value</th><th className="p-2.5">Weight / window</th></tr></thead><tbody className="divide-y divide-border/60">{estimate.lines.length ? estimate.lines.map((line, index) => <tr key={`${line.profileId}-${index}`} data-testid={`row-estimate-line-${index}`}><td className="p-2.5 font-semibold">{line.profileName || line.profile?.name || line.profile?.code || line.code || '—'}</td><td className="p-2.5 font-mono">{line.sqFtPerWindow.toFixed(3)} sq.ft.</td><td className="p-2.5">{money(line.ratePerSqFt)}</td><td className="p-2.5">{money(line.unitPrice)}</td><td className="p-2.5">{line.quantity}</td><td className="p-2.5 font-semibold">{money(line.value)}</td><td className="p-2.5">{line.weightKgPerWindow.toFixed(3)} kg</td></tr>) : <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">Add a window line to see the estimate.</td></tr>}</tbody></table></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><div className="rounded-lg bg-card px-3 py-2"><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Components</span><strong className="font-display text-sm" data-testid="estimate-component-count">{estimate.componentCount}</strong></div><div className="rounded-lg bg-card px-3 py-2"><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Area</span><strong className="font-display text-sm" data-testid="estimate-total-area">{estimate.totalAreaSqFt.toFixed(2)} sq.ft.</strong></div><div className="rounded-lg bg-card px-3 py-2"><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Subtotal</span><strong className="font-display text-sm" data-testid="estimate-subtotal">{money(estimate.subtotal)}</strong></div><div className="rounded-lg bg-card px-3 py-2"><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">GST ({estimate.gstPercent}%)</span><strong className="font-display text-sm" data-testid="estimate-gst">{money(estimate.gstAmount)}</strong></div><div className="rounded-lg bg-primary px-3 py-2 text-primary-foreground"><span className="block text-[9px] uppercase tracking-wide opacity-75">Grand total</span><strong className="font-display text-sm" data-testid="estimate-grand-total">{money(estimate.grandTotal)}</strong></div></div></section>
<section><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground"><Calculator size={14} className="text-primary" /> Charges & notes</div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><FormField control={form.control} name="transportationCost" render={({ field }) => <FormItem><FormLabel>Transportation</FormLabel><FormControl><Input {...field} type="number" min="0" data-testid="input-quotation-transportation" /></FormControl></FormItem>} /><FormField control={form.control} name="loadingUnloadingCost" render={({ field }) => <FormItem><FormLabel>Loading / unloading</FormLabel><FormControl><Input {...field} type="number" min="0" data-testid="input-quotation-loading" /></FormControl></FormItem>} /><FormField control={form.control} name="additionalChargeRate" render={({ field }) => <FormItem><FormLabel>Additional rate</FormLabel><FormControl><Input {...field} type="number" min="0" data-testid="input-quotation-additional-rate" /></FormControl></FormItem>} /><FormField control={form.control} name="additionalChargeAreaSqFt" render={({ field }) => <FormItem><FormLabel>Additional area sq.ft.</FormLabel><FormControl><Input {...field} type="number" min="0" data-testid="input-quotation-additional-area" /></FormControl></FormItem>} /><FormField control={form.control} name="additionalChargeDescription" render={({ field }) => <FormItem><FormLabel>Additional charge</FormLabel><FormControl><Input {...field} data-testid="input-quotation-additional-description" /></FormControl></FormItem>} /><FormField control={form.control} name="gstPercent" render={({ field }) => <FormItem><FormLabel>GST %</FormLabel><FormControl><Input {...field} type="number" min="0" max="100" data-testid="input-quotation-gst" /></FormControl></FormItem>} /><FormField control={form.control} name="notes" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>Internal / customer note</FormLabel><FormControl><Textarea {...field} rows={2} data-testid="input-quotation-notes" /></FormControl></FormItem>} /></div></section><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4"><p className="text-[11px] text-muted-foreground">{canEdit ? 'Save to let the API calculate authoritative values and totals.' : 'View-only access: inspect saved data and print.'}</p>{canEdit && <Button type="submit" disabled={busy} data-testid="button-save-quotation">{busy ? 'Saving…' : quote ? 'Save quotation' : 'Save draft quotation'}</Button>}</div></fieldset></form></Form></CardContent></Card>;
}

function QuotationPrintDocument({ quote }: { quote: Quotation }) {
  const totalPages = quote.items.length + 3;
  const footer = (page: number) => <div className="print-footer">powered by Framewise Order Operations · {quote.quoteNo} · page {page} of {totalPages}</div>;
  const printHeader = (label: string) => <div className="print-header"><div className="print-mark"><span className="print-roof" /> <strong>The Shree Creations</strong></div><div className="print-contact">+91 7057814114 · shreesaiwintech@gmail.com<br />Website: — · GSTIN: —</div><div className="print-meta"><strong>{quote.quoteNo}</strong><br />{quote.projectName || 'Quotation'} · {dateLabel(quote.quotationDate)}</div><div className="print-section-label">{label}</div></div>;
  const textLines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (
    <div className="quotation-print-document" data-testid="quotation-print-document">
      <section className="print-page">
        {printHeader('Quotation proposal')}
        <div className="print-cover">
          <p className="print-kicker">Prepared for</p>
          <h1>{quote.customerName}</h1>
          <p className="print-address">{quote.customerAddress || 'Customer address on file'}<br />{quote.customerPhone}{quote.customerGstin ? ` · GSTIN ${quote.customerGstin}` : ''}</p>
          <div className="print-cover-rule" />
          <p>Dear Customer, We are delighted that you are considering our range of Windows and Doors for your premises. It has gained rapid acceptance across all cities of India for the overwhelming advantages of better protection from noise, heat, rain, dust and pollution. In drawing this proposal, it has been our endeavor to suggest designs which would enhance your comfort and aesthetics from inside and improve the facade of the building. It has a well-established service network to deliver seamless service at your doorstep. Our offer comprises of the following in enclosure for your kind perusal: a. Window design, specification and value; b. Terms and Conditions. We now look forward to be of service to you. For The Shree Creations, Authorized Signatory.</p>
          <div className="print-cover-note"><span>PROJECT</span><strong>{quote.projectName || 'Window proposal'}</strong><span>QUOTE DATE</span><strong>{dateLabel(quote.quotationDate)}</strong></div>
        </div>
        {footer(1)}
      </section>

      {quote.items.map((item, index) => (
        <section className="print-page" key={`${item.code}-${index}`}>
          {printHeader(`Window detail sheet · ${index + 1}`)}
          <article className="profile-sheet" data-testid={`print-window-sheet-${index}`}>
            <div className="profile-sheet-fields">
              {[
                ['Code', item.code],
                ['Name', item.profileName],
                ['Location', item.location || '—'],
                ['Size', `W = ${item.widthMm} mm · H = ${item.heightMm} mm`],
                ['Profile System', item.profileSystem],
                ['Glass', item.glass || '—'],
              ].map(([label, value]) => (
                <div className="profile-sheet-field" key={label}>
                  <span>{label}</span><strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="profile-sheet-body">
              <section className="profile-sheet-computed">
                <h2>Computed Values</h2>
                <table><tbody>
                  <tr><th>Sq.Ft.</th><td>{item.sqFtPerWindow.toFixed(3)}</td></tr>
                  <tr><th>Value per Sq.Ft.</th><td>{money(item.ratePerSqFt)}</td></tr>
                  <tr><th>Unit Price</th><td>{money(item.unitPrice)}</td></tr>
                  <tr><th>Quantity</th><td>{item.quantity}</td></tr>
                  <tr><th>Value</th><td>{money(item.value)}</td></tr>
                  <tr><th>Weight</th><td>{item.weightKgPerWindow.toFixed(3)} kg</td></tr>
                </tbody></table>
              </section>
              <div className="profile-sheet-details">
                <section>
                  <h2>Profile</h2>
                  <p>{textLines(item.specifications || '').map((line, lineIndex) => <span key={lineIndex}>{line}</span>)}</p>
                  <p><b>Colour:</b> {item.profileColor || '—'}</p>
                  <p><b>Mesh:</b> {item.meshType || '—'}</p>
                </section>
                <section>
                  <h2>Accessories</h2>
                  <p>{textLines(item.accessories || '').map((line, lineIndex) => <span key={lineIndex}>{line}</span>)}</p>
                </section>
              </div>
              <figure className="profile-sheet-drawing">
                {item.imageDataUrl
                  ? <img src={item.imageDataUrl} alt={`${item.profileName} drawing`} />
                  : <div className={`window-drawing ${item.drawingType}`}><span /><span /><span /></div>}
                <figcaption>View From Inside</figcaption>
              </figure>
            </div>
            <div className="profile-sheet-remarks"><strong>Remarks</strong><p>{item.remarks || '—'}</p></div>
          </article>
          {footer(index + 2)}
        </section>
      ))}

      <section className="print-page">
        {printHeader('Quote totals')}
        <div className="print-total-intro"><p className="print-kicker">Commercial summary</p><h1>{quote.quoteNo}</h1><p>{quote.customerName} · {quote.projectName || 'Window proposal'}</p></div>
        <div className="print-summary-table">
          <p><span>Component count</span><strong>{quote.totals.componentCount}</strong></p>
          <p><span>Total area</span><strong>{quote.totals.totalAreaSqFt.toFixed(2)} sq.ft.</strong></p>
          <p><span>Basic value</span><strong>{money(quote.totals.basicValue)}</strong></p>
          <p><span>Transportation</span><strong>{money(quote.totals.transportationCost)}</strong></p>
          <p><span>Loading / unloading</span><strong>{money(quote.totals.loadingUnloadingCost)}</strong></p>
          <p><span>Additional charge</span><strong>{money(quote.totals.additionalCharge)}</strong></p>
          <p><span>Subtotal</span><strong>{money(quote.totals.subtotal)}</strong></p>
          <p><span>GST ({quote.totals.gstPercent}%)</span><strong>{money(quote.totals.gstAmount)}</strong></p>
          <p className="grand-total"><span>Grand total</span><strong>{money(quote.totals.grandTotal)}</strong></p>
        </div>
        <div className="print-average">Average price / sq.ft. <strong>{money(quote.totals.averagePricePerSqFt)}</strong></div>
        {footer(quote.items.length + 2)}
      </section>

      <section className="print-page">
        {printHeader('Terms, prerequisites & acceptance')}
        <div className="print-terms">
          <h2>Terms and Conditions:-</h2>
          <p>1. Payments terms: a. 100% Advance along with order, if it is less than INR 100000. b. 50% advance along with order, 50% before delivery, if it is more than INR 100000.</p>
          <p>2. Validation of quote 30 days, total execution of project should be completed latest by 3-months.</p>
          <p>3. P.O & Payments should made in the name of The Shree Creations.</p>
          <p>4. The prices are based on the sizes provided by the customer. The prices are valid for variation in sizes up to +/- 30mm per window provided the design and style of product remains unchanged. The customer will be charged on pro-rate basis for difference between the actual sizes and given sizes, if any, beyond the above variation.</p>
          <p>5. After handovering the windows, cleaning not our scope.</p>
          <p>6. Windows security tape should be remove while installing windows freely, After installation security tape will be removed by us that should be chargeable per window INR 100.</p>
          <p>7. If any other commitments given by our sales team, before placing order please call us . Cell : +91 7057814114.</p>
          <p>8. After handovering windows, If any service require related to windows &amp; doors, that should be chargeable. Per visit - INR 350.</p>
          <p>9. Material unloading &amp; storage should be your scope.</p>
          <p>10. All disputes shall be subject jurisdiction only.</p>
          <h2>Pre-Requisites for installation of Windows:-</h2>
          <p>1. Walls should be plastered from inside and outside, with inside POP complete.<br />2. All jams, sills and soffits should be plastered.<br />3. Flooring (where doors have to be installed) should be complete.<br />4. Aperture should be smooth.<br />5. Base and top of window should be water leveled and sides should be in vertical plump.<br />6. Sill width should be more than the window width.<br />7. Opening should be accessible from inside for installation.<br />8. Grills: Adequate care should be taken if grills have to be installed.<br />a. For Horizontal slider Window: Grill should be provided on the outer face of slider before the installation of the window.<br />b. For Casement windows: Screw type grill is recommended after installation of casement window.<br />9. Installation should happen before the last coat of paint. At least one coat of paint should be done before installation begins.<br />10. Scaffoldings/ bracing should not interrupt the window openings where openings where windows are supposed to be installed.</p>
        </div>
        <p className="print-acceptance">I hereby accept the estimate as per above mentioned price and specifications. I have read and understood the terms &amp; conditions and agree to them.</p>
        <div className="print-signatures"><span>Authorized Signatory<br /><br />____________________________</span><span>Signature of Customer<br /><br />____________________________</span></div>
        {footer(totalPages)}
      </section>
    </div>
  );
}

function RateApprovalDesk({ user }: { user: User }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const rateDesk = user.roleId === 'master-admin' || user.permissions?.['rate-approval'] === 'edit';
  const canSubmit = user.roleId === 'master-admin' || user.permissions?.['quotation-builder'] === 'edit';
  const submissionsQuery = useListQuotationRateSubmissions({ query: { queryKey: getListQuotationRateSubmissionsQueryKey() } });
  const ordersQuery = useListOrders({}, { query: { queryKey: getListOrdersQueryKey({}) } });
  const create = useCreateQuotationRateSubmission();
  const upload = useUploadQuotationRateSubmissionPdf();
  const decide = useDecideQuotationRateSubmission();
  const deleteSubmission = useDeleteQuotationRateSubmission();
  const linkOrder = useLinkQuotationRateSubmissionOrder();
  const [pane, setPane] = useState<'create' | 'requests'>(() => new URLSearchParams(window.location.search).get('pane') === 'requests' ? 'requests' : 'create');
  const [clientName, setClientName] = useState('');
  const [location, setLocation] = useState('');
  const [windowQty, setWindowQty] = useState('');
  const [totalSqFt, setTotalSqFt] = useState('');
  const [glassType, setGlassType] = useState('');
  const [pdf, setPdf] = useState<File | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [linkingSubmission, setLinkingSubmission] = useState<QuotationRateSubmission | null>(null);
  const [linkOrderRecordId, setLinkOrderRecordId] = useState('');
  const [linkMeasurementSheet, setLinkMeasurementSheet] = useState(false);
  const [linkMeasurementId, setLinkMeasurementId] = useState<string | null>(null);
  const [linkMeasurementLabel, setLinkMeasurementLabel] = useState('');
  const submissions = submissionsQuery.data || [];
  const pending = submissions.filter((item) => item.status === 'pending_review');
  const awaiting = submissions.filter((item) => item.status === 'awaiting_pdf');
  const approved = submissions.filter((item) => item.status === 'approved');

  const validatePdf = (file: File | undefined) => {
    if (!file) return false;
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf' && file.type !== 'application/octet-stream')) {
      toast({ title: 'PDF file required', description: 'Attach the Eva Software quotation as a PDF.', variant: 'destructive' });
      return false;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({ title: 'File exceeds 10 MiB', description: 'Choose a smaller PDF before uploading.', variant: 'destructive' });
      return false;
    }
    return true;
  };
  const refreshSubmissions = () => void queryClient.invalidateQueries({ queryKey: getListQuotationRateSubmissionsQueryKey() });
  const uploadPdf = (submissionId: string, file: File) => {
    if (!validatePdf(file)) return;
    upload.mutate({ submissionId, filename: file.name, data: file }, {
      onSuccess: () => {
        refreshSubmissions();
        toast({ title: 'PDF attached', description: 'The rate request is now in the approval queue.' });
      },
      onError: () => toast({ title: 'PDF upload failed', description: 'The request remains available for another upload attempt.', variant: 'destructive' }),
    });
  };
  const submitRate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!clientName.trim() || !glassType.trim() || Number(windowQty) < 1 || Number(totalSqFt) <= 0) {
      toast({ title: 'Complete the rate request', description: 'Add a client, glass type, positive window quantity, and total area.', variant: 'destructive' });
      return;
    }
    if (!pdf) {
      toast({ title: 'Eva Software PDF required', description: 'Attach the quotation PDF before submitting this rate request.', variant: 'destructive' });
      return;
    }
    if (!validatePdf(pdf)) return;
    create.mutate({
      data: {
        clientName: clientName.trim(),
        location: location.trim() || null,
        windowQty: Number(windowQty),
        totalSqFt: Number(totalSqFt),
        glassType: glassType.trim(),
      },
    }, {
      onSuccess: (submission) => {
        refreshSubmissions();
        setPane('requests');
        setClientName('');
        setLocation('');
        setWindowQty('');
        setTotalSqFt('');
        setGlassType('');
        const attached = pdf;
        setPdf(null);
        if (attached) uploadPdf(submission.id, attached);
      },
      onError: () => toast({ title: 'Could not create rate request', description: 'Check the fields and try again.', variant: 'destructive' }),
    });
  };
  const makeDecision = (submission: QuotationRateSubmission, decision: 'approved' | 'rejected') => {
    decide.mutate({ submissionId: submission.id, data: { decision, comment: comments[submission.id] || '' } }, {
      onSuccess: () => {
        refreshSubmissions();
        toast({ title: decision === 'approved' ? 'Rate request approved' : 'Rate request rejected', description: submission.clientName });
      },
      onError: () => toast({ title: 'Decision was not saved', description: 'The request is unchanged. Try again.', variant: 'destructive' }),
    });
  };
  const openOrderLink = (submission: QuotationRateSubmission) => {
    setLinkingSubmission(submission);
    setLinkOrderRecordId(submission.orderRecordId || '');
    setLinkMeasurementSheet(Boolean(submission.measurementRecordId));
    setLinkMeasurementId(submission.measurementRecordId || null);
    setLinkMeasurementLabel(submission.measurementRecordId ? measurementSheetIdLabel(submission.measurementRecordId) : '');
  };
  const saveOrderLink = () => {
    if (!linkingSubmission || !linkOrderRecordId) {
      toast({ title: 'Choose an order', description: 'Select the order before saving the link.', variant: 'destructive' });
      return;
    }
    if (linkMeasurementSheet && !linkMeasurementId) {
      toast({ title: 'Choose a measurement sheet', description: 'Search and select the sheet to link to this order.', variant: 'destructive' });
      return;
    }
    linkOrder.mutate({
      submissionId: linkingSubmission.id,
      data: { orderRecordId: linkOrderRecordId, measurementRecordId: linkMeasurementSheet ? linkMeasurementId : null },
    }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListQuotationRateSubmissionsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListMeasurementRecordsQueryKey() });
        setLinkingSubmission(null);
        toast({ title: 'Quotation request links saved', description: linkMeasurementSheet ? `${measurementSheetIdLabel(linkMeasurementId || '')} is linked directly to ${linkingSubmission.id}.` : linkingSubmission.measurementRecordId ? 'The order link is saved and the measurement sheet link is removed.' : 'The order link is saved.' });
      },
      onError: () => toast({ title: 'Could not link the quotation', description: 'The order links were not changed. Refresh and try again.', variant: 'destructive' }),
    });
  };
  const canLinkSubmission = (submission: QuotationRateSubmission) =>
    user.roleId === 'master-admin'
    || user.permissions?.['rate-approval'] === 'edit'
    || (canSubmit && submission.submittedBy === user.id);
  const canManageSubmission = (submission: QuotationRateSubmission) =>
    user.roleId === 'master-admin'
    || (canSubmit && submission.submittedBy === user.id);
  const removeSubmission = (submission: QuotationRateSubmission) => {
    if (!canManageSubmission(submission)) return;
    if (!window.confirm(`Delete ${submission.id} for ${submission.clientName}? This removes the request, its approval history, and its attached PDF.`)) return;
    deleteSubmission.mutate({ submissionId: submission.id }, {
      onSuccess: () => {
        refreshSubmissions();
        void queryClient.invalidateQueries({ queryKey: getListMeasurementRecordsQueryKey() });
        toast({ title: 'Quotation request deleted', description: `${submission.id} and its approval record were removed.` });
      },
      onError: () => toast({ title: 'Could not delete the request', description: 'The request was not removed. Refresh and try again.', variant: 'destructive' }),
    });
  };
  const statusStyle = (status: string) => status === 'approved' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : status === 'rejected' ? 'border-rose-200 bg-rose-50 text-rose-800' : status === 'pending_review' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-border bg-muted text-muted-foreground';
  const statusName = (status: string) => status === 'pending_review' ? 'Awaiting Approval' : status === 'awaiting_pdf' ? 'Awaiting PDF' : status === 'approved' ? 'Approved' : 'Rejected';
  const pdfInput = (submission: QuotationRateSubmission) => (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold transition-colors hover:bg-muted" data-testid={`label-upload-rate-pdf-${submission.id}`}>
      <FilePlus2 size={14} /> Attach Eva PDF
      <input
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        data-testid={`input-upload-rate-pdf-${submission.id}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) uploadPdf(submission.id, file);
          event.currentTarget.value = '';
        }}
      />
    </label>
  );

  return (
    <div className="space-y-5" data-testid="section-rate-approval-desk">
      <div className="grid gap-3 sm:grid-cols-2" data-testid="rate-approval-summary">
        <Card className="border-amber-200/70 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="flex items-center justify-between p-4">
            <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-amber-800 dark:text-amber-300">Awaiting Approval</p><p className="mt-1 text-xs text-muted-foreground">Requests waiting for a decision</p></div>
            <strong className="font-display text-3xl font-bold text-amber-900 dark:text-amber-200">{pending.length}</strong>
          </CardContent>
        </Card>
        <Card className="border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <CardContent className="flex items-center justify-between p-4">
            <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-emerald-800 dark:text-emerald-300">Approved</p><p className="mt-1 text-xs text-muted-foreground">Rate requests approved</p></div>
            <strong className="font-display text-3xl font-bold text-emerald-900 dark:text-emerald-200">{approved.length}</strong>
          </CardContent>
        </Card>
      </div>
      <Tabs value={pane} onValueChange={(value) => setPane(value as 'create' | 'requests')} data-testid="tabs-rate-request-sections">
        <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl bg-secondary/70 p-1">
          <TabsTrigger value="create" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-create-rate-request"><FilePlus2 size={14} /> Create request</TabsTrigger>
          <TabsTrigger value="requests" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-saved-rate-requests"><FileText size={14} /> Saved requests ({submissions.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="create" className="mt-4" data-testid="section-create-rate-request">
        <Card className="border-border/80" data-testid="card-rate-request-form">
          <CardHeader className="border-b border-border/70 pb-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Rate request</p>
            <CardTitle className="mt-1 font-display text-lg">Send a rate for review</CardTitle>
            <p className="text-xs leading-5 text-muted-foreground">Enter Eva Software totals. The average area per window is calculated by the server.</p>
          </CardHeader>
          <CardContent className="p-5">
            {canSubmit ? <form className="space-y-4" onSubmit={submitRate} data-testid="form-rate-submission">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-semibold sm:col-span-2">Client name<Input value={clientName} onChange={(event) => setClientName(event.target.value)} maxLength={160} required placeholder="Client or project" data-testid="input-rate-client-name" /></label>
                <label className="space-y-1.5 text-xs font-semibold sm:col-span-2">Location <span className="font-normal text-muted-foreground">optional</span><Input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={160} placeholder="Site or city" data-testid="input-rate-location" /></label>
                <label className="space-y-1.5 text-xs font-semibold">Window quantity<Input type="number" min="1" max="100000" value={windowQty} onChange={(event) => setWindowQty(event.target.value)} required data-testid="input-rate-window-quantity" /></label>
                <label className="space-y-1.5 text-xs font-semibold">Total sq. ft.<Input type="number" min="0.01" step="0.01" value={totalSqFt} onChange={(event) => setTotalSqFt(event.target.value)} required data-testid="input-rate-total-sqft" /></label>
                <label className="space-y-1.5 text-xs font-semibold">Average (SqFt / Qty)<Input readOnly value={Number(windowQty) > 0 && Number(totalSqFt) > 0 ? (Number(totalSqFt) / Number(windowQty)).toFixed(2) : ''} placeholder="Calculated from total area and quantity" data-testid="input-rate-average-sqft" /></label>
                <label className="space-y-1.5 text-xs font-semibold sm:col-span-2">Glass type<Input value={glassType} onChange={(event) => setGlassType(event.target.value)} maxLength={120} required placeholder="Clear, toughened, laminated…" data-testid="input-rate-glass-type" /></label>
              </div>
              <label className="block rounded-xl border border-dashed border-border bg-muted/30 p-3 text-xs font-semibold" data-testid="label-rate-pdf">
                Eva Software PDF <span className="font-normal text-muted-foreground">· PDF, up to 10 MiB</span>
                 <Input className="mt-2" type="file" accept="application/pdf,.pdf" required data-testid="input-new-rate-pdf" onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  if (file && validatePdf(file)) setPdf(file);
                  else setPdf(null);
                }} />
                {pdf && <span className="mt-2 block truncate text-[11px] text-primary">{pdf.name} · {(pdf.size / 1024 / 1024).toFixed(2)} MiB</span>}
              </label>
              <Button type="submit" className="w-full" disabled={create.isPending || upload.isPending} data-testid="button-submit-rate-request">
                {create.isPending || upload.isPending ? 'Submitting…' : 'Create rate request'} <FilePlus2 size={15} />
              </Button>
            </form> : <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-xs leading-5 text-muted-foreground" data-testid="rate-submit-read-only">You have view access to this desk. A quotation team member can prepare a rate request.</div>}
          </CardContent>
        </Card>
        </TabsContent>
        <TabsContent value="requests" className="mt-4" data-testid="section-saved-rate-requests">
        <Card className="border-border/80" data-testid="card-rate-queue">
          <CardHeader className="border-b border-border/70 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Live workflow</p><CardTitle className="mt-1 font-display text-lg">Quotation requests</CardTitle><p className="mt-1 text-xs text-muted-foreground">Temporary IDs, approval history, order links, and Eva PDFs stay together.</p></div>
              <div className="flex flex-wrap items-center gap-2">
                {canSubmit && <Button size="sm" variant="outline" onClick={() => setPane('create')} data-testid="button-new-rate-request"><FilePlus2 size={13} /> New request</Button>}
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800">{pending.length} to review</span>
                <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">{awaiting.length} awaiting PDF</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {submissionsQuery.isLoading ? <div className="space-y-3 p-5" data-testid="state-rate-submissions-loading"><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted/70" /></div>
              : submissionsQuery.isError ? <div className="p-5" data-testid="state-rate-submissions-error"><StatePanel kind="error" onRetry={() => void submissionsQuery.refetch()} /></div>
                : submissions.length === 0 ? <div className="grid min-h-52 place-items-center p-7 text-center" data-testid="state-rate-submissions-empty"><div><div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary"><Calculator size={18} /></div><p className="mt-3 text-sm font-bold">No rate requests yet</p><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">A new submission will appear here with its PDF and decision history.</p></div></div>
                  : <div className="overflow-x-auto">
                     <table className="w-full min-w-[1260px] border-collapse text-left text-xs" data-testid="table-rate-submissions">
                      <thead className="bg-muted/50 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">
                        <tr><th className="px-4 py-3">Request ID</th><th className="px-4 py-3">Client / Order</th><th className="px-3 py-3">Qty</th><th className="px-3 py-3">Sq.Ft</th><th className="px-3 py-3">Glass Type</th><th className="px-3 py-3">Location</th><th className="px-3 py-3">Status</th><th className="px-4 py-3">Action</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {submissions.map((submission) => <tr key={submission.id} className="align-top" data-testid={`row-rate-submission-${submission.id}`}>
                          <td className="px-4 py-3">
                            <code className="font-mono text-[11px] font-bold text-primary" data-testid={`text-rate-request-id-${submission.id}`}>{submission.id}</code>
                            <p className="mt-1 text-[10px] text-muted-foreground">Avg. {Number(submission.averageSqFtPerQty).toFixed(2)} sq. ft. / window</p>
                          </td>
                          <td className="max-w-[220px] px-4 py-3">
                            <p className="truncate font-semibold">{submission.clientName}</p>
                            {submission.orderId && <p className="mt-1 text-[10px] font-semibold text-primary" data-testid={`text-rate-order-id-${submission.id}`}>{submission.orderId}</p>}
                            {submission.measurementRecordId && <p className="mt-1 text-[10px] text-muted-foreground">Measurement Sheet ID <code className="font-mono font-semibold text-foreground" data-testid={`text-rate-measurement-sheet-id-${submission.id}`}>{measurementSheetIdLabel(submission.measurementRecordId)}</code></p>}
                            <p className="mt-1 text-[10px] text-muted-foreground">Submitted by {submission.submittedByName}</p>
                            {submission.pdfFilename && <div className="mt-2">
                              <a href={getDownloadQuotationRateSubmissionPdfUrl(submission.id)} download={submission.pdfFilename} className="inline-flex max-w-full items-center gap-1.5 truncate text-[10px] font-semibold text-primary hover:underline" data-testid={`link-download-rate-pdf-${submission.id}`}><Download size={12} /> {submission.pdfNeedsRefresh ? `Previous PDF · ${submission.pdfFilename}` : submission.pdfFilename}</a>
                              {submission.pdfNeedsRefresh && <p className="mt-1 text-[10px] text-amber-700">Updated PDF required before approval</p>}
                            </div>}
                            {submission.status === 'awaiting_pdf' && canManageSubmission(submission) ? pdfInput(submission) : null}
                          </td>
                          <td className="px-3 py-3 tabular-nums">{submission.windowQty}</td>
                          <td className="px-3 py-3 tabular-nums">{submission.totalSqFt.toLocaleString('en-IN')}</td>
                          <td className="px-3 py-3">{submission.glassType}</td>
                          <td className="px-3 py-3">{submission.location || <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.12em] ${statusStyle(submission.status)}`} data-testid={`status-rate-submission-${submission.id}`}>{statusName(submission.status)}</span>
                            {(submission.status === 'approved' || submission.status === 'rejected') && <p className="mt-1 max-w-[130px] text-[10px] leading-4 text-muted-foreground">by {submission.decidedByName || 'approver'}</p>}
                            {submission.decisionComment && <p className="mt-1 max-w-[150px] text-[10px] leading-4 text-muted-foreground">{submission.decisionComment}</p>}
                          </td>
                          <td className="min-w-[260px] px-4 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Button size="sm" variant="outline" onClick={() => navigate(`/quotation-builder/requests/${submission.id}`)} data-testid={`button-view-rate-request-${submission.id}`}><Eye size={13} /> View</Button>
                              {canManageSubmission(submission) && <Button size="sm" variant="outline" onClick={() => navigate(`/quotation-builder/requests/${submission.id}?edit=1`)} data-testid={`button-edit-rate-request-${submission.id}`}><Pencil size={13} /> Edit</Button>}
                              {canManageSubmission(submission) && <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={deleteSubmission.isPending} onClick={() => removeSubmission(submission)} data-testid={`button-delete-rate-request-${submission.id}`}><Trash2 size={13} /> Delete</Button>}
                              {canLinkSubmission(submission) && <Button size="sm" variant="outline" onClick={() => openOrderLink(submission)} data-testid={`button-link-rate-order-${submission.id}`}><Link2 size={13} /> {submission.orderId ? 'Update links' : 'Link to order'}</Button>}
                              {submission.status === 'pending_review' && rateDesk ? <><Button size="sm" onClick={() => makeDecision(submission, 'approved')} disabled={decide.isPending} data-testid={`button-approve-rate-${submission.id}`}><Check size={13} /> Approve</Button><Button size="sm" variant="outline" className="text-destructive" onClick={() => makeDecision(submission, 'rejected')} disabled={decide.isPending} data-testid={`button-reject-rate-${submission.id}`}><X size={13} /> Reject</Button></> : submission.status === 'approved' || submission.status === 'rejected' ? <span className="px-2 text-muted-foreground" data-testid={`text-rate-action-complete-${submission.id}`}>—</span> : null}
                            </div>
                            {submission.status === 'pending_review' && rateDesk && <label className="mt-2 block space-y-1 text-[10px] font-semibold text-muted-foreground">Optional decision note<Textarea rows={2} maxLength={1000} value={comments[submission.id] || ''} onChange={(event) => setComments((current) => ({ ...current, [submission.id]: event.target.value }))} placeholder="Context for the submitter" data-testid={`input-rate-decision-comment-${submission.id}`} /></label>}
                          </td>
                        </tr>)}
                      </tbody>
                    </table>
                  </div>}
          </CardContent>
        </Card>
        </TabsContent>
      </Tabs>
      <div className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4 text-xs leading-5 text-muted-foreground" data-testid="rate-desk-note"><MapPin size={15} className="mt-0.5 shrink-0 text-primary" /><p>Rate requests receive a temporary RA ID, and the server calculates Average (SqFt / Qty). Linking an order is optional and can be done later.</p></div>
      <Dialog open={Boolean(linkingSubmission)} onOpenChange={(open) => { if (!open) setLinkingSubmission(null); }}>
        <DialogContent data-testid="dialog-link-quotation-order">
          <DialogHeader>
            <DialogTitle>Link quotation request and measurement sheet</DialogTitle>
            <DialogDescription>{linkingSubmission ? `${linkingSubmission.id} · ${linkingSubmission.clientName}` : 'Choose an order for this quotation request.'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-1.5 text-xs font-semibold">Order ID
              <Select value={linkOrderRecordId || 'unassigned'} onValueChange={(value) => { setLinkOrderRecordId(value === 'unassigned' ? '' : value); }}>
                <SelectTrigger data-testid="select-link-quotation-order"><SelectValue placeholder="Select an order" /></SelectTrigger>
                <SelectContent>
                  {ordersQuery.isLoading ? <SelectItem value="loading" disabled>Loading orders…</SelectItem>
                    : (ordersQuery.data || []).map((order) => <SelectItem key={order.id} value={order.id}>{order.orderId} · {order.clientName} · {order.locationName}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            {ordersQuery.isError && <p className="text-xs text-destructive">Orders could not be loaded. Close and retry after refreshing the order list.</p>}
            {linkOrderRecordId && <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input type="checkbox" checked={linkMeasurementSheet} onChange={(event) => { setLinkMeasurementSheet(event.target.checked); if (!event.target.checked) { setLinkMeasurementId(null); setLinkMeasurementLabel(''); } }} className="h-4 w-4 accent-primary" data-testid="checkbox-link-measurement-from-quotation" />
                Link a measurement sheet ID to this request
              </label>
              {linkMeasurementSheet && <MeasurementSheetLookup
                selectedId={linkMeasurementId}
                selectedLabel={linkMeasurementLabel}
                currentQuotationRequestId={linkingSubmission?.id || ''}
                onSelect={(item) => { setLinkMeasurementId(item.id); setLinkMeasurementLabel(`${measurementSheetIdLabel(item.id)} · ${item.clientName}`); }}
              />}
            </div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkingSubmission(null)} data-testid="button-cancel-link-quotation">Cancel</Button>
            <Button onClick={saveOrderLink} disabled={linkOrder.isPending || ordersQuery.isError} data-testid="button-save-quotation-order-link">{linkOrder.isPending ? 'Saving…' : 'Save links'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function QuotationBuilderPage({ user }: { user: User }) {
  const canEdit = user.roleId === 'master-admin' || user.permissions?.['quotation-builder'] === 'edit';
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'new' | 'profiles' | 'drafts' | 'rates'>(() => {
    const initialSection = new URLSearchParams(window.location.search).get('section');
    return initialSection === 'profiles' || initialSection === 'drafts' || initialSection === 'rates' ? initialSection : 'new';
  });
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
  const visibleQuotes = useMemo(
    () => quotations.filter((quote) => `${quote.quoteNo} ${quote.customerName} ${quote.projectName}`.toLowerCase().includes(search.toLowerCase())),
    [quotations, search],
  );

  useEffect(() => {
    const remove = () => document.body.classList.remove('print-quotation');
    return remove;
  }, []);

  const print = () => {
    if (!selectedQuote) return;
    document.body.classList.add('print-quotation');
    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => document.body.classList.remove('print-quotation'), 300);
    }, 80);
  };
  const archiveQuote = (quote: Quotation) => {
    if (!window.confirm(`Archive ${quote.quoteNo}? It will no longer appear in the draft register.`)) return;
    archive.mutate({ quotationId: quote.id }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListQuotationsQueryKey() });
        if (selectedQuoteId === quote.id) setSelectedQuoteId(null);
        toast({ title: 'Quotation archived', description: quote.quoteNo });
      },
    });
  };
  const openNew = () => {
    setSelectedQuoteId(null);
    setActiveSection('new');
  };
  const openQuote = (quote: Quotation) => {
    setSelectedQuoteId(quote.id);
    setActiveSection('drafts');
  };
  const onQuotationSaved = (saved: Quotation) => {
    setSelectedQuoteId(saved.id);
    setActiveSection('drafts');
  };

  return (
    <AppShell user={user} title="Quotation & Rate Approval" eyebrow="Module 3 · quotation and approval desk">
      <div className="quotation-builder-page space-y-6">
        <section className="quotation-hero animate-enter-up overflow-hidden rounded-2xl p-6 text-white shadow-sm md:p-8">
          <div className="relative z-10 max-w-4xl">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-primary">
              <span>Framewise quoting desk</span><span className="h-1 w-1 rounded-full bg-accent" /><span>{canEdit ? 'Edit access' : 'View only'}</span>
            </div>
            <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold tracking-[-0.05em] md:text-4xl">Make every opening measurable, priced, and ready to send.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">New quotations, reusable profiles, and saved drafts each have a dedicated workspace.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <div className="rounded-lg bg-white/10 px-3 py-2 text-xs"><strong className="font-display text-base">{quotations.length}</strong><span className="ml-2 text-white/65">saved drafts</span></div>
              <div className="rounded-lg bg-white/10 px-3 py-2 text-xs"><strong className="font-display text-base">{profiles.length}</strong><span className="ml-2 text-white/65">active profiles</span></div>
              <div className="rounded-lg bg-white/10 px-3 py-2 text-xs"><strong className="font-display text-base">THE-QT</strong><span className="ml-2 text-white/65">quote series</span></div>
            </div>
          </div>
          <div className="quotation-hero-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Card className="animate-enter-up delay-1 border-border/80"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Draft register</p><FileText size={16} className="text-primary" /></div><p className="mt-3 font-display text-3xl font-bold" data-testid="metric-quotation-drafts">{quotations.length}</p><p className="mt-1 text-xs text-muted-foreground">saved customer proposals</p></CardContent></Card>
          <Card className="animate-enter-up delay-2 border-border/80"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Catalogue</p><BookOpen size={16} className="text-accent-foreground" /></div><p className="mt-3 font-display text-3xl font-bold" data-testid="metric-window-profiles">{profiles.length}</p><p className="mt-1 text-xs text-muted-foreground">active reusable profiles</p></CardContent></Card>
          <Card className="animate-enter-up delay-3 border-border/80"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Default series</p><Settings2 size={16} className="text-primary" /></div><p className="mt-3 font-display text-xl font-bold">₹644.97</p><p className="mt-1 text-xs text-muted-foreground">editable starting rate / sq.ft.</p></CardContent></Card>
        </section>

        <Tabs value={activeSection} onValueChange={(value) => setActiveSection(value as 'new' | 'profiles' | 'drafts' | 'rates')} className="w-full" data-testid="tabs-quotation-sections">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-secondary/70 p-1 sm:grid-cols-4">
            <TabsTrigger value="new" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-new-quotation"><FilePlus2 size={15} /> New quotation</TabsTrigger>
            <TabsTrigger value="profiles" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-window-profiles"><BookOpen size={15} /> Window profiles</TabsTrigger>
            <TabsTrigger value="drafts" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-saved-work"><FileText size={15} /> Saved work (Drafts)</TabsTrigger>
            <TabsTrigger value="rates" className="gap-2 py-2.5 text-xs sm:text-sm" data-testid="tab-rate-approval"><Calculator size={15} /> Rate approvals</TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="mt-5" data-testid="section-new-quotation">
            <QuoteEditor quote={null} clients={clients} profiles={profiles} canEdit={canEdit} onNew={openNew} onSaved={onQuotationSaved} />
          </TabsContent>

          <TabsContent value="profiles" className="mt-5" data-testid="section-window-profiles">
            <ProfileCatalogue
              profiles={profiles}
              canEdit={canEdit}
              loading={profilesQuery.isLoading}
              error={Boolean(profilesQuery.isError)}
              onRetry={() => void profilesQuery.refetch()}
              onAdd={() => { setEditingProfile(null); setProfileDialogOpen(true); }}
              onEdit={(profile) => { setEditingProfile(profile); setProfileDialogOpen(true); }}
            />
          </TabsContent>

          <TabsContent value="drafts" className="mt-5" data-testid="section-saved-work">
            <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
              <Card className="border-border/80" data-testid="card-quotation-register">
                <CardHeader className="border-b border-border/70 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Saved work</p><CardTitle className="mt-1 font-display text-lg">Quotation register</CardTitle></div>
                    {canEdit && <Button size="icon" onClick={openNew} aria-label="Create quotation" data-testid="button-create-quotation"><Plus size={17} /></Button>}
                  </div>
                  <div className="relative mt-3"><Search size={15} className="absolute left-3 top-2.5 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search quote or customer" data-testid="input-search-quotations" /></div>
                </CardHeader>
                <CardContent className="p-0">
                  {quotationQuery.isLoading ? <div className="p-5"><StatePanel kind="loading" /></div>
                    : quotationQuery.isError ? <div className="p-5"><StatePanel kind="error" onRetry={() => void quotationQuery.refetch()} /></div>
                      : !visibleQuotes.length ? <div className="p-6"><StatePanel kind="empty" /></div>
                        : <div className="divide-y divide-border/70">
                          {visibleQuotes.map((quote) => (
                            <button key={quote.id} type="button" onClick={() => openQuote(quote)} className={`group w-full p-4 text-left transition-colors hover:bg-secondary/35 ${selectedQuoteId === quote.id ? 'bg-secondary/50' : ''}`} data-testid={`button-open-quotation-${quote.id}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2"><span className="font-mono text-[10px] font-bold text-primary">{quote.quoteNo}</span><span className="rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-foreground">Draft</span></div>
                                  <p className="mt-2 truncate text-sm font-semibold">{quote.customerName || 'Unnamed customer'}</p>
                                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{quote.projectName || 'No project name'} · {dateLabel(quote.quotationDate)}</p>
                                </div>
                                <span className="text-right font-display text-sm font-bold">{money(quote.totals.grandTotal)}<span className="mt-1 block font-sans text-[10px] font-normal text-muted-foreground">{quote.totals.componentCount} windows</span></span>
                              </div>
                            </button>
                          ))}
                        </div>}
                </CardContent>
              </Card>

              <div className="min-w-0 space-y-6">
                {selectedQuote
                  ? <QuoteEditor quote={selectedQuote} clients={clients} profiles={profiles} canEdit={canEdit} onNew={openNew} onSaved={onQuotationSaved} />
                  : selectedQuoteId && selectedQuery.isLoading
                    ? <div className="rounded-xl border border-border/80 bg-card p-5"><StatePanel kind="loading" /></div>
                    : selectedQuoteId && selectedQuery.isError
                      ? <div className="rounded-xl border border-border/80 bg-card p-5"><StatePanel kind="error" onRetry={() => void selectedQuery.refetch()} /></div>
                      : <div className="grid min-h-[420px] place-items-center rounded-xl border border-dashed border-border bg-card/60 p-8 text-center">
                        <div>
                          <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-secondary text-primary"><Copy size={21} /></div>
                          <h3 className="mt-4 font-display text-lg font-bold">Choose a saved draft</h3>
                          <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">Select a quotation from the register to review, edit, or print it.</p>
                          {canEdit && <Button className="mt-5" onClick={openNew} data-testid="button-start-quotation"><FilePlus2 size={15} /> Start quotation</Button>}
                        </div>
                      </div>}
                {selectedQuote && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-card px-4 py-3 shadow-sm">
                  <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Saved document</p><p className="mt-1 text-xs text-foreground">{selectedQuote.quoteNo} · {selectedQuote.totals.componentCount} components · {money(selectedQuote.totals.grandTotal)}</p></div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={print} disabled={selectedQuery.isLoading} data-testid="button-print-quotation"><Printer size={14} /> Print / PDF</Button>
                    {canEdit && <Button variant="ghost" size="sm" onClick={() => archiveQuote(selectedQuote)} data-testid="button-archive-quotation"><Archive size={14} /> Archive</Button>}
                  </div>
                </div>}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="rates" className="mt-5" data-testid="section-rate-approval">
            <RateApprovalDesk user={user} />
          </TabsContent>
        </Tabs>

        <ProfileDialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen} editing={editingProfile} onDone={() => setProfileDialogOpen(false)} />
        {selectedQuote && <QuotationPrintDocument quote={selectedQuote} />}
      </div>
    </AppShell>
  );
}