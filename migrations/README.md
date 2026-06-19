# Migrations

SQL files in this folder are applied automatically at API startup in filename order.
Each file runs exactly once and is recorded in the `schema_migrations` table.

## Naming convention

```
NNN_short_description.sql
```

- `NNN` — zero-padded sequence number (001, 002, …)
- Description — snake_case, what the migration does

## Adding a migration

1. Create the next numbered `.sql` file in this folder.
2. Write plain SQL (one or more statements).
3. `git add migrations/NNN_….sql && git commit && git push`

The server deploys automatically and applies the migration on next API startup.
No SSH, no manual psql.

## Rules

- Never edit a migration that has already been applied to production — add a new one instead.
- Each file must be idempotent-safe on its own (use `IF NOT EXISTS`, `IF EXISTS`, etc. where possible).
- Transactions are per-file: if a file fails mid-way, nothing in that file is recorded as applied.
