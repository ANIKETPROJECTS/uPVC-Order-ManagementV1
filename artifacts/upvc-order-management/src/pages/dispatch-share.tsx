import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { ArrowLeft, CircleAlert, MapPin, PackageCheck, Truck } from 'lucide-react';
import {
  getGetDispatchByTokenQueryKey,
  getGetDispatchSummaryQueryKey,
  getListDispatchRecordsQueryKey,
  getListOrdersQueryKey,
  useGetDispatchByToken,
  useUpdateDispatchRecord,
} from '@workspace/api-client-react';
import type { DispatchRecordStatus, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

const dateText = (value?: string | null) => value
  ? new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(value))
  : 'Not recorded';

const pill: Record<DispatchRecordStatus, string> = {
  planned: 'bg-amber-100 text-amber-900',
  dispatched: 'bg-sky-100 text-sky-900',
  delivered: 'bg-emerald-100 text-emerald-900',
  returned: 'bg-orange-100 text-orange-900',
  cancelled: 'bg-rose-100 text-rose-900',
};

const nextStatuses: Partial<Record<DispatchRecordStatus, DispatchRecordStatus[]>> = {
  planned: ['dispatched'],
  dispatched: ['delivered', 'returned'],
  delivered: ['returned'],
};

const canDispatchEdit = (user: User) => user.roleId === 'master-admin'
  || user.permissions?.['dispatch.edit'] === 'edit'
  || user.permissions?.dispatch === 'edit';

const eventTitle = (type: string) => type
  .replace(/^dispatch\./, '')
  .split(/[._]/)
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');

