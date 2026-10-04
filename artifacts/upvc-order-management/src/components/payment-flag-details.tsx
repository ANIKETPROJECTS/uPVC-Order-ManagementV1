import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, LoaderCircle, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { PaymentFlag, PaymentFlagUpdate } from '@workspace/api-client-react';
import {
  getListOrderActivityQueryKey,
  getListOrderPaymentFlagsQueryKey,
  getListPaymentFlagsQueryKey,
  useAddPaymentFlagFollowUp,
  useRemovePaymentFlag,
  useResolvePaymentFlag,
  useUpdatePaymentFlag,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PaymentFlagBadge } from '@/components/payment-flag-badge';
import { formatInr, formatIstDate, formatIstDateTime } from '@/lib/formatters';
import { useToast } from '@/hooks/use-toast';

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const flagTypeLabel = (flag: PaymentFlag) => flag.flagType === 'bounced_payment' ? 'Bounced Payment' : 'Refusal to Pay';
const actionLabel = (action: string) => ({
  created: 'Flag created',
  edited: 'Flag edited',
  follow_up_added: 'Follow-up added',
  resolved: 'Flag resolved',
  removed: 'Flag removed',
}[action] ?? action.replaceAll('_', ' '));

export function PaymentFlagDetails({ flag, canEdit, onClose, onFlagUpdated }: { flag: PaymentFlag | null; canEdit: boolean; onClose: () => void; onFlagUpdated: (flag: PaymentFlag) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const update = useUpdatePaymentFlag();
  const addFollowUp = useAddPaymentFlagFollowUp();
  const resolve = useResolvePaymentFlag();
  const remove = useRemovePaymentFlag();
  const [editing, setEditing] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [bounceReason, setBounceReason] = useState('');
  const [bouncedAmount, setBouncedAmount] = useState('');
  const [bankCharges, setBankCharges] = useState('');
  const [followUpCount, setFollowUpCount] = useState('');
  const [lastFollowUpDate, setLastFollowUpDate] = useState('');
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState(today);
  const [newFollowUpNotes, setNewFollowUpNotes] = useState('');
  const [showResolve, setShowResolve] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [resolutionDate, setResolutionDate] = useState(today);
  const [resolutionNotes, setResolutionNotes] = useState('');

  useEffect(() => {
    setEditing(false);
    setShowFollowUp(false);
    setShowResolve(false);
    setConfirmRemove(false);
    setNewFollowUpNotes('');
    setResolutionNotes('');
  }, [flag?.id]);

  if (!flag) return null;
  const refreshRelated = (updated: PaymentFlag) => {
    void queryClient.invalidateQueries({ queryKey: getListPaymentFlagsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListOrderPaymentFlagsQueryKey(updated.orderRecordId) });
    void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(updated.orderRecordId) });
  };
  const beginEdit = () => {
    setRemarks(flag.remarks);
    setBounceReason(flag.bounceReason ?? '');
    setBouncedAmount(flag.bouncedAmount == null ? '' : String(flag.bouncedAmount));
    setBankCharges(flag.bankCharges == null ? '' : String(flag.bankCharges));
    setFollowUpCount(flag.followUpCount == null ? '' : String(flag.followUpCount));
    setLastFollowUpDate(flag.lastFollowUpDate ?? today());
    setFollowUpNotes(flag.followUpNotes ?? '');
    setEditing(true);
  };
  const saveEdit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data: PaymentFlagUpdate = flag.flagType === 'bounced_payment'
      ? { remarks: remarks.trim(), bounceReason: bounceReason.trim(), bouncedAmount: Number(bouncedAmount), bankCharges: bankCharges.trim() ? Number(bankCharges) : null }
      : { remarks: remarks.trim(), followUpCount: Number(followUpCount), lastFollowUpDate, followUpNotes: followUpNotes.trim() };
    update.mutate({ id: flag.id, data }, {
      onSuccess: (updated) => { refreshRelated(updated); onFlagUpdated(updated); toast({ title: 'Flag details saved' }); setEditing(false); },
      onError: () => toast({ title: 'Flag details could not be saved', variant: 'destructive' }),
    });
  };
  const saveFollowUp = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    addFollowUp.mutate({ id: flag.id, data: { followUpDate, notes: newFollowUpNotes.trim() } }, {
      onSuccess: (updated) => { refreshRelated(updated); onFlagUpdated(updated); toast({ title: 'Follow-up added' }); setShowFollowUp(false); setNewFollowUpNotes(''); },
      onError: () => toast({ title: 'Follow-up could not be added', variant: 'destructive' }),
    });
  };
  const saveResolution = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resolve.mutate({ id: flag.id, data: { resolutionDate, resolutionNotes: resolutionNotes.trim() } }, {
      onSuccess: (updated) => { refreshRelated(updated); onFlagUpdated(updated); toast({ title: 'Payment flag resolved' }); setShowResolve(false); },
      onError: () => toast({ title: 'Payment flag could not be resolved', variant: 'destructive' }),
    });
  };
  const removeFlag = () => {
    remove.mutate({ id: flag.id }, {
      onSuccess: (updated) => { refreshRelated(updated); toast({ title: 'Payment flag removed from active tracking' }); onClose(); },
      onError: () => toast({ title: 'Payment flag could not be removed', variant: 'destructive' }),
    });
  };
  const actions = [...(flag.actions ?? [])].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} data-testid="dialog-payment-flag-details-backdrop">
    <section className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:max-h-[88dvh] sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="payment-flag-details-title" data-testid="dialog-payment-flag-details">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-700">Payment issue · {flag.orderId}</p>
          <h2 id="payment-flag-details-title" className="mt-1 font-display text-xl font-bold">{flagTypeLabel(flag)}</h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">{flag.clientName} · {flag.locationName}</p>
        </div>
          <Button type="button" size="icon" variant="ghost" aria-label="Close flag details" onClick={onClose} data-testid="button-close-payment-flag-details"><X size={17} /></Button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-muted/25 p-4">
          <div className="flex items-center gap-2"><PaymentFlagBadge status={flag.status} /><span className="text-xs font-semibold">{flag.status === 'active' ? 'Active tracking' : flag.status === 'resolved' ? 'Resolved' : 'Removed'}</span></div>
          <div className="text-right"><p className="font-display text-lg font-bold tabular-nums" data-testid={`value-flag-detail-amount-${flag.id}`}>{formatInr(flag.flaggedAmount)}</p><p className="text-[10px] text-muted-foreground">Flagged amount snapshot</p></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DetailFact label="Flagged" value={formatIstDateTime(flag.flaggedAt)} testId={`text-flag-date-${flag.id}`} />
          <DetailFact label="Flagged by" value={flag.flaggedBy} testId={`text-flagged-by-${flag.id}`} />
        </div>
        {editing ? <form onSubmit={saveEdit} className="space-y-4 rounded-xl border border-border p-4" data-testid="form-edit-payment-flag">
          <label className="block"><span className="mb-1.5 block text-xs font-semibold">Remarks</span><Textarea required minLength={1} maxLength={1000} rows={3} value={remarks} onChange={(event) => setRemarks(event.target.value)} data-testid="textarea-edit-payment-flag-remarks" /></label>
          {flag.flagType === 'bounced_payment' ? <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-semibold">Bounce reason</span><Input required maxLength={500} value={bounceReason} onChange={(event) => setBounceReason(event.target.value)} data-testid="input-edit-payment-bounce-reason" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold">Bounced amount</span><Input type="number" min="0.01" step="0.01" required value={bouncedAmount} onChange={(event) => setBouncedAmount(event.target.value)} data-testid="input-edit-payment-bounced-amount" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold">Bank charges</span><Input type="number" min="0" step="0.01" value={bankCharges} onChange={(event) => setBankCharges(event.target.value)} data-testid="input-edit-payment-bank-charges" /></label>
          </div> : <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold">Follow-up count</span><Input type="number" min="1" step="1" required value={followUpCount} onChange={(event) => setFollowUpCount(event.target.value)} data-testid="input-edit-payment-follow-up-count" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold">Last follow-up date</span><Input type="date" required value={lastFollowUpDate} onChange={(event) => setLastFollowUpDate(event.target.value)} data-testid="input-edit-payment-last-follow-up-date" /></label>
            <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-semibold">Follow-up notes</span><Textarea required maxLength={1000} rows={2} value={followUpNotes} onChange={(event) => setFollowUpNotes(event.target.value)} data-testid="textarea-edit-payment-follow-up-notes" /></label>
          </div>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditing(false)} data-testid="button-cancel-edit-payment-flag">Cancel</Button><Button type="submit" disabled={update.isPending} data-testid="button-save-edit-payment-flag">{update.isPending ? <LoaderCircle className="animate-spin" size={14} /> : <Check size={14} />} Save changes</Button></div>
        </form> : <section className="space-y-3" data-testid={`flag-details-fields-${flag.id}`}>
          {flag.remarks && <div className="rounded-xl border border-border/70 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Remarks</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6" data-testid={`text-flag-remarks-${flag.id}`}>{flag.remarks}</p></div>}
          {flag.flagType === 'bounced_payment' ? <div className="grid gap-3 sm:grid-cols-3">
            <DetailFact label="Bounce reason" value={flag.bounceReason || 'Not recorded'} testId={`text-bounce-reason-${flag.id}`} />
            <DetailFact label="Bounced amount" value={formatInr(flag.bouncedAmount)} testId={`text-bounced-amount-${flag.id}`} />
            <DetailFact label="Bank charges" value={formatInr(flag.bankCharges)} testId={`text-bank-charges-${flag.id}`} />
          </div> : <div className="grid gap-3 sm:grid-cols-3">
            <DetailFact label="Follow-ups" value={String(flag.followUpCount ?? 0)} testId={`text-follow-up-count-${flag.id}`} />
            <DetailFact label="Last follow-up" value={flag.lastFollowUpDate ? formatIstDate(flag.lastFollowUpDate) : 'Not recorded'} testId={`text-last-follow-up-${flag.id}`} />
            <DetailFact label="Follow-up notes" value={flag.followUpNotes || 'No notes recorded'} testId={`text-follow-up-notes-${flag.id}`} />
          </div>}
          {flag.resolutionDate && <div className="rounded-xl bg-primary/5 p-4" data-testid={`text-flag-resolution-${flag.id}`}><p className="text-[10px] font-bold uppercase tracking-wider text-primary">Resolution · {formatIstDate(flag.resolutionDate)}</p>{flag.resolutionNotes && <p className="mt-2 text-sm leading-5">{flag.resolutionNotes}</p>}</div>}
          {flag.removedAt && <p className="text-xs text-muted-foreground" data-testid={`text-flag-removed-${flag.id}`}>Removed {formatIstDateTime(flag.removedAt)} by {flag.removedBy || 'Former user'}.</p>}
        </section>}

        {showFollowUp && flag.status === 'active' && <form onSubmit={saveFollowUp} className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.035] p-4" data-testid="form-payment-flag-follow-up">
          <h3 className="text-sm font-semibold">Add follow-up</h3>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold">Follow-up date</span><Input type="date" required value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} data-testid="input-payment-flag-follow-up-date" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold">Note</span><Textarea required minLength={1} maxLength={1000} rows={2} value={newFollowUpNotes} onChange={(event) => setNewFollowUpNotes(event.target.value)} data-testid="textarea-payment-flag-follow-up-note" /></label>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setShowFollowUp(false)} data-testid="button-cancel-payment-flag-follow-up">Cancel</Button><Button type="submit" disabled={addFollowUp.isPending} data-testid="button-save-payment-flag-follow-up">{addFollowUp.isPending ? <LoaderCircle className="animate-spin" size={14} /> : <Plus size={14} />} Add follow-up</Button></div>
        </form>}
        {showResolve && flag.status === 'active' && <form onSubmit={saveResolution} className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.035] p-4" data-testid="form-payment-flag-resolution">
          <h3 className="text-sm font-semibold">Resolve flag</h3>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold">Resolution date</span><Input type="date" required value={resolutionDate} onChange={(event) => setResolutionDate(event.target.value)} data-testid="input-payment-flag-resolution-date" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold">Resolution notes</span><Textarea required minLength={1} maxLength={1000} rows={2} value={resolutionNotes} onChange={(event) => setResolutionNotes(event.target.value)} data-testid="textarea-payment-flag-resolution-notes" /></label>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setShowResolve(false)} data-testid="button-cancel-payment-flag-resolution">Cancel</Button><Button type="submit" disabled={resolve.isPending} data-testid="button-confirm-payment-flag-resolution">{resolve.isPending ? <LoaderCircle className="animate-spin" size={14} /> : <Check size={14} />} Mark resolved</Button></div>
        </form>}
        <section className="rounded-xl border border-border/70 p-4" data-testid={`section-flag-action-history-${flag.id}`}>
          <div className="flex items-center gap-2"><CalendarClock size={15} className="text-primary" /><h3 className="text-sm font-semibold">Action history</h3><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px]">{actions.length}</span></div>
          {actions.length ? <ol className="mt-4 space-y-4 border-l border-border pl-4">{actions.map((action) => <li key={action.id} className="relative text-xs text-muted-foreground" data-testid={`row-flag-action-${action.id}`}><span className="absolute -left-[21px] top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" /><p className="font-semibold text-foreground">{actionLabel(action.action)}</p><p className="mt-0.5">{action.actorName} · {formatIstDateTime(action.occurredAt)}</p>{action.summary && <p className="mt-1 leading-5">{action.summary}</p>}</li>)}</ol> : <p className="mt-3 text-xs text-muted-foreground">No actions recorded.</p>}
        </section>
      </div>
      <footer className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-border bg-background/95 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap gap-2">
          {canEdit && flag.status !== 'removed' && !editing && <Button type="button" size="sm" variant="outline" onClick={beginEdit} data-testid="button-edit-payment-flag"><Pencil size={13} /> Edit</Button>}
          {canEdit && flag.status === 'active' && flag.flagType === 'refusal_to_pay' && !editing && <Button type="button" size="sm" variant="outline" onClick={() => { setFollowUpDate(today()); setNewFollowUpNotes(''); setShowFollowUp((value) => !value); }} data-testid="button-open-payment-flag-follow-up"><Plus size={13} /> Add follow-up</Button>}
          {canEdit && flag.status === 'active' && !editing && <Button type="button" size="sm" onClick={() => { setResolutionDate(today()); setResolutionNotes(''); setShowResolve((value) => !value); }} data-testid="button-open-payment-flag-resolution"><Check size={13} /> Mark as resolved</Button>}
        </div>
        <div className="flex gap-2">
          {canEdit && flag.status !== 'removed' && <Button type="button" size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={remove.isPending} onClick={() => setConfirmRemove(true)} data-testid="button-remove-payment-flag"><Trash2 size={13} /> Remove</Button>}
          <Button type="button" size="sm" variant="ghost" onClick={onClose} data-testid="button-dismiss-payment-flag-details">Close</Button>
        </div>
      </footer>
    </section>
    <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
      <AlertDialogContent data-testid="dialog-confirm-remove-payment-flag">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this payment flag?</AlertDialogTitle>
          <AlertDialogDescription>This removes it from active tracking. The flag details and action history remain available for audit.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-remove-payment-flag">Keep flag</AlertDialogCancel>
          <AlertDialogAction disabled={remove.isPending} onClick={removeFlag} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-remove-payment-flag">
            {remove.isPending ? 'Removing…' : 'Remove flag'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function DetailFact({ label, value, testId }: { label: string; value: string; testId: string }) {
  return <div className="min-w-0 rounded-lg border border-border/70 bg-card p-3"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1.5 break-words text-xs font-semibold leading-5" data-testid={testId}>{value}</p></div>;
}