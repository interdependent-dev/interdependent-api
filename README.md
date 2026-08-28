# interdependent-api

Screenplay submission and evaluation microservice for
`api.interdependent.studio`. Writers submit screenplay PDFs; the service
extracts and format-checks them, has Claude evaluate them, and runs the
read-first reader program on top: passkey (WebAuthn) reader accounts, read
tracking, feedback, XP/leaderboard, assignments, and email notifications.

Express 4 + Supabase (Postgres, Storage, service-role client) + the Anthropic
API. Plain ESM Node — no build step. Requires Node **>= 22.3** (see
`package.json` engines; pdf-parse 2.x needs it).

## Architecture

One request flows **routes → controllers → services → Supabase**:

- `src/index.js` — entrypoint: loads env, starts the server, graceful shutdown.
- `src/app.js` — the Express app: global middleware (request logging, CORS,
  rate limiting, cookies) and one router mount per feature area.
- `src/routes/` — route definitions and per-route middleware/validation.
- `src/controllers/` — request/response orchestration.
- `src/services/` — the actual work: `supabaseService` (DB access via the
  service-role client), `anthropic/` (Claude evaluation, split by concern:
  models/fallback, prompts, extraction, verification, evaluation pipeline,
  email translation, counsel desk),
  `pdfService`/`formatGate` (PDF extraction and screenplay-format gating),
  `passkeyService` (WebAuthn), `emailService`/`xpEmailService` (Resend),
  plus reader/leaderboard/assignment/chat/discovery services.
- `src/middleware/` — CORS allowlist, auth guards (`requireAuth`,
  `requireActionToken`, `optionalReader`), zod validation, structured error
  handling, request logging (pino, request ids).
- `src/lib/` — domain logic with no HTTP or DB concerns (XP aggregation and
  config, read gate, assignments, event ingest, logger).
- `src/config/` — `loadEnv.js` (dotenv) and `env.js`, the single validated
  gateway to `process.env`; all config is read through it.
- `src/db/migrations/` — versioned SQL schema (see **Database migrations**).

Auth model in one line: humans submit with a 4-character passcode → JWT;
readers register passkeys and get long-lived read sessions plus short-lived
action tokens for writes; curators (XP ≥ `CURATOR_MIN_XP` or listed in
`ADMIN_HANDLES`) get elevated moderation powers.

## Local setup

```sh
cp .env.example .env   # then fill in real values
npm install
npm run dev            # nodemon on PORT (default 3001)
```

`.env.example` documents every variable and is drift-checked against the env
schema by `test/envExample.test.js` — new schema keys must be added there too.
You need real `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` values (and an
Anthropic key for the evaluation path) for anything that touches data; the
rest have workable defaults for local poking.

## Tests

```sh
npm test               # node --test test/*.test.js
```

Tests are hermetic: they import `src/app.js` under dummy env values and drive
it over HTTP via `listen(0)` + `fetch` — no live Supabase, Anthropic, or
Resend calls. CI (`.github/workflows/test.yml`) runs exactly this on pushes
and PRs to `main`.

## Database migrations

The schema lives in `src/db/migrations/*.sql` and is applied by
`scripts/migrate.mjs` — a versioned runner with an applied-migrations ledger
(the `schema_migrations` table: name, checksum, applied_at). Migrations run in
lexicographic filename order; each one executes in a single transaction
together with its ledger row, so a failure rolls back whole and re-running is
always a no-op for anything already recorded.

### Empty database → current schema (one command)

```sh
npm run migrate -- --db 'postgresql://user@host:5432/dbname'
# or: DATABASE_URL=postgresql://... npm run migrate
```

That is the entire bootstrap: `0000_baseline.sql` (the full schema, formerly
`src/db/schema.sql`) plus each later migration, in order. Storage buckets are
the one thing SQL can't create — make `scripts` (private) and `reader-avatars`
(public) in the Supabase dashboard or via the storage API
(`scripts/_create_avatar_bucket.mjs` handles the latter).

