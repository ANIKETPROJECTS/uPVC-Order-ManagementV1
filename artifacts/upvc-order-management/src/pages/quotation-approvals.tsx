import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, CircleAlert, Clock3, FileCheck2, RefreshCw, X } from 'lucide-react';
import { useLocation } from 'wouter';
import {
  getGetQuotationQueryKey, getListQuotationApprovalsQueryKey, getListQuotationsQueryKey,
  useDecideQuotationApproval, useListQuotationApprovals,
} from '@workspace/api-client-react';
import type { QuotationApprovalQueueItem } from '@workspace/api-client-react';
import type { User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

const money = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateTime = (value: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export default function QuotationApprovalsPage({ user }: { user: User }) {
  const queue = useListQuotationApprovals({ query: { queryKey: getListQuotationApprovalsQueryKey(), refetchOnWindowFocus: true } });
  const decide = useDecideQuotationApproval();
  const client = useQueryClient();
  const { toast } = useToast();
  const [location, navigate] = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('quote'));
  const [reason, setReason] = useState('');
  useEffect(() => {
    const quoteId = new URLSearchParams(window.location.search).get('quote');
    if (quoteId) setSelectedId(quoteId);
  }, [location]);
  const items = queue.data || [];
  const selected = items.find((row) => row.quotation.id === selectedId) || items[0] || null;
  const rates = useMemo(() => selected?.quotation.items.filter((item) => item.rateOverridden) || [], [selected]);
  const refresh = () => void queue.refetch();
  const submitDecision = (decision: 'approved' | 'rejected') => {
    if (!selected) return;
    if (decision === 'rejected' && !reason.trim()) {
      toast({ title: 'A rejection reason is required', description: 'Add a short note so the quote owner knows what to revise.', variant: 'destructive' });
      return;
    }
    decide.mutate({ quotationId: selected.quotation.id, data: { decision, ...(decision === 'rejected' ? { reason: reason.trim() } : {}) } }, {
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: getListQuotationApprovalsQueryKey() });
        void client.invalidateQueries({ queryKey: getListQuotationsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetQuotationQueryKey(selected.quotation.id) });
        toast({ title: decision === 'approved' ? 'Quotation approved' : 'Quotation rejected', description: `${selected.quotation.quoteNo} has been updated.` });
        setReason('');
      },
      onError: () => toast({ title: 'Decision could not be saved', description: 'Please retry after checking your connection.', variant: 'destructive' }),
    });
  };

  return <AppShell user={user} title="Quotation approvals" eyebrow="Module 3 · assigned review queue">
    <div className="space-y-6">
      <section className="rounded-2xl bg-sidebar p-6 text-sidebar-foreground md:p-8">
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-sidebar-primary">Decision desk / {items.length} awaiting</p>
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">Review the rate. Then decide.</h2>
        <p className="mt-2 max-w-xl text-sm text-sidebar-foreground/65">Compare overridden rates against catalogue values, inspect the full quote, and leave a clear audit trail.</p>
      </section>
      {queue.isLoading ? <Card><CardContent className="space-y-3 p-5"><div className="h-12 animate-pulse rounded-lg bg-muted"/><div className="h-12 animate-pulse rounded-lg bg-muted/70"/></CardContent></Card>
        : queue.isError ? <Card className="border-destructive/30"><CardContent className="flex items-center justify-between gap-4 p-6"><p className="text-sm text-destructive">Approval queue could not be loaded.</p><Button variant="outline" onClick={refresh}><RefreshCw size={14}/> Retry</Button></CardContent></Card>
        : !items.length ? <Card><CardContent className="grid min-h-64 place-items-center p-8 text-center"><div><div className="mx-auto grid size-12 place-items-center rounded-xl bg-secondary text-primary"><FileCheck2 size={22}/></div><h3 className="mt-4 font-display text-lg font-bold">Queue is clear</h3><p className="mt-1 text-sm text-muted-foreground">Assigned quotations needing a decision will appear here.</p></div></CardContent></Card>
        : <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(280px,.78fr)_minmax(0,1.5fr)]">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="border-b border-border/70"><CardTitle className="font-display text-base">Assigned to you</CardTitle></CardHeader>
            <CardContent className="max-h-[70dvh] space-y-2 overflow-y-auto p-3">
              {items.map((row: QuotationApprovalQueueItem) => <button type="button" key={row.quotation.id} onClick={() => { setSelectedId(row.quotation.id); setReason(''); }} className={`w-full rounded-xl border p-4 text-left transition-colors ${selected?.quotation.id === row.quotation.id ? 'border-primary/40 bg-primary/5' : 'border-border/70 hover:bg-muted/50'}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs font-bold text-primary">{row.quotation.quoteNo}</span><ArrowRight size={14} className="text-muted-foreground"/></div>
                <p className="mt-2 truncate text-sm font-semibold">{row.quotation.customerName}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{row.quotation.projectName || 'Window quotation'} · {money(row.quotation.totals.grandTotal)}</p>
                <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground"><Clock3 size={12}/> Sent {dateTime(row.submittedAt)} · {row.submittedByName}</p>
              </button>)}
            </CardContent>
          </Card>
          {selected && <Card className="min-w-0 overflow-hidden">
            <CardHeader className="border-b border-border/70"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs font-bold text-primary">{selected.quotation.quoteNo} · {selected.quotation.status.replace('_', ' ')}</p><CardTitle className="mt-1 font-display text-xl">{selected.quotation.customerName}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{selected.quotation.projectName || 'No project name'} · Submitted by {selected.submittedByName}</p></div><Button size="sm" variant="outline" onClick={() => navigate(`/quotation-builder?quote=${selected.quotation.id}&section=drafts`)}>Open quote</Button></div></CardHeader>
            <CardContent className="space-y-5 p-4 sm:p-6">
              {rates.length > 0 && <div className="rounded-xl border border-accent/40 bg-accent/10 p-4"><div className="flex items-start gap-2"><CircleAlert size={16} className="mt-0.5 shrink-0 text-accent-foreground"/><div><p className="text-sm font-semibold">Rate override review</p><p className="mt-1 text-xs text-muted-foreground">{rates.length} line{rates.length === 1 ? '' : 's'} priced outside the catalogue rate.</p></div></div><div className="mt-3 overflow-x-auto rounded-lg border border-border/70"><table className="w-full min-w-[450px] text-left text-xs"><thead className="bg-muted/60 text-muted-foreground"><tr><th className="p-2">Window / code</th><th className="p-2">Catalogue</th><th className="p-2">Quoted</th></tr></thead><tbody>{rates.map((line, i) => <tr key={`${line.code}-${i}`} className="border-t border-border/60"><td className="p-2">{line.location || line.code} · {line.profileName}</td><td className="p-2">{money(line.catalogueRatePerSqFt)}</td><td className="p-2 font-semibold text-accent-foreground">{money(line.ratePerSqFt)} / sq.ft.</td></tr>)}</tbody></table></div></div>}
              <div className="overflow-x-auto rounded-xl border border-border/70"><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-muted/60 text-muted-foreground"><tr>{['Opening','Size mm','Qty','Rate / sq.ft.','Line value'].map((label) => <th key={label} className="p-3 font-semibold">{label}</th>)}</tr></thead><tbody>{selected.quotation.items.map((line, i) => <tr key={`${line.code}-${i}`} className="border-t border-border/60"><td className="p-3"><span className="font-semibold">{line.location || line.code}</span><span className="block text-[10px] text-muted-foreground">{line.profileName}</span>{line.rateOverridden && <span className="mt-1 inline-flex rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-bold text-accent-foreground">Rate override</span>}</td><td className="p-3 font-mono">{line.widthMm} × {line.heightMm}</td><td className="p-3">{line.quantity}</td><td className="p-3">{money(line.ratePerSqFt)}</td><td className="p-3 font-semibold">{money(line.value)}</td></tr>)}</tbody></table></div>
              <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl bg-secondary/50 p-4"><div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Quotation total</p><p className="mt-1 font-display text-2xl font-bold">{money(selected.quotation.totals.grandTotal)}</p></div><p className="text-xs text-muted-foreground">{selected.quotation.totals.componentCount} windows · GST {selected.quotation.gstPercent}%</p></div>
              <div className="grid gap-3 sm:grid-cols-2"><div><label className="text-xs font-semibold" htmlFor="approval-reason">Decision note {selected.quotation.status === 'pending_approval' ? '(required to reject)' : ''}</label><Textarea id="approval-reason" className="mt-2" rows={3} maxLength={1000} placeholder="Reason or revision guidance…" value={reason} onChange={(e) => setReason(e.target.value)} /></div><div className="flex flex-col justify-end gap-2 sm:items-end"><Button disabled={decide.isPending} onClick={() => submitDecision('approved')}><Check size={15}/> Approve quotation</Button><Button variant="destructive" disabled={decide.isPending || !reason.trim()} onClick={() => submitDecision('rejected')}><X size={15}/> Reject with reason</Button></div></div>
              {!!selected.quotation.approvalHistory.length && <section><h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Approval history</h3><ol className="space-y-2">{[...selected.quotation.approvalHistory].reverse().map((entry, i) => <li key={`${entry.createdAt}-${i}`} className="flex gap-3 rounded-lg border border-border/60 p-3"><span className={`mt-1 size-2 shrink-0 rounded-full ${entry.action === 'approved' ? 'bg-primary' : entry.action === 'rejected' ? 'bg-destructive' : 'bg-accent'}`}/><div className="min-w-0"><p className="text-xs font-semibold capitalize">{entry.action.replace('_', ' ')} · {entry.actorName}</p><p className="mt-1 text-[10px] text-muted-foreground">{dateTime(entry.createdAt)}{entry.reason ? ` · ${entry.reason}` : ''}</p></div></li>)}</ol></section>}
            </CardContent>
          </Card>}
        </div>}
    </div>
  </AppShell>;
}