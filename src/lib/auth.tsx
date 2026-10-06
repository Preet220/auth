import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  supabase,
  setSessionPersistence,
  shouldRememberSession,
} from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

type AppMode = "licensing" | "customer";

export type CustomerRole = "company" | "admin" | "employee" | null;

export type PendingState = "none" | "pending_approval" | "pending_activation" | "account_removed";

interface AppUser {
  id: string;
  email: string;
  name: string;
  role: string;
  companyId: string | null;
  employeeId: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  appUser: AppUser | null;
  loading: boolean;
  appMode: AppMode;
  customerRole: CustomerRole;
  riskManagementEnabled: boolean;
  pendingState: PendingState;
  setAppMode: (mode: AppMode) => void;
  signInWithPassword: (
    email: string,
    password: string,
    mode: AppMode,
    remember: boolean,
  ) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    mode: AppMode,
  ) => Promise<{ error: string | null }>;
  signUpCompany: (
    email: string,
    password: string,
    licenseKey: string,
    companyName: string,
  ) => Promise<{ error: string | null }>;
  signUpAdminOrEmployee: (
    email: string,
    password: string,
    role: "admin" | "employee",
    companyId: string,
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  getMasterEmail: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [riskManagementEnabled, setRiskManagementEnabled] = useState(true);
  const [pendingState, setPendingState] = useState<PendingState>("none");
  const [appMode, setAppMode] = useState<AppMode>(() => {
    return (localStorage.getItem("app_mode") as AppMode) || "customer";
  });

  useEffect(() => {
    localStorage.setItem("app_mode", appMode);
  }, [appMode]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!shouldRememberSession() && supabase) {
        supabase.auth.signOut();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (!data.session) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (!newSession) {
          setAppUser(null);
          setPendingState("none");
          setLoading(false);
        }
      },
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    (async () => {
      if (appMode === "licensing") {
        const { data: master } = await supabase
          .from("master_accounts")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (cancelled) return;

        if (master) {
          setAppUser({
            id: master.user_id,
            email: master.email,
            name: master.name,
            role: "master",
            companyId: null,
            employeeId: null,
          });
          setPendingState("none");
        } else {
          setAppUser(null);
          setPendingState("none");
          await supabase.auth.signOut();
        }
        setLoading(false);
        return;
      }

      // Customer mode — check admins first, then employees, then companies
      const { data: admin } = await supabase
        .from("admins")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (admin) {
        if (admin.status === "approved") {
          setAppUser({
            id: admin.user_id ?? user.id,
            email: admin.work_email,
            name: admin.admin_name,
            role: "admin",
            companyId: admin.company_id,
            employeeId: null,
          });
          setPendingState("none");
        } else if (admin.status === "removed") {
          setAppUser(null);
          setPendingState("account_removed");
        } else {
          setAppUser(null);
          setPendingState("pending_approval");
        }
        setLoading(false);
        return;
      }

      const { data: employee } = await supabase
        .from("employees")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (employee) {
        if (employee.status === "active") {
          setAppUser({
            id: employee.user_id ?? user.id,
            email: employee.work_email,
            name: employee.employee_name,
            role: "employee",
            companyId: employee.company_id,
            employeeId: employee.employee_id ?? null,
          });
          setPendingState("none");
        } else if (employee.status === "removed") {
          setAppUser(null);
          setPendingState("account_removed");
        } else {
          setAppUser(null);
          setPendingState("pending_approval");
        }
        setLoading(false);
        return;
      }

      const { data: company } = await supabase
        .from("companies")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (company) {
        setAppUser({
          id: user.id,
          email: user.email ?? "",
          name: company.company_name,
          role: "company",
          companyId: company.id,
          employeeId: null,
        });
        setPendingState("none");
      } else {
        setAppUser(null);
        setPendingState("none");
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, appMode]);

  useEffect(() => {
    if (appMode !== "customer" || !session) {
      setRiskManagementEnabled(true);
      return;
    }

    let cancelled = false;
    (async () => {
      const uid = session.user.id;
      const { data: coOwn } = await supabase
        .from("companies")
        .select("risk_management_enabled")
        .eq("user_id", uid)
        .maybeSingle();

      if (!cancelled && coOwn) {
        setRiskManagementEnabled(coOwn.risk_management_enabled ?? true);
        return;
      }

      const { data: adminRec } = await supabase
        .from("admins")
        .select("company_id")
        .eq("user_id", uid)
        .maybeSingle();

      let cId: string | null = adminRec?.company_id ?? null;
      if (!cId) {
        const { data: empRec } = await supabase
          .from("employees")
          .select("company_id")
          .eq("user_id", uid)
          .maybeSingle();
        cId = empRec?.company_id ?? null;
      }

      if (cId) {
        const { data: co } = await supabase
          .from("companies")
          .select("risk_management_enabled")
          .eq("id", cId)
          .maybeSingle();
        if (!cancelled) setRiskManagementEnabled(co?.risk_management_enabled ?? true);
      } else if (!cancelled) {
        setRiskManagementEnabled(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appMode, session]);

  const signInWithPassword = async (
    email: string,
    password: string,
    mode: AppMode,
    remember: boolean,
  ) => {
    setAppMode(mode);
    setSessionPersistence(remember);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string, mode: AppMode) => {
    setAppMode(mode);
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) return { error: signUpError.message };

    if (mode === "licensing" && signUpData.user) {
      const { error: masterError } = await supabase.rpc("create_master_account", {
        p_user_id: signUpData.user.id,
        p_email: email.trim(),
        p_name: "Master Admin",
      });
      if (masterError) {
        return { error: `Failed to create master account: ${masterError.message}` };
      }
      await supabase.auth.signOut();
    }

    return { error: null };
  };

  const signUpCompany = async (
    email: string,
    password: string,
    licenseKey: string,
    companyName: string,
  ) => {
    // 1. Verify license key is available (use RPC to bypass RLS for unauthenticated users)
    const { data: licenseData, error: licenseError } = await supabase.rpc(
      "lookup_license_key",
      { p_key_value: licenseKey.trim() }
    );

    if (licenseError) {
      return { error: `License verification failed: ${licenseError.message}` };
    }
    if (!licenseData) {
      return { error: "Invalid license key. Please check for typos." };
    }
    if (licenseData.status !== "available") {
      return { error: "This license key has already been used." };
    }

    // 2. Create auth account
    const { data: signUpData, error: signUpError } =
      await supabase.auth.signUp({ email, password });
    if (signUpError) return { error: signUpError.message };
    if (!signUpData.user) return { error: "Failed to create account." };

    // 3. Complete company signup via SECURITY DEFINER function (bypasses RLS for new user)
    const { data: completionData, error: completionError } = await supabase.rpc(
      "complete_company_signup",
      {
        p_user_id: signUpData.user.id,
        p_email: email.trim(),
        p_company_name: companyName.trim(),
        p_key_value: licenseKey.trim(),
      }
    );

    if (completionError) {
      return { error: `Failed to create company: ${completionError.message}` };
    }
    if (completionData?.error) {
      return { error: completionData.error };
    }

    await supabase.auth.signOut();
    return { error: null };
  };

  const signUpAdminOrEmployee = async (
    email: string,
    password: string,
    role: "admin" | "employee",
    companyId: string,
  ) => {
    // 1. Verify company exists and has active license (use RPC to bypass RLS for unauthenticated users)
    const { data: company, error: companyError } = await supabase.rpc(
      "lookup_company_by_id",
      { p_company_id: companyId.trim() }
    );

    if (companyError) {
      return { error: `Company verification failed: ${companyError.message}` };
    }
    if (!company) {
      return { error: "Company ID not found." };
    }
    if (company.license_status !== "active") {
      return { error: `This company's license is ${company.license_status}.` };
    }

    // 2. Look up pre-uploaded record by email (use RPC to bypass RLS for unauthenticated users)
    const table = role === "admin" ? "admins" : "employees";
    const { data: existingRecord, error: lookupError } = await supabase.rpc(
      "lookup_signup_record",
      { p_email: email.trim(), p_company_id: companyId.trim(), p_role: role }
    );

    if (lookupError) {
      return { error: `Lookup failed: ${lookupError.message}` };
    }
    if (!existingRecord) {
      return {
        error: `Your email (${email}) was not found in the ${role} list. Please ask your company administrator to upload your details first.`,
      };
    }

    // 3. Check if already linked to another auth account
    if (existingRecord.user_id) {
      return { error: "This email is already registered. Please sign in instead." };
    }

    // 5. Create auth account
    const { data: signUpData, error: signUpError } =
      await supabase.auth.signUp({ email, password });
    if (signUpError) return { error: signUpError.message };
    if (!signUpData.user) return { error: "Failed to create account." };

    // 6. Complete signup via SECURITY DEFINER function (bypasses RLS for new user)
    const { data: completionData, error: completionError } = await supabase.rpc(
      "complete_admin_employee_signup",
      {
        p_user_id: signUpData.user.id,
        p_email: email.trim(),
        p_role: role,
        p_company_id: companyId.trim(),
        p_record_id: existingRecord.id,
      }
    );

    if (completionError) {
      return { error: `Failed to link account: ${completionError.message}` };
    }
    if (completionData?.error) {
      return { error: completionData.error };
    }

    await supabase.auth.signOut();
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setAppUser(null);
    setPendingState("none");
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    return { error: error?.message ?? null };
  };

  const getMasterEmail = async () => {
    const { data } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "master_email")
      .maybeSingle();
    return data?.value ?? "healthcareatul@gmail.com";
  };

  const customerRole: CustomerRole =
    appUser?.role === "company" ||
    appUser?.role === "admin" ||
    appUser?.role === "employee"
      ? (appUser.role as CustomerRole)
      : null;

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        appUser,
        loading,
        appMode,
        customerRole,
        riskManagementEnabled,
        pendingState,
        setAppMode,
        signInWithPassword,
        signUp,
        signUpCompany,
        signUpAdminOrEmployee,
        signOut,
        resetPassword,
        getMasterEmail,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
