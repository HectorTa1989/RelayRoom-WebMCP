# External partner connector contract

RelayRoom has a working local operations store and an HTTP connector transport. The transport is **not a prebuilt SAP, NetSuite, Shopify, warehouse, or carrier integration**. Implement an adapter for your chosen provider, then validate it against a provider sandbox before enabling real writes. The provider identity, account permissions, and API credentials have not been supplied for this project.

## Select one backend per partner

```dotenv
BUYER_BACKEND=remote
BUYER_CONNECTOR_URL=https://your-order-adapter.example
BUYER_CONNECTOR_TOKEN=your-service-credential
```

Equivalent `SUPPLIER_*` and `CARRIER_*` settings exist. Keep these server-side. `*_API_URL` is the internal RelayRoom partner API address, not the third-party provider address. Remote mode has no local data fallback: upstream failures remain failures. A missing URL/token prevents startup. Remote URLs require HTTPS except loopback development services. Redirects are rejected.

Requests are authenticated by the partner gateway before forwarding. The gateway sends:

- `Authorization: Bearer <CONNECTOR_TOKEN>` over HTTPS.
- `X-RelayRoom-Context`: base64url-encoded JSON containing `sub`, `role`, `scope`, and, for writes, the full `approval`.
- The original JSON body and `/api/...` path/query.

The context header is **not itself a signature**. Accept it only after authenticating the service credential and only from trusted RelayRoom gateways. Do not expose an adapter that trusts arbitrary context headers. RelayRoom's browser sessions are not forwarded to external providers. Map the authenticated operator to your provider's authorized organization and permissions.

`scope` is `read`, `manage` (admin catalog imports), `execute` (exact approved transaction), or `release` (compensation only after entitlement expiry). Enforce the distinction inside your adapter too.

## Resource endpoints

| Endpoint | Response / behavior |
|---|---|
| `GET /api/records` | `{ "records": [...] }`, partner-specific catalog |
| `POST /api/records` | `{ "records": [...] }` body; validate and atomically create a batch, return created records |
| `GET /api/cases/:caseId/constraints` | Buyer order fields plus `caseId`, optional `source` / `note` |
| `GET /api/inventory/:sku/options?location=...` | `{ "options": [...] }`, available stock after all active allocations |
| `GET /api/routes/options?origin=...&destination=...&units=...` | `{ "options": [...] }`, matching future lanes with available capacity |
| `GET /api/transactions/:id` | `{ "operation": <OperationRecord or null> }`, authoritative status for this owner |
| `GET /api/audit?transactionId=...` | `{ "events": [{ "id": 1, "actor": "...", "action": "commit", "target": "transaction-id", "at": "ISO timestamp" }] }` |

Canonical types and validation live in `packages/contracts/src/operations.ts` and `packages/contracts/src/index.ts`. Never invent success when the provider has not confirmed it. A gateway health response only proves the gateway is reachable; the UI label "External connector" reports configuration, not provider certification.

Order input example (change dates for your actual schedule):

```json
[
  {
    "id": "PO-NEW-001",
    "sku": "VALVE-73",
    "productName": "Precision valve",
    "quantity": 73,
    "origin": "Depot A",
    "destination": "Plant B",
    "neededBy": "2030-01-04T16:00:00Z",
    "maxAddedLogisticsCostPct": 15,
    "allowLateSplit": false
  }
]
```

Returned orders also include integer `revision`, `status` (`open` or `resolved`), and `arrivals` (`{quantity, arrivesAt}[]`). Inventory records need `id`, `sku`, `location`, `supplier`, `availableUnits`, `minReservation`, `readyAt`, `unitCostDeltaPct`, and `source` (`original`/`backup`). Route records need `id`, `origin`, `destination`, `carrier`, `label`, `capacityUnits`, `departsAt`, `arrivesAt`, `costDeltaPct`, and numeric `delayHours` (zero is acceptable). JSON timestamps must include a timezone.

The adapter may reject record creation with a clear error if its provider owns catalog creation. It must still supply read endpoints for planning. The current management UI creates/imports records; it does not edit existing rows. Restocking should create a distinct lot or be reflected by your authoritative provider.

## Transaction endpoints

| Partner | Stage | Commit | Compensate |
|---|---|---|---|
| Buyer | `/api/order/stage` | `/api/order/commit` | `/api/order/rollback` |
| Supplier | `/api/inventory/stage` | `/api/inventory/commit` | `/api/inventory/release` |
| Carrier | `/api/routes/stage` | `/api/routes/commit` | `/api/routes/cancel` |

Every POST includes `transactionId` and `idempotencyKey`, exactly `<transactionId>:<partner>:<stage|commit|rollback>`.

Stage fields:

- Buyer: `caseId`, `arrivals: [{quantity, arrivesAt}]`.
- Supplier: `allocations: [{lotId, supplier, quantity}]`, covering **every selected lot**.
- Carrier: `routeId`, `units`.

Compare all these values with the signed approval accepted by the gateway. Commit additionally includes the confirmed `stageId`. Compensation identifies the operation by the approved transaction ID, even if the browser never received its stage response.

Return `{ "stageId": "provider-reservation-id", "status": "staged", "expiresAt": "..." }` for stage, and `{ "stageId": "...", "resultId": "provider-confirmation-id", "status": "committed" }` after confirmed commit. Compensation returns the same stable stage ID and `status: "released"`. Transaction lookup returns an `OperationRecord` including owner, approval, timestamps, status, stage/result IDs.

The adapter must implement:

1. Atomic capacity checks/reservations against provider state, including reservations from other applications.
2. Durable idempotency and payload-conflict detection. A repeated key must not place another order or booking.
3. Expiration at the approved deadline; reject late commits. Do not free committed inventory on a hold timer.
4. Persistent cancellation tombstones for transactions with uncertain/absent stage results, preventing a late stage from resurrecting a cancelled recovery.
5. Supplier confirmation before carrier commit; supplier and carrier confirmation before buyer commit. RelayRoom's gateway checks these dependencies before forwarding commits. Preserve these rules if your adapter also accepts other clients.
6. Order revision checks, previous-state retention, and compensation that does not overwrite a later unrelated revision.
7. Real cancellation rules, fees, and failure outcomes. When rollback cannot be confirmed, return an error requiring manual reconciliation; never assert "released" because a request was merely sent.
8. Owner-scoped operation lookup and actor-attributed audit history.

Use non-2xx JSON errors: `{ "error": { "code": "CAPACITY_CHANGED", "message": "..." } }`. A timeout or malformed upstream response becomes `CONNECTOR_RESULT_UNKNOWN`; RelayRoom will not replace it with a local booking. Inspect provider state, then resume with the same transaction ID or retry release. There is no exactly-once guarantee across third-party systems without provider-supported idempotency and reconciliation.

## Deployment boundary

This release is one organization on one shared operational catalog. It is suitable for evaluating a real workflow using entered/imported data and for implementing provider integrations. Multi-tenant isolation, SSO, user lifecycle management, high-availability databases, multi-leg logistics, shipment tracking/fulfillment, and provider-specific cancellation policies remain separate product work. Do not advertise the generic connector as a completed integration for a provider you have not implemented and tested.

Before operational deployment, validate your adapters against the provider's sandbox for competing reservations, duplicate calls, lost commit responses, rejected cancellation, stale order revisions, account isolation, and capacity changes from outside RelayRoom. Keep provider credentials out of `VITE_*` variables and browsers. Production requires HTTPS and correctly configured exact origins.
