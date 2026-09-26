import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ChevronDown, ChevronLeft, ChevronRight, LogOut, Menu, MessageSquareText, ScanLine, X } from 'lucide-react';
import type { User } from '@workspace/api-client-react';
import { getGetAuthSessionQueryKey, useLogout } from '@workspace/api-client-react';
import { SidebarSectionIcon, type SidebarIconName } from '@/components/sidebar-icons';
import { UserAvatar } from '@/components/user-avatar';
import { MODULES } from '@/lib/modules';

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
  reporting: 'reporting',
};

const pathForModule = (key: string) => key === 'user-access' ? '/admin/users' : `/${key}`;
const isModuleActive = (key: string, location: string) =>
  key === 'user-access'
    ? location.startsWith('/admin/users') || location.startsWith('/admin/roles') || location.startsWith('/admin/groups')
    : key === 'order-hub'
      ? location.startsWith('/order-hub') || location.startsWith('/order-scanner') || location.startsWith('/order-status')
    : location.startsWith(pathForModule(key));

const navigationGroups: { id: string; label: string; icon: SidebarIconName; moduleKeys: string[] }[] = [
  { id: 'management', label: 'Admin & reports', icon: 'user-access', moduleKeys: ['user-access', 'reporting'] },
  { id: 'orders', label: 'Sales & orders', icon: 'order-hub', moduleKeys: ['order-hub', 'quotation-builder', 'rate-approval', 'confirmation'] },
  { id: 'production', label: 'Production', icon: 'measurements', moduleKeys: ['measurements', 'qr-assembly', 'window-readiness', 'glass-procurement'] },
  { id: 'finance', label: 'Finance', icon: 'payments', moduleKeys: ['payments', 'balance-payment'] },
  { id: 'fulfillment', label: 'Fulfillment', icon: 'dispatch', moduleKeys: ['dispatch', 'installation'] },
];

