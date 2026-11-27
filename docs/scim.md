# SCIM 2.0 provisioning

cf-frappe implements SCIM 2.0 provisioning for enterprise identity providers. The IdP remains responsible for credential verification and credential policy; SCIM is the provisioning boundary that creates, updates, disables, and re-enables the event-sourced account that cf-frappe already owns.

## API surface

Mount `createScimApi` at the root of a Worker route. The resource base is `/scim/v2`:

- `GET /scim/v2/ServiceProviderConfig`
- `GET /scim/v2/ResourceTypes`
- `GET /scim/v2/Schemas`
- `POST`, `GET`, `GET /Users/:id`, `PUT`, `PATCH`, and `DELETE` under `/scim/v2/Users`
- `POST`, `GET`, `GET /Groups/:id`, `PUT`, `PATCH`, and `DELETE` under `/scim/v2/Groups`

SCIM Users map to `UserAccountService.syncProvider`, role changes to `changeRoles`, enablement to `enable` / `disable`, and SCIM Groups map to the event-sourced role catalog. Writes do not update user state directly.

## Tokens

Issue and revoke SCIM bearer tokens through the admin API:

```http
POST /api/scim/tokens
POST /api/scim/tokens/:tokenId/revoke
GET  /api/scim/tokens?tenant=acme
```

An issued token is returned once. D1 stores only its hash; token IDs and secrets are random and the token verifier looks up a token by ID before checking its hash. Revocation and expiry are checked on every request.

## Deprovisioning is not deletion

`DELETE /Users/:id` maps to `UserAccountDisabled`. It does not erase history, roles, provider links, permissions, or the account's audit trail. The next version check rejects an existing signed session immediately. To remove data beyond the retained event history, a separately authorized data-retention or migration process must do so; the provisioning API never performs a hard delete.

## Idempotency

SCIM PUT, PATCH, enable, disable, role, and provider-sync writes are translated to domain commands. Replaying a request after it has already applied the same state reaches a no-op decision and appends no duplicate state event. Transient provider retries can therefore be safe, while SCIM metadata retains method, URL, and an optional `x-cf-frappe-request-id` header in the domain event audit trail.