Targets:

- **Direct Postgres** (local dev, scratch DBs): pass `--db <url>` or set
  `DATABASE_URL`. Requires `psql` on `PATH`.
- **Supabase Management API** (the deployed project — service-role REST can't
  run DDL): set `SUPABASE_ACCESS_TOKEN` (or keep a personal access token in
  `~/.supabase/access-token`) and `SUPABASE_PROJECT_REF` (or `SUPABASE_URL`,
  the ref is parsed from it). Used automatically when no `--db`/`DATABASE_URL`
  is given.

### Everyday commands

```sh
npm run migrate -- --status      # applied vs pending, with timestamps
npm run migrate -- --dry-run     # what would be applied; writes nothing
npm run migrate                  # apply pending migrations in order
```

### Adding a migration

1. Create `src/db/migrations/YYYYMMDDHHMM_short_name.sql` — the timestamp
   prefix is the ordering, so use the current date/time (later timestamps sort
   after every existing file). Prefer additive, idempotent DDL
   (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
2. `npm run migrate -- --dry-run` to confirm it's picked up, then
   `npm run migrate` against your target.
3. Never edit a migration that has been applied somewhere — the runner stores a
   checksum and warns on drift. Write a new migration instead.

### Baselining an existing database (the deployed project)

The deployed Supabase project predates the ledger: its schema already matches
these migrations, and they must be **recorded, not re-run** — some early
migrations carry one-time data steps (e.g. `202607011000_surfacing.sql`
grandfathers every script to surfaced, which would undo curators' later
unsurfacing if executed again). One command records everything without
executing any SQL from the migration files:

```sh
npm run migrate -- --mark-applied
```

After that, `--status` shows everything applied and future migrations apply
normally.

## Deploy

The service runs on **Render** at `https://interdependent-api.onrender.com`,
fronted by `api.interdependent.studio`. It is a plain `npm start` Node service;
`app.set('trust proxy', 1)` expects Render's proxy. Environment variables are
set in the Render dashboard (mirror `.env.example`), and the Render runtime
must match the Node engines range (>= 22.3).

**Keep-warm:** the free-tier instance sleeps after ~15 idle minutes, so
`.github/workflows/keep-warm.yml` curls `/health` every 10 minutes via GitHub
cron. Best-effort — the frontend still tolerates cold starts; a paid Render
instance would make the workflow redundant.

## Ops scripts index (`scripts/`)

One-off admin and maintenance tools. All are env-sensitive (run with
`node --env-file=.env scripts/<name>.mjs` unless noted); each file's header
comment states its purpose and re-run safety. The `_`-prefixed ones are
one-off/situational; the unprefixed ones are durable tooling.

| Script | Purpose | Re-run safety |
| --- | --- | --- |
| `migrate.mjs` | Versioned migration runner (see above) | Safe — ledger makes it a no-op when current |
| `gen-oa-sections.mjs` | Generate the counsel corpus from the studio repo's transcription | Safe — regenerates output file; fails loud |
| `_state.mjs` | Dump account state from the 2026-06 account migration | Safe — read-only |
| `_verify_auth_migration.mjs` | Verify the email/recovery migration is live | Safe — read-only |
| `_smoke.mjs` | Live prod smoke test of email/recovery/add-device | Safe — throwaway reader, cleans up after itself (hits prod) |
| `_create_avatar_bucket.mjs` | Create the `reader-avatars` storage bucket | Safe — idempotent |
| `_backfill_reader_emails.mjs` | One-time reader recovery-email backfill | Dry-run by default; `APPLY=1` writes; harmless but pointless re-run |
| `_remove_rejected.mjs` | One-time backup + purge of rejected submissions | **Destructive** — dry-run by default; `APPLY=1` deletes |
| `_xp_serve.mjs` | Local XP-page preview server on :3001 | Safe — read-only server; hardcoded local path needs editing first |
