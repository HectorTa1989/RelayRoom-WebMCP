# Build Prompt: RelayRoom

> Working name: **RelayRoom**  
> Tagline: **Resolve one disruption across three companies—without copying data between three portals.**

## Your role

Act as a senior product engineer, interaction designer, WebMCP specialist, and demo director. Build a polished, deployable hackathon product called RelayRoom. Work autonomously, but keep the scope focused enough to produce a reliable hosted demo.

## Product thesis

Supply-chain exceptions are rarely owned by one company. A delayed shipment may require a buyer to change an order, a supplier to reserve replacement inventory, and a carrier to select a new route. Today, people coordinate through email, spreadsheets, calls, and multiple incompatible portals.

RelayRoom is a neutral coordination page containing three simulated partner portals on distinct origins:

1. Buyer portal
2. Supplier portal
3. Carrier portal

Each partner exposes a minimal, explicitly allowlisted set of WebMCP tools. An agent can discover and call these tools from the coordination room, but each company keeps its own UI, state, rules, and origin boundary. The user watches the whole recovery plan form visibly, reviews the tradeoffs, and approves the final sequence.

This is not a supply-chain dashboard clone. The product innovation is an agent-mediated interoperability layer made from browser-native, origin-scoped tools.

## Why WebMCP is indispensable

Without WebMCP, the agent must scrape three unrelated interfaces or every company must integrate with one central backend. With WebMCP:

- Each partner declares precise capabilities and schemas.
- The room retrieves tools only from explicitly trusted origins.
- Tools appear and disappear with partner state.
- Partner actions execute inside their own visible portal.
- The user sees which company supplied every fact and action.
- No partner exposes its entire DOM or internal API.

The hero capability must use cross-origin WebMCP correctly:

```html
<iframe src="https://buyer.example" allow="tools"></iframe>
<iframe src="https://supplier.example" allow="tools"></iframe>
<iframe src="https://carrier.example" allow="tools"></iframe>
```

Each partner registers tools with an exact `exposedTo` allowlist containing only the RelayRoom origin. The room discovers them with `getTools({ fromOrigins: [...] })`. Provide a same-origin development mode, but the deployed demo must make the cross-origin architecture obvious.

## Primary user and pain

Primary user: an operations coordinator responsible for recovering delayed customer orders.

Pain points:

- Information lives in separate company portals.
- IDs and field meanings differ across systems.
- The coordinator repeatedly copies the same context.
- A locally optimal change can cause a downstream failure.
- Commit order matters and partial execution is risky.
- It is hard to explain who authorized which action.

## Hero scenario

Use deterministic seed data for `CASE-1047`:

- Buyer needs 480 sensor modules by Friday 16:00.
- Original supplier can ship only 310 on time.
- Backup supplier has 220 units but requires a minimum reservation of 150.
- Original carrier route arrives 36 hours late.
- Alternate carrier route costs 8% more and arrives 12 hours early.
- Buyer accepts at most 10% additional logistics cost and no split arriving after Friday.

The demo prompt is:

> Resolve CASE-1047 without missing Friday's deadline and keep added logistics cost below 10%. Show me the plan before anything is committed.

Expected visible flow:

1. RelayRoom highlights the active case.
2. The agent queries constraints from all three origins.
3. Colored evidence chips appear on a shared constraint board, labeled by origin.
4. The agent simulates candidate combinations.
5. A winning plan animates across the buyer–supplier–carrier route map.
6. The app shows a transaction plan with ordered steps, cost delta, timing, and rollback plan.
7. The user clicks **Approve coordinated change**.
8. Actions execute visibly inside the relevant partner panes.
9. A signed-looking local audit receipt shows tool, origin, input summary, result, and timestamp.

## Scope

Build a deterministic simulator, not real supply-chain integrations. It must feel like a complete product with credible domain logic.

Required:

