import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import {
  getListOrderWindowsQueryKey,
  useUpdateOrderWindow,
} from '@workspace/api-client-react';
import type { Order, OrderWindow, User } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ProjectLotAssignmentPanel({
  order,
  windows,
  user,
}: {
  order: Order;
  windows: OrderWindow[];
  user: User;
}) {
  const update = useUpdateOrderWindow();
  const queryClient = useQueryClient();
  if (order.clientType !== 'Project' || windows.length === 0) return null;

  return (
    <Card data-testid="card-window-lot-assignment">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Plan windows into project lots</CardTitle>
        <p className="text-xs text-muted-foreground">
          Lot membership belongs to each window. Dispatched windows cannot be reassigned.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {windows.map((window) => (
          <label key={window.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-xs">
            <span className="font-semibold">{window.windowNo}</span>
            <select
              aria-label={`Assign ${window.windowNo} to a lot`}
              value={window.lotId ?? ''}
              disabled={(user.roleId !== 'master-admin' && user.permissions?.['order-hub'] !== 'edit') || update.isPending}
              onChange={(event) => update.mutate(
                { id: order.id, windowId: window.id, data: { lotId: event.target.value || null } },
                { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListOrderWindowsQueryKey(order.id) }) },
              )}
              className="h-9 min-w-48 rounded-md border border-input bg-background px-2"
            >
              <option value="">Unassigned</option>
              {order.lots.map((lot) => <option key={lot.id} value={lot.lotId}>{lot.lotId}</option>)}
            </select>
          </label>
        ))}
      </CardContent>
    </Card>
  );
}

export function PieceQrLabelSheet({ order, windows }: { order: Order; windows: OrderWindow[] }) {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const timer = window.setTimeout(() => window.print(), 200);
    return () => window.clearTimeout(timer);
  }, [printing]);

  const labels = windows.flatMap((row) => row.pieces.map((piece) => ({
    row,
    piece,
    name: piece.kind === 'frame' ? 'Frame' : piece.kind === 'glass_shutter' ? 'Glass shutter' : 'Mesh shutter',
  })));

  return (
    <Card data-testid="card-window-qr-labels">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Factory QR labels</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Print software-generated labels for the order’s window components.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setPrinting(true)} disabled={!labels.length}>Print label sheet</Button>
      </CardHeader>
      {printing && (
        <CardContent id="piece-qr-print-sheet" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {labels.map(({ row, name, piece }) => (
            <div key={piece.id} className="piece-qr-label flex flex-col items-center gap-1 border border-border p-2 text-center">
              <QRCodeCanvas value={`FRAMEWISE_PIECE:${order.id}:${row.id}:${piece.id}`} size={96} includeMargin />
              <strong className="text-xs">{order.orderId} · {row.windowNo}</strong>
              <span className="text-[10px]">{name} {piece.pieceNo} · {piece.status === 'ready' ? 'Ready' : 'Pending'}</span>
            </div>
          ))}
          <style>{`@media print { body * { visibility:hidden!important } #piece-qr-print-sheet,#piece-qr-print-sheet * { visibility:visible!important } #piece-qr-print-sheet { display:grid!important; position:absolute; inset:0; padding:10mm } .piece-qr-label { break-inside:avoid } }`}</style>
        </CardContent>
      )}
    </Card>
  );
}
