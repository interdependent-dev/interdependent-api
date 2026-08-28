# interdependent-api

Screenplay submission and evaluation microservice for `api.interdependent.studio`.
Express + Supabase (Postgres, Storage, service-role client); see `package.json`
for the run/dev/test scripts.

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
(public) in the Supabase dashboard or via the storage API.

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
