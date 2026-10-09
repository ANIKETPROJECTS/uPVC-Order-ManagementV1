import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { z } from 'zod';
import { QRCodeCanvas } from 'qrcode.react';
import {
  ArrowRight, ArrowUpDown, CalendarDays, Check, CircleAlert, ClipboardCheck,
  Copy, Download, FileText, LayoutGrid, List, MapPin, MessageSquareText, QrCode,
  RefreshCw, Search, ShieldCheck, Upload, Wrench,
} from 'lucide-react';
import {
  getGetOrderQueryKey, getListDispatchOrdersQueryKey, getListInstallationOrdersQueryKey,
  getListInstallationTeamsQueryKey, getListInstallationUsersQueryKey, getListOrderActivityQueryKey,
  useAssignInstallationOrder, useUnassignInstallationOrder,
  useListInstallationOrders, useListInstallationTeams, useListInstallationUsers,
  useUpdateInstallationOrder, useUploadInstallationDrawing, useDeleteInstallationDrawing,
} from '@workspace/api-client-react';
import type { InstallationOrder, InstallationTeam, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { getInstallationStatusUrl } from '@/lib/order-qr';
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
type StatusFilter = 'all' | 'pending' | 'issue' | 'installed';
type AssignmentFilter = 'all' | 'assigned' | 'unassigned';
type RegisterSort = 'scheduled-asc' | 'scheduled-desc' | 'client-asc' | 'order-asc';
type RegisterView = 'list' | 'grid';

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

function MemberPicker({ members, selected, onChange, testId }: {
  members: { id: string; name: string; username?: string; roleName?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  testId: string;
}) {
  return <div className="grid gap-1.5 sm:grid-cols-2" data-testid={testId}>
    {members.length === 0 ? <p className="col-span-full rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">No eligible members are available.</p> : members.map((member) => {
      const checked = selected.includes(member.id);
      return <label key={member.id} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition ${checked ? 'border-primary/35 bg-primary/[.045]' : 'border-border bg-background hover:border-primary/25'}`}>
        <input type="checkbox" checked={checked} onChange={() => onChange(checked ? selected.filter((id) => id !== member.id) : [...selected, member.id])} className="mt-0.5 accent-[hsl(var(--primary))]" data-testid={`checkbox-${testId}-${member.id}`} />
        <span className="min-w-0"><span className="block truncate text-xs font-semibold">{member.name}</span><span className="block truncate text-[10px] text-muted-foreground">{member.username ? `@${member.username}` : member.roleName || ''}</span></span>
      </label>;
    })}
  </div>;
}

function ResultDialog({ order, canEdit, pending, onClose, onSave }: {
  order: InstallationOrder | null; canEdit: boolean; pending: boolean; onClose: () => void; onSave: (o: InstallationOrder, v: ResultValues) => void;
}) {
  const form = useForm<ResultValues>({ resolver: zodResolver(resultSchema), defaultValues: { installationStatus: 'installed', installationDate: localDate(), issueReason: '' } });
  const outcome = form.watch('installationStatus');
  const mayMarkInstalled = Boolean(order?.teamId && order.scheduledDate && dateReached(order.scheduledDate));
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
        {outcome === 'installed' && !mayMarkInstalled && order.installationStatus !== 'installed' && <p className="rounded-lg border border-border bg-muted/50 p-3 text-xs leading-5 text-muted-foreground" data-testid="text-installation-date-gate">{order.teamId ? `Mark installed becomes available on the scheduled visit date (${formatDate(order.scheduledDate)}).` : `Assign an installation team before marking this order installed. The saved visit date is ${formatDate(order.scheduledDate)}.`}</p>}
        <FormField control={form.control} name="installationDate" render={({ field }) => <FormItem><FormLabel>{outcome === 'issue' ? 'Issue date' : 'Installation date'}</FormLabel><FormControl><Input type="date" {...field} disabled={!canEdit} data-testid="input-installation-date" /></FormControl><FormMessage /></FormItem>} />
        {outcome === 'issue' && <FormField control={form.control} name="issueReason" render={({ field }) => <FormItem><FormLabel>Issue reason</FormLabel><FormControl><Textarea {...field} rows={4} maxLength={2000} disabled={!canEdit} placeholder="Describe what prevented or affected installation…" data-testid="textarea-installation-issue-reason" /></FormControl><FormMessage /></FormItem>} />}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-installation-update">Cancel</Button>{canEdit && <Button type="submit" disabled={pending || (outcome === 'installed' && order.installationStatus !== 'installed' && !mayMarkInstalled)} data-testid="button-save-installation-update">{pending ? 'Saving…' : 'Save result'}</Button>}</DialogFooter>
      </form></Form>}
    </DialogContent>
  </Dialog>;
}

function AssignmentDialog({ order, teams, users, directoryReady, directoryError, pending, unassignPending, drawingPending, drawingDeletePending, onUploadDrawing, onDeleteDrawing, onClose, onSave, onUnassign, onRetryDirectory }: {
  order: InstallationOrder | null; teams: InstallationTeam[]; users: { id: string; name: string; username: string; roleName: string }[];
  directoryReady: boolean; directoryError: boolean; pending: boolean; unassignPending: boolean; onClose: () => void;
  drawingPending: boolean; drawingDeletePending: boolean;
  onUploadDrawing: (o: InstallationOrder, file: File) => void; onDeleteDrawing: (o: InstallationOrder) => void;
  onSave: (o: InstallationOrder, input: { teamId: string; subteamId: string | null; scheduledDate: string; memberIds: string[]; actualSquareFootage: number | null }) => void;
  onUnassign: (o: InstallationOrder) => void; onRetryDirectory: () => void;
}) {
  const [teamId, setTeamId] = useState('');
  const [subteamId, setSubteamId] = useState('');
  const [scheduledDate, setScheduledDate] = useState(localDate());
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [actualSquareFootage, setActualSquareFootage] = useState('');
  const initializedForOrder = useRef<string | null>(null);
  const team = teams.find((t) => t.id === teamId);
  const subteam = team?.subteams.find((s) => s.id === subteamId);
  const eligible = users.filter((u) => (subteam?.memberIds || team?.memberIds || []).includes(u.id));
  const memberIdsFor = (candidateTeam: InstallationTeam | undefined, candidateSubteamId = '') => {
    const candidateSubteam = candidateTeam?.subteams.find((candidate) => candidate.id === candidateSubteamId);
    const groupMemberIds = candidateSubteam?.memberIds || candidateTeam?.memberIds || [];
    return users.filter((user) => groupMemberIds.includes(user.id)).map((user) => user.id);
  };
  useEffect(() => {
    if (!order) {
      initializedForOrder.current = null;
      return;
    }
    if (!directoryReady || directoryError || initializedForOrder.current === order.id) return;
    const nextTeamId = order.teamId || teams[0]?.id || '';
    const nextSubteamId = order.teamId ? order.subteamId || '' : '';
    const selectedTeam = teams.find((candidate) => candidate.id === nextTeamId);
    const groupMemberIds = memberIdsFor(selectedTeam, nextSubteamId);
    const savedMemberIds = order.assignedMembers.map((member) => member.id).filter((id) => groupMemberIds.includes(id));
    setTeamId(nextTeamId);
    setSubteamId(nextSubteamId);
    setScheduledDate(localDate(order.scheduledDate));
    setMemberIds(savedMemberIds.length ? savedMemberIds : groupMemberIds);
    setActualSquareFootage(order.actualSquareFootage === null ? '' : String(order.actualSquareFootage));
    initializedForOrder.current = order.id;
  }, [order?.id, teams, users, directoryReady, directoryError]);
  return <Dialog open={Boolean(order)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-xl">
    <DialogHeader><DialogTitle>{order?.teamId ? 'Change installation assignment' : 'Schedule installation'}</DialogTitle><DialogDescription>{order ? `${order.orderId} · ${order.clientName} · ${order.locationName}` : ''}</DialogDescription></DialogHeader>
    {order && <div className="space-y-4">
      {directoryError ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/[.035] p-3"><p className="text-xs text-muted-foreground">Installation teams or member lists could not be loaded.</p><Button type="button" size="sm" variant="outline" onClick={onRetryDirectory} data-testid="button-retry-installation-directory"><RefreshCw size={13} /> Retry</Button></div> : !directoryReady ? <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">Loading installation teams and eligible members…</div> : teams.length === 0 ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">Create an installation team before scheduling an order.</div> : <>
        <label className="block space-y-1.5"><span className="text-xs font-semibold">Installation team</span><Select value={teamId} onValueChange={(v) => { const nextTeam = teams.find((candidate) => candidate.id === v); setTeamId(v); setSubteamId(''); setMemberIds(memberIdsFor(nextTeam)); }}><SelectTrigger data-testid="select-installation-team"><SelectValue placeholder="Choose a team" /></SelectTrigger><SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></label>
        <label className="block space-y-1.5"><span className="text-xs font-semibold">Subdivision <span className="font-normal text-muted-foreground">optional</span></span><Select value={subteamId || 'none'} onValueChange={(v) => { const nextSubteamId = v === 'none' ? '' : v; setSubteamId(nextSubteamId); setMemberIds(memberIdsFor(team, nextSubteamId)); }} disabled={!team || team.subteams.length === 0}><SelectTrigger data-testid="select-installation-subteam"><SelectValue placeholder="Parent team" /></SelectTrigger><SelectContent><SelectItem value="none">Parent team</SelectItem>{team?.subteams.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></label>
        <label className="block space-y-1.5"><span className="text-xs font-semibold">Scheduled date</span><Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} data-testid="input-installation-scheduled-date" /></label>
        <div className="space-y-2"><div className="flex justify-between"><span className="text-xs font-semibold">Assigned members</span><span className="text-[10px] text-muted-foreground">{memberIds.length} selected</span></div><MemberPicker members={eligible} selected={memberIds} onChange={setMemberIds} testId="assignment-members" /></div>
         <label className="block max-w-xs space-y-1.5"><span className="text-xs font-semibold">Actual area <span className="font-normal text-muted-foreground">optional · sq ft</span></span><Input type="number" min="0" step="0.01" inputMode="decimal" value={actualSquareFootage} onChange={(event) => setActualSquareFootage(event.target.value)} placeholder="Enter measured area" data-testid="input-installation-actual-sqft" /></label>
         <section className="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-3.5" data-testid="panel-installation-drawing-admin">
           <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold">Site drawing</p><p className="mt-1 max-w-sm text-[10px] leading-4 text-muted-foreground">Attach the latest PDF for this job. The field share page will show the current file.</p></div>{order.drawingFilename && <span className="inline-flex max-w-[220px] items-center gap-1.5 truncate rounded-full bg-background px-2.5 py-1 text-[10px] font-semibold" data-testid={`text-installation-drawing-${order.id}`}><FileText size={12} className="shrink-0 text-primary" />{order.drawingFilename}</span>}</div>
           <div className="flex flex-wrap items-center gap-2">
             <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold transition hover:border-primary/35 hover:text-primary" data-testid="label-upload-installation-drawing"><Upload size={14} />{order.drawingFilename ? 'Replace PDF' : 'Upload PDF'}<input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={drawingPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUploadDrawing(order, file); event.currentTarget.value = ''; }} data-testid="input-installation-drawing-pdf" /></label>
              {order.drawingFilename && <><a href={`${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/installation/orders/${encodeURIComponent(order.id)}/drawing`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:border-primary/35" data-testid="link-preview-installation-drawing">Preview</a><a href={`${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/installation/orders/${encodeURIComponent(order.id)}/drawing?download=1`} download={order.drawingFilename} className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:border-primary/35" data-testid="link-download-admin-installation-drawing">Download</a><Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={drawingDeletePending} onClick={() => onDeleteDrawing(order)} data-testid="button-delete-installation-drawing">{drawingDeletePending ? 'Removing…' : 'Delete PDF'}</Button></>}
             {drawingPending && <span className="text-[10px] font-semibold text-primary" data-testid="status-installation-drawing-uploading">Uploading drawing…</span>}
           </div>
            {order.drawingFilename && <iframe title={`Preview ${order.drawingFilename}`} src={`${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/installation/orders/${encodeURIComponent(order.id)}/drawing`} className="h-56 w-full rounded-lg border border-border bg-background" data-testid="preview-installation-drawing" />}
         </section>
      </>}
        <DialogFooter>{order.teamId && <Button type="button" variant="destructive" className="mr-auto" disabled={pending || unassignPending || drawingPending || drawingDeletePending} onClick={() => onUnassign(order)} data-testid="button-unassign-installation-team">{unassignPending ? 'Unassigning…' : 'Unassign team'}</Button>}<Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-installation-assignment">Cancel</Button><Button type="button" disabled={pending || unassignPending || drawingPending || drawingDeletePending || !directoryReady || directoryError || !teamId || !scheduledDate || !eligible.length || !memberIds.length} onClick={() => onSave(order, { teamId, subteamId: subteamId || null, scheduledDate, memberIds, actualSquareFootage: actualSquareFootage.trim() ? Number(actualSquareFootage) : null })} data-testid="button-save-installation-assignment">{pending ? 'Saving…' : 'Save schedule'}</Button></DialogFooter>
    </div>}
  </DialogContent></Dialog>;
}

function CompletedDrawingDialog({ order, pending, deleting, onClose, onUpload, onDelete }: {
  order: InstallationOrder | null; pending: boolean; deleting: boolean; onClose: () => void;
  onUpload: (order: InstallationOrder, file: File) => void; onDelete: (order: InstallationOrder) => void;
}) {
  if (!order) return null;
  const drawingUrl = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/installation/orders/${encodeURIComponent(order.id)}/drawing`;
  return <Dialog open={Boolean(order)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-3xl" data-testid="dialog-completed-installation-drawing">
      <DialogHeader>
        <DialogTitle>Manage installation drawing</DialogTitle>
        <DialogDescription>{order.orderId} · {order.clientName} · {order.locationName}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <div><p className="text-xs font-semibold">Actual area</p><p className="mt-1 text-sm font-bold">{order.actualSquareFootage === null ? 'Not recorded' : `${order.actualSquareFootage.toLocaleString('en-IN')} sq ft`}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold transition hover:border-primary/35 hover:text-primary" data-testid="label-upload-completed-installation-drawing"><Upload size={14} />{order.drawingFilename ? 'Replace PDF' : 'Upload PDF'}<input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={pending} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(order, file); event.currentTarget.value = ''; }} data-testid="input-completed-installation-drawing" /></label>
            {order.drawingFilename && <>
              <a href={drawingUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:border-primary/35" data-testid="link-view-completed-installation-drawing">Preview PDF</a>
              <a href={`${drawingUrl}?download=1`} download={order.drawingFilename} className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:border-primary/35" data-testid="link-download-completed-installation-drawing">Download</a>
              <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={deleting} onClick={() => onDelete(order)} data-testid="button-delete-completed-installation-drawing">{deleting ? 'Removing…' : 'Delete PDF'}</Button>
            </>}
          </div>
        </div>
        {order.drawingFilename
          ? <iframe title={`Preview ${order.drawingFilename}`} src={drawingUrl} className="h-[min(64vh,620px)] w-full rounded-lg border border-border bg-background" data-testid="preview-completed-installation-drawing" />
          : <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-border bg-muted/15 p-6 text-center"><div><FileText size={22} className="mx-auto text-muted-foreground" /><p className="mt-2 text-sm font-semibold">No drawing attached</p><p className="mt-1 text-xs text-muted-foreground">Upload a PDF for the team’s shared job page.</p></div></div>}
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose} data-testid="button-close-completed-installation-drawing">Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function InstallationPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canView = canAccess(user);
  const canEdit = canAccess(user, true);
  const canOrderView = canViewOrders(user);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('all');
  const [sort, setSort] = useState<RegisterSort>('scheduled-asc');
  const [view, setView] = useState<RegisterView>('list');
  const [showInstalled, setShowInstalled] = useState(false);
  const [resultOrder, setResultOrder] = useState<InstallationOrder | null>(null);
  const [assignmentOrder, setAssignmentOrder] = useState<InstallationOrder | null>(null);
  const [drawingOrder, setDrawingOrder] = useState<InstallationOrder | null>(null);
  const [qrOrder, setQrOrder] = useState<InstallationOrder | null>(null);
  const [shareQrOrder, setShareQrOrder] = useState<InstallationOrder | null>(null);
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const shareQrContainerRef = useRef<HTMLDivElement>(null);
  const ordersQuery = useListInstallationOrders({ query: { enabled: canView, queryKey: getListInstallationOrdersQueryKey() } });
  const teamsQuery = useListInstallationTeams({ query: { enabled: canView && canEdit, queryKey: getListInstallationTeamsQueryKey() } });
  const usersQuery = useListInstallationUsers({ query: { enabled: canView && canEdit, queryKey: getListInstallationUsersQueryKey() } });
  const resultMutation = useUpdateInstallationOrder();
  const assignmentMutation = useAssignInstallationOrder();
  const unassignMutation = useUnassignInstallationOrder();
  const uploadDrawingMutation = useUploadInstallationDrawing();
  const deleteDrawingMutation = useDeleteInstallationDrawing();
  const orders = ordersQuery.data || [];
  const teams = teamsQuery.data || [];
  const users = usersQuery.data || [];
  const directoryReady = (teamsQuery.isSuccess || teamsQuery.isError) && (usersQuery.isSuccess || usersQuery.isError);
  const directoryError = teamsQuery.isError || usersQuery.isError;
  const requestedOrderId = new URLSearchParams(window.location.search).get('order');
  const requestedStatusUpdate = new URLSearchParams(window.location.search).get('updateStatus') === '1';
  const focusedOrder = requestedOrderId ? orders.find((order) => order.id === requestedOrderId) : undefined;
  useEffect(() => {
    if (!requestedStatusUpdate || !requestedOrderId || !canEdit || !ordersQuery.isSuccess) return;
    const target = orders.find((order) => order.id === requestedOrderId);
    if (!target) return;
    setResultOrder(target);
    const params = new URLSearchParams(window.location.search);
    params.delete('updateStatus');
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    );
  }, [requestedStatusUpdate, requestedOrderId, canEdit, ordersQuery.isSuccess, orders]);
  const visibleOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = orders.filter((o) => {
      if (showInstalled !== (o.installationStatus === 'installed')) return false;
      if (filter !== 'all' && o.installationStatus !== filter) return false;
      if (assignmentFilter === 'assigned' && !o.teamId) return false;
      if (assignmentFilter === 'unassigned' && o.teamId) return false;
      return !needle || `${o.orderId} ${o.clientName} ${o.locationName} ${o.issueReason || ''} ${o.teamName || ''} ${o.subteamName || ''}`.toLowerCase().includes(needle);
    });
    return filtered.sort((left, right) => {
      if (sort === 'client-asc') return left.clientName.localeCompare(right.clientName) || left.orderId.localeCompare(right.orderId);
      if (sort === 'order-asc') return left.orderId.localeCompare(right.orderId);
      const leftDate = left.scheduledDate?.slice(0, 10) || '';
      const rightDate = right.scheduledDate?.slice(0, 10) || '';
      if (!leftDate || !rightDate) return leftDate ? -1 : rightDate ? 1 : left.orderId.localeCompare(right.orderId);
      const dateOrder = leftDate.localeCompare(rightDate);
      return (sort === 'scheduled-desc' ? -dateOrder : dateOrder) || left.orderId.localeCompare(right.orderId);
    });
  }, [orders, search, filter, showInstalled, assignmentFilter, sort]);
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
  const saveAssignment = (order: InstallationOrder, data: { teamId: string; subteamId: string | null; scheduledDate: string; memberIds: string[]; actualSquareFootage: number | null }) => {
    assignmentMutation.mutate({ id: order.id, data }, {
      onSuccess: () => { setAssignmentOrder(null); invalidateOrders(); void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(order.id) }); toast({ title: 'Installation schedule saved', description: `${order.orderId} · ${formatDate(data.scheduledDate)}` }); },
      onError: () => toast({ title: 'Schedule could not be saved', description: 'Refresh and try again.', variant: 'destructive' }),
    });
  };
  const unassignTeam = (order: InstallationOrder) => {
    if (!canEdit || !order.teamId || order.installationStatus === 'installed') return;
    const teamLabel = `${order.teamName || 'the assigned team'}${order.subteamName ? ` / ${order.subteamName}` : ''}`;
    const scheduledDateLabel = order.scheduledDate ? ` The visit date (${formatDate(order.scheduledDate)}) will be retained.` : '';
    if (!window.confirm(`Unassign ${order.orderId} from ${teamLabel}? The subdivision and assigned members will be cleared, and the order will remain active in Installation.${scheduledDateLabel}`)) return;
    unassignMutation.mutate({ id: order.id }, {
      onSuccess: () => {
        setAssignmentOrder(null);
        invalidateOrders();
        void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(order.id) });
        toast({ title: 'Installation team unassigned', description: `${order.orderId} remains in Installation; its visit date was retained.` });
      },
      onError: () => toast({ title: 'Team could not be unassigned', description: 'Refresh and try again.', variant: 'destructive' }),
    });
  };
  const copyInstallationLink = async (order: InstallationOrder, updateStatus = false) => {
    const url = updateStatus
      ? getInstallationStatusUrl(order.id)
      : order.shareToken
        ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/installation/share/${encodeURIComponent(order.shareToken)}`
        : '';
    if (!url) {
      toast({ title: 'Shared job link is not available', description: 'Save the team assignment to create its share link.', variant: 'destructive' });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: updateStatus ? 'Status update link copied' : 'Assignment link copied',
        description: updateStatus
          ? 'Sign-in and Installation edit access are required to save a status change.'
          : 'This read-only job page can be opened without signing in.',
      });
    }
    catch { toast({ title: 'Could not copy link', description: 'Clipboard access is unavailable in this browser.', variant: 'destructive' }); }
  };
  const downloadInstallationQr = () => {
    const canvas = qrContainerRef.current?.querySelector('canvas');
    if (!canvas || !qrOrder) return;
    const anchor = document.createElement('a');
    anchor.href = canvas.toDataURL('image/png');
    anchor.download = `${qrOrder.orderId.replace(/[^a-zA-Z0-9._-]/g, '-')}-installation-status-qr.png`;
    anchor.click();
  };
  const downloadShareQr = () => {
    const canvas = shareQrContainerRef.current?.querySelector('canvas');
    if (!canvas || !shareQrOrder) return;
    const anchor = document.createElement('a');
    anchor.href = canvas.toDataURL('image/png');
    anchor.download = `${shareQrOrder.orderId.replace(/[^a-zA-Z0-9._-]/g, '-')}-installation-share-qr.png`;
    anchor.click();
  };
  const uploadDrawing = (order: InstallationOrder, file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast({ title: 'PDF files only', description: 'Choose a PDF drawing to attach to this job.', variant: 'destructive' });
      return;
    }
    uploadDrawingMutation.mutate({ id: order.id, filename: encodeURIComponent(file.name), data: file }, {
      onSuccess: (drawing) => {
        setAssignmentOrder((current) => current?.id === order.id
          ? { ...current, drawingFilename: drawing.filename, drawingSizeBytes: drawing.sizeBytes }
          : current);
        setDrawingOrder((current) => current?.id === order.id
          ? { ...current, drawingFilename: drawing.filename, drawingSizeBytes: drawing.sizeBytes }
          : current);
        void queryClient.invalidateQueries({ queryKey: getListInstallationOrdersQueryKey() });
        toast({ title: 'Drawing uploaded', description: drawing.filename });
      },
      onError: (error: unknown) => toast({ title: 'Drawing could not be uploaded', description: error instanceof Error ? error.message : 'Refresh and try again.', variant: 'destructive' }),
    });
  };
  const deleteDrawing = (order: InstallationOrder) => {
    if (!window.confirm(`Remove the drawing for ${order.orderId}?`)) return;
    deleteDrawingMutation.mutate({ id: order.id }, {
      onSuccess: () => {
        setAssignmentOrder((current) => current?.id === order.id
          ? { ...current, drawingFilename: null, drawingSizeBytes: null }
          : current);
        setDrawingOrder((current) => current?.id === order.id
          ? { ...current, drawingFilename: null, drawingSizeBytes: null }
          : current);
        void queryClient.invalidateQueries({ queryKey: getListInstallationOrdersQueryKey() });
        toast({ title: 'Drawing removed', description: order.orderId });
      },
      onError: (error: unknown) => toast({ title: 'Drawing could not be removed', description: error instanceof Error ? error.message : 'Refresh and try again.', variant: 'destructive' }),
    });
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
          {focusedOrder?.teamId && <>
            {focusedOrder.installationStatus !== 'installed' && <Button type="button" size="sm" variant="outline" onClick={() => setQrOrder(focusedOrder)} data-testid="button-show-focused-installation-qr"><QrCode size={14} /> Status QR</Button>}
            {focusedOrder.shareToken && <><Button type="button" size="sm" variant="outline" onClick={() => setShareQrOrder(focusedOrder)} data-testid="button-show-focused-installation-share-qr"><QrCode size={14} /> Job QR</Button><Button type="button" size="sm" variant="outline" onClick={() => void copyInstallationLink(focusedOrder)} data-testid="button-copy-focused-installation-link"><Copy size={14} /> Copy job link</Button></>}
          </>}
        </div>
        <div className="p-4 sm:p-5">
          {ordersQuery.isLoading ? <div className="space-y-2" data-testid="state-focused-installation-loading"><div className="h-5 w-40 animate-pulse rounded bg-muted" /><div className="h-4 w-64 animate-pulse rounded bg-muted" /><div className="h-4 w-48 animate-pulse rounded bg-muted" /></div>
            : ordersQuery.isError ? <div className="flex flex-wrap items-center justify-between gap-3" data-testid="state-focused-installation-error"><p className="text-sm font-semibold">Assignment details could not be loaded.</p><Button type="button" size="sm" variant="outline" onClick={() => void ordersQuery.refetch()} data-testid="button-retry-focused-installation"><RefreshCw size={13} /> Retry</Button></div>
              : !focusedOrder ? <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4" data-testid="state-focused-installation-not-found"><p className="text-sm font-semibold">Installation order not found</p><p className="mt-1 text-xs text-muted-foreground">This record is not present in the delivered-order installation register.</p></div>
                : <div data-testid={`detail-focused-installation-${focusedOrder.id}`}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="font-mono text-lg font-bold tracking-tight" data-testid={`text-focused-order-id-${focusedOrder.id}`}>{focusedOrder.orderId}</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${focusedOrder.teamId ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-900'}`} data-testid={`status-focused-assignment-${focusedOrder.id}`}>{focusedOrder.teamId ? 'Assigned' : 'Not assigned'}</span><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${focusedOrder.installationStatus === 'installed' ? 'bg-emerald-100 text-emerald-800' : focusedOrder.installationStatus === 'issue' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`} data-testid={`status-focused-installation-${focusedOrder.id}`}>{statusName(focusedOrder.installationStatus)}</span></div>
                  <p className="mt-1 text-sm font-semibold" data-testid={`text-focused-client-${focusedOrder.id}`}>{focusedOrder.clientName}</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Site</p><p className="mt-1 text-xs font-semibold" data-testid={`text-focused-location-${focusedOrder.id}`}>{focusedOrder.locationName}</p></div>
                    <div><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Window quantity</p><p className="mt-1 text-xs font-semibold" data-testid={`text-focused-window-qty-${focusedOrder.id}`}>{focusedOrder.windowQty}</p></div>
                    <div><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Team / subdivision</p><p className="mt-1 text-xs font-semibold" data-testid={`text-focused-team-${focusedOrder.id}`}>{focusedOrder.teamName ? `${focusedOrder.teamName}${focusedOrder.subteamName ? ` / ${focusedOrder.subteamName}` : ''}` : 'No team assigned'}</p></div>
                    <div><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Scheduled date</p><p className="mt-1 text-xs font-semibold" data-testid={`text-focused-date-${focusedOrder.id}`}>{formatDate(focusedOrder.scheduledDate)}</p></div>
                  </div>
                  <div className="mt-4 border-t border-border/70 pt-3"><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Selected members</p><p className="mt-1 text-xs font-semibold" data-testid={`text-focused-members-${focusedOrder.id}`}>{focusedOrder.assignedMembers.length ? focusedOrder.assignedMembers.map((member) => member.name).join(', ') : 'No members selected'}</p></div>
                   {canEdit && <div className="mt-4 flex justify-end"><Button type="button" size="sm" onClick={() => setResultOrder(focusedOrder)} data-testid={`button-focused-update-installation-${focusedOrder.id}`}>{focusedOrder.installationStatus === 'installed' ? 'Edit installation date' : 'Update installation status'}<ArrowRight size={13} /></Button></div>}
                </div>}
        </div>
      </section>}

      {!canView && <div className="rounded-xl border border-dashed border-border p-10 text-center" data-testid="state-installation-access-denied"><ShieldCheck size={24} className="mx-auto text-muted-foreground" /><h2 className="mt-3 font-display text-sm font-bold">Installation access required</h2><p className="mt-1 text-xs text-muted-foreground">Ask an administrator for Installation access.</p></div>}
      {canView && <><section aria-label="Installation totals" className="grid grid-cols-3 gap-2 sm:gap-3">
        {([{ key: 'pending', label: 'Upcoming visits', count: counts.pending, tone: 'text-slate-700', icon: CalendarDays }, { key: 'issue', label: 'Issues to follow up', count: counts.issue, tone: 'text-amber-800', icon: CircleAlert }, { key: 'installed', label: 'Completed jobs', count: counts.installed, tone: 'text-emerald-800', icon: ClipboardCheck }] as const).map((item) => {
          const active = item.key === 'installed' ? showInstalled : !showInstalled && filter === item.key;
          return <button key={item.key} type="button" aria-pressed={active} onClick={() => {
            if (item.key === 'installed') {
              setShowInstalled((current) => !current);
              setFilter('all');
            } else {
              setShowInstalled(false);
              setFilter((current) => current === item.key ? 'all' : item.key);
            }
          }} className={`rounded-xl border bg-card px-3 py-3 text-left shadow-sm transition hover:border-primary/30 sm:px-4 sm:py-4 ${active ? 'border-primary/40 ring-2 ring-primary/10' : 'border-border/80'}`} data-testid={`filter-installation-${item.key}`}>
            <div className="flex items-center justify-between gap-2"><span className="truncate text-[9px] font-bold uppercase tracking-[.11em] text-muted-foreground sm:text-[10px]">{item.label}</span><span className="grid h-7 w-7 place-items-center rounded-lg bg-muted/70"><item.icon size={15} className={item.tone} /></span></div><div className={`mt-2 font-display text-2xl font-bold sm:text-3xl ${item.tone}`} data-testid={`metric-installation-${item.key}`}>{ordersQuery.isLoading ? '—' : item.count}</div>
          </button>;
        })}
      </section>

      <Card className="overflow-hidden border-border/80 shadow-sm">
        <div className="flex flex-col justify-between gap-3 border-b border-border/75 p-4 sm:flex-row sm:items-center md:p-5">
          <div><div className="flex items-center gap-2"><span className="h-5 w-1 rounded-full bg-primary" /><h2 className="font-display text-lg font-bold tracking-tight">Installation register</h2><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground" data-testid="text-installation-count">{visibleOrders.length} / {orders.length}</span></div><p className="ml-3 mt-1 text-xs text-muted-foreground">Delivered orders · {showInstalled ? 'Completed jobs' : 'Upcoming and follow-up work'}</p></div>
            <div className="flex flex-wrap items-center gap-2">{!canEdit && <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-900"><ShieldCheck size={13} /> View-only</span>}{canEdit && <Link href="/installation/teams" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold transition hover:border-primary/35 hover:text-primary" data-testid="link-manage-installation-teams">Manage teams <ArrowRight size={13} /></Link>}</div>
        </div>
        <div className="flex flex-col gap-3 border-b border-border/60 p-3 xl:flex-row xl:items-center xl:justify-between">
          <label className="relative block w-full xl:max-w-sm xl:flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find order, client, location, or team" aria-label="Search installation orders" className="h-10 pl-9 text-xs" data-testid="input-installation-search" /></label>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={assignmentFilter} onValueChange={(value) => setAssignmentFilter(value as AssignmentFilter)}>
              <SelectTrigger aria-label="Filter by team assignment" className="h-10 w-[150px] text-xs" data-testid="select-installation-assignment-filter"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All assignments</SelectItem><SelectItem value="assigned">Assigned teams</SelectItem><SelectItem value="unassigned">Unassigned only</SelectItem></SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => setSort(value as RegisterSort)}>
              <SelectTrigger aria-label="Sort installation orders" className="h-10 w-[170px] text-xs" data-testid="select-installation-sort"><ArrowUpDown size={13} className="mr-1 shrink-0 text-muted-foreground" /><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="scheduled-asc">Visit date: soonest</SelectItem><SelectItem value="scheduled-desc">Visit date: latest</SelectItem><SelectItem value="client-asc">Client: A–Z</SelectItem><SelectItem value="order-asc">Order ID: A–Z</SelectItem></SelectContent>
            </Select>
            <div role="group" aria-label="Installation register layout" className="inline-flex h-10 items-center rounded-lg border border-border bg-background p-1">
              <Button type="button" size="icon" variant={view === 'list' ? 'secondary' : 'ghost'} className="h-8 w-8" onClick={() => setView('list')} aria-label="List layout" aria-pressed={view === 'list'} data-testid="button-installation-list-view"><List size={15} /></Button>
              <Button type="button" size="icon" variant={view === 'grid' ? 'secondary' : 'ghost'} className="h-8 w-8" onClick={() => setView('grid')} aria-label="Grid layout" aria-pressed={view === 'grid'} data-testid="button-installation-grid-view"><LayoutGrid size={15} /></Button>
            </div>
              <div role="tablist" aria-label="Installation status" className="inline-flex h-10 items-center rounded-lg border border-border bg-background p-1">
                <button type="button" role="tab" aria-selected={!showInstalled} aria-controls="installation-register-panel" onClick={() => { setShowInstalled(false); setFilter('all'); }} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-semibold transition sm:px-3 sm:text-xs ${!showInstalled ? 'bg-primary/10 text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} data-testid="tab-upcoming-installations"><CalendarDays size={13} /><span>Upcoming Installations</span></button>
                <button type="button" role="tab" aria-selected={showInstalled} aria-controls="installation-register-panel" onClick={() => { setShowInstalled(true); setFilter('all'); }} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-semibold transition sm:px-3 sm:text-xs ${showInstalled ? 'bg-primary/10 text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} data-testid="tab-completed-installations"><ClipboardCheck size={13} /><span>Completed Installations</span></button>
              </div>
          </div>
        </div>
         <CardContent id="installation-register-panel" role="tabpanel" aria-label={showInstalled ? 'Completed installations' : 'Upcoming installations'} className={view === 'grid' ? 'p-3 sm:p-4' : 'space-y-3 p-3 sm:p-4'}>
          {ordersQuery.isLoading ? <div className={view === 'grid' ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-3'} aria-label="Loading installation orders" data-testid="state-installation-loading">{[0, 1, 2].map((n) => <div key={n} className="h-36 animate-pulse rounded-xl border border-border/70 bg-card/70" />)}</div>
            : ordersQuery.isError ? <div className="grid min-h-56 place-items-center rounded-xl border border-destructive/20 bg-destructive/[.035] p-6 text-center" data-testid="state-installation-error"><div><CircleAlert size={24} className="mx-auto text-destructive" /><h3 className="mt-3 font-display text-sm font-bold">Installation records unavailable</h3><p className="mt-1 text-xs text-muted-foreground">Delivered orders could not be loaded.</p><Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void ordersQuery.refetch()} data-testid="button-retry-installation"><RefreshCw size={13} /> Try again</Button></div></div>
            : visibleOrders.length === 0 ? <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-border bg-muted/15 p-6 text-center" data-testid="state-installation-empty"><div><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-secondary text-primary"><Wrench size={20} /></div><h3 className="mt-3 font-display text-sm font-bold">{orders.length ? 'No orders match this view' : 'No delivered orders yet'}</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{orders.length ? 'Try another search or change the status, assignment, or sort filters.' : 'Orders appear after Dispatch marks them delivered.'}</p>{orders.length > 0 && <Button type="button" size="sm" variant="outline" className="mt-4" onClick={() => { setSearch(''); setFilter('all'); setShowInstalled(false); setAssignmentFilter('all'); setSort('scheduled-asc'); }} data-testid="button-reset-installation-filters">Clear filters</Button>}</div></div>
            : <div className={view === 'grid' ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-3'}>
              {visibleOrders.map((order) => <article key={order.id} className={`${view === 'grid' ? 'flex h-full flex-col gap-4' : 'grid gap-4 md:grid-cols-[minmax(180px,1.2fr)_minmax(150px,.9fr)_minmax(180px,1fr)_minmax(160px,1fr)_auto] md:items-center'} rounded-xl border border-border/75 bg-background/70 p-4 transition hover:border-primary/25 hover:bg-primary/[.015]`} data-testid={`row-installation-order-${order.id}`}>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2">{canOrderView ? <Link href={`/order-hub/${encodeURIComponent(order.id)}`} className="font-mono text-sm font-bold tracking-tight text-primary underline-offset-4 hover:underline" data-testid={`link-installation-order-${order.id}`}>{order.orderId}</Link> : <p className="font-mono text-sm font-bold" data-testid={`text-order-id-${order.id}`}>{order.orderId}</p>}<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold capitalize text-emerald-800 ring-1 ring-inset ring-emerald-200/80">{readable(order.dispatchStatus)}</span></div>
                <p className="mt-1 truncate text-xs font-semibold" data-testid={`text-installation-client-${order.id}`}>{order.clientName}</p><p className="mt-1 flex items-center gap-1 truncate text-[10px] text-muted-foreground" data-testid={`text-installation-location-${order.id}`}><MapPin size={11} />{order.locationName}</p><p className="mt-1 text-[10px] font-medium text-muted-foreground" data-testid={`text-installation-window-qty-${order.id}`}>{order.windowQty} windows</p>
              </div>
              <div className="space-y-1.5"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset ${order.installationStatus === 'installed' ? 'bg-emerald-100 text-emerald-800 ring-emerald-200' : order.installationStatus === 'issue' ? 'bg-amber-100 text-amber-900 ring-amber-200' : 'bg-slate-100 text-slate-700 ring-slate-200'}`} data-testid={`status-installation-${order.id}`}>{statusName(order.installationStatus)}</span>
                <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><CalendarDays size={12} />Scheduled · <strong className="font-semibold text-foreground">{formatDate(order.scheduledDate)}</strong></p>
                <p className="text-[10px] text-muted-foreground" data-testid={`text-installation-association-${order.id}`}>Team · <span className="font-semibold text-foreground">{order.teamName || 'Unassigned'}{order.subteamName ? ` / ${order.subteamName}` : ''}</span></p>
              </div>
              <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[.1em] text-muted-foreground">Assigned to</p><p className="mt-1 text-[11px] font-semibold leading-5" data-testid={`text-installation-assignees-${order.id}`}>{order.assignedMembers.length ? order.assignedMembers.map((m) => m.name).join(', ') : 'No members selected'}</p>{order.installationStatus === 'issue' && <p className="mt-2 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-[11px] leading-5 text-amber-950" data-testid={`text-installation-issue-${order.id}`}>{order.issueReason}</p>}</div>
              <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2 md:border-0 md:bg-transparent md:px-0"><div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[.1em] text-muted-foreground">Visit date</p><p className="mt-0.5 text-xs font-bold tabular-nums">{formatDate(order.scheduledDate)}</p></div><CalendarDays size={15} className="ml-auto text-primary md:hidden" /></div>
              <div className={`flex flex-wrap items-center gap-2 ${view === 'grid' ? 'mt-auto border-t border-border/70 pt-3' : 'md:justify-end'}`}>
                {canEdit && order.installationStatus !== 'installed' && <Button type="button" size="sm" variant={order.teamId ? 'outline' : 'default'} className="h-9 text-[11px]" disabled={assignmentMutation.isPending || unassignMutation.isPending} onClick={() => setAssignmentOrder(order)} data-testid={`button-assign-installation-${order.id}`}>{order.teamId ? 'Change schedule' : 'Assign team'}<ArrowRight size={13} /></Button>}
                {canEdit && order.installationStatus === 'installed' && <Button type="button" size="sm" variant="outline" className="h-9 text-[11px]" onClick={() => setDrawingOrder(order)} data-testid={`button-manage-completed-installation-drawing-${order.id}`}><FileText size={13} />Drawing</Button>}
                {canView && order.teamId && order.installationStatus !== 'installed' && <Button type="button" size="sm" variant="outline" className="h-9 px-2.5" onClick={() => setQrOrder(order)} aria-label={`Show installation status QR for ${order.orderId}`} title="Show installation status QR" data-testid={`button-show-installation-qr-${order.id}`}><QrCode size={14} /><span className="sr-only">Status QR</span></Button>}
                 {canView && order.teamId && order.shareToken && <>
                   <Button type="button" size="sm" variant="outline" className="h-9 px-2.5" onClick={() => setShareQrOrder(order)} aria-label={`Show public job QR for ${order.orderId}`} data-testid={`button-show-installation-share-qr-${order.id}`}><QrCode size={14} /><span className="sr-only">Job QR</span></Button>
                   <Button type="button" size="sm" variant="outline" className="h-9 px-2.5" onClick={() => void copyInstallationLink(order)} aria-label={`Copy public installation link for ${order.orderId}`} data-testid={`button-copy-installation-link-${order.id}`}><Copy size={14} /><span className="sr-only">Copy job link</span></Button>
                 </>}
                {canEdit && order.installationStatus !== 'installed' && (order.installationStatus === 'issue' || order.teamId && order.scheduledDate && dateReached(order.scheduledDate)) && <Button type="button" size="sm" className="h-9 text-[11px]" onClick={() => setResultOrder(order)} disabled={resultMutation.isPending} data-testid={`button-update-installation-${order.id}`}>{order.installationStatus === 'issue' ? 'Record result' : 'Mark installed'}<Check size={13} /></Button>}
                {canEdit && order.installationStatus !== 'installed' && order.installationStatus !== 'issue' && <span className="max-w-36 text-right text-[10px] leading-4 text-muted-foreground" data-testid={`text-mark-installed-locked-${order.id}`}>{order.teamId ? 'Completion opens on visit date' : 'Assign a team before marking installed'}</span>}
                {canEdit && order.installationStatus === 'installed' && <Button type="button" size="sm" variant="outline" className="h-9 text-[11px]" onClick={() => setResultOrder(order)} data-testid={`button-update-installation-${order.id}`}>Edit date</Button>}
                {order.installationStatus === 'installed' && canOrderView && <Link href={`/order-hub/${encodeURIComponent(order.id)}?tab=grievances`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[11px] font-semibold transition hover:border-primary/35 hover:text-primary" data-testid={`link-installation-grievance-${order.id}`}><MessageSquareText size={13} /> Add grievance</Link>}
              </div>
            </article>)}
            </div>
          }
        </CardContent>
      </Card>
      <p className="px-1 text-[10px] text-muted-foreground">Installation issues stay on this register. Customer grievances after installation remain in the order’s Grievances tab.</p>
      </>}
    </main>
    <ResultDialog order={resultOrder} canEdit={canEdit} pending={resultMutation.isPending} onClose={() => { setResultOrder(null); resultMutation.reset(); }} onSave={saveResult} />
    <AssignmentDialog order={assignmentOrder} teams={teams} users={users} directoryReady={directoryReady} directoryError={directoryError} pending={assignmentMutation.isPending} unassignPending={unassignMutation.isPending} drawingPending={uploadDrawingMutation.isPending} drawingDeletePending={deleteDrawingMutation.isPending} onUploadDrawing={uploadDrawing} onDeleteDrawing={deleteDrawing} onClose={() => { setAssignmentOrder(null); assignmentMutation.reset(); unassignMutation.reset(); }} onSave={saveAssignment} onUnassign={unassignTeam} onRetryDirectory={() => { void teamsQuery.refetch(); void usersQuery.refetch(); }} />
    <CompletedDrawingDialog order={drawingOrder} pending={uploadDrawingMutation.isPending} deleting={deleteDrawingMutation.isPending} onClose={() => setDrawingOrder(null)} onUpload={uploadDrawing} onDelete={deleteDrawing} />
    <Dialog open={Boolean(qrOrder)} onOpenChange={(open) => { if (!open) setQrOrder(null); }}>
      <DialogContent className="max-w-md" data-testid="dialog-installation-status-qr">
        <DialogHeader><DialogTitle>Installation status QR</DialogTitle><DialogDescription>{qrOrder ? `Scan to open the status update for ${qrOrder.orderId}. Sign-in and Installation edit access are required to save changes.` : 'Scan to open an installation status update.'}</DialogDescription></DialogHeader>
        {qrOrder && <div className="flex flex-col items-center gap-4 rounded-xl border border-border/70 bg-muted/15 p-4">
          <div ref={qrContainerRef} className="rounded-xl border border-border bg-white p-3" data-testid="installation-status-qr-code">
            <QRCodeCanvas value={getInstallationStatusUrl(qrOrder.id)} size={220} level="H" includeMargin aria-label={`Installation status QR for ${qrOrder.orderId}`} />
          </div>
          <div className="w-full space-y-1 text-center">
            <p className="font-mono text-sm font-bold">{qrOrder.orderId}</p>
            <p className="text-xs font-semibold">{qrOrder.clientName} · {qrOrder.locationName}</p>
            <p className="text-[11px] text-muted-foreground">{qrOrder.windowQty} windows · {qrOrder.teamName}{qrOrder.subteamName ? ` / ${qrOrder.subteamName}` : ''} · Visit {formatDate(qrOrder.scheduledDate)}</p>
            <p className="text-[11px] font-semibold text-primary">Current status: {statusName(qrOrder.installationStatus)}</p>
          </div>
        </div>}
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={() => setQrOrder(null)} data-testid="button-close-installation-qr">Close</Button>
          <div className="flex flex-wrap justify-end gap-2">
            {qrOrder && <Button type="button" variant="outline" onClick={() => void copyInstallationLink(qrOrder, true)} data-testid="button-copy-installation-status-link"><Copy size={14} />Copy update link</Button>}
            <Button type="button" onClick={downloadInstallationQr} disabled={!qrOrder} data-testid="button-download-installation-status-qr"><Download size={14} />Download QR</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(shareQrOrder)} onOpenChange={(open) => { if (!open) setShareQrOrder(null); }}>
      <DialogContent className="max-w-md" data-testid="dialog-installation-share-qr">
        <DialogHeader><DialogTitle>Public job QR</DialogTitle><DialogDescription>{shareQrOrder ? `Share read-only installation details for ${shareQrOrder.orderId}. This page opens without an account.` : 'Scan to open shared installation details.'}</DialogDescription></DialogHeader>
        {shareQrOrder?.shareToken && <div className="flex flex-col items-center gap-4 rounded-xl border border-border/70 bg-muted/15 p-4">
          <div ref={shareQrContainerRef} className="rounded-xl border border-border bg-white p-3" data-testid="installation-share-qr-code">
            <QRCodeCanvas value={`${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/installation/share/${encodeURIComponent(shareQrOrder.shareToken)}`} size={220} level="H" includeMargin aria-label={`Public installation QR for ${shareQrOrder.orderId}`} />
          </div>
          <div className="w-full space-y-1 text-center"><p className="font-mono text-sm font-bold">{shareQrOrder.orderId}</p><p className="text-xs font-semibold">{shareQrOrder.clientName} · {shareQrOrder.locationName}</p><p className="text-[11px] text-muted-foreground">{shareQrOrder.teamName}{shareQrOrder.subteamName ? ` / ${shareQrOrder.subteamName}` : ''} · Visit {formatDate(shareQrOrder.scheduledDate)}</p><p className="mt-3 break-all rounded-lg bg-background px-3 py-2 font-mono text-[10px] text-muted-foreground" data-testid="text-installation-share-url">{`${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/installation/share/${encodeURIComponent(shareQrOrder.shareToken)}`}</p></div>
        </div>}
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={() => setShareQrOrder(null)} data-testid="button-close-installation-share-qr">Close</Button>
          <div className="flex flex-wrap justify-end gap-2">
            {shareQrOrder && <Button type="button" variant="outline" onClick={() => void copyInstallationLink(shareQrOrder)} data-testid="button-copy-installation-share-link"><Copy size={14} />Copy job link</Button>}
            <Button type="button" onClick={downloadShareQr} disabled={!shareQrOrder} data-testid="button-download-installation-share-qr"><Download size={14} />Download QR</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </AppShell>;
}
