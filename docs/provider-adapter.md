# ERPNext + Shippo Test Mode adapter

`scripts/provider-adapter.ts` is a runnable RelayRoom connector for a no-cost demo. It is a separate privileged service: RelayRoom authenticates to it with `RELAYROOM_CONNECTOR_TOKEN`; it then authenticates to ERPNext and Shippo with provider credentials that never reach the browser.

## Configure it

Use an ERPNext site you control (local Docker is fine) and a Shippo **test** token. Add the commented provider block from `.env.example` to `.env`, then set the partner gateways to remote mode:

```dotenv
RELAYROOM_CONNECTOR_TOKEN=a-separate-long-random-secret
BUYER_BACKEND=remote
SUPPLIER_BACKEND=remote
CARRIER_BACKEND=remote
BUYER_CONNECTOR_URL=http://localhost:8790/buyer
SUPPLIER_CONNECTOR_URL=http://localhost:8790/supplier
CARRIER_CONNECTOR_URL=http://localhost:8790/carrier
BUYER_CONNECTOR_TOKEN=a-separate-long-random-secret
SUPPLIER_CONNECTOR_TOKEN=a-separate-long-random-secret
CARRIER_CONNECTOR_TOKEN=a-separate-long-random-secret

ERPNEXT_URL=http://localhost:8000
ERPNEXT_API_KEY=...
ERPNEXT_API_SECRET=...
ERPNEXT_ORIGIN=Main Warehouse
ERPNEXT_DESTINATION=Demo customer location
ERPNEXT_RESERVE_METHOD=your_app.api.reserve_relayroom_stock
ERPNEXT_COMMIT_RESERVATION_METHOD=your_app.api.commit_relayroom_reservation
ERPNEXT_RELEASE_RESERVATION_METHOD=your_app.api.release_relayroom_reservation
SHIPPO_API_TOKEN=shippo_test_...
```

Run `npm run demo:providers`, then the normal RelayRoom development server. Loopback HTTP is accepted only outside production. For a deployed demo, use an HTTPS-only private adapter address.

## Provider mapping

| RelayRoom resource/action | Provider call | Notes |
|---|---|---|
| Buyer records and constraints | ERPNext `Sales Order` | The demo maps one Sales Order containing exactly one item. `modified` becomes the revision check. |
| Supplier options | ERPNext `Bin` | Available units are `actual_qty - reserved_qty`; the warehouse must equal the order origin. |
| Carrier options | Shippo `POST /shipments/` | Produces real test-mode rate quotes for configured addresses and parcel dimensions. |
| Buyer commit | ERPNext `PUT Sales Order` | Requires a deliberate custom status-field mapping. |
| Supplier stage/commit/release | Configured Frappe methods | Each must atomically reserve, commit, or release and return the documented confirmation ID. |
| Carrier commit | Shippo `POST /transactions/` | Buys a test label for the selected quoted rate. |
| Carrier release | Shippo `POST /refunds/` | RelayRoom only records a release after Shippo responds. |

## Important boundary

An ERPNext stock **read** is not a reservation. This adapter refuses supplier commit until you add an organization-specific ERPNext reservation implementation. This is intentional: ERPNext document configuration and cancellation rules differ by organization, so generic code must not pretend it has created a warehouse hold or subtract stock using an arbitrary `Stock Entry`.

Add a provider-specific reservation endpoint (or a custom Frappe app) that can atomically reserve the selected `Bin` quantities, persist the RelayRoom idempotency key, release a hold, and reconcile an uncertain result. Configure its dotted method names with `ERPNEXT_RESERVE_METHOD`, `ERPNEXT_COMMIT_RESERVATION_METHOD`, and `ERPNEXT_RELEASE_RESERVATION_METHOD`. The adapter calls them as Frappe `POST /api/method/...` endpoints and requires `reservationId`, `resultId`, and `released: true` respectively. The [external connector contract](connector-contract.md) lists the required behaviors.

Before a non-demo deployment, test duplicates, provider timeouts, stock changed outside RelayRoom, failed label refunds, stale Sales Order revisions, and concurrent reservations. Shippo rate/label availability and ERPNext custom fields are account-specific; neither is automatically certified simply because the adapter starts.
