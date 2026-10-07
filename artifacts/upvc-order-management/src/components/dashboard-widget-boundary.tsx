import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

type Props = {
  children: ReactNode;
  name: string;
  onRetry?: () => void;
  widgetId?: string;
};

type State = { failed: boolean };

export class DashboardWidgetBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Dashboard widget failed: ${this.props.name}`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="flex min-h-40 flex-col items-center justify-center rounded-[20px] border border-destructive/25 bg-card p-6 text-center" role="alert" data-dashboard-widget={this.props.widgetId} data-testid={`dashboard-widget-error-${this.props.name.toLowerCase().replaceAll(' ', '-')}`}>
        <AlertCircle size={20} className="text-destructive" />
        <h2 className="mt-2 text-sm font-semibold">{this.props.name} is unavailable</h2>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">Other dashboard sections are still available.</p>
        <button
          type="button"
          onClick={() => {
            this.setState({ failed: false });
            this.props.onRetry?.();
          }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
        >
          <RefreshCw size={12} /> Try again
        </button>
      </section>
    );
  }
}
