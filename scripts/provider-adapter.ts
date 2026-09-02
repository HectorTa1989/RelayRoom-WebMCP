/**
 * RelayRoom's optional, local provider adapter for an ERPNext + Shippo demo.
 *
 * It deliberately exposes the RelayRoom connector contract, not either
 * provider's credential to the browser. Run it on a private network (or
 * loopback in development) and point the three *_CONNECTOR_URL values at the
 * partner prefixes below.
 */
import express, { type Request, type Response } from "express";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type Partner = "buyer" | "supplier" | "carrier";
type Context = { sub: string; scope: string; approval?: Approval };
type Approval = {
  transactionId: string;
  expiresAt: string;
  order: { id: string; sku: string; quantity: number; origin: string; destination: string; neededBy: string; revision: number };
  candidate: { routeId: string; arrivesAt: string; inventoryAllocations: { lotId: string; supplier: string; quantity: number }[] };
};
type Operation = {
  transactionId: string; owner: string; partner: Partner; stageId: string;
  resultId?: string; status: "staged" | "committed" | "released";
  expiresAt: string; approval: Approval; provider?: Record<string, unknown>; updatedAt: string;
};

const port = Number(process.env.PROVIDER_ADAPTER_PORT || 8790);
const connectorToken = required("RELAYROOM_CONNECTOR_TOKEN");
const erpUrl = trimUrl(required("ERPNEXT_URL"));
const erpToken = `token ${required("ERPNEXT_API_KEY")}:${required("ERPNEXT_API_SECRET")}`;
const shippoToken = required("SHIPPO_API_TOKEN");
const dataDirectory = process.env.RELAYROOM_DATA_DIR || path.resolve(process.cwd(), ".data");
mkdirSync(dataDirectory, { recursive: true });
const db = new DatabaseSync(path.join(dataDirectory, "provider-adapter-v1.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS provider_operations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, partner TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS provider_audit (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, at TEXT NOT NULL);`);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to start the provider adapter`);
  return value;
}
function trimUrl(value: string) { return value.replace(/\/$/, ""); }
function error(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}
function now() { return new Date().toISOString(); }
function audit(actor: string, action: string, target: string) {
  db.prepare("INSERT INTO provider_audit(actor,action,target,at) VALUES (?,?,?,?)").run(actor, action, target, now());
}
function load(id: string, owner: string) {
  const row = db.prepare("SELECT owner,payload FROM provider_operations WHERE id=?").get(id) as { owner: string; payload: string } | undefined;
  if (!row) return undefined;
  if (row.owner !== owner) throw new Error("FORBIDDEN");
  return JSON.parse(row.payload) as Operation;
}
function save(operation: Operation, action: string) {
  operation.updatedAt = now();
  db.prepare("INSERT INTO provider_operations VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload")
    .run(operation.transactionId, operation.owner, operation.partner, JSON.stringify(operation));
  audit(operation.owner, action, operation.transactionId);
  return operation;
}
function context(req: Request): Context | undefined {
  const header = req.header("x-relayroom-context");
  if (!header) return undefined;
  try { return JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as Context; } catch { return undefined; }
}
function protectedRoute(req: Request, res: Response, next: () => void) {
  const received = Buffer.from(req.header("authorization")?.replace(/^Bearer\s+/i, "") || "");
  const expected = Buffer.from(connectorToken);
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    return error(res, 401, "CONNECTOR_AUTH_REQUIRED", "A valid RelayRoom connector credential is required");
  const relayContext = context(req);
  if (!relayContext?.sub || !relayContext.scope)
    return error(res, 401, "CONTEXT_REQUIRED", "RelayRoom execution context is required");
  (req as Request & { relayContext: Context }).relayContext = relayContext;
  next();
}
async function erp(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${erpUrl}${pathname}`, {
    ...init,
    headers: { Authorization: erpToken, Accept: "application/json", "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw Object.assign(new Error(body?.exception || body?.message || "ERPNext request failed"), { status: response.status });
  return body as { data?: unknown; message?: unknown };
}
async function shippo(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.goshippo.com${pathname}`, {
    ...init,
    headers: { Authorization: `ShippoToken ${shippoToken}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw Object.assign(new Error(body?.detail || body?.message || "Shippo request failed"), { status: response.status });
  return body as Record<string, unknown>;
}
function iso(date: unknown) {
  const value = String(date || "");
  return /T/.test(value) ? new Date(value).toISOString() : `${value}T16:00:00.000Z`;
}
function revision(value: unknown) { return Number.parseInt(createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12), 16); }
function orderFromERP(doc: Record<string, unknown>) {
  const item = Array.isArray(doc.items) ? doc.items[0] as Record<string, unknown> | undefined : undefined;
  if (!item || (doc.items as unknown[]).length !== 1) throw new Error(`Sales Order ${doc.name} must contain exactly one item for the demo adapter`);
  return {
    id: String(doc.name), sku: String(item.item_code), productName: String(item.item_name || item.item_code), quantity: Number(item.qty),
    neededBy: iso(doc.delivery_date), origin: required("ERPNEXT_ORIGIN"), destination: required("ERPNEXT_DESTINATION"),
    maxAddedLogisticsCostPct: Number(process.env.ERPNEXT_MAX_LOGISTICS_COST_PCT || 25), allowLateSplit: false,
    revision: revision(doc.modified), status: String(doc.status).toLowerCase() === "completed" ? "resolved" : "open", arrivals: [],
  };
}
async function buyerOrder(id: string) {
  const detail = await erp(`/api/resource/Sales%20Order/${encodeURIComponent(id)}`);
  return orderFromERP(detail.data as Record<string, unknown>);
}
async function buyerOrders() {
  const listed = await erp("/api/resource/Sales%20Order?fields=[%22name%22]&limit_page_length=100");
  return Promise.all(((listed.data || []) as Record<string, unknown>[]).map((row) => buyerOrder(String(row.name))));
}
async function erpMethod(name: string, payload: Record<string, unknown>) {
  const response = await erp(`/api/method/${name.split(".").map(encodeURIComponent).join(".")}`, { method: "POST", body: JSON.stringify(payload) });
  return (response.message || response.data || {}) as Record<string, unknown>;
}
async function lots(sku: string, location?: string) {
  const filters = [["item_code", "=", sku], ...(location ? [["warehouse", "=", location]] : [])];
  const query = new URLSearchParams({ fields: '["item_code","warehouse","actual_qty","reserved_qty","modified"]', filters: JSON.stringify(filters), limit_page_length: "100" });
  const response = await erp(`/api/resource/Bin?${query}`);
  return ((response.data || []) as Record<string, unknown>[]).map((bin) => ({
    id: `${bin.item_code}-${bin.warehouse}`, sku: String(bin.item_code), location: String(bin.warehouse), supplier: String(process.env.ERPNEXT_SUPPLIER_NAME || "ERPNext warehouse"),
    availableUnits: Math.max(0, Number(bin.actual_qty) - Number(bin.reserved_qty || 0)), minReservation: Number(process.env.ERPNEXT_MIN_RESERVATION || 1),
    readyAt: now(), unitCostDeltaPct: 0, source: "original" as const,
  }));
}
function address(name: "from" | "to") {
  const prefix = `SHIPPO_${name.toUpperCase()}_`;
  return { name: required(`${prefix}NAME`), street1: required(`${prefix}STREET1`), city: required(`${prefix}CITY`), state: required(`${prefix}STATE`), zip: required(`${prefix}ZIP`), country: process.env[`${prefix}COUNTRY`] || "US" };
}
function parcel(units: number) {
  return { length: String(process.env.SHIPPO_PARCEL_LENGTH || 10), width: String(process.env.SHIPPO_PARCEL_WIDTH || 8), height: String(process.env.SHIPPO_PARCEL_HEIGHT || 4), distance_unit: "in", weight: String(Number(process.env.SHIPPO_PARCEL_WEIGHT_LB || 1) * units), mass_unit: "lb" };
}
function routeId(shipment: string, rate: string) { return `shippo.${shipment}.${rate}`; }
function parseRoute(id: string) {
  const parts = id.split(".");
  if (parts.length !== 3 || parts[0] !== "shippo") throw new Error("Route was not quoted by this Shippo adapter");
  return { shipment: parts[1], rate: parts[2] };
}
async function shippoRoutes(units: number) {
  const shipment = await shippo("/shipments/", { method: "POST", body: JSON.stringify({ address_from: address("from"), address_to: address("to"), parcels: [parcel(units)], async: false }) });
  const created = String(shipment.object_id);
  const rates = Array.isArray(shipment.rates) ? shipment.rates as Record<string, unknown>[] : [];
  return rates.map((rate) => {
    const days = Math.max(1, Number(rate.estimated_days || 3));
    const arrives = new Date(Date.now() + days * 86400000).toISOString();
    return { id: routeId(created, String(rate.object_id)), origin: required("ERPNEXT_ORIGIN"), destination: required("ERPNEXT_DESTINATION"), carrier: String(rate.provider || "Shippo"), label: `${rate.provider || "Carrier"} ${((rate.servicelevel as Record<string, unknown>)?.name || "rate")}`, capacityUnits: units, departsAt: now(), arrivesAt: arrives, costDeltaPct: 0, delayHours: days * 24 };
  });
}
function result(operation: Operation) { return { stageId: operation.stageId, resultId: operation.resultId, status: operation.status, expiresAt: operation.expiresAt, persisted: true }; }
function operationFor(partner: Partner, req: Request) {
  const relay = (req as Request & { relayContext: Context }).relayContext;
  const approval = relay.approval;
  if (!approval || !["execute", "release"].includes(relay.scope)) throw Object.assign(new Error("APPROVAL_REQUIRED"), { status: 403 });
  return { relay, approval };
}
async function stage(partner: Partner, req: Request, res: Response) {
  const { relay, approval } = operationFor(partner, req);
  const existing = load(approval.transactionId, relay.sub);
  if (existing) return res.json(result(existing));
  if (Date.parse(approval.expiresAt) <= Date.now()) return error(res, 409, "APPROVAL_EXPIRED", "Refresh the plan and approve again");
  let provider: Record<string, unknown> = {};
  if (partner === "buyer") {
    const current = await buyerOrder(approval.order.id);
    if (current.revision !== approval.order.revision || current.status !== "open") return error(res, 409, "ORDER_CHANGED", "ERPNext sales order changed after planning");
    provider = { salesOrder: current.id };
  } else if (partner === "supplier") {
    const available = await lots(approval.order.sku, approval.order.origin);
    for (const allocation of approval.candidate.inventoryAllocations) {
      const lot = available.find((value) => value.id === allocation.lotId);
      if (!lot || allocation.quantity > lot.availableUnits) return error(res, 409, "INSUFFICIENT_STOCK", `ERPNext stock changed for ${allocation.lotId}`);
    }
    const method = process.env.ERPNEXT_RESERVE_METHOD;
    if (!method) return error(res, 501, "ERP_RESERVATION_MAPPING_REQUIRED", "Set ERPNEXT_RESERVE_METHOD to an atomic ERPNext stock-reservation method before staging supplier inventory");
    const reservation = await erpMethod(method, {
      transactionId: approval.transactionId,
      idempotencyKey: `${approval.transactionId}:supplier:stage`,
      allocations: approval.candidate.inventoryAllocations,
      expiresAt: approval.expiresAt,
    });
    if (!reservation.reservationId) return error(res, 502, "ERP_RESERVATION_UNCONFIRMED", "ERPNext reservation method did not return reservationId");
    provider = { allocations: approval.candidate.inventoryAllocations, reservationId: reservation.reservationId };
  } else {
    const quote = parseRoute(approval.candidate.routeId);
    provider = { ...quote, units: approval.order.quantity };
  }
  const operation: Operation = { transactionId: approval.transactionId, owner: relay.sub, partner, stageId: `${partner}-${randomUUID()}`, status: "staged", expiresAt: approval.expiresAt, approval, provider, updatedAt: now() };
  return res.json(result(save(operation, "stage")));
}
async function commit(partner: Partner, req: Request, res: Response) {
  const { relay, approval } = operationFor(partner, req);
  const operation = load(approval.transactionId, relay.sub);
  if (!operation || operation.partner !== partner || operation.stageId !== req.body.stageId) return error(res, 404, "STAGE_NOT_FOUND", "Stage does not match this provider operation");
  if (operation.status === "committed") return res.json(result(operation));
  if (operation.status !== "staged" || Date.parse(operation.expiresAt) <= Date.now()) return error(res, 409, "STAGE_EXPIRED", "Stage is no longer committable");
  if (partner === "buyer") {
    const field = process.env.ERPNEXT_RELAYROOM_STATUS_FIELD;
    if (!field) return error(res, 501, "PROVIDER_WRITE_MAPPING_REQUIRED", "Set ERPNEXT_RELAYROOM_STATUS_FIELD to a custom Sales Order field before committing buyer changes");
    await erp(`/api/resource/Sales%20Order/${encodeURIComponent(approval.order.id)}`, { method: "PUT", body: JSON.stringify({ [field]: "Resolved by RelayRoom" }) });
    operation.provider = { ...operation.provider, salesOrder: approval.order.id };
  } else if (partner === "supplier") {
    const method = process.env.ERPNEXT_COMMIT_RESERVATION_METHOD;
    if (!method) return error(res, 501, "ERP_RESERVATION_MAPPING_REQUIRED", "Set ERPNEXT_COMMIT_RESERVATION_METHOD to commit the staged ERPNext reservation");
    const committed = await erpMethod(method, {
      transactionId: approval.transactionId,
      idempotencyKey: `${approval.transactionId}:supplier:commit`,
      reservationId: operation.provider?.reservationId,
    });
    if (!committed.resultId) return error(res, 502, "ERP_COMMIT_UNCONFIRMED", "ERPNext commit method did not return resultId");
    operation.provider = { ...operation.provider, resultId: committed.resultId };
    operation.resultId = String(committed.resultId);
  } else {
    const transaction = await shippo("/transactions/", { method: "POST", body: JSON.stringify({ rate: operation.provider?.rate, label_file_type: "PDF" }) });
    operation.provider = { ...operation.provider, shippoTransaction: transaction.object_id, labelUrl: transaction.label_url };
    operation.resultId = String(transaction.object_id);
  }
  operation.status = "committed";
  if (!operation.resultId) operation.resultId = `${partner}-erpnext-${randomUUID()}`;
  return res.json(result(save(operation, "commit")));
}
async function release(partner: Partner, req: Request, res: Response) {
  const { relay, approval } = operationFor(partner, req);
  const operation = load(approval.transactionId, relay.sub) || { transactionId: approval.transactionId, owner: relay.sub, partner, stageId: `${partner}-cancelled-${randomUUID()}`, status: "released" as const, expiresAt: approval.expiresAt, approval, updatedAt: now() };
  if (operation.status === "released") return res.json(result(operation));
  if (partner === "carrier" && operation.provider?.shippoTransaction) {
    const refund = await shippo("/refunds/", { method: "POST", body: JSON.stringify({ transaction: operation.provider.shippoTransaction }) });
    operation.provider = { ...operation.provider, refund: refund.object_id };
  }
  if (partner === "supplier" && operation.provider?.reservationId) {
    const method = process.env.ERPNEXT_RELEASE_RESERVATION_METHOD;
    if (!method) return error(res, 501, "ERP_RESERVATION_MAPPING_REQUIRED", "Set ERPNEXT_RELEASE_RESERVATION_METHOD to release the staged ERPNext reservation");
    const released = await erpMethod(method, {
      transactionId: approval.transactionId,
      idempotencyKey: `${approval.transactionId}:supplier:rollback`,
      reservationId: operation.provider.reservationId,
    });
    if (released.released !== true) return error(res, 502, "ERP_RELEASE_UNCONFIRMED", "ERPNext release method did not confirm released=true");
  }
  if (partner === "buyer" && operation.status === "committed") return error(res, 409, "MANUAL_RECONCILIATION_REQUIRED", "Revert the ERPNext custom order status manually, then record the reconciliation");
  operation.status = "released";
  return res.json(result(save(operation, "release")));
}

export function createProviderAdapter() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use(protectedRoute);
  app.get("/health", async (_req, res) => {
    try { await erp("/api/method/frappe.auth.get_logged_user"); res.json({ ok: true, erpnext: "reachable", shippo: "configured" }); }
    catch { error(res, 502, "ERPNEXT_UNREACHABLE", "ERPNext did not confirm its health"); }
  });
  app.get("/buyer/api/records", async (_req, res) => res.json({ records: await buyerOrders() }));
  app.get("/buyer/api/cases/:caseId/constraints", async (req, res) => { const order = await buyerOrder(req.params.caseId); res.json({ ...order, caseId: order.id, source: "erpnext" }); });
  app.get("/supplier/api/records", async (_req, res) => res.json({ records: [] }));
  app.get("/supplier/api/inventory/:sku/options", async (req, res) => res.json({ options: await lots(req.params.sku, typeof req.query.location === "string" ? req.query.location : undefined), source: "erpnext" }));
  app.get("/carrier/api/records", (_req, res) => res.json({ records: [] }));
  app.get("/carrier/api/routes/options", async (req, res) => res.json({ options: await shippoRoutes(Number(req.query.units || 1)), source: "shippo-test" }));
  for (const partner of ["buyer", "supplier", "carrier"] as Partner[]) {
    const actions = partner === "buyer" ? ["order", "rollback"] : partner === "supplier" ? ["inventory", "release"] : ["routes", "cancel"];
    app.post(`/${partner}/api/${actions[0]}/stage`, (req, res) => stage(partner, req, res).catch((e) => error(res, e.status || 502, e.message || "PROVIDER_ERROR", "Provider stage failed")));
    app.post(`/${partner}/api/${actions[0]}/commit`, (req, res) => commit(partner, req, res).catch((e) => error(res, e.status || 502, e.message || "PROVIDER_ERROR", "Provider commit failed")));
    app.post(`/${partner}/api/${actions[0]}/${actions[1]}`, (req, res) => release(partner, req, res).catch((e) => error(res, e.status || 502, e.message || "PROVIDER_ERROR", "Provider release failed")));
    app.get(`/${partner}/api/transactions/:id`, (req, res) => { const relay = (req as unknown as Request & { relayContext: Context }).relayContext; res.json({ operation: load(req.params.id, relay.sub) || null }); });
    app.get(`/${partner}/api/audit`, (req, res) => {
      const relay = (req as Request & { relayContext: Context }).relayContext;
      const target = String(req.query.transactionId || "");
      if (!target) return error(res, 400, "TRANSACTION_REQUIRED", "Specify a transaction ID");
      try { load(target, relay.sub); } catch { return error(res, 403, "FORBIDDEN", "Transaction belongs to another operator"); }
      const events = db.prepare("SELECT * FROM provider_audit WHERE target=? ORDER BY id").all(target);
      return res.json({ events });
    });
    app.post(`/${partner}/api/records`, (_req, res) => error(res, 501, "PROVIDER_OWNS_CATALOG", "Create operational records in ERPNext or Shippo, not RelayRoom"));
  }
  app.use((errorValue: unknown, _req: Request, res: Response, _next: unknown) => error(res, 500, "INTERNAL_ERROR", errorValue instanceof Error ? errorValue.message : "Provider adapter failed"));
  return app;
}
if (process.argv[1]?.endsWith("provider-adapter.ts"))
  createProviderAdapter().listen(port, () => console.log(`RelayRoom provider adapter listening on http://localhost:${port}`));
