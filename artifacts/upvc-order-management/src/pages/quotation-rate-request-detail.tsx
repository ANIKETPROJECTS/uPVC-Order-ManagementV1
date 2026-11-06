import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText, Pencil, Trash2, Upload } from 'lucide-react';
import {
  getDownloadQuotationRateSubmissionPdfUrl,
  getListMeasurementRecordsQueryKey,
  getListQuotationRateSubmissionsQueryKey,
  useAssignQuotationRateSubmissionRate,
  useDeleteQuotationRateSubmission,
  useListQuotationRateSubmissions,
  useUpdateQuotationRateSubmission,
  useUploadQuotationRateSubmissionPdf,
} from '@workspace/api-client-react';
import type { QuotationRateSubmission, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useLocation, useParams } from 'wouter';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value));

const statusName = (status: QuotationRateSubmission['status']) => ({
  awaiting_rate: 'Awaiting rate',
  query_raised: 'Query raised',
  rated: 'Rated',
  sent_to_client: 'Sent to client',
  awaiting_pdf: 'Awaiting PDF',
  pending_review: 'Awaiting Rate',
  rate_assigned: 'Rate Assigned',
  approved: 'Approved',
  rejected: 'Rejected',
})[status];

const statusStyle = (status: QuotationRateSubmission['status']) => ['approved', 'rate_assigned', 'rated', 'sent_to_client'].includes(status)
  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
  : status === 'rejected'
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : status === 'query_raised'
      ? 'border-violet-200 bg-violet-50 text-violet-800'
      : status === 'pending_review' || status === 'awaiting_rate'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-border bg-muted text-muted-foreground';

type EditValues = {
  clientName: string;
  location: string;
  windowQty: string;
  totalSqFt: string;
  glassType: string;
};

const editValues = (submission: QuotationRateSubmission): EditValues => ({
  clientName: submission.clientName,
  location: submission.location || '',
  windowQty: String(submission.windowQty),
  totalSqFt: String(submission.totalSqFt),
  glassType: submission.glassType,
});

type PastRate = { id: string; clientName: string; glassType: string; averageSqFtPerQty: number; ratePerSqFt: number; rateAssignedAt: string };
const rupees = (value: number) => `Rs ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)}`;

