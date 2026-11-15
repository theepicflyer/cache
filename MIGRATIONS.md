# Migrations log

A running archive of one-off prod migrations for this fork. Each entry
captures the playbook that was actually used, including any sharp edges
hit during the cutover, so future migrations can crib from prior ones.

Newest first. When adding a new entry, copy an existing section as a
template, then trim what doesn't apply.

---

## 2026-11 — Cache 4: Django and Postgres to Warren and SQLite (`importLedger`)

End-state: one Node container (`ghcr.io/theepicflyer/cache:4.x`) with everything in a SQLite file in the `cache-data` volume. No Postgres, no Django, no `/legacy/` screens. Sign-in is Pocket ID through Warren; API tokens are gone and MCP clients connect with OAuth. The old Postgres database is only read, never changed, so rolling back is starting the old stack again.

Only the ledger comes over: the `ledger_*` tables (introduced in 3.0.0) and the people who entered transactions. The older WYGIWYH tables (`transactions_transaction` and friends) are not read; in 3.x they were copied into the ledger by `import_wygiwyh`. Step 1 checks whether that happened.

Placeholders: `cache.example.com` is the production host; `<old>` is the directory holding the old stack's compose file, `.env` and `postgres_data/`. Run the new stack from a new, empty directory, `<new>`.

### Deploy steps

0. **Pin the old stack to the last Django release.** After this release `:latest` is 4.x, so anything that pulls `:latest` for the old stack would start the new app against the old settings. In `<old>/docker-compose.yml` set the web image to `ghcr.io/theepicflyer/cache:3.3.0` (keep whatever it runs now if that is a pinned 3.x tag). Make sure the old stack is up: `docker compose up -d` in `<old>`.

