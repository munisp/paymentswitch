#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const apiService = read('mobile/flutter_app/lib/services/api_service.dart');
const login = read('mobile/flutter_app/lib/screens/login_screen.dart');
const dashboard = read('mobile/flutter_app/lib/screens/dashboard_screen.dart');
const home = read('mobile/flutter_app/lib/screens/home_screen.dart');
const outbound = read('mobile/flutter_app/lib/screens/outbound_remittance_screen.dart');
const providers = read('mobile/flutter_app/lib/providers/app_providers.dart');
const pubspec = read('mobile/flutter_app/pubspec.yaml');
const realm = JSON.parse(read('config/keycloak/realm-export.json'));
const compose = read('docker-compose.unified.yml');
const assuranceEnv = read('.env.assurance.example');
const preflight = read('scripts/assurance/live_gate_preflight.sh');
const routers = read('server/routers.ts');
const mobileRouter = read('server/routers/mobileRouter.ts');
const outboundRouter = read('server/routers/outboundRemittanceRouter.ts');

assert(pubspec.includes('flutter_appauth:'), 'Flutter AppAuth dependency is missing.');
assert(apiService.includes("String.fromEnvironment('PAYMENT_SWITCH_API_BASE_URL')"), 'Mobile API URL is not supplied through a build-time setting.');
assert(apiService.includes('authorizeAndExchangeCode'), 'Mobile Authorization Code exchange is missing.');
assert(apiService.includes('offline_access'), 'Mobile refresh-token scope is missing.');
assert(apiService.includes('FlutterSecureStorage'), 'Mobile refresh-token secure storage is missing.');
assert(!/api\.payswitch\.ng|auth\.login|auth\.register/.test(apiService), 'Stale hard-coded host or password-login procedure remains in the mobile API service.');
assert(!/Future\.delayed|TextFormField\(/.test(login), 'Login screen retains a delayed fake sign-in or local password form.');
assert(login.includes('Continue to secure sign in'), 'Login screen is not bound to the PKCE sign-in action.');
assert(providers.includes('restoreSession') && providers.includes('MobileAuthenticationException'), 'Mobile session bootstrap is not fail-closed.');
for (const [name, source] of Object.entries({ dashboard, home, outbound })) {
  assert(!/List\.generate|Future\.delayed/.test(source), `${name} retains generated or delayed operational data.`);
}
assert(dashboard.includes('mobileDashboardProvider') && home.includes('mobileDashboardProvider'), 'Home and dashboard do not share the authoritative mobile data provider.');
assert(outbound.includes('outboundDashboardProvider'), 'Outbound operations screen is not bound to the server read model.');

const mobileClient = realm.clients.find((client) => client.clientId === 'payment-switch-mobile');
assert(Boolean(mobileClient), 'Keycloak realm has no payment-switch-mobile client.');
if (mobileClient) {
  assert(mobileClient.publicClient === true, 'Mobile Keycloak client is not public.');
  assert(mobileClient.standardFlowEnabled === true, 'Mobile Keycloak client does not allow authorization-code flow.');
  assert(mobileClient.implicitFlowEnabled === false, 'Mobile Keycloak client allows implicit flow.');
  assert(mobileClient.directAccessGrantsEnabled === false, 'Mobile Keycloak client allows password grants.');
  assert(mobileClient.pkceCodeChallengeMethod === 'S256', 'Mobile Keycloak client does not require S256 PKCE.');
  assert(mobileClient.redirectUris?.includes('${MOBILE_AUTH_REDIRECT_URI}'), 'Mobile Keycloak redirect URI is not environment-rendered.');
}
assert(compose.includes('MOBILE_AUTH_REDIRECT_URI'), 'Compose does not pass the mobile redirect URI to the realm import.');
assert(assuranceEnv.includes('MOBILE_AUTH_REDIRECT_URI='), 'Assurance environment template lacks the mobile redirect URI.');
assert(preflight.includes('MOBILE_AUTH_REDIRECT_URI'), 'Identity preflight does not validate the mobile redirect URI.');
assert(routers.includes('transactions: transactionsRouter') && routers.includes('dashboard: dashboardRouter'), 'Mobile transaction/dashboard routers are not registered.');
assert(mobileRouter.includes('getStats: protectedProcedure') && mobileRouter.includes("source: 'postgresql'"), 'Dashboard router does not expose the PostgreSQL-backed mobile contract.');
assert(outboundRouter.includes('getDashboardMetrics: protectedProcedure'), 'Outbound dashboard procedure is not registered.');

if (failures.length > 0) {
  console.error('Mobile identity contract validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Mobile identity contract validation passed. Native device execution remains a separate live gate.');
