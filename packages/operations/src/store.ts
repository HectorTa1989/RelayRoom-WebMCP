import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  orderInputSchema,
  lotInputSchema,
  routeInputSchema,
  type ExecutionApproval,
  type LotRecord,
  type OperationRecord,
  type OrderRecord,
  type Partner,
  type RouteRecord,
} from "@relayroom/contracts";

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export function requireRule(
  ok: unknown,
  code: string,
  message: string,
  status = 409,
): asserts ok {
  if (!ok) throw new DomainError(code, message, status);
}
export function openDatabase(
  name: string,
  directory = process.env.RELAYROOM_DATA_DIR ||
    path.resolve(process.cwd(), "../../.data"),
) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, `${name}.sqlite`));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
  );
  return db;
}
type Resource = OrderRecord | LotRecord | RouteRecord;
export class PartnerStore {
  constructor(
    readonly partner: Partner,
    readonly db: DatabaseSync,
    private now = () => Date.now(),
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, at TEXT NOT NULL);`);
  }
  atomic<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  audit(actor: string, action: string, target: string) {
    this.db
      .prepare("INSERT INTO audit(actor, action, target, at) VALUES (?,?,?,?)")
      .run(actor, action, target, new Date(this.now()).toISOString());
  }
  list<T extends Resource>(): T[] {
    return (
      this.db.prepare("SELECT payload FROM resources ORDER BY id").all() as {
        payload: string;
      }[]
    ).map((x) => JSON.parse(x.payload));
  }
  get<T extends Resource>(id: string): T {
    const row = this.db
      .prepare("SELECT payload FROM resources WHERE id=?")
      .get(id) as { payload: string } | undefined;
    requireRule(row, "RECORD_NOT_FOUND", `Record ${id} does not exist`, 404);
    return JSON.parse(row.payload);
  }
  private put(record: Resource) {
    this.db
      .prepare("UPDATE resources SET payload=? WHERE id=?")
      .run(JSON.stringify(record), record.id);
  }
  createBatch(inputs: unknown[], actor: string) {
    const records = inputs.map((input) =>
      this.partner === "buyer"
        ? {
            ...orderInputSchema.parse(input),
            revision: 1,
            status: "open",
            arrivals: [],
          }
        : this.partner === "supplier"
          ? lotInputSchema.parse(input)
          : routeInputSchema.parse(input),
    );
    return this.atomic(() => {
      for (const record of records) {
        requireRule(
          !this.db
            .prepare("SELECT id FROM resources WHERE id=?")
            .get(record.id),
          "DUPLICATE_ID",
          `Record ${record.id} already exists`,
        );
        this.db
          .prepare("INSERT INTO resources VALUES (?,?)")
          .run(record.id, JSON.stringify(record));
        this.audit(actor, "create", record.id);
      }
      return records;
    });
  }
  private operations(): OperationRecord[] {
    return (
      this.db.prepare("SELECT payload FROM operations").all() as {
        payload: string;
      }[]
    ).map((x) => JSON.parse(x.payload));
  }
  operation(id: string, owner: string) {
    const row = this.db
      .prepare("SELECT owner,payload FROM operations WHERE id=?")
      .get(id) as { owner: string; payload: string } | undefined;
    requireRule(
      !row || row.owner === owner,
      "FORBIDDEN",
      "Transaction belongs to another operator",
      403,
    );
    return row ? (JSON.parse(row.payload) as OperationRecord) : undefined;
  }
  private save(operation: OperationRecord) {
    operation.updatedAt = new Date(this.now()).toISOString();
    this.db
      .prepare(
        "INSERT INTO operations VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(operation.transactionId, operation.owner, JSON.stringify(operation));
  }
  private active() {
    return this.operations().filter(
      (x) =>
        x.status === "committed" ||
        (x.status === "staged" && Date.parse(x.expiresAt) > this.now()),
    );
  }
  lots(sku: string, location?: string): LotRecord[] {
    const active = this.active();
    return this.list<LotRecord>()
      .filter(
        (lot) => lot.sku === sku && (!location || lot.location === location),
      )
      .map((lot) => ({
        ...lot,
        availableUnits:
          lot.availableUnits -
          active.reduce(
            (sum, op) =>
              sum +
              op.approval.candidate.inventoryAllocations
                .filter((a) => a.lotId === lot.id)
                .reduce((n, a) => n + a.quantity, 0),
            0,
          ),
      }));
  }
  routes(origin: string, destination: string): RouteRecord[] {
    const active = this.active();
    return this.list<RouteRecord>()
      .filter(
        (route) =>
          route.origin === origin &&
          route.destination === destination &&
          Date.parse(route.departsAt) > this.now(),
      )
      .map((route) => ({
        ...route,
        capacityUnits:
          route.capacityUnits -
          active
            .filter((op) => op.approval.candidate.routeId === route.id)
            .reduce((sum, op) => sum + op.approval.order.quantity, 0),
      }));
  }
  stage(approval: ExecutionApproval, owner: string): OperationRecord {
    return this.atomic(() => {
      const existing = this.operation(approval.transactionId, owner);
      if (existing) {
        requireRule(
          JSON.stringify(existing.approval) === JSON.stringify(approval),
          "IDEMPOTENCY_CONFLICT",
          "Transaction approval changed",
        );
        requireRule(
          existing.status === "committed" ||
            (existing.status === "staged" &&
              Date.parse(existing.expiresAt) > this.now()),
          "STAGE_CLOSED",
          "Reservation was released or expired. Create a new plan.",
        );
        return existing;
      }
      requireRule(
        Date.parse(approval.expiresAt) > this.now(),
        "APPROVAL_EXPIRED",
        "Refresh the plan and approve again",
      );
      const { order, candidate } = approval;
      requireRule(
        candidate.totalUnits === order.quantity &&
          Date.parse(candidate.arrivesAt) <= Date.parse(order.neededBy) &&
          candidate.addedLogisticsCostPct <= order.maxAddedLogisticsCostPct,
        "INVALID_APPROVAL",
        "Approved plan violates order limits",
      );
      if (this.partner === "buyer") {
        const current = this.get<OrderRecord>(order.id);
        requireRule(
          current.revision === order.revision && current.status === "open",
          "ORDER_CHANGED",
          "Order changed after planning",
        );
        requireRule(
          !this.active().some((op) => op.approval.order.id === order.id),
          "ORDER_LOCKED",
          "Another recovery owns this order",
        );
      }
      if (this.partner === "supplier") {
        const lots = this.lots(order.sku, order.origin);
        requireRule(
          new Set(candidate.inventoryAllocations.map((x) => x.lotId)).size ===
            candidate.inventoryAllocations.length &&
            candidate.inventoryAllocations.reduce(
              (n, x) => n + x.quantity,
              0,
            ) === order.quantity,
          "INVALID_ALLOCATION",
          "Allocation must total the order exactly",
        );
        for (const item of candidate.inventoryAllocations) {
          const lot = lots.find((x) => x.id === item.lotId);
          requireRule(
            lot &&
              Number.isInteger(item.quantity) &&
              item.quantity >= lot.minReservation &&
              item.quantity <= lot.availableUnits,
            "INSUFFICIENT_STOCK",
            `Lot ${item.lotId} cannot supply the requested quantity`,
          );
          requireRule(
            Date.parse(lot.readyAt) <= Date.parse(candidate.arrivesAt),
            "LOT_NOT_READY",
            "Inventory is not ready for this arrival",
          );
        }
      }
      if (this.partner === "carrier") {
        const route = this.routes(order.origin, order.destination).find(
          (x) => x.id === candidate.routeId,
        );
        requireRule(
          route && route.capacityUnits >= order.quantity,
          "INSUFFICIENT_CAPACITY",
          "Route capacity is no longer available",
        );
        requireRule(
          route.arrivesAt === candidate.arrivesAt &&
            route.costDeltaPct === candidate.addedLogisticsCostPct,
          "QUOTE_CHANGED",
          "Route ETA or price changed",
        );
      }
      const operation: OperationRecord = {
        transactionId: approval.transactionId,
        owner,
        stageId: `${this.partner}-${randomUUID()}`,
        status: "staged",
        expiresAt: approval.expiresAt,
        approval,
        updatedAt: "",
      };
      this.save(operation);
      this.audit(owner, "stage", operation.transactionId);
      return operation;
    });
  }
  commit(
    approval: ExecutionApproval,
    owner: string,
    stageId: string,
  ): OperationRecord {
    return this.atomic(() => {
      const op = this.operation(approval.transactionId, owner);
      requireRule(
        op && op.stageId === stageId,
        "STAGE_NOT_FOUND",
        "Stage does not belong to this approval",
        404,
      );
      if (op.status === "committed") return op;
      requireRule(
        op.status === "staged" && Date.parse(op.expiresAt) > this.now(),
        "STAGE_EXPIRED",
        "Reservation is no longer committable",
      );
      if (this.partner === "carrier") {
        requireRule(
          Date.parse(
            this.get<RouteRecord>(approval.candidate.routeId).departsAt,
          ) > this.now(),
          "ROUTE_DEPARTED",
          "The departure window closed",
        );
        requireRule(
          !approval.rehearsal,
          "REHEARSAL_FAILURE",
          "Carrier rejection rehearsal",
        );
      }
      if (this.partner === "buyer") {
        const current = this.get<OrderRecord>(approval.order.id);
        requireRule(
          current.revision === approval.order.revision &&
            current.status === "open",
          "ORDER_CHANGED",
          "Buyer order changed before commit",
        );
        this.put({
          ...current,
          revision: current.revision + 1,
          status: "resolved",
          arrivals: [
            {
              quantity: current.quantity,
              arrivesAt: approval.candidate.arrivesAt,
            },
          ],
        });
      }
      op.status = "committed";
      op.resultId = `${this.partner}-confirmed-${randomUUID()}`;
      this.save(op);
      this.audit(owner, "commit", op.transactionId);
      return op;
    });
  }
  release(approval: ExecutionApproval, owner: string): OperationRecord {
    return this.atomic(() => {
      const existing = this.operation(approval.transactionId, owner);
      if (existing?.status === "released") return existing;
      if (existing?.status === "committed" && this.partner === "buyer") {
        const current = this.get<OrderRecord>(approval.order.id);
        requireRule(
          current.revision === approval.order.revision + 1,
          "MANUAL_RECONCILIATION_REQUIRED",
          "A subsequent order revision prevents automatic restoration",
        );
        this.put({ ...approval.order, revision: current.revision + 1 });
      }
      // Persist a tombstone even for a request whose stage response was lost or never arrived.
      const op: OperationRecord = existing ?? {
        transactionId: approval.transactionId,
        owner,
        stageId: `${this.partner}-cancelled-${randomUUID()}`,
        status: "released",
        expiresAt: approval.expiresAt,
        approval,
        updatedAt: "",
      };
      op.status = "released";
      this.save(op);
      this.audit(owner, "release", op.transactionId);
      return op;
    });
  }
}
