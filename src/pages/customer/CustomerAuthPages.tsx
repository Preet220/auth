import { useState, useEffect, useCallback } from "react";
import {
  Mail,
  Lock,
  ArrowRight,
  Loader as Loader2,
  ShieldCheck,
  KeyRound,
  Building2,
  Eye,
  EyeOff,
  UserPlus,
  Clock,
  Ban,
  AlertCircle,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/lib/supabase";

function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed top-4 left-1/2 z-[100] w-full max-w-sm -translate-x-1/2 px-4">
      <div className="flex items-start gap-3 rounded-xl border border-error-500/30 bg-[var(--surface)] p-4 shadow-xl shadow-error-500/10">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-error-500" />
        <p className="flex-1 text-sm text-[var(--text)]">{message}</p>
        <button onClick={onClose} className="shrink-0 rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function useErrorToast() {
  const [toast, setToast] = useState<string | null>(null);
  const showError = useCallback((msg: string) => setToast(msg), []);
  const clearError = useCallback(() => setToast(null), []);
  const toastEl = toast ? <ErrorToast message={toast} onClose={clearError} /> : null;
  return { showError, clearError, toastEl };
}

type CustomerScreen = "signin" | "signup" | "forgot" | "pending";

export function CustomerSignInPage() {
  const { signInWithPassword } = useAuth();
  const { showError, toastEl } = useErrorToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [status, setStatus] = useState<"idle" | "sending">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setStatus("sending");
    const { error } = await signInWithPassword(email.trim(), password, "customer", remember);
    if (error) {
      showError(error);
    }
    setStatus("idle");
  };

  const goToSignUp = () => {
    localStorage.setItem("customer_screen", "signup");
    window.dispatchEvent(new Event("customer_screen_change"));
  };

  const goToForgot = () => {
    localStorage.setItem("customer_screen", "forgot");
    window.dispatchEvent(new Event("customer_screen_change"));
  };

  const goToLicensing = () => {
    localStorage.setItem("app_mode", "licensing");
    window.dispatchEvent(new Event("app_mode_change"));
  };

  return (
    <div className="relative min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-accent-500/10 blur-3xl" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-500 shadow-lg shadow-primary-500/30">
            <ShieldCheck className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">QR Checkpoint</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Customer Portal</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-xl shadow-black/5">
          <h2 className="text-xl font-semibold text-[var(--text)]">Sign in</h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">Enter your work email and password to sign in.</p>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Work email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoFocus disabled={status === "sending"}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required disabled={status === "sending"}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-10 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)] hover:text-[var(--text)]" tabIndex={-1}>
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-muted)]">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-[var(--border)] text-primary-600 focus:ring-primary-500/20" />
                Remember me
              </label>
              <button type="button" onClick={goToForgot} className="text-sm font-medium text-primary-600 hover:text-primary-700">Forgot password?</button>
            </div>
            {toastEl}
            <button type="submit" disabled={status === "sending" || !email.trim() || !password}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
              {status === "sending" ? <><Loader2 className="h-4 w-4 animate-spin" /> Signing in...</> : <>Sign in <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
            Don't have an account?{" "}
            <button onClick={goToSignUp} className="font-medium text-primary-600 hover:text-primary-700">Sign up</button>
          </p>
        </div>
        <p className="mt-6 text-center text-xs text-[var(--text-subtle)]">QR Checkpoint Tracking System</p>
        <p className="mt-3 text-center text-sm text-[var(--text-muted)]">
          <button onClick={goToLicensing} className="font-medium text-primary-600 hover:text-primary-700">Go to Licensing Portal</button>
        </p>
      </div>
    </div>
  );
}

