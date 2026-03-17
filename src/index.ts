import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { VaultError } from '@lobsterkit/vault';
import { getClient } from './state.js';

// ── Proactive error guidance ─────────────────────────────────────────────────

type ToolResult = { content: { type: 'text'; text: string }[] };

const TIER_GUIDANCE: Record<string, string[]> = {
  rotate_secret: [
    'Cannot rotate secret: this operation requires Pro tier.',
    '',
    'Tier overview:',
    '- Free: 10 secrets',
    '- Builder ($9/mo): 100 secrets, versioning, audit log',
    '- Pro ($29/mo): unlimited secrets, rotation support',
    '',
    'Use get_account to check your current tier and limits.',
  ],
  set_secret: [
    'Cannot store secret: you have reached the secret limit for your tier.',
    '',
    'To store more secrets, upgrade your tier:',
    '- Free: 10 secrets',
    '- Builder ($9/mo): 100 secrets',
    '- Pro ($29/mo): unlimited secrets',
    '',
    'Use get_account to check your current usage.',
  ],
};

function handleVaultError(err: unknown, operation: string): ToolResult | null {
  if (!(err instanceof VaultError)) return null;

  if (err.status === 403) {
    const lines = TIER_GUIDANCE[operation] ?? [
      `This operation requires a higher account tier.`,
      `Error: ${err.message}`,
      '',
      'Use get_account to check your current tier and limits.',
    ];
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }

  if (err.status === 429) {
    return {
      content: [{
        type: 'text' as const,
        text: `Rate limit exceeded for ${operation}. Wait a moment and try again.`,
      }],
    };
  }

  return null;
}

const server = new McpServer(
  { name: 'lobstervault', version: '0.3.0' },
  {
    capabilities: { tools: {} },
    instructions: `LobsterVault — encrypted secret storage for agents.

## Typical workflow
1. set_secret — store an API key, connection string, or any sensitive value (encrypted server-side with AWS KMS)
2. get_secret — retrieve a secret by name when you need to use it
3. list_secrets — see all stored secret names (values are never returned in list operations)

## When to use secrets
- Store API keys, tokens, passwords, and connection strings that should persist across sessions
- Use vault.inject() to load all secrets into the environment at the start of an agent session
- Never log or expose secret values in plaintext — treat them as opaque strings

## Secret naming conventions
- Use SCREAMING_SNAKE_CASE for environment-variable-style secrets: OPENAI_API_KEY, DB_URL
- Use dot notation for namespaced secrets: myapp/api-key, prod/db-url
- Names are case-sensitive

## Tier limits
- Free: 10 secrets max
- Builder: 100 secrets, 5 versions, 30-day audit log
- Pro: Unlimited secrets, 20 versions, rotation support
- Scale: Unlimited everything, 1-year audit log`,
  },
);

// ── set_secret ────────────────────────────────────────────────────────────────

server.registerTool(
  'set_secret',
  {
    title: 'Set Secret',
    description:
      'Store or update a secret. The value is envelope-encrypted server-side using AWS KMS. Returns the new version number.',
    inputSchema: {
      name: z.string().describe('Secret name (e.g. OPENAI_API_KEY, db/connection-string)'),
      value: z.string().describe('Plaintext value to encrypt and store'),
      metadata: z
        .record(z.string())
        .optional()
        .describe('Optional key-value metadata to attach (not encrypted separately)'),
      ttlSeconds: z
        .number()
        .optional()
        .describe('Optional: auto-expire this secret after N seconds'),
      expiresAt: z
        .string()
        .datetime()
        .optional()
        .describe('Optional: absolute expiry as ISO 8601 datetime (mutually exclusive with ttlSeconds)'),
    },
  },
  async ({ name, value, metadata, ttlSeconds, expiresAt }) => {
    try {
      const vault = await getClient();
      const result = await vault.set(name, value, { metadata, ttlSeconds, expiresAt });

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ Secret "${name}" stored (version ${result.version}).`,
          },
        ],
      };
    } catch (err) {
      const guidance = handleVaultError(err, 'set_secret');
      if (guidance) return guidance;
      throw err;
    }
  },
);

// ── get_secret ────────────────────────────────────────────────────────────────

server.registerTool(
  'get_secret',
  {
    title: 'Get Secret',
    description: 'Retrieve and decrypt a secret value by name. Returns null if not found. Pass a version number to retrieve a specific historical version (Builder+ tier).',
    inputSchema: {
      name: z.string().describe('Secret name to retrieve'),
      version: z.number().int().positive().optional().describe('Optional: retrieve a specific historical version (Builder+ tier)'),
    },
  },
  async ({ name, version }) => {
    try {
      const vault = await getClient();
      const value = await vault.get(name, version !== undefined ? { version } : undefined);

      if (value === null) {
        return {
          content: [{ type: 'text' as const, text: `Secret "${name}" not found.` }],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Secret: ${name}\nValue: ${value}`,
          },
        ],
      };
    } catch (err) {
      const guidance = handleVaultError(err, 'get_secret');
      if (guidance) return guidance;
      throw err;
    }
  },
);

