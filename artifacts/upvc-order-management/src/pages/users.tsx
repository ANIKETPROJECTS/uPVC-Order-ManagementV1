import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Edit3, Mail, MoreHorizontal, Phone, Plus, Search, ShieldCheck, UserRound, UserX, X } from 'lucide-react';
import {
  getGetAdminSummaryQueryKey,
  getListRolesQueryKey,
  getListUsersQueryKey,
  useCreateUser,
  useDeactivateUser,
  useListRoles,
  useListUsers,
  useUpdateUser,
} from '@workspace/api-client-react';
import type { Role, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { MODULES, permissionValues, type PermissionValue } from '@/lib/modules';

type UserForm = { name: string; username: string; email: string; phone: string; roleId: string; password: string; permissionOverrides: Record<string, PermissionValue> };
const blankForm = (roleId = ''): UserForm => ({ name: '', username: '', email: '', phone: '', roleId, password: '', permissionOverrides: {} });
const formatDate = (date: string | null) => date ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date)) : 'Never';

export default function UsersPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const params = useMemo(() => ({ q: undefined as string | undefined, status: undefined as 'active' | 'inactive' | undefined }), []);
  const users = useListUsers(params, { query: { queryKey: getListUsersQueryKey(params) } });
  const roles = useListRoles({ query: { queryKey: getListRolesQueryKey() } });
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deactivateUser = useDeactivateUser();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(blankForm());
  const [error, setError] = useState('');
  const [menuUser, setMenuUser] = useState<string | null>(null);

  const roleList = roles.data || [];
  const filteredUsers = (users.data || []).filter((item) => {
    const matchesText = !search || [item.name, item.username, item.email || '', item.roleName].join(' ').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = status === 'all' || item.status === status;
    return matchesText && matchesStatus;
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListUsersQueryKey(params) });
    void queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
  };
  const openCreate = () => { setEditing(null); setError(''); setForm(blankForm(roleList[0]?.id || '')); setDialogOpen(true); };
  const openEdit = (item: User) => {
    setEditing(item); setError('');
    setForm({ name: item.name, username: item.username, email: item.email || '', phone: item.phone || '', roleId: item.roleId, password: '', permissionOverrides: item.permissionOverrides || {} });
    setDialogOpen(true); setMenuUser(null);
  };
  const updateField = <K extends keyof UserForm>(key: K, value: UserForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const saveUser = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!form.name.trim() || !form.username.trim() || !form.roleId || (!editing && form.password.length < 8) || (editing && form.password && form.password.length < 8)) {
      setError(editing ? 'Name, username and role are required. A new password must be at least 8 characters.' : 'Name, username, role and an 8-character password are required.');
      return;
    }
    const shared = { name: form.name.trim(), username: form.username.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null, roleId: form.roleId, permissionOverrides: Object.keys(form.permissionOverrides).length ? form.permissionOverrides : null };
    if (editing) {
      updateUser.mutate({ userId: editing.id, data: { ...shared, ...(form.password ? { password: form.password } : {}) } }, { onSuccess: () => { refresh(); setDialogOpen(false); } });
    } else {
      createUser.mutate({ data: { ...shared, password: form.password } }, { onSuccess: () => { refresh(); setDialogOpen(false); } });
    }
  };

  const deactivate = (item: User) => {
    setMenuUser(null);
    if (item.status === 'inactive' || !window.confirm(`Deactivate ${item.name}? They will no longer be able to sign in.`)) return;
    deactivateUser.mutate({ userId: item.id }, { onSuccess: refresh });
  };
  const mutationError = createUser.error || updateUser.error || deactivateUser.error;

  return <AppShell user={user} title="Users" eyebrow="Administration">
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm text-muted-foreground">People with access to Framewise and their effective permissions.</p></div><button onClick={openCreate} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground shadow-sm hover:brightness-105" data-testid="button-add-user"><Plus size={16} /> Add user</button></div>
      {mutationError && <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs text-destructive" data-testid="status-user-mutation-error">The change could not be saved. Please review the form and try again.</div>}
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between"><div className="relative max-w-sm flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, username or role" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" data-testid="input-search-users" /></div><div className="flex rounded-lg border border-input bg-background p-1"><button onClick={() => setStatus('all')} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold ${status === 'all' ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'}`} data-testid="button-filter-users-all">All</button><button onClick={() => setStatus('active')} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold ${status === 'active' ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'}`} data-testid="button-filter-users-active">Active</button><button onClick={() => setStatus('inactive')} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold ${status === 'inactive' ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'}`} data-testid="button-filter-users-inactive">Inactive</button></div></div>
        {users.isLoading ? <div className="space-y-3 p-5"><div className="h-12 animate-pulse rounded-xl bg-muted" /><div className="h-12 animate-pulse rounded-xl bg-muted" /><div className="h-12 animate-pulse rounded-xl bg-muted" /></div> : users.isError ? <div className="p-12 text-center"><p className="font-display font-bold">Users could not be loaded</p><p className="mt-2 text-sm text-muted-foreground">Check your connection and try again.</p><button onClick={() => void users.refetch()} className="mt-4 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground" data-testid="button-retry-users">Try again</button></div> : filteredUsers.length === 0 ? <div className="p-14 text-center"><UserRound className="mx-auto text-muted-foreground/50" size={28} /><p className="mt-3 font-display font-bold">No users match</p><p className="mt-1 text-sm text-muted-foreground">{search ? 'Try a different search.' : 'Add the first staff account to get started.'}</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><tr><th className="px-5 py-3 font-semibold">Person</th><th className="px-5 py-3 font-semibold">Role</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 font-semibold">Last sign in</th><th className="px-5 py-3 text-right font-semibold">Action</th></tr></thead><tbody className="divide-y divide-border">{filteredUsers.map((item) => <tr key={item.id} className="hover:bg-muted/20" data-testid={`row-user-${item.id}`}><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary font-display text-xs font-bold text-secondary-foreground">{item.name.slice(0, 1).toUpperCase()}</div><div><p className="text-sm font-semibold" data-testid={`text-user-name-${item.id}`}>{item.name}</p><p className="mt-0.5 text-xs text-muted-foreground">@{item.username}</p></div></div></td><td className="px-5 py-4"><span className="inline-flex items-center gap-1.5 text-xs font-medium"><ShieldCheck size={14} className="text-primary" />{item.roleName}</span></td><td className="px-5 py-4"><span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${item.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`} data-testid={`status-user-${item.id}`}>{item.status}</span></td><td className="px-5 py-4 text-xs text-muted-foreground">{formatDate(item.lastLogin)}</td><td className="relative px-5 py-4 text-right"><button onClick={() => setMenuUser(menuUser === item.id ? null : item.id)} className="inline-grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Actions for ${item.name}`} data-testid={`button-user-menu-${item.id}`}><MoreHorizontal size={17} /></button>{menuUser === item.id && <div className="absolute right-5 top-12 z-10 w-36 rounded-xl border border-border bg-popover p-1 text-left shadow-lg"><button onClick={() => openEdit(item)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-muted" data-testid={`button-edit-user-${item.id}`}><Edit3 size={14} /> Edit user</button>{item.status === 'active' && <button onClick={() => deactivate(item)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-destructive hover:bg-destructive/10" data-testid={`button-deactivate-user-${item.id}`}><UserX size={14} /> Deactivate</button>}</div>}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
    {dialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 p-4" role="dialog" aria-modal="true"><div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl"><div className="flex items-start justify-between border-b border-border p-5"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{editing ? 'Edit account' : 'New account'}</p><h2 className="mt-1 font-display text-xl font-bold">{editing ? editing.name : 'Add a team member'}</h2></div><button onClick={() => setDialogOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Close user form" data-testid="button-close-user-dialog"><X size={17} /></button></div><form onSubmit={saveUser} className="space-y-5 p-5"><div className="grid gap-4 sm:grid-cols-2"><label><span className="mb-1.5 block text-xs font-semibold">Full name</span><input value={form.name} onChange={(event) => updateField('name', event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-user-name" /></label><label><span className="mb-1.5 block text-xs font-semibold">Username</span><input value={form.username} onChange={(event) => updateField('username', event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-user-username" /></label><label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">Email <Mail size={12} className="text-muted-foreground" /></span><input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-user-email" /></label><label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">Phone <Phone size={12} className="text-muted-foreground" /></span><input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-user-phone" /></label><label><span className="mb-1.5 block text-xs font-semibold">Role</span><select value={form.roleId} onChange={(event) => updateField('roleId', event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-user-role"><option value="">Choose a role</option>{roleList.map((role: Role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label><span className="mb-1.5 block text-xs font-semibold">{editing ? 'New password (optional)' : 'Temporary password'}</span><input type="password" value={form.password} onChange={(event) => updateField('password', event.target.value)} placeholder={editing ? 'Leave unchanged' : 'At least 8 characters'} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-user-password" /></label></div><div className="rounded-xl border border-border bg-muted/30 p-4"><div className="flex items-start justify-between"><div><p className="text-xs font-bold">Permission overrides</p><p className="mt-1 text-[11px] text-muted-foreground">Optional. These values take priority over the selected role.</p></div><span className="text-[10px] uppercase tracking-wider text-muted-foreground">none / view / edit</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{MODULES.map((module) => <label key={module.key} className="flex items-center justify-between rounded-lg border border-border/70 bg-card px-3 py-2.5"><span className="text-xs font-medium">{module.label}</span><select value={form.permissionOverrides[module.key] || 'none'} onChange={(event) => updateField('permissionOverrides', { ...form.permissionOverrides, [module.key]: event.target.value as PermissionValue })} className="rounded-md border border-input bg-background px-2 py-1 text-[11px]" data-testid={`select-override-${module.key}`}><option value="none">None</option><option value="view">View</option><option value="edit">Edit</option></select></label>)}</div></div>{error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="status-user-form-error">{error}</p>}<div className="flex justify-end gap-3 border-t border-border pt-4"><button type="button" onClick={() => setDialogOpen(false)} className="rounded-lg px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted" data-testid="button-cancel-user">Cancel</button><button type="submit" disabled={createUser.isPending || updateUser.isPending} className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60" data-testid="button-save-user">{createUser.isPending || updateUser.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create user'}</button></div></form></div></div>}
  </AppShell>;
}