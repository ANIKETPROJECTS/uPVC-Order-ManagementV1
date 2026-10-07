import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownWideNarrow,
  Edit3,
  ImagePlus,
  LayoutGrid,
  Link2,
  List,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserRound,
  UserX,
  X,
} from 'lucide-react';
import {
  getGetAuthSessionQueryKey,
  getGetAdminSummaryQueryKey,
  getGetOperationsDashboardQueryKey,
  getListRolesQueryKey,
  getListUsersQueryKey,
  useCreateUser,
  useListRoles,
  useListUsers,
  useUpdateUser,
} from '@workspace/api-client-react';
import type { Role, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { AvatarCropper } from '@/components/avatar-cropper';
import { UserAccessNav } from '@/components/user-access-nav';
import { UserAvatar } from '@/components/user-avatar';
import { MODULES, type PermissionValue } from '@/lib/modules';

type PhotoMode = 'upload' | 'link';
type UserForm = {
  name: string;
  username: string;
  email: string;
  phone: string;
  roleId: string;
  installationCapacity: number;
  password: string;
  avatarUrl: string | null;
  avatarLink: string;
  photoMode: PhotoMode;
  permissionOverrides: Record<string, PermissionValue>;
};
type UserSort = 'name-asc' | 'name-desc' | 'role-asc' | 'last-login-desc' | 'last-login-asc';
type UserStatusFilter = 'all' | 'active' | 'inactive';
type UserView = 'table' | 'grid';

const blankForm = (roleId = ''): UserForm => ({
  name: '',
  username: '',
  email: '',
  phone: '',
  roleId,
  installationCapacity: 5,
  password: '',
  avatarUrl: null,
  avatarLink: '',
  photoMode: 'upload',
  permissionOverrides: {},
});

const formatDate = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date))
    : 'Never';

