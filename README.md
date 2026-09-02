# RelayRoom

Coordinate an order recovery across buyer, inventory, and carrier portals, with approval before changes.

Built for [HectorTa1989](https://github.com/HectorTa1989). Apple-inspired React interface; TypeScript, Express, SQLite, WebMCP, optional OpenAI/Gemini planning, and Polar billing.

## What works now

The application starts with **empty operational databases**. An administrator can create orders, inventory lots, routes, and operator accounts, or import JSON records. There is no runtime restriction to `CASE-1047`, 480 units, specific suppliers, or a fixed date.

- Plans allocate the exact requested quantity across matching lots, respecting each minimum reservation and readiness before route departure.
- Routes must match the order's origin and destination, capacity, deadline, and logistics cost cap.
- Approval re-fetches authoritative partner records. A changed plan is rejected before execution.
- Inventory holds and route reservations consume availability, including while staged. SQLite transactions prevent overlapping reservations from overbooking resources.
- Commit updates the buyer's actual stored arrivals, status, and revision. Compensation restores the previous order contents with a new revision and releases all staged/committed allocations.
- Approvals, operations, actor-attributed audit entries, accounts, and billing entitlements persist across restarts. Resume or release a saved recovery after reloading the page.
- Failure to confirm compensation is shown as needing recovery, never as a successful rollback.
- Signed, short-lived partner grants bind an operator and exact approved plan to one partner. The APIs enforce approval, quantities, transaction ownership, and commit dependencies independently of browser UI state.
- Admin accounts bypass Polar billing. Operators require Pro for planning, approval, and audit export. Releasing an existing recovery remains available after subscription expiry.

**Local operations** means this app is the record system for the stock, routes, and orders you enter. It does not dispatch a physical truck or contact a third-party warehouse. **External connector** means the selected partner delegates to your configured integration service. Provider-specific ERP/WMS/carrier adapters and their credentials must be supplied before claiming real external bookings. No external provider has been certified or live-tested in this repository.

## Project structure

```text
RelayRoom/
├── apps/
│   ├── room/src/
│   │   ├── App.tsx                 # Order selection, planning, approval, recovery, receipts
│   │   ├── OperationsManager.tsx   # Record forms, JSON import, operator creation
│   │   ├── orchestration.ts        # WebMCP/bridge discovery, sessions, execution
│   │   ├── auth.ts                 # Session, workspace, billing clients
│   │   └── state.ts                # Visible workflow state
│   ├── buyer-portal/src/           # Buyer tool host and API entry point
│   ├── supplier-portal/src/        # Supplier tool host and API entry point
│   ├── carrier-portal/src/         # Carrier tool host and API entry point
│   └── api/src/
│       ├── server.ts              # Authentication, Polar, planning endpoint
│       ├── accounts.ts            # Password hashes and durable entitlements
│       ├── workspace.ts           # Records, authoritative approvals, recovery journal
│       └── planner.ts             # OpenAI → Gemini → deterministic selection
├── packages/
│   ├── contracts/src/operations.ts # Validated order/lot/route/approval schemas
│   ├── operations/src/
│   │   ├── store.ts               # Atomic reservations, order revisions, compensation
│   │   ├── security.ts            # Audience/scope-bound grants
│   │   └── server.ts              # Partner APIs and remote connector transport
│   ├── simulator/src/             # Exact allocation solver and transaction runner
│   └── ui/src/                    # Data-driven partner UI and WebMCP adapter
├── scripts/                       # Production process launcher and static room server
├── docs/connector-contract.md     # External adapter contract and deployment boundaries
├── tests/e2e/                     # Isolated browser and API integration scenarios
├── evals/                         # Intent/safety cases
├── .data/                         # Ignored SQLite databases and isolated test datasets
├── .env.example
├── compose.yaml
└── Dockerfile
```

## Run locally

Use Node.js 22.13+ and npm. Install dependencies and copy `.env.example` to `.env` **only if you do not already have a configured `.env`**.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open [RelayRoom](http://localhost:4173). Sign in using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from your `.env`. On first startup these bootstrap a hashed account in `workspace-v2.sqlite`; subsequent startups keep that stored account. Changing the environment password does not overwrite the account. With no environment file, development defaults are `admin@relayroom.local` / `relay-admin-local`. Production rejects these defaults and requires your own credentials and a random session secret.

1. Open **Manage operations → Orders**. Enter an order, quantity, SKU, origin, destination, future deadline, and cost cap.
2. Add inventory lots for that exact SKU and stock location. Stock must be ready before the route's departure.
3. Add a future route with matching origin/destination, enough capacity, arrival before the deadline, and an acceptable cost percentage.
4. Select the order, choose **Resolve case**, review the proposed allocations, and approve.
5. Use **Recovery history** to resume/release interrupted work or reopen a completed receipt. Export includes persisted partner records and audit events.

The current solver supports multiple lots consolidated at one origin onto **one route and one arrival**. It does not optimize multi-leg or split-shipment networks. All quantities are integers. The form uses local times; persisted/imported timestamps include an explicit UTC offset.

Each import is a JSON array, at most 100 records / 250 KB. Each partner batch is all-or-nothing. Duplicate IDs are rejected; imports do not overwrite existing records. Record shapes and an example are in [the connector contract](docs/connector-contract.md). Matching is exact, including capitalization of locations. Existing records are immutable through the management API; order revisions change through approved recovery transactions. Inventory replenishment is a new lot.

## WebMCP and model planning

Partner pages register read, stage, commit, and release tools. The room discovers tools across the three configured origins and executes them in their owning pages. Exact origin/source checks protect the compatibility bridge; credentials are delivered separately from tool inputs and held in partner-page memory. Tool discovery alone grants no API access.

The native adapter follows the [WebMCP draft](https://webmachinelearning.github.io/webmcp/): `document.modelContext`, object inputs to `executeTool`, and JSON-decoded result strings. Native mode requires all partner origins to be discovered. Otherwise the UI explicitly reports **Compatibility bridge**. Browser integration tests exercise the bridge; a protocol unit test covers native argument/result serialization. Native execution still needs validation in a supporting browser build.

The deterministic solver computes feasible candidates. A configured model selects one and explains it; it cannot invent a new candidate or directly bypass approval. No paid OpenAI key is required:

```dotenv
OPENAI_API_KEY=
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-3.7-flash
```

Provider order: OpenAI, then Gemini, then deterministic. Missing keys, provider errors, and invalid responses fall back visibly. Gemini uses the documented [Interactions structured-output format](https://ai.google.dev/gemini-api/docs/structured-output). Keys remain server-side. Model availability and provider quotas depend on your account; no successful live model request is claimed by the test suite.

## Free ERPNext + Shippo demo

The repository includes an optional connector adapter for a real **ERPNext** instance and **Shippo Test Mode**. It makes authenticated server-to-server provider calls; it is not a browser mock. ERPNext supplies sales orders and available warehouse inventory. Shippo supplies live test-mode shipping rates and buys a test label only after RelayRoom commits the approved carrier action.

1. Start ERPNext locally or on a sandbox host and create an API key/secret. Create one single-item Sales Order and stock its item in the warehouse named by `ERPNEXT_ORIGIN`.
2. Create a Shippo test token and fill in the `SHIPPO_*` address values in `.env.example` (copy them into your existing `.env`).
3. Generate a separate random `RELAYROOM_CONNECTOR_TOKEN`, set `BUYER_BACKEND`, `SUPPLIER_BACKEND`, and `CARRIER_BACKEND` to `remote`, and set the corresponding connector URLs to `http://localhost:8790/buyer`, `/supplier`, and `/carrier`. Use the same value for the three `*_CONNECTOR_TOKEN` settings.
4. Run `npm run demo:providers` in one terminal, then `npm run dev` in another.

The adapter does not silently emulate provider writes. Buyer commit requires an ERPNext custom Sales Order status field set by `ERPNEXT_RELAYROOM_STATUS_FIELD`. For supplier commitment, configure three organization-owned Frappe methods in `ERPNEXT_RESERVE_METHOD`, `ERPNEXT_COMMIT_RESERVATION_METHOD`, and `ERPNEXT_RELEASE_RESERVATION_METHOD`; RelayRoom calls them with a transaction id, phase-specific idempotency key, allocations/reservation ID, and expiry. Without those methods it stops with `ERP_RESERVATION_MAPPING_REQUIRED`: deleting inventory via a guessed ERP document would be unsafe. Shippo Test Mode carrier commits are live provider test calls, and a later release requests a refund where Shippo confirms one. This keeps the demo honest while showing real reads, quotes, and carrier-label transactions.

Do not expose port 8790 publicly. In production place it behind HTTPS and set the connector URLs to its private HTTPS address. See [the provider adapter setup](docs/provider-adapter.md) for environment variables, mappings, and limitations.

## Billing and users

The administrator can create operator accounts in **Manage operations → Operators**. Passwords use unique salts and scrypt; logins are rate-limited. This is a **single-organization deployment**: authorized users share the operational catalog, while transaction actions/receipts are owner-scoped. It is not tenant-isolated SaaS, and it does not yet include SSO, password reset, or account revocation UI.

Configure `POLAR_ACCESS_TOKEN`, `POLAR_PRODUCT_ID`, and `POLAR_WEBHOOK_SECRET`; select `POLAR_SERVER=sandbox` or `production`. Deliver `customer.state_changed` to `/api/webhooks/polar`. The raw body signature is checked before updating persisted entitlements; webhook IDs are deduplicated and older timestamped updates cannot replace newer state. Admin bypass is always checked server-side.

`RELAYROOM_DEMO=true` explicitly enables development-only failure rehearsal and billing simulation. It does not seed business records. Production disables both, and rehearsal approval is rejected when any partner uses a remote backend. Keep demo mode off for actual operations.

## Recovery and data preservation

Approval is written before any partner action. The normal sequence is stage supplier/carrier/buyer, then commit supplier/carrier/buyer. Carrier commit checks supplier confirmation; buyer commit checks both earlier confirmations. On failure, compensation runs buyer/carrier/supplier, including stages whose responses might have been lost. Idempotency keys are tied to transaction, partner, and phase. A released transaction cannot be staged again.

Uncommitted holds expire at the earlier of 15 minutes after approval or the route departure. Expired holds no longer consume availability and cannot be committed. Committed reservations continue consuming capacity until explicitly released. Reloading does not silently execute anything: use **Resume** for idempotent continuation or **Release reservations** for cleanup. Unknown connector results require provider reconciliation; a network timeout is not proof of failure.

New databases are `buyer-operations-v2.sqlite`, `supplier-operations-v2.sqlite`, `carrier-operations-v2.sqlite`, and `workspace-v2.sqlite`. Legacy `buyer.sqlite`, `supplier.sqlite`, and `carrier.sqlite` are left untouched and are not automatically imported. Back up all four new databases consistently, including WAL state, before operational use. Do not delete them to reset an account.

## Build and serve

```powershell
npm run typecheck
npm test
npm run test:e2e
npm run build
npm start
```

`npm start` serves built assets rather than Vite development servers and forces production mode. Set a non-default admin password (12+ characters) and `SESSION_SECRET` (32+ random characters) before the first production start. Build after configuring `VITE_*` public origins. Keep dependencies needed by the TypeScript runtime installed; this launcher uses `tsx`.

| Surface | Browser port | API port |
|---|---:|---:|
| Room | 4173 | 8787 |
| Buyer | 4174 | 8784 |
| Supplier | 4175 | 8785 |
| Carrier | 4176 | 8786 |

For HTTPS deployment, put the surfaces behind a reverse proxy with the configured exact origins. Partner browser servers also serve their authenticated `/api` endpoints. Set internal `*_API_URL` values for dependency checks, public `VITE_*_ORIGIN` values before building, and runtime `ROOM_ORIGIN` for API CORS. Backend ports should stay on a private network. Production headers include CSP, origin-agent clustering, and WebMCP permissions policy. `docker compose up --build` supports local container hosting after credentials are configured; custom domain builds need matching build-time public origins.

Browser tests use separate ports 4273–4276 / 8884–8887 and a new `.data/e2e-*` directory. They never reuse your live server or model keys. They verify arbitrary order quantities, actual resource accounting, complete compensation, API approval enforcement, order entry, and reload recovery. Unit tests cover expiry, duplicate import rollback, idempotency, changed approval rejection, exact allocation, and failed compensation. Remote providers, native browser WebMCP, and live Polar/model requests require environment-specific acceptance tests.

See [connector setup and operating limits](docs/connector-contract.md) before connecting production systems.
