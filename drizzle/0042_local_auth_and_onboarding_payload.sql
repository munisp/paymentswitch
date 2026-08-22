-- Local credentials and lossless onboarding submission persistence.
-- Apply only after the existing users and participant_applications tables exist.
CREATE TABLE IF NOT EXISTS local_credentials (
  id serial PRIMARY KEY,
  user_id integer NOT NULL UNIQUE REFERENCES users(id),
  username varchar(64) NOT NULL UNIQUE,
  normalized_email varchar(320) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE participant_applications
  ADD COLUMN IF NOT EXISTS submission_payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE participant_applications
  ADD COLUMN IF NOT EXISTS document_manifest jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS local_credentials_locked_until_idx
  ON local_credentials (locked_until);
CREATE INDEX IF NOT EXISTS participant_applications_user_created_idx
  ON participant_applications (user_id, created_at DESC);
