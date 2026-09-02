import { describe, expect, it } from "vitest";
import {
  seedBuyerConstraints,
  seedInventory,
  seedRoutes,
} from "@relayroom/contracts";
import {
  createTransaction,
  executeCoordinatedTransaction,
  idempotentResult,
  solveRecoveryPlan,
} from "./index";

describe("recovery solver", () => {
  it("selects the priority route and exact 480-unit allocation", () => {
    const [winner] = solveRecoveryPlan(
      seedBuyerConstraints,
      seedInventory,
      seedRoutes,
    );
    expect(winner.feasible).toBe(true);
    expect(winner.routeId).toBe("ROUTE-PRIORITY-8");
    expect(winner.totalUnits).toBe(480);
    expect(winner.inventoryAllocations.map((item) => item.quantity)).toEqual([
      310, 170,
    ]);
  });

  it("rejects the original route for missing the deadline", () => {
    const candidates = solveRecoveryPlan(
      seedBuyerConstraints,
      seedInventory,
      seedRoutes,
    );
    const original = candidates.find(
      (candidate) => candidate.routeId === "ROUTE-GROUND-17",
    );
    expect(original?.feasible).toBe(false);
    expect(original?.violations).toContain("Arrival misses order deadline");
  });

  it("rejects a route above the buyer cost cap", () => {
    const routes = [{ ...seedRoutes[1], costDeltaPct: 12 }];
    const [candidate] = solveRecoveryPlan(
      seedBuyerConstraints,
      seedInventory,
      routes,
    );
    expect(candidate.violations).toContain("Logistics cost exceeds buyer cap");
  });

  it("rebalances primary stock to satisfy the backup minimum exactly", () => {
    const inventory = [
      { ...seedInventory[0], availableUnits: 350 },
      seedInventory[1],
    ];
    const [candidate] = solveRecoveryPlan(seedBuyerConstraints, inventory, [
      seedRoutes[1],
    ]);
    expect(candidate.feasible).toBe(true);
    expect(candidate.inventoryAllocations.map((x) => x.quantity)).toEqual([
      330, 150,
    ]);
  });

  it("creates stage-before-commit transaction ordering", () => {
    const [winner] = solveRecoveryPlan(
      seedBuyerConstraints,
      seedInventory,
      seedRoutes,
    );
    const transaction = createTransaction(
      winner,
      new Date("2026-09-01T10:00:00Z"),
    );
    expect(transaction.steps.map((step) => step.origin)).toEqual([
      "supplier",
      "carrier",
      "buyer",
    ]);
    expect(
      transaction.steps.every((step) => step.stageTool.startsWith("stage_")),
    ).toBe(true);
  });

  it("preserves idempotent results", () => {
    const store = new Map<string, { id: string }>();
    const first = idempotentResult(store, "same-key", () => ({ id: "first" }));
    const second = idempotentResult(store, "same-key", () => ({
      id: "second",
    }));
    expect(second).toBe(first);
  });

  it("rolls back the first commit when the second commit fails", async () => {
    const [winner] = solveRecoveryPlan(
      seedBuyerConstraints,
      seedInventory,
      seedRoutes,
    );
    const transaction = createTransaction(
      winner,
      new Date("2026-09-01T10:00:00Z"),
    );
    const calls: string[] = [];
    const result = await executeCoordinatedTransaction(
      transaction,
      async ({ step, phase, tool }) => {
        calls.push(`${phase}:${step.origin}:${tool}`);
        if (phase === "commit" && step.origin === "carrier")
          throw new Error("Seeded carrier failure");
        return { id: `${phase}-${step.id}` };
      },
    );

    expect(result.status).toBe("rolled-back");
    expect(calls).toContain("rollback:supplier:release_inventory_hold");
    expect(calls).not.toContain("commit:buyer:commit_order_revision");
    expect(calls).toContain("rollback:buyer:rollback_order_revision");
    expect(calls).toContain("rollback:carrier:cancel_route_booking");
  });

  it("supports a different SKU quantity from a single lot", () => {
    const [plan] = solveRecoveryPlan(
      { ...seedBuyerConstraints, quantity: 73 },
      [{ ...seedInventory[0], availableUnits: 80 }],
      [seedRoutes[1]],
    );
    expect(plan.feasible).toBe(true);
    expect(plan.totalUnits).toBe(73);
    expect(plan.inventoryAllocations).toHaveLength(1);
  });

  it("rejects stock that is not ready before departure", () => {
    const [plan] = solveRecoveryPlan(seedBuyerConstraints, seedInventory, [
      { ...seedRoutes[1], departsAt: "2026-09-01T00:00:00Z" },
    ]);
    expect(plan.feasible).toBe(false);
  });

  it("does not claim rollback succeeded if any compensation fails", async () => {
    const [plan] = solveRecoveryPlan(
      seedBuyerConstraints,
      seedInventory,
      seedRoutes,
    );
    const calls: string[] = [];
    const result = await executeCoordinatedTransaction(
      createTransaction(plan),
      async ({ step, phase }) => {
        calls.push(`${phase}:${step.origin}`);
        if (
          phase === "commit" ||
          (phase === "rollback" && step.origin === "carrier")
        )
          throw new Error("offline");
        return { id: step.id };
      },
    );
    expect(result.status).toBe("failed");
    expect(calls).toContain("rollback:supplier");
    expect(result.rollback.find((x) => x.origin === "carrier")?.status).toBe(
      "failed",
    );
  });
});