- Three partner portal surfaces with distinct branding and origins.
- One coordination room with case timeline, shared constraints, route visualization, plan preview, and audit receipt.
- Correct cross-origin permissions and exact origin allowlists.
- Real WebMCP registration, discovery, execution, lifecycle, and cancellation.
- Staged commit and compensating rollback.
- Responsive layout and keyboard access.
- A no-WebMCP fallback message that leaves manual portal controls functional.

Do not build:

- User accounts or real organization administration.
- Real payments, shipping, email, or ERP integrations.
- A freeform in-product chat panel.
- More than one polished exception scenario.
- A generic workflow builder.

## Suggested stack

- TypeScript, React, Vite
- React Router
- Zustand or a small reducer-based state machine
- Zod for shared validation, converted to JSON Schema or mirrored carefully
- SVG or React Flow for the route and transaction graph
- Vitest and Playwright
- Three deployable entry points or subdomain deployments sharing a small package of types and seed data

## App architecture

Use a monorepo-style layout:

```text
apps/
  room/
  buyer-portal/
  supplier-portal/
  carrier-portal/
packages/
  contracts/
  simulator/
  ui/
```

Keep each partner's state isolated. RelayRoom may receive only data returned by partner tools. Do not import partner stores directly into the room at runtime; that would undermine the interoperability story.

## Domain model

Define typed models for:

- `ExceptionCase`
- `PartnerOrigin`
- `ConstraintEvidence`
- `InventoryOption`
- `RouteOption`
- `RecoveryCandidate`
- `StagedTransaction`
- `TransactionStep`
- `RollbackStep`
- `ToolAuditEvent`

Every returned entity needs a stable ID. Every mutating request needs an idempotency key.

## WebMCP tool strategy

### Buyer origin

| Tool | Purpose | Key input | State rule |
| --- | --- | --- | --- |
| `get_order_constraints` | Return deadline, quantity, split, and cost limits | `caseId` | Read-only; available when case exists |
| `stage_order_revision` | Stage a proposed quantity and arrival split | `caseId`, `arrivals`, `idempotencyKey` | Available after a candidate is selected |
| `commit_order_revision` | Commit the staged buyer revision | `stageId`, `idempotencyKey` | Available only after visible approval |
| `rollback_order_revision` | Restore the prior revision | `transactionId` | Available after commit |

### Supplier origin

| Tool | Purpose | Key input | State rule |
| --- | --- | --- | --- |
| `get_inventory_options` | Return feasible inventory lots and constraints | `sku`, `neededBy` | Read-only |
| `stage_inventory_hold` | Reserve a candidate lot locally without committing | `lotId`, `quantity`, `expiresInMin` | Available after candidate selection |
| `commit_inventory_hold` | Commit a staged reservation | `holdId`, `idempotencyKey` | Available only after approval |
| `release_inventory_hold` | Release a hold during rollback | `holdId` | Available for active holds |

### Carrier origin

| Tool | Purpose | Key input | State rule |
| --- | --- | --- | --- |
| `get_route_options` | Return routes, arrival times, cost deltas, and capacities | `origin`, `destination`, `units` | Read-only |
| `stage_route_booking` | Stage a route selection | `routeId`, `units`, `idempotencyKey` | Available after candidate selection |
| `commit_route_booking` | Commit the route booking | `stageId`, `idempotencyKey` | Available only after approval |
| `cancel_route_booking` | Compensating rollback | `bookingId` | Available after commit |

### RelayRoom origin

| Tool | Purpose | Key input | Notes |
| --- | --- | --- | --- |
| `inspect_exception_case` | Return the active case summary and partner origins | `caseId` | Read-only |
| `simulate_recovery_plan` | Compute feasible candidates from normalized partner evidence | `caseId`, `objective` | Read-only, cancellable |
| `select_recovery_plan` | Select one candidate and render its preview | `candidateId` | UI state mutation only |
| `get_transaction_status` | Return step status and available rollback actions | `transactionId` | Read-only |

