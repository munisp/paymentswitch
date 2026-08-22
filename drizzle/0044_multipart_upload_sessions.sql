-- Persistent multipart lifecycle state for enterprise KYC uploads.
-- Apply after users exists.
CREATE TABLE IF NOT EXISTS multipart_upload_sessions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  upload_id varchar(512) NOT NULL UNIQUE,
  object_key varchar(1024) NOT NULL UNIQUE,
  document_label varchar(255) NOT NULL,
  original_file_name varchar(255) NOT NULL,
  content_type varchar(128) NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 524288000),
  status varchar(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'aborted', 'abandoned')),
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp,
  aborted_at timestamp
);

CREATE INDEX IF NOT EXISTS multipart_upload_sessions_active_expiry_idx
  ON multipart_upload_sessions (status, expires_at);
CREATE INDEX IF NOT EXISTS multipart_upload_sessions_user_status_idx
  ON multipart_upload_sessions (user_id, status);