export function AppShell({ user, children, title, eyebrow }: { user: User; children: React.ReactNode; title: string; eyebrow?: string }) {
  const [location, setLocation] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<string[]>(() =>
    navigationGroups
      .filter((group) => group.moduleKeys.some((key) => isModuleActive(key, location)))
      .map((group) => group.id),
  );
  const queryClient = useQueryClient();
  const logout = useLogout();
  const isMasterAdmin = user.roleId === 'master-admin';

  useEffect(() => {
    const activeGroup = navigationGroups.find((group) =>
      group.moduleKeys.some((key) => isModuleActive(key, location)),
    );
    if (!activeGroup) return;
    setOpenGroups((current) =>
      current.includes(activeGroup.id) ? current : [...current, activeGroup.id],
    );
  }, [location]);

  const signOut = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.setQueryData(getGetAuthSessionQueryKey(), { authenticated: false, user: null });
        setLocation('/');
      },
    });
  };

  const toggleGroup = (groupId: string) => {
    setOpenGroups((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
  };

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
        <div className="flex h-[76px] items-center gap-3 border-b border-sidebar-border px-5">
          <div className="grid h-14 w-14 shrink-0 place-items-center"><SidebarSectionIcon name="brand" size={56} /></div>
          {!collapsed && <div className="min-w-0"><p className="font-display text-sm font-bold tracking-tight">Framewise</p><p className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/50">Order operations</p></div>}
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-5">
          <p className={`mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/40 ${collapsed ? 'text-center' : ''}`}>{collapsed ? '•••' : 'Workspace'}</p>
          <nav className="space-y-1" aria-label="Main navigation">
            <Link href="/" onClick={() => setMobileOpen(false)} className={`flex h-12 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${location === '/' ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`} data-testid="link-nav-overview">
              <SidebarSectionIcon name="overview" size={40} className="shrink-0" />
              {!collapsed && <span className="flex-1">Overview</span>}
            </Link>
            <Link href="/communication" onClick={() => setMobileOpen(false)} className={`flex h-12 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${location.startsWith('/communication') ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`} data-testid="link-nav-communication">
              <MessageSquareText size={24} className="mx-[2px] shrink-0" />
              {!collapsed && <span className="flex-1">Communication</span>}
            </Link>
            {navigationGroups.map((group) => {
              const groupModules = group.moduleKeys
                .map((key) => MODULES.find((module) => module.key === key))
                .filter((module): module is (typeof MODULES)[number] => {
                  if (!module) return false;
                  if (module.key === 'user-access' && !isMasterAdmin) return false;
                  const permission = user.permissions?.[module.key];
                  return permission === 'view' || permission === 'edit';
                });
              if (groupModules.length === 0) return null;

              const expanded = openGroups.includes(group.id);
              const active = groupModules.some((module) => isModuleActive(module.key, location));

              return (
                <section key={group.id} className="pt-1">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={expanded}
                    aria-controls={`nav-group-${group.id}`}
                    aria-label={`${group.label}, ${expanded ? 'collapse' : 'expand'}`}
                    title={collapsed ? group.label : undefined}
                    className={`relative flex h-12 w-full items-center rounded-lg text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                      collapsed ? 'justify-center px-0' : 'gap-2 px-3'
                    } ${
                      active
                        ? 'bg-sidebar-accent/60 text-sidebar-foreground'
                        : 'text-sidebar-foreground/55 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'
                    }`}
                    data-testid={`button-nav-group-${group.id}`}
                  >
                    <SidebarSectionIcon name={group.icon} size={36} className="shrink-0" />
                    {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>}
                    <ChevronDown
                      size={collapsed ? 12 : 16}
                      className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''} ${collapsed ? 'absolute bottom-1 right-2' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                  <div id={`nav-group-${group.id}`} className={`mt-1 space-y-1 ${expanded ? '' : 'hidden'}`}>
                    {groupModules.map(renderModuleLink)}
                    {group.id === 'orders' && groupModules.some((module) => module.key === 'order-hub') && (
                      <Link
                        href="/order-scanner"
                        onClick={() => setMobileOpen(false)}
                        title={collapsed ? 'QR scanner' : undefined}
                        aria-current={location.startsWith('/order-scanner') ? 'page' : undefined}
                        className={`flex h-12 min-w-0 items-center rounded-lg text-sm transition-colors ${
                          collapsed ? 'justify-center px-0' : 'gap-3 px-3'
                        } ${
                          location.startsWith('/order-scanner')
                            ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground'
                            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                        }`}
                        data-testid="link-nav-order-scanner"
                      >
                        <ScanLine size={24} className="mx-[2px] shrink-0" />
                        {!collapsed && <span className="min-w-0 flex-1 truncate whitespace-nowrap">QR scanner</span>}
                        {collapsed && <span className="sr-only">QR scanner</span>}
                      </Link>
                    )}
                  </div>
                </section>
              );
            })}
          </nav>
           {!collapsed && <div className="mt-7 rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-3"><p className="text-xs font-semibold text-sidebar-foreground">Modules 1 & 2 active</p><p className="mt-1 text-[11px] leading-relaxed text-sidebar-foreground/55">Access control and the central order register are ready for your team.</p></div>}
        </div>
        <div className="border-t border-sidebar-border p-3">
          <div className={`mb-2 flex items-center gap-3 rounded-lg px-2 py-2 ${collapsed ? 'justify-center' : ''}`}>
            <UserAvatar name={user.name} src={user.avatarUrl} size="sm" className="bg-accent text-accent-foreground" />
            {!collapsed && <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{user.name}</p><p className="truncate text-[10px] text-sidebar-foreground/50">{user.roleName}</p></div>}
          </div>
          <button onClick={signOut} disabled={logout.isPending} className={`flex h-10 w-full items-center gap-2 rounded-lg px-3 text-xs text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-50 ${collapsed ? 'justify-center' : ''}`} data-testid="button-sign-out"><LogOut size={18} />{!collapsed && (logout.isPending ? 'Signing out…' : 'Sign out')}</button>
        </div>
        <button onClick={() => setCollapsed((value) => !value)} className="absolute -right-3 top-[82px] hidden h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm md:flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} data-testid="button-toggle-sidebar">{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
      </aside>
      <main className={`min-h-[100dvh] transition-[margin] duration-200 ${collapsed ? 'md:ml-[76px]' : 'md:ml-[260px]'}`}>
         <header className="sticky top-0 z-20 flex min-h-[76px] items-center justify-between gap-3 border-b border-border bg-background/90 px-4 pl-[72px] backdrop-blur sm:px-5 md:px-8">
           <div className="min-w-0"><p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow || 'Workspace'}</p><h1 className="mt-1 break-words font-display text-lg font-bold tracking-tight text-foreground sm:text-xl md:text-2xl">{title}</h1></div>
          <div className="hidden items-center gap-3 sm:flex"><span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary" />{user.roleName}</span><UserAvatar name={user.name} src={user.avatarUrl} size="md" /></div>
        </header>
        <div className="app-grid min-h-[calc(100dvh-76px)] px-5 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}