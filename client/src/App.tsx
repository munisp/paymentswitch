import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import OfflineIndicator from "./components/OfflineIndicator";
import AppShell from "./components/AppShell";

// Lazy-loaded pages — each becomes a separate chunk (code splitting)
const OnboardingHome = lazy(() => import("./pages/OnboardingHome"));
const Auth = lazy(() => import("./pages/Auth"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const ReminderEmailManagement = lazy(
  () => import("./pages/admin/ReminderEmailManagement")
);
const RecoveryRequests = lazy(() => import("@/pages/admin/RecoveryRequests"));
const IntegrationsDashboard = lazy(
  () => import("@/pages/IntegrationsDashboard")
);
const PaymentGateway = lazy(() => import("./pages/PaymentGateway"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const BrandingSettings = lazy(() => import("./pages/BrandingSettings"));
const BrandingPreview = lazy(() => import("./pages/BrandingPreview"));
const DeveloperPortal = lazy(() => import("./pages/DeveloperPortal"));
const TechnicalOnboardingReview = lazy(
  () => import("@/pages/admin/TechnicalOnboardingReview")
);
const NotificationPreferences = lazy(
  () => import("@/pages/admin/NotificationPreferences")
);
const IntegrationDevelopment = lazy(
  () => import("@/pages/onboarding/IntegrationDevelopment")
);
const SharedComparisonView = lazy(
  () => import("@/pages/onboarding/SharedComparisonView")
);
const RemittanceDemo = lazy(() => import("@/pages/RemittanceDemo"));
const RemittanceAdminDashboard = lazy(
  () => import("@/pages/RemittanceAdminDashboard")
);
const RateAlerts = lazy(() => import("./pages/RateAlerts"));
const RateAlertAnalytics = lazy(() => import("@/pages/RateAlertAnalytics"));
const TwoFactorSettings = lazy(() => import("./pages/TwoFactorSettings"));
const TrustedDevices = lazy(() => import("@/pages/TrustedDevices"));
const NotificationSettings = lazy(() => import("@/pages/NotificationSettings"));
const AccountActivity = lazy(() => import("@/pages/AccountActivity"));
const VerifyTwoFactor = lazy(() => import("./pages/VerifyTwoFactor"));
const AccountRecovery = lazy(() => import("./pages/AccountRecovery"));
const OutboundRemittance = lazy(() => import("@/pages/OutboundRemittance"));
const OutboundApply = lazy(() => import("@/pages/OutboundApply"));
const InboundRemittance = lazy(() => import("@/pages/InboundRemittance"));
const DomesticPayments = lazy(() => import("@/pages/DomesticPayments"));
const TradePayments = lazy(() => import("@/pages/TradePayments"));
const CardProcessing = lazy(() => import("@/pages/CardProcessing"));
const GovernmentPayments = lazy(() => import("@/pages/GovernmentPayments"));
const OpenBanking = lazy(() => import("@/pages/OpenBanking"));
const MiddlewareMonitoring = lazy(() => import("@/pages/MiddlewareMonitoring"));
const SecurityDashboard = lazy(() => import("@/pages/SecurityDashboard"));
const Settlements = lazy(() => import("@/pages/Settlements"));
const SanctionsScreening = lazy(() => import("@/pages/SanctionsScreening"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const OnboardingPortal = lazy(
  () => import("@/pages/onboarding/OnboardingPortal")
);
const TechnicalOnboarding = lazy(
  () => import("@/pages/onboarding/TechnicalOnboarding")
);
const TestingCertification = lazy(
  () => import("@/pages/onboarding/TestingCertification")
);
const ProductionGoLive = lazy(
  () => import("@/pages/onboarding/ProductionGoLive")
);
const NotFound = lazy(() => import("@/pages/NotFound"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <AppShell>
        <Switch>
          <Route path={"/"} component={OnboardingHome} />
          <Route path="/login" component={Auth} />
          <Route path="/admin" component={AdminDashboard} />
          <Route path="/admin/reminders" component={ReminderEmailManagement} />
          <Route path="/admin/recovery-requests" component={RecoveryRequests} />
          <Route path="/admin/integrations" component={IntegrationsDashboard} />
          <Route path={"/payments"} component={PaymentGateway} />
          <Route path={"/checkout/:sessionId"} component={Checkout} />
          <Route path={"/dashboard"} component={Dashboard} />
          <Route path={"/branding"} component={BrandingSettings} />
          <Route path={"/preview/:previewId"} component={BrandingPreview} />
          <Route path={"/docs"} component={DeveloperPortal} />
          <Route
            path="/admin/technical-onboarding"
            component={TechnicalOnboardingReview}
          />
          <Route
            path="/admin/notification-preferences"
            component={NotificationPreferences}
          />
          <Route
            path="/onboarding/integration"
            component={IntegrationDevelopment}
          />
          <Route
            path="/shared-comparison/:shareToken"
            component={SharedComparisonView}
          />
          <Route path="/remittance-demo" component={RemittanceDemo} />
          <Route
            path="/admin/remittances"
            component={RemittanceAdminDashboard}
          />
          <Route path="/rate-alerts" component={RateAlerts} />
          <Route path="/rate-alert-analytics" component={RateAlertAnalytics} />
          <Route path="/settings/2fa" component={TwoFactorSettings} />
          <Route path="/settings/trusted-devices" component={TrustedDevices} />
          <Route
            path="/settings/notifications"
            component={NotificationSettings}
          />
          <Route path="/settings/activity" component={AccountActivity} />
          <Route path="/verify-2fa" component={VerifyTwoFactor} />
          <Route path="/account-recovery" component={AccountRecovery} />
          <Route path="/outbound-remittance" component={OutboundRemittance} />
          <Route path="/outbound/apply" component={OutboundApply} />
          <Route path="/inbound-remittance" component={InboundRemittance} />
          <Route path="/domestic-payments" component={DomesticPayments} />
          <Route path="/trade-payments" component={TradePayments} />
          <Route path="/card-processing" component={CardProcessing} />
          <Route path="/government-payments" component={GovernmentPayments} />
          <Route path="/open-banking" component={OpenBanking} />
          <Route path="/middleware" component={MiddlewareMonitoring} />
          <Route path="/security" component={SecurityDashboard} />
          <Route path="/settlements" component={Settlements} />
          <Route path="/sanctions" component={SanctionsScreening} />
          <Route path="/analytics">{() => <Analytics />}</Route>
          <Route path="/onboarding/portal" component={OnboardingPortal} />
          <Route path="/onboarding/technical">
            {() => <TechnicalOnboarding />}
          </Route>
          <Route path="/onboarding/certification">
            {() => <TestingCertification />}
          </Route>
          <Route path="/onboarding/go-live">{() => <ProductionGoLive />}</Route>
          <Route path={"/404"} component={NotFound} />
          {/* Final fallback route */}
          <Route component={NotFound} />
        </Switch>
      </AppShell>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <OfflineIndicator />
          {/* PWA Update Notification disabled for testing */}
          {/* <PWAUpdateNotification /> */}
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