function RateEntryScreen({ submission, user, refresh }: { submission: QuotationRateSubmission; user: User; refresh: () => Promise<void> }) {
  const { toast } = useToast();
  const assign = useAssignQuotationRateSubmissionRate();
  const canAssign = user.roleId === 'master-admin' || user.permissions?.['rate-approval'] === 'edit';
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const [queryText, setQueryText] = useState('');
  const [editing, setEditing] = useState(false);
  const [pastRates, setPastRates] = useState<PastRate[]>([]);
  const [pastRatesError, setPastRatesError] = useState(false);
  useEffect(() => {
    setRate(submission.ratePerSqFt == null ? '' : String(submission.ratePerSqFt));
    setNote(submission.rateNote || '');
    setEditing(submission.status === 'awaiting_rate');
  }, [submission.id, submission.updatedAt]);
  useEffect(() => {
    if (!canAssign) return;
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/quotation-rate-submissions/${encodeURIComponent(submission.id)}/past-rates`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => setPastRates(Array.isArray(data.rates) ? data.rates : []))
      .catch(() => { if (!controller.signal.aborted) setPastRatesError(true); });
    return () => controller.abort();
  }, [canAssign, submission.id, submission.averageSqFtPerQty, submission.glassType]);

  const submitRate = async (event: FormEvent) => {
    event.preventDefault();
    const parsedRate = Number(rate);
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
      toast({ title: 'Enter a valid rate', description: 'Rate per sq. ft. must be greater than zero.', variant: 'destructive' });
      return;
    }
    try {
      await assign.mutateAsync({ submissionId: submission.id, data: { ratePerSqFt: parsedRate, rateNote: note.trim() || null, expectedUpdatedAt: submission.updatedAt } });
      await refresh();
      setEditing(false);
      toast({ title: 'Rate submitted', description: `${submission.id} is now Rated.` });
    } catch (error) {
      toast({ title: 'Rate was not saved', description: error instanceof Error ? error.message : 'Refresh the request and try again.', variant: 'destructive' });
    }
  };
  const raiseQuery = async (event: FormEvent) => {
    event.preventDefault();
    if (!queryText.trim()) return;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/quotation-rate-submissions/${encodeURIComponent(submission.id)}/query`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: queryText.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not raise the query.');
      await refresh();
      setQueryText('');
      toast({ title: 'Query raised', description: 'The waiting timer is paused until the quotation member responds.' });
    } catch (error) {
      toast({ title: 'Query was not saved', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' });
    }
  };
  if (!canAssign && !submission.ratePerSqFt) return null;
  const canEnter = canAssign && (submission.status === 'awaiting_rate' || (submission.status === 'rated' && editing));
  return <Card className="overflow-hidden border-border/80" data-testid="card-rate-entry-screen">
    <CardHeader className="border-b border-border/70"><CardTitle className="font-display text-lg">Rate entry</CardTitle><p className="text-xs text-muted-foreground">Rate per square foot for this request</p></CardHeader>
    <CardContent className="space-y-4 p-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border p-4" data-testid="rate-entry-request-details">
          <div className="flex items-start justify-between gap-2"><p className="font-mono text-xs font-bold text-primary">{submission.id} · {submission.clientName}</p><span className="rounded-full bg-muted px-2 py-1 text-[9px] font-bold">{submission.priority === 'urgent' ? 'Urgent' : 'Normal'}</span></div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]"><dt className="text-muted-foreground">Location</dt><dd className="text-right font-semibold">{submission.location || '—'}</dd><dt className="text-muted-foreground">Window qty</dt><dd className="text-right font-semibold">{submission.windowQty}</dd><dt className="text-muted-foreground">Total sq. ft.</dt><dd className="text-right font-semibold">{submission.totalSqFt.toLocaleString('en-IN')}</dd><dt className="text-muted-foreground">Avg. sq. ft. / window</dt><dd className="text-right font-semibold">{Number(submission.averageSqFtPerQty).toFixed(2)}</dd><dt className="text-muted-foreground">Glass</dt><dd className="text-right font-semibold">{submission.glassType}</dd><dt className="text-muted-foreground">Eva PDF</dt><dd className="text-right font-semibold">{submission.pdfFilename ? 'Attached' : 'Not attached'}</dd></dl>
        </div>
        {canAssign && <div className="rounded-xl border border-sky-300 bg-sky-50/50 p-4" data-testid="panel-past-rates">
          <p className="text-[10px] font-bold uppercase tracking-wide text-sky-900">Past rates · similar work</p>
          {pastRatesError ? <p className="mt-3 text-xs text-destructive">Similar rates could not be loaded.</p> : pastRates.length ? <div className="mt-2 space-y-1.5">{pastRates.map((past) => <div key={past.id} className="rounded-lg bg-white p-2.5"><p className="text-xs font-bold">{rupees(past.ratePerSqFt)} / sq. ft.</p><p className="mt-1 text-[10px] text-muted-foreground">{past.glassType} · avg {Number(past.averageSqFtPerQty).toFixed(1)} sq. ft. · {dateLabel(past.rateAssignedAt)}</p></div>)}</div> : <p className="mt-3 text-xs text-muted-foreground">No similar recent rates yet. The match uses the same glass type or average area within the configured tolerance.</p>}
        </div>}
      </div>
      {submission.ratePerSqFt != null && !editing && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs" data-testid="read-only-assigned-rate"><p className="font-bold text-emerald-900">{rupees(submission.ratePerSqFt)} / sq. ft.</p><p className="mt-1 text-emerald-800">{submission.rateNote || 'No note'}</p><p className="mt-1 text-[10px] text-emerald-800">Entered by {submission.rateAssignedByName || 'Rate manager'} · {submission.rateAssignedAt ? dateLabel(submission.rateAssignedAt) : 'date unavailable'}</p>{canAssign && submission.status === 'rated' && <Button className="mt-2" size="sm" variant="outline" type="button" onClick={() => setEditing(true)}>Correct rate</Button>}</div>}
      {canEnter && <div className="space-y-3 rounded-xl border bg-muted/20 p-3" data-testid="form-rate-entry">
        <form className="grid gap-3 md:grid-cols-[1fr_1.3fr_auto]" onSubmit={(event) => void submitRate(event)}>
          <label className="space-y-1 text-[10px] font-semibold text-muted-foreground">Rate per sq. ft. (Rs)<Input type="number" min="0.01" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} required data-testid="input-detail-rate-per-sqft" /></label>
          <label className="space-y-1 text-[10px] font-semibold text-muted-foreground">Note (optional)<Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} data-testid="input-detail-rate-note" /></label>
          <Button type="submit" disabled={assign.isPending} className="self-end" data-testid="button-submit-rate">{assign.isPending ? 'Submitting…' : 'Submit rate'}</Button>
        </form>
      </div>}
      {canAssign && ['awaiting_rate', 'rated'].includes(submission.status) && <details>
        <summary className="cursor-pointer text-xs font-semibold text-amber-800">Raise query</summary>
        <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(event) => void raiseQuery(event)}>
          <Textarea value={queryText} onChange={(event) => setQueryText(event.target.value)} maxLength={2000} placeholder="Question for the quotation member" aria-label="Query comment" className="min-w-[240px] flex-1" />
          <Button type="submit" variant="outline" disabled={!queryText.trim()}>Send query</Button>
        </form>
      </details>}
      <div className="rounded-lg border bg-muted/40 p-3 text-[10px] leading-5 text-muted-foreground"><p className="font-bold text-foreground">Assumptions</p><p>Final quote PDF is created in Eva and uploaded after the rate is given.</p><p>Any higher-up with rate access can enter the rate; notification recipients are configured separately.</p><p>The request keeps its QT ID when it moves to a sent quotation.</p></div>
    </CardContent>
  </Card>;
}

