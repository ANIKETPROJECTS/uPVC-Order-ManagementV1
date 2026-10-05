import './_group.css';
import { Check, Download, Eye, Link2, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function Current() {
  return (
    <main className="quotation-request-preview min-h-screen bg-background p-5">
      <article className="min-w-0 rounded-xl border border-border/80 bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-xs font-bold text-primary">RA-1002</p>
            <h3 className="mt-1 truncate text-sm font-semibold">TEST</h3>
          </div>
          <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-amber-800">Awaiting approval</span>
        </div>

        <p className="mt-2 text-[10px] text-muted-foreground">Submitted 6 Oct 2026, 11:25 am · Aditi Kulkarni</p>

        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-muted/40 p-3 text-[11px]">
          <p><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Quantity</span><span className="font-semibold">17 windows</span></p>
          <p><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Total area</span><span className="font-semibold">34.234 sq. ft.</span></p>
          <p><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Glass type</span><span className="font-semibold">TEST</span></p>
          <p><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Location</span><span className="font-semibold">TEST</span></p>
          <p><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Average / window</span><span className="font-semibold">2,013.76 sq. ft.</span></p>
          <p><span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Order</span><span className="font-semibold">Not linked</span></p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800"><Download size={13} /> Download Eva PDF</Button>
          <span className="text-[10px] text-muted-foreground">No measurement sheet linked</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline"><Eye size={13} /> View</Button>
          <Button size="sm" variant="outline"><Pencil size={13} /> Edit</Button>
          <Button size="sm" variant="outline" className="text-destructive"><Trash2 size={13} /> Delete</Button>
          <Button size="sm" variant="outline"><Link2 size={13} /> Link to order</Button>
        </div>

        <div className="mt-4 space-y-2 border-t border-border/70 pt-3">
          <label className="block space-y-1 text-[10px] font-semibold text-muted-foreground">
            Decision note <span className="font-normal">(optional)</span>
            <Textarea rows={2} placeholder="Context for the submitter" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm"><Check size={13} /> Approve</Button>
            <Button size="sm" variant="outline" className="text-destructive"><X size={13} /> Reject</Button>
          </div>
        </div>
      </article>
    </main>
  );
}
