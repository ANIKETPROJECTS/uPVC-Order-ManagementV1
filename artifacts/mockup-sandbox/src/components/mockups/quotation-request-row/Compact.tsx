import './_group.css';
import { useState } from 'react';
import { Check, Download, Eye, FilePlus2, Link2, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const submission = {
  id: 'RA-1002',
  clientName: 'TEST',
  createdAt: '2026-10-06T11:25:00+05:30',
  submittedByName: 'Aditi Kulkarni',
  status: 'pending_review' as 'awaiting_pdf' | 'pending_review' | 'approved' | 'rejected',
  windowQty: 17,
  totalSqFt: 34.234,
  glassType: 'TEST',
  location: 'TEST',
  averageSqFtPerQty: 2.01,
  orderId: '',
  pdfFilename: 'eva-rate-RA-1002.pdf',
  pdfNeedsRefresh: false,
  measurementRecordId: null,
  decidedByName: null,
  decisionComment: null,
};

const statusLabels = { awaiting_pdf: 'Awaiting PDF', pending_review: 'Awaiting approval', approved: 'Approved', rejected: 'Rejected' };
const statusStyles = {
  awaiting_pdf: 'border-border bg-muted text-muted-foreground',
  pending_review: 'border-amber-200 bg-amber-50 text-amber-800',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rejected: 'border-rose-200 bg-rose-50 text-rose-800',
};
const dateTime = (value: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const measurementSheetIdLabel = (id: string) => `MS-${id}`;
const getDownloadQuotationRateSubmissionPdfUrl = (id: string) => `/preview/${id}.pdf`;
const compactActionClass = 'h-7 min-h-7 px-2 text-[10px]';

export function Compact() {
  const [comments, setComments] = useState<Record<string, string>>({});
  const isReviewable = submission.status === 'pending_review' && Boolean(submission.pdfFilename) && !submission.pdfNeedsRefresh;
  const canManageSubmission = (_submission: typeof submission) => true;
  const canLinkSubmission = (_submission: typeof submission) => true;
  const navigate = (_path: string) => {};
  const removeSubmission = (_submission: typeof submission) => {};
  const openOrderLink = (_submission: typeof submission) => {};
  const upload = { isPending: false };
  const uploadPdf = (_id: string, _file: File) => {};
  const decide = { isPending: false };
  const makeDecision = (_submission: typeof submission, _decision: 'approved' | 'rejected') => {};

  return (
    <main className="quotation-request-preview min-h-screen bg-background p-5">
      <article className="min-w-0 rounded-xl border border-border/80 bg-card px-3 py-2.5 shadow-sm" data-testid={`card-assigned-request-${submission.id}`}>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <p className="font-mono text-[11px] font-bold text-primary">{submission.id}</p>
            <h3 className="truncate text-sm font-semibold">{submission.clientName}</h3>
            <p className="text-[10px] text-muted-foreground">Submitted {dateTime(submission.createdAt)} · {submission.submittedByName}</p>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${statusStyles[submission.status]}`} data-testid={`status-assigned-request-${submission.id}`}>
            {statusLabels[submission.status]}
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span><strong className="font-semibold text-foreground">{submission.windowQty}</strong> windows</span>
          <span><strong className="font-semibold text-foreground">{submission.totalSqFt.toLocaleString('en-IN')}</strong> sq. ft.</span>
          <span>Glass: <strong className="font-semibold text-foreground">{submission.glassType}</strong></span>
          <span>Location: <strong className="font-semibold text-foreground">{submission.location || '—'}</strong></span>
          <span>Order: <strong className="font-semibold text-foreground">{submission.orderId || 'Not linked'}</strong></span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {submission.pdfFilename
            ? <a href={getDownloadQuotationRateSubmissionPdfUrl(submission.id)} download={submission.pdfFilename} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[10px] font-semibold text-primary hover:bg-muted" data-testid={`link-assigned-request-pdf-${submission.id}`}>
                <Download size={12} /> <span className="truncate">{submission.pdfNeedsRefresh ? `Previous PDF · ${submission.pdfFilename}` : 'Download Eva PDF'}</span>
              </a>
            : <span className="text-[10px] text-muted-foreground">PDF not attached yet</span>}
          {submission.measurementRecordId && <span className="text-[10px] text-muted-foreground">Measurement sheet {measurementSheetIdLabel(submission.measurementRecordId)}</span>}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid={`assigned-request-actions-${submission.id}`}>
          <Button size="sm" variant="outline" className={compactActionClass} onClick={() => navigate(`/quotation-builder/requests/${submission.id}`)} data-testid={`button-view-assigned-request-${submission.id}`}>
            <Eye size={12} /> View
          </Button>
          {canManageSubmission(submission) && <Button size="sm" variant="outline" className={compactActionClass} onClick={() => navigate(`/quotation-builder/requests/${submission.id}?edit=1`)} data-testid={`button-edit-assigned-request-${submission.id}`}>
            <Pencil size={12} /> Edit
          </Button>}
          {canManageSubmission(submission) && <Button size="sm" variant="outline" className={`${compactActionClass} text-destructive hover:text-destructive`} disabled={false} onClick={() => removeSubmission(submission)} data-testid={`button-delete-assigned-request-${submission.id}`}>
            <Trash2 size={12} /> Delete
          </Button>}
          {canLinkSubmission(submission) && <Button size="sm" variant="outline" className={compactActionClass} onClick={() => openOrderLink(submission)} data-testid={`button-link-assigned-request-order-${submission.id}`}>
            <Link2 size={12} /> {submission.orderId ? 'Update links' : 'Link to order'}
          </Button>}
          {submission.status === 'awaiting_pdf' && canManageSubmission(submission) && <label className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[10px] font-semibold hover:bg-muted ${upload.isPending ? 'pointer-events-none opacity-50' : ''}`} data-testid={`label-attach-assigned-request-pdf-${submission.id}`}>
            <FilePlus2 size={12} /> Attach Eva PDF
            <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={upload.isPending} data-testid={`input-attach-assigned-request-pdf-${submission.id}`} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) uploadPdf(submission.id, file); event.currentTarget.value = ''; }} />
          </label>}
        </div>

        {submission.pdfNeedsRefresh && <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800">An updated PDF is required before this request can be reviewed.</p>}

        {isReviewable
          ? <div className="mt-2 grid gap-2 border-t border-border/70 pt-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="block min-w-0 space-y-1 text-[10px] font-semibold text-muted-foreground">
                Decision note <span className="font-normal">(optional)</span>
                <Textarea rows={1} maxLength={1000} value={comments[submission.id] || ''} onChange={(event) => setComments((current) => ({ ...current, [submission.id]: event.target.value }))} className="h-9 min-h-0 resize-none py-1.5 text-xs" placeholder="Context for the submitter" aria-label={`Decision note for ${submission.id}`} data-testid={`input-assigned-request-comment-${submission.id}`} />
              </label>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" className={compactActionClass} onClick={() => makeDecision(submission, 'approved')} disabled={decide.isPending} data-testid={`button-approve-assigned-request-${submission.id}`}><Check size={12} /> Approve</Button>
                <Button size="sm" variant="outline" className={`${compactActionClass} text-destructive hover:text-destructive`} onClick={() => makeDecision(submission, 'rejected')} disabled={decide.isPending} data-testid={`button-reject-assigned-request-${submission.id}`}><X size={12} /> Reject</Button>
              </div>
            </div>
          : submission.status === 'pending_review'
            ? <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800">Attach a current Eva PDF before recording a decision.</p>
            : (submission.status === 'approved' || submission.status === 'rejected') && <p className="mt-2 border-t border-border/70 pt-2 text-[10px] text-muted-foreground">Decided by {submission.decidedByName || 'approver'}{submission.decisionComment ? ` · ${submission.decisionComment}` : ''}</p>}
      </article>
    </main>
  );
}
