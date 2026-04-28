# Manifest Spec

This page documents the backend fields accepted from `floom.yaml` during
publish. The canonical sharing model is ADR-008.

## Sharing Fields

Use `link_share_requires_auth` for signed-in link sharing:

```yaml
visibility: link
link_share_requires_auth: true
```

When `link_share_requires_auth: true` is present, publish stores:

- `apps.visibility = 'link'`
- `apps.link_share_requires_auth = 1`
- `apps.link_share_token = <24-character token>` when no token exists yet

The legacy field `auth_required` is deprecated:

```yaml
auth_required: true
```

For backward compatibility, publish accepts that field and maps it to the same
stored model as `link_share_requires_auth: true`. The server logs this warning:

```text
[openapi-ingest] <slug>: auth_required is deprecated; mapping to visibility='link' and link_share_requires_auth=true.
```

A manifest that declares both `auth_required` and
`link_share_requires_auth` is rejected with:

```text
<slug>: auth_required is deprecated; use link_share_requires_auth, not both fields
```

## Input Context Autofill

Inputs can declare a profile context binding. Floom only uses this binding when
the caller explicitly opts in with `use_context: true`.

```yaml
actions:
  createInvoice:
    label: Create invoice
    inputs:
      - name: sender_name
        type: text
        label: Sender name
        required: true
        context:
          source: user_profile
          path: person.name
      - name: company_city
        type: text
        label: Company city
        required: true
        context:
          source: workspace_profile
          path: company.address.city
```

Rules:

- `source` is `user_profile` or `workspace_profile`.
- `path` is a dot path using letters, numbers, and underscores.
- Explicit run inputs always win over profile values.
- Missing profile paths stay missing, so existing required-input validation still applies.
- Profile values are resolved at run time and are never embedded into MCP schemas.
