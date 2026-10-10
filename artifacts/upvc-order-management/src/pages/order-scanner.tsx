import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { Camera, CameraOff, CircleAlert, ScanLine } from 'lucide-react';
import { useLocation } from 'wouter';
import type { User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getDispatchRecordIdFromQr, getOrderRecordIdFromQr } from '@/lib/order-qr';

type ScannerError = {
  kind: 'camera' | 'qr';
  message: string;
};

export default function OrderScannerPage({ user }: { user: User }) {
  const [, setLocation] = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const handledResultRef = useRef(false);
  const lastInvalidQrRef = useRef('');
  const orderPermission = user.permissions?.['order-hub'];
  const dispatchPermission = user.permissions?.dispatch;
  const canViewOrders = user.roleId === 'master-admin' || orderPermission === 'view' || orderPermission === 'edit';
  const canViewDispatch = user.roleId === 'master-admin' || dispatchPermission === 'view' || dispatchPermission === 'edit';
  const canView = canViewOrders || canViewDispatch;
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<ScannerError | null>(null);
  const needsHttps =
    !window.isSecureContext &&
    !['localhost', '127.0.0.1'].includes(window.location.hostname);

  useEffect(() => () => controlsRef.current?.stop(), []);

  const stopScanner = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  };

  const startScanner = async () => {
    if (!canView) return;
    setError(null);
    handledResultRef.current = false;
    lastInvalidQrRef.current = '';

    if (needsHttps) {
      setError({
        kind: 'camera',
        message:
          'Camera access requires HTTPS on remote devices. Open the app over HTTPS, or use your phone camera to scan the downloaded QR.',
      });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
      setError({
        kind: 'camera',
        message:
          'This browser does not support camera scanning. Try a current mobile or desktop browser.',
      });
      return;
    }

    setScanning(true);
    try {
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, _decodeError, activeControls) => {
        if (!result || handledResultRef.current) return;
        const dispatchRecordId = getDispatchRecordIdFromQr(result.getText());
        if (dispatchRecordId) {
          if (!canViewDispatch) {
            setError({
              kind: 'qr',
              message: 'Dispatch view access is required to open this dispatch QR.',
            });
            return;
          }
          handledResultRef.current = true;
          activeControls.stop();
          controlsRef.current = null;
          setScanning(false);
          setError(null);
          setLocation(`/dispatch?scanOrderId=${encodeURIComponent(dispatchRecordId)}`);
          return;
        }

        const recordId = getOrderRecordIdFromQr(result.getText());
        if (!recordId) {
          if (lastInvalidQrRef.current !== result.getText()) {
            lastInvalidQrRef.current = result.getText();
            setError({
              kind: 'qr',
              message:
                'This code is not an order or dispatch QR. The camera is still on; scan a supported code to continue.',
            });
          }
          return;
        }
        if (!canViewOrders) {
          setError({
            kind: 'qr',
            message: 'Order view access is required to open this order QR.',
          });
          return;
        }

        handledResultRef.current = true;
        activeControls.stop();
        controlsRef.current = null;
        setScanning(false);
        setError(null);
        setLocation(`/order-status/${encodeURIComponent(recordId)}`);
      });
      if (handledResultRef.current) controls.stop();
      else controlsRef.current = controls;
    } catch {
      setScanning(false);
      setError({
        kind: 'camera',
        message:
          'The camera could not start. Check browser camera permission and try again.',
      });
    }
  };

  if (!canView) {
    return (
      <AppShell user={user} title="QR scanner" eyebrow="Order access">
        <Alert variant="destructive" className="mx-auto mt-12 max-w-lg">
          <CircleAlert size={18} />
          <AlertTitle>Order or dispatch access required</AlertTitle>
          <AlertDescription>Your role does not have permission to scan order or dispatch codes.</AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} title="QR scanner" eyebrow="Sales & orders">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <Card className="border-border/80">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Order lookup</p>
              <CardTitle className="mt-1">Scan an order or dispatch QR</CardTitle>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Point your camera at an order QR to open its status page, or a dispatch QR to open the dispatch status action. Your role permissions control which records you can update.
                </p>
              </div>
              <ScanLine size={22} className="shrink-0 text-primary" aria-hidden="true" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-border bg-black">
              <video
                ref={videoRef}
                className="aspect-video w-full object-cover"
                muted
                playsInline
                aria-label="QR scanner camera preview"
                data-testid="video-order-qr-scanner"
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <CircleAlert size={18} />
                <AlertTitle>
                  {error.kind === 'qr' ? 'QR code not recognized' : 'Scanner unavailable'}
                </AlertTitle>
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              {scanning ? (
                <Button type="button" variant="outline" onClick={stopScanner} data-testid="button-stop-order-scanner">
                  <CameraOff size={14} />
                  Stop camera
                </Button>
              ) : (
                <Button type="button" onClick={startScanner} data-testid="button-start-order-scanner">
                  <Camera size={14} />
                  Start camera
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        {needsHttps && (
          <Alert>
            <CircleAlert size={18} />
            <AlertTitle>Camera access requires HTTPS</AlertTitle>
            <AlertDescription>
              Browsers block camera access on remote HTTP pages. Open this app over HTTPS
              or scan the downloaded QR with your phone camera.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </AppShell>
  );
}