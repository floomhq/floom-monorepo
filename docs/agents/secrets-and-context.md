# Secrets and Context

This document describes the launch-grade behavior for saved secrets and the JSON profile context layer for filling app inputs.

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
- JSON workspace profile
- wrapped encryption key
- created timestamp
- workspace members and roles

The current user model stores:

- user id
- email
- name
- JSON user profile

The JSON profiles are intentionally flexible and can hold nested data such as:

- company legal name
- billing address
- tax id
- client contacts
- invoice defaults
- brand voice
- preferred currency
- sender identity

## Implemented Profile Model

Floom stores two JSON objects:

1. `user_profile`
   - user-level fields such as sender name, personal preferences, default locale, personal signature, and preferred contact details.

2. `workspace_profile`
   - workspace-level fields such as company name, legal address, billing email, VAT/tax id, default currency, website, and brand instructions.
   - Shared by workspace members according to role.

Profile updates support:

- `merge`: deep-merge object fields, replace arrays/scalars, and delete keys by setting them to `null`.
- `replace`: replace the full profile object.

Root values must be JSON objects. The maximum serialized profile size is 64 KB.

Profiles are exposed through MCP:

- `account_get_context`
- `account_set_user_profile`
- `account_set_workspace_profile`

And through CLI:

```bash
floom account context get
floom account context set-user --json '{"person":{"name":"Ada"}}'
floom account context set-workspace --json-file ./workspace-profile.json --mode replace
floom account context set-workspace --json-stdin
```

REST:

- `GET /api/session/context`
- `PATCH /api/session/context`

## Next Context Layer: Entities

The remaining follow-up is `workspace_entities`: reusable structured records such as clients, contacts, vendors, projects, and billing recipients.

Entity tools can build on the profile layer:

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

App input autofill remains a separate step: apps need an explicit manifest-level declaration for which context fields they accept.
