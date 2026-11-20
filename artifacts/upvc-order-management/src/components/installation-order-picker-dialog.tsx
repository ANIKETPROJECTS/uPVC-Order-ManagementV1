import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, CircleAlert, LoaderCircle, Search } from 'lucide-react';
import type { InstallationOrder, InstallationOrderOption } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const ORDER_STATUS_LABELS: Record<InstallationOrderOption['orderStatus'], string> = {
  quotation_stage: 'Quotation stage',
  confirmed: 'Confirmed',
  in_production: 'In production',
  ready: 'Ready',
  dispatched: 'Dispatched',
  installed: 'Installed',
};

const readable = (value: string) => value.replaceAll('_', ' ');

export function InstallationOrderPickerDialog({ open, options, installations, loading, error, onRetry, onClose, onSelect }: {
  open: boolean;
  options: InstallationOrderOption[];
  installations: InstallationOrder[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onClose: () => void;
  onSelect: (order: InstallationOrderOption) => void;
}) {
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  const visibleOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return options.filter((order) =>
      !needle || `${order.orderId} ${order.clientName} ${order.locationName} ${order.orderStatus} ${order.dispatchStatus}`.toLowerCase().includes(needle),
    );
  }, [options, search]);
  const installationsById = useMemo(() => new Map(installations.map((order) => [order.id, order])), [installations]);

  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent className="max-w-2xl" data-testid="dialog-installation-order-picker">
      <DialogHeader>
        <DialogTitle>Add / Schedule Installation</DialogTitle>
        <DialogDescription>Search all Client &amp; Orders records by order, client, or location. Existing schedules can be opened to change their date or team.</DialogDescription>
      </DialogHeader>
      <label className="relative block">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, client, or location" aria-label="Search orders to schedule" className="pl-9" data-testid="input-installation-order-picker-search" />
      </label>
      <div className="max-h-[min(52vh,480px)] space-y-2 overflow-y-auto pr-1" aria-label="Orders available for installation" data-testid="list-installation-order-picker">
        {loading ? <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-border text-xs text-muted-foreground" data-testid="state-installation-order-picker-loading"><LoaderCircle size={17} className="mb-2 animate-spin" />Loading orders…</div>
          : error ? <div className="grid min-h-36 place-items-center rounded-xl border border-destructive/20 bg-destructive/[.035] p-4 text-center" data-testid="state-installation-order-picker-error"><div><CircleAlert size={20} className="mx-auto text-destructive" /><p className="mt-2 text-xs font-semibold">Orders could not be loaded.</p><Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry} data-testid="button-retry-installation-order-picker">Try again</Button></div></div>
            : visibleOrders.length === 0 ? <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-border bg-muted/15 p-4 text-center" data-testid="state-installation-order-picker-empty"><p className="text-xs text-muted-foreground">{options.length ? 'No orders match this search.' : 'There are no Client & Orders records to schedule.'}</p></div>
              : visibleOrders.map((order) => {
                const installation = installationsById.get(order.id);
                const alreadyInstalled = order.orderStatus === 'installed' || installation?.installationStatus === 'installed';
                return <button key={order.id} type="button" disabled={alreadyInstalled} onClick={() => onSelect(order)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/80 bg-background px-3.5 py-3 text-left transition hover:border-primary/40 hover:bg-primary/[.025] disabled:cursor-not-allowed disabled:opacity-55" data-testid={`button-select-installation-order-${order.id}`}>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-primary" data-testid={`text-picker-order-id-${order.id}`}>{order.orderId}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-semibold capitalize text-muted-foreground" data-testid={`badge-picker-order-status-${order.id}`}>{ORDER_STATUS_LABELS[order.orderStatus]}</span>
                      {order.dispatchStatus === 'delivered' && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-800">Delivered</span>}
                      {!order.isActive && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-700" data-testid={`badge-picker-inactive-${order.id}`}>Inactive</span>}
                      {installation?.scheduledDate && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary"><CalendarDays size={10} />Scheduled · {installation.scheduledDate.slice(0, 10)}</span>}
                      {alreadyInstalled && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold text-emerald-800">Already installed</span>}
                    </span>
                    <span className="mt-1 block truncate text-xs font-semibold" data-testid={`text-picker-client-${order.id}`}>{order.clientName}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground" data-testid={`text-picker-location-${order.id}`}>{order.locationName}</span>
                  </span>
                  <ArrowRight size={15} className="shrink-0 text-muted-foreground" />
                </button>;
              })}
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose} data-testid="button-close-installation-order-picker">Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
