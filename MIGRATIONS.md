# Migrations log

A running archive of one-off prod migrations for this fork. Each entry
captures the playbook that was actually used, including any sharp edges
hit during the cutover, so future migrations can crib from prior ones.

Newest first. When adding a new entry, copy an existing section as a
template, then trim what doesn't apply.

---

## 2026-11 — Cache 2: Django and Postgres to Warren and SQLite (`importLedger`)

End-state: one Node container (`ghcr.io/theepicflyer/cache`) with everything in a SQLite file in the `cache-data` volume. No Postgres, no Django, no `/legacy/` screens. Sign-in is Pocket ID through Warren; API tokens are gone and MCP clients connect with OAuth. The old Postgres database is only read, so rolling back is starting the old compose again.

Only the ledger comes over (`ledger_*` tables and the people who entered transactions). If the old app's ledger is still empty, run the `import_wygiwyh` playbook below on the old release first.

### Deploy steps

1. **Pocket ID.** On the client Cache uses, set the callback URLs to `https://cache.example.com/auth/web/callback` and `https://cache.example.com/oauth/callback` (replacing `/auth/oidc/.../login/callback/`). Note its issuer URL, client ID and secret.
2. **Export the ledger** from the old database while the old stack is still up (stop entering transactions first). Save the query from `server/src/importLedger.ts` (`EXPORT_SQL`; `node dist/importLedger.js` with no arguments prints it) as `export.sql`, then:

   ```sh
   docker compose exec -T db psql -U wygiwyh -d wygiwyh -At < export.sql > ledger.json
   ```

   `ledger.json` holds the household's data: keep it off git and delete it after step 6.
3. **Stop the old stack** (`docker compose down`; keep `postgres_data/`).
4. **New settings.** Replace the compose file with the new `docker-compose.yml` and `.env` with `.env.example`, filled in: `PUBLIC_URL`, `OIDC_ISSUER` (the address without `/.well-known/...`), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `TIMEZONE`. None of the old variables are used.
5. **Import** into the new, empty volume:

   ```sh
   docker compose run --rm -v "$PWD/ledger.json:/ledger.json:ro" cache node dist/importLedger.js /ledger.json
   ```

   It prints how many people, categories, monthly amounts, recurring rules and transactions came over, and refuses a database that already has a ledger.
6. **Start it** (`docker compose up -d`), sign in, and compare Home and Trends for a few months with the old app (start the old stack on another port if needed). People who signed in with Pocket ID before are recognised; anyone who used a password gets a new person on first sign-in, and their old entries keep the old name.
7. **Reconnect Claude**: remove the old connector in claude.ai and add `https://cache.example.com/mcp` again. Old API tokens no longer work.
8. Once happy, add the `cache-data` volume to the restic backup (README, Backups), and archive `postgres_data/`.

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
