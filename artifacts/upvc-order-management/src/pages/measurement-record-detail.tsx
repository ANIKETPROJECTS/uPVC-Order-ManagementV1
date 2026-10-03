import { ArrowLeft, Download, Eye, FileSpreadsheet, MapPin } from 'lucide-react';
import {
  getDownloadMeasurementVersionUrl,
  getListMeasurementRecordsQueryKey,
  getPreviewMeasurementVersionUrl,
  useListMeasurementRecords,
} from '@workspace/api-client-react';
import type { User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { measurementSheetIdLabel } from '@/components/link-record-lookups';
import { useLocation, useParams } from 'wouter';

const dateLabel = (value: string) => new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value));

const sizeLabel = (size: number) => size < 1024 * 1024
  ? `${Math.max(1, Math.round(size / 1024))} KB`
  : `${(size / 1024 / 1024).toFixed(2)} MiB`;

export default function MeasurementRecordDetailPage({ user }: { user: User }) {
  const { recordId = '' } = useParams<{ recordId: string }>();
  const [, setLocation] = useLocation();
  const recordsQuery = useListMeasurementRecords({
    query: { queryKey: getListMeasurementRecordsQueryKey() },
  });
  const record = recordsQuery.data?.find((item) => item.id === recordId);
  const versions = record?.versions.slice().sort((a, b) => b.versionNumber - a.versionNumber) || [];

  return (
    <AppShell user={user} title="Measurement sheet details" eyebrow="Module 6 · retained register">
      <div className="space-y-5" data-testid="page-measurement-record-detail">
        <Button type="button" variant="outline" onClick={() => setLocation('/measurements')} data-testid="button-back-to-measurement-register">
          <ArrowLeft size={15} /> Back to measurement register
        </Button>

        {recordsQuery.isLoading ? (
          <Card><CardContent className="space-y-3 p-6"><div className="h-6 w-64 animate-pulse rounded bg-muted" /><div className="h-20 animate-pulse rounded bg-muted/70" /></CardContent></Card>
        ) : recordsQuery.isError ? (
          <Card><CardContent className="p-6 text-sm text-destructive" data-testid="state-measurement-record-detail-error">Measurement sheet details could not be loaded. Return to the register and try again.</CardContent></Card>
        ) : !record ? (
          <Card><CardContent className="p-8 text-center" data-testid="state-measurement-record-detail-not-found">
            <p className="font-display text-lg font-bold">Measurement sheet not found</p>
            <p className="mt-2 text-sm text-muted-foreground">It may have been deleted or you may not have access to it.</p>
          </CardContent></Card>
        ) : (
          <>
            <Card className="overflow-hidden border-border/80">
              <CardHeader className="border-b border-border/70 bg-muted/20">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Measurement Sheet ID</p>
                    <code className="mt-1 block break-all font-mono text-sm font-semibold text-primary" data-testid="text-detail-measurement-sheet-id">
                      {measurementSheetIdLabel(record.id)}
                    </code>
                    <CardTitle className="mt-3 font-display text-2xl">{record.clientName}</CardTitle>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin size={14} /> {record.location || 'Location not specified'}</p>
                  </div>
                  <span className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                    {versions.length} {versions.length === 1 ? 'document version' : 'document versions'}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-4">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Client</p><p className="mt-1 text-sm font-semibold">{record.clientName}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Location</p><p className="mt-1 text-sm">{record.location || 'Not specified'}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Assigned order</p><p className="mt-1 text-sm">{record.orderId || 'No order assigned'}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Rate Approval request</p><p className="mt-1 text-sm">{record.quotationRequestId || 'No request linked'}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Created</p><p className="mt-1 text-sm">{dateLabel(record.createdAt)}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Last updated</p><p className="mt-1 text-sm">{dateLabel(record.updatedAt)}</p></div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-border/80" data-testid="card-measurement-record-documents">
              <CardHeader className="border-b border-border/70">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Retained documents</p>
                <CardTitle className="mt-1 font-display text-lg">Sheet files and version history</CardTitle>
                <p className="text-xs text-muted-foreground">Each file opens from its own View action. Previous versions remain available here.</p>
              </CardHeader>
              <CardContent className="p-4 sm:p-5">
                {versions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center" data-testid="state-measurement-detail-no-documents">
                    <FileSpreadsheet size={21} className="mx-auto text-muted-foreground" />
                    <p className="mt-3 text-sm font-semibold">No measurement sheets uploaded</p>
                    <p className="mt-1 text-xs text-muted-foreground">This record is ready for its first sheet version.</p>
                  </div>
                ) : (
                  <ol className="space-y-3" aria-label={`Sheet file history for ${record.clientName}`} data-testid="list-measurement-detail-versions">
                    {versions.map((version) => (
                      <li key={version.id} className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card p-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-measurement-detail-version-${version.id}`}>
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><FileSpreadsheet size={17} /></span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{version.name || version.filename}</p>
                            {version.name && <p className="mt-0.5 truncate text-xs text-muted-foreground">Original filename: {version.filename}</p>}
                            <p className="mt-1 text-xs text-muted-foreground">
                              Version {version.versionNumber} · {sizeLabel(version.sizeBytes)} · {dateLabel(version.uploadedAt)} · {version.uploadedByName}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <a href={getPreviewMeasurementVersionUrl(record.id, version.id)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted" data-testid={`link-preview-measurement-version-${version.id}`}>
                            <Eye size={14} /> View file
                          </a>
                          <a href={getDownloadMeasurementVersionUrl(record.id, version.id)} download={version.filename} className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-primary hover:bg-primary/5" data-testid={`link-download-measurement-version-${version.id}`}>
                            <Download size={14} /> Download
                          </a>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}