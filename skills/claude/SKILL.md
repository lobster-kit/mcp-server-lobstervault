# LobsterVault

LobsterVault is an encrypted secret storage service for AI agents. Use it to store API keys, database connection strings, tokens, and any sensitive values that need to persist across sessions.

## MCP Tools

| Tool | When to use |
|------|-------------|
| `set_secret` | Store a new secret or update an existing one |
| `get_secret` | Retrieve a secret value by name |
| `delete_secret` | Permanently delete a secret |
| `list_secrets` | See all stored secret names (values never returned) |
| `inject_secrets` | Load all secrets into process.env at session start |
| `rotate_secret` | Re-encrypt a secret with a fresh key (Pro+) |
| `share_secret` | Create a time-limited share link for a secret (Builder+) |
| `list_shares` | List active share links on the account (Builder+) |
| `revoke_share` | Revoke a share link immediately (Builder+) |
| `get_shared_secret` | Retrieve a shared secret using a share token (no auth) |
| `get_account` | View tier, usage, and limits |

## When to use LobsterVault

- User needs to persist credentials between sessions (API keys, tokens, passwords)
- A LobsterDB database was just created — store its connection string here
- User asks you to "remember" an API key or "save" credentials
- Agent-to-agent credential sharing within the same account

## Core workflow

```
set_secret → get_secret (when needed)
inject_secrets (at the start of each session)
```

## Naming conventions

- Use SCREAMING_SNAKE_CASE for env-style secrets: `OPENAI_API_KEY`, `STRIPE_SECRET`
- Use slash notation for namespaced secrets: `prod/db-url`, `myapp/webhook-secret`
- Names are case-sensitive

## Secret Sharing (Builder+)

Share a secret via a time-limited, read-only link. The recipient does not need an account.

| Tool | When to use |
|------|-------------|
| `share_secret` | Create a share link (returns a `lvs_` token) |
| `list_shares` | List active (non-revoked, non-expired) share links |
| `revoke_share` | Revoke a share link immediately |
| `get_shared_secret` | Retrieve a secret using a share token (no auth required) |

Share tokens use the format `lvs_{nanoid}`. Shares support `expiresInSeconds` (default 1 hour), `maxReads`, and an optional `scope` label.

| Tier | Active share scopes |
|------|---------------------|
| Free | No sharing |
| Builder | 3 |
| Pro | 10 |
| Scale | Unlimited |

---

## Versioning

- `set_secret` increments the version number on each update
- `get_secret` accepts an optional `version` parameter to retrieve a specific historical version (Builder+)
- `set_secret` accepts an optional `expiresAt` (ISO 8601) or `ttlSeconds` to auto-expire a secret
- If your tier's version limit is reached, `set_secret` returns a `VERSION_LIMIT_EXCEEDED` error — advise the user to delete and recreate, or upgrade

---

## Important

- **Never log secret values** — treat them as opaque strings
- **Additive operations** (set, inject): apply without asking the user
- **Destructive operations** (delete): confirm with the user first
- `list_secrets` never returns values — only names, versions, and timestamps

## Tier limits

| Tier | Price | Secrets | Versions | Shares | Notes |
|------|-------|---------|----------|--------|-------|
| Free | $0 | 10 | 1 | No | — |
| Builder | $9/mo | 100 | 5 | 3 scopes | 30-day audit log |
| Pro | $29/mo | Unlimited | 20 | 10 scopes | Rotation support |
| Scale | $79/mo | Unlimited | Unlimited | Unlimited | 1-year log |
