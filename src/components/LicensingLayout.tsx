import { useState, type ReactNode } from 'react';
import {
  Building2, KeyRound, ScrollText, LogOut, Menu, X, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ThemeToggle } from '@/components/ThemeToggle';

export type LicensingPage = 'companies' | 'license_keys' | 'validations';

interface Props {
  current: LicensingPage;
  onNavigate: (page: LicensingPage) => void;
  children: ReactNode;
}

const navItems: { id: LicensingPage; label: string; icon: typeof Building2 }[] = [
  { id: 'companies', label: 'Companies', icon: Building2 },
  { id: 'license_keys', label: 'License Keys', icon: KeyRound },
  { id: 'validations', label: 'Validation History', icon: ScrollText },
];

export function LicensingLayout({ current, onNavigate, children }: Props) {
  const { appUser, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showSignOut, setShowSignOut] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-[var(--sidebar-bg)] lg:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600">
            <KeyRound className="h-5 w-5 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">Licensing</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                current === id
                  ? 'bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active)]'
                  : 'text-[var(--sidebar-text)] hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </button>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white">
              {(appUser?.name || 'M').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{appUser?.name || 'Master'}</p>
              <p className="truncate text-xs text-[var(--sidebar-text)]">{appUser?.email}</p>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between px-2">
            <ThemeToggle />
            <button
              onClick={() => setShowSignOut(true)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--sidebar-text)] transition-colors hover:bg-white/5 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 lg:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
            <KeyRound className="h-4 w-5 text-white" />
          </div>
          <span className="text-sm font-semibold text-[var(--text)]">Licensing</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button onClick={() => setMobileOpen(true)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[var(--surface-hover)]">
            <Menu className="h-5 w-5 text-[var(--text)]" />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 bg-[var(--sidebar-bg)] flex flex-col">
            <div className="flex h-16 items-center justify-between px-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600">
                  <ShieldCheck className="h-5 w-5 text-white" />
                </div>
                <span className="text-sm font-semibold text-white">Licensing</span>
              </div>
              <button onClick={() => setMobileOpen(false)} className="text-[var(--sidebar-text)]">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 px-3 py-4">
              {navItems.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { onNavigate(id); setMobileOpen(false); }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    current === id
                      ? 'bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active)]'
                      : 'text-[var(--sidebar-text)] hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </nav>
            <div className="border-t border-white/10 p-3">
              <button
                onClick={() => { setShowSignOut(true); setMobileOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-[var(--sidebar-text)] hover:bg-white/5 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <main className="min-h-screen pt-16 lg:pt-0">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>

      {showSignOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowSignOut(false)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error-500/10">
                <LogOut className="h-6 w-6 text-error-500" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text)]">Sign out?</h3>
              <p className="mt-1.5 text-sm text-[var(--text-muted)]">
                You'll need to sign in again next time.
              </p>
              <div className="mt-6 flex w-full gap-3">
                <button
                  onClick={() => setShowSignOut(false)}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => { await signOut(); }}
                  className="flex-1 rounded-lg bg-error-500 py-2.5 text-sm font-semibold text-white hover:bg-error-600"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