// ── delete_secret ─────────────────────────────────────────────────────────────

server.registerTool(
  'delete_secret',
  {
    title: 'Delete Secret',
    description: 'Permanently delete a secret.',
    inputSchema: {
      name: z.string().describe('Secret name to delete'),
    },
  },
  async ({ name }) => {
    const vault = await getClient();
    const deleted = await vault.delete(name);

    return {
      content: [
        {
          type: 'text' as const,
          text: deleted
            ? `✅ Secret "${name}" deleted.`
            : `Secret "${name}" not found — nothing to delete.`,
        },
      ],
    };
  },
);

// ── list_secrets ──────────────────────────────────────────────────────────────

server.registerTool(
  'list_secrets',
  {
    title: 'List Secrets',
    description: 'List all secret names on the account. Values are never returned in list operations.',
    inputSchema: {
      prefix: z.string().optional().describe('Filter secrets by name prefix (e.g. "prod/")'),
      limit: z.number().optional().describe('Max results (1–100, default 50)'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
    },
  },
  async ({ prefix, limit, cursor }) => {
    const vault = await getClient();
    const result = await vault.list({ prefix, limit, cursor });

    if (result.data.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No secrets found. Use set_secret to store one.',
          },
        ],
      };
    }

    const rows = result.data.map(
      (s) =>
        `- ${s.name}  (v${s.version}, updated ${s.updatedAt}${s.expiresAt ? `, expires ${s.expiresAt}` : ''})`,
    );

    const footer = result.pagination.hasMore
      ? `\n\nMore results available. Use cursor: ${result.pagination.cursor}`
      : '';

    return {
      content: [
        {
          type: 'text' as const,
          text: `${result.data.length} secret(s):\n\n${rows.join('\n')}${footer}`,
        },
      ],
    };
  },
);

// ── inject_secrets ────────────────────────────────────────────────────────────

server.registerTool(
  'inject_secrets',
  {
    title: 'Inject Secrets',
    description:
      'Load all secrets into the process environment (process.env). Returns the count of secrets injected. Use at agent startup to make all stored secrets available as env vars.',
    inputSchema: {},
  },
  async () => {
    const vault = await getClient();
    const result = await vault.inject();

    return {
      content: [
        {
          type: 'text' as const,
          text: `✅ Injected ${result.injected} secret(s) into environment.`,
        },
      ],
    };
  },
);

// ── rotate_secret ─────────────────────────────────────────────────────────────