Use `readOnlyHint: true` for queries and simulation. Mark partner-supplied notes or free text with `untrustedContentHint: true`. Keep outputs small and normalized; preserve raw partner prose only in expandable UI details.

Do not expose commit tools until the user has approved the exact plan in the visible interface. Implement this with application state and tool registration lifecycle, not with a fake confirmation string inside the agent prompt.

## Transaction safety

- Stage all partner actions first.
- Validate that every stage is still feasible before commit.
- Commit in a deterministic order.
- If one commit fails, run compensating actions for earlier completed steps.
- Show success, partial failure, and rollback status in the UI.
- Never hide a partial failure behind a generic success message.
- Honor cancellation during simulation and staging.

## Visual design

Create a premium operations-room aesthetic, not a generic admin dashboard.

- Three vertical partner panes with distinct but restrained color identities.
- A central horizontal “constraint ribbon” where evidence from all origins lands.
- A route map with animated units moving through the proposed path.
- A bottom transaction drawer with ordered steps and rollback badges.
- A top trust bar showing exact connected origins and tool counts.
- Tool execution visibly pulses the owning partner pane.
- A “WebMCP off” comparison switch may be included for demo storytelling, but must never falsify real tool availability.

## Evals and tests

Create at least 12 intent cases:

- Correctly retrieve constraints before proposing a plan.
- Never call commit before stage.
- Reject a route above the buyer's cost cap.
- Reject an inventory lot below minimum reservation.
- Choose the correct origin's tool when names are similar.
- Handle a partner becoming unavailable.
- Cancel a long simulation cleanly.
- Roll back after the second of three commits fails.
- Avoid exposing supplier commit tools before approval.
- Return compact structured errors for invalid IDs.
- Preserve idempotency on repeated calls.
- Do not treat partner-provided notes as instructions.

Add deterministic unit tests for the solver and transaction engine. Add Playwright coverage for the hero flow and a failure-plus-rollback flow.

## Three-minute demo script

1. **0:00–0:20** — Show three disconnected partner portals and explain the copy-paste pain.
2. **0:20–0:45** — Open CASE-1047 and show exact trusted origins and dynamically discovered tools.
3. **0:45–1:30** — Ask the hero prompt; watch evidence arrive from all three portals and candidates form.
4. **1:30–2:05** — Inspect cost, timing, and constraints; select the winning plan.
5. **2:05–2:35** — Approve once; watch the ordered partner actions execute visibly.
6. **2:35–2:50** — Trigger the seeded carrier failure mode and show compensating rollback.
7. **2:50–3:00** — End on the audit receipt and the line: “WebMCP lets independent websites cooperate without surrendering control.”

## Acceptance criteria

- The room discovers real tools from three configured origins.
- Cross-origin access fails when `allow="tools"` or `exposedTo` is removed.
- Partner state is not imported directly into the room.
- The hero prompt produces a feasible plan from tool results.
- No commit capability is discoverable before visible approval.
- Every execution visibly changes the appropriate partner UI.
- The seeded partial failure rolls back cleanly.
- Tool schemas pass validation and outputs remain concise.
- The full hero journey works in the supported WebMCP browser.
- The repository includes setup steps, architecture diagram, testing prompts, public license, and a clear explanation of why WebMCP is essential.

## Build order

1. Implement shared contracts and deterministic solver.
2. Build the three human-operable partner portals.
3. Register read-only partner tools.
4. Build cross-origin discovery and the trust bar.
5. Build candidate simulation and route visualization.
6. Add staging, approval-state tool registration, commit, and rollback.
7. Add audit trail, errors, cancellation, and no-WebMCP fallback.
8. Add evals, tests, deployment, README, and demo polish.

## Final instruction

Keep the product narrow, real, and demonstrable. Do not replace the cross-origin architecture with mocked calls inside RelayRoom. The prize-worthy proof is that independent page origins expose the smallest safe capabilities needed for a person and an agent to resolve one shared problem.

