import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useGetAuthSession } from '@workspace/api-client-react';
import type { User } from '@workspace/api-client-react';
import { Route, Router as WouterRouter, Switch } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import DashboardPage from '@/pages/dashboard';
import LoginPage from '@/pages/login';
import NotFound from '@/pages/not-found';
import RolesPage from '@/pages/roles';
import UsersPage from '@/pages/users';
import ChatGroupsPage from '@/pages/chat-groups';
import CommunicationPage from '@/pages/communication';
import OrderHubPage from '@/pages/order-hub';
import OrderDetailPage from '@/pages/order-detail';
import OrderScannerPage from '@/pages/order-scanner';
import OrderStatusPage from '@/pages/order-status';
import QuotationBuilderPage from '@/pages/quotation-builder';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 20_000 } } });

function AuthenticatedRoutes({ user }: { user: User | null }) {
  if (!user) return <LoginPage />;
  return <Switch>
    <Route path="/" component={() => <DashboardPage user={user} />} />
    <Route path="/order-scanner" component={() => <OrderScannerPage user={user} />} />
    <Route path="/order-status/:id" component={() => <OrderStatusPage user={user} />} />
    <Route path="/order-hub/:id" component={() => <OrderDetailPage user={user} />} />
    <Route path="/order-hub" component={() => <OrderHubPage user={user} />} />
    <Route path="/admin/users" component={() => <UsersPage user={user} />} />
    <Route path="/admin/roles" component={() => <RolesPage user={user} />} />
    <Route path="/admin/groups" component={() => <ChatGroupsPage user={user} />} />
    <Route path="/communication" component={() => <CommunicationPage user={user} />} />
    <Route path="/quotation-builder" component={() => <QuotationBuilderPage user={user} />} />
    <Route component={NotFound} />
  </Switch>;
}

function Router() {
  const session = useGetAuthSession();
  return <ErrorBoundary resetKey={window.location.pathname}>
    {session.isLoading ? <div className="flex min-h-[100dvh] items-center justify-center bg-background"><div className="w-full max-w-sm space-y-3 px-6"><div className="h-10 w-10 animate-pulse rounded-xl bg-secondary" /><div className="h-7 w-56 animate-pulse rounded-lg bg-muted" /><div className="h-4 w-72 animate-pulse rounded-lg bg-muted" /></div></div> : session.isError ? <LoginPage /> : <AuthenticatedRoutes user={session.data?.user || null} />}
  </ErrorBoundary>;
}

function App() {
  return <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="framewise-theme" disableTransitionOnChange><QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider></ThemeProvider>;
}

export default App;