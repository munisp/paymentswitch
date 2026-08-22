-- Retry and audit state for abandoned multipart cleanup.
ALTER TABLE multipart_upload_sessions
  ADD COLUMN IF NOT EXISTS cleanup_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE multipart_upload_sessions
  ADD COLUMN IF NOT EXISTS last_cleanup_error text;
ALTER TABLE multipart_upload_sessions
  ADD COLUMN IF NOT EXISTS cleanup_claimed_at timestamp;
ALTER TABLE multipart_upload_sessions
  ADD COLUMN IF NOT EXISTS cleanup_succeeded_at timestamp;

ALTER TABLE multipart_upload_sessions
  DROP CONSTRAINT IF EXISTS multipart_upload_sessions_status_check;
ALTER TABLE multipart_upload_sessions
  ADD CONSTRAINT multipart_upload_sessions_status_check
  CHECK (status IN ('active', 'completed', 'aborted', 'abandoned', 'cleanup_failed'));

CREATE INDEX IF NOT EXISTS multipart_upload_sessions_cleanup_retry_idx
  ON multipart_upload_sessions (status, cleanup_claimed_at, expires_at)
  WHERE status IN ('active', 'abandoned', 'cleanup_failed');
