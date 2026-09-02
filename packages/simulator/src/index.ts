import type {
  BuyerConstraints,
  InventoryOption,
  RecoveryCandidate,
  RollbackStep,
  StagedTransaction,
  TransactionStep,
} from "@relayroom/contracts";

const MS_PER_HOUR = 3_600_000;

// Reachable integer ranges allow exact allocation without iterating every unit.
type Range = [number, number];
function mergeRanges(ranges: Range[], cap: number): Range[] {
  const result: Range[] = [];
  for (const [lo, hi] of ranges.sort((a, b) => a[0] - b[0])) {
    if (lo > cap) continue;
    const last = result.at(-1);
    if (last && lo <= last[1] + 1)
      last[1] = Math.max(last[1], Math.min(hi, cap));
    else result.push([lo, Math.min(hi, cap)]);
  }
  if (result.length > 10000) throw new Error("ALLOCATION_COMPLEXITY_LIMIT");
  return result;
}

function allocate(lots: InventoryOption[], quantity: number) {
  const suffix: Range[][] = Array.from({ length: lots.length + 1 }, () => []);
  suffix[lots.length] = [[0, 0]];
  for (let i = lots.length - 1; i >= 0; i--) {
    const lot = lots[i];
    suffix[i] = mergeRanges(
      [
        ...suffix[i + 1],
        ...suffix[i + 1].map(([a, b]): Range => [
          a + lot.minReservation,
          b + lot.availableUnits,
        ]),
      ],
      quantity,
    );
  }
  if (!suffix[0].some(([a, b]) => a <= quantity && quantity <= b))
    return undefined;
  let remaining = quantity;
  return lots.flatMap((lot, i) => {
    let take = 0;
    for (const [a, b] of suffix[i + 1]) {
      const high = Math.min(lot.availableUnits, remaining - a);
      const low = Math.max(lot.minReservation, remaining - b);
      if (high >= low) take = Math.max(take, high);
    }
    remaining -= take;
    return take
      ? [{ lotId: lot.id, supplier: lot.supplier, quantity: take }]
      : [];
  });
}

