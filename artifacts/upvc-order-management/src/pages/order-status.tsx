import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowLeft, CircleAlert, LockKeyhole, Save, Truck } from 'lucide-react';
import {
  getGetPaymentOverviewQueryKey,
  getGetOrderQueryKey,
  getListOrdersQueryKey,
  OrderStatus,
  useGetOrder,
  useUpdateOrder,
} from '@workspace/api-client-react';
import type { User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

type Status = (typeof OrderStatus)[keyof typeof OrderStatus];

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: OrderStatus.quotation_stage, label: 'Quotation stage' },
  { value: OrderStatus.confirmed, label: 'Confirmed' },
  { value: OrderStatus.in_production, label: 'In production' },
  { value: OrderStatus.ready, label: 'Ready' },
];

function statusLabel(status: string) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status.replaceAll('_', ' ');
}

export default function OrderStatusPage({ user }: { user: User }) {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const id = params.id || '';
  const permission = user.permissions?.['order-hub'];
  const canView = user.roleId === 'master-admin' || permission === 'view' || permission === 'edit';
  const canEdit = user.roleId === 'master-admin' || permission === 'edit';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const order = useGetOrder(id, { query: { enabled: Boolean(id) && canView, queryKey: getGetOrderQueryKey(id) } });
  const update = useUpdateOrder();
  const [selectedStatus, setSelectedStatus] = useState<Status | ''>('');
  const record = order.data;

  useEffect(() => {
    if (record) setSelectedStatus(record.status === OrderStatus.dispatched || record.status === OrderStatus.installed ? '' : record.status);
  }, [record?.id, record?.status]);

  const saveStatus = () => {
    if (!record || !canEdit || !selectedStatus) return;
    update.mutate(
      { id: record.id, data: { status: selectedStatus } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetOrderQueryKey(id), updated);
          void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetPaymentOverviewQueryKey() });
          toast({
            title: 'Order status updated',
            description: `${updated.orderId} is now ${statusLabel(updated.status)}.`,
          });
          setLocation(`/order-hub/${record.id}`);
        },
        onError: () => {
          toast({
            title: 'Status update failed',
            description: 'The order was not changed. Refresh the page and try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  if (!canView) {
    return (
      <AppShell user={user} title="Order status" eyebrow="Order access">
        <Alert variant="destructive" className="mx-auto mt-12 max-w-lg">
          <LockKeyhole size={18} />
          <AlertTitle>Order access required</AlertTitle>
          <AlertDescription>Your role does not have permission to view this order.</AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  if (order.isLoading) {
    return (
      <AppShell user={user} title="Order status" eyebrow="QR status update">
        <div className="mx-auto mt-12 h-64 max-w-xl animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  if (order.isError || !record) {
    return (
      <AppShell user={user} title="Order status" eyebrow="QR status update">
        <Alert variant="destructive" className="mx-auto mt-12 max-w-lg">
          <CircleAlert size={18} />
          <AlertTitle>Order unavailable</AlertTitle>
          <AlertDescription>This order could not be loaded. It may not exist, or your role may not have access.</AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} title="Update order status" eyebrow="QR status update">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <Link href={`/order-hub/${record.id}`} className="inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline">
          <ArrowLeft size={15} />
          Back to order
        </Link>
        <Card className="border-border/80">
           <CardHeader className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Order {record.orderId}</p>
             <CardTitle className="break-words text-xl">{record.clientName}</CardTitle>
             <p className="break-words text-sm text-muted-foreground">{record.locationCode} · {record.locationName}</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Current status</p>
              <p className="mt-1 text-sm font-semibold">{statusLabel(record.status)}</p>
            </div>
            {!canEdit && (
              <Alert>
                <LockKeyhole size={18} />
                <AlertTitle>View-only access</AlertTitle>
                <AlertDescription>Your role can view this order but cannot change its status. Ask an administrator for order edit access.</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <label htmlFor="qr-order-status" className="text-sm font-medium">New status</label>
              <Select
                value={selectedStatus}
                onValueChange={(value) => setSelectedStatus(value as Status)}
                disabled={!canEdit || update.isPending}
              >
                <SelectTrigger id="qr-order-status" data-testid="select-qr-order-status">
                  <SelectValue placeholder="Choose a status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-primary/15 bg-primary/[.04] p-3 text-xs leading-5" data-testid="notice-qr-dispatch-workflow">
              <Truck size={16} className="mt-0.5 shrink-0 text-primary" />
              <span>Dispatch and installation are tracked separately from the order lifecycle. <Link href="/dispatch" className="font-bold text-primary underline underline-offset-2" data-testid="link-qr-dispatch-workflow">Create or manage a dispatch</Link>.</span>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={saveStatus}
                disabled={!canEdit || !selectedStatus || selectedStatus === record.status || update.isPending}
                data-testid="button-save-qr-order-status"
              >
                <Save size={14} />
                {update.isPending ? 'Saving…' : 'Save status'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}