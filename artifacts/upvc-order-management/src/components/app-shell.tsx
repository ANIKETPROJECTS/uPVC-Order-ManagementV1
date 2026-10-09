import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { Bell, ChevronLeft, ChevronRight, LogOut, Menu, MessageSquareText, ScanLine, Settings2, X, CheckCheck, ExternalLink } from 'lucide-react';
import type { User } from '@workspace/api-client-react';
import { getGetAuthSessionQueryKey, getGetPushConfigQueryKey, getListNotificationsQueryKey, useLogout, useListNotifications, useMarkAllNotificationsRead, useMarkNotificationRead, useGetPushConfig, useSavePushSubscription, useDeletePushSubscription } from '@workspace/api-client-react';
import { SidebarSectionIcon, type SidebarIconName } from '@/components/sidebar-icons';
import { SettingsDialog } from '@/components/settings-dialog';
import { UserAvatar } from '@/components/user-avatar';
import { MODULES } from '@/lib/modules';
import { Button } from '@/components/ui/button';

function decodeVapidKey(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function NotificationCenter({ navigate }: { navigate: (path: string) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(() => !localStorage.getItem('framewise-browser-notification-prompt'));
  const notifications = useListNotifications({ query: { queryKey: getListNotificationsQueryKey(), refetchInterval: 30_000 } });
  const pushConfig = useGetPushConfig();
  const markOne = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const save = useSavePushSubscription();
  const remove = useDeletePushSubscription();
  const center = notifications.data;
  const pushReady = Boolean(pushConfig.data?.enabled && pushConfig.data.publicKey);
  const enable = async () => {
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window) || !pushConfig.data?.publicKey) throw new Error('Push notifications are unavailable in this browser.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Browser permission was not granted.');
      const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`);
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(pushConfig.data.publicKey) });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('The browser did not provide a complete push subscription.');
      save.mutate({ data: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } } }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetPushConfigQueryKey() }); setPrompt(false); localStorage.setItem('framewise-browser-notification-prompt', 'done'); } });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not enable notifications.');
    }
  };
  const disable = async () => {
    const registration = await navigator.serviceWorker.getRegistration(`${import.meta.env.BASE_URL}`);
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    remove.mutate({ data: { endpoint: subscription.endpoint } }, { onSuccess: async () => { await subscription.unsubscribe(); void queryClient.invalidateQueries({ queryKey: getGetPushConfigQueryKey() }); } });
  };
  const openNotification = (item: NonNullable<typeof center>['items'][number]) => {
    markOne.mutate({ notificationId: item.id }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) });
    const target = item.quotationId ? (item.type === 'approval_request' || item.type === 'approval_reminder' ? `/quotation-approvals?quote=${item.quotationId}` : `/quotation-builder?quote=${item.quotationId}&section=drafts`) : item.url;
    setOpen(false);
    navigate(target || '/quotation-builder');
  };
  return <div className="relative">
    <Button variant="ghost" size="icon" aria-label={`Notifications${center?.unreadCount ? `, ${center.unreadCount} unread` : ''}`} onClick={() => setOpen((value) => !value)} data-testid="button-notification-bell" className="relative">
      <Bell size={18}/>{Boolean(center?.unreadCount) && <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold leading-4 text-primary-foreground">{center?.unreadCount}</span>}
    </Button>
    {open && <section className="absolute right-0 top-12 z-50 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl">
      <header className="flex items-center justify-between border-b border-border px-4 py-3"><div><p className="text-sm font-semibold">Notifications</p><p className="text-[10px] text-muted-foreground">{center?.unreadCount || 0} unread</p></div><button type="button" className="text-[10px] font-semibold text-primary disabled:opacity-50" disabled={!center?.unreadCount || markAll.isPending} onClick={() => markAll.mutate(undefined, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) })}><CheckCheck size={13} className="mr-1 inline"/>Mark all read</button></header>
      <div className="max-h-[55dvh] overflow-y-auto">
        {notifications.isLoading ? <div className="space-y-2 p-4"><div className="h-12 animate-pulse rounded-lg bg-muted"/><div className="h-12 animate-pulse rounded-lg bg-muted/70"/></div>
          : notifications.isError ? <div className="p-5 text-center"><p className="text-xs text-destructive">Could not load notifications.</p><button className="mt-2 text-xs text-primary" onClick={() => void notifications.refetch()}>Retry</button></div>
            : !center?.items.length ? <div className="p-7 text-center"><Bell size={18} className="mx-auto text-muted-foreground"/><p className="mt-2 text-xs text-muted-foreground">You are all caught up.</p></div>
              : center.items.map((item) => <button type="button" key={item.id} onClick={() => openNotification(item)} className={`w-full border-b border-border/70 p-4 text-left transition-colors hover:bg-muted/60 ${item.readAt ? '' : 'bg-primary/[.04]'}`}><span className="flex items-start gap-2"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${item.readAt ? 'bg-muted-foreground/25' : 'bg-primary'}`}/><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{item.title}</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{item.message}</span><span className="mt-2 block text-[10px] text-muted-foreground">{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt))}</span></span><ExternalLink size={13} className="shrink-0 text-muted-foreground"/></span></button>)}
      </div>
      {prompt && pushReady && <div className="border-t border-border bg-secondary/40 p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold">Get important updates on this device</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">Enable browser notifications for approval decisions and requests.</p></div><button aria-label="Dismiss notification prompt" onClick={() => { setPrompt(false); localStorage.setItem('framewise-browser-notification-prompt', 'done'); }} className="text-xs text-muted-foreground">×</button></div><Button size="sm" className="mt-2 w-full" disabled={save.isPending || pushConfig.isLoading} onClick={enable}>{save.isPending ? 'Enabling…' : 'Enable browser notifications'}</Button></div>}
      {!prompt && pushReady && <div className="border-t border-border p-3">{'Notification' in window && Notification.permission === 'granted' ? <Button size="sm" variant="outline" className="w-full" disabled={remove.isPending} onClick={disable}>{remove.isPending ? 'Updating…' : 'Turn off push on this device'}</Button> : <Button size="sm" variant="outline" className="w-full" onClick={() => { setPrompt(true); localStorage.removeItem('framewise-browser-notification-prompt'); }}>Enable browser notifications</Button>}</div>}
    </section>}
  </div>;
}

