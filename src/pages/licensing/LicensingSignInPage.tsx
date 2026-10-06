import { useState, useEffect } from 'react';
import { Mail, Lock, ArrowRight, Loader as Loader2, KeyRound, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ThemeToggle } from '@/components/ThemeToggle';

type LicensingScreen = 'signin' | 'signup' | 'forgot';

export function LicensingSignInPage() {
  const { signInWithPassword, signUp, resetPassword, getMasterEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [screen, setScreen] = useState<LicensingScreen>('signin');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [masterEmail, setMasterEmail] = useState('healthcareatul@gmail.com');

  useEffect(() => {
    getMasterEmail().then(setMasterEmail);
  }, [getMasterEmail]);

  useEffect(() => {
    if (screen === 'signup') {
      setEmail(masterEmail);
    } else {
      setEmail('');
    }
    setPassword('');
    setStatus('idle');
    setErrorMsg('');
  }, [screen, masterEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    if (screen === 'forgot') {
      setStatus('sending');
      setErrorMsg('');
      const { error } = await resetPassword(email.trim());
      if (error) {
        setStatus('error');
        setErrorMsg(error);
      } else {
        setStatus('sent');
      }
      return;
    }

    setStatus('sending');
    setErrorMsg('');

    if (screen === 'signup') {
      if (email.trim().toLowerCase() !== masterEmail.toLowerCase()) {
        setStatus('error');
        setErrorMsg(`Only the designated master email (${masterEmail}) can create a master account.`);
        return;
      }
      const { error } = await signUp(email.trim(), password, 'licensing');
      if (error) {
        setStatus('error');
        setErrorMsg(error);
      } else {
        setStatus('idle');
      }
    } else {
      const { error } = await signInWithPassword(email.trim(), password, 'licensing', remember);
      if (error) {
        setStatus('error');
        setErrorMsg(error);
      } else {
        setStatus('idle');
      }
    }
  };

  const goToCustomer = () => {
    localStorage.setItem('app_mode', 'customer');
    window.dispatchEvent(new Event('app_mode_change'));
  };

  return (
    <div className="relative min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-accent-500/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-600 shadow-lg shadow-primary-600/30">
            <KeyRound className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Licensing Service</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Master Admin Portal</p>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-xl shadow-black/5">
          {screen === 'forgot' ? (
            <>
              <h2 className="text-xl font-semibold text-[var(--text)]">Reset Password</h2>
              <p className="mt-2 text-sm text-[var(--text-muted)]">Enter your master email to receive a reset link.</p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-[var(--text)]">
                {screen === 'signup' ? 'Create Master Account' : 'Master Sign In'}
              </h2>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                {screen === 'signup'
                  ? `Only ${masterEmail} can create a master account.`
                  : 'Sign in with your master email and password.'}
              </p>
            </>
          )}

          {screen === 'forgot' && status === 'sent' ? (
            <div className="mt-6 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-500/10">
                <ShieldCheck className="h-7 w-7 text-accent-600" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text)]">Check your email</h3>
              <p className="mt-2 text-sm text-[var(--text-muted)]">We've sent a password reset link to {email}.</p>
              <button onClick={() => setScreen('signin')} className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700">
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Master email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="master@licensing.com"
                    required
                    autoFocus
                    disabled={status === 'sending' || screen === 'signup'}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    disabled={status === 'sending'}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-10 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)] hover:text-[var(--text)]"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {screen === 'signin' && (
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-[var(--border)] text-primary-600 focus:ring-primary-500/20" />
                    Remember me
                  </label>
                  <button type="button" onClick={() => setScreen('forgot')} className="text-sm font-medium text-primary-600 hover:text-primary-700">
                    Forgot password?
                  </button>
                </div>
              )}

              {status === 'error' && <p className="text-sm text-error-500">{errorMsg}</p>}

              <button
                type="submit"
                disabled={status === 'sending' || !email.trim() || !password}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white transition-all hover:bg-primary-700 focus:ring-2 focus:ring-primary-500/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === 'sending' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {screen === 'signup' ? 'Creating account...' : screen === 'forgot' ? 'Sending...' : 'Signing in...'}
                  </>
                ) : (
                  <>
                    {screen === 'signup' ? 'Create account' : screen === 'forgot' ? 'Send reset link' : 'Sign in'}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {screen !== 'forgot' && status !== 'sent' && (
            <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
              {screen === 'signup' ? 'Already have an account? ' : "Don't have an account? "}
              <button onClick={() => setScreen(screen === 'signup' ? 'signin' : 'signup')} className="font-medium text-primary-600 hover:text-primary-700">
                {screen === 'signup' ? 'Sign in' : 'Sign up'}
              </button>
            </p>
          )}
          {screen === 'forgot' && status !== 'sent' && (
            <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
              <button onClick={() => setScreen('signin')} className="font-medium text-primary-600 hover:text-primary-700">
                Back to sign in
              </button>
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-[var(--text-subtle)]">
          Central Licensing Service — QR Checkpoint System
        </p>

        <p className="mt-3 text-center text-sm text-[var(--text-muted)]">
          <button onClick={goToCustomer} className="font-medium text-primary-600 hover:text-primary-700">
            Go to Customer Portal
          </button>
        </p>
      </div>
    </div>
  );
}