export function CustomerSignUpPage() {
  const { signUpCompany, signUpAdminOrEmployee } = useAuth();
  const { showError, toastEl } = useErrorToast();

  const [role, setRole] = useState<"company" | "admin" | "employee">("company");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [licenseKey, setLicenseKey] = useState("");
  const [companyName, setCompanyName] = useState("");

  const [companyId, setCompanyId] = useState("");
  const [validatedCompanyName, setValidatedCompanyName] = useState("");
  const [companyValidated, setCompanyValidated] = useState(false);

  const [licenseValidated, setLicenseValidated] = useState(false);

  const [status, setStatus] = useState<"idle" | "sending" | "success">("idle");

  const validateCompanyId = async () => {
    if (!companyId.trim()) {
      showError("Please enter your Company ID.");
      return;
    }
    setStatus("sending");
    try {
      const { data, error } = await supabase.rpc("lookup_company_by_id", {
        p_company_id: companyId.trim(),
      });

      if (error) {
        setStatus("idle");
        showError(`Failed to verify company: ${error.message}`);
        setCompanyValidated(false);
        return;
      }
      if (!data) {
        setStatus("idle");
        showError("Company ID not found. Please check with your administrator.");
        setCompanyValidated(false);
        return;
      }
      if (data.license_status !== "active") {
        setStatus("idle");
        showError(`This company's license is ${data.license_status}.`);
        setCompanyValidated(false);
        return;
      }
      setValidatedCompanyName(data.company_name);
      setCompanyValidated(true);
        setStatus("idle");
    } catch {
      setStatus("idle");
      showError("Unable to verify company.");
      setCompanyValidated(false);
    }
  };

  const validateLicenseKey = async () => {
    const key = licenseKey.trim();
    if (!key) {
      showError("Please enter a license key.");
      setLicenseValidated(false);
      return;
    }
    setStatus("sending");
    setLicenseValidated(false);
    try {
      const { data, error } = await supabase.rpc("lookup_license_key", {
        p_key_value: key,
      });

      if (error) {
        setStatus("idle");
        showError(`Failed to verify license: ${error.message}`);
        setLicenseValidated(false);
        return;
      }
      if (!data) {
        setStatus("idle");
        showError("Invalid license key. Please check for typos.");
        setLicenseValidated(false);
        return;
      }
      if (data.status !== "available") {
        setStatus("idle");
        showError(`This license is not available. Current status: ${data.status}`);
        setLicenseValidated(false);
        return;
      }
      setLicenseValidated(true);
      setStatus("idle");
      } catch {
      setStatus("idle");
      showError("An unexpected error occurred while validating the license.");
      setLicenseValidated(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");

    if (role === "company") {
      if (!licenseKey.trim() || !companyName.trim() || !email.trim() || !password) {
        setStatus("idle");
        showError("Please fill in all required fields including license key and company name.");
        return;
      }
      if (!licenseValidated) {
        setStatus("idle");
        showError("Please verify your license key before creating your account.");
        return;
      }
      const { error } = await signUpCompany(email.trim(), password, licenseKey.trim(), companyName.trim());
      if (error) {
        setStatus("idle");
        showError(error);
      } else {
        setStatus("success");
      }
      return;
    }

    // Admin / Employee
    if (!companyValidated || !email.trim() || !password) {
      setStatus("idle");
      showError("Please verify your Company ID and fill all fields.");
      return;
    }
    const { error } = await signUpAdminOrEmployee(email.trim(), password, role, companyId.trim());
    if (error) {
      setStatus("idle");
      showError(error);
    } else {
      setStatus("success");
    }
  };

  const goToSignIn = () => {
    localStorage.setItem("customer_screen", "signin");
    window.dispatchEvent(new Event("customer_screen_change"));
  };

  const goToLicensing = () => {
    localStorage.setItem("app_mode", "licensing");
    window.dispatchEvent(new Event("app_mode_change"));
  };

  if (status === "success") {
    return (
      <div className="relative min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
        <div className="absolute top-4 right-4"><ThemeToggle /></div>
        <div className="relative w-full max-w-md">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-xl text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-500/10">
              <Clock className="h-7 w-7 text-accent-600" />
            </div>
            <h2 className="text-xl font-semibold text-[var(--text)]">Account Created</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              {role === "company"
                ? "Your company account has been created. You can now sign in."
                : "Your account has been linked. You can now sign in with your email and password."}
            </p>
            <button onClick={goToSignIn}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700">
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-accent-500/10 blur-3xl" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-600 shadow-lg shadow-accent-600/30">
            <UserPlus className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Create Account</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Sign up as a company, admin, or employee</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-xl shadow-black/5">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* ROLE */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">I am signing up as</label>
              <div className="flex gap-2">
                {(["company", "admin", "employee"] as const).map((roleOption) => (
                  <button key={roleOption} type="button"
                    onClick={() => {
                      setRole(roleOption);
                                        setLicenseValidated(false);
                      setCompanyValidated(false);
                    }}
                    className={`flex-1 rounded-lg border py-2.5 text-xs font-medium transition-colors ${
                      role === roleOption
                        ? "border-primary-500 bg-primary-500/10 text-primary-600"
                        : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                    }`}>
                    {roleOption.charAt(0).toUpperCase() + roleOption.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* COMPANY ROLE */}
            {role === "company" && (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Company Name <span className="text-error-500">*</span></label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
                    <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Enter company name" required disabled={status === "sending"}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">License Key <span className="text-error-500">*</span></label>
                  <div className="flex gap-2">
                    <input type="text" value={licenseKey} onChange={(e) => { setLicenseKey(e.target.value); setLicenseValidated(false); }}
                      placeholder="XXXX-XXXX-XXXX-XXXX" required disabled={status === "sending"}
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 px-3 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50 font-mono" />
                    <button type="button" onClick={validateLicenseKey} disabled={status === "sending" || !licenseKey.trim()}
                      className="rounded-lg bg-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-[var(--border-hover)] disabled:opacity-50">
                      {status === "sending" ? "Checking..." : "Verify"}
                    </button>
                  </div>
                  {licenseValidated && (
                    <p className="mt-1.5 flex items-center gap-1 text-sm font-medium text-success-600">
                      <ShieldCheck className="h-4 w-4" /> License verified and available
                    </p>
                  )}
                </div>
              </>
            )}

            {/* ADMIN / EMPLOYEE COMPANY ID */}
            {role !== "company" && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Company ID <span className="text-error-500">*</span></label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Building2 className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
                    <input type="text" value={companyId}
                      onChange={(e) => { setCompanyId(e.target.value); setCompanyValidated(false); setValidatedCompanyName(""); }}
                      placeholder="Enter your company ID" required disabled={status === "sending"}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
                  </div>
                  <button type="button" onClick={validateCompanyId} disabled={status === "sending" || !companyId.trim()}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-4 py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50">
                    Verify
                  </button>
                </div>
                {companyValidated && (
                  <p className="mt-1.5 flex items-center gap-1 text-sm text-accent-600">
                    <ShieldCheck className="h-4 w-4" /> Verified: {validatedCompanyName}
                  </p>
                )}
                <p className="mt-1.5 text-xs text-[var(--text-subtle)]">
                  Your email must already be in the {role} list uploaded by your company. Your name and {role} ID will be filled automatically.
                </p>
              </div>
            )}

            {/* EMAIL */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Work email <span className="text-error-500">*</span></label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required disabled={status === "sending"}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
              </div>
            </div>

            {/* PASSWORD */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Password <span className="text-error-500">*</span></label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Choose a password" required disabled={status === "sending"}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-10 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)] hover:text-[var(--text)]" tabIndex={-1}>
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {toastEl}

            <button type="submit"
              disabled={
                status === "sending" ||
                !email.trim() ||
                !password ||
                (role === "company"
                  ? !companyName.trim() || !licenseKey.trim() || !licenseValidated
                  : !companyValidated)
              }
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
              {status === "sending" ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating account...</> : <>Sign up <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
            Already have an account?{" "}
            <button onClick={goToSignIn} className="font-medium text-primary-600 hover:text-primary-700">Sign in</button>
          </p>
        </div>
        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          <button onClick={goToLicensing} className="font-medium text-primary-600 hover:text-primary-700">Go to Licensing Portal</button>
        </p>
      </div>
    </div>
  );
}

export function CustomerForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const { showError, toastEl } = useErrorToast();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    const { error } = await resetPassword(email.trim());
    if (error) {
      setStatus("idle");
      showError(error);
    } else {
      setStatus("sent");
    }
  };

  const goToSignIn = () => {
    localStorage.setItem("customer_screen", "signin");
    window.dispatchEvent(new Event("customer_screen_change"));
  };

  return (
    <div className="relative min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-500 shadow-lg shadow-primary-500/30">
            <KeyRound className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Reset Password</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">We'll send you a reset link</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-xl shadow-black/5">
          {status === "sent" ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-500/10">
                <ShieldCheck className="h-7 w-7 text-accent-600" />
              </div>
              <h2 className="text-lg font-semibold text-[var(--text)]">Check your email</h2>
              <p className="mt-2 text-sm text-[var(--text-muted)]">We've sent a password reset link to {email}.</p>
              <button onClick={goToSignIn}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700">
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Work email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoFocus disabled={status === "sending"}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
                </div>
              </div>
              {toastEl}
              <button type="submit" disabled={status === "sending" || !email.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                {status === "sending" ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</> : <>Send reset link <ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>
          )}
          {status !== "sent" && (
            <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
              <button onClick={goToSignIn} className="font-medium text-primary-600 hover:text-primary-700">Back to sign in</button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function PendingApprovalPage() {
  const { signOut } = useAuth();
  return (
    <div className="relative min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-xl text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning-500/10">
            <Clock className="h-7 w-7 text-warning-500" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--text)]">Awaiting Approval</h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Your account is pending approval from a company administrator. You will be able to sign in once approved.
          </p>
          <button onClick={async () => { await signOut(); }}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700">
            Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
}

export function AccountRemovedPage() {
  const { signOut } = useAuth();
  return (
    <div className="relative min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-xl text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-error-500/10">
            <Ban className="h-7 w-7 text-error-500" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--text)]">Account Removed</h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            This account has been removed by an administrator and can no longer be used to sign in. Please contact your company administrator if you believe this is an error.
          </p>
          <button onClick={async () => { await signOut(); }}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700">
            Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
}
