# CLAUDE.md

Guidance for working in this repository.

## Project

Cache is a household money ledger, built on [Warren](https://github.com/theepicflyer/warren), the household's shared framework: one container, one Node process, one SQLite file, one origin. `server/` is Cache itself (TypeScript): its tables, the ledger maths, the JSON API and the tools for MCP clients. `web/` is the SvelteKit app the server serves. Warren provides the rest: sign-in, the MCP server and its OAuth proxy, the scheduler, snapshots. Cache has no built-in assistant; agents reach it over MCP.

Cache began as a hard fork of WYGIWYH (Django). None of that code is left; the git history before the rewrite is the Django app. Burrow is the design system's name; `burrow` identifiers (`lib/burrow/`, the `burrow-theme` storage key, `wygiwyh_light`/`wygiwyh_dark` theme keys kept so saved choices carry over) belong to it.

Read Warren's CLAUDE.md before changing how sign-in, MCP or backups work; those rules live there and its tests enforce them.

The repo is public. Never commit personal data: real names, emails, hostnames, amounts from a real ledger, exports. Use `example.com` and made-up data in docs, tests and screenshots.

## Commands

```bash
cd server && npm ci
npm run check                          # tsc
npm test                               # vitest, no network
npm run dev                            # the server on :8000 with a name picker instead of Pocket ID
npm run seed                           # fill an empty ledger with made-up data
npm run db:generate                    # after editing src/schema.ts
cd web && npm install && npm run dev   # vite on :5173, proxying /api, /auth, /oauth, /mcp to :8000
npm run check && npm run build         # the server serves web/build
```

## The ledger (`server/src/`)

One shared ledger: every signed-in person sees and edits everything, so no table has an owner and nothing filters per person (`created_by` only records who entered a transaction). There are no accounts or wallet balances.

- Money is integer cents, days are `YYYY-MM-DD`, months `YYYY-MM`, all as stored and as the API sends them. Amounts are one currency, shown with a plain `$` (`$1,234.50`, `−$5.00`).
- `schema.ts`: property names are the column names (snake_case), so a row is also its API shape. People are Warren's `warren_users`.
- **Categories**: `kind` is `budget` (planned monthly spending), `fund` (sinking fund, with `opening_balance` and an optional `target`) or `income` (takes income only). `icon` is `""` (automatic: `guessIcon` picks one from words in the name), `letter`, or a name from the icon library; use `displayIcon` in code.
- **Monthly amounts** are effective-dated: the amount for month M is the latest row with `start_month <= M`, 0 before the first. `setAmount(..., fromMonth)` changes it from that month on, so **past months keep their amount and past trends never move**. Never rewrite old rows to apply a new amount.
- **Transactions**: `type` is `expense` or `income`, `amount` always positive. Income in a budget or fund category is money back; budget and fund maths use net spend. `date` is when it happened, `month` the month it counts toward; all budget and fund maths use `month`, never `date`.
- **Recurring**: a schedule (`every` × week/month/year from `start_date`, optional `end_date`, `month_offset` 0 or −1). `generateDue` creates entries only once they fall due (page loads and a scheduler job call it), so editing a rule changes every entry still to come and nothing already made. `last_generated` belongs to `generateDue`. Occurrences are computed from `start_date` each time so the 31st never drifts.
- **Fund balance** at the end of M = `opening_balance` + top-ups from the fund's first amount month through M − net spend with `month <= M`. Computed, never stored.
- `ledger.ts`: writes and their rules (`DomainError` for bad input). `services.ts`: the maths, with `Book` loading all amounts and per-(category, month) totals in two queries: `monthStatus` (Home), `analysis` (Trends; running months are `partial` and left out of counts), `categoryHistory`, `categoriesForEntry`, `titleSuggestions`, `upcoming`.
- Budgets and funds answer different questions (did spend stay under budget vs what's saved); keep them visually and semantically apart. Home's ring and "left" are budgets only.
- `api.ts`: the web app's JSON API under `/api`. Form errors are `400 {ok: false, errors: {field: message}}`; writes return `{ok, toast, ...}`.
- `tools.ts`: the MCP tools (see `docs/MCP.md`).
- `importLedger.ts`: one-off import of the Django version's ledger from a psql JSON export (`MIGRATIONS.md`).

## The web app (`web/`)

SvelteKit as a single-page app (adapter-static, `ssr = false`), Svelte 5 runes, TypeScript, no Tailwind. Any page address that isn't a file or a Warren path gets the app's shell, so new routes need no server change.

- `src/routes/layout.css` is the app's stylesheet on top of Burrow's generated one (`lib/burrow/burrow.generated.css`). Native `<select>` is visible and styled (`.select`). Grid children that hold scrollers need `min-width: 0`.
- `lib/api.ts` (fetch with Warren's CSRF header), `lib/state.svelte.ts` (session, toasts, `ledger.changed()` after a write so loaded pages refresh, the entry sheet), `lib/load.svelte.ts` (`loaded(() => path)`), `lib/format.ts` (money and dates), `lib/charts.ts` (Chart.js, loaded on demand).
- The add/edit flow (`lib/components/Entry.svelte`) is on every page, one step at a time so nothing hides behind the phone keyboard: amount on its own numpad, title (a past title fills its category and skips to the review), category grid, review. Editing opens on the review. On phones the sheet is sized to `visualViewport`. `/?add=1` opens it (the PWA shortcut).
- Navigation is the bottom nav on phones and the side rail from 1024px (`lib/nav.ts`). New top-level pages go in `NAV` or are reached from Settings.
- Theme: "match device" by default, or light/dark saved in `localStorage` (`burrow-theme`); an inline script in `app.html` sets `data-theme` before paint.

### Burrow

The UI follows Burrow, the household's design system. This is Cache, Kacang the squirrel's app (Burrow's "money"), so `--accent` is mint. Data stays calm, the animals live at the edges; at most one full-size animal per screen (the `Habitat` header's); in-card empty states use `Empty` with a small animal or none. Pick the animal by job (Kacang = home/budgets/trends, Gali = history/search, Kayu = settings/editing/errors) and the mood by moment.

- Every fact has a fixed place (Burrow's "Where information goes"). List rows are category tile, then title over category, then amount over date. Dates in `bh-when` with the calendar icon (`Mon 9 Nov`, year added outside this year). Per-month amounts and short facts are `bh-tag` pills (`bh-tag--in`, `--over`, `--note`). A card's explanation goes in `bh-card__sub`, its total or action in `bh-card__foot`. One-of-a-few switches are `bh-seg`. Never facts joined with " · ".
- Category icons are a curated set of Phosphor Icons (Bold, MIT) in `static/img/category-icons.svg`, drawn with `CategoryIcon`.
- Copy: sentence case, verb + object buttons, no emoji; the animals carry the emotion.

## Releases and deploy

Images go to `ghcr.io/theepicflyer/cache`. Two workflows plus a reusable build:

- `ci.yml`: the server's type check and tests and the web app's `npm run check` on every PR; also called by `release.yml`.
- `release.yml`: on every push to `main`, runs the tests, then `.github/scripts/plan-release.sh` looks at the PRs that push merged. If any carries a `version/*` label it bumps from the latest GitHub release, pushes `:X.Y.Z` + `:latest`, then creates the release **last**. No label: `:nightly` only. `workflow_dispatch` builds a one-off `:<tag>` from any ref.
- `build-push.yml`: the one place the Docker build lives (amd64). `VERSION` build-arg → `APP_VERSION`.

Warren is pinned to a commit in `server/package.json`. To take a Warren change, bump the pin, run the tests, and release Cache.

### Shipping a change

A release is how work reaches production: the production server polls for new releases, has each one security-reviewed by an agent, and deploys it. So:

- **One PR per piece of work.** If it is too big for one PR, stack PRs with `gh stack` and merge the stack together.
- **Exactly one `version/*` label per release**, on the single PR or on the **top** PR of a stack.
  - `version/patch`: fix or chore.
  - `version/minor`: new feature, backward-compatible.
  - `version/major`: breaking change.
  - no label: docs/CI-only or not worth a release (ships `:nightly`, which production ignores).
- **Manual steps go under `## Deploy actions` in the PR description**: a new or changed env var, a Pocket ID change, data to fix, anything the server can't do by just pulling the image and restarting (migrations run on start). The deployer holds any release whose notes contain that heading until a human does the steps. Omit the heading when there is nothing to do.
- Destructive or multi-step upgrades also get a playbook in `MIGRATIONS.md`, referenced from the PR's Deploy actions.
- Don't hand-create releases or tags.

Keep README.md, this file and docs/MCP.md current when behaviour changes.
