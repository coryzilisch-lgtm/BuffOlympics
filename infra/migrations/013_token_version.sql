-- 013_token_version.sql — session invalidation on password reset.
--
-- Run BY HAND in the Fabric portal SQL editor. Single step, idempotent.
--
-- What it enables (backend reads defensively — pre-013 everything works as
-- today, resets just don't kick old sessions):
--   * bo_users.token_version: stamped into every session token (`tv`). An
--     admin password reset bumps it, which invalidates EVERY token issued
--     before the reset — a lost/stolen phone is signed out the moment the
--     reset happens, instead of staying signed in for up to 30 days.
--     NULL reads as 0, so existing rows and already-issued tokens (which
--     carry no tv → 0) stay valid until the first reset touches them.

IF COL_LENGTH('dbo.bo_users', 'token_version') IS NULL
  ALTER TABLE dbo.bo_users ADD token_version INT NULL;
