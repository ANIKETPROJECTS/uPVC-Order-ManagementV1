import { ArrowDownToLine, CalendarDays, MapPin, PackageOpen, PanelsTopLeft, Ruler, ShieldCheck, Wrench } from 'lucide-react';
import { useGetPublicInstallationShare, getGetPublicInstallationShareQueryKey } from '@workspace/api-client-react';
import { useRoute } from 'wouter';
import { Button } from '@/components/ui/button';
import { SiteLocation } from '@/components/site-location';

const displayDate = (value: string | null) => {
  if (!value) return 'Date to be confirmed';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? 'Date to be confirmed' : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
};

export default function PublicInstallationSharePage() {
  const [, params] = useRoute('/installation/share/:token');
  const token = params?.token || '';
  const query = useGetPublicInstallationShare(token, {
    query: {
      enabled: Boolean(token),
      queryKey: getGetPublicInstallationShareQueryKey(token),
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  });
  const job = query.data;

  return <main className="min-h-[100dvh] bg-[hsl(42_38%_95%)] px-4 py-8 text-[hsl(197_36%_18%)] sm:px-6 sm:py-12" data-testid="page-public-installation-share">
    <div className="mx-auto max-w-3xl">
      <header className="mb-8 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-[hsl(168_58%_35%)] text-white"><Wrench size={19} /></span>
        <div><p className="font-display text-sm font-bold tracking-tight">Framewise</p><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[hsl(198_15%_45%)]">Installation details</p></div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[hsl(168_30%_78%)] bg-[hsl(168_45%_94%)] px-3 py-1.5 text-[10px] font-bold text-[hsl(168_58%_27%)]"><ShieldCheck size={13} /> Shared job page</span>
      </header>

      {query.isLoading ? <section className="animate-pulse overflow-hidden rounded-3xl border border-[hsl(39_25%_84%)] bg-[hsl(42_46%_99%)]" data-testid="state-public-installation-loading">
        <div className="h-44 bg-[hsl(174_28%_88%)]" /><div className="space-y-4 p-6"><div className="h-5 w-32 rounded bg-[hsl(40_27%_90%)]" /><div className="h-8 w-64 rounded bg-[hsl(40_27%_90%)]" /><div className="h-20 rounded-xl bg-[hsl(40_27%_90%)]" /></div>
      </section> : query.isError || !job ? <section className="grid min-h-80 place-items-center rounded-3xl border border-[hsl(39_25%_84%)] bg-[hsl(42_46%_99%)] p-8 text-center" data-testid="state-public-installation-error">
        <div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[hsl(40_27%_90%)] text-[hsl(198_15%_45%)]"><PackageOpen size={22} /></span><h1 className="mt-4 font-display text-xl font-bold">Job details unavailable</h1><p className="mt-2 max-w-sm text-sm leading-6 text-[hsl(198_15%_45%)]">This shared installation link may have expired or the details could not be loaded.</p><Button type="button" variant="outline" className="mt-5" onClick={() => void query.refetch()} data-testid="button-retry-public-installation">Try again</Button></div>
      </section> : <>
        <section className="relative overflow-hidden rounded-3xl border border-[hsl(168_48%_30%)] bg-[linear-gradient(125deg,#153b40_0%,#1e6258_72%,#408576_100%)] p-6 text-[#f4f1e6] shadow-lg sm:p-9" data-testid="panel-public-installation-job">
          <div className="absolute -right-10 -top-14 size-56 rotate-12 rounded-[2.5rem] border border-white/15 bg-white/[.035]" aria-hidden="true" />
          <div className="relative">
            <p className="font-mono text-xs font-bold tracking-[.12em] text-[#c8e5d8]" data-testid="text-public-installation-order-id">{job.orderId}</p>
            <h1 className="mt-3 max-w-xl font-display text-3xl font-bold tracking-[-.045em] sm:text-4xl" data-testid="text-public-installation-client">{job.clientName}</h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-white/80" data-testid="text-public-installation-location"><MapPin size={15} />{job.locationName}</p>
            <div className="mt-7 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[.08] px-3 py-2 text-xs font-semibold"><CalendarDays size={14} />{displayDate(job.scheduledDate)}</span>
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[.08] px-3 py-2 text-xs font-semibold"><PanelsTopLeft size={14} />{job.windowQty} {job.windowQty === 1 ? 'window' : 'windows'}</span>
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-[hsl(39_25%_84%)] bg-[hsl(42_46%_99%)] p-5 sm:p-6" data-testid="panel-public-installation-location">
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(168_58%_35%)]">Site location</p>
          <div className="mt-3">
            <SiteLocation address={job.siteAddress || job.locationName} showMap testId="public-installation-site-location" />
          </div>
        </section>

        <section className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr]" aria-label="Installation assignment details">
          <article className="rounded-2xl border border-[hsl(39_25%_84%)] bg-[hsl(42_46%_99%)] p-5" data-testid="panel-public-installation-crew">
            <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(168_58%_35%)]">Field crew</p>
            <h2 className="mt-3 font-display text-xl font-bold" data-testid="text-public-installation-team">{job.teamName}</h2>
            {job.subteamName && <p className="mt-1 text-sm text-[hsl(198_15%_45%)]" data-testid="text-public-installation-subteam">{job.subteamName}</p>}
            <div className="mt-5 border-t border-[hsl(39_25%_84%)] pt-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(198_15%_45%)]">Measured area</p><p className="mt-1 flex items-baseline gap-2 font-display text-2xl font-bold" data-testid="text-public-installation-sqft">{job.actualSquareFootage === null ? <span className="text-base font-medium text-[hsl(198_15%_45%)]">Not recorded yet</span> : <>{job.actualSquareFootage.toLocaleString('en-IN')} <span className="text-sm font-semibold text-[hsl(198_15%_45%)]">sq ft</span></>}</p></div>
          </article>
          <article className="rounded-2xl border border-[hsl(39_25%_84%)] bg-[hsl(42_46%_99%)] p-5" data-testid="panel-public-installation-quantity">
            <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(168_58%_35%)]">Site summary</p>
            <div className="mt-5 flex items-center gap-4"><span className="grid size-12 place-items-center rounded-2xl bg-[hsl(174_28%_88%)] text-[hsl(168_58%_30%)]"><Ruler size={21} /></span><div><p className="font-display text-2xl font-bold">{job.windowQty}</p><p className="text-xs text-[hsl(198_15%_45%)]">uPVC units scheduled</p></div></div>
            <p className="mt-5 border-t border-[hsl(39_25%_84%)] pt-4 text-xs leading-5 text-[hsl(198_15%_45%)]">Keep this page handy for your upcoming installation visit. It reflects the latest shared job details.</p>
          </article>
        </section>

        <section className="mt-4 rounded-2xl border border-[hsl(39_25%_84%)] bg-[hsl(42_46%_99%)] p-5 sm:p-6" data-testid="panel-public-installation-drawing">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[hsl(40_27%_90%)] text-[hsl(168_58%_35%)]"><PackageOpen size={18} /></span><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(198_15%_45%)]">Latest drawing</p><h2 className="mt-1 text-sm font-bold" data-testid="text-public-installation-drawing-name">{job.drawingFilename || 'No drawing attached'}</h2><p className="mt-1 text-xs text-[hsl(198_15%_45%)]">{job.drawingFilename ? 'PDF · current site reference' : 'A drawing will appear here when one is shared.'}</p></div></div>
            {job.drawingUrl && <div className="flex gap-2"><a href={job.drawingUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[hsl(39_25%_84%)] px-3 text-xs font-bold transition hover:border-[hsl(168_58%_35%)] hover:text-[hsl(168_58%_35%)]" data-testid="link-view-installation-drawing">View PDF</a><a href={`${job.drawingUrl}?download=1`} download={job.drawingFilename || undefined} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[hsl(168_58%_35%)] px-3 text-xs font-bold text-white transition hover:bg-[hsl(168_58%_30%)]" data-testid="link-download-installation-drawing"><ArrowDownToLine size={14} />Download</a></div>}
          </div>
          {job.drawingUrl && <div className="mt-5 overflow-hidden rounded-xl border border-[hsl(39_25%_84%)] bg-[hsl(40_27%_90%)]" data-testid="preview-public-installation-drawing"><iframe title={`Drawing for ${job.orderId}`} src={job.drawingUrl} className="h-[min(62vh,640px)] w-full" /></div>}
        </section>
      </>}
      <footer className="mt-8 flex items-center justify-between border-t border-[hsl(39_25%_84%)] pt-4 text-[10px] text-[hsl(198_15%_45%)]"><span>Framewise · Installation coordination</span><span>Read-only share</span></footer>
    </div>
  </main>;
}
