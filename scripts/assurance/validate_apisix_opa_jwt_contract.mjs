#!/usr/bin/env node
/**
 * Static Stage 4 contract gate. It verifies configuration relationships only;
 * real Keycloak, APISIX, adapter, and OPA calls remain a mandatory live gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
let failures = 0;
const pass = (name) => console.log(`PASS ${name}`);
const fail = (name, detail) => { failures += 1; console.error(`FAIL ${name}: ${detail}`); };
const requireText = (source, text, name) => source.includes(text) ? pass(name) : fail(name, `missing ${JSON.stringify(text)}`);
const rejectText = (source, text, name) => !source.includes(text) ? pass(name) : fail(name, `forbidden ${JSON.stringify(text)} present`);

const policy = read('payment-core/deployment/kubernetes/apisix-security-policies.yaml');
const routes = read('payment-core/deployment/kubernetes/apisix-jwt-routes.yaml');
const adapter = read('payment-core/deployment/kubernetes/opa-verified-claims-adapter.yaml');
const adapterSource = read('payment-core/go-services/cmd/opa-verified-claims-adapter/main.go');

requireText(policy, 'input.request.method', 'OPA policy uses documented APISIX request envelope');
requireText(policy, 'input.verified_jwt.valid == true', 'OPA policy requires verified claim evidence');
requireText(policy, 'input.verified_jwt.exp > time.now_ns()', 'OPA policy checks verified token expiry');
rejectText(policy, 'io.jwt.decode', 'OPA policy never decodes an unverified JWT');
requireText(policy, 'host: http://opa-verified-claims-adapter.payment-switch.svc.cluster.local:8080', 'APISIX OPA plugin targets verified-claim adapter');

const routeCount = (routes.match(/name: authz-keycloak/g) || []).length;
if (routeCount >= 3) pass(`Keycloak enforcement appears on ${routeCount} protected route definitions`);
else fail('Keycloak protected routes', `expected at least 3 authz-keycloak definitions, found ${routeCount}`);
requireText(routes, 'bearer_only: true', 'Keycloak routes require bearer authentication');
requireText(routes, 'ssl_verify: true', 'Keycloak routes require TLS verification');
requireText(routes, 'client_secret_ref:', 'Keycloak routes source confidential client secret from Kubernetes Secret');

requireText(adapter, 'KEYCLOAK_REQUIRED_ISSUER:', 'adapter pins required Keycloak issuer');
requireText(adapter, 'KEYCLOAK_REQUIRED_AUDIENCE:', 'adapter pins required Keycloak audience');
requireText(adapter, 'automountServiceAccountToken: false', 'adapter disables Kubernetes service-account token automount');
requireText(adapter, 'opa-verified-claims-adapter', 'adapter has internal service identity');
requireText(adapterSource, 'ValidateToken(r.Context(), token)', 'adapter independently validates bearer token');
requireText(adapterSource, 'VerifiedJWT: verifiedJWT{', 'adapter constructs verified_jwt explicitly');
rejectText(adapterSource, 'Header.Get("X-Userinfo")', 'adapter does not trust X-Userinfo');
rejectText(adapterSource, 'Header.Get("X-ID-Token")', 'adapter does not trust X-ID-Token');

if (failures > 0) {
  console.error(`APISIX OPA/JWT contract validation failed: ${failures} assertion(s)`);
  process.exit(1);
}
console.log('APISIX OPA/JWT contract validation passed. Live APISIX, Keycloak, adapter, and OPA execution remains required.');
