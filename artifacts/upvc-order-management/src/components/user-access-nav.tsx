import { Link } from 'wouter';
import { SidebarSectionIcon } from '@/components/sidebar-icons';

type UserAccessNavProps = {
  active: 'users' | 'roles';
};

const items = [
  { id: 'users', href: '/admin/users', label: 'Users', icon: 'user-access' },
  { id: 'roles', href: '/admin/roles', label: 'Roles & permissions', icon: 'roles' },
] as const;

export function UserAccessNav({ active }: UserAccessNavProps) {
  return (
    <nav
      aria-label="User access sections"
      className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
      data-testid="nav-user-access-sections"
    >
      {items.map((item) => {
        const isActive = active === item.id;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors ${
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
            data-testid={`link-user-access-${item.id}`}
          >
            <SidebarSectionIcon name={item.icon} size={18} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}