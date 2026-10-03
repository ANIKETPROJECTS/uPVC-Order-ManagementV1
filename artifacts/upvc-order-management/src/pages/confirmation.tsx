import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link } from 'wouter';
import {
  ArrowDownToLine,
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  LockKeyhole,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getDownloadOrderDocumentQueryKey,
  getGetPurchaseOrderRegisterQueryKey,
  getListOrderActivityQueryKey,
  getListOrderDocumentsQueryKey,
  getDownloadQuotationRateSubmissionPdfQueryKey,
  useArchiveOrderDocument,
  useDownloadOrderDocument,
  useDownloadQuotationRateSubmissionPdf,
  useGetPurchaseOrderRegister,
  useReplaceOrderDocument,
  useUploadQuotationConfirmationDocument,
} from '@workspace/api-client-react';
import type { OrderDocument, PurchaseOrderQuotationRequest, PurchaseOrderRegisterEntry, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { DocumentPreviewDialog } from '@/components/document-preview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

function hasPermission(user: User, module: string, level: 'view' | 'edit' = 'view') {
  return user.roleId === 'master-admin'
    || user.permissions?.[module] === 'edit'
    || (level === 'view' && user.permissions?.[module] === 'view');
}

const statusNames: Record<string, string> = {
  quotation_stage: 'Quotation stage',
  confirmed: 'Confirmed',
  in_production: 'In production',
  ready: 'Ready',
  dispatched: 'Dispatched',
  installed: 'Installed',
};
const quotationStatusNames: Record<string, string> = {
  awaiting_pdf: 'Awaiting PDF',
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
};
const statusStyles: Record<string, string> = {
  quotation_stage: 'bg-slate-100 text-slate-700',
  confirmed: 'bg-cyan-100 text-cyan-800',
  in_production: 'bg-amber-100 text-amber-800',
  ready: 'bg-lime-100 text-lime-800',
  dispatched: 'bg-orange-100 text-orange-800',
  installed: 'bg-emerald-100 text-emerald-800',
};
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

type DownloadTarget = { orderRecordId: string; document: OrderDocument } | null;
type PreviewTarget =
  | { kind: 'order-document'; orderRecordId: string; document: OrderDocument }
  | { kind: 'quotation-request'; orderRecordId: string; request: PurchaseOrderQuotationRequest };

const acceptedDocuments = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx';
const isSupportedDocument = (file: File) => /\.(pdf|png|jpe?g|webp|docx|xlsx)$/i.test(file.name);

function RegisterLoading() {
  return <div className="space-y-3" data-testid="state-confirmation-loading" aria-label="Loading purchase order register">
    <div className="h-14 animate-pulse rounded-xl bg-card/80" />
    {[0, 1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl border border-border/60 bg-card/60" />)}
  </div>;
}

function DocumentChip({ document, orderRecordId, busy, onDownload }: {
  document: OrderDocument;
  orderRecordId: string;
  busy: boolean;
  onDownload: (orderRecordId: string, document: OrderDocument) => void;
}) {
  return <button type="button" onClick={() => onDownload(orderRecordId, document)} disabled={busy}
    className="confirmation-file group/file flex min-w-0 items-center gap-2.5 rounded-lg border border-border/75 bg-background/75 px-2.5 py-2 text-left hover:border-primary/35 hover:bg-primary/[.025] disabled:cursor-wait disabled:opacity-70"
    data-testid={`button-download-document-${document.id}`} title={`Download ${document.filename}`}>
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground"><FileText size={15} /></span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[11px] font-semibold leading-4">{document.filename}</span>
      <span className="mt-0.5 block font-mono text-[9px] text-muted-foreground">{formatBytes(document.sizeBytes)} · {formatDate(document.uploadedAt)}</span>
    </span>
    <ArrowDownToLine size={14} className="shrink-0 text-muted-foreground transition-colors group-hover/file:text-primary" />
    {busy && <span className="sr-only">Preparing download</span>}
  </button>;
}

export default function ConfirmationPage({ user }: { user: User }) {
  const canViewOrder = hasPermission(user, 'order-hub', 'view');
  const canViewConfirmation = hasPermission(user, 'confirmation', 'view');
  const canViewRegister = canViewOrder && canViewConfirmation;
  const canEditConfirmation = hasPermission(user, 'confirmation', 'edit');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [poFilter, setPoFilter] = useState<'all' | 'with' | 'without'>('all');
  const [downloadTarget, setDownloadTarget] = useState<DownloadTarget>(null);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const query = useGetPurchaseOrderRegister({
    query: {
      enabled: canViewRegister,
      queryKey: getGetPurchaseOrderRegisterQueryKey(),
    },
  });
  const downloadQuery = useDownloadOrderDocument(
    downloadTarget?.orderRecordId || '',
    downloadTarget?.document.id || '',
    {
      query: {
        enabled: Boolean(downloadTarget),
        queryKey: getDownloadOrderDocumentQueryKey(downloadTarget?.orderRecordId || '', downloadTarget?.document.id || ''),
      },
    },
  );
  const orderPreviewQuery = useDownloadOrderDocument(
    previewTarget?.kind === 'order-document' ? previewTarget.orderRecordId : '',
    previewTarget?.kind === 'order-document' ? previewTarget.document.id : '',
    {
      query: {
        enabled: previewTarget?.kind === 'order-document',
        queryKey: getDownloadOrderDocumentQueryKey(
          previewTarget?.kind === 'order-document' ? previewTarget.orderRecordId : '',
          previewTarget?.kind === 'order-document' ? previewTarget.document.id : '',
        ),
      },
    },
  );
  const quotationPreviewQuery = useDownloadQuotationRateSubmissionPdf(
    previewTarget?.kind === 'quotation-request' ? previewTarget.request.id : '',
    {
      query: {
        enabled: previewTarget?.kind === 'quotation-request',
        queryKey: getDownloadQuotationRateSubmissionPdfQueryKey(
          previewTarget?.kind === 'quotation-request' ? previewTarget.request.id : '',
        ),
      },
    },
  );
  const uploadConfirmation = useUploadQuotationConfirmationDocument();
  const replaceDocument = useReplaceOrderDocument();
  const removeDocument = useArchiveOrderDocument();

  useEffect(() => {
    if (!downloadTarget || !downloadQuery.data) return;
    const url = URL.createObjectURL(downloadQuery.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadTarget.document.filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloadTarget(null);
  }, [downloadQuery.data, downloadTarget]);
  useEffect(() => {
    if (!previewTarget) return;
    const failed = previewTarget.kind === 'order-document'
      ? orderPreviewQuery.isError
      : quotationPreviewQuery.isError;
    if (!failed) return;
    toast({ title: 'Document preview failed', description: 'Try again or open the order Documents tab.', variant: 'destructive' });
    setPreviewTarget(null);
  }, [orderPreviewQuery.isError, previewTarget, quotationPreviewQuery.isError, toast]);

  const refreshOrderDocuments = (orderRecordId: string) => {
    void queryClient.invalidateQueries({ queryKey: getGetPurchaseOrderRegisterQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListOrderDocumentsQueryKey(orderRecordId) });
    void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(orderRecordId) });
  };
  const uploadConfirmationForRequest = (
    event: ChangeEvent<HTMLInputElement>,
    entry: PurchaseOrderRegisterEntry,
    request: PurchaseOrderQuotationRequest,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canEditConfirmation) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'Document is too large', description: 'Choose a file that is 10 MiB or smaller.', variant: 'destructive' });
      return;
    }
    if (!isSupportedDocument(file)) {
      toast({ title: 'Unsupported document type', description: 'Choose a PDF, PNG, JPEG, WebP, DOCX, or XLSX file.', variant: 'destructive' });
      return;
    }
    uploadConfirmation.mutate({
      id: entry.orderRecordId,
      quotationRequestId: request.id,
      filename: encodeURIComponent(file.name),
      data: file,
    }, {
      onSuccess: () => {
        toast({ title: 'Confirmation uploaded', description: `Linked to quotation request ${request.id}.` });
        refreshOrderDocuments(entry.orderRecordId);
      },
      onError: () => toast({ title: 'Confirmation could not be uploaded', variant: 'destructive' }),
    });
  };
  const replaceConfirmationDocument = (
    event: ChangeEvent<HTMLInputElement>,
    orderRecordId: string,
    fileRecord: OrderDocument,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canEditConfirmation) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'Document is too large', description: 'Choose a file that is 10 MiB or smaller.', variant: 'destructive' });
      return;
    }
    if (!isSupportedDocument(file)) {
      toast({ title: 'Unsupported document type', description: 'Choose a PDF, PNG, JPEG, WebP, DOCX, or XLSX file.', variant: 'destructive' });
      return;
    }
    replaceDocument.mutate({
      id: orderRecordId,
      documentId: fileRecord.id,
      filename: encodeURIComponent(file.name),
      data: file,
    }, {
      onSuccess: () => {
        toast({ title: 'Confirmation updated', description: `${file.name} replaced ${fileRecord.filename}.` });
        setPreviewTarget(null);
        refreshOrderDocuments(orderRecordId);
      },
      onError: () => toast({ title: 'Confirmation could not be updated', variant: 'destructive' }),
    });
  };
  const deleteConfirmationDocument = (orderRecordId: string, fileRecord: OrderDocument) => {
    if (!canEditConfirmation || !window.confirm(`Delete ${fileRecord.filename}? This removes the confirmation document from this order.`)) return;
    removeDocument.mutate({ id: orderRecordId, documentId: fileRecord.id }, {
      onSuccess: () => {
        toast({ title: 'Confirmation deleted' });
        if (previewTarget?.kind === 'order-document' && previewTarget.document.id === fileRecord.id) setPreviewTarget(null);
        refreshOrderDocuments(orderRecordId);
      },
      onError: () => toast({ title: 'Confirmation could not be deleted', variant: 'destructive' }),
    });
  };

  const rows = query.data || [];
  const totals = useMemo(() => ({
    orders: rows.length,
    withPo: rows.filter((entry) => entry.purchaseOrderDocuments.length > 0).length,
    poFiles: rows.reduce((total, entry) => total + entry.purchaseOrderDocuments.length, 0),
    confirmationFiles: rows.reduce((total, entry) => total + entry.confirmationDocuments.length, 0),
  }), [rows]);
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return rows.filter((entry) => {
      const hasPo = entry.purchaseOrderDocuments.length > 0;
      if (poFilter === 'with' && !hasPo) return false;
      if (poFilter === 'without' && hasPo) return false;
      if (!needle) return true;
      const files = [...entry.purchaseOrderDocuments, ...entry.confirmationDocuments].map((item) => item.filename).join(' ');
      const quotationText = entry.quotationRequests.flatMap((request) => [request.id, request.clientName, request.location, request.pdfFilename]).join(' ');
      return `${entry.orderId} ${entry.clientName} ${entry.locationCode} ${entry.locationName} ${files} ${quotationText}`.toLocaleLowerCase().includes(needle);
    });
  }, [poFilter, rows, search]);

  const requestDownload = (orderRecordId: string, file: OrderDocument) => setDownloadTarget({ orderRecordId, document: file });
  const requestPreview = (orderRecordId: string, file: OrderDocument) => setPreviewTarget({ kind: 'order-document', orderRecordId, document: file });
  const requestQuotationPreview = (orderRecordId: string, request: PurchaseOrderQuotationRequest) => setPreviewTarget({ kind: 'quotation-request', orderRecordId, request });
  const previewDocument = previewTarget?.kind === 'order-document' ? previewTarget.document : previewTarget?.kind === 'quotation-request' ? {
    id: previewTarget.request.id,
    orderRecordId: previewTarget.orderRecordId,
    quotationRequestId: previewTarget.request.id,
    filename: previewTarget.request.pdfFilename || `quotation-${previewTarget.request.id}.pdf`,
    category: 'quotation-request',
    contentType: 'application/pdf',
    sizeBytes: previewTarget.request.pdfSizeBytes || 0,
    uploadedBy: 'Quotation request',
    uploadedAt: previewTarget.request.updatedAt,
  } satisfies OrderDocument : null;
  const previewFile = previewTarget?.kind === 'order-document' ? orderPreviewQuery.data : quotationPreviewQuery.data;
  const previewLoading = previewTarget?.kind === 'order-document' ? orderPreviewQuery.isLoading : quotationPreviewQuery.isLoading;

  return <AppShell user={user} title="Confirmation / PO" eyebrow="Commercial paperwork · register">
    <div className="confirmation-register min-h-full space-y-5 rounded-2xl pb-6">
      <section className="confirmation-ledger relative overflow-hidden rounded-2xl border border-border/75 bg-card/80 p-5 shadow-sm sm:p-7" data-testid="panel-confirmation-intro">
        <div className="pointer-events-none absolute -right-10 -top-14 h-56 w-56 rounded-full border border-primary/10" />
        <div className="pointer-events-none absolute -right-1 top-0 h-40 w-40 rounded-full border border-primary/10" />
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <p className="confirmation-kicker flex items-center gap-2 text-[10px] font-bold uppercase text-primary"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Commercial control desk</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.045em] sm:text-[2.5rem]">Confirmation <span className="text-primary">/ PO</span></h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">See each order’s purchase order, linked quotation request files, and matching confirmations. Upload or manage confirmations against the correct request.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[350px]">
            <div className="rounded-xl border border-border/70 bg-background/75 px-4 py-3">
              <p className="text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">Orders on file</p>
              <p className="mt-1 font-display text-2xl font-bold tracking-tight" data-testid="text-register-order-count">{canViewRegister && !query.isLoading ? totals.orders : '—'}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/75 px-4 py-3">
              <p className="text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">With purchase order</p>
              <p className="mt-1 font-display text-2xl font-bold tracking-tight text-primary" data-testid="text-register-po-count">{canViewRegister && !query.isLoading ? totals.withPo : '—'}</p>
            </div>
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/65 pt-4 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><FileCheck2 size={13} className="text-primary" /> {canViewRegister && query.isSuccess ? totals.poFiles : '—'} purchase order {totals.poFiles === 1 ? 'file' : 'files'}</span>
          <span className="inline-flex items-center gap-1.5"><BadgeCheck size={13} className="text-accent" /> {canViewRegister && query.isSuccess ? totals.confirmationFiles : '—'} confirmation {totals.confirmationFiles === 1 ? 'file' : 'files'}</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck size={13} /> Existing records only</span>
        </div>
      </section>

      {!canViewRegister ? <section className="rounded-2xl border border-amber-500/25 bg-amber-500/[.06] p-8 text-center" data-testid="state-confirmation-access-restricted">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-amber-500/10 text-amber-700"><LockKeyhole size={21} /></span>
        <h2 className="mt-4 font-display text-lg font-bold">Register access restricted</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Viewing this register requires both Confirmation / PO and Client &amp; Order access. Ask an administrator to review your module permissions.</p>
      </section> : query.isLoading ? <RegisterLoading /> : query.isError ? <section className="rounded-2xl border border-destructive/20 bg-card p-8 text-center" data-testid="state-confirmation-error">
        <CircleAlert className="mx-auto text-destructive" size={27} />
        <h2 className="mt-3 font-display text-lg font-bold">Register unavailable</h2>
        <p className="mt-1 text-sm text-muted-foreground">The purchase order register could not be loaded.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void query.refetch()} data-testid="button-retry-confirmation"><RefreshCw size={13} /> Try again</Button>
      </section> : <>
        <section className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/75 p-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Register filters">
          <div className="relative w-full sm:max-w-md">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find order, client, quotation request or filename" className="h-10 border-border/70 bg-background pl-9 pr-9 text-xs" data-testid="input-confirmation-search" aria-label="Search register" />
            {search && <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Clear search" data-testid="button-clear-confirmation-search"><X size={14} /></button>}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:inline-flex"><Filter size={13} /> Purchase order</span>
            <div className="flex rounded-lg border border-border/75 bg-background p-1" role="group" aria-label="Filter purchase order status">
              {([['all', 'All'], ['with', 'With PO'], ['without', 'Missing PO']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => setPoFilter(value)} aria-pressed={poFilter === value}
                className={`rounded-md px-3 py-1.5 text-[10px] font-semibold transition-colors ${poFilter === value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                data-testid={`button-filter-${value}`}>{label}</button>)}
            </div>
            <span className="hidden font-mono text-[10px] text-muted-foreground lg:inline" data-testid="text-filtered-register-count">{filteredRows.length} / {rows.length}</span>
          </div>
        </section>

        {rows.length === 0 ? <section className="rounded-2xl border border-dashed border-border bg-card/65 px-6 py-14 text-center" data-testid="state-confirmation-empty">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><FileText size={23} /></span>
          <h2 className="mt-4 font-display text-lg font-bold">No order paperwork yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">Purchase orders and confirmations appear here after they are attached to an order in Order Documents.</p>
          {canViewOrder && <Link href="/order-hub" className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline" data-testid="link-open-order-hub">Open order hub <ArrowRight size={13} /></Link>}
        </section> : filteredRows.length === 0 ? <section className="rounded-2xl border border-dashed border-border bg-card/65 px-6 py-12 text-center" data-testid="state-confirmation-no-results">
          <Search className="mx-auto text-muted-foreground/65" size={23} />
          <h2 className="mt-3 font-display text-base font-bold">No matching orders</h2>
          <p className="mt-1 text-xs text-muted-foreground">Try another search or clear the purchase order filter.</p>
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => { setSearch(''); setPoFilter('all'); }} data-testid="button-reset-confirmation-filters">Reset filters</Button>
        </section> : <section className="overflow-hidden rounded-2xl border border-border/75 bg-card/75 shadow-sm" data-testid="table-confirmation-register">
          <div className="flex items-center justify-between border-b border-border/70 bg-muted/25 px-4 py-3 sm:px-5">
            <div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-primary">Order paperwork</p><p className="mt-0.5 text-[11px] text-muted-foreground">{filteredRows.length} {filteredRows.length === 1 ? 'record' : 'records'} · sorted by recent order update</p></div>
            <span className="rounded-md border border-border/70 bg-background px-2 py-1 font-mono text-[9px] text-muted-foreground">REGISTER</span>
          </div>
          <div className="divide-y divide-border/65">
            {filteredRows.map((entry, index) => <article key={entry.orderRecordId} className="confirmation-row p-4 sm:p-5" data-testid={`row-confirmation-${entry.orderRecordId}`}>
              <div className="grid gap-4 lg:grid-cols-[minmax(205px,.9fr)_minmax(180px,.65fr)_minmax(0,1.35fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/[.09] font-mono text-[9px] font-bold text-primary">{String(index + 1).padStart(2, '0')}</span>
                    <Link href={canViewOrder ? `/order-hub/${entry.orderRecordId}` : '#'} onClick={(event) => { if (!canViewOrder) event.preventDefault(); }}
                      className={`truncate font-mono text-[12px] font-bold tracking-tight ${canViewOrder ? 'text-primary hover:underline' : 'text-foreground'}`}
                      data-testid={`link-confirmation-order-${entry.orderRecordId}`}>{entry.orderId}</Link>
                  </div>
                  <p className="mt-2 truncate pl-8 text-[12px] font-semibold" data-testid={`text-confirmation-client-${entry.orderRecordId}`}>{entry.clientName}</p>
                  <p className="mt-1 flex items-center gap-1.5 pl-8 text-[10px] text-muted-foreground"><MapPin size={11} /><span className="font-mono font-semibold text-foreground/70">{entry.locationCode}</span><span className="truncate">{entry.locationName}</span></p>
                </div>
                <div className="flex items-center gap-2 lg:block">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-bold ${statusStyles[entry.orderStatus] || 'bg-muted text-muted-foreground'}`} data-testid={`status-confirmation-order-${entry.orderRecordId}`}>{statusNames[entry.orderStatus] || entry.orderStatus.replaceAll('_', ' ')}</span>
                  <span className="text-[10px] text-muted-foreground lg:mt-2 lg:block">Updated {formatDate(entry.orderUpdatedAt)}</span>
                </div>
                <DocumentColumn label="Purchase order" documents={entry.purchaseOrderDocuments} orderRecordId={entry.orderRecordId} onDownload={requestDownload} downloadingId={downloadTarget?.document.id} />
                <div className="flex justify-end border-t border-border/50 pt-3 lg:border-0 lg:pt-0">
                  {canViewOrder ? <Link href={`/order-hub/${entry.orderRecordId}?tab=documents`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/75 bg-background px-2.5 text-[10px] font-bold text-foreground transition-colors hover:border-primary/35 hover:bg-primary/[.04] hover:text-primary" data-testid={`link-manage-documents-${entry.orderRecordId}`}>Manage <ArrowRight size={12} /></Link>
                    : <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground" title="Order hub access is required"><LockKeyhole size={12} /> No order access</span>}
                </div>
              </div>
              <QuotationRequestsPanel
                entry={entry}
                canEditConfirmation={canEditConfirmation}
                uploading={uploadConfirmation.isPending}
                replacing={replaceDocument.isPending}
                removing={removeDocument.isPending}
                onPreviewQuotation={requestQuotationPreview}
                onPreviewConfirmation={requestPreview}
                onUpload={(event, request) => uploadConfirmationForRequest(event, entry, request)}
                onReplace={(event, file) => replaceConfirmationDocument(event, entry.orderRecordId, file)}
                onDelete={(file) => deleteConfirmationDocument(entry.orderRecordId, file)}
              />
            </article>)}
          </div>
          {downloadTarget && downloadQuery.isFetching && <div className="flex items-center gap-2 border-t border-primary/15 bg-primary/[.035] px-4 py-2 text-[10px] text-primary" role="status" data-testid="status-document-download"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> Preparing {downloadTarget.document.filename}</div>}
          {downloadTarget && downloadQuery.isError && <div className="flex items-center justify-between gap-3 border-t border-destructive/20 bg-destructive/[.04] px-4 py-2 text-[10px] text-destructive" role="alert" data-testid="status-document-download-error"><span>Download could not be prepared.</span><div className="flex gap-3"><button type="button" onClick={() => void downloadQuery.refetch()} className="font-bold underline" data-testid="button-retry-document-download">Try again</button><button type="button" onClick={() => setDownloadTarget(null)} className="font-bold underline">Dismiss</button></div></div>}
        </section>}
      </>}
      <p className="px-1 text-[10px] text-muted-foreground">Each uploaded confirmation is linked to its quotation request. Existing unlinked files can still be managed from the order’s <span className="font-semibold text-foreground/75">Order Documents</span> tab.</p>
    </div>
    {previewTarget && previewDocument && <DocumentPreviewDialog
      documentRecord={previewDocument}
      file={previewFile}
      loading={previewLoading}
      onClose={() => setPreviewTarget(null)}
    />}
  </AppShell>;
}

