import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { Link } from 'wouter';
import { BrandMark } from '@/components/brand-mark';

export default function NotFound() {
  return (
    <div className="app-grid flex min-h-[100dvh] w-full items-center justify-center bg-background p-5">
      <Card className="surface-lift w-full max-w-md overflow-hidden rounded-3xl border-border bg-card">
        <CardContent className="p-7 md:p-9">
          <BrandMark />
          <div className="mt-12 flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-500/10 text-rose-500"><CircleAlert size={20} /></div>
            <div><p className="micro-label text-rose-500">Route not found</p><h1 className="mt-2 font-display text-2xl font-bold tracking-tight">That page is off the plan.</h1></div>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">The workspace route you requested is not available in this release.</p>
          <Link href="/" className="mt-7 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground" data-testid="link-back-dashboard"><ArrowLeft size={15} /> Back to dashboard</Link>
        </CardContent>
      </Card>
    </div>
  );
}
