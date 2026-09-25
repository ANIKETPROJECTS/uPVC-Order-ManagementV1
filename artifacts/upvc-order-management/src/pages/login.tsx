import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, LockKeyhole, UserRound } from 'lucide-react';
import { getGetAuthSessionQueryKey, useLogin } from '@workspace/api-client-react';
import loginBackground from '@/assets/login-window-background.jpg';

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
    <div className="login-page relative flex min-h-[100dvh] overflow-hidden bg-slate-950 text-white">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${loginBackground})` }}
        aria-hidden="true"
      />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(110deg, rgba(2, 12, 15, .78) 0%, rgba(2, 12, 15, .48) 52%, rgba(2, 12, 15, .70) 100%)' }}
        aria-hidden="true"
      />
      <section className="relative z-10 hidden w-[46%] flex-col justify-between p-10 text-white lg:flex xl:p-14">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}window-logo.svg`} alt="" aria-hidden="true" className="h-16 w-16 shrink-0 object-contain drop-shadow-lg" />
          <div>
            <p className="font-display font-bold">Framewise</p>
            <p className="text-[10px] uppercase tracking-[0.2em]">Order operations</p>
          </div>
        </div>
        <div className="max-w-md">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em]">A clearer handoff</p>
          <h1 className="font-display text-5xl font-bold leading-[1.03] tracking-[-0.04em] xl:text-6xl">From first measure to final fit.</h1>
          <p className="mt-6 max-w-sm text-sm leading-7">One dependable workspace for the people quoting, making and fitting every frame.</p>
          <div className="mt-12 grid grid-cols-3 gap-4 border-t border-white/25 pt-5">
            <div><p className="font-display text-xl font-bold">14</p><p className="mt-1 text-[10px] uppercase tracking-widest">Modules</p></div>
            <div><p className="font-display text-xl font-bold">01</p><p className="mt-1 text-[10px] uppercase tracking-widest">Release</p></div>
            <div><p className="font-display text-xl font-bold">24/7</p><p className="mt-1 text-[10px] uppercase tracking-widest">Visibility</p></div>
          </div>
        </div>
        <p className="text-xs">Internal operations platform · v1.0</p>
      </section>
      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-7 lg:hidden">
            <img src={`${import.meta.env.BASE_URL}window-logo.svg`} alt="" aria-hidden="true" className="mb-4 h-16 w-16 object-contain drop-shadow-lg" />
            <p className="font-display text-2xl font-bold">Framewise</p>
            <p className="mt-1 text-xs uppercase tracking-[0.2em]">Order operations</p>
          </div>
          <div className="rounded-3xl border border-white/70 bg-white/95 p-6 text-foreground shadow-2xl backdrop-blur-md sm:p-8">
            <div className="mb-8">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Secure staff access</p>
              <h2 className="mt-3 font-display text-4xl font-bold tracking-[-0.04em]">Good morning.</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Sign in to pick up where your team left off.</p>
            </div>
            <form onSubmit={submit} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-foreground">Username</span>
                <div className="relative">
                  <UserRound className="absolute left-3.5 top-3.5 text-muted-foreground" size={17} />
                  <input value={username} onChange={(event) => setUsername(event.target.value)} className="h-12 w-full rounded-xl border border-input bg-background pl-11 pr-4 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40" data-testid="input-login-username" autoComplete="username" />
                </div>
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-foreground">Password</span>
                <div className="relative">
                  <LockKeyhole className="absolute left-3.5 top-3.5 text-muted-foreground" size={17} />
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 w-full rounded-xl border border-input bg-background pl-11 pr-4 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40" data-testid="input-login-password" autoComplete="current-password" />
                </div>
              </label>
              {login.isError && <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-xs leading-5 text-destructive" data-testid="status-login-error">We couldn't sign you in. Check the username and password, then try again.</div>}
              <button type="submit" disabled={login.isPending || !username || !password} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60" data-testid="button-login">{login.isPending ? 'Checking access…' : <>Sign in <ArrowRight size={16} /></>}</button>
            </form>
            {import.meta.env.DEV && <div className="mt-8 rounded-xl border border-border bg-muted/60 p-4" data-testid="note-demo-credentials"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Development-only note</p><p className="mt-2 text-xs leading-5 text-muted-foreground">Seeded logins for role switching:</p><div className="mt-2 space-y-1 font-mono text-[11px] text-foreground"><p><span className="font-semibold">admin</span> / Admin@12345</p><p><span className="font-semibold">operator, manager, rate.approver, accounts, quotations</span> / Demo@12345</p></div></div>}
          </div>
        </div>
      </main>
    </div>
  );
}