function QuotationRequestsPanel({
  entry,
  canEditConfirmation,
  uploading,
  replacing,
  removing,
  onPreviewQuotation,
  onPreviewConfirmation,
  onUpload,
  onReplace,
  onDelete,
}: {
  entry: PurchaseOrderRegisterEntry;
  canEditConfirmation: boolean;
  uploading: boolean;
  replacing: boolean;
  removing: boolean;
  onPreviewQuotation: (orderRecordId: string, request: PurchaseOrderQuotationRequest) => void;
  onPreviewConfirmation: (orderRecordId: string, document: OrderDocument) => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>, request: PurchaseOrderQuotationRequest) => void;
  onReplace: (event: ChangeEvent<HTMLInputElement>, document: OrderDocument) => void;
  onDelete: (document: OrderDocument) => void;
}) {
  const linkedRequestIds = new Set(entry.quotationRequests.map((request) => request.id));
  const otherConfirmations = entry.confirmationDocuments.filter((document) =>
    !document.quotationRequestId || !linkedRequestIds.has(document.quotationRequestId),
  );
  return <section className="mt-4 rounded-xl border border-border/70 bg-background/35 p-3 sm:p-4" data-testid={`section-linked-quotations-${entry.orderRecordId}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[.14em] text-primary">Linked quotation requests</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{entry.quotationRequests.length} request{entry.quotationRequests.length === 1 ? '' : 's'} · confirmations are attached to the matching request</p>
      </div>
    </div>
    {entry.quotationRequests.length === 0
      ? <p className="mt-3 rounded-lg border border-dashed border-border/75 px-3 py-3 text-[11px] text-muted-foreground" data-testid={`state-no-linked-quotations-${entry.orderRecordId}`}>No quotation request is linked to this order yet. Link one from Rate Approval to upload a request-specific confirmation.</p>
      : <div className="mt-3 space-y-2">
        {entry.quotationRequests.map((request) => {
          const requestConfirmations = entry.confirmationDocuments.filter((document) => document.quotationRequestId === request.id);
          return <article key={request.id} className="rounded-lg border border-border/70 bg-card/70 p-3" data-testid={`row-linked-quotation-${request.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <code className="font-mono text-[11px] font-bold text-primary" data-testid={`text-linked-quotation-id-${request.id}`}>{request.id}</code>
                <p className="mt-1 truncate text-[11px] font-semibold">{request.clientName}{request.location ? ` · ${request.location}` : ''}</p>
              </div>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[9px] font-bold text-secondary-foreground" data-testid={`status-linked-quotation-${request.id}`}>{quotationStatusNames[request.status] || request.status.replaceAll('_', ' ')}</span>
            </div>
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                <p className="text-[9px] font-bold uppercase tracking-[.12em] text-muted-foreground">Quotation request document</p>
                {request.pdfFilename
                  ? <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[11px] font-medium" title={request.pdfFilename}>{request.pdfFilename}</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => onPreviewQuotation(entry.orderRecordId, request)} data-testid={`button-view-quotation-pdf-${request.id}`}><Eye size={13} /> View PDF</Button>
                  </div>
                  : <p className="mt-2 text-[10px] text-muted-foreground">No quotation PDF attached.</p>}
              </div>
              <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[9px] font-bold uppercase tracking-[.12em] text-muted-foreground">Matching confirmation · {requestConfirmations.length}</p>
                  {canEditConfirmation && <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-2.5 text-[10px] font-semibold text-primary-foreground hover:bg-primary/90 ${uploading ? 'pointer-events-none opacity-60' : ''}`} data-testid={`button-upload-confirmation-${request.id}`}>
                    {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {uploading ? 'Uploading…' : 'Upload confirmation'}
                    <input type="file" accept={acceptedDocuments} className="sr-only" disabled={uploading} onChange={(event) => onUpload(event, request)} data-testid={`input-upload-confirmation-${request.id}`} />
                  </label>}
                </div>
                {requestConfirmations.length ? <div className="mt-2 space-y-2">
                  {requestConfirmations.map((document) => <ConfirmationFileRow
                    key={document.id}
                    document={document}
                    canEdit={canEditConfirmation}
                    replacing={replacing}
                    removing={removing}
                    onPreview={() => onPreviewConfirmation(entry.orderRecordId, document)}
                    onReplace={(event) => onReplace(event, document)}
                    onDelete={() => onDelete(document)}
                  />)}
                </div> : <p className="mt-2 text-[10px] text-muted-foreground">No confirmation file uploaded for this request yet.</p>}
              </div>
            </div>
          </article>;
        })}
      </div>}
    {otherConfirmations.length > 0 && <div className="mt-3 rounded-lg border border-dashed border-border/75 bg-background/30 p-3" data-testid={`section-unlinked-confirmations-${entry.orderRecordId}`}>
      <p className="text-[9px] font-bold uppercase tracking-[.12em] text-muted-foreground">Other attached confirmation files · {otherConfirmations.length}</p>
      <div className="mt-2 space-y-2">
        {otherConfirmations.map((document) => <ConfirmationFileRow
          key={document.id}
          document={document}
          canEdit={canEditConfirmation}
          replacing={replacing}
          removing={removing}
          onPreview={() => onPreviewConfirmation(entry.orderRecordId, document)}
          onReplace={(event) => onReplace(event, document)}
          onDelete={() => onDelete(document)}
        />)}
      </div>
    </div>}
  </section>;
}

function ConfirmationFileRow({
  document,
  canEdit,
  replacing,
  removing,
  onPreview,
  onReplace,
  onDelete,
}: {
  document: OrderDocument;
  canEdit: boolean;
  replacing: boolean;
  removing: boolean;
  onPreview: () => void;
  onReplace: (event: ChangeEvent<HTMLInputElement>) => void;
  onDelete: () => void;
}) {
  return <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-card/60 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-confirmation-file-${document.id}`}>
    <div className="flex min-w-0 items-center gap-2">
      <FileText size={14} className="shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold" title={document.filename}>{document.filename}</p>
        <p className="text-[9px] text-muted-foreground">{formatBytes(document.sizeBytes)} · {formatDate(document.uploadedAt)}</p>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
      <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={onPreview} data-testid={`button-view-confirmation-${document.id}`}><Eye size={12} /> View</Button>
      {canEdit && <>
        <label className={`inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 text-[10px] font-semibold hover:bg-muted ${replacing ? 'pointer-events-none opacity-60' : ''}`} data-testid={`button-edit-confirmation-${document.id}`}>
          {replacing ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />} Edit / replace
          <input type="file" accept={acceptedDocuments} className="sr-only" disabled={replacing} onChange={onReplace} data-testid={`input-edit-confirmation-${document.id}`} />
        </label>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-destructive hover:text-destructive" disabled={removing} onClick={onDelete} data-testid={`button-delete-confirmation-${document.id}`}>{removing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete</Button>
      </>}
    </div>
  </div>;
}

function DocumentColumn({ label, documents, orderRecordId, onDownload, downloadingId }: {
  label: string;
  documents: OrderDocument[];
  orderRecordId: string;
  onDownload: (orderRecordId: string, document: OrderDocument) => void;
  downloadingId?: string;
}) {
  return <div className="min-w-0">
    <p className="mb-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.13em] text-muted-foreground">{label}<span className="font-mono text-[9px] text-foreground/65">{String(documents.length).padStart(2, '0')}</span></p>
    {documents.length ? <div className="flex flex-col gap-1.5">
      {documents.map((file) => <DocumentChip key={file.id} document={file} orderRecordId={orderRecordId} busy={downloadingId === file.id} onDownload={onDownload} />)}
    </div> : <div className="flex min-h-10 items-center gap-2 rounded-lg border border-dashed border-border/75 bg-background/40 px-3 text-[10px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/45" /> No file attached</div>}
  </div>;
}