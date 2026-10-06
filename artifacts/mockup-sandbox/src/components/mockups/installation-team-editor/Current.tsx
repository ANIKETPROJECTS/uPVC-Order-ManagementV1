import './_group.css';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const people = [
  { id: '1', name: 'Aditi Kulkarni', username: 'admin', roleName: 'Master Admin' },
  { id: '2', name: 'Aniket Rane', username: 'arane', roleName: 'Administrator' },
  { id: '3', name: 'Meera Joshi', username: 'mjoshi', roleName: 'Manager' },
  { id: '4', name: 'Sneha Shah', username: 'sshah', roleName: 'Accounts' },
  { id: '5', name: 'Uday Deshmukh', username: 'udesh', roleName: 'Rate Approver' },
];

function PeoplePicker({ title, selected = 0 }: { title: string; selected?: number }) {
  return <section className="space-y-3">
    <div className="flex items-end justify-between"><div><h3 className="text-sm font-bold">{title}</h3><p className="mt-1 text-xs text-muted-foreground">Choose from eligible existing Installation users.</p></div><span className="font-mono text-xs text-primary">{selected} selected</span></div>
    <div className="grid gap-2 sm:grid-cols-2">
      {people.map((person, index) => <label key={person.id} className={`flex items-center gap-3 rounded-xl border p-3 ${index < selected ? 'border-primary/35 bg-primary/[.045]' : 'border-border bg-background'}`}>
        <input type="checkbox" defaultChecked={index < selected} className="size-4 accent-[hsl(var(--primary))]" />
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary font-display text-xs font-bold text-secondary-foreground">{person.name.split(' ').map((part) => part[0]).join('')}</span>
        <span className="min-w-0"><span className="block truncate text-xs font-semibold">{person.name}</span><span className="block truncate text-[10px] text-muted-foreground">@{person.username} · {person.roleName}</span></span>
        {index < selected && <Check size={15} className="ml-auto shrink-0 text-primary" />}
      </label>)}
    </div>
  </section>;
}

export function Current() {
  return <div className="installation-editor-preview relative p-6">
    <header className="mx-auto flex max-w-5xl items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">Fulfillment · field structure</p><h1 className="mt-2 font-display text-3xl font-bold">Installation teams</h1></div><Button>New team</Button></header>
    <section className="mx-auto mt-8 max-w-5xl rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex gap-3"><div className="h-12 flex-1 rounded-lg border bg-background" /><div className="h-12 w-32 rounded-lg border bg-background" /><div className="h-12 w-32 rounded-lg border bg-background" /></div><div className="mt-5 h-40 rounded-xl border border-dashed border-border bg-background/70" /></section>
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-xl">Create installation team</DialogTitle><DialogDescription>Build a reliable field crew. Subdivision membership is always kept within the parent team.</DialogDescription></DialogHeader>
        <div className="space-y-6">
          <label className="block space-y-2"><span className="text-xs font-bold">Team name</span><Input placeholder="e.g. North field crew" /></label>
          <PeoplePicker title="Parent team members" selected={2} />
          <section className="space-y-4 rounded-2xl border border-border bg-muted/25 p-4">
            <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold">Subdivisions</h3><p className="mt-1 text-xs text-muted-foreground">Optional smaller crews inside this team.</p></div><span className="rounded-full bg-background px-2.5 py-1 font-mono text-[11px]">0</span></div>
            <div className="space-y-3 rounded-xl border border-dashed border-primary/30 bg-background/75 p-3"><Input placeholder="Subdivision name" /><div className="grid min-h-12 place-items-center rounded-xl border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">Select parent members first</div><Button type="button" variant="outline" size="sm"><span className="mr-1">+</span> Add subdivision</Button></div>
          </section>
          <DialogFooter><Button type="button" variant="outline">Cancel</Button><Button type="button">Create team</Button></DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}
