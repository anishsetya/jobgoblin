-- Migration 0001: every table of the first release.
-- Spec: ARCHITECTURE.md section 7 ("Storage"); tech spec "Data model and storage".
--
-- How to read this file
--   * Every table is STRICT, so SQLite refuses a value of the wrong type instead of quietly converting it.
--   * Columns that hold JSON are plain TEXT with a json_valid() check. The code parses them with the
--     zod schemas from @jobgoblin/schemas, so the shape is checked in TypeScript, not here.
--   * Timestamps are UTC ISO-8601 text ("2026-10-31T14:05:00.000Z") and calendar days are "YYYY-MM-DD".
--     Both sort correctly as plain text.
--   * Every CHECK (column IN (...)) list is written out literally, and a test compares each one with the
--     matching zod enum. Adding a status or a run state means writing migration 0002.
--   * The migration runner wraps this file in a transaction and sets PRAGMA user_version afterwards.
--     Do not put BEGIN, COMMIT or PRAGMA user_version in a migration.

-- ---------------------------------------------------------------------------------------------
-- The person: profile, Your story, the master resume, uploaded documents
-- ---------------------------------------------------------------------------------------------

-- One row per profile section (contact, workAuthorization, employment, compensation, eeo, targets, rules).
-- A missing row means "nothing saved yet"; the code then uses the schema's defaults.
CREATE TABLE profile (
  section    TEXT PRIMARY KEY CHECK (section IN ('contact', 'workAuthorization', 'employment', 'compensation', 'eeo', 'targets', 'rules')),
  data       TEXT NOT NULL CHECK (json_valid(data)),
  updated_at TEXT NOT NULL
) STRICT;

-- Your story: everything the person has confirmed about themselves. A resume is only a selection from it.
CREATE TABLE story_items (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('experience', 'project', 'education', 'achievement', 'skill', 'headline')),
  parent_id  TEXT REFERENCES story_items (id),
  status     TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
  data       TEXT NOT NULL CHECK (json_valid(data)),
  keywords   TEXT NOT NULL CHECK (json_valid(keywords)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX story_items_status ON story_items (status, kind);
CREATE INDEX story_items_parent ON story_items (parent_id);

-- The default one-page selection from Your story, built by code when setup finishes. At most one row.
CREATE TABLE master_resume (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  body       TEXT NOT NULL CHECK (json_valid(body)),
  updated_at TEXT NOT NULL
) STRICT;

-- The resume and LinkedIn PDF the person uploaded in setup. Only the text with contact details
-- removed (decision D10) is kept, so a run never sees an email address or a phone number.
CREATE TABLE uploads (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('resume', 'linkedin')),
  file_name     TEXT NOT NULL,
  redacted_text TEXT NOT NULL,
  uploaded_at   TEXT NOT NULL
) STRICT;

-- ---------------------------------------------------------------------------------------------
-- Finding jobs: watched companies, every job seen, the cache of feed responses
-- ---------------------------------------------------------------------------------------------

CREATE TABLE companies (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  ats    TEXT NOT NULL CHECK (ats IN ('greenhouse', 'lever', 'ashby')),
  slug   TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Watching', 'Suggested', 'Passed')),
  UNIQUE (ats, slug)
) STRICT;

-- Every job seen in a feed or pasted by the person (decision D9: feed results go here, not into applications).
CREATE TABLE jobs (
  job_id          TEXT PRIMARY KEY,
  dedupe_key      TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('greenhouse', 'lever', 'ashby', 'hn', 'yc', 'remoteok', 'wwr', 'web', 'pasted')),
  company         TEXT NOT NULL,
  title           TEXT NOT NULL,
  location        TEXT NOT NULL,
  region          TEXT NOT NULL CHECK (region IN ('US', 'IN', 'REMOTE', 'OTHER')),
  url             TEXT,
  text            TEXT NOT NULL,
  questions       TEXT NOT NULL CHECK (json_valid(questions)),
  posted_at       TEXT,
  found_at        TEXT NOT NULL,
  seen_at         TEXT,
  filtered_reason TEXT
) STRICT;
CREATE INDEX jobs_dedupe_key ON jobs (dedupe_key);
-- "Jobs a hunt has not looked at yet": the only jobs a run is ever shown.
CREATE INDEX jobs_unseen ON jobs (found_at) WHERE seen_at IS NULL AND filtered_reason IS NULL;

-- The last response of each feed URL, so the next fetch can ask "has it changed?" (ETag, Last-Modified).
CREATE TABLE feed_cache (
  url           TEXT PRIMARY KEY,
  etag          TEXT,
  last_modified TEXT,
  body          TEXT NOT NULL,
  fetched_at    TEXT NOT NULL
) STRICT;

-- ---------------------------------------------------------------------------------------------
-- Resumes. The content of a version is shared by every application that uses it (decision D18).
-- ---------------------------------------------------------------------------------------------