const iconMap: Record<string, SidebarIconName> = {
  'user-access': 'user-access',
  'order-hub': 'order-hub',
  'quotation-builder': 'quotation-builder',
  'rate-approval': 'rate-approval',
  confirmation: 'confirmation',
  measurements: 'measurements',
  'qr-assembly': 'qr-assembly',
  'window-readiness': 'window-readiness',
  'glass-procurement': 'glass-procurement',
  payments: 'payments',
  'balance-payment': 'balance-payment',
  dispatch: 'dispatch',
  installation: 'installation',
};

const pathForModule = (key: string) => key === 'user-access' ? '/admin/users' : `/${key}`;
const isModuleActive = (key: string, location: string) => {
  const isDispatchScanner = location.startsWith('/order-scanner')
    && new URLSearchParams(window.location.search).get('flow') === 'dispatch';
  return key === 'user-access'
    ? location.startsWith('/admin/users') || location.startsWith('/admin/roles') || location.startsWith('/admin/groups')
    : key === 'order-hub'
      ? location.startsWith('/order-hub') || location.startsWith('/order-status')
      : key === 'dispatch'
        ? location.startsWith('/dispatch') || isDispatchScanner
    : location.startsWith(pathForModule(key));
};

const navigationGroups: { id: string; label: string; moduleKeys: string[] }[] = [
  { id: 'pre-production', label: 'Pre-production', moduleKeys: ['measurements', 'quotation-builder', 'confirmation'] },
  { id: 'materials', label: 'Materials', moduleKeys: ['glass-procurement'] },
  { id: 'finance', label: 'Finance', moduleKeys: ['payments', 'balance-payment'] },
  { id: 'fulfillment', label: 'Fulfillment', moduleKeys: ['dispatch', 'installation'] },
  { id: 'management', label: 'Admin & reports', moduleKeys: ['user-access'] },
];

