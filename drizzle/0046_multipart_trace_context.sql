ALTER TABLE multipart_upload_sessions
  ADD COLUMN IF NOT EXISTS traceparent varchar(255);

COMMENT ON COLUMN multipart_upload_sessions.traceparent IS
  'W3C traceparent captured at multipart initiation; contains no credentials or document content.';