CREATE TABLE resume_versions (
  version_id       TEXT PRIMARY KEY,           -- "r-" plus 64 hex characters
  short_id         TEXT NOT NULL UNIQUE,       -- "r-" plus 8 hex characters; names Resumes/<short_id>.pdf
  body             TEXT NOT NULL CHECK (json_valid(body)),
  header_hash      TEXT NOT NULL,
  template_version TEXT NOT NULL,
  created_at       TEXT NOT NULL
) STRICT;

-- ---------------------------------------------------------------------------------------------
-- Applications and everything that hangs off one
-- ---------------------------------------------------------------------------------------------

CREATE TABLE applications (
  id              TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL REFERENCES jobs (job_id),
  company         TEXT NOT NULL,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN (
                    'Found', 'Scored', 'Skipped (low fit)', 'Long shot', 'Tailored', 'Awaiting approval',
                    'Skipped', 'Approved', 'Filling', 'Needs your input', 'Applied', 'OA', 'Phone screen',
                    'Onsite', 'Offer', 'Rejected', 'Ghosted', 'Withdrawn', 'Accepted', 'Declined')),
  fit_score       INTEGER CHECK (fit_score BETWEEN 0 AND 100),
  band            TEXT CHECK (band IN ('apply', 'stretch', 'long-shot', 'skip')),
  resume_version  TEXT REFERENCES resume_versions (version_id),
  submit_mode     TEXT NOT NULL CHECK (submit_mode IN ('manual', 'extension')),
  folder          TEXT,                        -- relative to the person's folder, with "/" separators
  applied_at      TEXT,
  follow_up_on    TEXT,                        -- a calendar day, "YYYY-MM-DD"
  tailor_attempts INTEGER NOT NULL DEFAULT 0,
  tailor_error    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
) STRICT;
CREATE INDEX applications_status ON applications (status);
CREATE INDEX applications_job_id ON applications (job_id);
CREATE INDEX applications_company ON applications (company COLLATE NOCASE);
CREATE INDEX applications_follow_up_on ON applications (follow_up_on) WHERE follow_up_on IS NOT NULL;

-- The latest fit analysis of an application. The job id is not repeated here: it is the application's.
CREATE TABLE fits (
  application_id   TEXT PRIMARY KEY REFERENCES applications (id),
  score            INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  band             TEXT NOT NULL CHECK (band IN ('apply', 'stretch', 'long-shot', 'skip')),
  track            TEXT NOT NULL,
  must_haves       TEXT NOT NULL CHECK (json_valid(must_haves)),
  gaps             TEXT NOT NULL CHECK (json_valid(gaps)),
  flags            TEXT NOT NULL CHECK (json_valid(flags)),
  matched_item_ids TEXT NOT NULL CHECK (json_valid(matched_item_ids)),
  reason           TEXT NOT NULL,
  hard_skip        TEXT,
  rubric_version   TEXT NOT NULL,
  created_at       TEXT NOT NULL
) STRICT;

-- One application's use of one resume version. An approved row keeps the exact PDF bytes (decision D19),
-- so a missing file can always be written again, byte for byte, from here.
CREATE TABLE application_resumes (
  application_id TEXT NOT NULL REFERENCES applications (id),
  version_id     TEXT NOT NULL REFERENCES resume_versions (version_id),
  state          TEXT NOT NULL CHECK (state IN ('draft', 'approved')),
  pdf_sha256     TEXT,
  pdf_bytes      BLOB,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (application_id, version_id),
  -- A draft has no frozen file; an approved resume always has the file and its fingerprint.
  CHECK (
    (state = 'draft'    AND pdf_sha256 IS NULL     AND pdf_bytes IS NULL) OR
    (state = 'approved' AND pdf_sha256 IS NOT NULL AND pdf_bytes IS NOT NULL)
  )
) STRICT;
CREATE INDEX application_resumes_version ON application_resumes (version_id);

-- The person's approval of one exact data sheet and one exact resume file.
CREATE TABLE approvals (
  id               TEXT PRIMARY KEY,
  application_id   TEXT NOT NULL REFERENCES applications (id),
  data_sheet       TEXT NOT NULL CHECK (json_valid(data_sheet)),
  data_sheet_hash  TEXT NOT NULL,
  resume_version   TEXT NOT NULL REFERENCES resume_versions (version_id),
  pdf_sha256       TEXT NOT NULL,
  submit_mode      TEXT NOT NULL CHECK (submit_mode IN ('manual', 'extension')),
  approved_at      TEXT NOT NULL,
  used_at          TEXT,
  voided_at        TEXT
) STRICT;
CREATE INDEX approvals_application ON approvals (application_id, approved_at);
-- An approval is "live" until it is used or voided. An application never has two live approvals at once.
CREATE UNIQUE INDEX approvals_one_live_per_application ON approvals (application_id)
  WHERE used_at IS NULL AND voided_at IS NULL;