export function AppShell({ user, children, title, eyebrow }: { user: User; children: React.ReactNode; title: string; eyebrow?: string }) {
  const [location, setLocation] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const queryClient = useQueryClient();
  const logout = useLogout();
  const isMasterAdmin = user.roleId === 'master-admin';
  const canManageApprover = isMasterAdmin || user.permissions?.['user-access'] === 'edit';
  const canOpenApprovalQueue = canManageApprover
    || user.roleId === 'approver'
    || user.permissions?.['rate-approval'] === 'edit';

  const signOut = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.setQueryData(getGetAuthSessionQueryKey(), { authenticated: false, user: null });
        setLocation('/');
      },
    });
  };

  const isModuleVisible = (module: (typeof MODULES)[number]) => {
    if (module.key === 'user-access' && !isMasterAdmin) return false;
    const permission = user.permissions?.[module.key];
    return permission === 'view' || permission === 'edit';
  };

  const getVisibleGroupModules = (group: (typeof navigationGroups)[number]) =>
    group.moduleKeys
      .map((key) => MODULES.find((module) => module.key === key))
      .filter((module): module is (typeof MODULES)[number] => Boolean(module && isModuleVisible(module)));

  const orderHubModule = MODULES.find((module) => module.key === 'order-hub');
  const canOpenOrderScanner = Boolean(orderHubModule && isModuleVisible(orderHubModule));

  const renderModuleLink = (module: (typeof MODULES)[number]) => {
    const iconName = iconMap[module.key] || 'overview';
    const path = pathForModule(module.key);
    const active = isModuleActive(module.key, location);
    const itemClass = `flex h-12 min-w-0 items-center rounded-lg text-sm transition-colors ${
      collapsed ? 'justify-center px-0' : 'gap-3 px-3'
    }`;

    if (!module.built) {
      return (
        <div
          key={module.key}
          className={`${itemClass} text-sidebar-foreground/38`}
          title={`${module.label} — Coming Soon`}
          aria-disabled="true"
          data-testid={`nav-coming-soon-${module.key}`}
        >
          <SidebarSectionIcon name={iconName} size={40} className="shrink-0" />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate whitespace-nowrap">{module.short}</span>
              <span className="shrink-0 text-[9px] uppercase tracking-wide text-sidebar-foreground/35">Soon</span>
            </>
          )}
          {collapsed && <span className="sr-only">{module.short} — Coming Soon</span>}
        </div>
      );
    }

    return (
      <Link
        key={module.key}
        href={path}
        onClick={() => setMobileOpen(false)}
        title={collapsed ? module.short : module.label}
        aria-current={active ? 'page' : undefined}
        className={`${itemClass} ${
          active
            ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
        }`}
        data-testid={`link-nav-${module.key}`}
      >
        <SidebarSectionIcon name={iconName} size={40} className="shrink-0" />
        {!collapsed && <span className="min-w-0 flex-1 truncate whitespace-nowrap">{module.short}</span>}
        {!collapsed && module.key === 'user-access' && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
      </Link>
    );
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <button
        className="fixed left-4 top-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar text-sidebar-foreground shadow-lg md:hidden"
        onClick={() => setMobileOpen((value) => !value)}
        aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
        data-testid="button-toggle-navigation"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-foreground/25 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" data-testid="button-close-navigation-overlay" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-200 ${collapsed ? 'w-[76px]' : 'w-[260px]'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className={`flex h-[76px] items-center gap-3 border-b border-sidebar-border ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
          <img
            src={`${import.meta.env.BASE_URL}shree-sai-window-mark.png`}
            alt="Shree Sai Wintech window logo"
            className={`block h-auto shrink-0 rounded-sm bg-white object-contain ${collapsed ? 'w-14' : 'w-16'}`}
          />
          {!collapsed && <div className="min-w-0"><p className="font-display text-sm font-bold tracking-tight">Framewise</p><p className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/50">Order operations</p></div>}
        </div>
        <div className="sidebar-scrollbar flex-1 overflow-y-auto px-3 py-5">
          <p className={`mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/40 ${collapsed ? 'text-center' : ''}`}>{collapsed ? '•••' : 'Workspace'}</p>
          <nav className="space-y-1" aria-label="Main navigation">
            <Link href="/" onClick={() => setMobileOpen(false)} title={collapsed ? 'Overview' : undefined} className={`flex h-12 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${location === '/' ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`} data-testid="link-nav-dashboard">
              <SidebarSectionIcon name="overview" size={40} className="shrink-0" />
              {!collapsed && <span className="flex-1">Overview</span>}
            </Link>
            <Link href="/communication" onClick={() => setMobileOpen(false)} title={collapsed ? 'Communication' : undefined} className={`flex h-12 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${location.startsWith('/communication') ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`} data-testid="link-nav-communication">
              <MessageSquareText size={24} className="mx-[2px] shrink-0" />
              {!collapsed && <span className="flex-1">Communication</span>}
            </Link>
            {canOpenOrderScanner && <Link href="/order-scanner" onClick={() => setMobileOpen(false)} title={collapsed ? 'QR scanner' : undefined} aria-current={location.startsWith('/order-scanner') ? 'page' : undefined} className={`flex h-12 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${location.startsWith('/order-scanner') ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`} data-testid="link-nav-order-scanner">
              <ScanLine size={24} className="mx-[2px] shrink-0" />
              {!collapsed && <span className="flex-1">QR scanner</span>}
              {collapsed && <span className="sr-only">QR scanner</span>}
            </Link>}
            {canOpenApprovalQueue && <Link href="/quotation-approvals" onClick={() => setMobileOpen(false)} title={collapsed ? 'Quotation approvals' : undefined} className={`flex h-12 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${location.startsWith('/quotation-approvals') ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`} data-testid="link-nav-quotation-approvals">
              <Bell size={22} className="mx-[3px] shrink-0" />
              {!collapsed && <span className="flex-1">Quotation approvals</span>}
            </Link>}
            <div aria-hidden="true" className="mx-3 my-3 border-t border-sidebar-border" />
            {orderHubModule && canOpenOrderScanner && renderModuleLink(orderHubModule)}
            {navigationGroups.map((group) => {
              const groupModules = getVisibleGroupModules(group);
              if (groupModules.length === 0) return null;

              return (
                <section key={group.id} className="pt-3" aria-label={group.label} data-testid={`nav-section-${group.id}`}>
                  <p className={collapsed ? 'sr-only' : 'px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45'}>
                    {group.label}
                  </p>
                  <div className={`space-y-1 ${collapsed ? '' : 'pl-2'}`}>
                    {groupModules.map(renderModuleLink)}
                  </div>
                </section>
              );
            })}
          </nav>
           {!collapsed && <div className="mt-7 rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-3"><p className="text-xs font-semibold text-sidebar-foreground">Modules 1 & 2 active</p><p className="mt-1 text-[11px] leading-relaxed text-sidebar-foreground/55">Access control and the central order register are ready for your team.</p></div>}
        </div>
        <div className="border-t border-sidebar-border p-3">
          <div title={collapsed ? `${user.name} · ${user.roleName}` : undefined} className={`mb-2 flex items-center gap-3 rounded-lg px-2 py-2 ${collapsed ? 'justify-center' : ''}`}>
            <UserAvatar name={user.name} src={user.avatarUrl} size="sm" className="bg-sidebar-accent text-sidebar-foreground" />
            {!collapsed && <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{user.name}</p><p className="truncate text-[10px] text-sidebar-muted">{user.roleName}</p></div>}
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title={collapsed ? 'Settings' : undefined}
            aria-label="Open settings"
            className={`mb-1 flex h-10 w-full items-center gap-2 rounded-lg px-3 text-xs text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary ${collapsed ? 'justify-center px-0' : ''}`}
            data-testid="button-open-settings"
          >
            <Settings2 size={18} />
            {!collapsed && <span>Settings</span>}
          </button>
          <button onClick={signOut} disabled={logout.isPending} title={collapsed ? 'Sign out' : undefined} aria-label={logout.isPending ? 'Signing out' : 'Sign out'} className={`flex h-10 w-full items-center gap-2 rounded-lg px-3 text-xs text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-50 ${collapsed ? 'justify-center' : ''}`} data-testid="button-sign-out"><LogOut size={18} />{!collapsed && (logout.isPending ? 'Signing out…' : 'Sign out')}</button>
        </div>
        <button onClick={() => setCollapsed((value) => !value)} className="absolute -right-3 top-[82px] hidden h-7 w-7 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent text-sidebar-foreground shadow-sm transition hover:bg-sidebar-primary hover:text-sidebar-primary-foreground md:flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} data-testid="button-toggle-sidebar">{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
      </aside>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} canManageApprover={canManageApprover} />
      <main className={`min-h-[100dvh] transition-[margin] duration-200 ${collapsed ? 'md:ml-[76px]' : 'md:ml-[260px]'}`}>
         <header className="sticky top-0 z-20 flex min-h-[76px] items-center justify-between gap-3 border-b border-border bg-background/90 px-4 pl-[72px] backdrop-blur sm:px-5 md:px-8">
           <div className="min-w-0"><p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow || 'Workspace'}</p><h1 className="mt-1 break-words font-display text-lg font-bold tracking-tight text-foreground sm:text-xl md:text-2xl">{title}</h1></div>
            <div className="flex items-center gap-2 sm:gap-3"><NotificationCenter navigate={(path) => setLocation(path)} />{canOpenApprovalQueue && <Link href="/quotation-approvals" className="hidden rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-primary sm:inline-flex">Approvals</Link>}<div className="hidden items-center gap-3 sm:flex"><span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary" />{user.roleName}</span><UserAvatar name={user.name} src={user.avatarUrl} size="md" /></div></div>
        </header>
        <div className="app-grid min-h-[calc(100dvh-76px)] px-5 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}