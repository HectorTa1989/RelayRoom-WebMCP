import { z } from "zod";

const id = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_.-]+$/);
const label = z.string().trim().min(1).max(200);
const units = z.number().int().min(1).max(10000000);
const time = z.string().datetime({ offset: true });
export const arrivalSchema = z
  .object({ quantity: units, arrivesAt: time })
  .strict();
export const orderInputSchema = z
  .object({
    id,
    sku: id,
    productName: label,
    quantity: units,
    neededBy: time,
    origin: label,
    destination: label,
    maxAddedLogisticsCostPct: z.number().min(0).max(1000),
    allowLateSplit: z.boolean().default(false),
  })
  .strict();
export const lotInputSchema = z
  .object({
    id,
    sku: id,
    location: label,
    supplier: label,
    availableUnits: units,
    minReservation: units,
    readyAt: time,
    unitCostDeltaPct: z.number().min(0).max(1000),
    source: z.enum(["original", "backup"]),
  })
  .strict()
  .refine(
    (x) => x.minReservation <= x.availableUnits,
    "Minimum reservation exceeds stock",
  );
export const routeInputSchema = z
  .object({
    id,
    origin: label,
    destination: label,
    carrier: label,
    label,
    capacityUnits: units,
    departsAt: time,
    arrivesAt: time,
    costDeltaPct: z.number().min(0).max(1000),
    delayHours: z.number().default(0),
  })
  .strict()
  .refine(
    (x) => Date.parse(x.departsAt) < Date.parse(x.arrivesAt),
    "Arrival must follow departure",
  );
export const batchSchema = z.array(z.unknown()).min(1).max(100);
export type OrderInput = z.infer<typeof orderInputSchema>;
export type OrderRecord = OrderInput & {
  revision: number;
  status: "open" | "resolved";
  arrivals: z.infer<typeof arrivalSchema>[];
};
export type LotRecord = z.infer<typeof lotInputSchema>;
export type RouteRecord = z.infer<typeof routeInputSchema>;
export const planningInputSchema = z.object({
  objective: z.string().min(1).max(2000),
  constraints: z.object({
    caseId: id,
    quantity: units,
    neededBy: time,
    maxAddedLogisticsCostPct: z.number().min(0).max(1000),
    allowLateSplit: z.boolean(),
    destination: label,
  }),
  inventory: z
    .array(
      z.object({
        id,
        supplier: label,
        availableUnits: z.number().int().min(0).max(10000000),
        minReservation: units,
        readyAt: time,
        unitCostDeltaPct: z.number().min(0).max(1000),
        source: z.enum(["original", "backup"]),
        sku: id.optional(),
        location: label.optional(),
      }),
    )
    .max(100),
  routes: z
    .array(
      z.object({
        id,
        carrier: label,
        label,
        capacityUnits: z.number().int().min(0).max(10000000),
        arrivesAt: time,
        departsAt: time.optional(),
        costDeltaPct: z.number().min(0).max(1000),
        delayHours: z.number(),
        origin: label.optional(),
        destination: label.optional(),
      }),
    )
    .max(100),
});
export type Partner = "buyer" | "supplier" | "carrier";
export type ExecutionApproval = {
  transactionId: string;
  order: OrderRecord;
  candidate: import("./index").RecoveryCandidate;
  approvedAt: string;
  expiresAt: string;
  rehearsal: boolean;
};
export type OperationRecord = {
  transactionId: string;
  owner: string;
  stageId: string;
  resultId?: string;
  status: "staged" | "committed" | "released" | "expired";
  expiresAt: string;
  approval: ExecutionApproval;
  updatedAt: string;
};