export default function UsersPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const params = useMemo(
    () => ({ q: undefined as string | undefined, status: undefined as 'active' | 'inactive' | undefined }),
    [],
  );
  const users = useListUsers(params, { query: { queryKey: getListUsersQueryKey(params) } });
  const roles = useListRoles({ query: { queryKey: getListRolesQueryKey() } });
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UserStatusFilter>('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [sortBy, setSortBy] = useState<UserSort>('name-asc');
  const [view, setView] = useState<UserView>('table');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(blankForm());
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [menuUser, setMenuUser] = useState<string | null>(null);

  const roleList = roles.data || [];
  const selectedRole = roleList.find((role) => role.id === form.roleId);
  const permissionForModule = (moduleKey: string): PermissionValue => {
    if (Object.prototype.hasOwnProperty.call(form.permissionOverrides, moduleKey)) {
      return form.permissionOverrides[moduleKey];
    }
    return selectedRole?.permissions[moduleKey] || 'none';
  };
  const showInstallationCapacity = permissionForModule('installation') !== 'none';
  const setPermissionOverride = (moduleKey: string, value: PermissionValue) => {
    const rolePermission = selectedRole?.permissions[moduleKey] || 'none';
    setForm((current) => {
      const permissionOverrides = { ...current.permissionOverrides };
      if (value === rolePermission) delete permissionOverrides[moduleKey];
      else permissionOverrides[moduleKey] = value;
      return { ...current, permissionOverrides };
    });
  };
  const allUsers = users.data || [];
  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const result = allUsers.filter((item) => {
      const matchesText =
        !normalizedSearch ||
        [item.name, item.username, item.email || '', item.phone || '', item.roleName]
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesStatus = status === 'all' || item.status === status;
      const matchesRole = roleFilter === 'all' || item.roleId === roleFilter;
      return matchesText && matchesStatus && matchesRole;
    });

    return result.sort((a, b) => {
      if (sortBy === 'name-asc') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      if (sortBy === 'name-desc') return b.name.localeCompare(a.name, undefined, { sensitivity: 'base' });
      if (sortBy === 'role-asc') {
        return a.roleName.localeCompare(b.roleName, undefined, { sensitivity: 'base' }) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }

      if (!a.lastLogin) return b.lastLogin ? 1 : 0;
      if (!b.lastLogin) return -1;
      const direction = sortBy === 'last-login-desc' ? -1 : 1;
      return (Date.parse(a.lastLogin) - Date.parse(b.lastLogin)) * direction;
    });
  }, [allUsers, roleFilter, search, sortBy, status]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListUsersQueryKey(params) });
    void queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetOperationsDashboardQueryKey() });
  };

  const openCreate = () => {
    setEditing(null);
    setError('');
    setPhotoError('');
    setCropFile(null);
    setForm(blankForm(roleList[0]?.id || ''));
    setDialogOpen(true);
  };

  const openEdit = (item: User) => {
    const isUploadedImage = item.avatarUrl?.startsWith('data:image/') ?? false;
    setEditing(item);
    setError('');
    setPhotoError('');
    setCropFile(null);
    setForm({
      name: item.name,
      username: item.username,
      email: item.email || '',
      phone: item.phone || '',
      roleId: item.roleId,
      installationCapacity: item.installationCapacity ?? 5,
      password: '',
      avatarUrl: isUploadedImage ? item.avatarUrl : null,
      avatarLink: item.avatarUrl && !isUploadedImage ? item.avatarUrl : '',
      photoMode: item.avatarUrl && !isUploadedImage ? 'link' : 'upload',
      permissionOverrides: item.permissionOverrides || {},
    });
    setDialogOpen(true);
    setMenuUser(null);
  };

  const updateField = <K extends keyof UserForm>(key: K, value: UserForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const saveUser = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (
      !form.name.trim() ||
      !form.username.trim() ||
      !form.roleId ||
      (!editing && form.password.length < 8) ||
      (editing && form.password && form.password.length < 8)
    ) {
      setError(
        editing
          ? 'Name, username and role are required. A new password must be at least 8 characters.'
          : 'Name, username, role and an 8-character password are required.',
      );
      return;
    }

    const avatarUrl = form.photoMode === 'link' ? form.avatarLink.trim() || null : form.avatarUrl;
    if (avatarUrl && !avatarUrl.startsWith('data:image/') && !/^https?:\/\/\S+$/i.test(avatarUrl)) {
      setError('Enter a valid HTTP or HTTPS image link for the profile photo.');
      return;
    }

    const shared = {
      name: form.name.trim(),
      username: form.username.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      roleId: form.roleId,
      installationCapacity: form.installationCapacity,
      avatarUrl,
      permissionOverrides: Object.keys(form.permissionOverrides).length ? form.permissionOverrides : null,
    };

    if (editing) {
      updateUser.mutate(
        { userId: editing.id, data: { ...shared, ...(form.password ? { password: form.password } : {}) } },
        {
          onSuccess: (updatedUser) => {
            refresh();
            if (updatedUser.id === user.id) {
              queryClient.setQueryData(getGetAuthSessionQueryKey(), { authenticated: true, user: updatedUser });
            }
            setDialogOpen(false);
          },
        },
      );
    } else {
      createUser.mutate(
        { data: { ...shared, password: form.password } },
        { onSuccess: () => { refresh(); setDialogOpen(false); } },
      );
    }
  };

  const selectPhotoMode = (photoMode: PhotoMode) => {
    setForm((current) => {
      const selectedPhoto = current.photoMode === 'link'
        ? current.avatarLink.trim() || current.avatarUrl
        : current.avatarUrl || current.avatarLink.trim() || null;
      return { ...current, photoMode, avatarUrl: selectedPhoto };
    });
    setCropFile(null);
    setPhotoError('');
  };

  const choosePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoError('Choose a JPEG, PNG or WebP image.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPhotoError('Choose an image smaller than 10 MB.');
      return;
    }
    setPhotoError('');
    setError('');
    setForm((current) => ({ ...current, photoMode: 'upload' }));
    setCropFile(file);
  };

  const applyPhotoCrop = (avatarUrl: string) => {
    setForm((current) => ({ ...current, avatarUrl, photoMode: 'upload' }));
    setCropFile(null);
    setPhotoError('');
  };

  const clearPhoto = () => {
    setForm((current) => ({ ...current, avatarUrl: null, avatarLink: '' }));
    setCropFile(null);
    setPhotoError('');
  };

  const changeStatus = (item: User) => {
    setMenuUser(null);
    const nextStatus = item.status === 'active' ? 'inactive' : 'active';
    const action = nextStatus === 'active' ? 'Activate' : 'Deactivate';
    if (!window.confirm(`${action} ${item.name}?`)) return;
    updateUser.mutate(
      { userId: item.id, data: { status: nextStatus } },
      {
        onSuccess: () => {
          refresh();
          if (item.id === user.id && nextStatus === 'inactive') {
            void queryClient.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() });
          }
        },
      },
    );
  };

  const renderActions = (item: User) => (
    <div className="relative">
      <button
        onClick={() => setMenuUser(menuUser === item.id ? null : item.id)}
        className="inline-grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Actions for ${item.name}`}
        aria-expanded={menuUser === item.id}
        data-testid={`button-user-menu-${item.id}`}
      >
        <MoreHorizontal size={17} />
      </button>
      {menuUser === item.id && (
        <div className="absolute right-0 top-9 z-20 w-36 rounded-xl border border-border bg-popover p-1 text-left shadow-lg">
          <button onClick={() => openEdit(item)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-muted" data-testid={`button-edit-user-${item.id}`}>
            <Edit3 size={14} /> Edit user
          </button>
          <button
            onClick={() => changeStatus(item)}
            disabled={updateUser.isPending}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-muted disabled:opacity-50 ${item.status === 'active' ? 'text-destructive hover:bg-destructive/10' : 'text-primary hover:bg-primary/10'}`}
            data-testid={`button-${item.status === 'active' ? 'deactivate' : 'activate'}-user-${item.id}`}
          >
            <UserX size={14} /> {item.status === 'active' ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      )}
    </div>
  );

  const mutationError = createUser.error || updateUser.error;
  const hasFilters = Boolean(search.trim()) || status !== 'all' || roleFilter !== 'all';
  const currentPhoto = form.photoMode === 'link' ? form.avatarLink.trim() : form.avatarUrl;
  const isSaving = createUser.isPending || updateUser.isPending;

  return (
    <AppShell user={user} title="Users" eyebrow="User access">
      <div className="space-y-6">
        <UserAccessNav active="users" />
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm text-muted-foreground">People with access to Framewise and their effective permissions.</p>
            <p className="mt-1 text-xs text-muted-foreground" data-testid="text-users-count">
              Showing {filteredUsers.length} of {allUsers.length} users
            </p>
          </div>
          <button onClick={openCreate} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground shadow-sm hover:brightness-105" data-testid="button-add-user">
            <Plus size={16} /> Add user
          </button>
        </div>

        {mutationError && (
          <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs text-destructive" data-testid="status-user-mutation-error">
            The change could not be saved. Please review the form and try again.
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="space-y-3 border-b border-border p-4">
            <div className="grid gap-3 xl:grid-cols-[minmax(220px,1fr)_auto_auto_auto]">
              <label className="relative block">
                <span className="sr-only">Search users</span>
                <Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name, username, email or role"
                  className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  data-testid="input-search-users"
                />
              </label>

              <label className="relative">
                <span className="sr-only">Filter by role</span>
                <SlidersHorizontal size={14} className="pointer-events-none absolute left-3 top-3 text-muted-foreground" />
                <select
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value)}
                  className="h-10 min-w-36 appearance-none rounded-lg border border-input bg-background pl-9 pr-8 text-xs outline-none focus:border-primary"
                  data-testid="select-filter-user-role"
                >
                  <option value="all">All roles</option>
                  {roleList.map((role: Role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </label>

              <label className="relative">
                <span className="sr-only">Sort users</span>
                <ArrowDownWideNarrow size={14} className="pointer-events-none absolute left-3 top-3 text-muted-foreground" />
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as UserSort)}
                  className="h-10 min-w-44 appearance-none rounded-lg border border-input bg-background pl-9 pr-8 text-xs outline-none focus:border-primary"
                  data-testid="select-sort-users"
                >
                  <option value="name-asc">Name: A to Z</option>
                  <option value="name-desc">Name: Z to A</option>
                  <option value="role-asc">Role: A to Z</option>
                  <option value="last-login-desc">Last sign-in: newest</option>
                  <option value="last-login-asc">Last sign-in: oldest</option>
                </select>
              </label>

              <div className="flex w-fit items-center rounded-lg border border-input bg-background p-1" role="group" aria-label="User layout">
                <button
                  type="button"
                  onClick={() => setView('table')}
                  aria-label="Table layout"
                  aria-pressed={view === 'table'}
                  title="Table layout"
                  className={`grid h-8 w-8 place-items-center rounded-md transition ${view === 'table' ? 'bg-secondary text-secondary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  data-testid="button-user-view-table"
                >
                  <List size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setView('grid')}
                  aria-label="Grid layout"
                  aria-pressed={view === 'grid'}
                  title="Grid layout"
                  className={`grid h-8 w-8 place-items-center rounded-md transition ${view === 'grid' ? 'bg-secondary text-secondary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  data-testid="button-user-view-grid"
                >
                  <LayoutGrid size={15} />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:inline">Status</span>
                <div className="flex rounded-lg border border-input bg-background p-1" role="group" aria-label="Filter users by status">
                  {(['all', 'active', 'inactive'] as const).map((value) => (
                    <button
                      key={value}
                      onClick={() => setStatus(value)}
                      aria-pressed={status === value}
                      className={`rounded-md px-3 py-1.5 text-[11px] font-semibold capitalize transition ${status === value ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                      data-testid={`button-filter-users-${value}`}
                    >
                      {value === 'all' ? 'All' : value}
                    </button>
                  ))}
                </div>
              </div>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setStatus('all'); setRoleFilter('all'); }}
                  className="text-[11px] font-semibold text-primary hover:underline"
                  data-testid="button-clear-user-filters"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {users.isLoading ? (
            <div className="space-y-3 p-5">
              <div className="h-12 animate-pulse rounded-xl bg-muted" />
              <div className="h-12 animate-pulse rounded-xl bg-muted" />
              <div className="h-12 animate-pulse rounded-xl bg-muted" />
            </div>
          ) : users.isError ? (
            <div className="p-12 text-center">
              <p className="font-display font-bold">Users could not be loaded</p>
              <p className="mt-2 text-sm text-muted-foreground">Check your connection and try again.</p>
              <button onClick={() => void users.refetch()} className="mt-4 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground" data-testid="button-retry-users">
                Try again
              </button>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-14 text-center">
              <UserRound className="mx-auto text-muted-foreground/50" size={28} />
              <p className="mt-3 font-display font-bold">{hasFilters ? 'No users match these filters' : 'No users yet'}</p>
              <p className="mt-1 text-sm text-muted-foreground">{hasFilters ? 'Adjust your search or clear the filters.' : 'Add the first staff account to get started.'}</p>
              {hasFilters && <button onClick={() => { setSearch(''); setStatus('all'); setRoleFilter('all'); }} className="mt-3 text-xs font-semibold text-primary hover:underline">Clear filters</button>}
            </div>
          ) : view === 'table' ? (
            <>
            <div className="grid gap-3 p-4 md:hidden">
              {filteredUsers.map((item) => (
                <article key={item.id} className="relative rounded-xl border border-border bg-background p-4" data-testid={`card-user-mobile-${item.id}`}>
                  <div className="absolute right-3 top-3">{renderActions(item)}</div>
                  <div className="flex min-w-0 items-center gap-3 pr-8">
                    <UserAvatar name={item.name} src={item.avatarUrl} size="lg" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold" data-testid={`text-user-name-mobile-${item.id}`}>{item.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">@{item.username}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold"><ShieldCheck size={12} className="shrink-0 text-primary" /><span className="truncate">{item.roleName}</span></span>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${item.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`} data-testid={`status-user-mobile-${item.id}`}>{item.status}</span>
                  </div>
                  <div className="mt-4 border-t border-border pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Last sign in</p>
                    <p className="mt-1 text-xs font-medium">{formatDate(item.lastLogin)}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-left">
                <thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Person</th>
                    <th className="px-5 py-3 font-semibold">Role</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Last sign in</th>
                    <th className="px-5 py-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredUsers.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/20" data-testid={`row-user-${item.id}`}>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <UserAvatar name={item.name} src={item.avatarUrl} />
                          <div>
                            <p className="text-sm font-semibold" data-testid={`text-user-name-${item.id}`}>{item.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">@{item.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4"><span className="inline-flex items-center gap-1.5 text-xs font-medium"><ShieldCheck size={14} className="text-primary" />{item.roleName}</span></td>
                      <td className="px-5 py-4"><span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${item.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`} data-testid={`status-user-${item.id}`}>{item.status}</span></td>
                      <td className="px-5 py-4 text-xs text-muted-foreground">{formatDate(item.lastLogin)}</td>
                      <td className="px-5 py-4 text-right">{renderActions(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          ) : (
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredUsers.map((item) => (
                <article key={item.id} className="relative rounded-xl border border-border bg-background p-4 transition hover:border-primary/30 hover:shadow-sm" data-testid={`card-user-${item.id}`}>
                  <div className="absolute right-3 top-3">{renderActions(item)}</div>
                  <div className="flex items-center gap-3 pr-8">
                    <UserAvatar name={item.name} src={item.avatarUrl} size="lg" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold" data-testid={`text-user-name-${item.id}`}>{item.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">@{item.username}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold"><ShieldCheck size={12} className="text-primary" />{item.roleName}</span>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${item.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`} data-testid={`status-user-${item.id}`}>{item.status}</span>
                  </div>
                  <div className="mt-4 border-t border-border pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Last sign in</p>
                    <p className="mt-1 text-xs font-medium">{formatDate(item.lastLogin)}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {dialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 p-2 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title">
          <div className="max-h-[calc(100dvh-1rem)] w-full max-w-5xl overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl sm:max-h-[92dvh]">
            <div className="flex items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{editing ? 'Edit account' : 'New account'}</p>
                <h2 id="user-dialog-title" className="mt-1 font-display text-xl font-bold">{editing ? editing.name : 'Add a team member'}</h2>
              </div>
              <button onClick={() => setDialogOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Close user form" data-testid="button-close-user-dialog"><X size={17} /></button>
            </div>

            <form onSubmit={saveUser} className="space-y-5 p-4 sm:p-5">
              <section className="rounded-xl border border-border bg-muted/20 p-4" aria-labelledby="user-photo-heading" data-testid="section-user-photo">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 id="user-photo-heading" className="text-xs font-bold">Profile photo</h3>
                    <p className="mt-1 text-[11px] text-muted-foreground">Upload a photo and crop it in a circle, or use an image link.</p>
                  </div>
                  <UserAvatar name={form.name || editing?.name || 'User'} src={currentPhoto} size="lg" />
                </div>

                <div className="mt-4 inline-flex rounded-lg border border-input bg-background p-1" role="group" aria-label="Choose profile photo source">
                  <button type="button" onClick={() => selectPhotoMode('upload')} aria-pressed={form.photoMode === 'upload'} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[11px] font-semibold transition ${form.photoMode === 'upload' ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'}`} data-testid="button-avatar-source-upload">
                    <Upload size={13} /> Upload
                  </button>
                  <button type="button" onClick={() => selectPhotoMode('link')} aria-pressed={form.photoMode === 'link'} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[11px] font-semibold transition ${form.photoMode === 'link' ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'}`} data-testid="button-avatar-source-link">
                    <Link2 size={13} /> Image link
                  </button>
                </div>

                {form.photoMode === 'upload' ? (
                  <div className="mt-4 space-y-3">
                    {cropFile ? (
                      <AvatarCropper file={cropFile} onApply={applyPhotoCrop} onCancel={() => setCropFile(null)} />
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 text-[11px] font-semibold hover:bg-muted">
                          <ImagePlus size={14} className="text-primary" />
                          Choose image
                          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} className="sr-only" data-testid="input-user-avatar-file" />
                        </label>
                        <p className="text-[10px] leading-4 text-muted-foreground">JPEG, PNG or WebP · max 10 MB · cropped image saved at 256 × 256</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold">Image URL</span>
                      <input
                        type="url"
                        maxLength={2048}
                        value={form.avatarLink}
                        onChange={(event) => updateField('avatarLink', event.target.value)}
                        placeholder="https://example.com/profile.jpg"
                        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                        data-testid="input-user-avatar-link"
                      />
                    </label>
                    <p className="text-[10px] text-muted-foreground">Use a direct HTTP or HTTPS image link.</p>
                  </div>
                )}

                {photoError && <p className="mt-3 text-xs text-destructive" role="alert" data-testid="status-user-photo-error">{photoError}</p>}
                {(form.avatarUrl || form.avatarLink) && !cropFile && (
                  <button type="button" onClick={clearPhoto} className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-destructive hover:underline" data-testid="button-clear-user-avatar">
                    <Trash2 size={13} /> Remove profile photo
                  </button>
                )}
              </section>

              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-xs font-semibold">Full name</span>
                  <input value={form.name} onChange={(event) => updateField('name', event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-user-name" />
                </label>
                <label>
                  <span className="mb-1.5 block text-xs font-semibold">Username</span>
                  <input value={form.username} onChange={(event) => updateField('username', event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-user-username" />
                </label>
                <label>
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">Email <Mail size={12} className="text-muted-foreground" /></span>
                  <input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-user-email" />
                </label>
                <label>
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">Phone <Phone size={12} className="text-muted-foreground" /></span>
                  <input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-user-phone" />
                </label>
                <label>
                  <span className="mb-1.5 block text-xs font-semibold">Role</span>
                  <select value={form.roleId} onChange={(event) => updateField('roleId', event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-user-role">
                    <option value="">Choose a role</option>
                    {roleList.map((role: Role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select>
                </label>
                {showInstallationCapacity && (
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold">Daily installation capacity</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      step={1}
                      value={form.installationCapacity}
                      onChange={(event) => updateField('installationCapacity', Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                      data-testid="input-user-installation-capacity"
                    />
                    <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">Maximum scheduled installations per day. New installer profiles default to 5.</span>
                  </label>
                )}
                <label>
                  <span className="mb-1.5 block text-xs font-semibold">{editing ? 'New password (optional)' : 'Temporary password'}</span>
                  <input type="password" value={form.password} onChange={(event) => updateField('password', event.target.value)} placeholder={editing ? 'Leave unchanged' : 'At least 8 characters'} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-user-password" />
                </label>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-bold">Permission overrides</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Defaults follow the selected role. Changes here become user-specific overrides.</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">none / view / edit</span>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {MODULES.map((module) => (
                    <label key={module.key} className="flex items-center justify-between rounded-lg border border-border/70 bg-card px-3 py-2.5">
                      <span className="text-xs font-medium">{module.label}</span>
                      <select
                        value={permissionForModule(module.key)}
                        onChange={(event) => setPermissionOverride(module.key, event.target.value as PermissionValue)}
                        className="rounded-md border border-input bg-background px-2 py-1 text-[11px]"
                        data-testid={`select-override-${module.key}`}
                      >
                        <option value="none">None</option>
                        <option value="view">View</option>
                        <option value="edit">Edit</option>
                      </select>
                    </label>
                  ))}
                </div>
              </div>

              {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="status-user-form-error">{error}</p>}
              <div className="flex justify-end gap-3 border-t border-border pt-4">
                <button type="button" onClick={() => setDialogOpen(false)} className="rounded-lg px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted" data-testid="button-cancel-user">Cancel</button>
                <button type="submit" disabled={isSaving} className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60" data-testid="button-save-user">
                  {isSaving ? 'Saving…' : editing ? 'Save changes' : 'Create user'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}