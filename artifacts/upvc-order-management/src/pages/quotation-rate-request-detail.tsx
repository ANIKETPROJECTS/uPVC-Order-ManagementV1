import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText, Pencil, Trash2, Upload } from 'lucide-react';
import {
  getDownloadQuotationRateSubmissionPdfUrl,
  getListMeasurementRecordsQueryKey,
  getListQuotationRateSubmissionsQueryKey,
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
  awaiting_pdf: 'Awaiting PDF',
  pending_review: 'Awaiting Approval',
  approved: 'Approved',
  rejected: 'Rejected',
})[status];

const statusStyle = (status: QuotationRateSubmission['status']) => status === 'approved'
  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
  : status === 'rejected'
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : status === 'pending_review'
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
  const [replacementPdf, setReplacementPdf] = useState<File | null>(null);
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
  const backToRequests = () => setLocation('/quotation-builder?section=rates&pane=requests');
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
    if (!validatePdf(replacementPdf)) return;
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
    setReplacementPdf(null);
    setLocation(`/quotation-builder/requests/${submissionId}`);
    if (!replacementPdf) {
      toast({ title: 'Request updated', description: 'It is back in Awaiting PDF until an updated Eva PDF is attached.' });
      return;
    }
    try {
      await upload.mutateAsync({ submissionId, filename: replacementPdf.name, data: replacementPdf });
      await refresh();
      toast({ title: 'Request updated and resubmitted', description: 'The updated Eva PDF is in the approval queue.' });
    } catch {
      toast({ title: 'Request updated; PDF upload failed', description: 'The old PDF is still retained. Attach the updated PDF before approval.', variant: 'destructive' });
    }
  };

  const deleteRequest = async () => {
    if (!submission || !canManage) return;
    if (!window.confirm(`Delete ${submission.id} for ${submission.clientName}? This removes the request, its approval history, and its attached PDF.`)) return;
    try {
      await remove.mutateAsync({ submissionId });
      await refresh();
      toast({ title: 'Quotation request deleted', description: `${submission.id} and its approval record were removed.` });
      backToRequests();
    } catch {
      toast({ title: 'Could not delete the request', description: 'The request was not removed. Refresh and try again.', variant: 'destructive' });
    }
  };

  return (
    <AppShell user={user} title="Quotation request details" eyebrow="Module 3 · rate approval">
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
                    {canManage && !isEditing && <Button type="button" variant="outline" size="sm" onClick={() => { setValues(editValues(submission)); setIsEditing(true); setLocation(`/quotation-builder/requests/${submissionId}?edit=1`); }} data-testid="button-edit-quotation-request-detail"><Pencil size={14} /> Edit</Button>}
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
                    <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
                      <p className="text-xs font-semibold">Updated Eva Software PDF <span className="font-normal text-muted-foreground">· optional now; required before it can return to approval</span></p>
                      <Input className="mt-2" type="file" accept="application/pdf,.pdf" onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        if (!validatePdf(file)) setReplacementPdf(null);
                        else setReplacementPdf(file);
                        event.currentTarget.value = '';
                      }} data-testid="input-edit-rate-pdf" />
                      {replacementPdf && <p className="mt-2 truncate text-[11px] text-primary">{replacementPdf.name} · {(replacementPdf.size / 1024 / 1024).toFixed(2)} MiB</p>}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => { setIsEditing(false); setReplacementPdf(null); setLocation(`/quotation-builder/requests/${submissionId}`); }} data-testid="button-cancel-edit-quotation-request">Cancel</Button>
                      <Button type="submit" disabled={update.isPending || upload.isPending} data-testid="button-save-quotation-request">{update.isPending || upload.isPending ? 'Saving…' : 'Save changes'} <FileText size={14} /></Button>
                    </div>
                  </form>
                ) : (
                  <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4" data-testid="quotation-request-details">
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Window quantity</p><p className="mt-1 text-sm font-semibold">{submission.windowQty.toLocaleString('en-IN')}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Total area</p><p className="mt-1 text-sm font-semibold">{submission.totalSqFt.toLocaleString('en-IN')} sq. ft.</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Average area / window</p><p className="mt-1 text-sm font-semibold">{Number(submission.averageSqFtPerQty).toFixed(2)} sq. ft.</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Glass type</p><p className="mt-1 text-sm font-semibold">{submission.glassType}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Order ID</p><p className="mt-1 text-sm">{submission.orderId || 'No order linked'}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Measurement sheet</p><p className="mt-1 break-all font-mono text-xs">{submission.measurementRecordId ? submission.measurementSheetId || 'Linked sheet ID unavailable' : 'No sheet linked'}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Submitted by</p><p className="mt-1 text-sm">{submission.submittedByName}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Assigned approvers</p><p className="mt-1 break-all font-mono text-xs">{submission.approverIds.join(', ') || 'None'}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Created</p><p className="mt-1 text-sm">{dateLabel(submission.createdAt)}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Last updated</p><p className="mt-1 text-sm">{dateLabel(submission.updatedAt)}</p></div>
                    {(submission.status === 'approved' || submission.status === 'rejected') && <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Decision by</p><p className="mt-1 text-sm">{submission.decidedByName || 'Approver'}</p></div>}
                    {submission.decisionComment && <div className="sm:col-span-2 xl:col-span-4"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Decision comment</p><p className="mt-1 whitespace-pre-wrap text-sm">{submission.decisionComment}</p></div>}
                  </div>
                )}
              </CardContent>
            </Card>

            {!isEditing && <Card className="overflow-hidden border-border/80" data-testid="card-quotation-request-pdf">
              <CardHeader className="border-b border-border/70">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Eva Software document</p>
                <CardTitle className="mt-1 font-display text-lg">Attached quotation PDF</CardTitle>
                <p className="text-xs text-muted-foreground">{submission.pdfNeedsRefresh ? 'This is the previous PDF. Attach an updated file before the request can return to approval.' : 'The PDF attached to this quotation request.'}</p>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                {submission.pdfFilename ? (
                  <a href={getDownloadQuotationRateSubmissionPdfUrl(submission.id)} download={submission.pdfFilename} className="inline-flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-primary hover:underline" data-testid="link-download-detail-rate-pdf">
                    <Download size={15} /> {submission.pdfFilename}
                  </a>
                ) : <p className="text-sm text-muted-foreground">No PDF has been attached.</p>}
                {canManage && submission.status === 'awaiting_pdf' && (
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold transition-colors hover:bg-muted" data-testid="label-upload-detail-rate-pdf">
                    <Upload size={14} /> {submission.pdfFilename ? 'Attach updated PDF' : 'Attach Eva PDF'}
                    <input type="file" accept="application/pdf,.pdf" className="sr-only" data-testid="input-upload-detail-rate-pdf" onChange={(event) => {
                      const file = event.currentTarget.files?.[0] || null;
                      event.currentTarget.value = '';
                      if (!file || !validatePdf(file)) return;
                      upload.mutate({ submissionId, filename: file.name, data: file }, {
                        onSuccess: async () => {
                          await refresh();
                          toast({ title: 'Updated PDF attached', description: 'The request is back in the approval queue.' });
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