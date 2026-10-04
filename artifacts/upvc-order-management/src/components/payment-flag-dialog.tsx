import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Flag, LoaderCircle, X } from 'lucide-react';
import {
  getListOrderActivityQueryKey,
  getListOrderPaymentFlagsQueryKey,
  getListPaymentFlagsQueryKey,
  useCreateOrderPaymentFlag,
} from '@workspace/api-client-react';
import type { PaymentFlagType } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { getIstDateKey } from '@/lib/formatters';

const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const todayInIst = () => getIstDateKey(new Date());

export function PaymentFlagDialog({ orderId, flaggedBy, onOpening }: { orderId: string; flaggedBy: string; onOpening: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useCreateOrderPaymentFlag();
  const [open, setOpen] = useState(false);
  const [flagType, setFlagType] = useState<PaymentFlagType>('bounced_payment');
  const [flaggedAt, setFlaggedAt] = useState(todayInIst);
  const [remarks, setRemarks] = useState('');
  const [bounceReason, setBounceReason] = useState('');
  const [bouncedAmount, setBouncedAmount] = useState('');
  const [bankCharges, setBankCharges] = useState('');
  const [followUpCount, setFollowUpCount] = useState('1');
  const [lastFollowUpDate, setLastFollowUpDate] = useState(localDate);
  const [followUpNotes, setFollowUpNotes] = useState('');

  const openForm = () => {
    onOpening();
    setFlagType('bounced_payment');
    setFlaggedAt(todayInIst());
    setRemarks('');
    setBounceReason('');
    setBouncedAmount('');
    setBankCharges('');
    setFollowUpCount('1');
    setLastFollowUpDate(localDate());
    setFollowUpNotes('');
    setOpen(true);
  };

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = flagType === 'bounced_payment'
      ? {
        flagType,
        remarks: remarks.trim(),
        flaggedAt,
        bounceReason: bounceReason.trim(),
        bouncedAmount: Number(bouncedAmount),
        ...(bankCharges.trim() ? { bankCharges: Number(bankCharges) } : {}),
      }
      : {
        flagType,
        remarks: remarks.trim(),
        flaggedAt,
        followUpCount: Number(followUpCount),
        lastFollowUpDate,
        followUpNotes: followUpNotes.trim(),
      };
    create.mutate({ id: orderId, data }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListPaymentFlagsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListOrderPaymentFlagsQueryKey(orderId) });
        void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(orderId) });
        toast({ title: 'Payment flag added' });
        setOpen(false);
      },
      onError: () => toast({ title: 'Payment flag could not be added', variant: 'destructive' }),
    });
  };

  return <>
    <Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={openForm} data-testid="button-flag-payment">
      <Flag size={14} /> Flag
    </Button>
    {open && <div className="fixed inset-0 z-[80] flex min-w-0 items-end justify-center overflow-hidden bg-slate-950/50 p-2 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="payment-flag-title" data-testid="dialog-payment-flag">
      <div className="flex max-h-[calc(100dvh-1rem)] w-full min-w-0 max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-700">Payment issue</p>
            <h2 id="payment-flag-title" className="mt-1 font-display text-xl font-bold">Flag payment</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Create a trackable issue without changing the payment ledger.</p>
          </div>
          <Button type="button" size="icon" variant="ghost" aria-label="Close flag form" onClick={() => setOpen(false)} data-testid="button-close-payment-flag"><X size={16} /></Button>
        </header>
        <form onSubmit={save} className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="form-payment-flag">
          <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6">
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="block min-w-0">
                <span className="mb-1.5 block text-xs font-semibold">Flag type</span>
                <select value={flagType} onChange={(event) => setFlagType(event.target.value as PaymentFlagType)} className={inputClass} data-testid="select-payment-flag-type">
                  <option value="bounced_payment">Bounced Payment</option>
                  <option value="refusal_to_pay">Refusal to Pay</option>
                </select>
              </label>
              <label className="block min-w-0">
                <span className="mb-1.5 block text-xs font-semibold">Date flagged</span>
                <Input type="date" required value={flaggedAt} onChange={(event) => setFlaggedAt(event.target.value)} data-testid="input-payment-flag-date" />
              </label>
            </div>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs font-semibold">Flagged by</span>
              <Input value={flaggedBy} readOnly aria-readonly="true" className="bg-muted/50" data-testid="input-payment-flagged-by" />
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs font-semibold">Remarks</span>
              <Textarea required minLength={1} maxLength={1000} rows={2} value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Describe the issue" data-testid="textarea-payment-flag-remarks" />
            </label>

            {flagType === 'bounced_payment' ? <div className="min-w-0 space-y-4 rounded-xl border border-rose-200/70 bg-rose-50/40 p-3 sm:p-4">
              <p className="text-xs font-bold text-rose-800">Bounced payment details</p>
              <label className="block min-w-0">
                <span className="mb-1.5 block text-xs font-semibold">Bounce reason</span>
                <Input required maxLength={500} value={bounceReason} onChange={(event) => setBounceReason(event.target.value)} placeholder="e.g. Insufficient funds" data-testid="input-payment-bounce-reason" />
              </label>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold">Bounced amount (INR)</span>
                  <Input required type="number" min="0.01" step="0.01" value={bouncedAmount} onChange={(event) => setBouncedAmount(event.target.value)} data-testid="input-payment-bounced-amount" />
                </label>
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold">Bank charges <span className="font-normal text-muted-foreground">(optional)</span></span>
                  <Input type="number" min="0" step="0.01" value={bankCharges} onChange={(event) => setBankCharges(event.target.value)} data-testid="input-payment-bank-charges" />
                </label>
              </div>
            </div> : <div className="min-w-0 space-y-4 rounded-xl border border-rose-200/70 bg-rose-50/40 p-3 sm:p-4">
              <p className="text-xs font-bold text-rose-800">Refusal to pay details</p>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold">Number of follow-ups</span>
                  <Input required type="number" min="1" step="1" value={followUpCount} onChange={(event) => setFollowUpCount(event.target.value)} data-testid="input-payment-follow-up-count" />
                </label>
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold">Last follow-up date</span>
                  <Input required type="date" value={lastFollowUpDate} onChange={(event) => setLastFollowUpDate(event.target.value)} data-testid="input-payment-last-follow-up-date" />
                </label>
              </div>
              <label className="block min-w-0">
                <span className="mb-1.5 block text-xs font-semibold">Follow-up notes</span>
                <Textarea required maxLength={1000} rows={2} value={followUpNotes} onChange={(event) => setFollowUpNotes(event.target.value)} placeholder="Record the follow-up attempts and client response" data-testid="textarea-payment-follow-up-notes" />
              </label>
              <p className="text-[11px] leading-5 text-muted-foreground">The flagged amount is calculated from the order’s current outstanding balance.</p>
            </div>}
          </div>
          <footer className="sticky bottom-0 z-10 grid shrink-0 grid-cols-2 gap-2 border-t border-border/70 bg-background/95 px-4 py-3 sm:flex sm:justify-end sm:px-6">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(false)} data-testid="button-cancel-payment-flag">Cancel</Button>
            <Button type="submit" className="w-full sm:w-auto" disabled={create.isPending} data-testid="button-save-payment-flag">
              {create.isPending ? <LoaderCircle className="animate-spin" size={14} /> : <Flag size={14} />}
              {create.isPending ? 'Saving…' : 'Save flag'}
            </Button>
          </footer>
        </form>
      </div>
    </div>}
  </>;
}