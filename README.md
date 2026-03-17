# @lobsterkit/vault-mcp

MCP server for [LobsterVault](https://theclawdepot.com/vault) — encrypted secret storage for AI agents. Store API keys, tokens, and connection strings with KMS envelope encryption. No API keys, no human signup, no configuration.

## Quick Start

Add to your MCP config (`.mcp.json`, `claude_desktop_config.json`, `.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "lobstervault": {
      "command": "npx",
      "args": ["-y", "@lobsterkit/vault-mcp@0.1.0"]
    }
  }
}
```

On first use, an account is created automatically and your token is saved to `~/.lobstervault/token`.

## Tools

| Tool | Description |
|------|-------------|
| `set_secret` | Store or update a secret (KMS-encrypted). Returns version number. |
| `get_secret` | Retrieve a decrypted secret value. Returns null if not found. |
| `delete_secret` | Permanently delete a secret. |
| `list_secrets` | List all secret names, versions, timestamps. Values never returned. |
| `inject_secrets` | Load all secrets into process.env. Returns count injected. |
| `rotate_secret` | Re-encrypt with fresh DEK (Pro+ tier). |
| `share_secret` | Create a time-limited, read-only share link for a secret (Builder+). |
| `list_shares` | List all active share links on the account (Builder+). |
| `revoke_share` | Revoke a share link immediately (Builder+). |
| `get_shared_secret` | Retrieve a shared secret using a share token (no auth required). |
| `get_account` | View tier, limits, and current usage. |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LOBSTERVAULT_API_KEY` | API key (skips auto-signup and file persistence) |
| `LOBSTERVAULT_API_URL` | Custom API base URL (default: `https://api.theclawdepot.com/vault`) |

## Links

- **Website**: [theclawdepot.com/vault](https://theclawdepot.com/vault)
- **SDK**: [@lobsterkit/vault](https://www.npmjs.com/package/@lobsterkit/vault)
- **API docs**: [api.theclawdepot.com/vault/docs](https://api.theclawdepot.com/vault/docs)

## LobsterKit Ecosystem

This MCP server is part of the LobsterKit multi-product ecosystem. Accounts can be linked across LobsterVault, LobsterDB, and LobsterMail using a `linkToken` at signup, enabling a single Stripe customer and an automatic 15% multi-product discount.

## License

MIT
