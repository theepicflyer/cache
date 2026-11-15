# MCP server (`/mcp`)

Cache has a Model Context Protocol (MCP) endpoint at **`/mcp`**, so Claude (a claude.ai custom connector, Claude Code, or any MCP client) can read the household ledger and log expenses and income. The server and its sign-in come from [Warren](https://github.com/theepicflyer/warren); the tools are in `server/src/tools.ts`, on the same services as the app, so agents see the same numbers.

## Sign-in

Sign-in is OAuth, through Pocket ID: Warren runs an OAuth proxy in front of it. A client discovers it from `/.well-known/oauth-protected-resource`, registers itself (Dynamic Client Registration), and sends you to Pocket ID to sign in with your passkey. Anyone who can sign in to the app can connect, and gets every tool. There are no API tokens.

Registration only accepts redirect URIs on `MCP_ALLOWED_REDIRECT_URIS` (space-separated). The default covers claude.ai, claude.com, Meta Muse and loopback (`http://localhost:*`, `http://127.0.0.1:*`). The Pocket ID client needs `https://cache.example.com/oauth/callback` as a callback URL as well as the browser one.

The ledger is shared, so tools do no per-person filtering; `created_by` records who added a transaction.

## Connecting

claude.ai: Settings → Connectors → Add custom connector → `https://cache.example.com/mcp`.

Claude Code:

```sh
claude mcp add --transport http cache https://cache.example.com/mcp
```

then run `/mcp` in Claude Code to sign in.

> **Write access.** A connected client can add, edit and **permanently delete** transactions. Review what it proposes.

## Tools

Amounts are 2-decimal strings in dollars (`$`), dates `YYYY-MM-DD`, months
`YYYY-MM`. Every transaction has a `type`, `expense` or `income`, and a positive
`amount`. Categories are `budget`, `fund` or `income` (salary and the like).
Income in a budget or fund category is money back (a refund, or money put into a
fund), so a budget's or fund's `spent` is net of it. `income` is what the income
categories received, `out` is what budgets and funds spent, and `net` is income
minus out. `date` is when it happened; `month` is the month it counts toward.
Every tool except `get_ledger_info` first creates any recurring entries that
have fallen due.

Read:

| Tool | What it returns |
| --- | --- |
| `get_ledger_info` | Currency (`$`), today, the current month, who is signed in, whether writes are allowed, and what the fields mean. |
| `list_categories` | Categories with kind (budget, fund or income), this month's amount (null for income), and for funds the balance and target. |
| `list_transactions` | A page of transactions (filter by `month`, `date_from`/`date_to`, `category_id`, `type`, `search`), the total count, `total_expenses` and `total_income`. Limit is capped at 500. |
| `get_month_summary` | Per budget category: budget, spent, left, over. Per fund: top-up, spent, month-end balance. Per income category: received. The month's `flow` (income, out, net). Pace for the current month. |
| `get_budget_analysis` | Per budget category per month budget and spent, months over, averages, `consistently_over`; monthly totals; fund balance series; `flows`: income, out and net per month with their averages. Running months are `partial` and left out of counts and averages. |
| `list_recurring` | Recurring rules with type, schedule, next date and the month that entry will count toward. |

Write:

| Tool | What it does |
| --- | --- |
| `add_transaction` | Adds an expense or income. `type` defaults from the category (`income` for an income category, else `expense`), `date` to today, `month` to the date's month. |
| `update_transaction` | Partial update of one transaction, including its type. |
| `delete_transaction` | Deletes one transaction. |

There are no tools for editing categories, monthly amounts or recurring rules;
do those in the app.

Bad input (unknown category, bad date, an amount that is not more than 0 or has
more than 2 decimals, an unknown type, an expense in an income category) comes
back as an MCP error result with a message the agent can act on.
