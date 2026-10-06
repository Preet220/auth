import { useState, useEffect } from 'react';
import { Loader as Loader2, ShieldAlert } from 'lucide-react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// Licensing pages
import { LicensingSignInPage } from '@/pages/licensing/LicensingSignInPage';
import { LicensingLayout, type LicensingPage } from '@/components/LicensingLayout';
import { CompaniesPage } from '@/pages/licensing/CompaniesPage';
import { LicenseKeysPage } from '@/pages/licensing/LicenseKeysPage';
import { ValidationsPage } from '@/pages/licensing/ValidationsPage';

// Customer pages
import { CustomerSignInPage, CustomerSignUpPage, CustomerForgotPasswordPage, PendingApprovalPage, AccountRemovedPage } from '@/pages/customer/CustomerAuthPages';
import { CustomerLayout, type CustomerPage } from '@/components/CustomerLayout';
import { AdminOverviewPage, EmployeeOverviewPage } from '@/pages/customer/OverviewPages';
import { CompanyDashboard } from '@/pages/customer/CompanyDashboard';
import { EmployeesPage } from '@/pages/customer/EmployeesPage';
import { QrCodesPage } from '@/pages/customer/QrCodesPage';
import { SealsPage } from '@/pages/customer/SealsPage';
import { CustomFieldsPage } from '@/pages/customer/CustomFieldsPage';
import { ScansPage } from '@/pages/customer/ScansPage';
import { ProcessesPage } from '@/pages/customer/ProcessesPage';
import { ProcessRecordsPage } from '@/pages/customer/ProcessRecordsPage';
import { RiskRulesPage } from '@/pages/customer/RiskRulesPage';
import { AlertsPage } from '@/pages/customer/AlertsPage';
import { ResetRequestsPage } from '@/pages/customer/ResetRequestsPage';
import { CustomerActivityPage } from '@/pages/customer/CustomerActivityPage';
import { EmployeeProcessPage } from '@/pages/customer/EmployeeProcessPage';

function RiskDisabledMessage() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-md rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning-500/10">
          <ShieldAlert className="h-7 w-7 text-warning-500" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--text)]">Risk Management is not available</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Risk management has been disabled for your organization. Please contact your provider to enable this feature.
        </p>
      </div>
    </div>
  );
}

function AppContent() {
  const { session, loading, appMode, appUser, riskManagementEnabled, pendingState } = useAuth();
  const [licensingPage, setLicensingPage] = useState<LicensingPage>('companies');
  const [customerPage, setCustomerPage] = useState<CustomerPage>('overview');
  const [customerScreen, setCustomerScreen] = useState<'signin' | 'signup' | 'forgot'>(() =>
    (localStorage.getItem('customer_screen') as 'signin' | 'signup' | 'forgot') || 'signin'
  );

  useEffect(() => {
    const handler = () => setCustomerScreen(localStorage.getItem('customer_screen') as 'signin' | 'signup' | 'forgot' || 'signin');
    window.addEventListener('customer_screen_change', handler);
    return () => window.removeEventListener('customer_screen_change', handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      const mode = localStorage.getItem('app_mode') as 'licensing' | 'customer' | null;
      if (mode) {
        setCustomerScreen(localStorage.getItem('customer_screen') as 'signin' | 'signup' | 'forgot' || 'signin');
      }
    };
    window.addEventListener('app_mode_change', handler);
    return () => window.removeEventListener('app_mode_change', handler);
  }, []);

  useEffect(() => {
    if (session?.user && appUser) {
      supabase.from('customer_activity_logs').insert({
        actor_id: appUser.id,
        actor_email: appUser.email,
        actor_role: appUser.role,
        action: 'sign_in',
        details: null,
      }).then(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  // ---- Licensing mode ----
  if (appMode === 'licensing') {
    if (!session || !appUser || appUser.role !== 'master') {
      return <LicensingSignInPage />;
    }
    return (
      <LicensingLayout current={licensingPage} onNavigate={setLicensingPage}>
        {licensingPage === 'companies' && <CompaniesPage />}
        {licensingPage === 'license_keys' && <LicenseKeysPage />}
        {licensingPage === 'validations' && <ValidationsPage />}
      </LicensingLayout>
    );
  }

  // ---- Customer mode ----
  if (!session || !appUser) {
    if (pendingState === 'pending_approval') {
      return <PendingApprovalPage />;
    }
    if (pendingState === 'account_removed') {
      return <AccountRemovedPage />;
    }
    if (customerScreen === 'signup') return <CustomerSignUpPage />;
    if (customerScreen === 'forgot') return <CustomerForgotPasswordPage />;
    return <CustomerSignInPage />;
  }

  const role = appUser.role;

  // Company role — company dashboard
  if (role === 'company') {
    return (
      <CustomerLayout current={customerPage} onNavigate={setCustomerPage} riskManagementEnabled={riskManagementEnabled}>
        {customerPage === 'overview' && <CompanyDashboard />}
        {customerPage === 'admins' && <CompanyDashboard />}
        {customerPage === 'activity' && <CustomerActivityPage />}
      </CustomerLayout>
    );
  }

  // Employee role — employee dashboard
  if (role === 'employee') {
    return (
      <CustomerLayout current={customerPage} onNavigate={setCustomerPage} riskManagementEnabled={riskManagementEnabled}>
        {customerPage === 'overview' && <EmployeeOverviewPage />}
        {customerPage === 'my_processes' && <EmployeeProcessPage riskManagementEnabled={riskManagementEnabled} />}
        {customerPage === 'scans' && <ScansPage />}
      </CustomerLayout>
    );
  }

  // Admin role — admin dashboard (default)
  return (
    <CustomerLayout current={customerPage} onNavigate={setCustomerPage} riskManagementEnabled={riskManagementEnabled}>
      {customerPage === 'overview' && <AdminOverviewPage riskManagementEnabled={riskManagementEnabled} />}
      {customerPage === 'admins' && <CompanyDashboard />}
      {customerPage === 'employees' && <EmployeesPage />}
      {customerPage === 'qr_codes' && <QrCodesPage />}
      {customerPage === 'seals' && <SealsPage />}
      {customerPage === 'custom_fields' && <CustomFieldsPage />}
      {customerPage === 'scans' && <ScansPage />}
      {customerPage === 'processes' && <ProcessesPage riskManagementEnabled={riskManagementEnabled} />}
      {customerPage === 'process_records' && <ProcessRecordsPage riskManagementEnabled={riskManagementEnabled} />}
      {customerPage === 'risk_rules' && (riskManagementEnabled ? <RiskRulesPage /> : <RiskDisabledMessage />)}
      {customerPage === 'alerts' && (riskManagementEnabled ? <AlertsPage /> : <RiskDisabledMessage />)}
      {customerPage === 'reset_requests' && <ResetRequestsPage />}
      {customerPage === 'activity' && <CustomerActivityPage />}
    </CustomerLayout>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