export default function DispatchSharePage({ user }: { user: User }) {
  const params = useParams<{ token: string }>();
  const token = params.token || '';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canView = user.roleId === 'master-admin'
    || ['view', 'edit'].includes(user.permissions?.dispatch || '')
    || ['view', 'edit'].includes(user.permissions?.['dispatch.view'] || '');
  const canEdit = canDispatchEdit(user);
  const dispatch = useGetDispatchByToken(token, {
    query: { enabled: Boolean(token) && canView, queryKey: getGetDispatchByTokenQueryKey(token) },
  });
  const update = useUpdateDispatchRecord();
  const [actionError, setActionError] = useState('');
  const item = dispatch.data;

  const changeStatus = async (status: DispatchRecordStatus) => {
    if (!item || update.isPending) return;
    setActionError('');
    try {
      await update.mutateAsync({ id: item.id, data: { status } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetDispatchByTokenQueryKey(token) }),
        queryClient.invalidateQueries({ queryKey: getGetDispatchSummaryQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListDispatchRecordsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }),
      ]);
      toast({ title: 'Dispatch status updated', description: `${item.dispatchCode} · ${status}` });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The status could not be updated.');
    }
  };

  if (!canView) {
    return <AppShell user={user} title="Dispatch status" eyebrow="Protected QR record">
      <section className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950" data-testid="state-dispatch-share-access">
        Dispatch view access is required to open this QR status.
      </section>
    </AppShell>;
  }

  if (dispatch.isLoading) {
    return <AppShell user={user} title="Dispatch status" eyebrow="Protected QR record">
      <div className="mx-auto max-w-2xl space-y-4" data-testid="state-dispatch-share-loading">
        <div className="h-36 animate-pulse rounded-2xl bg-card" />
        <div className="h-64 animate-pulse rounded-2xl bg-card" />
      </div>
    </AppShell>;
  }

  if (dispatch.isError || !item) {
    const errorMessage = dispatch.error instanceof Error ? dispatch.error.message : '';
    const revoked = /cancel|revok/i.test(errorMessage);
    return <AppShell user={user} title="Dispatch status" eyebrow="Protected QR record">
      <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-rose-200 bg-rose-50 p-7 text-center" data-testid="state-dispatch-share-revoked">
        <CircleAlert className="mx-auto text-rose-700" size={26} />
        <h2 className="mt-3 font-display text-lg font-bold text-rose-950">
          {revoked ? 'Dispatch QR cancelled or revoked' : 'Dispatch QR link unavailable'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-rose-900">
          {revoked
            ? 'This dispatch was cancelled or its QR link was revoked by an authorised operator.'
            : 'This QR link is invalid or the dispatch record is no longer available.'}
        </p>
        <Link href="/dispatch" className="mt-5 inline-flex h-9 items-center justify-center rounded-lg border border-input bg-background px-3 text-xs font-semibold">
          Open dispatch register
        </Link>
      </div>
    </AppShell>;
  }

  const history = item.statusHistory.length
    ? item.statusHistory.map((event) => ({
        id: event.id,
        title: eventTitle(event.eventType),
        message: event.message,
        actor: event.actorName,
        date: event.createdAt,
      }))
    : [
        { id: 'created', title: 'Created', message: 'Dispatch record created.', actor: '', date: item.createdAt },
        ...[
          { id: 'planned', title: 'Planned', message: 'Planned date recorded.', date: item.plannedAt },
          { id: 'dispatched', title: 'Dispatched', message: 'Dispatch departed.', date: item.dispatchedAt },
          { id: 'delivered', title: 'Delivered', message: 'Delivery confirmed.', date: item.deliveredAt },
          { id: 'returned', title: 'Returned', message: 'Dispatch marked returned.', date: item.returnedAt },
        ].filter((event) => event.date).map((event) => ({
          ...event,
          date: event.date as string,
          actor: '',
        })),
      ];
  const allowedNext = nextStatuses[item.status] || [];

  return <AppShell user={user} title="Dispatch status" eyebrow="Protected QR record">
    <main className="mx-auto w-full max-w-3xl space-y-4">
      <Link href="/dispatch" className="inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline" data-testid="link-back-dispatch">
        <ArrowLeft size={14} /> Dispatch register
      </Link>
      <section className="relative overflow-hidden rounded-2xl border border-primary/15 bg-[linear-gradient(125deg,#eff7f3,#e5f0ed_62%,#f8eddd)] p-5 sm:p-7">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full border border-primary/10" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">Dispatch record</p>
            <h2 className="mt-2 break-all font-mono text-2xl font-bold tracking-tight" data-testid="text-shared-dispatch-code">{item.dispatchCode}</h2>
            <p className="mt-2 text-sm font-semibold">{item.orderId} <span className="px-1 text-muted-foreground">·</span> {item.clientName}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.lotId} <span className="px-1">·</span> {item.windowsSnapshot.length} windows</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-bold capitalize ${pill[item.status]}`} data-testid="status-shared-dispatch">{item.status}</span>
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-[1fr_260px]">
        <div className="space-y-4 rounded-2xl border border-border/80 bg-card p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-background p-3">
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><MapPin size={13} /> Delivery location</p>
              <p className="mt-2 text-sm font-semibold">{item.locationName}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.siteAddress || 'Address not recorded'}</p>
              {item.siteLatitude != null && item.siteLongitude != null && <a href={`https://www.openstreetmap.org/?mlat=${item.siteLatitude}&mlon=${item.siteLongitude}#map=16/${item.siteLatitude}/${item.siteLongitude}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-[10px] font-semibold text-primary hover:underline">Open site pin</a>}
            </div>
            <div className="rounded-xl border border-border/70 bg-background p-3">
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><Truck size={13} /> Transport</p>
              <p className="mt-2 text-sm font-semibold">{item.vehicleNumber || 'Vehicle not recorded'}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.driverName || 'Driver not recorded'}{item.driverPhone ? ` · ${item.driverPhone}` : ''}</p>
              <p className="mt-2 text-xs text-muted-foreground">Challan {item.challanNumber || 'not recorded'}</p>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 border-b border-border/70 pb-2">
              <PackageCheck size={15} className="text-primary" />
              <h3 className="text-xs font-bold">Whole-lot windows</h3>
              <span className="ml-auto text-[10px] text-muted-foreground">{item.windowsSnapshot.length} included</span>
            </div>
            {item.windowsSnapshot.length
              ? <div className="divide-y divide-border/60">{item.windowsSnapshot.map((window) => <div key={window.windowId} className="grid grid-cols-[1fr_auto] gap-3 py-2.5 text-xs" data-testid={`row-shared-window-${window.windowId}`}><div><p className="font-semibold">{window.windowNo} <span className="font-normal text-muted-foreground">· {window.windowType}</span></p><p className="mt-1 text-[10px] text-muted-foreground">{window.widthMm} × {window.heightMm} mm · {window.sqFt.toFixed(2)} sq ft</p></div><p className="text-right text-[9px] leading-4 text-muted-foreground">Frame {window.frameStatus}<br />Shutter {window.shutterStatus}<br />Glass {window.glassStatus}</p></div>)}</div>
              : <p className="py-4 text-xs text-muted-foreground">No windows were recorded in this dispatch snapshot.</p>}
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground" data-testid="text-shared-dispatch-note">
            Dispatch note: {item.dispatchNote || 'No dispatch note recorded.'}
          </div>
          {canEdit && allowedNext.length > 0 && <div className="space-y-2 border-t border-border/70 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Update dispatch status</p>
            <div className="flex flex-wrap gap-2">
              {allowedNext.map((status) => <Button key={status} size="sm" disabled={update.isPending} onClick={() => void changeStatus(status)} data-testid={`button-shared-dispatch-status-${status}`}>
                Mark {status}
              </Button>)}
            </div>
            {actionError && <p className="text-xs text-destructive" role="alert" data-testid="error-shared-dispatch-status">{actionError}</p>}
          </div>}
        </div>
        <aside className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5">
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-primary">Status history</p>
          <div className="mt-4 space-y-0" data-testid="list-shared-dispatch-history">
            {history.length
              ? history.map((event, index) => <div key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
                  <span className="relative mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10"><i className="size-1.5 rounded-full bg-primary" /></span>
                  {index < history.length - 1 && <span className="absolute left-[9px] top-5 h-[calc(100%-12px)] w-px bg-border" />}
                  <div><p className="text-xs font-semibold">{event.title}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{event.message}</p><p className="mt-1 text-[10px] text-muted-foreground">{dateText(event.date)}{event.actor ? ` · ${event.actor}` : ''}</p></div>
                </div>)
              : <p className="text-xs text-muted-foreground">No status history recorded.</p>}
          </div>
          <p className="mt-5 border-t border-border/60 pt-3 text-[10px] leading-4 text-muted-foreground">This page shows the latest saved dispatch details. Status updates are recorded against this dispatch only.</p>
          <Link href={`/dispatch?record=${encodeURIComponent(item.id)}`} className="mt-4 flex h-9 w-full items-center justify-center rounded-lg border border-input bg-background text-xs font-semibold">Open dispatch record</Link>
        </aside>
      </section>
    </main>
  </AppShell>;
}
