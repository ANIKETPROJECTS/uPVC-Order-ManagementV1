import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowLeft, ArrowUpDown, Check, ChevronDown, CircleAlert, LayoutGrid,
  List, Plus, Search, ShieldCheck, Trash2, Users, UsersRound, X,
} from 'lucide-react';
import {
  getListInstallationOrdersQueryKey, getListInstallationTeamsQueryKey,
  getListInstallationUsersQueryKey, useCreateInstallationTeam,
  useDeleteInstallationTeam, useListInstallationTeams, useListInstallationUsers,
  useUpdateInstallationTeam,
} from '@workspace/api-client-react';
import type { InstallationTeam, InstallationTeamInput, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

type DraftSubteam = { id?: string; name: string; memberIds: string[] };
type TeamSort = 'name' | 'recent' | 'members';
type Member = { id: string; name: string; username: string; roleName: string };

const canAccessTeams = (user: User, edit = false) =>
  user.roleId === 'master-admin' || user.permissions?.installation === 'edit' ||
  (!edit && user.permissions?.installation === 'view');

const errorMessage = (error: unknown) => {
  if (error && typeof error === 'object') {
    const candidate = error as { message?: string; response?: { data?: { message?: string; error?: string } } };
    return candidate.response?.data?.message || candidate.response?.data?.error || candidate.message || 'Please review the team and try again.';
  }
  return 'Please review the team and try again.';
};

function MemberPicker({ members, selected, onChange, label }: {
  members: Member[]; selected: string[]; onChange: (ids: string[]) => void; label: string;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const visibleMembers = members.filter((member) =>
    `${member.name} ${member.username} ${member.roleName}`.toLowerCase().includes(query),
  );
  const toggleMember = (id: string) => onChange(
    selected.includes(id) ? selected.filter((memberId) => memberId !== id) : [...selected, id],
  );

  return <div className="space-y-3" data-testid={`picker-${label}`}>
    <label className="relative block">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, username, or role…" aria-label={`Search ${label}`} className="h-10 pl-9 text-xs" data-testid={`input-search-${label}`} />
    </label>
    {selected.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label={`Selected ${label}`}>
      {selected.map((id) => {
        const name = members.find((member) => member.id === id)?.name || 'Unavailable member';
        return <button key={id} type="button" onClick={() => toggleMember(id)} className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[.06] px-2.5 py-1 text-[11px] font-semibold text-primary transition hover:border-primary/45" aria-label={`Remove ${name} from ${label}`} data-testid={`remove-selected-${label}-${id}`}>
          {name}<X size={12} />
        </button>;
      })}
    </div>}
    {visibleMembers.length === 0
      ? <p className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-xs text-muted-foreground">{members.length ? 'No eligible users match this search.' : 'No eligible Installation users are available.'}</p>
      : <div className="grid gap-2 sm:grid-cols-2" aria-label={`${label} users`}>
        {visibleMembers.map((member) => {
        const checked = selected.includes(member.id);
          return <label key={member.id} className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${checked ? 'border-primary/35 bg-primary/[.045]' : 'border-border bg-background hover:border-primary/25'}`}>
            <input type="checkbox" checked={checked} onChange={() => toggleMember(member.id)} className="size-4 accent-[hsl(var(--primary))]" data-testid={`checkbox-${label}-${member.id}`} />
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary font-display text-xs font-bold text-secondary-foreground">{member.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span>
            <span className="min-w-0"><span className="block truncate text-xs font-semibold">{member.name}</span><span className="block truncate text-[10px] text-muted-foreground">@{member.username} · {member.roleName}</span></span>
            {checked && <Check size={15} className="ml-auto shrink-0 text-primary" />}
          </label>;
        })}
      </div>}
  </div>;
}

function TeamEditor({ team, users, pending, onClose, onSave }: {
  team: InstallationTeam | null; users: Member[]; pending: boolean;
  onClose: () => void; onSave: (id: string | null, input: InstallationTeamInput) => void;
}) {
  const [name, setName] = useState(team?.name || '');
  const [phone, setPhone] = useState(team?.phone || '');
  const [memberIds, setMemberIds] = useState<string[]>(() => team?.memberIds || []);
  const [subteams, setSubteams] = useState<DraftSubteam[]>(() => team?.subteams.map((item) => ({ id: item.id, name: item.name, memberIds: [...item.memberIds] })) || []);
  const [newSubteamName, setNewSubteamName] = useState('');
  const [newSubteamMembers, setNewSubteamMembers] = useState<string[]>([]);
  const [error, setError] = useState('');

  const parentMembers = users.filter((member) => memberIds.includes(member.id));
  const changeParents = (ids: string[]) => {
    setMemberIds(ids);
    setSubteams((items) => items.map((item) => ({ ...item, memberIds: item.memberIds.filter((id) => ids.includes(id)) })));
    setNewSubteamMembers((idsNow) => idsNow.filter((id) => ids.includes(id)));
  };
  const addSubteam = () => {
    if (!newSubteamName.trim() || !newSubteamMembers.length) {
      setError('Each subdivision needs a name and at least one parent-team member.');
      return;
    }
    setSubteams((items) => [...items, { name: newSubteamName.trim(), memberIds: newSubteamMembers }]);
    setNewSubteamName('');
    setNewSubteamMembers([]);
    setError('');
  };
  const submit = () => {
    if (!name.trim() || !memberIds.length) { setError('Enter a team name and select at least one member.'); return; }
    if (subteams.some((item) => !item.name.trim() || !item.memberIds.length || item.memberIds.some((id) => !memberIds.includes(id)))) {
      setError('Every subdivision needs a name and members from this parent team.');
      return;
    }
    const removedSubteams = team?.subteams.filter((item) => !subteams.some((draft) => draft.id === item.id)) ?? [];
    if (removedSubteams.length && !window.confirm(`Remove ${removedSubteams.map((item) => item.name).join(', ')}? Active installations assigned to those subdivisions will be unassigned and their visit dates retained. Completed installation records will stay in history.`)) return;
    onSave(team?.id || null, { name: name.trim(), phone: phone.trim(), memberIds, subteams: subteams.map((item) => ({ ...item, name: item.name.trim() })) });
  };

  return <section className="scroll-mt-4 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm" data-testid="panel-installation-team-editor">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/75 bg-muted/15 px-4 py-4 md:px-6">
      <div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-primary">{team ? 'Team changes' : 'New field crew'}</p><h2 className="mt-1 font-display text-xl font-bold tracking-tight">{team ? 'Edit installation team' : 'Create installation team'}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Select the existing Installation users who will work together. Subdivision membership stays within the parent team.</p></div>
      <Button type="button" variant="outline" onClick={onClose} disabled={pending} data-testid="button-close-installation-team-editor">Cancel</Button>
    </header>
    <div className="space-y-5 p-4 md:p-6">
       <div className="grid gap-4 sm:grid-cols-2">
         <label className="block max-w-xl space-y-2"><span className="text-xs font-bold">Team name</span><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="e.g. North field crew" data-testid="input-installation-team-name" /></label>
         <label className="block max-w-xl space-y-2"><span className="text-xs font-bold">Team phone</span><Input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} placeholder="Crew contact number" data-testid="input-installation-team-phone" /></label>
       </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
        <section className="min-w-0 space-y-3 rounded-2xl border border-border/75 bg-background/60 p-4">
          <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="text-sm font-bold">Parent team members</h3><p className="mt-1 text-xs text-muted-foreground">Search and select eligible users from the existing user list.</p></div><span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[11px] font-semibold text-secondary-foreground">{memberIds.length} selected</span></div>
          <MemberPicker members={users} selected={memberIds} onChange={changeParents} label="parent-members" />
        </section>
        <section className="min-w-0 space-y-4 rounded-2xl border border-border/75 bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-bold">Subdivisions</h3><p className="mt-1 text-xs text-muted-foreground">Optional crews for teams working at different sites.</p></div><span className="rounded-full bg-background px-2.5 py-1 font-mono text-[11px]">{subteams.length}</span></div>
          {subteams.map((subteam, index) => <div key={subteam.id || `${subteam.name}-${index}`} className="space-y-3 rounded-xl border border-border bg-card p-3" data-testid={`row-installation-subteam-${index}`}>
            <div className="flex gap-2"><Input value={subteam.name} onChange={(event) => setSubteams((items) => items.map((item, at) => at === index ? { ...item, name: event.target.value } : item))} aria-label={`Subdivision ${index + 1} name`} data-testid={`input-installation-subteam-name-${index}`} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove subdivision" onClick={() => setSubteams((items) => items.filter((_, at) => at !== index))} data-testid={`button-remove-subteam-${index}`}><X size={16} /></Button>
            </div>
            <MemberPicker members={parentMembers} selected={subteam.memberIds} onChange={(ids) => setSubteams((items) => items.map((item, at) => at === index ? { ...item, memberIds: ids } : item))} label={`subteam-${index}`} />
          </div>)}
          <div className="space-y-3 rounded-xl border border-dashed border-primary/30 bg-background/75 p-3">
            <Input value={newSubteamName} onChange={(event) => setNewSubteamName(event.target.value)} placeholder="Subdivision name" aria-label="New subdivision name" data-testid="input-installation-subteam-name" />
            <MemberPicker members={parentMembers} selected={newSubteamMembers} onChange={setNewSubteamMembers} label="new-subteam" />
            <Button type="button" variant="outline" size="sm" onClick={addSubteam} data-testid="button-add-installation-subteam"><Plus size={14} /> Add subdivision</Button>
          </div>
        </section>
      </div>
      {error && <p className="rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-team-form-error">{error}</p>}
    </div>
    <footer className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border/75 bg-card/95 px-4 py-3 backdrop-blur md:px-6">
      <p className="text-[11px] text-muted-foreground">Changes are used by the Installation order scheduler.</p>
      <div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={pending} data-testid="button-cancel-installation-team">Cancel</Button><Button type="button" disabled={pending} onClick={submit} data-testid="button-save-installation-team">{pending ? 'Saving…' : team ? 'Save team' : 'Create team'}</Button></div>
    </footer>
  </section>;
}

export default function InstallationTeamsPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canEdit = canAccessTeams(user, true);
  const teamsQuery = useListInstallationTeams({ query: { enabled: canEdit, queryKey: getListInstallationTeamsQueryKey() } });
  const usersQuery = useListInstallationUsers({ query: { enabled: canEdit, queryKey: getListInstallationUsersQueryKey() } });
  const createTeam = useCreateInstallationTeam();
  const updateTeam = useUpdateInstallationTeam();
  const deleteTeam = useDeleteInstallationTeam();
  const teams = teamsQuery.data || [];
  const users = usersQuery.data || [];
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'subdivisions' | 'single'>('all');
  const [sort, setSort] = useState<TeamSort>('name');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const editorRef = useRef<HTMLDivElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<InstallationTeam | null>(null);

  const visibleTeams = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return teams.filter((team) => {
      const matches = !needle || `${team.name} ${team.phone} ${team.memberIds.map((id) => users.find((userItem) => userItem.id === id)?.name || '').join(' ')} ${team.subteams.map((subteam) => subteam.name).join(' ')}`.toLowerCase().includes(needle);
      return matches && (filter === 'all' || (filter === 'subdivisions' ? team.subteams.length > 0 : team.subteams.length === 0));
    }).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'members' ? b.memberIds.length - a.memberIds.length : b.updatedAt.localeCompare(a.updatedAt));
  }, [teams, users, search, filter, sort]);

  const closeEditor = () => { setEditorOpen(false); setEditingTeam(null); };
  const openNewEditor = () => { setEditingTeam(null); setEditorOpen(true); };
  const openTeamEditor = (team: InstallationTeam) => { setEditingTeam(team); setEditorOpen(true); };
  useEffect(() => {
    if (editorOpen) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [editorOpen, editingTeam]);

  const persist = (id: string | null, data: InstallationTeamInput) => {
    const options = {
      onSuccess: () => {
        closeEditor();
        void queryClient.invalidateQueries({ queryKey: getListInstallationTeamsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListInstallationOrdersQueryKey() });
        toast({ title: id ? 'Team changes saved' : 'Team created', description: data.name });
      },
      onError: (error: unknown) => toast({ title: 'Team could not be saved', description: errorMessage(error), variant: 'destructive' as const }),
    };
    if (id) updateTeam.mutate({ id, data }, options);
    else createTeam.mutate({ data }, options);
  };
  const removeTeam = (team: InstallationTeam) => {
    if (!window.confirm(`Delete “${team.name}” and its subdivisions? Active orders assigned to this team will be unassigned, and their visit dates will be retained. Completed installation records will stay in history.`)) return;
    deleteTeam.mutate({ id: team.id }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListInstallationTeamsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListInstallationOrdersQueryKey() });
        toast({ title: 'Team deleted', description: team.name });
      },
      onError: (error: unknown) => toast({ title: 'Team could not be deleted', description: errorMessage(error), variant: 'destructive' }),
    });
  };

  return <AppShell user={user} title="Installation teams" eyebrow="Fulfillment · field structure">
    <main className="mx-auto w-full max-w-[1440px] space-y-6 pb-10">
      {!canEdit ? <section className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-border bg-card p-8 text-center" data-testid="state-installation-teams-access-denied"><div><ShieldCheck size={26} className="mx-auto text-muted-foreground" /><h1 className="mt-3 font-display text-lg font-bold">Installation edit access required</h1><p className="mt-1 text-sm text-muted-foreground">Ask an administrator for permission to manage Installation teams.</p><Link href="/installation" className="mt-4 inline-flex text-sm font-semibold text-primary">Back to register</Link></div></section> : <>
        <header className="order-hub-accent relative overflow-hidden rounded-2xl border border-primary/10 px-5 py-6 shadow-sm md:px-8 md:py-8" data-testid="panel-installation-teams-intro">
          <div className="relative flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-2xl"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary"><UsersRound size={14} /> Crew structure</p><h1 className="mt-3 font-display text-3xl font-bold tracking-[-.05em] md:text-[2.75rem]">Teams that show up together.</h1><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Keep field crews and their subdivisions clear, current, and ready for the next site visit.</p></div>
            <div className="flex flex-wrap gap-2"><Link href="/installation" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background/80 px-4 text-xs font-bold transition hover:border-primary/35 hover:text-primary" data-testid="link-back-to-installation"><ArrowLeft size={14} /> Installation register</Link>{canEdit && <Button type="button" onClick={openNewEditor} disabled={editorOpen || createTeam.isPending || updateTeam.isPending} data-testid="button-create-installation-team"><Plus size={15} /> New team</Button>}</div>
          </div>
          <div className="relative mt-7 grid max-w-lg grid-cols-2 gap-3"><div className="rounded-xl border border-primary/10 bg-background/65 px-4 py-3"><p className="text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">Field teams</p><p className="mt-1 font-display text-2xl font-bold">{teamsQuery.isLoading ? '—' : teams.length}</p></div><div className="rounded-xl border border-primary/10 bg-background/65 px-4 py-3"><p className="text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">Crew subdivisions</p><p className="mt-1 font-display text-2xl font-bold">{teamsQuery.isLoading ? '—' : teams.reduce((total, team) => total + team.subteams.length, 0)}</p></div></div>
        </header>

        {editorOpen && <div ref={editorRef} className="scroll-mt-4" data-testid="container-installation-team-editor">
          <TeamEditor key={editingTeam?.id || 'new'} team={editingTeam} users={users} pending={createTeam.isPending || updateTeam.isPending} onClose={closeEditor} onSave={persist} />
        </div>}

        {teamsQuery.isLoading ? <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading installation teams" data-testid="state-installation-teams-loading">{[0, 1, 2].map((item) => <div key={item} className="h-52 animate-pulse rounded-2xl border border-border bg-card/70" />)}</section>
          : teamsQuery.isError ? <section className="grid min-h-60 place-items-center rounded-2xl border border-destructive/20 bg-destructive/[.035] p-6 text-center" data-testid="state-installation-teams-error"><div><CircleAlert size={24} className="mx-auto text-destructive" /><h2 className="mt-3 font-display font-bold">Team list unavailable</h2><p className="mt-1 text-sm text-muted-foreground">The crew structure could not be loaded.</p><Button type="button" variant="outline" className="mt-4" onClick={() => void teamsQuery.refetch()} data-testid="button-retry-installation-teams">Retry</Button></div></section>
            : <>
              <section className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3 shadow-sm md:flex-row md:items-center md:p-4" aria-label="Team filters">
                <label className="relative min-w-0 flex-1"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search teams, members, subdivisions…" className="h-10 pl-9 text-xs" aria-label="Search installation teams" data-testid="input-installation-team-search" /></label>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="relative"><span className="sr-only">Filter teams</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="h-10 appearance-none rounded-lg border border-input bg-background py-2 pl-3 pr-8 text-xs font-semibold" data-testid="select-installation-team-filter"><option value="all">All teams</option><option value="subdivisions">With subdivisions</option><option value="single">No subdivisions</option></select><ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /></label>
                  <label className="relative"><span className="sr-only">Sort teams</span><select value={sort} onChange={(event) => setSort(event.target.value as TeamSort)} className="h-10 appearance-none rounded-lg border border-input bg-background py-2 pl-3 pr-8 text-xs font-semibold" data-testid="select-installation-team-sort"><option value="name">Name A–Z</option><option value="recent">Recently updated</option><option value="members">Most members</option></select><ArrowUpDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /></label>
                  <div className="flex rounded-lg border border-border bg-muted/35 p-1" aria-label="Team layout">
                    <button type="button" aria-label="Grid layout" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')} className={`grid size-8 place-items-center rounded-md ${layout === 'grid' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`} data-testid="button-installation-team-grid"><LayoutGrid size={15} /></button>
                    <button type="button" aria-label="List layout" aria-pressed={layout === 'list'} onClick={() => setLayout('list')} className={`grid size-8 place-items-center rounded-md ${layout === 'list' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`} data-testid="button-installation-team-list"><List size={15} /></button>
                  </div>
                </div>
              </section>
              {usersQuery.isError && canEdit && <p className="rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-xs text-amber-950" data-testid="state-installation-users-error">Eligible users could not be loaded. <button type="button" className="font-bold underline" onClick={() => void usersQuery.refetch()}>Retry user list</button></p>}
              {visibleTeams.length === 0 ? <section className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center" data-testid="state-installation-teams-empty"><div><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><Users size={21} /></div><h2 className="mt-4 font-display text-lg font-bold">{teams.length ? 'No teams match those filters' : 'Start with your first field team'}</h2><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{teams.length ? 'Try another search or clear the subdivision filter.' : 'Create a team with eligible users, then divide the crew into site-ready subdivisions.'}</p>{teams.length ? <Button type="button" variant="outline" className="mt-4" onClick={() => { setSearch(''); setFilter('all'); }} data-testid="button-reset-installation-team-filters">Clear filters</Button> : canEdit && !editorOpen && <Button type="button" className="mt-4" onClick={openNewEditor} data-testid="button-create-first-installation-team"><Plus size={15} /> Create first team</Button>}</div></section>
                : <section className={layout === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-3'} aria-label="Installation teams" data-testid="list-installation-teams">
                  {visibleTeams.map((team) => {
                    const teamMembers = team.memberIds.map((id) => users.find((member) => member.id === id)).filter((member): member is Member => Boolean(member));
                    const memberCount = team.memberIds.length;
                    return <article key={team.id} className={`group rounded-2xl border border-border/80 bg-card p-4 shadow-sm transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/30 ${layout === 'list' ? 'md:flex md:items-center md:gap-6 md:px-5' : ''}`} data-testid={`card-installation-team-${team.id}`}>
                       <div className="flex min-w-0 items-start gap-3"><div className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><UsersRound size={20} /></div><div className="min-w-0 flex-1"><h2 className="truncate font-display text-lg font-bold tracking-tight" data-testid={`text-installation-team-name-${team.id}`}>{team.name}</h2><p className="mt-1 text-[11px] text-muted-foreground" data-testid={`text-installation-team-summary-${team.id}`}>{memberCount} {memberCount === 1 ? 'member' : 'members'} <span className="mx-1 text-border">·</span> {team.subteams.length} {team.subteams.length === 1 ? 'subdivision' : 'subdivisions'}</p>{team.phone && <p className="mt-1 text-[11px] font-medium text-primary" data-testid={`text-installation-team-phone-${team.id}`}>{team.phone}</p>}</div>
                        {canEdit && <div className="flex shrink-0 gap-1"><Button type="button" variant="ghost" size="icon" aria-label={`Edit ${team.name}`} disabled={editorOpen || createTeam.isPending || updateTeam.isPending} onClick={() => openTeamEditor(team)} data-testid={`button-edit-installation-team-${team.id}`}><span className="text-[11px] font-bold">Edit</span></Button><Button type="button" variant="ghost" size="icon" aria-label={`Delete ${team.name}`} disabled={editorOpen || deleteTeam.isPending || createTeam.isPending || updateTeam.isPending} onClick={() => removeTeam(team)} className="text-muted-foreground hover:text-destructive" data-testid={`button-delete-installation-team-${team.id}`}><Trash2 size={15} /></Button></div>}
                      </div>
                      <div className={`mt-4 ${layout === 'list' ? 'md:mt-0 md:min-w-[230px] md:max-w-[330px] md:flex-1' : ''}`}><p className="mb-2 text-[9px] font-bold uppercase tracking-[.13em] text-muted-foreground">Team members</p>{teamMembers.length ? <div className="flex flex-wrap gap-1.5">{teamMembers.map((member) => <span key={member.id} className="rounded-full bg-muted/70 px-2.5 py-1 text-[10px] font-semibold" data-testid={`chip-team-member-${team.id}-${member.id}`}>{member.name}</span>)}{teamMembers.length < memberCount && <span className="rounded-full bg-muted/70 px-2.5 py-1 text-[10px] text-muted-foreground">{memberCount - teamMembers.length} unavailable</span>}</div> : <p className="text-xs text-muted-foreground">No member details available</p>}</div>
                      {team.subteams.length > 0 && <div className={`mt-4 space-y-2 border-t border-border/70 pt-3 ${layout === 'list' ? 'md:mt-0 md:min-w-[260px] md:flex-1' : ''}`}><p className="text-[9px] font-bold uppercase tracking-[.13em] text-muted-foreground">Subdivisions</p>{team.subteams.map((subteam) => <div key={subteam.id} className="flex items-start justify-between gap-3 rounded-lg bg-muted/35 px-3 py-2" data-testid={`team-subdivision-${subteam.id}`}><span className="text-xs font-semibold">{subteam.name}</span><span className="text-right text-[10px] text-muted-foreground">{subteam.memberIds.map((id) => users.find((member) => member.id === id)?.name).filter(Boolean).join(', ') || `${subteam.memberIds.length} assigned`}</span></div>)}</div>}
                    </article>;
                  })}
                </section>}
              <p className="px-1 text-[10px] text-muted-foreground">{visibleTeams.length} of {teams.length} teams shown. Changes are used by the Installation order scheduler.</p>
            </>}
      </>}
    </main>
  </AppShell>;
}
