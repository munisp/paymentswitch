# Zero-Downtime Deployment of Migration 0043

Migration `0043_onboarding_drafts.sql` is an additive expand migration. It creates a new table and indexes without altering or rewriting existing payment tables, so the application can remain online while the database change is applied.

## Deployment sequence

First, build and test the release against the migration artifact. Record the migration SHA-256 and require the same checksum in the deployment job:

```bash
export DATABASE_URL='postgresql://...'
export MIGRATION_SHA256="$(sha256sum drizzle/0043_onboarding_drafts.sql | awk '{print $1}')"
export MIGRATION_FILE='drizzle/0043_onboarding_drafts.sql'
```

Run the migration as a one-shot release job before enabling the application code that calls `getDraft`, `saveDraft`, or the multipart manifest persistence:

```bash
./scripts/db/deploy_0043_zero_downtime.sh
```

The script performs a database precondition check through PostgreSQL, verifies the artifact checksum, applies idempotent DDL with `ON_ERROR_STOP`, uses a deployment advisory lock so two migration jobs cannot run simultaneously, limits lock and statement wait time, and verifies the table, columns, and indexes afterward.

The recommended Kubernetes shape is a dedicated migration Job using the same immutable application image and Secret-backed `DATABASE_URL`. Set `backoffLimit: 1`, `activeDeadlineSeconds`, and a pre-deployment rollout gate that blocks the application Deployment until the Job succeeds. Do not run schema migrations in every application replica’s startup path.

## Expand/contract release order

The release order is:

1. Apply migration 0043 while the previous application version continues serving traffic.
2. Verify the table, constraints, indexes, and permissions.
3. Deploy the new application version, which begins writing drafts and object-storage manifests.
4. Enable the frontend resume and multipart-upload features.
5. Monitor draft-save conflict rates, storage failures, database latency, and orphaned multipart uploads.
6. Only after a later release proves no legacy code depends on an obsolete representation should any cleanup migration be considered.

There is no destructive contract step for 0043. Rollback of the application binary is safe because the new table remains unused by the previous version. Do not drop `onboarding_drafts` during rollback; preserve forward-compatible data for the next deployment.

## Production checks

Before execution, the release pipeline must verify that the target is the approved PostgreSQL cluster, the migration checksum matches the reviewed commit, the database role can create the table and indexes, and the database has sufficient connection and storage capacity. After execution, validate `current_step` and `version` constraints, the `user_id` uniqueness constraint, foreign keys, and index existence.

For high-traffic production databases, the indexes may be converted to `CREATE INDEX CONCURRENTLY` in a separately reviewed migration because concurrent index creation cannot run inside a transaction. Migration 0043 is expected to be low-lock because the new table is empty at creation time.

## Rollback

Application rollback is binary-safe and does not require a schema rollback. If the migration Job fails, the release remains blocked and the previous application version continues serving. If the new application version fails, roll back the Deployment image while retaining the additive table. Investigate failed or abandoned multipart uploads with an object-storage lifecycle rule; never delete draft rows as an emergency rollback action.
