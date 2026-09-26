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
import { getOrderRecordIdFromQr } from '@/lib/order-qr';

export default function OrderScannerPage({ user }: { user: User }) {
  const [, setLocation] = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const handledResultRef = useRef(false);
  const permission = user.permissions?.['order-hub'];
  const canView = user.roleId === 'master-admin' || permission === 'view' || permission === 'edit';
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => controlsRef.current?.stop(), []);

  const stopScanner = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  };

  const startScanner = async () => {
    if (!canView) return;
    setError('');
    handledResultRef.current = false;

    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      setError('Camera access requires HTTPS when this app is opened on a remote device. Use your phone camera to scan the downloaded QR, or enable HTTPS.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
      setError('This browser does not support camera scanning. Try a current mobile or desktop browser.');
      return;
    }

    setScanning(true);
    try {
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, _decodeError, activeControls) => {
        if (!result || handledResultRef.current) return;
        handledResultRef.current = true;
        activeControls.stop();
        controlsRef.current = null;
        setScanning(false);

        const recordId = getOrderRecordIdFromQr(result.getText());
        if (!recordId) {
          setError('This QR code is not an order status link from this app. Try another code.');
          handledResultRef.current = false;
          return;
        }
        setLocation(`/order-status/${encodeURIComponent(recordId)}`);
      });
      if (handledResultRef.current) controls.stop();
      else controlsRef.current = controls;
    } catch {
      setScanning(false);
      setError('The camera could not start. Check browser camera permission and try again.');
    }
  };

  if (!canView) {
    return (
      <AppShell user={user} title="QR scanner" eyebrow="Order access">
        <Alert variant="destructive" className="mx-auto mt-12 max-w-lg">
          <CircleAlert size={18} />
          <AlertTitle>Order access required</AlertTitle>
          <AlertDescription>Your role does not have permission to scan order codes.</AlertDescription>
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
                <CardTitle className="mt-1">Scan an order QR code</CardTitle>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Point your camera at an order QR to open its status page. You must sign in and have order view access; changing a status requires edit access.
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
                <AlertTitle>Scanner unavailable</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
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
        <Alert>
          <CircleAlert size={18} />
          <AlertTitle>Camera access on remote servers</AlertTitle>
          <AlertDescription>
            Browsers require HTTPS for camera access on remote devices. If this app is opened through an HTTP IP address, use your phone camera to scan the downloaded QR or switch the server to HTTPS.
          </AlertDescription>
        </Alert>
      </div>
    </AppShell>
  );
}