1. **Check the old ledger has the data.** In `<old>`:

   ```sh
   docker compose exec -T db psql -U wygiwyh -d wygiwyh -At -c "
     SELECT 'ledger', count(*), max(date) FROM ledger_transaction
     UNION ALL SELECT 'wygiwyh', count(*), max(date) FROM transactions_transaction"
   ```

   - **`ledger` has rows, with a recent `max(date)`:** the household has been using the ledger. Go to step 2.
   - **`ledger` is 0 (or the table doesn't exist) and `wygiwyh` has rows:** the data was never copied into the ledger. Make sure the old stack runs 3.3.0 (step 0; its migrations create the ledger tables on start), then follow "The ledger rebuild (`import_wygiwyh`)" below, steps 2 to 4, and run this query again.
   - **Both have rows but `wygiwyh` has newer dates than `ledger`:** entries were added in `/legacy/` after the import. Stop and ask the household which is right; `import_wygiwyh --replace` would throw away anything entered in the ledger since.
   - **Both are 0:** nothing to import. Skip steps 2 and 5.

2. **Export the ledger** while the old stack is still up. Ask the household to stop entering transactions until step 6. In `<old>`:

   ```sh
   docker run --rm ghcr.io/theepicflyer/cache:4.0.0 node dist/importLedger.js --sql > export.sql
   docker compose exec -T db psql -U wygiwyh -d wygiwyh -At -v ON_ERROR_STOP=1 < export.sql > ledger.json
   ```

   `ledger.json` should be one line of JSON starting with `{"users"`. It holds the household's data: keep it out of git and delete it after step 6.

3. **Stop the old stack**: `docker compose down` in `<old>`. Keep `postgres_data/` and `.env`.

4. **Pocket ID.** On the client the old app used (the old `.env` has its `OIDC_CLIENT_ID`; its `OIDC_SERVER_URL` is the issuer), set the callback URLs to exactly these two, replacing `/auth/oidc/.../login/callback/`:
   - `https://cache.example.com/auth/web/callback`
   - `https://cache.example.com/oauth/callback`

5. **Set up and import.** In `<new>`, copy `docker-compose.yml` and `.env.example` (as `.env`) from the release. Fill in `.env`: `PUBLIC_URL=https://cache.example.com`, `OIDC_ISSUER` (the old `OIDC_SERVER_URL` without any `/.well-known/...`), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (both from the old `.env`), `TIMEZONE` (the old `TZ` if it was set to the household's zone, else `Asia/Singapore`). Leave `DEV_LOGIN=false`. None of the other old variables are used. Then:

   ```sh
   docker compose pull
   docker compose run --rm -v "$PWD/ledger.json:/ledger.json:ro" cache node dist/importLedger.js /ledger.json
   ```

   It prints how many people, categories, monthly amounts, recurring rules and transactions came over; they should match the counts from step 1. It refuses a database that already has a ledger, so a second run does nothing.

6. **Start it**: `docker compose up -d`. Point the reverse proxy for `cache.example.com` at the new container's port 8000 (same as before if the old one was also on 8000). Check `https://cache.example.com/api/health` returns 200, then have someone sign in and compare this month's Home with the old app. People who signed in with Pocket ID before are recognised; anyone who used a password gets a new person on first sign-in, and their old entries keep the old name.

7. **Reconnect Claude**: in claude.ai remove the old Cache connector and add `https://cache.example.com/mcp`. Old API tokens no longer work.

8. **Backups**: add the `cache-data` volume to the restic backup, leaving out `app.sqlite*` at its top level (README, Backups). Keep `<old>/postgres_data/` until the household is happy, then archive it.

**Rollback**: `docker compose down` in `<new>`, set the Pocket ID callback URLs back, `docker compose up -d` in `<old>` (pinned to 3.3.0 in step 0). Nothing in Postgres was changed.

---

## 2026-11 — The ledger rebuild (`import_wygiwyh`)

End-state: the app at `/` is the new ledger (`apps.ledger`), with its own
tables (`ledger_category`, `ledger_monthlyamount`, `ledger_transaction`,
`ledger_recurring`). The WYGIWYH screens move to
`/legacy/` and their tables are left untouched. The new tables start empty, so
the old data has to be imported once. Nothing is deleted.

### Deploy steps

1. Deploy the release as usual (migrations create the ledger tables on start).
   Until step 3 the app shows an empty ledger; don't add spends in the new UI
   yet (the import refuses a ledger that already has data).
2. Preview the import. It runs in a transaction and rolls back:

   ```sh
   docker compose exec web python manage.py import_wygiwyh --dry-run
   ```

   Read the report. Check the "Fund balances" section: each fund should say
   `ok`. A fund marked `DIFFERS` comes with a note explaining why (for example
   a monthly default that the old app had not allocated yet this month).
   Check the skipped counts (unpaid transactions, zero amounts, soft-deleted
   rows, auto-allocation legs) look plausible. Income is imported too:
   income-only categories become income categories and uncategorized income
   goes to "Other income". The old app had no marker for a transfer between
   accounts, so both legs are imported; the "possible transfers" note counts
   the likely pairs and says where each leg went, to review after the import.
3. Import for real:

   ```sh
   docker compose exec web python manage.py import_wygiwyh
   ```

4. Open the app and compare a few months of Home and Trends against
   `/legacy/` (monthly overview, budget analysis).
5. To redo the import (after fixing data in `/legacy/`), run it again with
   `--replace`. This deletes **all** ledger categories, amounts, spends and
   recurring rules first, including anything entered in the new UI since.

After the import, stop editing in `/legacy/`: changes there are not copied
over. The legacy apps' periodic tasks keep running against the old tables until
they are removed in a later release; that is harmless.

---

## 2026-06 — MCP OAuth tables (`feat/mcp-oauth`)

End-state: the `/mcp` endpoint accepts OAuth 2.1 Bearer tokens (for the
claude.ai web connector) alongside the existing `APIToken` auth. This adds
the `django-oauth-toolkit` (`oauth2_provider`) app, which ships four new
tables — `Application`, `AccessToken`, `Grant`, `RefreshToken` — via its own
migrations. **No project-level migration is added** (no new fork models;
`makemigrations --check` is clean). The OAuth `Application` rows are
auto-provisioned at runtime from the client's CIMD document, so nothing needs
seeding.

### Deploy steps

This is a non-destructive, additive migration — no data backfill, no cutover.

1. Build & publish the fork image as usual (GHCR flow in `CLAUDE.md` → Deploy).
2. On the prod host, pull and apply migrations:

   ```sh
   docker compose pull web
   docker compose run --rm web python manage.py migrate oauth2_provider
   docker compose up -d web
   ```

   `migrate` applies `oauth2_provider` `0001`–`0014` (initial schema through
   `0014_alter_help_text`). All other apps are unchanged.

3. Smoke-check the discovery endpoints (no auth required):

   ```sh
   curl -s https://<host>/.well-known/oauth-protected-resource | jq .
   curl -s https://<host>/.well-known/oauth-authorization-server | jq .
   curl -s -i -X POST https://<host>/mcp -d '{}' | grep -i www-authenticate
   ```

   Expect JSON with `client_id_metadata_document_supported: true` /
   `token_endpoint_auth_methods_supported: ["none"]`, and a 401 carrying
   `WWW-Authenticate: Bearer resource_metadata="…"`.

4. Final acceptance is the real claude.ai connect: add a custom connector by
   URL `https://<host>/mcp`, complete OAuth (log in with the existing session
   at consent), and confirm a tool call works. See `docs/MCP.md`.

### Rollback

Additive only. To roll back, redeploy the previous image; the `oauth2_provider`
tables can be left in place (they are inert without the app installed) or
dropped with `migrate oauth2_provider zero` if a clean removal is wanted.

### Sharp edges to watch for

- **`URL` env / proxy scheme.** The discovery docs and the `WWW-Authenticate`
  `resource_metadata` URL are built from the request, so the reverse proxy MUST
  forward `X-Forwarded-Proto: https` (already handled by
  `SECURE_PROXY_SSL_HEADER` when `HTTPS_ENABLED=true`). If these come out as
  `http://…`, claude.ai's handshake will fail.
- **`resource` must match exactly.** The audience the user types into claude.ai
  (`https://<host>/mcp`) must equal the served `resource` value byte-for-byte
  (no trailing slash, correct scheme/host). A mismatch yields
  `400 invalid_target` at authorize/token.

---

## 2026-05 — Sinking accounts cutover (`feat/sinking-accounts`)

Adds `Account.kind` (`NORMAL`/`SINKING`) and `TransactionCategory.account`, and drops the
earlier `Fund` model. Sinking accounts receive monthly auto-allocations (muted EX-on-Main +
IN-on-sink pairs) materialized by the `materialize_for_month` procrastinate task.

The one-off command that converted the original author's legacy data into this shape was
specific to that dataset and isn't part of this repo. On any other instance, `migrate` is
enough; mark sinking accounts and set monthly amounts from the UI (`/budgets/edit/`).

The category→account constraint is enforced at the app layer (`Transaction.clean()` +
`TransactionForm.clean()`), not by a DB trigger, so direct DB inserts can violate it.
