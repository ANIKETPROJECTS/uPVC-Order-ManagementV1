import './_group.css';
import { Check, Download, Eye, Link2, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function Compact() {
  return (
    <main className="quotation-request-preview min-h-screen bg-background p-5">
      <article className="min-w-0 rounded-xl border border-border/80 bg-card px-3 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <p className="font-mono text-[11px] font-bold text-primary">RA-1002</p>
            <h3 className="truncate text-sm font-semibold">TEST</h3>
            <p className="text-[10px] text-muted-foreground">6 Oct 2026, 11:25 am · Aditi Kulkarni</p>
          </div>
          <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">Awaiting approval</span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span><strong className="font-semibold text-foreground">17</strong> windows</span>
          <span><strong className="font-semibold text-foreground">34.234</strong> sq. ft.</span>
          <span>Glass: <strong className="font-semibold text-foreground">TEST</strong></span>
          <span>Location: <strong className="font-semibold text-foreground">TEST</strong></span>
          <span>Order: <strong className="font-semibold text-foreground">Not linked</strong></span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 min-h-7 px-2 text-[10px] border-emerald-200 bg-emerald-50 text-emerald-800"><Download size={12} /> Download PDF</Button>
          <span className="text-[10px] text-muted-foreground">No measurement sheet linked</span>
          <span className="mx-1 hidden h-4 border-l border-border sm:block" />
          <Button size="sm" variant="outline" className="h-7 min-h-7 px-2 text-[10px]"><Eye size={12} /> View</Button>
          <Button size="sm" variant="outline" className="h-7 min-h-7 px-2 text-[10px]"><Pencil size={12} /> Edit</Button>
          <Button size="sm" variant="outline" className="h-7 min-h-7 px-2 text-[10px] text-destructive"><Trash2 size={12} /> Delete</Button>
          <Button size="sm" variant="outline" className="h-7 min-h-7 px-2 text-[10px]"><Link2 size={12} /> Link to order</Button>
        </div>

        <div className="mt-2 grid gap-2 border-t border-border/70 pt-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block min-w-0 space-y-1 text-[10px] font-semibold text-muted-foreground">
            Decision note <span className="font-normal">(optional)</span>
            <Textarea rows={1} className="h-9 min-h-0 resize-none py-1.5 text-xs" placeholder="Context for the submitter" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-7 min-h-7 px-2.5 text-[10px]"><Check size={12} /> Approve</Button>
            <Button size="sm" variant="outline" className="h-7 min-h-7 px-2.5 text-[10px] text-destructive"><X size={12} /> Reject</Button>
          </div>
        </div>
      </article>
    </main>
  );
}
