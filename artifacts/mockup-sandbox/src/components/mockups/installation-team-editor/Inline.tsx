import './_group.css';
import { useMemo, useState } from 'react';
import { ArrowLeft, Check, Plus, Search, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const people = [
  { id: '1', name: 'Aditi Kulkarni', username: 'admin', roleName: 'Master Admin' },
  { id: '2', name: 'Aniket Rane', username: 'arane', roleName: 'Administrator' },
  { id: '3', name: 'Meera Joshi', username: 'mjoshi', roleName: 'Manager' },
  { id: '4', name: 'Sneha Shah', username: 'sshah', roleName: 'Accounts' },
  { id: '5', name: 'Uday Deshmukh', username: 'udesh', roleName: 'Rate Approver' },
  { id: '6', name: 'Rahul Patil', username: 'rpatil', roleName: 'Installation' },
  { id: '7', name: 'Nisha Rao', username: 'nrao', roleName: 'Installation' },
  { id: '8', name: 'Karan Malhotra', username: 'kmalhotra', roleName: 'Installation' },
  { id: '9', name: 'Pooja Naik', username: 'pnaik', roleName: 'Installation' },
  { id: '10', name: 'Sanjay More', username: 'smore', roleName: 'Installation' },
  { id: '11', name: 'Priya Menon', username: 'pmenon', roleName: 'Installation' },
  { id: '12', name: 'Vikram Singh', username: 'vsingh', roleName: 'Installation' },
];

function PeoplePicker({ title, selected, onChange, members = people }: { title: string; selected: string[]; onChange: (ids: string[]) => void; members?: typeof people }) {
  const [search, setSearch] = useState('');
  const visiblePeople = useMemo(() => members.filter((person) => `${person.name} ${person.username} ${person.roleName}`.toLowerCase().includes(search.toLowerCase().trim())), [members, search]);
  const selectedPeople = selected.map((id) => members.find((person) => person.id === id)).filter((person): person is typeof people[number] => Boolean(person));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  return <section className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="text-sm font-bold">{title}</h3><p className="mt-1 text-xs text-muted-foreground">Search names, then choose eligible Installation users.</p></div><span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[11px] font-semibold text-secondary-foreground">{selected.length} selected</span></div>
    <label className="relative block"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input type="search" aria-label={`Search ${title.toLowerCase()}`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users by name, username, or role…" className="h-10 pl-9 text-xs" /></label>
    {selectedPeople.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label={`Selected ${title.toLowerCase()}`}>{selectedPeople.map((person) => <button key={person.id} type="button" onClick={() => toggle(person.id)} className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[.06] px-2.5 py-1 text-[11px] font-semibold text-primary" aria-label={`Remove ${person.name}`}>{person.name}<X size={12} /></button>)}</div>}
    {visiblePeople.length ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {visiblePeople.map((person) => {
        const checked = selected.includes(person.id);
        return <label key={person.id} className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${checked ? 'border-primary/35 bg-primary/[.045]' : 'border-border bg-background hover:border-primary/25'}`}>
          <input type="checkbox" checked={checked} onChange={() => toggle(person.id)} className="size-4 accent-[hsl(var(--primary))]" />
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary font-display text-xs font-bold text-secondary-foreground">{person.name.split(' ').map((part) => part[0]).join('')}</span>
          <span className="min-w-0"><span className="block truncate text-xs font-semibold">{person.name}</span><span className="block truncate text-[10px] text-muted-foreground">@{person.username} · {person.roleName}</span></span>
          {checked && <Check size={15} className="ml-auto shrink-0 text-primary" />}
        </label>;
      })}
    </div> : <p className="rounded-xl border border-dashed border-border bg-muted/25 px-4 py-5 text-center text-xs text-muted-foreground">No eligible users match this search.</p>}
  </section>;
}

export function Inline() {
  const [teamName, setTeamName] = useState('North installation crew');
  const [memberIds, setMemberIds] = useState(['1', '6', '7', '9']);
  const [subteamIds, setSubteamIds] = useState(['6', '7']);
  const [subteamName, setSubteamName] = useState('Site A');
  const parentMembers = people.filter((person) => memberIds.includes(person.id));
  return <div className="installation-editor-preview min-h-screen">
    <header className="border-b border-border/80 bg-card/70 px-6 py-4">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4"><div className="flex items-center gap-3"><Button type="button" variant="outline" size="icon" aria-label="Back to installation register"><ArrowLeft size={16} /></Button><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-primary">Fulfillment · field structure</p><h1 className="font-display text-xl font-bold">Installation teams</h1></div></div><Button type="button" variant="outline">Cancel</Button></div>
    </header>
    <main className="mx-auto max-w-7xl space-y-5 px-5 py-6">
      <section className="rounded-2xl border border-primary/10 bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-primary"><Users size={14} /> Team setup</p><h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Create installation team</h2><p className="mt-1 text-sm text-muted-foreground">Add field members and divide a crew into site-ready subdivisions.</p></div><span className="rounded-full border border-primary/15 bg-primary/[.045] px-3 py-1.5 text-xs font-semibold text-primary">4 team members · 1 subdivision</span></div>
        <div className="mt-5 max-w-xl"><label className="mb-2 block text-xs font-bold" htmlFor="team-name">Team name</label><Input id="team-name" value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="e.g. North field crew" className="h-11" /></div>
      </section>
      <section className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm"><PeoplePicker title="Parent team members" selected={memberIds} onChange={setMemberIds} /></section>
      <section className="space-y-4 rounded-2xl border border-border/80 bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-display text-lg font-bold">Subdivisions</h3><p className="mt-1 text-xs text-muted-foreground">Subdivision membership always stays within the parent team.</p></div><span className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs">1 subdivision</span></div>
        <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4"><div className="flex items-center gap-2"><Input value={subteamName} onChange={(event) => setSubteamName(event.target.value)} aria-label="Subdivision name" /><Button type="button" variant="ghost" size="icon" aria-label="Remove subdivision"><X size={15} /></Button></div><PeoplePicker title="Site A members" members={parentMembers} selected={subteamIds} onChange={setSubteamIds} /></div>
        <Button type="button" variant="outline"><Plus size={14} /> Add subdivision</Button>
      </section>
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-card/95 p-3 shadow-lg backdrop-blur"><p className="text-xs text-muted-foreground">Changes apply to future Installation assignments.</p><div className="flex gap-2"><Button type="button" variant="outline">Cancel</Button><Button type="button">Create team</Button></div></div>
    </main>
  </div>;
}
