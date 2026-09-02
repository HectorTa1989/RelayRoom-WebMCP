import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { ExecutionApproval, OrderRecord } from "@relayroom/contracts";
import { PartnerStore } from "./store";

const now = Date.parse("2030-01-01T00:00:00Z");
const order: OrderRecord = {
  id: "ORDER-73",
  sku: "CUSTOM-PART",
  productName: "Custom part",
  quantity: 73,
  origin: "Depot A",
  destination: "Factory B",
  neededBy: "2030-01-04T00:00:00Z",
  maxAddedLogisticsCostPct: 15,
  allowLateSplit: false,
  revision: 1,
  status: "open",
  arrivals: [],
};
const approval = (id = "tx-one"): ExecutionApproval => ({
  transactionId: id,
  order,
  candidate: {
    id: "candidate",
    name: "Road",
    routeId: "road",
    arrivesAt: "2030-01-03T00:00:00Z",
    totalUnits: 73,
    addedLogisticsCostPct: 7,
    hoursBeforeDeadline: 24,
    feasible: true,
    score: 95,
    violations: [],
    inventoryAllocations: [{ lotId: "lot", supplier: "Factory", quantity: 73 }],
  },
  approvedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 900000).toISOString(),
  rehearsal: false,
});
function inventory(clock = () => now) {
  const store = new PartnerStore(
    "supplier",
    new DatabaseSync(":memory:"),
    clock,
  );
  store.createBatch(
    [
      {
        id: "lot",
        sku: order.sku,
        location: order.origin,
        supplier: "Factory",
        availableUnits: 100,
        minReservation: 5,
        readyAt: new Date(now).toISOString(),
        unitCostDeltaPct: 0,
        source: "original",
      },
    ],
    "admin",
  );
  return store;
}
describe("operational reservations", () => {
  it("accounts for holds and commits, rejects overbooking, restores stock exactly once", () => {
    const store = inventory();
    const first = store.stage(approval(), "operator");
    expect(store.lots(order.sku)[0].availableUnits).toBe(27);
    expect(() => store.stage(approval("tx-two"), "operator")).toThrow(
      /cannot supply/,
    );
    expect(store.stage(approval(), "operator").stageId).toBe(first.stageId);
    const committed = store.commit(approval(), "operator", first.stageId);
    expect(store.commit(approval(), "operator", first.stageId).resultId).toBe(
      committed.resultId,
    );
    expect(store.lots(order.sku)[0].availableUnits).toBe(27);
    store.release(approval(), "operator");
    store.release(approval(), "operator");
    expect(store.lots(order.sku)[0].availableUnits).toBe(100);
    expect(() => store.commit(approval(), "operator", first.stageId)).toThrow(
      /no longer/,
    );
    expect(() => store.stage(approval(), "operator")).toThrow(
      /released or expired/,
    );
    store.db.close();
  });
  it("reclaims expired capacity and refuses late commits", () => {
    let clock = now;
    const store = inventory(() => clock);
    const staged = store.stage(approval(), "operator");
    clock += 16 * 60000;
    expect(store.lots(order.sku)[0].availableUnits).toBe(100);
    expect(() => store.commit(approval(), "operator", staged.stageId)).toThrow(
      /no longer/,
    );
    store.db.close();
  });
  it("records cancellation before a delayed stage so it cannot resurrect", () => {
    const store = inventory();
    store.release(approval(), "operator");
    expect(() => store.stage(approval(), "operator")).toThrow(/released/);
    expect(() => store.operation("tx-one", "another-user")).toThrow(
      /another operator/,
    );
    store.db.close();
  });
  it("updates and restores actual order arrivals with monotonically increasing revisions", () => {
    const store = new PartnerStore(
      "buyer",
      new DatabaseSync(":memory:"),
      () => now,
    );
    const { revision, status, arrivals, ...input } = order;
    store.createBatch([input], "admin");
    const staged = store.stage(approval(), "operator");
    store.commit(approval(), "operator", staged.stageId);
    expect(store.get<OrderRecord>(order.id)).toMatchObject({
      status: "resolved",
      revision: 2,
      arrivals: [{ quantity: 73, arrivesAt: approval().candidate.arrivesAt }],
    });
    store.release(approval(), "operator");
    expect(store.get<OrderRecord>(order.id)).toMatchObject({
      status: "open",
      revision: 3,
      arrivals: [],
    });
    store.db.close();
  });
  it("imports atomically and rejects invalid or duplicate records", () => {
    const store = inventory();
    const existing = store.get("lot");
    expect(() =>
      store.createBatch([{ ...existing, id: "new-lot" }, existing], "admin"),
    ).toThrow(/already exists/);
    expect(store.list()).toHaveLength(1);
    expect(() =>
      store.createBatch(
        [{ ...existing, id: "bad", availableUnits: -1 }],
        "admin",
      ),
    ).toThrow();
    store.db.close();
  });
  it("requires exact totals, unique lots, and an unchanged approval on retry", () => {
    const store = inventory();
    const approved = approval();
    store.stage(approved, "operator");
    const changed = structuredClone(approved);
    changed.candidate.inventoryAllocations[0].quantity = 1;
    expect(() => store.stage(changed, "operator")).toThrow(/approval changed/);
    store.db.close();
  });
});
