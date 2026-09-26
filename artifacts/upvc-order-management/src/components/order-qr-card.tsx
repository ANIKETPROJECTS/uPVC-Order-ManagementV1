import { useRef } from 'react';
import { Download, QrCode } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getOrderStatusUrl } from '@/lib/order-qr';

export function OrderQrCard({
  orderId,
  orderRecordId,
}: {
  orderId: string;
  orderRecordId: string;
}) {
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const url = getOrderStatusUrl(orderRecordId);

  const downloadQr = () => {
    const canvas = qrContainerRef.current?.querySelector('canvas');
    if (!canvas) return;

    const anchor = document.createElement('a');
    anchor.href = canvas.toDataURL('image/png');
    anchor.download = `${orderId.replace(/[^a-zA-Z0-9._-]/g, '-')}-qr.png`;
    anchor.click();
  };

  return (
    <Card className="border-border/80">
      <CardHeader className="flex-row items-start justify-between gap-4 pb-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Order QR</p>
          <CardTitle className="mt-1 text-base">Scan to update this order</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            The QR opens a sign-in protected status page for {orderId}.
          </p>
        </div>
        <QrCode size={20} className="shrink-0 text-primary" aria-hidden="true" />
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <div ref={qrContainerRef} className="rounded-xl border border-border bg-white p-3" data-testid="order-qr-code">
          <QRCodeCanvas value={url} size={192} level="H" includeMargin aria-label={`QR code for order ${orderId}`} />
        </div>
        <div className="max-w-md space-y-3 text-center sm:text-left">
          <p className="text-sm leading-6 text-muted-foreground">
            Users need order view access to open the link. Changing the status also requires order edit access.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={downloadQr} data-testid="button-download-order-qr">
            <Download size={14} />
            Download PNG
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}