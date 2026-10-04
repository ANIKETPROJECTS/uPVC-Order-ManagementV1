import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Moon, Send, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { getGetPushConfigQueryKey, getGetQuotationApprovalSettingsQueryKey, useGetPushConfig, useGetQuotationApprovalSettings, useSendTestNotification, useUpdateQuotationApprovalSettings } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

type SettingsDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; canManageApprover: boolean };
export function SettingsDialog({ open, onOpenChange, canManageApprover }: SettingsDialogProps) {
  const { setTheme, theme } = useTheme();
  const activeTheme = theme === 'light' ? 'light' : 'dark';
  const settings = useGetQuotationApprovalSettings({ query: { queryKey: getGetQuotationApprovalSettingsQueryKey(), enabled: open && canManageApprover, refetchOnWindowFocus: true } });
  const pushConfig = useGetPushConfig({ query: { queryKey: getGetPushConfigQueryKey(), enabled: open && canManageApprover } });
  const update = useUpdateQuotationApprovalSettings();
  const test = useSendTestNotification();
  const client = useQueryClient();
  const { toast } = useToast();
  const [approverId, setApproverId] = useState('');
  useEffect(() => { if (settings.data) setApproverId(settings.data.approverUserId || 'unassigned'); }, [settings.data]);
  const saveApprover = () => update.mutate({ data: { approverUserId: approverId === 'unassigned' ? null : approverId } }, {
    onSuccess: () => { void client.invalidateQueries({ queryKey: getGetQuotationApprovalSettingsQueryKey() }); toast({ title: 'Approver updated', description: settings.data?.candidates.find((candidate) => candidate.id === approverId)?.name || 'No approver assigned' }); },
    onError: () => toast({ title: 'Could not update approver', description: 'Please try again.', variant: 'destructive' }),
  });
  const choiceClass = (selected: boolean) => `flex min-h-20 w-full items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card text-card-foreground hover:bg-muted'}`;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-testid="dialog-settings">
      <DialogHeader><DialogTitle>Settings</DialogTitle><DialogDescription>Manage the quoting desk appearance and approval delivery.</DialogDescription></DialogHeader>
      <section className="space-y-3">
        <div><h3 className="text-sm font-semibold">Appearance</h3><p className="mt-1 text-xs text-muted-foreground">Your choice is saved on this device.</p></div>
        <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Theme">
          <button type="button" onClick={() => setTheme('light')} aria-pressed={activeTheme === 'light'} className={choiceClass(activeTheme === 'light')} data-testid="button-theme-light"><span className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><Sun size={19}/></span><span><span className="block text-sm font-semibold">Light</span><span className="mt-0.5 block text-[11px] text-muted-foreground">Light sidebar and heroes</span></span></span>{activeTheme === 'light' && <Check size={17} className="text-primary"/>}</button>
          <button type="button" onClick={() => setTheme('dark')} aria-pressed={activeTheme === 'dark'} className={choiceClass(activeTheme === 'dark')} data-testid="button-theme-dark"><span className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><Moon size={19}/></span><span><span className="block text-sm font-semibold">Dark</span><span className="mt-0.5 block text-[11px] text-muted-foreground">Dark sidebar and heroes</span></span></span>{activeTheme === 'dark' && <Check size={17} className="text-primary"/>}</button>
        </div>
      </section>
      {canManageApprover && <section className="space-y-3 border-t border-border pt-4">
        <div><h3 className="text-sm font-semibold">Quotation approver</h3><p className="mt-1 text-xs text-muted-foreground">Drafts with a rate override are routed to this person.</p></div>
        {settings.isLoading ? <div className="h-10 animate-pulse rounded-lg bg-muted"/> : settings.isError ? <div className="flex items-center justify-between text-xs text-destructive"><span>Approver settings unavailable.</span><Button size="sm" variant="outline" onClick={() => void settings.refetch()}>Retry</Button></div> : <>
          <div className="flex gap-2"><Select value={approverId} onValueChange={setApproverId}><SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder="Choose approver"/></SelectTrigger><SelectContent><SelectItem value="unassigned">No approver assigned</SelectItem>{settings.data?.candidates.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.roleName}</SelectItem>)}</SelectContent></Select><Button disabled={update.isPending || !approverId} onClick={saveApprover}>{update.isPending ? 'Saving…' : 'Save'}</Button></div>
          <p className="text-[11px] text-muted-foreground">Current: {settings.data?.approverName || 'No approver assigned'}</p>
        </>}
      </section>}
      {canManageApprover && <section className="space-y-3 border-t border-border pt-4">
        <div><h3 className="text-sm font-semibold">Device notifications</h3><p className="mt-1 text-xs text-muted-foreground">Send a test push to this browser to confirm delivery.</p></div>
        {pushConfig.data?.enabled === false && <p className="text-xs text-muted-foreground">Browser push is not configured for this app yet.</p>}
        <Button variant="outline" disabled={test.isPending || pushConfig.isLoading || pushConfig.data?.enabled !== true} onClick={() => test.mutate(undefined, { onSuccess: () => toast({ title: 'Test notification sent', description: 'Check this device for the push.' }), onError: () => toast({ title: 'Test push failed', description: 'Enable push for this device first.', variant: 'destructive' }) })}><Send size={14}/>{test.isPending ? 'Sending…' : 'Send test push to this device'}</Button>
      </section>}
    </DialogContent>
  </Dialog>;
}