import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ChevronLeft, ChevronRight, LogOut, Menu, X } from 'lucide-react';
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

export function AppShell({ user, children, title, eyebrow }: { user: User; children: React.ReactNode; title: string; eyebrow?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const isMasterAdmin = user.roleId === 'master-admin';

  const signOut = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.setQueryData(getGetAuthSessionQueryKey(), { authenticated: false, user: null });
        setLocation('/');
      },
    });
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <button
        className="fixed left-4 top-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar text-sidebar-foreground shadow-lg md:hidden"
        onClick={() => setMobileOpen((value) => !value)}
        aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
        data-testid="button-toggle-navigation"
      >
        {mobileOpen ? <X size={18} /> : <Menu size={18} />}
      </button>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-foreground/25 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" data-testid="button-close-navigation-overlay" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-200 ${collapsed ? 'w-[76px]' : 'w-[260px]'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="flex h-[76px] items-center gap-3 border-b border-sidebar-border px-5">
          <div className="grid h-9 w-9 shrink-0 place-items-center"><SidebarSectionIcon name="brand" size={36} /></div>
          {!collapsed && <div className="min-w-0"><p className="font-display text-sm font-bold tracking-tight">Framewise</p><p className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/50">Order operations</p></div>}
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-5">
          <p className={`mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/40 ${collapsed ? 'text-center' : ''}`}>{collapsed ? '•••' : 'Workspace'}</p>
          <nav className="space-y-1" aria-label="Main navigation">
            <Link href="/" onClick={() => setMobileOpen(false)} className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${location === '/' ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`} data-testid="link-nav-overview">
              <SidebarSectionIcon name="overview" size={19} className="shrink-0" />
              {!collapsed && <span className="flex-1">Overview</span>}
            </Link>
            {MODULES.map((module) => {
              const iconName = iconMap[module.key] || 'overview';
              const path = pathForModule(module.key);
              const permission = user.permissions?.[module.key];
              const canAccess = permission === 'view' || permission === 'edit';
              const active = location.startsWith(path);
              if (module.key === 'user-access' && !isMasterAdmin) return null;
              if (!canAccess) return null;
              if (!module.built) {
                return (
                  <div key={module.key} className="group relative flex h-10 min-w-0 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground/38" title={`${module.label} — Coming Soon`} data-testid={`nav-coming-soon-${module.key}`}>
                    <SidebarSectionIcon name={iconName} size={19} className="shrink-0" />
                    {!collapsed && <><span className="min-w-0 flex-1 truncate whitespace-nowrap">{module.short}</span><span className="shrink-0 text-[9px] uppercase tracking-wide text-sidebar-foreground/35">Soon</span></>}
                  </div>
                );
              }
              return (
                <Link key={module.key} href={path} onClick={() => setMobileOpen(false)} title={module.label} className={`flex h-10 min-w-0 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${active ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`} data-testid={`link-nav-${module.key}`}>
                  <SidebarSectionIcon name={iconName} size={19} className="shrink-0" />
                  {!collapsed && <span className="min-w-0 flex-1 truncate whitespace-nowrap">{module.short}</span>}
                  {!collapsed && module.key === 'user-access' && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                </Link>
              );
            })}
            {isMasterAdmin && !collapsed && <Link href="/admin/roles" onClick={() => setMobileOpen(false)} className={`ml-8 flex h-8 items-center gap-2 rounded-lg px-3 text-xs transition-colors ${location === '/admin/roles' ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground' : 'text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`} data-testid="link-nav-roles"><SidebarSectionIcon name="roles" size={16} /> Roles & permissions</Link>}
          </nav>
          {!collapsed && <div className="mt-7 rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-3"><p className="text-xs font-semibold text-sidebar-foreground">Module 1 active</p><p className="mt-1 text-[11px] leading-relaxed text-sidebar-foreground/55">User access and permission controls are ready for your team.</p></div>}
        </div>
        <div className="border-t border-sidebar-border p-3">
          <div className={`mb-2 flex items-center gap-3 rounded-lg px-2 py-2 ${collapsed ? 'justify-center' : ''}`}>
            <UserAvatar name={user.name} src={user.avatarUrl} size="sm" className="bg-accent text-accent-foreground" />
            {!collapsed && <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{user.name}</p><p className="truncate text-[10px] text-sidebar-foreground/50">{user.roleName}</p></div>}
          </div>
          <button onClick={signOut} disabled={logout.isPending} className={`flex h-9 w-full items-center gap-2 rounded-lg px-3 text-xs text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-50 ${collapsed ? 'justify-center' : ''}`} data-testid="button-sign-out"><LogOut size={15} />{!collapsed && (logout.isPending ? 'Signing out…' : 'Sign out')}</button>
        </div>
        <button onClick={() => setCollapsed((value) => !value)} className="absolute -right-3 top-[82px] hidden h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm md:flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} data-testid="button-toggle-sidebar">{collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}</button>
      </aside>
      <main className={`min-h-[100dvh] transition-[margin] duration-200 ${collapsed ? 'md:ml-[76px]' : 'md:ml-[260px]'}`}>
        <header className="sticky top-0 z-20 flex min-h-[76px] items-center justify-between border-b border-border bg-background/90 px-5 pl-[72px] backdrop-blur md:px-8">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow || 'Workspace'}</p><h1 className="mt-1 font-display text-xl font-bold tracking-tight text-foreground md:text-2xl">{title}</h1></div>
          <div className="hidden items-center gap-3 sm:flex"><span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary" />{user.roleName}</span><UserAvatar name={user.name} src={user.avatarUrl} size="md" /></div>
        </header>
        <div className="app-grid min-h-[calc(100dvh-76px)] px-5 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}