export default function QuotationRateRequestDetailPage({ user }: { user: User }) {
  const { submissionId = '' } = useParams<{ submissionId: string }>();
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const submissionsQuery = useListQuotationRateSubmissions({
    query: { queryKey: getListQuotationRateSubmissionsQueryKey() },
  });
  const submission = submissionsQuery.data?.find((item) => item.id === submissionId);
  const canSubmit = user.roleId === 'master-admin' || user.permissions?.['quotation-builder'] === 'edit';
  const canManage = Boolean(submission && (user.roleId === 'master-admin' || (canSubmit && submission.submittedBy === user.id)));
  const requestedEdit = new URLSearchParams(location.split('?')[1] || '').get('edit') === '1';
  const [isEditing, setIsEditing] = useState(requestedEdit);
  const [values, setValues] = useState<EditValues>({ clientName: '', location: '', windowQty: '', totalSqFt: '', glassType: '' });
  const update = useUpdateQuotationRateSubmission();
  const upload = useUploadQuotationRateSubmissionPdf();
  const remove = useDeleteQuotationRateSubmission();
  const revisions = submission?.revisionHistory.slice().sort((a, b) => b.revisionNumber - a.revisionNumber) || [];

  useEffect(() => {
    if (submission) setValues(editValues(submission));
  }, [submission?.id]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListQuotationRateSubmissionsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListMeasurementRecordsQueryKey() }),
    ]);
  };
  const backToRequests = () => setLocation('/quotations-rates?section=rates&pane=requests');
  const validatePdf = (file: File | null) => {
    if (!file) return true;
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

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submission || !canManage) return;
    const windowQty = Number(values.windowQty);
    const totalSqFt = Number(values.totalSqFt);
    if (!values.clientName.trim() || !values.glassType.trim() || !Number.isInteger(windowQty) || windowQty < 1 || totalSqFt <= 0 || !Number.isFinite(totalSqFt)) {
      toast({ title: 'Check the request details', description: 'Enter a client, glass type, positive window quantity, and total area.', variant: 'destructive' });
      return;
    }
    try {
      await update.mutateAsync({
        submissionId,
        data: {
          clientName: values.clientName.trim(),
          location: values.location.trim() || null,
          windowQty,
          totalSqFt,
          glassType: values.glassType.trim(),
        },
      });
    } catch {
      toast({ title: 'Could not update the request', description: 'The request was not changed. Refresh and try again.', variant: 'destructive' });
      return;
    }
    await refresh();
    setIsEditing(false);
    setLocation(`/quotations-rates/requests/${submissionId}`);
    toast({ title: 'Request updated', description: 'It is back in Awaiting rate. Assign the rate before uploading the final PDF.' });
  };

  const deleteRequest = async () => {
    if (!submission || !canManage) return;
    if (!window.confirm(`Delete ${submission.id} for ${submission.clientName}? This removes the request history and its attached PDF.`)) return;
    try {
      await remove.mutateAsync({ submissionId });
      await refresh();
      toast({ title: 'Rate request deleted', description: `${submission.id} and its request history were removed.` });
      backToRequests();
    } catch {
      toast({ title: 'Could not delete the request', description: 'The request was not removed. Refresh and try again.', variant: 'destructive' });
    }
  };

  return (
    <AppShell user={user} title="Rate Request Details" eyebrow="Quotations & Rates">
      <div className="space-y-5" data-testid="page-quotation-rate-request-detail">
        <Button type="button" variant="outline" onClick={backToRequests} data-testid="button-back-to-quotation-requests">
          <ArrowLeft size={15} /> Back to quotation requests
        </Button>

        {submissionsQuery.isLoading ? (
          <Card><CardContent className="space-y-3 p-6"><div className="h-6 w-64 animate-pulse rounded bg-muted" /><div className="h-20 animate-pulse rounded bg-muted/70" /></CardContent></Card>
        ) : submissionsQuery.isError ? (
          <Card><CardContent className="p-6 text-sm text-destructive" data-testid="state-quotation-request-detail-error">Quotation request details could not be loaded. Return to the request list and try again.</CardContent></Card>
        ) : !submission ? (
          <Card><CardContent className="p-8 text-center" data-testid="state-quotation-request-detail-not-found">
            <p className="font-display text-lg font-bold">Quotation request not found</p>
            <p className="mt-2 text-sm text-muted-foreground">It may have been deleted or you may not have access to it.</p>
          </CardContent></Card>
        ) : (
          <>
            <Card className="overflow-hidden border-border/80">
              <CardHeader className="border-b border-border/70 bg-muted/20">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Saved quotation request</p>
                    <code className="mt-1 block font-mono text-sm font-bold text-primary" data-testid="text-quotation-request-detail-id">{submission.id}</code>
                    <CardTitle className="mt-3 font-display text-2xl">{submission.clientName}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">{submission.location || 'Location not provided'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusStyle(submission.status)}`} data-testid="status-quotation-request-detail">{statusName(submission.status)}</span>
                    {canManage && !isEditing && <Button type="button" variant="outline" size="sm" onClick={() => { setValues(editValues(submission)); setIsEditing(true); setLocation(`/quotations-rates/requests/${submissionId}?edit=1`); }} data-testid="button-edit-quotation-request-detail"><Pencil size={14} /> Edit</Button>}
                    {canManage && !isEditing && <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={remove.isPending} onClick={() => void deleteRequest()} data-testid="button-delete-quotation-request-detail"><Trash2 size={14} /> Delete</Button>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-5">
                {isEditing && canManage ? (
                  <form className="space-y-5" onSubmit={(event) => void saveEdit(event)} data-testid="form-edit-quotation-request">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <label className="space-y-1.5 text-xs font-semibold">Client name<Input value={values.clientName} onChange={(event) => setValues((current) => ({ ...current, clientName: event.target.value }))} maxLength={160} required data-testid="input-edit-rate-client-name" /></label>
                      <label className="space-y-1.5 text-xs font-semibold">Location <span className="font-normal text-muted-foreground">optional</span><Input value={values.location} onChange={(event) => setValues((current) => ({ ...current, location: event.target.value }))} maxLength={160} data-testid="input-edit-rate-location" /></label>
                      <label className="space-y-1.5 text-xs font-semibold">Window quantity<Input type="number" min="1" max="100000" step="1" value={values.windowQty} onChange={(event) => setValues((current) => ({ ...current, windowQty: event.target.value }))} required data-testid="input-edit-rate-window-quantity" /></label>
                      <label className="space-y-1.5 text-xs font-semibold">Total sq. ft.<Input type="number" min="0.01" step="0.01" value={values.totalSqFt} onChange={(event) => setValues((current) => ({ ...current, totalSqFt: event.target.value }))} required data-testid="input-edit-rate-total-sqft" /></label>
                      <label className="space-y-1.5 text-xs font-semibold">Glass type<Input value={values.glassType} onChange={(event) => setValues((current) => ({ ...current, glassType: event.target.value }))} maxLength={120} required data-testid="input-edit-rate-glass-type" /></label>
                      <label className="space-y-1.5 text-xs font-semibold">Average area per window<Input readOnly value={Number(values.windowQty) > 0 && Number(values.totalSqFt) > 0 ? (Number(values.totalSqFt) / Number(values.windowQty)).toFixed(2) : ''} data-testid="input-edit-rate-average-sqft" /></label>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => { setIsEditing(false); setLocation(`/quotations-rates/requests/${submissionId}`); }} data-testid="button-cancel-edit-quotation-request">Cancel</Button>
                      <Button type="submit" disabled={update.isPending} data-testid="button-save-quotation-request">{update.isPending ? 'Saving…' : 'Save changes'} <FileText size={14} /></Button>
                    </div>
                  </form>
                ) : (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4" data-testid="quotation-request-details">
                      <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Priority</p><p className="mt-1 text-sm font-semibold">{submission.priority === 'urgent' ? 'Urgent' : 'Normal'}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Window quantity</p><p className="mt-1 text-sm font-semibold">{submission.windowQty.toLocaleString('en-IN')}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Total area</p><p className="mt-1 text-sm font-semibold">{submission.totalSqFt.toLocaleString('en-IN')} sq. ft.</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Average area / window</p><p className="mt-1 text-sm font-semibold">{Number(submission.averageSqFtPerQty).toFixed(2)} sq. ft.</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Glass type</p><p className="mt-1 text-sm font-semibold">{submission.glassType}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Order ID</p><p className="mt-1 text-sm">{submission.orderId || 'No order linked'}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Measurement sheet</p><p className="mt-1 break-all font-mono text-xs">{submission.measurementRecordId ? submission.measurementSheetId || 'Linked sheet ID unavailable' : 'No sheet linked'}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Submitted by</p><p className="mt-1 text-sm">{submission.submittedByName}</p></div>
                      {submission.ratePerSqFt != null && <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Assigned rate</p><p className="mt-1 text-sm font-semibold">{submission.ratePerSqFt.toLocaleString('en-IN')} / sq. ft.</p></div>}
                      {submission.rateAssignedByName && <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Rate set by</p><p className="mt-1 text-sm">{submission.rateAssignedByName}</p></div>}
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Created</p><p className="mt-1 text-sm">{dateLabel(submission.createdAt)}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Last updated</p><p className="mt-1 text-sm">{dateLabel(submission.updatedAt)}</p></div>
                    {(submission.status === 'approved' || submission.status === 'rejected') && <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Decision by</p><p className="mt-1 text-sm">{submission.decidedByName || 'Approver'}</p></div>}
                    {submission.decisionComment && <div className="sm:col-span-2 xl:col-span-4"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Decision comment</p><p className="mt-1 whitespace-pre-wrap text-sm">{submission.decisionComment}</p></div>}
                  </div>
                )}
              </CardContent>
            </Card>

            {!isEditing && submission.workflowVersion === 3 && <RateEntryScreen submission={submission} user={user} refresh={refresh} />}

            {!isEditing && <Card className="overflow-hidden border-border/80" data-testid="card-quotation-request-pdf">
              <CardHeader className="border-b border-border/70">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Eva Software document</p>
                <CardTitle className="mt-1 font-display text-lg">Attached quotation PDF</CardTitle>
                <p className="text-xs text-muted-foreground">{submission.pdfNeedsRefresh ? 'This is the previous PDF. It remains in history while the request is re-rated.' : 'The final quote PDF sent to the client.'}</p>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                {submission.pdfFilename ? (
                  <a href={getDownloadQuotationRateSubmissionPdfUrl(submission.id)} download={submission.pdfFilename} className="inline-flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-primary hover:underline" data-testid="link-download-detail-rate-pdf">
                    <Download size={15} /> {submission.pdfFilename}
                  </a>
                ) : <p className="text-sm text-muted-foreground">No PDF has been attached.</p>}
                {canManage && submission.status === 'rated' && (
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold transition-colors hover:bg-muted" data-testid="label-upload-detail-rate-pdf">
                    <Upload size={14} /> Attach final quote PDF
                    <input type="file" accept="application/pdf,.pdf" className="sr-only" data-testid="input-upload-detail-rate-pdf" onChange={(event) => {
                      const file = event.currentTarget.files?.[0] || null;
                      event.currentTarget.value = '';
                      if (!file || !validatePdf(file)) return;
                      upload.mutate({ submissionId, filename: file.name, data: file }, {
                        onSuccess: async () => {
                          await refresh();
                          toast({ title: 'Quote sent to client', description: 'The final PDF is attached and the quote is now in Quotations.' });
                        },
                        onError: () => toast({ title: 'PDF upload failed', description: 'The previous PDF is still retained. Try the upload again.', variant: 'destructive' }),
                      });
                    }} />
                  </label>
                )}
              </CardContent>
            </Card>}

            {!isEditing && revisions.length > 0 && <Card className="overflow-hidden border-border/80" data-testid="card-quotation-request-revisions">
              <CardHeader className="border-b border-border/70">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Audit trail</p>
                <CardTitle className="mt-1 font-display text-lg">Earlier request details and decisions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4 sm:p-5">
                {revisions.map((revision) => <article key={revision.revisionNumber} className="rounded-xl border border-border/70 bg-card p-4" data-testid={`row-quotation-request-revision-${revision.revisionNumber}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="text-sm font-semibold">Revision {revision.revisionNumber} · {revision.clientName}</p><p className="mt-1 text-xs text-muted-foreground">Saved by {revision.revisedByName} · {dateLabel(revision.revisedAt)}</p></div>
                    <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase ${statusStyle(revision.previousStatus)}`}>{statusName(revision.previousStatus)}</span>
                  </div>
                  <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
                    <p>Location: <span className="font-semibold">{revision.location || 'Not provided'}</span></p>
                    <p>Windows: <span className="font-semibold">{revision.windowQty}</span></p>
                    <p>Total area: <span className="font-semibold">{revision.totalSqFt.toLocaleString('en-IN')} sq. ft.</span></p>
                    <p>Average / window: <span className="font-semibold">{Number(revision.averageSqFtPerQty).toFixed(2)} sq. ft.</span></p>
                    <p>Glass type: <span className="font-semibold">{revision.glassType}</span></p>
                    {revision.pdfFilename && <p className="break-all">Eva PDF: <span className="font-semibold">{revision.pdfFilename}</span></p>}
                    {revision.decidedByName && <p>Decision by: <span className="font-semibold">{revision.decidedByName}</span></p>}
                    {revision.decisionComment && <p className="sm:col-span-2 xl:col-span-4">Decision comment: <span className="font-semibold">{revision.decisionComment}</span></p>}
                  </div>
                </article>)}
              </CardContent>
            </Card>}
          </>
        )}
      </div>
    </AppShell>
  );
}