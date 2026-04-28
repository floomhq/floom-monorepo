# Secrets and Context

This document describes the launch-grade behavior for saved secrets and the planned context layer for filling app inputs.

## Secret Storage Model

Floom can store user/workspace API keys so apps can run without asking for the same key every time.

Verified implementation:

- User/workspace secrets are stored in `user_secrets`.
- Creator-provided app secrets are stored in `app_creator_secrets`.
- Values are encrypted with AES-256-GCM.
- Each workspace has a random data encryption key (DEK).
- The workspace DEK is wrapped by `FLOOM_MASTER_KEY`, or by a generated `<DATA_DIR>/.floom-master-key` when no env key is set.
- Secret list APIs return key names and timestamps only.
- Secret set APIs never echo the plaintext value.
- The runner decrypts secrets in memory and injects only keys declared by the app manifest.
- Per-call BYOK values can be passed transiently and are not persisted as user secrets.

This is not zero-knowledge encryption. The Floom server can decrypt stored secrets at run time because it owns the master key. If only the database leaks, stored values are ciphertext. If the database and master key or server root access leak together, stored secrets are compromised.

## User-Facing Copy

Use this wording in product surfaces:

- **Use once:** pass this key for this run only; Floom does not save it.
- **Save to Floom vault:** encrypt and reuse this key for future runs.
- **Delete key:** remove the saved value from the vault.

Avoid wording that implies Floom cannot decrypt the value. The accurate statement is: values are encrypted at rest, write-only in product/API responses, and decrypted server-side only when needed to run an app.

## MCP and CLI Behavior

MCP read-write agent tokens can manage saved workspace secrets:

- `account_list_secrets`
- `account_set_secret`
- `account_delete_secret`

The value is write-only: agents can set or delete it, but cannot retrieve plaintext.

Creator-owned app secrets are managed through studio tools:

- `studio_list_secret_policies`
- `studio_set_secret_policy`
- `studio_set_creator_secret`
- `studio_delete_creator_secret`

Agent-token management is intentionally separate from secrets. An agent token cannot list/create/revoke other agent tokens through MCP agent-token auth.

## Context Layer

The current request context already includes:

- `workspace_id`
- `user_id`
- `device_id`
- authentication state
- user email when available
- agent token id/scope/rate limit when bearer auth is used

The current workspace model stores:

- workspace id
- slug
- name
- plan
- wrapped encryption key
- created timestamp
- workspace members and roles

That is enough for authorization and ownership, but not enough for rich app input autofill such as:

- company legal name
- billing address
- tax id
- client contacts
- invoice defaults
- brand voice
- preferred currency
- sender identity

## Proposed Product Model

Add two explicit context stores:

1. `workspace_profile`
   - workspace-level fields such as company name, legal address, billing email, VAT/tax id, default currency, website, and brand instructions.
   - Shared by workspace members according to role.

2. `workspace_entities`
   - reusable structured records such as clients, contacts, vendors, projects, and billing recipients.
   - Each row has a type, display name, structured JSON data, and audit metadata.

Then expose context through UI, MCP, and CLI:

- `account_get_context`
- `account_update_workspace_profile`
- `account_list_entities`
- `account_upsert_entity`
- `account_delete_entity`

For app execution, add optional context mapping:

```json
{
  "slug": "invoice-generator",
  "action": "createInvoice",
  "inputs": {
    "client_id": "client_acme",
    "line_items": []
  },
  "context": {
    "use_workspace_profile": true,
    "entities": ["client_acme"]
  }
}
```

The runner can resolve this to a typed context object before validation/autofill:

```json
{
  "workspace": {
    "company_name": "Acme GmbH",
    "billing_address": "..."
  },
  "client": {
    "name": "Example Client",
    "billing_email": "billing@example.com"
  }
}
```

## Implementation Difficulty

For a minimal launch-followup version:

- Database tables: small.
- REST/MCP/CLI CRUD: straightforward.
- UI settings form: straightforward.
- App input autofill: moderate, because each app needs a clear schema for which context fields it accepts.
- Security review: required, because context can contain PII and billing details.

Recommended order:

1. Store and expose `workspace_profile`.
2. Add MCP/CLI read/update tools.
3. Let apps request context fields explicitly in their manifest.
4. Add typed entities like clients/projects after the profile flow is proven.
