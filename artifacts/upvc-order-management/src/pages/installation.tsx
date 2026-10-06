import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { z } from 'zod';
import {
  ArrowRight, CalendarDays, Check, CircleAlert, ClipboardCheck,
  Copy, MapPin, MessageSquareText, Plus, RefreshCw, Search, ShieldCheck,
  Users, Wrench, X,
} from 'lucide-react';
import {
  getGetOrderQueryKey, getListDispatchOrdersQueryKey, getListInstallationOrdersQueryKey,
  getListInstallationTeamsQueryKey, getListInstallationUsersQueryKey, getListOrderActivityQueryKey,
  useAssignInstallationOrder, useCreateInstallationTeam, useDeleteInstallationTeam,
  useListInstallationOrders, useListInstallationTeams, useListInstallationUsers,
  useUpdateInstallationOrder, useUpdateInstallationTeam,
} from '@workspace/api-client-react';
import type { InstallationOrder, InstallationTeam, InstallationTeamInput, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

const resultSchema = z.object({
  installationStatus: z.enum(['issue', 'installed']),
  installationDate: z.string().min(1, 'Choose a date.'),
  issueReason: z.string().max(2000, 'Keep the reason under 2,000 characters.'),
}).superRefine((v, c) => {
  if (v.installationStatus === 'issue' && !v.issueReason.trim()) c.addIssue({ code: z.ZodIssueCode.custom, path: ['issueReason'], message: 'Add a reason for the issue.' });
});
type ResultValues = z.infer<typeof resultSchema>;
type DraftSubteam = { id?: string; name: string; memberIds: string[] };
type StatusFilter = 'all' | 'pending' | 'issue' | 'installed';

const istDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const localDate = (v?: string | Date | null) => {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(v)) return v.slice(0, 10);
  if (v) {
    const d = v instanceof Date ? v : new Date(v);
    if (!Number.isNaN(d.getTime())) return istDateKey(d);
  }
  return istDateKey();
};
const dateReached = (v: string | null) => Boolean(v && v.slice(0, 10) <= localDate());
const formatDate = (v?: string | null) => {
  if (!v) return 'Not scheduled';
  const d = new Date(`${v.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
};
const canAccess = (user: User, edit = false) => user.roleId === 'master-admin' || user.permissions?.installation === 'edit' || (!edit && user.permissions?.installation === 'view');
const canViewOrders = (user: User) => user.roleId === 'master-admin' || ['edit', 'view'].includes(user.permissions?.['order-hub'] || '');
const readable = (v: string) => v.replaceAll('_', ' ');
const statusName = (s: InstallationOrder['installationStatus']) => s === 'installed' ? 'Installed' : s === 'issue' ? 'Issue reported' : 'Awaiting installation';

function MemberPicker({ members, selected, onChange, disabled, testId }: {
  members: { id: string; name: string; username?: string; roleName?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  testId: string;
}) {
  return <div className="grid gap-1.5 sm:grid-cols-2" data-testid={testId}>
    {members.length === 0 ? <p className="col-span-full rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">No eligible members are available.</p> : members.map((m) => {
      const checked = selected.includes(m.id);
      return <label key={m.id} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition ${checked ? 'border-primary/35 bg-primary/[.045]' : 'border-border bg-background'} ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-primary/25'}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onChange(checked ? selected.filter((id) => id !== m.id) : [...selected, m.id])} className="mt-0.5 accent-[hsl(var(--primary))]" data-testid={`checkbox-${testId}-${m.id}`} />
        <span className="min-w-0"><span className="block truncate text-xs font-semibold">{m.name}</span><span className="block truncate text-[10px] text-muted-foreground">{m.username ? `@${m.username}` : m.roleName || ''}</span></span>
      </label>;
    })}
  </div>;
}

function ResultDialog({ order, canEdit, pending, onClose, onSave }: {
  order: InstallationOrder | null; canEdit: boolean; pending: boolean; onClose: () => void; onSave: (o: InstallationOrder, v: ResultValues) => void;
}) {
  const form = useForm<ResultValues>({ resolver: zodResolver(resultSchema), defaultValues: { installationStatus: 'installed', installationDate: localDate(), issueReason: '' } });
  const outcome = form.watch('installationStatus');
  const mayMarkInstalled = Boolean(order?.scheduledDate && dateReached(order.scheduledDate));
  useEffect(() => {
    if (!order) return;
    form.reset({
      installationStatus: order.installationStatus === 'issue' ? 'issue' : 'installed',
      installationDate: localDate(order.installationDate || order.scheduledDate),
      issueReason: order.issueReason || '',
    });
  }, [form.reset, order?.id, order?.installationDate, order?.installationStatus, order?.issueReason, order?.scheduledDate]);
  return <Dialog open={Boolean(order)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>Installation result</DialogTitle><DialogDescription>{order ? `${order.orderId} · ${order.clientName} · ${order.locationName}` : ''}</DialogDescription></DialogHeader>
      {order && <Form {...form}><form onSubmit={form.handleSubmit((v) => onSave(order, v))} className="space-y-4" data-testid="form-installation-result">
        {!canEdit && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">Your Installation access is view-only.</p>}
        <FormField control={form.control} name="installationStatus" render={({ field }) => <FormItem><FormLabel>Result</FormLabel>
          <Select value={field.value} onValueChange={field.onChange} disabled={!canEdit || order.installationStatus === 'installed'}>
            <FormControl><SelectTrigger data-testid="select-installation-result"><SelectValue /></SelectTrigger></FormControl><SelectContent>
              {mayMarkInstalled && <SelectItem value="installed">Mark installed</SelectItem>}
              {order.installationStatus !== 'installed' && <SelectItem value="issue">Report an issue</SelectItem>}
            </SelectContent>
          </Select><FormMessage />
        </FormItem>} />
        {outcome === 'installed' && !mayMarkInstalled && order.installationStatus !== 'installed' && <p className="rounded-lg border border-border bg-muted/50 p-3 text-xs leading-5 text-muted-foreground" data-testid="text-installation-date-gate">Mark installed becomes available on the scheduled visit date ({formatDate(order.scheduledDate)}).</p>}
        <FormField control={form.control} name="installationDate" render={({ field }) => <FormItem><FormLabel>{outcome === 'issue' ? 'Issue date' : 'Installation date'}</FormLabel><FormControl><Input type="date" {...field} disabled={!canEdit} data-testid="input-installation-date" /></FormControl><FormMessage /></FormItem>} />
        {outcome === 'issue' && <FormField control={form.control} name="issueReason" render={({ field }) => <FormItem><FormLabel>Issue reason</FormLabel><FormControl><Textarea {...field} rows={4} maxLength={2000} disabled={!canEdit} placeholder="Describe what prevented or affected installation…" data-testid="textarea-installation-issue-reason" /></FormControl><FormMessage /></FormItem>} />}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-installation-update">Cancel</Button>{canEdit && <Button type="submit" disabled={pending || (outcome === 'installed' && order.installationStatus !== 'installed' && !mayMarkInstalled)} data-testid="button-save-installation-update">{pending ? 'Saving…' : 'Save result'}</Button>}</DialogFooter>
      </form></Form>}
    </DialogContent>
  </Dialog>;
}

function TeamDialog({ open, team, users, pending, onClose, onSave }: {
  open: boolean; team: InstallationTeam | null; users: { id: string; name: string; username: string; roleName: string }[];
  pending: boolean; onClose: () => void; onSave: (id: string | null, input: InstallationTeamInput) => void;
}) {
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [subteams, setSubteams] = useState<DraftSubteam[]>([]);
  const [subName, setSubName] = useState('');
  const [subMembers, setSubMembers] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(team?.name || '');
    setMemberIds(team?.memberIds || []);
    setSubteams(team?.subteams.map((s) => ({ id: s.id, name: s.name, memberIds: [...s.memberIds] })) || []);
    setSubName(''); setSubMembers([]); setError('');
  }, [open, team]);
  const parentMembers = users.filter((u) => memberIds.includes(u.id));
  const addSubteam = () => {
    if (!subName.trim() || !subMembers.length) { setError('Add a subdivision name and at least one member.'); return; }
    setSubteams((all) => [...all, { name: subName.trim(), memberIds: subMembers }]);
    setSubName(''); setSubMembers([]); setError('');
  };
  return <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
    <DialogHeader><DialogTitle>{team ? 'Edit installation team' : 'Create installation team'}</DialogTitle><DialogDescription>Choose eligible users for the parent team, then assign subdivision members from that selection.</DialogDescription></DialogHeader>
    <div className="space-y-5">
      <label className="block space-y-1.5"><span className="text-xs font-semibold">Team name</span><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="For example, North field crew" data-testid="input-installation-team-name" /></label>
      <section className="space-y-2"><div><h3 className="text-xs font-bold">Parent team members</h3><p className="text-[10px] text-muted-foreground">Eligible Installation users.</p></div>
        <MemberPicker members={users} selected={memberIds} onChange={(ids) => { setMemberIds(ids); setSubteams((prev) => prev.map((s) => ({ ...s, memberIds: s.memberIds.filter((id) => ids.includes(id)) }))); setSubMembers((prev) => prev.filter((id) => ids.includes(id))); }} testId="team-parent-members" />
      </section>
      <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-3 sm:p-4">
        <div className="flex items-center justify-between"><div><h3 className="text-xs font-bold">Subdivisions</h3><p className="text-[10px] text-muted-foreground">Optional crew groupings.</p></div><span className="rounded-full bg-background px-2 py-1 font-mono text-[10px]">{subteams.length}</span></div>
        {subteams.map((s, i) => <div key={s.id || `${s.name}-${i}`} className="space-y-3 rounded-lg border border-border bg-background p-3" data-testid={`row-installation-subteam-${i}`}>
          <div className="flex items-center gap-2"><Input value={s.name} onChange={(e) => setSubteams((prev) => prev.map((item, index) => index === i ? { ...item, name: e.target.value } : item))} maxLength={120} aria-label={`Subdivision ${i + 1} name`} data-testid={`input-installation-subteam-name-${i}`} /><Button type="button" variant="ghost" size="sm" onClick={() => setSubteams((prev) => prev.filter((_, index) => index !== i))} data-testid={`button-remove-subteam-${i}`}><X size={14} /><span className="sr-only">Remove subdivision</span></Button></div>
          <MemberPicker members={parentMembers} selected={s.memberIds} onChange={(ids) => setSubteams((prev) => prev.map((item, index) => index === i ? { ...item, memberIds: ids } : item))} testId={`team-subteam-members-${i}`} />
        </div>)}
        <label className="block space-y-1.5"><span className="text-xs font-semibold">Subdivision name</span><Input value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="For example, East crew" data-testid="input-installation-subteam-name" /></label>
        <div className="space-y-1.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Subdivision members</p><MemberPicker members={parentMembers} selected={subMembers} onChange={setSubMembers} testId="team-subteam-members" /></div>
        <Button type="button" variant="outline" size="sm" onClick={addSubteam} data-testid="button-add-installation-subteam"><Plus size={14} /> Add subdivision</Button>
      </section>
      {error && <p className="text-xs text-destructive" data-testid="text-team-form-error">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-installation-team">Cancel</Button><Button type="button" disabled={pending || !name.trim() || memberIds.length === 0} onClick={() => { if (!name.trim() || !memberIds.length) { setError('Enter a team name and select at least one member.'); return; } if (subteams.some((s) => !s.name.trim() || s.memberIds.length === 0)) { setError('Each subdivision needs a name and at least one selected parent-team member.'); return; } onSave(team?.id || null, { name: name.trim(), memberIds, subteams: subteams.map((s) => ({ ...s, name: s.name.trim() })) }); }} data-testid="button-save-installation-team">{pending ? 'Saving…' : team ? 'Save team' : 'Create team'}</Button></DialogFooter>
    </div>
  </DialogContent></Dialog>;
}

function AssignmentDialog({ order, teams, users, pending, onClose, onSave }: {
  order: InstallationOrder | null; teams: InstallationTeam[]; users: { id: string; name: string; username: string; roleName: string }[];
  pending: boolean; onClose: () => void; onSave: (o: InstallationOrder, input: { teamId: string; subteamId: string | null; scheduledDate: string; memberIds: string[] }) => void;
}) {
  const [teamId, setTeamId] = useState('');
  const [subteamId, setSubteamId] = useState('');
  const [scheduledDate, setScheduledDate] = useState(localDate());
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const team = teams.find((t) => t.id === teamId);
  const subteam = team?.subteams.find((s) => s.id === subteamId);
  const eligible = users.filter((u) => (subteam?.memberIds || team?.memberIds || []).includes(u.id));
  useEffect(() => {
    setTeamId(order?.teamId || teams[0]?.id || '');
    setSubteamId(order?.subteamId || '');
    setScheduledDate(localDate(order?.scheduledDate));
    setMemberIds(order?.assignedMembers.map((m) => m.id) || []);
  }, [order?.id, teams]);
  return <Dialog open={Boolean(order)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-xl">
    <DialogHeader><DialogTitle>{order?.teamId ? 'Change installation assignment' : 'Schedule installation'}</DialogTitle><DialogDescription>{order ? `${order.orderId} · ${order.clientName} · ${order.locationName}` : ''}</DialogDescription></DialogHeader>
    {order && <div className="space-y-4">
      {teams.length === 0 ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">Create an installation team before scheduling an order.</div> : <>
        <label className="block space-y-1.5"><span className="text-xs font-semibold">Installation team</span><Select value={teamId} onValueChange={(v) => { setTeamId(v); setSubteamId(''); setMemberIds([]); }}><SelectTrigger data-testid="select-installation-team"><SelectValue placeholder="Choose a team" /></SelectTrigger><SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></label>
        <label className="block space-y-1.5"><span className="text-xs font-semibold">Subdivision <span className="font-normal text-muted-foreground">optional</span></span><Select value={subteamId || 'none'} onValueChange={(v) => { setSubteamId(v === 'none' ? '' : v); setMemberIds([]); }} disabled={!team || team.subteams.length === 0}><SelectTrigger data-testid="select-installation-subteam"><SelectValue placeholder="Parent team" /></SelectTrigger><SelectContent><SelectItem value="none">Parent team</SelectItem>{team?.subteams.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></label>
        <label className="block space-y-1.5"><span className="text-xs font-semibold">Scheduled date</span><Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} data-testid="input-installation-scheduled-date" /></label>
        <div className="space-y-2"><div className="flex justify-between"><span className="text-xs font-semibold">Assigned members</span><span className="text-[10px] text-muted-foreground">{memberIds.length} selected</span></div><MemberPicker members={eligible} selected={memberIds} onChange={setMemberIds} testId="assignment-members" /></div>
      </>}
      <DialogFooter><Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-installation-assignment">Cancel</Button><Button type="button" disabled={pending || !teamId || !scheduledDate || !memberIds.length} onClick={() => onSave(order, { teamId, subteamId: subteamId || null, scheduledDate, memberIds })} data-testid="button-save-installation-assignment">{pending ? 'Saving…' : 'Save schedule'}</Button></DialogFooter>
    </div>}
  </DialogContent></Dialog>;
}

export default function InstallationPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canView = canAccess(user);
  const canEdit = canAccess(user, true);
  const canOrderView = canViewOrders(user);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [showInstalled, setShowInstalled] = useState(false);
  const [resultOrder, setResultOrder] = useState<InstallationOrder | null>(null);
  const [assignmentOrder, setAssignmentOrder] = useState<InstallationOrder | null>(null);
  const [teamDialog, setTeamDialog] = useState(false);
  const [editingTeam, setEditingTeam] = useState<InstallationTeam | null>(null);
  const ordersQuery = useListInstallationOrders({ query: { enabled: canView, queryKey: getListInstallationOrdersQueryKey() } });
  const teamsQuery = useListInstallationTeams({ query: { enabled: canView && canEdit, queryKey: getListInstallationTeamsQueryKey() } });
  const usersQuery = useListInstallationUsers({ query: { enabled: canView && canEdit, queryKey: getListInstallationUsersQueryKey() } });
  const resultMutation = useUpdateInstallationOrder();
  const assignmentMutation = useAssignInstallationOrder();
  const createTeam = useCreateInstallationTeam();
  const updateTeam = useUpdateInstallationTeam();
  const deleteTeam = useDeleteInstallationTeam();
  const orders = ordersQuery.data || [];
  const teams = teamsQuery.data || [];
  const users = usersQuery.data || [];
  const requestedOrderId = new URLSearchParams(window.location.search).get('order');
  const focusedOrder = requestedOrderId ? orders.find((order) => order.id === requestedOrderId) : undefined;
  const visibleOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (showInstalled !== (o.installationStatus === 'installed')) return false;
      if (filter !== 'all' && o.installationStatus !== filter) return false;
      return !needle || `${o.orderId} ${o.clientName} ${o.locationName} ${o.issueReason || ''} ${o.teamName || ''} ${o.subteamName || ''}`.toLowerCase().includes(needle);
    });
  }, [orders, search, filter, showInstalled]);
  const counts = useMemo(() => ({
    pending: orders.filter((o) => o.installationStatus === 'pending').length,
    issue: orders.filter((o) => o.installationStatus === 'issue').length,
    installed: orders.filter((o) => o.installationStatus === 'installed').length,
  }), [orders]);
  const invalidateOrders = () => {
    void queryClient.invalidateQueries({ queryKey: getListInstallationOrdersQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListDispatchOrdersQueryKey() });
  };
  const saveResult = (order: InstallationOrder, values: ResultValues) => {
    if (!canEdit) return;
    resultMutation.mutate({ id: order.id, data: { installationStatus: values.installationStatus, installationDate: values.installationDate, ...(values.installationStatus === 'issue' ? { issueReason: values.issueReason.trim() } : {}) } }, {
      onSuccess: (updated) => {
        setResultOrder(null); invalidateOrders();
        void queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) });
        void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(order.id) });
        toast({ title: updated.installationStatus === 'installed' ? 'Installation recorded' : 'Issue recorded', description: `${updated.orderId} · ${formatDate(updated.installationDate)}` });
      },
      onError: () => toast({ title: 'Update could not be saved', description: 'Refresh and try again.', variant: 'destructive' }),
    });
  };
  const saveAssignment = (order: InstallationOrder, data: { teamId: string; subteamId: string | null; scheduledDate: string; memberIds: string[] }) => {
    assignmentMutation.mutate({ id: order.id, data }, {
      onSuccess: () => { setAssignmentOrder(null); invalidateOrders(); void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(order.id) }); toast({ title: 'Installation schedule saved', description: `${order.orderId} · ${formatDate(data.scheduledDate)}` }); },
      onError: () => toast({ title: 'Schedule could not be saved', description: 'Refresh and try again.', variant: 'destructive' }),
    });
  };
  const saveTeam = (id: string | null, data: InstallationTeamInput) => {
    const mutationOptions = {
      onSuccess: () => { setTeamDialog(false); setEditingTeam(null); void queryClient.invalidateQueries({ queryKey: getListInstallationTeamsQueryKey() }); void queryClient.invalidateQueries({ queryKey: getListInstallationOrdersQueryKey() }); toast({ title: id ? 'Team updated' : 'Team created' }); },
      onError: () => toast({ title: 'Team could not be saved', description: 'Check the team details and try again.', variant: 'destructive' as const }),
    };
    if (id) updateTeam.mutate({ id, data }, mutationOptions);
    else createTeam.mutate({ data }, mutationOptions);
  };
  const removeTeam = (team: InstallationTeam) => {
    if (!window.confirm(`Delete ${team.name}?`)) return;
    deleteTeam.mutate({ id: team.id }, {
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListInstallationTeamsQueryKey() }); void queryClient.invalidateQueries({ queryKey: getListInstallationOrdersQueryKey() }); toast({ title: 'Team deleted', description: team.name }); },
      onError: () => toast({ title: 'Team could not be deleted', description: 'Refresh and try again.', variant: 'destructive' }),
    });
  };
  const copyAssignmentLink = async (order: InstallationOrder) => {
    const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/installation?order=${encodeURIComponent(order.id)}`;
    try { await navigator.clipboard.writeText(url); toast({ title: 'Assignment link copied', description: 'The link contains only the order record ID.' }); }
    catch { toast({ title: 'Could not copy link', description: 'Clipboard access is unavailable in this browser.', variant: 'destructive' }); }
  };

  return <AppShell user={user} title="Installation" eyebrow="Fulfillment · post-delivery tracking">
    <main className="mx-auto w-full max-w-[1440px] space-y-5 pb-8">
      <section className="order-hub-accent relative overflow-hidden rounded-2xl border border-primary/10 px-5 py-5 shadow-sm md:px-7 md:py-6" data-testid="panel-installation-intro">
        <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-end"><div className="max-w-2xl">
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Fulfillment · service completion</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-[-.05em] md:text-[2.65rem]">Plan the visit. Close the order.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Coordinate field teams for delivered orders, keep the schedule current, and record completion or follow-up issues.</p>
        </div><Link href="/dispatch" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background/80 px-4 text-xs font-bold transition hover:border-primary/35 hover:text-primary" data-testid="link-back-to-dispatch">Dispatch register <ArrowRight size={14} /></Link></div>
      </section>

      {canView && requestedOrderId && <section className="overflow-hidden rounded-xl border border-primary/25 bg-card shadow-sm" aria-label="Focused installation assignment" data-testid="panel-focused-installation-assignment">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 bg-primary/[.035] px-4 py-3 sm:px-5">
          <div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-primary">Shared assignment detail</p><h2 className="mt-1 font-display text-base font-bold">Installation record</h2><p className="mt-0.5 text-[10px] text-muted-foreground">Details are loaded from the protected Installation register.</p></div>
          {focusedOrder?.teamId && <Button type="button" size="sm" variant="outline" onClick={() => void copyAssignmentLink(focusedOrder)} data-testid="button-copy-focused-installation-link"><Copy size={14} /> Copy assignment link</Button>}
        </div>
        <div className="p-4 sm:p-5">
          {ordersQuery.isLoading ? <div className="space-y-2" data-testid="state-focused-installation-loading"><div className="h-5 w-40 animate-pulse rounded bg-muted" /><div className="h-4 w-64 animate-pulse rounded bg-muted" /><div className="h-4 w-48 animate-pulse rounded bg-muted" /></div>
            : ordersQuery.isError ? <div className="flex flex-wrap items-center justify-between gap-3" data-testid="state-focused-installation-error"><p className="text-sm font-semibold">Assignment details could not be loaded.</p><Button type="button" size="sm" variant="outline" onClick={() => void ordersQuery.refetch()} data-testid="button-retry-focused-installation"><RefreshCw size={13} /> Retry</Button></div>
              : !focusedOrder ? <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4" data-testid="state-focused-installation-not-found"><p className="text-sm font-semibold">Installation order not found</p><p className="mt-1 text-xs text-muted-foreground">This record is not present in the delivered-order installation register.</p></div>
                : <div data-testid={`detail-focused-installation-${focusedOrder.id}`}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="font-mono text-lg font-bold tracking-tight" data-testid={`text-focused-order-id-${focusedOrder.id}`}>{focusedOrder.orderId}</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${focusedOrder.teamId ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-900'}`} data-testid={`status-focused-assignment-${focusedOrder.id}`}>{focusedOrder.teamId ? 'Assigned' : 'Not assigned'}</span></div>
                  <p className="mt-1 text-sm font-semibold" data-testid={`text-focused-client-${focusedOrder.id}`}>{focusedOrder.clientName}</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Site</p><p className="mt-1 text-xs font-semibold" data-testid={`text-focused-location-${focusedOrder.id}`}>{focusedOrder.locationName}</p></div>
                    <div><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Window quantity</p><p className="mt-1 text-xs font-semibold" data-testid={`text-focused-window-qty-${focusedOrder.id}`}>{focusedOrder.windowQty}</p></div>
                    <div><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Team / subdivision</p><p className="mt-1 text-xs font-semibold" data-testid={`text-focused-team-${focusedOrder.id}`}>{focusedOrder.teamName ? `${focusedOrder.teamName}${focusedOrder.subteamName ? ` / ${focusedOrder.subteamName}` : ''}` : 'No team assigned'}</p></div>
                    <div><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Scheduled date</p><p className="mt-1 text-xs font-semibold" data-testid={`text-focused-date-${focusedOrder.id}`}>{formatDate(focusedOrder.scheduledDate)}</p></div>
                  </div>
                  <div className="mt-4 border-t border-border/70 pt-3"><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Selected members</p><p className="mt-1 text-xs font-semibold" data-testid={`text-focused-members-${focusedOrder.id}`}>{focusedOrder.assignedMembers.length ? focusedOrder.assignedMembers.map((member) => member.name).join(', ') : 'No members selected'}</p></div>
                </div>}
        </div>
      </section>}

      {!canView && <div className="rounded-xl border border-dashed border-border p-10 text-center" data-testid="state-installation-access-denied"><ShieldCheck size={24} className="mx-auto text-muted-foreground" /><h2 className="mt-3 font-display text-sm font-bold">Installation access required</h2><p className="mt-1 text-xs text-muted-foreground">Ask an administrator for Installation access.</p></div>}
      {canView && <><section aria-label="Installation totals" className="grid grid-cols-3 gap-2 sm:gap-3">
        {([{ key: 'pending', label: 'Awaiting installation', count: counts.pending, tone: 'text-slate-700', icon: CalendarDays }, { key: 'issue', label: 'Issues to follow up', count: counts.issue, tone: 'text-amber-800', icon: CircleAlert }, { key: 'installed', label: 'Previously installed', count: counts.installed, tone: 'text-emerald-800', icon: ClipboardCheck }] as const).map((item) => <button key={item.key} type="button" aria-pressed={!showInstalled && filter === item.key} onClick={() => { setShowInstalled(item.key === 'installed'); setFilter(item.key === 'installed' ? 'all' : filter === item.key ? 'all' : item.key); }} className={`rounded-xl border bg-card px-3 py-3 text-left shadow-sm transition hover:border-primary/30 sm:px-4 sm:py-4 ${!showInstalled && filter === item.key ? 'border-primary/40 ring-2 ring-primary/10' : 'border-border/80'}`} data-testid={`filter-installation-${item.key}`}>
          <div className="flex items-center justify-between gap-2"><span className="truncate text-[9px] font-bold uppercase tracking-[.11em] text-muted-foreground sm:text-[10px]">{item.label}</span><span className="grid h-7 w-7 place-items-center rounded-lg bg-muted/70"><item.icon size={15} className={item.tone} /></span></div><div className={`mt-2 font-display text-2xl font-bold sm:text-3xl ${item.tone}`} data-testid={`metric-installation-${item.key}`}>{ordersQuery.isLoading ? '—' : item.count}</div>
        </button>)}
      </section>

      <Card className="overflow-hidden border-border/80 shadow-sm">
        <div className="flex flex-col justify-between gap-3 border-b border-border/75 p-4 sm:flex-row sm:items-center md:p-5">
          <div><div className="flex items-center gap-2"><span className="h-5 w-1 rounded-full bg-primary" /><h2 className="font-display text-lg font-bold tracking-tight">Installation register</h2><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground" data-testid="text-installation-count">{visibleOrders.length} / {orders.length}</span></div><p className="ml-3 mt-1 text-xs text-muted-foreground">Delivered orders · {showInstalled ? 'Previously installed' : 'Open installation work'}</p></div>
          <div className="flex flex-wrap items-center gap-2">{!canEdit && <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-900"><ShieldCheck size={13} /> View-only</span>}{canEdit && <Button type="button" variant="outline" size="sm" onClick={() => { setEditingTeam(null); setTeamDialog(true); }} data-testid="button-create-installation-team"><Users size={14} /> Manage teams</Button>}</div>
        </div>
        <div className="flex flex-col gap-3 border-b border-border/60 p-3 sm:flex-row sm:items-center">
          <label className="relative block w-full sm:max-w-md"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find order, client, location, or team" aria-label="Search installation orders" className="h-10 pl-9 text-xs" data-testid="input-installation-search" /></label>
          <button type="button" onClick={() => { setShowInstalled((v) => !v); setFilter('all'); }} aria-pressed={showInstalled} className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold ${showInstalled ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border bg-background'}`} data-testid="tab-previously-installed">{showInstalled ? <Check size={14} /> : <ClipboardCheck size={14} />}Previously installed</button>
        </div>
        {canEdit && <section className="border-b border-border/60 bg-muted/20 px-4 py-3" data-testid="panel-installation-teams">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Installation teams</p><p className="mt-0.5 text-xs text-muted-foreground">{teamsQuery.isLoading ? 'Loading teams…' : teamsQuery.isError ? 'Team list unavailable' : `${teams.length} configured`}{' · '}{usersQuery.isLoading ? 'Loading eligible users…' : usersQuery.isError ? 'Eligible users unavailable' : `${users.length} eligible users`}</p>
            {usersQuery.isError && <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void usersQuery.refetch()} data-testid="button-retry-installation-users"><RefreshCw size={13} /> Retry eligible users</Button>}
          </div>
            {teamsQuery.isError && <Button type="button" size="sm" variant="outline" onClick={() => void teamsQuery.refetch()} data-testid="button-retry-installation-teams"><RefreshCw size={13} /> Retry teams</Button>}
            <div className="flex flex-wrap gap-2">{teams.map((team) => <span key={team.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-semibold" data-testid={`chip-installation-team-${team.id}`}>{team.name}<button type="button" className="ml-1 text-primary underline underline-offset-2" onClick={() => { setEditingTeam(team); setTeamDialog(true); }} data-testid={`button-edit-installation-team-${team.id}`}>Edit</button><button type="button" className="ml-1 text-destructive underline underline-offset-2 disabled:opacity-50" onClick={() => removeTeam(team)} disabled={deleteTeam.isPending} data-testid={`button-delete-installation-team-${team.id}`}>Delete</button></span>)}</div>
          </div>
        </section>}
        <CardContent className="space-y-3 p-3 sm:p-4">
          {ordersQuery.isLoading ? <div className="space-y-3" aria-label="Loading installation orders" data-testid="state-installation-loading">{[0, 1, 2].map((n) => <div key={n} className="h-36 animate-pulse rounded-xl border border-border/70 bg-card/70" />)}</div>
            : ordersQuery.isError ? <div className="grid min-h-56 place-items-center rounded-xl border border-destructive/20 bg-destructive/[.035] p-6 text-center" data-testid="state-installation-error"><div><CircleAlert size={24} className="mx-auto text-destructive" /><h3 className="mt-3 font-display text-sm font-bold">Installation records unavailable</h3><p className="mt-1 text-xs text-muted-foreground">Delivered orders could not be loaded.</p><Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void ordersQuery.refetch()} data-testid="button-retry-installation"><RefreshCw size={13} /> Try again</Button></div></div>
            : visibleOrders.length === 0 ? <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-border bg-muted/15 p-6 text-center" data-testid="state-installation-empty"><div><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-secondary text-primary"><Wrench size={20} /></div><h3 className="mt-3 font-display text-sm font-bold">{orders.length ? 'No orders match this view' : 'No delivered orders yet'}</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{orders.length ? 'Try another search or change the status view.' : 'Orders appear after Dispatch marks them delivered.'}</p>{orders.length > 0 && <Button type="button" size="sm" variant="outline" className="mt-4" onClick={() => { setSearch(''); setFilter('all'); setShowInstalled(false); }} data-testid="button-reset-installation-filters">Clear filters</Button>}</div></div>
            : visibleOrders.map((order) => <article key={order.id} className="grid gap-4 rounded-xl border border-border/75 bg-background/70 p-4 transition hover:border-primary/25 hover:bg-primary/[.015] md:grid-cols-[minmax(180px,1.2fr)_minmax(150px,.9fr)_minmax(180px,1fr)_minmax(160px,1fr)_auto] md:items-center" data-testid={`row-installation-order-${order.id}`}>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2">{canOrderView ? <Link href={`/order-hub/${encodeURIComponent(order.id)}`} className="font-mono text-sm font-bold tracking-tight text-primary underline-offset-4 hover:underline" data-testid={`link-installation-order-${order.id}`}>{order.orderId}</Link> : <p className="font-mono text-sm font-bold" data-testid={`text-order-id-${order.id}`}>{order.orderId}</p>}<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold capitalize text-emerald-800 ring-1 ring-inset ring-emerald-200/80">{readable(order.dispatchStatus)}</span></div>
                <p className="mt-1 truncate text-xs font-semibold" data-testid={`text-installation-client-${order.id}`}>{order.clientName}</p><p className="mt-1 flex items-center gap-1 truncate text-[10px] text-muted-foreground" data-testid={`text-installation-location-${order.id}`}><MapPin size={11} />{order.locationName}</p><p className="mt-1 text-[10px] font-medium text-muted-foreground" data-testid={`text-installation-window-qty-${order.id}`}>{order.windowQty} windows</p>
              </div>
              <div className="space-y-1.5"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset ${order.installationStatus === 'installed' ? 'bg-emerald-100 text-emerald-800 ring-emerald-200' : order.installationStatus === 'issue' ? 'bg-amber-100 text-amber-900 ring-amber-200' : 'bg-slate-100 text-slate-700 ring-slate-200'}`} data-testid={`status-installation-${order.id}`}>{statusName(order.installationStatus)}</span>
                <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><CalendarDays size={12} />Scheduled · <strong className="font-semibold text-foreground">{formatDate(order.scheduledDate)}</strong></p>
                <p className="text-[10px] text-muted-foreground" data-testid={`text-installation-association-${order.id}`}>Team · <span className="font-semibold text-foreground">{order.teamName || 'Unassigned'}{order.subteamName ? ` / ${order.subteamName}` : ''}</span></p>
              </div>
              <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[.1em] text-muted-foreground">Assigned to</p><p className="mt-1 text-[11px] font-semibold leading-5" data-testid={`text-installation-assignees-${order.id}`}>{order.assignedMembers.length ? order.assignedMembers.map((m) => m.name).join(', ') : 'No members selected'}</p>{order.installationStatus === 'issue' && <p className="mt-2 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-[11px] leading-5 text-amber-950" data-testid={`text-installation-issue-${order.id}`}>{order.issueReason}</p>}</div>
              <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2 md:border-0 md:bg-transparent md:px-0"><div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[.1em] text-muted-foreground">Visit date</p><p className="mt-0.5 text-xs font-bold tabular-nums">{formatDate(order.scheduledDate)}</p></div><CalendarDays size={15} className="ml-auto text-primary md:hidden" /></div>
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                {canEdit && order.installationStatus !== 'installed' && <Button type="button" size="sm" variant={order.teamId ? 'outline' : 'default'} className="h-9 text-[11px]" disabled={assignmentMutation.isPending} onClick={() => setAssignmentOrder(order)} data-testid={`button-assign-installation-${order.id}`}>{order.teamId ? 'Change schedule' : 'Assign team'}<ArrowRight size={13} /></Button>}
                {canView && order.teamId && <Button type="button" size="sm" variant="outline" className="h-9 px-2.5" onClick={() => void copyAssignmentLink(order)} aria-label={`Copy installation link for ${order.orderId}`} data-testid={`button-copy-installation-link-${order.id}`}><Copy size={14} /><span className="sr-only">Copy link</span></Button>}
                {canEdit && order.installationStatus !== 'installed' && (order.installationStatus === 'issue' || order.scheduledDate && dateReached(order.scheduledDate)) && <Button type="button" size="sm" className="h-9 text-[11px]" onClick={() => setResultOrder(order)} disabled={resultMutation.isPending} data-testid={`button-update-installation-${order.id}`}>{order.installationStatus === 'issue' ? 'Record result' : 'Mark installed'}<Check size={13} /></Button>}
                {canEdit && order.installationStatus !== 'installed' && order.installationStatus !== 'issue' && (!order.scheduledDate || !dateReached(order.scheduledDate)) && <span className="max-w-32 text-right text-[10px] leading-4 text-muted-foreground" data-testid={`text-mark-installed-locked-${order.id}`}>Completion opens on visit date</span>}
                {canEdit && order.installationStatus === 'installed' && <Button type="button" size="sm" variant="outline" className="h-9 text-[11px]" onClick={() => setResultOrder(order)} data-testid={`button-update-installation-${order.id}`}>Edit date</Button>}
                {order.installationStatus === 'installed' && canOrderView && <Link href={`/order-hub/${encodeURIComponent(order.id)}?tab=grievances`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[11px] font-semibold transition hover:border-primary/35 hover:text-primary" data-testid={`link-installation-grievance-${order.id}`}><MessageSquareText size={13} /> Add grievance</Link>}
              </div>
            </article>)}
        </CardContent>
      </Card>
      <p className="px-1 text-[10px] text-muted-foreground">Installation issues stay on this register. Customer grievances after installation remain in the order’s Grievances tab.</p>
      </>}
    </main>
    <ResultDialog order={resultOrder} canEdit={canEdit} pending={resultMutation.isPending} onClose={() => { setResultOrder(null); resultMutation.reset(); }} onSave={saveResult} />
    <AssignmentDialog order={assignmentOrder} teams={teams} users={users} pending={assignmentMutation.isPending} onClose={() => { setAssignmentOrder(null); assignmentMutation.reset(); }} onSave={saveAssignment} />
    <TeamDialog open={teamDialog} team={editingTeam} users={users} pending={createTeam.isPending || updateTeam.isPending} onClose={() => { setTeamDialog(false); setEditingTeam(null); }} onSave={saveTeam} />
  </AppShell>;
}
