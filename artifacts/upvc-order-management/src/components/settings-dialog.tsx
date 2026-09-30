import { Check, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { setTheme, theme } = useTheme();
  const activeTheme = theme === 'light' ? 'light' : 'dark';

  const choiceClass = (selected: boolean) =>
    `flex min-h-20 w-full items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      selected
        ? 'border-primary bg-primary/10 text-foreground'
        : 'border-border bg-card text-card-foreground hover:bg-muted'
    }`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-settings">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Choose how the workspace looks. Your choice is saved on this device.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Appearance</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              The sidebar keeps its separate Framewise brand colors in both themes.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Theme">
            <button
              type="button"
              onClick={() => setTheme('light')}
              aria-pressed={activeTheme === 'light'}
              className={choiceClass(activeTheme === 'light')}
              data-testid="button-theme-light"
            >
              <span className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Sun size={19} aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">Light</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">Bright surfaces</span>
                </span>
              </span>
              {activeTheme === 'light' && <Check size={17} className="shrink-0 text-primary" aria-hidden="true" />}
            </button>

            <button
              type="button"
              onClick={() => setTheme('dark')}
              aria-pressed={activeTheme === 'dark'}
              className={choiceClass(activeTheme === 'dark')}
              data-testid="button-theme-dark"
            >
              <span className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Moon size={19} aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">Dark</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">Dim surfaces</span>
                </span>
              </span>
              {activeTheme === 'dark' && <Check size={17} className="shrink-0 text-primary" aria-hidden="true" />}
            </button>
          </div>
          <p className="sr-only" aria-live="polite" data-testid="text-active-theme">
            {activeTheme === 'light' ? 'Light theme is active.' : 'Dark theme is active.'}
          </p>
        </section>
      </DialogContent>
    </Dialog>
  );
}