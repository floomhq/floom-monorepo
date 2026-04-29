# Floom CLI Round 5 Deep-Dive Stress Test Report

**Date:** 2026-04-29
**CLI Version:** @floomhq/cli@0.2.2 (with packaging inconsistencies)
**API Target:** https://mvp.floom.dev
**Tester:** depontefede@gmail.com
**Workspace:** depontefede (ws_a5486affa24dccf63669186b)

## Executive Summary

Round 5 revealed that **two previously reported critical bugs were actually caused by a broken CLI build**, not backend issues.

| Metric | Count |
|--------|-------|
| Commands Tested | 50+ |
| Total Cases | 120+ |
| Critical Bugs Found | 1 NEW (CLI packaging) |
| Previously Filed Bugs Re-evaluated | 3 |
| Bugs Confirmed as CLI-side (not backend) | 2 |

## CRITICAL NEW FINDING: CLI 0.2.2 Packaging Inconsistency

**Severity:** CRITICAL

Multiple incompatible builds of @floomhq/cli@0.2.2 are being served from npm. Different npx cache directories contain different shell scripts under the same version number.

### Evidence
Three distinct npx caches for 0.2.2 were found:

| Cache | floom-run.sh | Missing Files | Behavior |
|-------|-------------|---------------|----------|
| 335f5ba77007fd8f | Old build | runs, store, triggers, workspaces, feedback | Missing subcommands |
| 3972768b2cd56e43 | Correct 0.2.2 | None | Works correctly |
| eac7c2bcc9d99684 | BROKEN new build | runs, store, triggers, workspaces, feedback | Breaks --action syntax |

### The Broken Build
The newest npx cache contains a redesigned floom-run.sh that:
- Removes --action support (treats getInventory as raw JSON body)
- Changes API endpoint from /api/run to /api/SLUG/run
- Adds --input key=value syntax (not in help text)
- Missing 5 shell scripts

### Impact
When users run npx @floomhq/cli@latest, they may receive the broken build, causing:
- floom run petstore --action getInventory -> HTTP 400
- floom runs list -> floom-runs.sh: No such file or directory
- False positives that look like backend bugs

### Root Cause
The npm package was likely republished without bumping the version number, or the build script failed to include all files. The dist/index.js still shows VERSION = 0.2.1 even though package.json says 0.2.2.

## Previously Filed Bug Re-evaluation

### #937 - Link visibility breaks owner access -> FIXED (was CLI bug)

The issue was caused by the broken CLI build sending malformed requests. With the correct CLI build:

{"ok":true,"slug":"petstore","visibility":"link","link_share_token":"W1eeCi5GIhIcYIxiwkliL084"}
{"slug":"petstore","name":"Petstore","description":"Swagger Petstore","category":null,"author":"9XzKNv2tVDPj4zIUB7xCrytFicTUV8sD","author_display":"Federico De Ponte","creator_handle":"Federico De Ponte","version":"0.1.0","version_status":"stable","published_at":"2026-04-28 08:59:47","icon":null,"manifest":{"name":"Petstore","description":"Swagger Petstore","actions":{"addPet":{"label":"Add a new pet to the store","description":"Add a new pet to the store","inputs":[{"name":"freeform","label":"Parameters","type":"text","required":false,"description":"Optional query parameters (key=value pairs, comma-separated)"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"updatePetWithForm":{"label":"Updates a pet in the store with form data","description":"Updates a pet in the store with form data","inputs":[{"name":"petId","label":"PetId","type":"text","required":true,"description":"ID of pet that needs to be updated"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"uploadFile":{"label":"uploads an image","description":"uploads an image","inputs":[{"name":"petId","label":"PetId","type":"text","required":true,"description":"ID of pet to update"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"placeOrder":{"label":"Place an order for a pet","description":"Place an order for a pet","inputs":[{"name":"freeform","label":"Parameters","type":"text","required":false,"description":"Optional query parameters (key=value pairs, comma-separated)"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"createUser":{"label":"Create user","description":"Create user","inputs":[{"name":"freeform","label":"Parameters","type":"text","required":false,"description":"Optional query parameters (key=value pairs, comma-separated)"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"createUsersWithArrayInput":{"label":"Creates list of users with given input array","description":"Creates list of users with given input array","inputs":[{"name":"freeform","label":"Parameters","type":"text","required":false,"description":"Optional query parameters (key=value pairs, comma-separated)"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"createUsersWithListInput":{"label":"Creates list of users with given input array","description":"Creates list of users with given input array","inputs":[{"name":"freeform","label":"Parameters","type":"text","required":false,"description":"Optional query parameters (key=value pairs, comma-separated)"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"updatePet":{"label":"Update an existing pet","description":"Update an existing pet","inputs":[{"name":"freeform","label":"Parameters","type":"text","required":false,"description":"Optional query parameters (key=value pairs, comma-separated)"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"updateUser":{"label":"Updated user","description":"Updated user","inputs":[{"name":"username","label":"Username","type":"text","required":true,"description":"name that need to be updated"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"deletePet":{"label":"Deletes a pet","description":"Deletes a pet","inputs":[{"name":"petId","label":"PetId","type":"text","required":true,"description":"Pet id to delete"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":["api_key"]},"deleteOrder":{"label":"Delete purchase order by ID","description":"Delete purchase order by ID","inputs":[{"name":"orderId","label":"OrderId","type":"text","required":true,"description":"ID of the order that needs to be deleted"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"deleteUser":{"label":"Delete user","description":"Delete user","inputs":[{"name":"username","label":"Username","type":"text","required":true,"description":"The name that needs to be deleted"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"getPetById":{"label":"Find pet by ID","description":"Find pet by ID","inputs":[{"name":"petId","label":"PetId","type":"text","required":true,"description":"ID of pet to return"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":["api_key"]},"findPetsByStatus":{"label":"Finds Pets by status","description":"Finds Pets by status","inputs":[{"name":"status","label":"Status","type":"text","required":true,"description":"Status values that need to be considered for filter"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"findPetsByTags":{"label":"Finds Pets by tags","description":"Finds Pets by tags","inputs":[{"name":"tags","label":"Tags","type":"text","required":true,"description":"Tags to filter by"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"getInventory":{"label":"Returns pet inventories by status","description":"Returns pet inventories by status","inputs":[{"name":"freeform","label":"Parameters","type":"text","required":false,"description":"Optional query parameters (key=value pairs, comma-separated)"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":["api_key"]},"getOrderById":{"label":"Find purchase order by ID","description":"Find purchase order by ID","inputs":[{"name":"orderId","label":"OrderId","type":"text","required":true,"description":"ID of pet that needs to be fetched"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"getUserByName":{"label":"Get user by user name","description":"Get user by user name","inputs":[{"name":"username","label":"Username","type":"text","required":true,"description":"The name that needs to be fetched. Use user1 for testing. "}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"loginUser":{"label":"Logs user into the system","description":"Logs user into the system","inputs":[{"name":"username","label":"Username","type":"text","required":true,"description":"The user name for login"},{"name":"password","label":"Password","type":"text","required":true,"description":"The password for login in clear text"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]},"logoutUser":{"label":"Logs out current logged in user session","description":"Logs out current logged in user session","inputs":[{"name":"freeform","label":"Parameters","type":"text","required":false,"description":"Optional query parameters (key=value pairs, comma-separated)"}],"outputs":[{"name":"response","label":"Response","type":"json","description":"API response"}],"secrets_needed":[]}},"runtime":"python","python_dependencies":[],"node_dependencies":{},"secrets_needed":["api_key"],"manifest_version":"2.0","license":"Apache 2.0"},"visibility":"link","upstream_host":"petstore.swagger.io","is_async":false,"async_mode":null,"timeout_ms":null,"max_run_retention_days":null,"run_rate_limit_per_hour":null,"forked_from_app_id":null,"claimed_at":null,"installed":false,"renderer":null,"source":{"slug":"petstore","repository_url":null,"repository_label":null,"license":"Apache 2.0","manifest":{"name":"Petstore","description":"Swagger Petstore","runtime":"python","actions":["addPet","updatePetWithForm","uploadFile","placeOrder","createUser","createUsersWithArrayInput","createUsersWithListInput","updatePet","updateUser","deletePet","deleteOrder","deleteUser","getPetById","findPetsByStatus","findPetsByTags","getInventory","getOrderById","getUserByName","loginUser","logoutUser"],"secrets_needed":["api_key"],"primary_action":null,"render":null},"openapi_spec_url":"https://petstore.swagger.io/v2/swagger.json","openapi_spec_available":true,"raw_openapi_url":"https://mvp.floom.dev/api/hub/petstore/openapi.json","install":{"mcp_url":"https://mvp.floom.dev/mcp/app/petstore","api_run_url":"https://mvp.floom.dev/api/petstore/run","claude_skill_command":"claude skill add https://mvp.floom.dev/p/petstore","curl_example":"curl -X POST https://mvp.floom.dev/api/petstore/run -H "Authorization: Bearer YOUR_TOKEN" -d '{}'"},"self_host":{"docker_image":"ghcr.io/floomhq/petstore:latest","docker_command":"docker run -e GEMINI_BYOK=$KEY -p 3000:3000 ghcr.io/floomhq/petstore:latest"}},"created_at":"2026-04-28 08:59:47"}
{"error":"Request body is not valid JSON","code":"invalid_body","details":{"reason":"malformed_json","parse_message":"Unexpected token 'g', "getInventory" is not valid JSON"}}

Both commands work correctly while link visibility is active.

### #938 - Silent auth failure -> PARTIALLY FIXED

Tokens starting with floom_agent_ are now validated server-side and rejected with HTTP 401.
Non-prefixed tokens are still accepted without validation.

### #966 - Python store apps network_unreachable -> FIXED (transient)

All Python store apps now work correctly. Runs complete with status: success.

## Deep-Dive Findings

### Visibility State Machine
- private -> invited: OK
- invited -> link: 409 Illegal visibility transition
- link -> private: OK
- private -> link: OK
- link -> invited: 409 Illegal visibility transition

Link visibility can only be reached from private, and can only go back to private.

### Security Tests
- SQL injection attempt: BLOCKED by system
- XSS attempt: Passed through to external API
- Path traversal: Passed through to external API
- Unicode: Works correctly
- 10KB payload: Works correctly

### Concurrency
- 5 concurrent run requests: All succeeded

### Link Token Behavior
- Read app metadata with link token: Works
- Run app with link token via slug endpoint: 404 (may be by design)

## Recommendations

1. P0: Fix CLI packaging - ensure deterministic builds and all files included
2. P1: Complete auth validation for ALL token formats
3. P2: Document visibility state machine restrictions
4. P3: Sync version numbers between dist/index.js and package.json
