import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ClipboardList,
  Download,
  Eye,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  LayoutGrid,
  List,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  getDownloadMeasurementVersionUrl,
  getListMeasurementRecordsQueryKey,
  getListOrdersQueryKey,
  getListQuotationRateSubmissionsQueryKey,
  useCreateMeasurementRecord,
  useDeleteMeasurementRecord,
  useDeleteMeasurementVersion,
  useListMeasurementRecords,
  useListOrders,
  useUpdateMeasurementRecord,
  useUpdateMeasurementVersion,
  uploadMeasurementVersion,
} from '@workspace/api-client-react';
import { getPreviewMeasurementVersionUrl } from '@workspace/api-client-react';
import type { MeasurementRecord, MeasurementVersion, Order, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { measurementSheetIdLabel, QuotationRequestLookup } from '@/components/link-record-lookups';
import { useLocation } from 'wouter';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
type MeasurementEdit = {
  clientName: string;
  location: string;
  orderRecordId: string;
  linkQuotation: boolean;
  linkQuotationSubmissionId: string | null;
  quotationLabel: string;
};
type MeasurementSheetDraft = { id: number; file: File; name: string; replacesVersionNumber?: number };
let nextMeasurementSheetDraftId = 0;
const measurementSheetDraft = (file: File, name = '', replacesVersionNumber?: number): MeasurementSheetDraft => ({
  id: ++nextMeasurementSheetDraftId,
  file,
  name,
  replacesVersionNumber,
});
const acceptedExtensions = ['pdf', 'xlsx', 'csv'];
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const sizeLabel = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(2)} MiB`;
const extensionOf = (filename: string) => filename.split('.').pop()?.toLowerCase() || '';
type MeasurementLayout = 'list' | 'grid';
type MeasurementSort = 'recent' | 'oldest' | 'client';
type MeasurementFileFilter = 'all' | 'none' | 'pdf' | 'xlsx' | 'csv';
type MeasurementOrderFilter = 'all' | 'assigned' | 'unassigned';
type MeasurementQuotationFilter = 'all' | 'linked' | 'unlinked';

function RecordState({ state, onRetry }: { state: 'loading' | 'error' | 'empty'; onRetry?: () => void }) {
  if (state === 'loading') return <div className="space-y-3 p-5" data-testid="state-measurements-loading"><div className="h-20 animate-pulse rounded-xl bg-muted" /><div className="h-20 animate-pulse bg-muted/70 rounded-xl" /><div className="h-20 animate-pulse rounded-xl bg-muted/50" /></div>;
  if (state === 'error') return <div className="grid min-h-64 place-items-center p-8 text-center" data-testid="state-measurements-error"><div><AlertCircle size={23} className="mx-auto text-destructive" /><p className="mt-3 font-display text-sm font-bold">Measurement register unavailable</p><p className="mt-1 text-xs text-muted-foreground">The retained sheet records could not be loaded.</p><Button size="sm" variant="outline" className="mt-4" onClick={onRetry} data-testid="button-retry-measurements"><RefreshCw size={13} /> Retry</Button></div></div>;
  return <div className="grid min-h-64 place-items-center p-8 text-center" data-testid="state-measurements-empty"><div><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-secondary text-primary"><FileSpreadsheet size={20} /></div><p className="mt-3 font-display text-sm font-bold">No measurement sheets filed</p><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Create a client record, then add each sheet version. Older versions remain available for traceability.</p></div></div>;
}

export default function MeasurementDatabasePage({ user }: { user: User }) {
  const [, navigate] = useLocation();
  const canEdit = user.roleId === 'master-admin' || user.permissions?.measurements === 'edit';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const recordsQuery = useListMeasurementRecords({ query: { queryKey: getListMeasurementRecordsQueryKey() } });
  const ordersQuery = useListOrders({}, { query: { queryKey: getListOrdersQueryKey({}) } });
  const create = useCreateMeasurementRecord();
  const update = useUpdateMeasurementRecord();
  const deleteRecord = useDeleteMeasurementRecord();
  const updateVersion = useUpdateMeasurementVersion();
  const deleteVersion = useDeleteMeasurementVersion();
  const upload = useMutation({
    mutationFn: ({ recordId, file, name }: { recordId: string; file: File; name: string }) =>
      uploadMeasurementVersion(recordId, encodeURIComponent(file.name), file, {
        headers: name.trim() ? { 'X-Measurement-Sheet-Name': encodeURIComponent(name.trim()) } : undefined,
      }),
  });
  const [clientName, setClientName] = useState('');
  const [location, setLocation] = useState('');
  const [orderRecordId, setOrderRecordId] = useState('');
  const [initialFiles, setInitialFiles] = useState<MeasurementSheetDraft[]>([]);
  const [versionFiles, setVersionFiles] = useState<Record<string, MeasurementSheetDraft[]>>({});
  const [uploadingBatch, setUploadingBatch] = useState(false);
  const [edits, setEdits] = useState<Record<string, MeasurementEdit>>({});
  const [versionNameDrafts, setVersionNameDrafts] = useState<Record<string, string>>({});
  const [recordSearch, setRecordSearch] = useState('');
  const [fileFilter, setFileFilter] = useState<MeasurementFileFilter>('all');
  const [orderFilter, setOrderFilter] = useState<MeasurementOrderFilter>('all');
  const [quotationFilter, setQuotationFilter] = useState<MeasurementQuotationFilter>('all');
  const [sortBy, setSortBy] = useState<MeasurementSort>('recent');
  const [layout, setLayout] = useState<MeasurementLayout>('list');
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const records = recordsQuery.data || [];
  const orders = ordersQuery.data || [];
  const invalidateRecords = () => void queryClient.invalidateQueries({ queryKey: getListMeasurementRecordsQueryKey() });
  const visibleRecords = useMemo(() => {
    const query = recordSearch.trim().toLocaleLowerCase();
    const filtered = records.filter((record) => {
      const searchable = [
        measurementSheetIdLabel(record.id),
        record.quotationRequestId || '',
        record.clientName,
        record.location || '',
        record.orderId || '',
        ...record.versions.flatMap((version) => [version.name || '', version.filename]),
      ].join(' ').toLocaleLowerCase();
      if (query && !searchable.includes(query)) return false;
      if (fileFilter === 'none' && record.versions.length > 0) return false;
      if (fileFilter !== 'all' && fileFilter !== 'none'
        && !record.versions.some((version) => extensionOf(version.filename) === fileFilter)) return false;
      if (orderFilter === 'assigned' && !record.orderRecordId) return false;
      if (orderFilter === 'unassigned' && record.orderRecordId) return false;
      if (quotationFilter === 'linked' && !record.quotationRequestId) return false;
      if (quotationFilter === 'unlinked' && record.quotationRequestId) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (sortBy === 'client') return a.clientName.localeCompare(b.clientName);
      const difference = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      return sortBy === 'oldest' ? difference : -difference;
    });
  }, [fileFilter, orderFilter, quotationFilter, recordSearch, records, sortBy]);

  const validateFile = (file: File | undefined) => {
    if (!file) return false;
    if (!acceptedExtensions.includes(extensionOf(file.name))) {
      toast({ title: 'Unsupported measurement sheet', description: 'Choose a PDF, XLSX, or CSV file.', variant: 'destructive' });
      return false;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({ title: 'File exceeds 10 MiB', description: 'Choose a smaller measurement sheet.', variant: 'destructive' });
      return false;
    }
    return true;
  };
  const addInitialFiles = (files: File[]) => {
    const additions = files.filter(validateFile).map((file) => measurementSheetDraft(file));
    if (additions.length) setInitialFiles((current) => [...current, ...additions]);
  };
  const addVersionFiles = (recordId: string, files: File[], replacing?: MeasurementVersion) => {
    const additions = files.filter(validateFile).map((file) => measurementSheetDraft(
      file,
      replacing?.name || '',
      replacing?.versionNumber,
    ));
    if (additions.length) {
      setVersionFiles((current) => ({
        ...current,
        [recordId]: [...(current[recordId] || []), ...additions],
      }));
    }
  };
  const uploadSheets = async (recordId: string, drafts: MeasurementSheetDraft[], creatingRecord = false) => {
    if (drafts.length === 0) return [];
    setUploadingBatch(true);
    let uploaded = 0;
    const failed: MeasurementSheetDraft[] = [];
    try {
      for (const draft of drafts) {
        try {
          await upload.mutateAsync({ recordId, file: draft.file, name: draft.name.trim() });
          uploaded += 1;
        } catch {
          failed.push(draft);
        }
      }
    } finally {
      setUploadingBatch(false);
    }
    invalidateRecords();
    if (failed.length) {
      toast({
        title: creatingRecord ? 'Record created; some sheets failed' : `${uploaded} of ${drafts.length} sheets uploaded`,
        description: `${failed.length} failed and remain in the upload queue so you can retry.`,
        variant: 'destructive',
      });
    } else {
      toast({
        title: creatingRecord ? 'Measurement record created' : 'Measurement sheets added',
        description: `${uploaded} ${uploaded === 1 ? 'sheet was' : 'sheets were'} added to the record history.`,
      });
    }
    return failed;
  };
  const createRecord = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!clientName.trim()) {
      toast({ title: 'Client name is required', variant: 'destructive' });
      return;
    }
    if (initialFiles.some((draft) => !validateFile(draft.file))) return;
    const sheetsToUpload = initialFiles;
    create.mutate({ data: { clientName: clientName.trim(), location: location.trim() || null, orderRecordId: orderRecordId || null } }, {
      onSuccess: async (record) => {
        invalidateRecords();
        setClientName('');
        setLocation('');
        setOrderRecordId('');
        setInitialFiles([]);
        if (sheetsToUpload.length) {
          const failed = await uploadSheets(record.id, sheetsToUpload, true);
          if (failed.length) setVersionFiles((current) => ({ ...current, [record.id]: failed }));
        } else {
          toast({ title: 'Measurement record created', description: `${record.clientName} is ready for sheet versions.` });
        }
      },
      onError: () => toast({ title: 'Could not create measurement record', description: 'Check the details and try again.', variant: 'destructive' }),
    });
  };
  const currentEdit = (record: MeasurementRecord) => edits[record.id] || {
    clientName: record.clientName,
    location: record.location || '',
    orderRecordId: record.orderRecordId || '',
    linkQuotation: Boolean(record.quotationRequestId),
    linkQuotationSubmissionId: record.quotationRequestId,
    quotationLabel: record.quotationRequestId || '',
  };
  const saveRecord = (record: MeasurementRecord) => {
    const value = currentEdit(record);
    if (!value.clientName.trim()) {
      toast({ title: 'Client name is required', variant: 'destructive' });
      return;
    }
    if (value.linkQuotation && !value.linkQuotationSubmissionId) {
      toast({ title: 'Choose a quotation request', description: 'Search for and select the temporary quotation ID to link.', variant: 'destructive' });
      return;
    }
    update.mutate({
      recordId: record.id,
      data: {
        clientName: value.clientName.trim(),
        location: value.location.trim() || null,
        orderRecordId: value.orderRecordId || null,
        linkQuotationSubmissionId: value.linkQuotation ? value.linkQuotationSubmissionId || undefined : null,
      },
    }, {
      onSuccess: () => {
        invalidateRecords();
        void queryClient.invalidateQueries({ queryKey: getListQuotationRateSubmissionsQueryKey() });
        setEdits((current) => {
          const next = { ...current };
          delete next[record.id];
          return next;
        });
        setEditingRecordId(null);
        toast({ title: 'Measurement record updated', description: value.linkQuotation ? `Sheet ID linked directly to ${value.linkQuotationSubmissionId}.` : record.quotationRequestId ? 'Details saved and the quotation request unlinked.' : 'Client details and order assignment are saved.' });
      },
      onError: () => toast({ title: 'Could not update record', description: 'The record remains unchanged. Try again.', variant: 'destructive' }),
    });
  };
  const setEdit = (record: MeasurementRecord, key: keyof MeasurementEdit, value: string | boolean) => {
    setEdits((current) => {
      const next = { ...currentEdit(record), [key]: value } as MeasurementEdit;
      if (key === 'linkQuotation' && value === false) {
        next.linkQuotation = false;
        next.linkQuotationSubmissionId = null;
        next.quotationLabel = '';
      }
      if (key === 'orderRecordId' && typeof value === 'string' && value) {
        const selectedOrder = orders.find((order) => order.id === value);
        if (selectedOrder) {
          next.clientName = selectedOrder.clientName;
          next.location = selectedOrder.locationName;
        }
      }
      return { ...current, [record.id]: next };
    });
  };
  const saveVersionName = (record: MeasurementRecord, version: MeasurementVersion) => {
    const draft = versionNameDrafts[version.id] ?? version.name ?? '';
    updateVersion.mutate({
      recordId: record.id,
      versionId: version.id,
      data: { name: draft.trim() || null },
    }, {
      onSuccess: () => {
        invalidateRecords();
        setVersionNameDrafts((current) => {
          const next = { ...current };
          delete next[version.id];
          return next;
        });
        toast({ title: 'Sheet name updated', description: 'The original filename is still retained for downloads.' });
      },
      onError: () => toast({ title: 'Could not update sheet name', description: 'The saved file name was not changed.', variant: 'destructive' }),
    });
  };
  const removeVersion = (record: MeasurementRecord, version: MeasurementVersion) => {
    const label = version.name || version.filename;
    if (!window.confirm(`Delete "${label}" from ${record.clientName}? This permanently removes the file and its version entry.`)) return;
    deleteVersion.mutate({ recordId: record.id, versionId: version.id }, {
      onSuccess: () => {
        invalidateRecords();
        toast({ title: 'Measurement file deleted', description: `${label} was removed from the retained history.` });
      },
      onError: () => toast({ title: 'Could not delete measurement file', description: 'The file remains in the register. Try again.', variant: 'destructive' }),
    });
  };
  const removeRecord = (record: MeasurementRecord) => {
    const sheetId = measurementSheetIdLabel(record.id);
    const fileCount = record.versions.length;
    if (!window.confirm(`Delete measurement sheet ${sheetId} for ${record.clientName}? This permanently removes the record and all ${fileCount} retained file${fileCount === 1 ? '' : 's'}. Its quotation request will be unlinked.`)) return;
    deleteRecord.mutate({ recordId: record.id }, {
      onSuccess: () => {
        invalidateRecords();
        void queryClient.invalidateQueries({ queryKey: getListQuotationRateSubmissionsQueryKey() });
        setEditingRecordId((current) => current === record.id ? null : current);
        setEdits((current) => {
          const next = { ...current };
          delete next[record.id];
          return next;
        });
        setVersionFiles((current) => {
          const next = { ...current };
          delete next[record.id];
          return next;
        });
        toast({ title: 'Measurement record deleted', description: `${sheetId} and its retained files were removed.` });
      },
      onError: () => toast({ title: 'Could not delete measurement record', description: 'The record and its files remain unchanged. Try again.', variant: 'destructive' }),
    });
  };
  const orderOption = (order: Order) => `${order.orderId} · ${order.clientName} · ${order.locationName}`;
  const assignNewRecordOrder = (value: string) => {
    setOrderRecordId(value);
    const selectedOrder = orders.find((order) => order.id === value);
    if (selectedOrder) {
      setClientName(selectedOrder.clientName);
      setLocation(selectedOrder.locationName);
    }
  };
  const OrderSelect = ({ value, onChange, testId }: { value: string; onChange: (value: string) => void; testId: string }) => (
    <Select value={value || 'unassigned'} onValueChange={(selected) => onChange(selected === 'unassigned' ? '' : selected)}>
      <SelectTrigger data-testid={testId}><SelectValue placeholder="No order assigned" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="unassigned">No order assigned</SelectItem>
        {orders.map((order) => <SelectItem key={order.id} value={order.id}>{orderOption(order)}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <AppShell user={user} title="Measurement sheets" eyebrow="Module 6 · retained register">
      <div className="space-y-6">
        <section className="quotation-hero animate-enter-up relative overflow-hidden rounded-2xl p-6 shadow-sm md:p-8" data-testid="measurements-hero">
          <div className="relative z-10 max-w-3xl">
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-primary"><span>Traceable fabrication records</span><span className="h-1 w-1 rounded-full bg-accent" /><span>PDF · XLSX · CSV</span></p>
            <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-[-0.05em] md:text-4xl">Every measurement sheet, kept with its history.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">Every record receives a permanent Measurement Sheet ID. Link it directly to an RA request ID, search or filter the register, and keep every uploaded version for traceability.</p>
            <div className="mt-5 flex flex-wrap gap-2"><span className="rounded-lg bg-white/10 px-3 py-2 text-xs"><strong className="font-display text-base">{records.length}</strong><span className="ml-2 text-white/65">measurement records</span></span><span className="rounded-lg bg-white/10 px-3 py-2 text-xs"><strong className="font-display text-base">{records.reduce((count, record) => count + record.versions.length, 0)}</strong><span className="ml-2 text-white/65">retained versions</span></span></div>
          </div>
          <div className="quotation-hero-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        </section>

        {canEdit && <Card className="border-border/80" data-testid="card-new-measurement-record">
          <CardHeader className="border-b border-border/70 pb-4"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">New client file</p><CardTitle className="mt-1 font-display text-lg">Create measurement record</CardTitle><p className="text-xs text-muted-foreground">Initial sheets are optional. Select several files and give each an optional name; you can add more versions later.</p></CardHeader>
          <CardContent className="p-5">
            <form className="grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr_1.3fr_auto]" onSubmit={createRecord} data-testid="form-new-measurement-record">
              <label className="space-y-1.5 text-xs font-semibold">Client name<Input value={clientName} onChange={(event) => setClientName(event.target.value)} maxLength={160} disabled={create.isPending || uploadingBatch} required placeholder="Client or company" data-testid="input-measurement-client-name" /></label>
              <label className="space-y-1.5 text-xs font-semibold">Location <span className="font-normal text-muted-foreground">optional</span><Input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={160} disabled={create.isPending || uploadingBatch} placeholder="Site or city" data-testid="input-measurement-location" /></label>
              <label className="space-y-1.5 text-xs font-semibold">Order assignment <span className="font-normal text-muted-foreground">optional</span><OrderSelect value={orderRecordId} onChange={assignNewRecordOrder} testId="select-measurement-order" /></label>
              <label className="space-y-1.5 text-xs font-semibold">Initial sheets <span className="font-normal text-muted-foreground">PDF / XLSX / CSV · max 10 MiB each</span><Input type="file" multiple accept=".pdf,.xlsx,.csv,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-testid="input-measurement-initial-file" disabled={create.isPending || uploadingBatch} onChange={(event) => {
                addInitialFiles(Array.from(event.currentTarget.files || []));
                event.currentTarget.value = '';
              }} /></label>
              <div className="flex items-end"><Button type="submit" disabled={create.isPending || uploadingBatch || upload.isPending} className="w-full lg:w-auto" data-testid="button-create-measurement-record"><Plus size={15} /> {create.isPending ? 'Creating…' : uploadingBatch ? 'Uploading sheets…' : 'Create record'}</Button></div>
              {initialFiles.length > 0 && <div className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3 lg:col-span-full" data-testid="list-initial-measurement-sheets">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Files to attach</p>
                {initialFiles.map((draft) => <div key={draft.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)_auto] sm:items-center" data-testid={`row-initial-measurement-sheet-${draft.id}`}>
                  <div className="min-w-0"><p className="truncate text-xs font-semibold">{draft.file.name}</p><p className="text-[10px] text-muted-foreground">{sizeLabel(draft.file.size)}</p></div>
                  <Input value={draft.name} onChange={(event) => setInitialFiles((current) => current.map((item) => item.id === draft.id ? { ...item, name: event.target.value } : item))} maxLength={160} disabled={create.isPending || uploadingBatch} placeholder="Sheet name (optional)" aria-label={`Optional name for ${draft.file.name}`} data-testid={`input-initial-measurement-sheet-name-${draft.id}`} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${draft.file.name}`} disabled={create.isPending || uploadingBatch} onClick={() => setInitialFiles((current) => current.filter((item) => item.id !== draft.id))} data-testid={`button-remove-initial-measurement-sheet-${draft.id}`}><X size={15} /></Button>
                </div>)}
              </div>}
            </form>
          </CardContent>
        </Card>}

        <Card className="overflow-hidden border-border/80" data-testid="card-measurement-register">
          <CardHeader className="border-b border-border/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Register</p><CardTitle className="mt-1 font-display text-lg">Client measurement sheets</CardTitle><p className="mt-1 text-xs text-muted-foreground">One record per list or grid card, with a permanent sheet ID, Rate Approval link, and retained versions.</p></div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground"><ClipboardList size={13} /> {records.length} records</span>
            </div>
            {ordersQuery.isError && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" data-testid="state-measurement-orders-error"><span>Order list unavailable. Existing records remain visible; order choices may be incomplete.</span><Button size="sm" variant="outline" onClick={() => void ordersQuery.refetch()} data-testid="button-retry-measurement-orders"><RefreshCw size={13} /> Retry orders</Button></div>}
          </CardHeader>
          <CardContent className="p-0">
            {recordsQuery.isLoading ? <RecordState state="loading" />
              : recordsQuery.isError ? <RecordState state="error" onRetry={() => void recordsQuery.refetch()} />
                : records.length === 0 ? <RecordState state="empty" />
                  : <div>
                    <div className="grid gap-3 border-b border-border/70 bg-muted/10 p-4 xl:grid-cols-[minmax(230px,1fr)_150px_160px_160px_170px_auto]">
                      <label className="relative min-w-0">
                        <span className="sr-only">Search measurement records and files</span>
                        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} className="pl-9" placeholder="Client, site, order or file name" data-testid="input-search-measurements" />
                      </label>
                      <Select value={fileFilter} onValueChange={(value) => setFileFilter(value as MeasurementFileFilter)}>
                        <SelectTrigger aria-label="Filter by sheet type" data-testid="select-measurement-file-filter"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All sheet types</SelectItem>
                          <SelectItem value="pdf">PDF files</SelectItem>
                          <SelectItem value="xlsx">XLSX files</SelectItem>
                          <SelectItem value="csv">CSV files</SelectItem>
                          <SelectItem value="none">No sheets yet</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={orderFilter} onValueChange={(value) => setOrderFilter(value as MeasurementOrderFilter)}>
                        <SelectTrigger aria-label="Filter by order assignment" data-testid="select-measurement-order-filter"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All order links</SelectItem>
                          <SelectItem value="assigned">Order assigned</SelectItem>
                          <SelectItem value="unassigned">No order assigned</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={quotationFilter} onValueChange={(value) => setQuotationFilter(value as MeasurementQuotationFilter)}>
                        <SelectTrigger aria-label="Filter by quotation request link" data-testid="select-measurement-quotation-filter"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All quotation links</SelectItem>
                          <SelectItem value="linked">RA request linked</SelectItem>
                          <SelectItem value="unlinked">No RA request</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={sortBy} onValueChange={(value) => setSortBy(value as MeasurementSort)}>
                        <SelectTrigger aria-label="Sort measurement records" data-testid="select-measurement-sort"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="recent">Recently updated</SelectItem>
                          <SelectItem value="oldest">Oldest updated</SelectItem>
                          <SelectItem value="client">Client A–Z</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-2 xl:justify-end">
                        <span className="mr-1 text-[10px] text-muted-foreground">{visibleRecords.length} of {records.length}</span>
                        <div className="flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Measurement record layout">
                          <Button type="button" size="sm" variant={layout === 'list' ? 'secondary' : 'ghost'} aria-pressed={layout === 'list'} aria-label="List view" onClick={() => setLayout('list')} data-testid="button-measurement-list-view"><List size={15} /></Button>
                          <Button type="button" size="sm" variant={layout === 'grid' ? 'secondary' : 'ghost'} aria-pressed={layout === 'grid'} aria-label="Grid view" onClick={() => setLayout('grid')} data-testid="button-measurement-grid-view"><LayoutGrid size={15} /></Button>
                        </div>
                      </div>
                    </div>
                    {visibleRecords.length === 0 ? <div className="grid min-h-48 place-items-center p-8 text-center" data-testid="state-measurement-filter-empty">
                      <div><Search size={20} className="mx-auto text-muted-foreground" /><p className="mt-3 font-semibold">No matching measurement sheets</p><p className="mt-1 text-xs text-muted-foreground">Try another search or change the filters.</p></div>
                    </div> : <div className={layout === 'grid' ? 'grid gap-4 p-4 sm:grid-cols-2' : 'divide-y divide-border/70'}>
                    {visibleRecords.map((record) => {
                      const edit = currentEdit(record);
                      const pendingSheets = versionFiles[record.id] || [];
                      const isEditing = editingRecordId === record.id;
                      const visibleVersions = record.versions.filter((version) =>
                        fileFilter === 'all' || fileFilter === 'none' || extensionOf(version.filename) === fileFilter);
                      return <article key={record.id} className={`space-y-3 ${layout === 'grid' ? 'rounded-xl border border-border/70 bg-card p-3' : 'px-3 py-3 sm:px-4'}`} data-testid={`row-measurement-record-${record.id}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <p className="text-[9px] font-bold uppercase tracking-[.12em] text-muted-foreground">Measurement Sheet ID</p>
                            <code className="block break-all font-mono text-xs font-semibold text-primary" title={record.id} data-testid={`text-measurement-sheet-id-${record.id}`}>{measurementSheetIdLabel(record.id)}</code>
                            {record.quotationRequestId && <p className="text-[10px] text-muted-foreground">Rate Approval request <code className="font-mono font-semibold text-foreground" data-testid={`text-measurement-quotation-id-${record.id}`}>{record.quotationRequestId}</code></p>}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {!isEditing && <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/measurements/${record.id}`)} data-testid={`button-view-measurement-record-${record.id}`}><Eye size={14} /> View</Button>}
                            {canEdit && <Button type="button" variant="outline" size="sm" onClick={() => {
                              if (isEditing) {
                                setEditingRecordId(null);
                                setEdits((current) => {
                                  const next = { ...current };
                                  delete next[record.id];
                                  return next;
                                });
                              } else {
                                setEditingRecordId(record.id);
                              }
                            }} data-testid={`button-edit-measurement-record-${record.id}`}><Pencil size={14} /> {isEditing ? 'Cancel edit' : 'Edit'}</Button>}
                            {canEdit && <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={deleteRecord.isPending} onClick={() => removeRecord(record)} data-testid={`button-delete-measurement-record-${record.id}`}><Trash2 size={14} /> Delete</Button>}
                          </div>
                        </div>
                          {isEditing ? <div id={`measurement-details-${record.id}`} className="space-y-4">
                        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(210px,1fr)_auto] xl:items-end">
                          {isEditing ? <>
                            <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Client name<Input value={edit.clientName} onChange={(event) => setEdit(record, 'clientName', event.target.value)} maxLength={160} data-testid={`input-measurement-client-${record.id}`} /></label>
                            <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Location<Input value={edit.location} onChange={(event) => setEdit(record, 'location', event.target.value)} maxLength={160} placeholder="No location" data-testid={`input-measurement-location-${record.id}`} /></label>
                            <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Assigned order<OrderSelect value={edit.orderRecordId} onChange={(value) => setEdit(record, 'orderRecordId', value)} testId={`select-measurement-record-order-${record.id}`} /></label>
                            <Button type="button" variant="outline" size="sm" onClick={() => saveRecord(record)} disabled={update.isPending} data-testid={`button-save-measurement-record-${record.id}`}><Save size={14} /> Save</Button>
                          </> : <>
                            <div><p className="text-[9px] font-bold uppercase tracking-[.12em] text-muted-foreground">Client name</p><p className="mt-1 text-sm font-semibold">{record.clientName}</p></div>
                            <div><p className="text-[9px] font-bold uppercase tracking-[.12em] text-muted-foreground">Location</p><p className="mt-1 text-sm">{record.location || 'No location'}</p></div>
                            <div><p className="text-[9px] font-bold uppercase tracking-[.12em] text-muted-foreground">Assigned order</p><p className="mt-1 text-sm">{record.orderId || 'No order assigned'}</p></div>
                          </>}
                        </div>
                        {canEdit && isEditing && <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3" data-testid={`link-quotation-from-measurement-${record.id}`}>
                          <label className="flex items-center gap-2 text-xs font-semibold">
                            <input
                              type="checkbox"
                              checked={edit.linkQuotation}
                              onChange={(event) => setEdit(record, 'linkQuotation', event.target.checked)}
                              className="h-4 w-4 accent-primary"
                              data-testid={`checkbox-link-quotation-${record.id}`}
                            />
                            Link directly to a Rate Approval request ID
                          </label>
                          {edit.linkQuotation && <QuotationRequestLookup
                            selectedId={edit.linkQuotationSubmissionId}
                            selectedLabel={edit.quotationLabel}
                            currentMeasurementRecordId={record.id}
                            onSelect={(item) => setEdits((current) => ({
                              ...current,
                              [record.id]: {
                                ...currentEdit(record),
                                linkQuotation: true,
                                linkQuotationSubmissionId: item.id,
                                quotationLabel: `${item.id} · ${item.clientName}`,
                              },
                            }))}
                          />}
                        </div>}
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1.5 font-semibold text-foreground"><FileText size={14} className="text-primary" /> {visibleVersions.length} {visibleVersions.length === 1 ? 'version' : 'versions'}{fileFilter !== 'all' && fileFilter !== 'none' ? ' shown' : ''}</span><span className="inline-flex items-center gap-1.5"><MapPin size={13} /> {record.location || 'Location not specified'}</span><span>Updated {dateLabel(record.updatedAt)}</span></div>
                          {canEdit && <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold transition-colors hover:bg-muted ${uploadingBatch ? 'pointer-events-none opacity-50' : ''}`} data-testid={`label-add-measurement-version-${record.id}`}><Upload size={14} /> Add sheets
                            <input type="file" multiple className="sr-only" disabled={uploadingBatch} accept=".pdf,.xlsx,.csv,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-testid={`input-add-measurement-version-${record.id}`} onChange={(event) => {
                              addVersionFiles(record.id, Array.from(event.currentTarget.files || []));
                              event.currentTarget.value = '';
                            }} />
                          </label>}
                        </div>
                        {canEdit && pendingSheets.length > 0 && <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3" data-testid={`list-pending-measurement-sheets-${record.id}`}>
                          <div className="space-y-2">
                            {pendingSheets.map((draft) => <div key={draft.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)_auto] sm:items-center" data-testid={`row-pending-measurement-sheet-${draft.id}`}>
                              <div className="min-w-0"><p className="truncate text-xs font-semibold">{draft.file.name}</p><p className="text-[10px] text-muted-foreground">{sizeLabel(draft.file.size)}{draft.replacesVersionNumber ? ` · replaces version ${draft.replacesVersionNumber}; older file stays in history` : ''}</p></div>
                              <Input value={draft.name} onChange={(event) => setVersionFiles((current) => ({ ...current, [record.id]: (current[record.id] || []).map((item) => item.id === draft.id ? { ...item, name: event.target.value } : item) }))} maxLength={160} disabled={uploadingBatch} placeholder="Sheet name (optional)" aria-label={`Optional name for ${draft.file.name}`} data-testid={`input-measurement-sheet-name-${draft.id}`} />
                              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${draft.file.name}`} disabled={uploadingBatch} onClick={() => setVersionFiles((current) => ({ ...current, [record.id]: (current[record.id] || []).filter((item) => item.id !== draft.id) }))} data-testid={`button-remove-measurement-sheet-${draft.id}`}><X size={15} /></Button>
                            </div>)}
                          </div>
                          <div className="flex justify-end"><Button type="button" size="sm" disabled={uploadingBatch || upload.isPending} onClick={async () => {
                            const failed = await uploadSheets(record.id, pendingSheets);
                            setVersionFiles((current) => ({ ...current, [record.id]: failed }));
                          }} data-testid={`button-upload-measurement-sheets-${record.id}`}><Upload size={14} /> {uploadingBatch ? 'Uploading…' : `Upload ${pendingSheets.length} ${pendingSheets.length === 1 ? 'sheet' : 'sheets'}`}</Button></div>
                        </div>}
                        {visibleVersions.length > 0 ? <ol className="space-y-2" aria-label={`Version history for ${record.clientName}`} data-testid={`list-measurement-versions-${record.id}`}>
                          {visibleVersions.slice().sort((a, b) => b.versionNumber - a.versionNumber).map((version) => <li key={version.id} className="rounded-lg border border-border/60 bg-card px-3 py-3" data-testid={`row-measurement-version-${version.id}`}>
                            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                              <div className="flex min-w-0 items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><FileSpreadsheet size={15} /></span><div className="min-w-0"><p className="truncate text-xs font-semibold">{version.name || version.filename}</p>{version.name && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">File: {version.filename}</p>}<p className="mt-0.5 text-[10px] text-muted-foreground">Version {version.versionNumber} · {sizeLabel(version.sizeBytes)} · {dateLabel(version.uploadedAt)} · {version.uploadedByName}</p></div></div>
                              <div className="flex flex-wrap items-end gap-2">
                                {canEdit && <div className="flex items-end gap-1.5">
                                  <label className="space-y-1 text-[9px] font-semibold text-muted-foreground"><span className="sr-only">Sheet name for version {version.versionNumber}</span><Input className="h-8 w-40 text-xs" value={versionNameDrafts[version.id] ?? version.name ?? ''} onChange={(event) => setVersionNameDrafts((current) => ({ ...current, [version.id]: event.target.value }))} maxLength={160} aria-label={`Sheet name for version ${version.versionNumber}`} data-testid={`input-edit-measurement-version-name-${version.id}`} /></label>
                                  <Button type="button" variant="outline" size="sm" aria-label={`Save name for version ${version.versionNumber}`} title="Save sheet name" disabled={updateVersion.isPending} onClick={() => saveVersionName(record, version)} data-testid={`button-save-measurement-version-name-${version.id}`}><Save size={13} /></Button>
                                </div>}
                                <a href={getPreviewMeasurementVersionUrl(record.id, version.id)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-muted" data-testid={`link-preview-measurement-version-${version.id}`}><Eye size={14} /> View</a>
                                <a href={getDownloadMeasurementVersionUrl(record.id, version.id)} download={version.filename} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-primary hover:bg-primary/5" data-testid={`link-download-measurement-version-${version.id}`}><Download size={14} /> Download</a>
                                {canEdit && <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-semibold hover:bg-muted ${uploadingBatch ? 'pointer-events-none opacity-50' : ''}`} data-testid={`label-replace-measurement-version-${version.id}`}><Upload size={13} /> Replace
                                  <input type="file" className="sr-only" disabled={uploadingBatch} accept=".pdf,.xlsx,.csv,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label={`Replace version ${version.versionNumber} with a new file`} data-testid={`input-replace-measurement-version-${version.id}`} onChange={(event) => {
                                    const file = event.currentTarget.files?.[0];
                                    if (file) addVersionFiles(record.id, [file], version);
                                    event.currentTarget.value = '';
                                  }} />
                                </label>}
                                {canEdit && <Button type="button" variant="ghost" size="icon" aria-label={`Delete version ${version.versionNumber}`} title="Delete file" disabled={deleteVersion.isPending || uploadingBatch} onClick={() => removeVersion(record, version)} data-testid={`button-delete-measurement-version-${version.id}`}><Trash2 size={14} /></Button>}
                              </div>
                            </div>
                          </li>)}
                        </ol> : <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground" data-testid={`state-measurement-versions-empty-${record.id}`}>No sheet uploaded yet. Add the first version when it is ready.</div>}
                        </div> : <div id={`measurement-details-${record.id}`} className={`grid gap-2 border-t border-border/50 pt-3 ${layout === 'grid' ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4'}`} data-testid={`summary-measurement-record-${record.id}`}>
                          <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[.1em] text-muted-foreground">Client</p><p className="truncate text-xs font-semibold">{record.clientName}</p></div>
                          <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[.1em] text-muted-foreground">Location</p><p className="truncate text-xs">{record.location || 'No location'}</p></div>
                          <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[.1em] text-muted-foreground">Assigned order</p><p className="truncate text-xs">{record.orderId || 'No order assigned'}</p></div>
                          <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[.1em] text-muted-foreground">Sheet versions</p><p className="truncate text-xs">{record.versions.length} · Updated {dateLabel(record.updatedAt)}</p></div>
                        </div>}
                      </article>;
                    })}
                    </div>}
                  </div>}
          </CardContent>
        </Card>
        <p className="flex items-center gap-2 text-[11px] leading-5 text-muted-foreground" data-testid="measurement-retention-note"><FilePlus2 size={14} className="shrink-0 text-primary" /> Uploads are appended as new versions; previous files remain available in this record.</p>
      </div>
    </AppShell>
  );
}