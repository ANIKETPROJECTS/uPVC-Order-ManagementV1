import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getListOrdersQueryKey, useListOrders } from '@workspace/api-client-react';
import type { Order, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { BadgeCheck, FileText, Loader2, Search, Upload } from 'lucide-react';

type DecisionStatus = 'approved_by_client' | 'rejected_by_client' | 'revision_requested_by_client';
type FileVersion = { filename: string; sizeBytes: number; uploadedAt: string; versionNumber: number; reason: string };
type ConfirmationRecord = {
  _id: string;
  confirmationId: string;
  clientName: string;
  location: string;
  quotationId: string | null;
  quotationRecordId: string | null;
  measurementSheetId: string | null;
  measurementRecordId: string | null;
  orderRecordId: string | null;
  orderId: string | null;
  linkedVersionNumber: number | null;
  versionHistory: { versionNumber: number; reason: string; createdAt: string; pdfFilename?: string; excelFilename?: string }[];
  pdfVersions: FileVersion[];
  excelVersions: FileVersion[];
  clientDecisionStatus: DecisionStatus | null;
  clientDecisionNote: string | null;
  clientDecisionUpdatedAt: string | null;
  clientDecisionUpdatedBy: string | null;
};

const apiUrl = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api${path}`;
const decisionLabel: Record<DecisionStatus, string> = {
  approved_by_client: 'Approved',
  rejected_by_client: 'Rejected',
  revision_requested_by_client: 'Revision requested',
};
const canEdit = (user: User) => user.roleId === 'master-admin' || user.permissions?.confirmation === 'edit';
const canViewOrders = (user: User) => user.roleId === 'master-admin' || Boolean(user.permissions?.['order-hub']);

function DecisionCell({ record, editable, onSaved }: {
  record: ConfirmationRecord;
  editable: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<DecisionStatus | ''>(record.clientDecisionStatus ?? '');
  const [note, setNote] = useState(record.clientDecisionNote ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setStatus(record.clientDecisionStatus ?? '');
    setNote(record.clientDecisionNote ?? '');
  }, [record.clientDecisionNote, record.clientDecisionStatus]);
  const needsNote = status === 'rejected_by_client' || status === 'revision_requested_by_client';
  const save = async () => {
    if (!status || (needsNote && !note.trim())) return;
    setSaving(true);
    try {
      const response = await fetch(apiUrl(`/confirmation-records/${record._id}/client-decision`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note: needsNote ? note.trim() : null }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not save the client decision.');
      toast({ title: 'Client decision saved', description: decisionLabel[status] });
      onSaved();
    } catch (error) {
      toast({ title: 'Could not save decision', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };
  if (!editable) {
    return <span className="text-xs font-medium">{record.clientDecisionStatus ? decisionLabel[record.clientDecisionStatus] : 'Pending'}</span>;
  }
  return <div className="min-w-[180px] space-y-1.5">
    <select value={status} onChange={(event) => setStatus(event.target.value as DecisionStatus | '')}
      className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs" aria-label={`Client decision for ${record.confirmationId}`}>
      <option value="">Pending decision</option>
      {Object.entries(decisionLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    {needsNote && <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder="Reason required" aria-label="Decision reason" className="h-8 text-xs" />}
    {status && <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" disabled={saving || (needsNote && !note.trim())} onClick={() => void save()}>
      {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
    </Button>}
  </div>;
}

export default function ConfirmationFirstRegister({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [records, setRecords] = useState<ConfirmationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachTarget, setAttachTarget] = useState<Record<string, string>>({});
  const [fields, setFields] = useState({ clientName: '', location: '', quotationId: '', measurementSheetId: '' });
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [versionEditor, setVersionEditor] = useState<{ record: ConfirmationRecord; reason: string; pdfFile: File | null; excelFile: File | null } | null>(null);
  const ordersQuery = useListOrders({}, { query: { enabled: canViewOrders(user), queryKey: getListOrdersQueryKey({}) } });
  const orders: Order[] = ordersQuery.data ?? [];

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch(apiUrl('/confirmation-records'));
      if (!response.ok) throw new Error('Confirmation records could not be loaded.');
      setRecords(await response.json() as ConfirmationRecord[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Confirmation records could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return records;
    return records.filter((record) => [
      record.confirmationId, record.clientName, record.quotationId || '',
      record.measurementSheetId || '', record.orderId || '', record.location,
    ].join(' ').toLocaleLowerCase().includes(needle));
  }, [records, search]);

  const uploadFileVersion = async (recordId: string, kind: 'pdf' | 'excel', file: File, versionNumber = 1, reason = 'Initial version') => {
    const response = await fetch(apiUrl(`/confirmation-records/${recordId}/files/${kind}/${encodeURIComponent(file.name)}`), {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Confirmation-Version': String(versionNumber), 'X-Confirmation-Version-Reason': reason }, body: file,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `${kind.toUpperCase()} upload failed.`);
    }
  };

  const createRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pdfFile) {
      toast({ title: 'Choose the official PDF copy', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(apiUrl('/confirmation-records'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not create confirmation.');
      await uploadFileVersion(result._id, 'pdf', pdfFile);
      if (excelFile) await uploadFileVersion(result._id, 'excel', excelFile);
      toast({ title: 'Confirmation uploaded', description: `${result.confirmationId} is ready.` });
      setShowUploadForm(false);
      setFields({ clientName: '', location: '', quotationId: '', measurementSheetId: '' });
      setPdfFile(null); setExcelFile(null);
      await refresh();
    } catch (error) {
      toast({ title: 'Confirmation upload incomplete', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const attachToOrder = async (record: ConfirmationRecord) => {
    const orderRecordId = attachTarget[record._id];
    if (!orderRecordId) return;
    setBusy(true);
    try {
      const response = await fetch(apiUrl(`/orders/${orderRecordId}/confirmation-records/${record._id}/attach`), { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not link the order.');
      toast({ title: 'Order linked', description: `${record.confirmationId} is attached to ${orders.find((order) => order.id === orderRecordId)?.orderId || 'the order'}.` });
      await refresh();
      void queryClient.invalidateQueries();
    } catch (error) {
      toast({ title: 'Could not link order', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const saveVersion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!versionEditor) return;
    if (!versionEditor.reason.trim() || (!versionEditor.pdfFile && !versionEditor.excelFile)) {
      toast({ title: 'Add a reason and at least one updated file', variant: 'destructive' });
      return;
    }
    const latest = Math.max(1, ...versionEditor.record.pdfVersions.map((file) => file.versionNumber), ...versionEditor.record.excelVersions.map((file) => file.versionNumber));
    const nextVersion = latest + 1;
    setBusy(true);
    try {
      if (versionEditor.pdfFile) {
        await uploadFileVersion(versionEditor.record._id, 'pdf', versionEditor.pdfFile, nextVersion, versionEditor.reason.trim());
        setVersionEditor((current) => current ? { ...current, pdfFile: null } : current);
      }
      if (versionEditor.excelFile) await uploadFileVersion(versionEditor.record._id, 'excel', versionEditor.excelFile, nextVersion, versionEditor.reason.trim());
      await refresh();
      toast({ title: `Version v${nextVersion} added`, description: versionEditor.record.confirmationId });
      setVersionEditor(null);
    } catch (error) {
      toast({ title: 'File upload failed', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const editable = canEdit(user);
  return <AppShell user={user} title="Confirmation register" eyebrow="Confirmation-first register">
    <main className="space-y-4 pb-8" data-testid="page-confirmation-register">
      <header className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm sm:p-6">
        <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-primary">Commercial control desk</p><h1 className="mt-1 font-display text-2xl font-bold">Confirmations</h1><p className="mt-1 text-sm text-muted-foreground">One row per confirmation, with its quote, measurement sheet, order, files and client decision.</p></div>
        {editable && <Button onClick={() => setShowUploadForm((value) => !value)} data-testid="button-new-confirmation-record"><Upload size={14} /> Upload confirmation</Button>}
      </header>

      {showUploadForm && <form onSubmit={(event) => void createRecord(event)} className="grid gap-3 rounded-xl border border-primary/20 bg-card p-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="form-create-confirmation-record">
        <label className="grid gap-1 text-xs font-medium">Client name<Input required value={fields.clientName} onChange={(event) => setFields({ ...fields, clientName: event.target.value })} /></label>
        <label className="grid gap-1 text-xs font-medium">Location<Input required value={fields.location} onChange={(event) => setFields({ ...fields, location: event.target.value })} /></label>
        <label className="grid gap-1 text-xs font-medium">Quote ID (optional)<Input value={fields.quotationId} onChange={(event) => setFields({ ...fields, quotationId: event.target.value })} placeholder="QT-26-0001" /></label>
        <label className="grid gap-1 text-xs font-medium">Measurement ID (optional)<Input value={fields.measurementSheetId} onChange={(event) => setFields({ ...fields, measurementSheetId: event.target.value })} placeholder="MS-26-0001" /></label>
        <label className="grid gap-1 text-xs font-medium">PDF · official copy<input type="file" accept=".pdf,application/pdf" onChange={(event) => setPdfFile(event.target.files?.[0] ?? null)} /></label>
        <label className="grid gap-1 text-xs font-medium">Excel · working data<input type="file" accept=".xlsx,.xls" onChange={(event) => setExcelFile(event.target.files?.[0] ?? null)} /></label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save confirmation'}</Button><Button type="button" variant="outline" onClick={() => setShowUploadForm(false)}>Cancel</Button></div>
      </form>}

      <section className="overflow-hidden rounded-xl border border-border/75 bg-card/80 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-3 sm:p-4">
          <div><h2 className="text-sm font-bold">Confirmation register</h2><p className="text-xs text-muted-foreground">{filtered.length} {filtered.length === 1 ? 'record' : 'records'}</p></div>
          <div className="relative w-full sm:max-w-sm"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 pl-9 text-xs" placeholder="Search CF, client, QT, MS or order" aria-label="Search confirmations" /></div>
        </div>
        {loading ? <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />Loading confirmations…</div>
          : loadError ? <div className="p-8 text-center"><p className="text-sm text-destructive">{loadError}</p><Button className="mt-3" variant="outline" size="sm" onClick={() => void refresh()}>Try again</Button></div>
            : filtered.length === 0 ? <div className="p-10 text-center"><FileText size={22} className="mx-auto text-muted-foreground" /><p className="mt-2 text-sm font-semibold">{records.length ? 'No matching confirmations' : 'No confirmations yet'}</p><p className="mt-1 text-xs text-muted-foreground">{records.length ? 'Search by CF ID, client, quote, sheet or order.' : 'Upload a confirmation to create the first row.'}</p></div>
              : <div className="overflow-x-auto">
                <table className="w-full min-w-[930px] text-left text-xs">
                  <thead className="bg-muted/35 text-[9px] font-bold uppercase tracking-wide text-muted-foreground"><tr>
                    <th className="px-3 py-3">CF ID / Client</th><th className="px-3 py-3">Quote</th><th className="px-3 py-3">Measurement</th><th className="px-3 py-3">Order</th><th className="px-3 py-3">Files</th><th className="px-3 py-3">Decision</th><th className="px-3 py-3">Version</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/60">
                    {filtered.map((record) => {
                      const pdfVersion = Math.max(0, ...record.pdfVersions.map((file) => file.versionNumber));
                      const excelVersion = Math.max(0, ...record.excelVersions.map((file) => file.versionNumber));
                      const version = Math.max(pdfVersion, excelVersion, 1);
                      const mismatch = pdfVersion > 0 && excelVersion > 0 && pdfVersion !== excelVersion;
                      return <tr key={record._id} data-testid={`row-confirmation-${record.confirmationId}`} className="align-top hover:bg-muted/15">
                        <td className="px-3 py-3"><code className="font-mono font-bold text-primary">{record.confirmationId}</code><p className="mt-1 max-w-[180px] truncate font-medium text-foreground" title={record.clientName}>{record.clientName}</p></td>
                        <td className="px-3 py-3">{record.quotationId && <Link href={`/quotations-rates?quote=${encodeURIComponent(record.quotationId)}`} className="font-mono font-semibold text-primary hover:underline">{record.quotationId}</Link>}</td>
                        <td className="px-3 py-3">{record.measurementSheetId && <Link href={record.measurementRecordId ? `/measurements/${record.measurementRecordId}` : '/measurements'} className="font-mono font-semibold text-primary hover:underline">{record.measurementSheetId}</Link>}</td>
                        <td className="px-3 py-3">{record.orderRecordId && record.orderId
                          ? canViewOrders(user) ? <Link href={`/order-hub/${record.orderRecordId}`} className="font-mono font-semibold text-primary hover:underline">{record.orderId}</Link> : <span className="font-mono">{record.orderId}</span>
                          : editable && canViewOrders(user) ? <div className="flex min-w-[185px] gap-1"><select value={attachTarget[record._id] || ''} onChange={(event) => setAttachTarget({ ...attachTarget, [record._id]: event.target.value })} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-[10px]" aria-label={`Link order to ${record.confirmationId}`}><option value="">Not linked</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.orderId} · {order.clientName}</option>)}</select>{attachTarget[record._id] && <Button size="sm" variant="outline" className="h-8 px-2 text-[10px]" disabled={busy} onClick={() => void attachToOrder(record)}>Link</Button>}</div> : <span className="text-muted-foreground">Not linked</span>}</td>
                        <td className="px-3 py-3"><div className="flex flex-wrap gap-1.5">
                          {record.pdfVersions.length > 0 ? <a className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-800" href={apiUrl(`/confirmation-records/${record._id}/file-versions/pdf/${pdfVersion}`)}>✓ PDF v{pdfVersion}</a> : <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-900">PDF missing</span>}
                          {record.excelVersions.length > 0 ? <a className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-800" href={apiUrl(`/confirmation-records/${record._id}/file-versions/excel/${excelVersion}`)}>✓ Excel v{excelVersion}</a> : <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-900">Excel missing</span>}
                          {mismatch && <span className="w-full text-[10px] font-semibold text-amber-800">Warning: file versions do not match</span>}
                          {record.versionHistory.length > 0 && <details className="w-full text-[10px]"><summary className="cursor-pointer font-semibold text-primary">Version history</summary><div className="mt-1 space-y-1.5">{record.versionHistory.map((revision) => <div key={revision.versionNumber} className="rounded border border-border/60 p-1.5"><p className="font-semibold">v{revision.versionNumber} · {revision.reason}</p><div className="flex gap-2">{record.pdfVersions.some((file) => file.versionNumber === revision.versionNumber) && <a className="text-primary underline" href={apiUrl(`/confirmation-records/${record._id}/file-versions/pdf/${revision.versionNumber}`)}>PDF</a>}{record.excelVersions.some((file) => file.versionNumber === revision.versionNumber) && <a className="text-primary underline" href={apiUrl(`/confirmation-records/${record._id}/file-versions/excel/${revision.versionNumber}`)}>Excel</a>}</div></div>)}</div></details>}
                          {editable && <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" disabled={busy} onClick={() => setVersionEditor({ record, reason: '', pdfFile: null, excelFile: null })}>Upload v{version + 1}</Button>}
                        </div></td>
                        <td className="px-3 py-3"><DecisionCell record={record} editable={editable} onSaved={() => void refresh()} /></td>
                        <td className="px-3 py-3"><span className="rounded-full bg-muted px-2 py-1 font-mono text-[10px] font-semibold">v{version}</span></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>}
      </section>
      {versionEditor && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setVersionEditor(null); }}>
        <form onSubmit={(event) => void saveVersion(event)} className="w-full max-w-lg space-y-4 rounded-xl border bg-card p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="confirmation-version-title">
          <div><h2 id="confirmation-version-title" className="font-display text-lg font-bold">Upload v{Math.max(1, ...versionEditor.record.pdfVersions.map((file) => file.versionNumber), ...versionEditor.record.excelVersions.map((file) => file.versionNumber)) + 1}</h2><p className="text-sm text-muted-foreground">Client change for {versionEditor.record.confirmationId}. The order will not be updated automatically.</p></div>
          <label className="grid gap-1 text-xs font-medium">Change reason<Input required minLength={1} value={versionEditor.reason} onChange={(event) => setVersionEditor({ ...versionEditor, reason: event.target.value })} placeholder="Describe the client change" /></label>
          <label className="grid gap-1 text-xs font-medium">Updated PDF (optional)<input type="file" accept=".pdf" onChange={(event) => setVersionEditor({ ...versionEditor, pdfFile: event.target.files?.[0] ?? null })} /></label>
          <label className="grid gap-1 text-xs font-medium">Updated Excel (optional)<input type="file" accept=".xlsx,.xls" onChange={(event) => setVersionEditor({ ...versionEditor, excelFile: event.target.files?.[0] ?? null })} /></label>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setVersionEditor(null)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Save version'}</Button></div>
        </form>
      </div>}
      <p className="px-1 text-[10px] text-muted-foreground">Legacy confirmation files remain available from their order documents. They are not auto-paired into new records.</p>
    </main>
  </AppShell>;
}