export function solveRecoveryPlan(
  constraints: BuyerConstraints,
  inventory: InventoryOption[],
  routes: Array<{
    id: string;
    label: string;
    capacityUnits: number;
    arrivesAt: string;
    costDeltaPct: number;
    departsAt?: string;
  }>,
): RecoveryCandidate[] {
  return routes
    .map((route, index): RecoveryCandidate => {
      const lots = inventory
        .filter(
          (lot) =>
            lot.availableUnits >= lot.minReservation &&
            Date.parse(lot.readyAt) <=
              Date.parse(route.departsAt ?? route.arrivesAt),
        )
        .sort(
          (a, b) =>
            (a.source === "original" ? 0 : 1) -
              (b.source === "original" ? 0 : 1) ||
            a.unitCostDeltaPct - b.unitCostDeltaPct ||
            a.id.localeCompare(b.id),
        );
      const allocations = allocate(lots, constraints.quantity);
      const violations: string[] = [];
      const arrives = new Date(route.arrivesAt).getTime();
      const deadline = new Date(constraints.neededBy).getTime();

      if (!allocations)
        violations.push(
          "No exact inventory allocation satisfies availability, readiness, and minimum lot rules",
        );
      if (route.capacityUnits < constraints.quantity)
        violations.push("Route capacity exceeded");
      // This solver proposes one arrival, so allowing a late split cannot permit the entire order to arrive late.
      if (arrives > deadline) violations.push("Arrival misses order deadline");
      if (!Number.isFinite(arrives) || !Number.isFinite(deadline))
        violations.push("Invalid arrival or deadline");
      if (route.costDeltaPct > constraints.maxAddedLogisticsCostPct)
        violations.push("Logistics cost exceeds buyer cap");

      const hoursBeforeDeadline = Math.round(
        (deadline - arrives) / MS_PER_HOUR,
      );
      const feasible = violations.length === 0;
      const score = feasible
        ? 100 - route.costDeltaPct + Math.min(hoursBeforeDeadline, 24) / 24
        : -violations.length * 25;

      return {
        id: `CANDIDATE-${index + 1}`,
        name: route.label,
        inventoryAllocations: allocations ?? [],
        routeId: route.id,
        arrivesAt: route.arrivesAt,
        totalUnits:
          allocations?.reduce((sum, item) => sum + item.quantity, 0) ?? 0,
        addedLogisticsCostPct: route.costDeltaPct,
        hoursBeforeDeadline,
        feasible,
        violations,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function createTransaction(
  candidate: RecoveryCandidate,
  now = new Date(),
  caseId = "unassigned",
): StagedTransaction {
  const steps: TransactionStep[] = [
    {
      id: "STEP-SUPPLIER",
      order: 1,
      origin: "supplier",
      stageTool: "stage_inventory_hold",
      commitTool: "commit_inventory_hold",
      label: "Reserve selected inventory lots",
      status: "pending",
    },
    {
      id: "STEP-CARRIER",
      order: 2,
      origin: "carrier",
      stageTool: "stage_route_booking",
      commitTool: "commit_route_booking",
      label: "Book selected route",
      status: "pending",
    },
    {
      id: "STEP-BUYER",
      order: 3,
      origin: "buyer",
      stageTool: "stage_order_revision",
      commitTool: "commit_order_revision",
      label: "Publish revised buyer order",
      status: "pending",
    },
  ];

  const rollback: RollbackStep[] = [
    {
      id: "ROLLBACK-BUYER",
      origin: "buyer",
      tool: "rollback_order_revision",
      label: "Restore buyer revision",
      status: "pending",
    },
    {
      id: "ROLLBACK-CARRIER",
      origin: "carrier",
      tool: "cancel_route_booking",
      label: "Cancel route booking",
      status: "pending",
    },
    {
      id: "ROLLBACK-SUPPLIER",
      origin: "supplier",
      tool: "release_inventory_hold",
      label: "Release inventory holds",
      status: "pending",
    },
  ];

  return {
    id: `TX-${crypto.randomUUID()}`,
    caseId,
    candidateId: candidate.id,
    createdAt: now.toISOString(),
    status: "draft",
    steps,
    rollback,
  };
}

export function idempotentResult<T>(
  store: Map<string, T>,
  key: string,
  factory: () => T,
): T {
  const existing = store.get(key);
  if (existing) return existing;
  const result = factory();
  store.set(key, result);
  return result;
}

export type TransactionCommand = {
  step: TransactionStep;
  phase: "stage" | "commit" | "rollback";
  tool: string;
};

export type TransactionRunner = (
  command: TransactionCommand,
) => Promise<{ id: string }>;

/**
 * Purely coordinates order and state; the caller owns all origin-scoped tool execution.
 * Stages every partner first, then commits supplier → carrier → buyer. On failure it
 * compensates every possibly staged origin, including ambiguous network results.
 */
export async function executeCoordinatedTransaction(
  initial: StagedTransaction,
  run: TransactionRunner,
): Promise<StagedTransaction> {
  const transaction = structuredClone(initial);
  transaction.status = "staging";
  const compensate = async () => {
    transaction.status = "rolling-back";
    let failed = false;
    for (const step of [...transaction.steps].reverse()) {
      const rollback = transaction.rollback.find(
        (item) => item.origin === step.origin,
      )!;
      try {
        rollback.status = "running";
        await run({ step, phase: "rollback", tool: rollback.tool });
        rollback.status = "rolled-back";
        step.status = "rolled-back";
      } catch {
        rollback.status = "failed";
        failed = true;
      }
    }
    transaction.status = failed ? "failed" : "rolled-back";
    return transaction;
  };

  try {
    for (const step of transaction.steps) {
      step.status = "running";
      const result = await run({ step, phase: "stage", tool: step.stageTool });
      step.stageId = result.id;
      step.status = "succeeded";
    }
    transaction.status = "staged";
  } catch {
    return compensate();
  }

  transaction.status = "committing";
  try {
    for (const step of transaction.steps) {
      step.status = "running";
      const result = await run({
        step,
        phase: "commit",
        tool: step.commitTool,
      });
      step.resultId = result.id;
      step.status = "succeeded";
    }
    transaction.status = "committed";
    return transaction;
  } catch {
    return compensate();
  }
}
