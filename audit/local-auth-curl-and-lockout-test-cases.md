# Local Authentication Curl and Lockout Test Cases

Set the server URL and a cookie jar first:

```bash
export BASE_URL='http://localhost:3000'
export COOKIE_JAR="$(mktemp)"
```

The application exposes tRPC mutations under `/api/trpc`. The examples below use the JSON input envelope accepted by the tRPC HTTP adapter and preserve cookies with `-c`/`-b`.

## 1. Create an account

```bash
curl --fail-with-body -i -c "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -H 'accept: application/json' \
  --data-raw '{"json":{"name":"Alice Example","username":"alice.example","email":"alice@example.test","password":"correct horse battery staple"}}' \
  "$BASE_URL/api/trpc/auth.localSignup"
```

Expected result: HTTP 200, a JSON result containing `user`, and a `Set-Cookie` header for the signed session cookie. The password must never appear in the response or database row.

Duplicate identity test:

```bash
curl --fail-with-body -i -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  --data-raw '{"json":{"name":"Duplicate Alice","username":"alice.example","email":"other@example.test","password":"correct horse battery staple"}}' \
  "$BASE_URL/api/trpc/auth.localSignup"
```

Expected result: HTTP 409 or a tRPC `CONFLICT` error with `Username or email is already registered`.

## 2. Verify the authenticated session

```bash
curl --fail-with-body -i -b "$COOKIE_JAR" \
  -H 'accept: application/json' \
  "$BASE_URL/api/trpc/auth.me?input=%7B%22json%22%3Anull%7D"
```

Expected result: HTTP 200 with the newly created user. No `x-dev-role` header is required.

## 3. Log in with username

Use a fresh cookie jar to prove login, rather than reusing the signup session:

```bash
LOGIN_JAR="$(mktemp)"
curl --fail-with-body -i -c "$LOGIN_JAR" \
  -H 'content-type: application/json' \
  --data-raw '{"json":{"usernameOrEmail":"alice.example","password":"correct horse battery staple"}}' \
  "$BASE_URL/api/trpc/auth.localLogin"
```

Expected result: HTTP 200, a new session cookie, and a user object. The stored failed-attempt counter must reset to `0`.

## 4. Log in with normalized email

```bash
curl --fail-with-body -i -c "$LOGIN_JAR" \
  -H 'content-type: application/json' \
  --data-raw '{"json":{"usernameOrEmail":"ALICE@EXAMPLE.TEST","password":"correct horse battery staple"}}' \
  "$BASE_URL/api/trpc/auth.localLogin"
```

Expected result: HTTP 200. Identity matching is lower-case and trimmed.

## 5. Reject invalid credentials without leaking account existence

```bash
curl --fail-with-body -i \
  -H 'content-type: application/json' \
  --data-raw '{"json":{"usernameOrEmail":"alice.example","password":"wrong-password"}}' \
  "$BASE_URL/api/trpc/auth.localLogin"
```

Expected result: an HTTP error with tRPC code `UNAUTHORIZED` and the generic message `Invalid username/email or password`. The same response shape should be returned for an unknown username/email.

## 6. Verify lockout after five failed passwords

Use a dedicated test user. The first four invalid attempts increment `failed_attempts`; the fifth sets `locked_until` to approximately 15 minutes in the future.

```bash
for attempt in 1 2 3 4 5; do
  echo "attempt=$attempt"
  curl -sS -o "/tmp/local-login-$attempt.json" -w 'http=%{http_code}\n' \
    -H 'content-type: application/json' \
    --data-raw '{"json":{"usernameOrEmail":"alice.example","password":"definitely-wrong"}}' \
    "$BASE_URL/api/trpc/auth.localLogin"
done
```

Immediately try the correct password:

```bash
curl --fail-with-body -i \
  -H 'content-type: application/json' \
  --data-raw '{"json":{"usernameOrEmail":"alice.example","password":"correct horse battery staple"}}' \
  "$BASE_URL/api/trpc/auth.localLogin"
```

Expected result: it remains `UNAUTHORIZED` while `locked_until > now()`. The response is deliberately indistinguishable from an incorrect password.

Database assertion:

```sql
SELECT username, failed_attempts, locked_until
FROM local_credentials
WHERE username = 'alice.example';
```

Expected result: `failed_attempts >= 5` and `locked_until` approximately 15 minutes after the fifth failed attempt.

## 7. Verify successful login clears the lock state

After the lockout expires, retry the correct password:

```bash
curl --fail-with-body -i -c "$LOGIN_JAR" \
  -H 'content-type: application/json' \
  --data-raw '{"json":{"usernameOrEmail":"alice.example","password":"correct horse battery staple"}}' \
  "$BASE_URL/api/trpc/auth.localLogin"
```

Expected result: HTTP 200, a session cookie, `failed_attempts = 0`, and `locked_until IS NULL`.

## 8. Production-disabled local-auth test

With `NODE_ENV=production` and without `ENABLE_LOCAL_AUTH=true`, call either mutation:

```bash
curl --fail-with-body -i \
  -H 'content-type: application/json' \
  --data-raw '{"json":{"usernameOrEmail":"alice.example","password":"correct horse battery staple"}}' \
  "$BASE_URL/api/trpc/auth.localLogin"
```

Expected result: a tRPC `FORBIDDEN` response stating that local credential authentication is disabled and Keycloak SSO must be used.

## Automated test assertions

The integration suite should assert all of the following:

| Case | Required assertion |
|---|---|
| Signup | One `users` row and one `local_credentials` row are created transactionally. |
| Signup password storage | `password_hash` begins with `scrypt$`; plaintext password is absent from all persisted columns and response bodies. |
| Signup validation | Passwords under 12 characters and invalid usernames/emails are rejected before insertion. |
| Duplicate signup | Duplicate username and normalized email return `CONFLICT`; no orphan user row remains. |
| Login by username | Correct password returns 200 and an HttpOnly session cookie. |
| Login by email | Case and surrounding whitespace are normalized. |
| Wrong password | Returns generic `UNAUTHORIZED`; increments `failed_attempts`. |
| Unknown identity | Returns the same generic `UNAUTHORIZED` message. |
| Fifth failure | Sets `locked_until` approximately 15 minutes ahead. |
| Correct password during lock | Remains unauthorized and does not clear the lock. |
| Correct password after lock | Returns 200 and atomically clears `failed_attempts` and `locked_until`. |
| Production gate | Local mutations reject unless `ENABLE_LOCAL_AUTH=true`; Keycloak remains the required path. |

Do not run the lockout loop against a shared staging or production account. Use a disposable test identity and a database transaction or cleanup job approved for the environment.
