-- Durable resumable onboarding state, owned by the authenticated participant.
-- Apply after participant_applications and users exist.
CREATE TABLE IF NOT EXISTS onboarding_drafts (
  id serial PRIMARY KEY,
  user_id integer NOT NULL UNIQUE REFERENCES users(id),
  application_id integer UNIQUE REFERENCES participant_applications(id),
  current_step integer NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS onboarding_drafts_updated_idx
  ON onboarding_drafts (updated_at DESC);
CREATE INDEX IF NOT EXISTS onboarding_drafts_application_idx
  ON onboarding_drafts (application_id);
