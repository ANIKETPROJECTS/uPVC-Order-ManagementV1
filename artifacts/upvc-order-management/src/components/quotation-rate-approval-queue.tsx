import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Check,
  Download,
  Eye,
  FileCheck2,
  FilePlus2,
  Grid2X2,
  Link2,
  List,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  getDownloadQuotationRateSubmissionPdfUrl,
  getListMeasurementRecordsQueryKey,
  getListOrdersQueryKey,
  getListQuotationRateSubmissionsQueryKey,
  useDeleteQuotationRateSubmission,
  useDecideQuotationRateSubmission,
  useLinkQuotationRateSubmissionOrder,
  useListQuotationRateSubmissions,
  useListOrders,
  useUploadQuotationRateSubmissionPdf,
} from '@workspace/api-client-react';
import type { QuotationRateSubmission, User } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MeasurementSheetLookup, measurementSheetIdLabel } from '@/components/link-record-lookups';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';

type RequestStatusFilter = 'all' | QuotationRateSubmission['status'];
type RequestSort = 'priority' | 'newest' | 'oldest' | 'updated' | 'client' | 'request-id';
type RequestLayout = 'list' | 'grid';

const statusLabels: Record<QuotationRateSubmission['status'], string> = {
  awaiting_pdf: 'Awaiting PDF',
  pending_review: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

const statusStyles: Record<QuotationRateSubmission['status'], string> = {
  awaiting_pdf: 'border-border bg-muted text-muted-foreground',
  pending_review: 'border-amber-200 bg-amber-50 text-amber-800',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rejected: 'border-rose-200 bg-rose-50 text-rose-800',
};

const dateTime = (value: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function QuotationRateApprovalQueue({ user }: { user: User }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canReview = user.roleId === 'master-admin' || user.permissions?.['rate-approval'] === 'edit';
  const canSubmit = user.roleId === 'master-admin' || user.permissions?.['quotation-builder'] === 'edit';
  const submissionsQuery = useListQuotationRateSubmissions({
    query: {
      queryKey: getListQuotationRateSubmissionsQueryKey(),
      enabled: canReview,
      refetchOnWindowFocus: true,
    },
  });
  const ordersQuery = useListOrders({}, {
    query: {
      queryKey: getListOrdersQueryKey({}),
      enabled: canReview,
    },
  });
  const decide = useDecideQuotationRateSubmission();
  const deleteSubmission = useDeleteQuotationRateSubmission();
  const upload = useUploadQuotationRateSubmissionPdf();
  const linkOrder = useLinkQuotationRateSubmissionOrder();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RequestStatusFilter>('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [sort, setSort] = useState<RequestSort>('priority');
  const [layout, setLayout] = useState<RequestLayout>('list');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [comments, setComments] = useState<Record<string, string>>({});
  const [linkingSubmission, setLinkingSubmission] = useState<QuotationRateSubmission | null>(null);
  const [linkOrderRecordId, setLinkOrderRecordId] = useState('');
  const [linkMeasurementSheet, setLinkMeasurementSheet] = useState(false);
  const [linkMeasurementId, setLinkMeasurementId] = useState<string | null>(null);
  const [linkMeasurementLabel, setLinkMeasurementLabel] = useState('');

  const assignedRequests = useMemo(() => {
    const submissions = submissionsQuery.data ?? [];
    return submissions.filter((submission) =>
      user.roleId === 'master-admin' ||
      submission.approverIds.includes(user.id) ||
      (canReview && (submission.status === 'pending_review' || submission.status === 'awaiting_pdf')),
    );
  }, [canReview, submissionsQuery.data, user.id, user.roleId]);

  const locations = useMemo(
    () => [...new Set(assignedRequests.map((item) => item.location?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)),
    [assignedRequests],
  );

  const filteredRequests = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const through = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
    const matches = assignedRequests.filter((item) => {
      const createdAt = new Date(item.createdAt).getTime();
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (locationFilter !== 'all' && item.location !== locationFilter) return false;
      if (from !== null && createdAt < from) return false;
      if (through !== null && createdAt > through) return false;
      if (!normalizedSearch) return true;
      const searchable = [
        item.id,
        item.clientName,
        item.location ?? '',
        item.glassType,
        item.orderId ?? '',
        item.measurementRecordId ?? '',
        item.measurementSheetId ?? '',
        item.submittedByName,
        item.decidedByName ?? '',
        statusLabels[item.status],
      ].join(' ').toLowerCase();
      return searchable.includes(normalizedSearch);
    });

    return matches.sort((a, b) => {
      if (sort === 'priority') {
        const priority = (status: QuotationRateSubmission['status']) =>
          status === 'pending_review' ? 0 : status === 'awaiting_pdf' ? 1 : 2;
        const statusDifference = priority(a.status) - priority(b.status);
        if (statusDifference) return statusDifference;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      if (sort === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sort === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sort === 'updated') return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (sort === 'client') return a.clientName.localeCompare(b.clientName);
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [assignedRequests, dateFrom, dateTo, locationFilter, search, sort, statusFilter]);

  const pendingCount = assignedRequests.filter((item) => item.status === 'pending_review').length;
  const awaitingPdfCount = assignedRequests.filter((item) => item.status === 'awaiting_pdf').length;

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setLocationFilter('all');
    setDateFrom('');
    setDateTo('');
    setSort('priority');
  };

  const makeDecision = (submission: QuotationRateSubmission, decision: 'approved' | 'rejected') => {
    decide.mutate({
      submissionId: submission.id,
      data: { decision, comment: comments[submission.id] || '' },
    }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListQuotationRateSubmissionsQueryKey() });
        setComments((current) => {
          const next = { ...current };
          delete next[submission.id];
          return next;
        });
        toast({
          title: decision === 'approved' ? 'Rate request approved' : 'Rate request rejected',
          description: `${submission.id} · ${submission.clientName}`,
        });
      },
      onError: () => toast({
        title: 'Decision was not saved',
        description: 'The request is unchanged. Refresh the queue and try again.',
        variant: 'destructive',
      }),
    });
  };

  const canManageSubmission = (submission: QuotationRateSubmission) =>
    user.roleId === 'master-admin' || (canSubmit && submission.submittedBy === user.id);
  const canLinkSubmission = (submission: QuotationRateSubmission) =>
    user.roleId === 'master-admin'
    || user.permissions?.['rate-approval'] === 'edit'
    || (canSubmit && submission.submittedBy === user.id);

  const uploadPdf = (submissionId: string, file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf' && file.type !== 'application/octet-stream')) {
      toast({ title: 'PDF file required', description: 'Attach the Eva Software quotation as a PDF.', variant: 'destructive' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'File exceeds 10 MiB', description: 'Choose a smaller PDF before uploading.', variant: 'destructive' });
      return;
    }
    upload.mutate({ submissionId, filename: file.name, data: file }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListQuotationRateSubmissionsQueryKey() });
        toast({ title: 'PDF attached', description: 'The rate request is now in the approval queue.' });
      },
      onError: () => toast({ title: 'PDF upload failed', description: 'The request remains available for another upload attempt.', variant: 'destructive' }),
    });
  };

  const removeSubmission = (submission: QuotationRateSubmission) => {
    if (!canManageSubmission(submission)) return;
    if (!window.confirm(`Delete ${submission.id} for ${submission.clientName}? This removes the request, its approval history, and its attached PDF.`)) return;
    deleteSubmission.mutate({ submissionId: submission.id }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListQuotationRateSubmissionsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListMeasurementRecordsQueryKey() });
        setComments((current) => {
          const next = { ...current };
          delete next[submission.id];
          return next;
        });
        toast({ title: 'Quotation request deleted', description: `${submission.id} and its approval record were removed.` });
      },
      onError: () => toast({ title: 'Could not delete the request', description: 'The request was not removed. Refresh and try again.', variant: 'destructive' }),
    });
  };

  const openOrderLink = (submission: QuotationRateSubmission) => {
    setLinkingSubmission(submission);
    setLinkOrderRecordId(submission.orderRecordId || '');
    setLinkMeasurementSheet(Boolean(submission.measurementRecordId));
    setLinkMeasurementId(submission.measurementRecordId || null);
    setLinkMeasurementLabel(submission.measurementRecordId ? measurementSheetIdLabel(submission.measurementRecordId, submission.measurementSheetId) : '');
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
        toast({
          title: 'Quotation request links saved',
          description: linkMeasurementSheet
            ? `${linkMeasurementLabel.split(' · ')[0] || measurementSheetIdLabel(linkMeasurementId || '')} is linked directly to ${linkingSubmission.id}.`
            : linkingSubmission.measurementRecordId
              ? 'The order link is saved and the measurement sheet link is removed.'
              : 'The order link is saved.',
        });
      },
      onError: () => toast({ title: 'Could not link the quotation', description: 'The order links were not changed. Refresh and try again.', variant: 'destructive' }),
    });
  };

  const hasFilters = Boolean(search || statusFilter !== 'all' || locationFilter !== 'all' || dateFrom || dateTo);

  return (
    <section className="space-y-4" data-testid="section-assigned-quotation-requests">
      <Card className="border-border/80">
        <CardHeader className="border-b border-border/70 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Rate approval queue</p>
              <CardTitle className="mt-1 font-display text-lg">Quotation requests for your approval</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Open requests are available to users with Quotation requests approving access.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void submissionsQuery.refetch()} disabled={submissionsQuery.isFetching} data-testid="button-refresh-assigned-requests">
              <RefreshCw size={14} className={submissionsQuery.isFetching ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">Awaiting approval</p>
              <p className="mt-0.5 text-lg font-bold text-amber-900">{pendingCount}</p>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Awaiting PDF</p>
              <p className="mt-0.5 text-lg font-bold">{awaitingPdfCount}</p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="relative md:col-span-2 xl:col-span-1">
              <span className="sr-only">Search quotation requests</span>
              <Search size={15} className="absolute left-3 top-2.5 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search ID, client, glass, order…" data-testid="input-search-assigned-requests" />
            </label>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as RequestStatusFilter)}>
              <SelectTrigger aria-label="Filter requests by status" data-testid="select-filter-request-status"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending_review">Awaiting approval</SelectItem>
                <SelectItem value="awaiting_pdf">Awaiting PDF</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger aria-label="Filter requests by location" data-testid="select-filter-request-location"><SelectValue placeholder="All locations" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {locations.map((location) => <SelectItem key={location} value={location}>{location}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => setSort(value as RequestSort)}>
              <SelectTrigger aria-label="Sort quotation requests" data-testid="select-sort-assigned-requests"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="priority">Approval priority</SelectItem>
                <SelectItem value="newest">Newest submitted</SelectItem>
                <SelectItem value="oldest">Oldest submitted</SelectItem>
                <SelectItem value="updated">Recently updated</SelectItem>
                <SelectItem value="client">Client name A–Z</SelectItem>
                <SelectItem value="request-id">Request ID</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 p-3">
            <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
              <label className="block space-y-1 text-[10px] font-semibold text-muted-foreground">
                <span className="flex items-center gap-1"><CalendarDays size={12} /> Submitted from</span>
                <Input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} className="h-9 bg-card text-xs" data-testid="input-request-date-from" />
              </label>
              <label className="block space-y-1 text-[10px] font-semibold text-muted-foreground">
                <span className="flex items-center gap-1"><CalendarDays size={12} /> Submitted through</span>
                <Input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} className="h-9 bg-card text-xs" data-testid="input-request-date-to" />
              </label>
            </div>
            <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
              <p className="text-[10px] text-muted-foreground" data-testid="text-request-filter-count">
                Showing {filteredRequests.length} of {assignedRequests.length} available
              </p>
              {hasFilters && <Button type="button" size="sm" variant="ghost" onClick={clearFilters} data-testid="button-clear-request-filters">Clear filters</Button>}
              <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1" role="group" aria-label="Request layout">
                <Button type="button" size="sm" variant={layout === 'list' ? 'secondary' : 'ghost'} aria-pressed={layout === 'list'} aria-label="List layout" onClick={() => setLayout('list')} data-testid="button-request-list-layout"><List size={15} /></Button>
                <Button type="button" size="sm" variant={layout === 'grid' ? 'secondary' : 'ghost'} aria-pressed={layout === 'grid'} aria-label="Grid layout" onClick={() => setLayout('grid')} data-testid="button-request-grid-layout"><Grid2X2 size={15} /></Button>
              </div>
            </div>
          </div>

          {submissionsQuery.isLoading
            ? <div className="space-y-3" data-testid="state-assigned-requests-loading"><div className="h-32 animate-pulse rounded-xl bg-muted" /><div className="h-32 animate-pulse rounded-xl bg-muted/70" /></div>
            : submissionsQuery.isError
              ? <div className="grid min-h-48 place-items-center rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center" data-testid="state-assigned-requests-error">
                  <div><FileCheck2 size={21} className="mx-auto text-destructive" /><p className="mt-2 text-sm font-semibold">Assigned requests could not be loaded.</p><p className="mt-1 text-xs text-muted-foreground">Retry to refresh the rate approval queue.</p><Button size="sm" variant="outline" className="mt-3" onClick={() => void submissionsQuery.refetch()}>Retry</Button></div>
                </div>
              : assignedRequests.length === 0
                ? <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-border p-6 text-center" data-testid="state-no-assigned-requests">
                    <div><FileCheck2 size={22} className="mx-auto text-primary" /><p className="mt-3 text-sm font-semibold">No quotation requests to review</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Open requests and past decisions routed to your approval access will appear here.</p></div>
                  </div>
                : filteredRequests.length === 0
                  ? <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-border p-6 text-center" data-testid="state-no-matching-requests">
                      <div><Search size={20} className="mx-auto text-muted-foreground" /><p className="mt-2 text-sm font-semibold">No requests match these filters</p><p className="mt-1 text-xs text-muted-foreground">Adjust the search, status, location, or submitted date range.</p></div>
                    </div>
                   : <div className={layout === 'grid' ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-2'} data-testid={`assigned-requests-${layout}`}>
                      {filteredRequests.map((submission) => {
                        const isReviewable = submission.status === 'pending_review' && Boolean(submission.pdfFilename) && !submission.pdfNeedsRefresh;
                         const compact = layout === 'list';
                         const compactActionClass = compact ? 'h-7 min-h-7 px-2 text-[10px]' : '';
                        return (
                           <article key={submission.id} className={`min-w-0 rounded-xl border border-border/80 bg-card shadow-sm ${compact ? 'px-3 py-2.5' : 'p-4'}`} data-testid={`card-assigned-request-${submission.id}`}>
                             <div className={compact ? 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1' : 'flex flex-wrap items-start justify-between gap-2'}>
                               <div className={compact ? 'flex min-w-0 flex-wrap items-baseline gap-x-2' : 'min-w-0'}>
                                 <p className={`font-mono font-bold text-primary ${compact ? 'text-[11px]' : 'text-xs'}`}>{submission.id}</p>
                                 <h3 className={`${compact ? '' : 'mt-1'} truncate text-sm font-semibold`}>{submission.clientName}</h3>
                              </div>
                               <span className={`shrink-0 rounded-full border text-[9px] font-bold uppercase tracking-wide ${compact ? 'px-2 py-0.5' : 'px-2.5 py-1'} ${statusStyles[submission.status]}`} data-testid={`status-assigned-request-${submission.id}`}>
                                {statusLabels[submission.status]}
                              </span>
                            </div>

                             <p className={`${compact ? 'mt-1' : 'mt-2'} text-[10px] text-muted-foreground`}>
                              Submitted {dateTime(submission.createdAt)} · {submission.submittedByName}
                            </p>

                             {compact
                               ? <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-muted-foreground">
                                   <span><strong className="font-semibold text-foreground">{submission.windowQty}</strong> windows</span>
                                   <span><strong className="font-semibold text-foreground">{submission.totalSqFt.toLocaleString('en-IN')}</strong> sq. ft.</span>
                                   <span>Glass: <strong className="font-semibold text-foreground">{submission.glassType}</strong></span>
                                   <span>Location: <strong className="font-semibold text-foreground">{submission.location || '—'}</strong></span>
                                   <span>Order: <strong className="font-semibold text-foreground">{submission.orderId || 'Not linked'}</strong></span>
                                 </div>
                               : <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-muted/40 p-3 text-[11px]">
                                   <p><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Quantity</span><span className="font-semibold">{submission.windowQty} windows</span></p>
                                   <p><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Total area</span><span className="font-semibold">{submission.totalSqFt.toLocaleString('en-IN')} sq. ft.</span></p>
                                   <p><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Glass type</span><span className="font-semibold">{submission.glassType}</span></p>
                                   <p><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Location</span><span className="font-semibold">{submission.location || '—'}</span></p>
                                   <p><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Average / window</span><span className="font-semibold">{Number(submission.averageSqFtPerQty).toFixed(2)} sq. ft.</span></p>
                                   <p><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Order</span><span className="font-semibold">{submission.orderId || 'Not linked'}</span></p>
                                 </div>}

                             <div className={`${compact ? 'mt-2' : 'mt-3'} flex flex-wrap items-center gap-2`}>
                              {submission.pdfFilename
                                 ? <a href={getDownloadQuotationRateSubmissionPdfUrl(submission.id)} download={submission.pdfFilename} className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border font-semibold text-primary hover:bg-muted ${compact ? 'px-2 py-1.5 text-[10px]' : 'px-3 py-2 text-[11px]'}`} data-testid={`link-assigned-request-pdf-${submission.id}`}>
                                     <Download size={compact ? 12 : 13} /> <span className="truncate">{submission.pdfNeedsRefresh ? `Previous PDF · ${submission.pdfFilename}` : 'Download Eva PDF'}</span>
                                  </a>
                                : <span className="text-[10px] text-muted-foreground">PDF not attached yet</span>}
                              {submission.measurementRecordId && <span className="text-[10px] text-muted-foreground">Measurement sheet {measurementSheetIdLabel(submission.measurementRecordId, submission.measurementSheetId)}</span>}
                            </div>

                             <div className={`${compact ? 'mt-1.5 gap-1.5' : 'mt-3 gap-2'} flex flex-wrap items-center`} data-testid={`assigned-request-actions-${submission.id}`}>
                               <Button size="sm" variant="outline" className={compactActionClass} onClick={() => navigate(`/quotation-builder/requests/${submission.id}`)} data-testid={`button-view-assigned-request-${submission.id}`}>
                                 <Eye size={compact ? 12 : 13} /> View
                              </Button>
                               {canManageSubmission(submission) && <Button size="sm" variant="outline" className={compactActionClass} onClick={() => navigate(`/quotation-builder/requests/${submission.id}?edit=1`)} data-testid={`button-edit-assigned-request-${submission.id}`}>
                                 <Pencil size={compact ? 12 : 13} /> Edit
                              </Button>}
                               {canManageSubmission(submission) && <Button size="sm" variant="outline" className={`${compactActionClass} text-destructive hover:text-destructive`} disabled={deleteSubmission.isPending} onClick={() => removeSubmission(submission)} data-testid={`button-delete-assigned-request-${submission.id}`}>
                                 <Trash2 size={compact ? 12 : 13} /> Delete
                              </Button>}
                               {canLinkSubmission(submission) && <Button size="sm" variant="outline" className={compactActionClass} onClick={() => openOrderLink(submission)} data-testid={`button-link-assigned-request-order-${submission.id}`}>
                                 <Link2 size={compact ? 12 : 13} /> {submission.orderId ? 'Update links' : 'Link to order'}
                              </Button>}
                               {submission.status === 'awaiting_pdf' && canManageSubmission(submission) && <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border font-semibold hover:bg-muted ${compact ? 'px-2 py-1.5 text-[10px]' : 'px-3 py-2 text-[11px]'} ${upload.isPending ? 'pointer-events-none opacity-50' : ''}`} data-testid={`label-attach-assigned-request-pdf-${submission.id}`}>
                                 <FilePlus2 size={compact ? 12 : 13} /> Attach Eva PDF
                                <input
                                  type="file"
                                  accept="application/pdf,.pdf"
                                  className="sr-only"
                                  disabled={upload.isPending}
                                  data-testid={`input-attach-assigned-request-pdf-${submission.id}`}
                                  onChange={(event) => {
                                    const file = event.currentTarget.files?.[0];
                                    if (file) uploadPdf(submission.id, file);
                                    event.currentTarget.value = '';
                                  }}
                                />
                              </label>}
                            </div>

                             {submission.pdfNeedsRefresh && <p className={`${compact ? 'mt-1.5 px-2 py-1.5' : 'mt-2 px-2.5 py-2'} rounded-md bg-amber-50 text-[10px] text-amber-800`}>An updated PDF is required before this request can be reviewed.</p>}

                            {isReviewable
                               ? <div className={compact ? 'mt-2 grid gap-2 border-t border-border/70 pt-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end' : 'mt-4 space-y-2 border-t border-border/70 pt-3'}>
                                  <label className="block space-y-1 text-[10px] font-semibold text-muted-foreground">
                                    Decision note <span className="font-normal">(optional)</span>
                                     <Textarea rows={compact ? 1 : 2} maxLength={1000} value={comments[submission.id] || ''} onChange={(event) => setComments((current) => ({ ...current, [submission.id]: event.target.value }))} className={compact ? 'resize-none py-1.5 text-xs' : undefined} style={compact ? { height: 36, minHeight: 36 } : undefined} placeholder="Context for the submitter" aria-label={`Decision note for ${submission.id}`} data-testid={`input-assigned-request-comment-${submission.id}`} />
                                  </label>
                                   <div className={`flex flex-wrap ${compact ? 'gap-1.5' : 'gap-2'}`}>
                                     <Button size="sm" className={compactActionClass} onClick={() => makeDecision(submission, 'approved')} disabled={decide.isPending} data-testid={`button-approve-assigned-request-${submission.id}`}><Check size={compact ? 12 : 13} /> Approve</Button>
                                     <Button size="sm" variant="outline" className={`${compactActionClass} text-destructive hover:text-destructive`} onClick={() => makeDecision(submission, 'rejected')} disabled={decide.isPending} data-testid={`button-reject-assigned-request-${submission.id}`}><X size={compact ? 12 : 13} /> Reject</Button>
                                  </div>
                                </div>
                              : submission.status === 'pending_review'
                                 ? <p className={`${compact ? 'mt-2 px-2 py-1.5' : 'mt-3 px-2.5 py-2'} rounded-md border border-amber-200 bg-amber-50 text-[10px] text-amber-800`}>Attach a current Eva PDF before recording a decision.</p>
                                 : (submission.status === 'approved' || submission.status === 'rejected') && <p className={`${compact ? 'mt-2 pt-2' : 'mt-3 pt-3'} border-t border-border/70 text-[10px] text-muted-foreground`}>Decided by {submission.decidedByName || 'approver'}{submission.decisionComment ? ` · ${submission.decisionComment}` : ''}</p>}
                          </article>
                        );
                      })}
                    </div>}
        </CardContent>
      </Card>

      <Dialog open={Boolean(linkingSubmission)} onOpenChange={(open) => { if (!open) setLinkingSubmission(null); }}>
        <DialogContent className="max-w-none sm:max-h-[90vh] sm:w-[min(90vw,52rem)] sm:max-w-none" data-testid="dialog-link-assigned-quotation-order">
          <DialogHeader>
            <DialogTitle>Link quotation request and measurement sheet</DialogTitle>
            <DialogDescription>{linkingSubmission ? `${linkingSubmission.id} · ${linkingSubmission.clientName}` : 'Choose an order for this quotation request.'}</DialogDescription>
          </DialogHeader>
          <div className="min-w-0 w-full space-y-4">
            <label className="block space-y-1.5 text-xs font-semibold">Order ID
              <Select value={linkOrderRecordId || 'unassigned'} onValueChange={(value) => setLinkOrderRecordId(value === 'unassigned' ? '' : value)}>
                <SelectTrigger data-testid="select-link-assigned-quotation-order"><SelectValue placeholder="Select an order" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Choose an order</SelectItem>
                  {ordersQuery.isLoading
                    ? <SelectItem value="loading" disabled>Loading orders…</SelectItem>
                    : ordersQuery.isError
                      ? <SelectItem value="orders-error" disabled>Orders could not be loaded</SelectItem>
                      : (ordersQuery.data || []).map((order) => <SelectItem key={order.id} value={order.id}>{order.orderId} · {order.clientName} · {order.locationName}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            {ordersQuery.isError && <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-destructive"><span>Orders could not be loaded. Retry before saving.</span><Button type="button" size="sm" variant="outline" onClick={() => void ordersQuery.refetch()} data-testid="button-retry-assigned-request-orders"><RefreshCw size={13} /> Retry</Button></div>}
            {linkOrderRecordId && <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input type="checkbox" checked={linkMeasurementSheet} onChange={(event) => { setLinkMeasurementSheet(event.target.checked); if (!event.target.checked) { setLinkMeasurementId(null); setLinkMeasurementLabel(''); } }} className="h-4 w-4 accent-primary" data-testid="checkbox-link-measurement-from-assigned-request" />
                Link a measurement sheet ID to this request
              </label>
              {linkMeasurementSheet && <MeasurementSheetLookup
                selectedId={linkMeasurementId}
                selectedLabel={linkMeasurementLabel}
                currentQuotationRequestId={linkingSubmission?.id || ''}
                onSelect={(item) => { setLinkMeasurementId(item.id); setLinkMeasurementLabel(`${measurementSheetIdLabel(item.id, item.sheetId)} · ${item.clientName}`); }}
              />}
            </div>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLinkingSubmission(null)} data-testid="button-cancel-link-assigned-quotation">Cancel</Button>
            <Button type="button" onClick={saveOrderLink} disabled={linkOrder.isPending || ordersQuery.isError || !linkOrderRecordId} data-testid="button-save-link-assigned-quotation">{linkOrder.isPending ? 'Saving…' : 'Save links'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