server.registerTool(
  'rotate_secret',
  {
    title: 'Rotate Secret',
    description:
      'Re-encrypt a secret with a fresh Data Encryption Key. Use after KMS key rotation or as a security best practice. Requires Pro tier.',
    inputSchema: {
      name: z.string().describe('Secret name to rotate'),
    },
  },
  async ({ name }) => {
    try {
      const vault = await getClient();
      const result = await vault.rotate(name);

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ Secret "${name}" rotated (now v${result.version}, rotated at ${result.rotatedAt}).`,
          },
        ],
      };
    } catch (err) {
      const guidance = handleVaultError(err, 'rotate_secret');
      if (guidance) return guidance;
      throw err;
    }
  },
);

// ── get_account ───────────────────────────────────────────────────────────────

server.registerTool(
  'get_account',
  {
    title: 'Get Account',
    description: 'Get your account tier, secret usage, and limits.',
    inputSchema: {},
  },
  async () => {
    const vault = await getClient();
    const account = await vault.account();

    const lines = [
      `Account: ${account.id}`,
      `Tier: ${account.tier} — ${account.tierName}`,
      '',
      'Usage:',
      `  Secrets: ${account.usage.secretCount}`,
      '',
      'Limits:',
      ...Object.entries(account.limits).map(([k, v]) => `  ${k}: ${v}`),
    ];

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  },
);

// ── share_secret ──────────────────────────────────────────────────────────────

server.registerTool(
  'share_secret',
  {
    title: 'Share Secret',
    description:
      'Create a time-limited, read-only share link for a secret. Returns a shareToken that can be used to retrieve the secret without authentication. Requires Builder+ tier.',
    inputSchema: {
      name: z.string().describe('Secret name to share'),
      expiresInSeconds: z
        .number()
        .optional()
        .describe('Link expiry in seconds (default 3600, max 7 days)'),
      maxReads: z
        .number()
        .optional()
        .describe('Optional: max number of times the link can be read'),
      scope: z
        .string()
        .optional()
        .describe('Optional: label for this share (e.g. "ci-pipeline", "teammate-bob")'),
    },
  },
  async ({ name, expiresInSeconds, maxReads, scope }) => {
    try {
      const vault = await getClient();
      const result = await vault.share(name, { expiresInSeconds, maxReads, scope });

      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `Share link created for "${name}".`,
              `Share token: ${result.shareToken}`,
              `Expires at: ${result.expiresAt}`,
              maxReads ? `Max reads: ${maxReads}` : '',
              '',
              `Retrieve with: GET /v1/shared/${result.shareToken}`,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      };
    } catch (err) {
      const guidance = handleVaultError(err, 'share_secret');
      if (guidance) return guidance;
      throw err;
    }
  },
);

// ── list_shares ───────────────────────────────────────────────────────────────

server.registerTool(
  'list_shares',
  {
    title: 'List Shares',
    description:
      'List all active (non-revoked, non-expired) share links on the account. Requires Builder+ tier.',
    inputSchema: {
      secretName: z
        .string()
        .optional()
        .describe('Optional: filter shares by secret name'),
    },
  },
  async ({ secretName }) => {
    try {
      const vault = await getClient();
      const result = await vault.listShares(secretName);

      if (result.shares.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No active shares found.',
            },
          ],
        };
      }

      const rows = result.shares.map(
        (s) =>
          `- ${s.secretName} (${s.shareId}) — expires ${s.expiresAt}, reads: ${s.readCount}${s.maxReads ? `/${s.maxReads}` : ''}`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `${result.shares.length} active share(s):\n\n${rows.join('\n')}`,
          },
        ],
      };
    } catch (err) {
      const guidance = handleVaultError(err, 'list_shares');
      if (guidance) return guidance;
      throw err;
    }
  },
);

// ── revoke_share ──────────────────────────────────────────────────────────────

server.registerTool(
  'revoke_share',
  {
    title: 'Revoke Share',
    description: 'Revoke a share link immediately so it can no longer be used. Requires Builder+ tier.',
    inputSchema: {
      shareId: z.string().describe('The share ID to revoke (from list_shares)'),
    },
  },
  async ({ shareId }) => {
    try {
      const vault = await getClient();
      const revoked = await vault.revokeShare(shareId);

      return {
        content: [
          {
            type: 'text' as const,
            text: revoked
              ? `Share "${shareId}" revoked.`
              : `Share "${shareId}" not found — nothing to revoke.`,
          },
        ],
      };
    } catch (err) {
      const guidance = handleVaultError(err, 'revoke_share');
      if (guidance) return guidance;
      throw err;
    }
  },
);

// ── get_shared_secret ─────────────────────────────────────────────────────────

server.registerTool(
  'get_shared_secret',
  {
    title: 'Get Shared Secret',
    description:
      'Retrieve a shared secret using a share token. No authentication required. The share must be non-expired, non-revoked, and within its read limit.',
    inputSchema: {
      shareToken: z.string().describe('The share token from a share link'),
    },
  },
  async ({ shareToken }) => {
    try {
      const vault = await getClient();
      const result = await vault.getShared(shareToken);

      if (result === null) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Share not found, expired, revoked, or read limit exceeded.',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Secret: ${result.name}\nValue: ${result.value}\nExpires at: ${result.expiresAt}`,
          },
        ],
      };
    } catch (err) {
      const guidance = handleVaultError(err, 'get_shared_secret');
      if (guidance) return guidance;
      throw err;
    }
  },
);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
