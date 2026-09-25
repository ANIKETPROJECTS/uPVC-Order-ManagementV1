import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Edit3, MessageSquareText, Plus, Trash2, UsersRound, X } from 'lucide-react';
import {
  getListChatGroupsQueryKey,
  getListChatPeopleQueryKey,
  useCreateChatGroup,
  useDeleteChatGroup,
  useListChatGroups,
  useListChatPeople,
  useUpdateChatGroup,
} from '@workspace/api-client-react';
import type { ChatGroup, ChatPerson, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { UserAccessNav } from '@/components/user-access-nav';
import { UserAvatar } from '@/components/user-avatar';

type GroupForm = { name: string; description: string; memberIds: string[] };

const emptyForm: GroupForm = { name: '', description: '', memberIds: [] };

export default function ChatGroupsPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const groups = useListChatGroups({ query: { queryKey: getListChatGroupsQueryKey(), refetchInterval: 15000 } });
  const people = useListChatPeople({ query: { queryKey: getListChatPeopleQueryKey() } });
  const createGroup = useCreateChatGroup();
  const updateGroup = useUpdateChatGroup();
  const deleteGroup = useDeleteChatGroup();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChatGroup | null>(null);
  const [form, setForm] = useState<GroupForm>(emptyForm);
  const [formError, setFormError] = useState('');

  const activePeople = useMemo(
    () => (people.data || []).filter((person) => person.status === 'active'),
    [people.data],
  );
  const memberChoices = useMemo(() => {
    const inactiveCurrentMembers = (editing?.members || []).filter(
      (member) => member.status === 'inactive' && form.memberIds.includes(member.id),
    );
    return [...activePeople, ...inactiveCurrentMembers];
  }, [activePeople, editing, form.memberIds]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListChatGroupsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListChatPeopleQueryKey() });
  };
  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setDialogOpen(true);
  };
  const openEdit = (group: ChatGroup) => {
    setEditing(group);
    setForm({ name: group.name, description: group.description || '', memberIds: group.memberIds });
    setFormError('');
    setDialogOpen(true);
  };
  const toggleMember = (id: string) => {
    setForm((current) => ({
      ...current,
      memberIds: current.memberIds.includes(id)
        ? current.memberIds.filter((memberId) => memberId !== id)
        : [...current.memberIds, id],
    }));
  };
  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.name.trim().length < 2) {
      setFormError('Give this group a name with at least two characters.');
      return;
    }
    if (form.memberIds.length < 2) {
      setFormError('Choose at least two group members.');
      return;
    }
    setFormError('');
    const data = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      memberIds: form.memberIds,
    };
    const onSuccess = () => {
      refresh();
      setDialogOpen(false);
    };
    if (editing) updateGroup.mutate({ groupId: editing.id, data }, { onSuccess });
    else createGroup.mutate({ data }, { onSuccess });
  };
  const removeGroup = (group: ChatGroup) => {
    if (!window.confirm(`Delete ${group.name}? It will disappear from everyone's chats. Existing message history will remain stored.`)) return;
    deleteGroup.mutate({ groupId: group.id }, { onSuccess: refresh });
  };
  const mutationError = createGroup.error || updateGroup.error || deleteGroup.error;
  const isSaving = createGroup.isPending || updateGroup.isPending;

  if (user.roleId !== 'master-admin') {
    return (
      <AppShell user={user} title="Communication groups" eyebrow="User access">
        <div className="flex min-h-[420px] items-center justify-center">
          <div className="max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
            <UsersRound className="mx-auto text-muted-foreground/60" size={30} />
            <h2 className="mt-4 font-display text-lg font-bold">Master Admin access required</h2>
            <p className="mt-2 text-sm text-muted-foreground">Only a Master Admin can configure communication groups.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} title="Communication groups" eyebrow="User access">
      <div className="space-y-6">
        <UserAccessNav active="groups" />
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm text-muted-foreground">Create focused channels for the teams that need to stay aligned.</p>
            <p className="mt-1 text-xs text-muted-foreground" data-testid="text-chat-groups-count">
              {(groups.data || []).length} active group{(groups.data || []).length === 1 ? '' : 's'}
            </p>
          </div>
          <button onClick={openCreate} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground" data-testid="button-add-chat-group">
            <Plus size={16} /> New group
          </button>
        </div>
        {mutationError && <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs text-destructive" data-testid="status-chat-group-error">The group change could not be saved. Try again.</div>}
        {groups.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2"><div className="h-40 animate-pulse rounded-2xl bg-card" /><div className="h-40 animate-pulse rounded-2xl bg-card" /></div>
        ) : groups.isError ? (
          <div className="rounded-2xl border border-destructive/20 bg-card p-10 text-center">
            <p className="font-display font-bold">Groups could not be loaded</p>
            <p className="mt-2 text-sm text-muted-foreground">Check your connection and try again.</p>
            <button onClick={() => void groups.refetch()} className="mt-4 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground" data-testid="button-retry-chat-groups">Try again</button>
          </div>
        ) : (groups.data || []).length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-14 text-center">
            <MessageSquareText className="mx-auto text-muted-foreground/50" size={30} />
            <p className="mt-3 font-display font-bold">No communication groups yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create one with at least two active users to make a shared channel.</p>
            <button onClick={openCreate} className="mt-4 rounded-lg bg-secondary px-4 py-2 text-xs font-semibold text-secondary-foreground" data-testid="button-empty-add-chat-group">Create a group</button>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {(groups.data || []).map((group) => (
              <article key={group.id} className="rounded-2xl border border-border bg-card p-5" data-testid={`card-chat-group-${group.id}`}>
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground"><MessageSquareText size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-display text-base font-bold" data-testid={`text-chat-group-name-${group.id}`}>{group.name}</h2>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{group.description || 'No description added.'}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(group)} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit ${group.name}`} data-testid={`button-edit-chat-group-${group.id}`}><Edit3 size={14} /></button>
                     <button onClick={() => removeGroup(group)} disabled={deleteGroup.isPending} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" aria-label={`Delete ${group.name}`} data-testid={`button-delete-chat-group-${group.id}`}><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  {group.members.slice(0, 5).map((member) => <div key={member.id} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-1" data-testid={`member-chat-group-${group.id}-${member.id}`}><UserAvatar name={member.name} src={member.avatarUrl} size="sm" /><span className="text-[10px] font-semibold">{member.name}</span></div>)}
                  {group.members.length > 5 && <span className="text-[10px] text-muted-foreground">+{group.members.length - 5} more</span>}
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.memberIds.length} members</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 p-4" role="dialog" aria-modal="true" aria-labelledby="chat-group-dialog-title">
          <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between border-b border-border p-5">
              <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{editing ? 'Edit group' : 'New group'}</p><h2 id="chat-group-dialog-title" className="mt-1 font-display text-xl font-bold">{editing ? editing.name : 'Create a communication group'}</h2></div>
              <button onClick={() => setDialogOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Close group form" data-testid="button-close-chat-group-dialog"><X size={17} /></button>
            </div>
            <form onSubmit={save} className="space-y-5 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label><span className="mb-1.5 block text-xs font-semibold">Group name</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={80} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-chat-group-name" /></label>
                <label><span className="mb-1.5 block text-xs font-semibold">Description <span className="font-normal text-muted-foreground">(optional)</span></span><input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={500} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-chat-group-description" /></label>
              </div>
              <fieldset>
                <legend className="text-xs font-semibold">Active members <span className="font-normal text-muted-foreground">({form.memberIds.length} selected, at least 2)</span></legend>
                <div className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                   {people.isLoading ? <div className="p-5 text-xs text-muted-foreground">Loading users...</div> : people.isError ? <div className="p-5 text-xs text-destructive">Users could not be loaded. <button type="button" onClick={() => void people.refetch()} className="font-semibold underline">Try again</button></div> : memberChoices.length === 0 ? <div className="p-5 text-xs text-muted-foreground">No active users are available.</div> : memberChoices.map((person: ChatPerson) => <label key={person.id} className={`flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/30 ${person.status === 'inactive' ? 'bg-muted/30' : ''}`}><input type="checkbox" checked={form.memberIds.includes(person.id)} onChange={() => toggleMember(person.id)} className="h-4 w-4 accent-[hsl(var(--primary))]" data-testid={`checkbox-chat-group-member-${person.id}`} /><UserAvatar name={person.name} src={person.avatarUrl} size="sm" /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{person.name}</span><span className="block text-[10px] text-muted-foreground">{person.roleName}</span></span><span className={`text-[10px] ${person.status === 'active' ? 'text-primary' : 'text-muted-foreground'}`}>{person.status}</span></label>)}
                </div>
              </fieldset>
              {formError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="status-chat-group-form-error">{formError}</p>}
              {mutationError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">The group change could not be saved. Try again.</p>}
              <div className="flex justify-end gap-3 border-t border-border pt-4"><button type="button" onClick={() => setDialogOpen(false)} className="rounded-lg px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted" data-testid="button-cancel-chat-group">Cancel</button><button type="submit" disabled={isSaving || people.isLoading || people.isError} className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60" data-testid="button-save-chat-group">{isSaving ? 'Saving...' : editing ? 'Save changes' : 'Create group'}</button></div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}