-- Proof that an application was sent. "Applied" always has one of these.
CREATE TABLE submissions (
  id              TEXT PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications (id),
  resume_version  TEXT NOT NULL REFERENCES resume_versions (version_id),
  attached_sha256 TEXT,
  proof_type      TEXT NOT NULL CHECK (proof_type IN ('confirmation-page', 'pasted-text', 'screenshot', 'email-subject', 'person-saw-it')),
  proof           TEXT NOT NULL,
  submitted_at    TEXT NOT NULL
) STRICT;
CREATE INDEX submissions_application ON submissions (application_id);

-- The screening answers written after approval, in the order they were saved.
CREATE TABLE answers (
  application_id TEXT NOT NULL REFERENCES applications (id),
  question       TEXT NOT NULL,
  answer         TEXT NOT NULL,
  saved_at       TEXT NOT NULL,
  PRIMARY KEY (application_id, question)
) STRICT;

-- ---------------------------------------------------------------------------------------------
-- Runs: background Claude Code sessions, their work queue and their questions
-- ---------------------------------------------------------------------------------------------

CREATE TABLE runs (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('setup', 'hunt', 'paste', 'tailor', 'answers', 'ask')),
  status          TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting', 'done', 'failed', 'blocked', 'interrupted', 'cancelled')),
  model           TEXT NOT NULL CHECK (model IN ('haiku', 'sonnet', 'opus')),
  input           TEXT NOT NULL CHECK (json_valid(input)),
  session_id      TEXT,
  pid             INTEGER,
  step            TEXT,
  progress_done   INTEGER NOT NULL DEFAULT 0,
  progress_total  INTEGER,
  outcome_message TEXT,
  result_text     TEXT,
  retry_of        TEXT REFERENCES runs (id),
  queued_at       TEXT NOT NULL,
  started_at      TEXT,
  ended_at        TEXT,
  dismissed_at    TEXT
) STRICT;
CREATE INDEX runs_status ON runs (status, queued_at);

-- One application inside a run's work queue.
CREATE TABLE run_tasks (
  run_id         TEXT NOT NULL REFERENCES runs (id),
  application_id TEXT NOT NULL REFERENCES applications (id),
  state          TEXT NOT NULL CHECK (state IN ('pending', 'done', 'failed', 'waiting')),
  note           TEXT,
  PRIMARY KEY (run_id, application_id)
) STRICT;
CREATE INDEX run_tasks_application ON run_tasks (application_id);

-- A question a run asked the person about one application (decision D17: it never changes the status).
CREATE TABLE questions (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES runs (id),
  run_kind       TEXT NOT NULL CHECK (run_kind IN ('setup', 'hunt', 'paste', 'tailor', 'answers', 'ask')),
  application_id TEXT NOT NULL REFERENCES applications (id),
  text           TEXT NOT NULL,
  answer         TEXT,
  asked_at       TEXT NOT NULL,
  answered_at    TEXT
) STRICT;
CREATE INDEX questions_application ON questions (application_id);
CREATE INDEX questions_open ON questions (asked_at) WHERE answer IS NULL;

-- ---------------------------------------------------------------------------------------------
-- The change log and the settings
-- ---------------------------------------------------------------------------------------------

CREATE TABLE history_events (
  id             TEXT PRIMARY KEY,
  ts             TEXT NOT NULL,
  actor          TEXT NOT NULL CHECK (actor IN ('person', 'run', 'server', 'extension')),
  application_id TEXT REFERENCES applications (id),
  type           TEXT NOT NULL CHECK (type IN (
                   'status-changed', 'tailor-requested', 'resume-drafted', 'approved', 're-approved',
                   'approval-voided', 'question-asked', 'question-answered', 'answers-saved', 'submitted', 'note')),
  from_status    TEXT,
  to_status      TEXT,
  detail         TEXT
) STRICT;
CREATE INDEX history_events_application ON history_events (application_id, ts);
CREATE INDEX history_events_to_status ON history_events (to_status, ts);

-- History cannot be rewritten: these two triggers refuse every UPDATE and DELETE (tech spec "Rules").
CREATE TRIGGER history_events_no_update BEFORE UPDATE ON history_events
BEGIN
  SELECT RAISE(ABORT, 'history_events is append-only: a row cannot be changed');
END;

CREATE TRIGGER history_events_no_delete BEFORE DELETE ON history_events
BEGIN
  SELECT RAISE(ABORT, 'history_events is append-only: a row cannot be deleted');
END;

-- One row per setting that has been set; a missing row means the schema's default. The value is JSON,
-- so true, 3 and "a folder path" all fit.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;
