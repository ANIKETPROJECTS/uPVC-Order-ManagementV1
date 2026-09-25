import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, LockKeyhole, UserRound } from 'lucide-react';
import { getGetAuthSessionQueryKey, useLogin } from '@workspace/api-client-react';

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
    <div className="relative flex min-h-[100dvh] overflow-hidden bg-[#e8eee9]">
      <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute -bottom-28 left-1/3 h-96 w-96 rounded-full bg-accent/15 blur-3xl" />
      <section className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex xl:p-14">
        <div className="absolute right-[-18%] top-[22%] h-[410px] w-[410px] rounded-full border border-sidebar-primary/25" /><div className="absolute right-[-8%] top-[30%] h-[290px] w-[290px] rounded-full border border-sidebar-primary/20" />
        <div className="relative flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white shadow-sm"><img src={`${import.meta.env.BASE_URL}window-logo.svg`} alt="" aria-hidden="true" className="h-full w-full object-contain" /></div><div><p className="font-display font-bold">Framewise</p><p className="text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/45">Order operations</p></div></div>
        <div className="relative max-w-md"><p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-sidebar-primary">A clearer handoff</p><h1 className="font-display text-5xl font-bold leading-[1.03] tracking-[-0.04em] xl:text-6xl">From first measure to final fit.</h1><p className="mt-6 max-w-sm text-sm leading-7 text-sidebar-foreground/60">One dependable workspace for the people quoting, making and fitting every frame.</p><div className="mt-12 grid grid-cols-3 gap-4 border-t border-sidebar-border pt-5"><div><p className="font-display text-xl font-bold">14</p><p className="mt-1 text-[10px] uppercase tracking-widest text-sidebar-foreground/45">Modules</p></div><div><p className="font-display text-xl font-bold">01</p><p className="mt-1 text-[10px] uppercase tracking-widest text-sidebar-foreground/45">Release</p></div><div><p className="font-display text-xl font-bold">24/7</p><p className="mt-1 text-[10px] uppercase tracking-widest text-sidebar-foreground/45">Visibility</p></div></div></div>
        <p className="relative text-xs text-sidebar-foreground/35">Internal operations platform · v1.0</p>
      </section>
      <main className="relative flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[420px] animate-enter-up">
          <div className="mb-8 lg:hidden"><div className="mb-5 grid h-11 w-11 place-items-center overflow-hidden rounded-xl bg-white shadow-sm"><img src={`${import.meta.env.BASE_URL}window-logo.svg`} alt="" aria-hidden="true" className="h-full w-full object-contain" /></div><p className="font-display text-2xl font-bold">Framewise</p><p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">Order operations</p></div>
          <div className="mb-8"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Secure staff access</p><h2 className="mt-3 font-display text-4xl font-bold tracking-[-0.04em]">Good morning.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Sign in to pick up where your team left off.</p></div>
          <form onSubmit={submit} className="space-y-5">
            <label className="block"><span className="mb-2 block text-xs font-semibold text-foreground">Username</span><div className="relative"><UserRound className="absolute left-3.5 top-3.5 text-muted-foreground" size={17} /><input value={username} onChange={(event) => setUsername(event.target.value)} className="h-12 w-full rounded-xl border border-input bg-card pl-11 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" data-testid="input-login-username" autoComplete="username" /></div></label>
            <label className="block"><span className="mb-2 block text-xs font-semibold text-foreground">Password</span><div className="relative"><LockKeyhole className="absolute left-3.5 top-3.5 text-muted-foreground" size={17} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 w-full rounded-xl border border-input bg-card pl-11 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" data-testid="input-login-password" autoComplete="current-password" /></div></label>
            {login.isError && <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs leading-5 text-destructive" data-testid="status-login-error">We couldn't sign you in. Check the username and password, then try again.</div>}
            <button type="submit" disabled={login.isPending || !username || !password} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60" data-testid="button-login">{login.isPending ? 'Checking access…' : <>Sign in <ArrowRight size={16} /></>}</button>
          </form>
          {import.meta.env.DEV && <div className="mt-8 rounded-xl border border-accent/35 bg-accent/10 p-4" data-testid="note-demo-credentials"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent-foreground">Development-only note</p><p className="mt-2 text-xs leading-5 text-accent-foreground/80">Seeded logins for role switching:</p><div className="mt-2 space-y-1 font-mono text-[11px] text-accent-foreground/80"><p><span className="font-semibold">admin</span> / Admin@12345</p><p><span className="font-semibold">operator, manager, rate.approver, accounts, quotations</span> / Demo@12345</p></div></div>}
        </div>
      </main>
    </div>
  );
}