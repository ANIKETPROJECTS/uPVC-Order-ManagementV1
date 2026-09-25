import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, LockKeyhole, UserRound } from 'lucide-react';
import { getGetAuthSessionQueryKey, useLogin } from '@workspace/api-client-react';
import { BrandMark } from '@/components/brand-mark';

export default function LoginPage() {
  const queryClient = useQueryClient();
  const login = useLogin();
  const [username, setUsername] = useState(import.meta.env.DEV ? 'admin' : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? 'Admin@12345' : '');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    login.mutate({ data: { username, password } }, {
      onSuccess: (user) => {
        queryClient.setQueryData(getGetAuthSessionQueryKey(), { authenticated: true, user });
      },
    });
  };

  return (
    <div className="relative flex min-h-[100dvh] overflow-hidden bg-background">
      <div className="absolute -right-28 -top-28 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute -bottom-32 left-1/3 h-[28rem] w-[28rem] rounded-full bg-accent/10 blur-3xl" />
      <section className="brand-sheen relative hidden w-[49%] flex-col justify-between overflow-hidden p-10 text-sidebar-foreground lg:flex xl:p-14">
        <div className="absolute -right-20 top-24 h-[29rem] w-[29rem] rounded-[4rem] border border-sidebar-primary/20 rotate-12" />
        <div className="absolute right-20 top-44 h-52 w-52 rounded-[2.25rem] border border-sidebar-primary/20 -rotate-12" />
        <div className="relative"><BrandMark /></div>
        <div className="relative max-w-xl">
          <p className="micro-label mb-5 text-sidebar-primary">A clearer handoff</p>
          <h1 className="max-w-lg font-display text-5xl font-bold leading-[1.02] tracking-[-0.055em] xl:text-6xl">From first measure to final fit.</h1>
          <p className="mt-6 max-w-md text-sm leading-7 text-sidebar-foreground/65">One dependable workspace for the people quoting, making and fitting every frame.</p>
          <div className="mt-12 grid max-w-sm grid-cols-3 gap-4 border-t border-sidebar-border pt-5">
            <div><p className="font-display text-xl font-bold">14</p><p className="mt-1 text-[10px] uppercase tracking-widest text-sidebar-foreground/45">Modules</p></div>
            <div><p className="font-display text-xl font-bold">01</p><p className="mt-1 text-[10px] uppercase tracking-widest text-sidebar-foreground/45">Release</p></div>
            <div><p className="font-display text-xl font-bold">24/7</p><p className="mt-1 text-[10px] uppercase tracking-widest text-sidebar-foreground/45">Visibility</p></div>
          </div>
        </div>
        <p className="relative text-xs text-sidebar-foreground/35">Internal operations platform · v1.0</p>
      </section>
      <main className="relative flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[430px] animate-enter-up">
          <div className="mb-10 lg:hidden"><BrandMark /></div>
          <div className="mb-8"><p className="micro-label text-primary">Secure staff access</p><h2 className="mt-3 font-display text-4xl font-bold tracking-[-0.055em]">Good morning.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Sign in to pick up where your team left off.</p></div>
          <form onSubmit={submit} className="space-y-5 rounded-2xl border border-border bg-card/75 p-5 surface-lift sm:p-6">
            <label className="block"><span className="mb-2 block text-xs font-semibold text-foreground">Username</span><div className="relative"><UserRound className="absolute left-3.5 top-3.5 text-sky-500" size={17} /><input value={username} onChange={(event) => setUsername(event.target.value)} className="h-12 w-full rounded-xl border border-input bg-background pl-11 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" data-testid="input-login-username" autoComplete="username" /></div></label>
            <label className="block"><span className="mb-2 block text-xs font-semibold text-foreground">Password</span><div className="relative"><LockKeyhole className="absolute left-3.5 top-3.5 text-violet-500" size={17} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 w-full rounded-xl border border-input bg-background pl-11 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" data-testid="input-login-password" autoComplete="current-password" /></div></label>
            {login.isError && <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs leading-5 text-destructive" data-testid="status-login-error">We couldn't sign you in. Check the username and password, then try again.</div>}
            <button type="submit" disabled={login.isPending || !username || !password} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60" data-testid="button-login">{login.isPending ? 'Checking access…' : <>Sign in <ArrowRight size={16} /></>}</button>
          </form>
          {import.meta.env.DEV && <div className="mt-8 rounded-xl border border-accent/35 bg-accent/10 p-4" data-testid="note-demo-credentials"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent-foreground">Development-only note</p><p className="mt-2 text-xs leading-5 text-accent-foreground/80">Seeded logins for role switching:</p><div className="mt-2 space-y-1 font-mono text-[11px] text-accent-foreground/80"><p><span className="font-semibold">admin</span> / Admin@12345</p><p><span className="font-semibold">operator, manager, rate.approver, accounts, quotations</span> / Demo@12345</p></div></div>}
        </div>
      </main>
    </div>
  );
}