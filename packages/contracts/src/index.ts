import { z } from 'zod';
export * from './operations';

export const partnerKinds = ['buyer', 'supplier', 'carrier', 'room'] as const;
export type PartnerKind = (typeof partnerKinds)[number];

export type PartnerOrigin = {
  id: PartnerKind;
  name: string;
  origin: string;
  color: string;
};

export type ExceptionCase = {
  id: string;
  sku: string;
  productName: string;
  quantity: number;
  neededBy: string;
  destination: string;
  maxAddedLogisticsCostPct: number;
  allowLateSplit: boolean;
  status: 'open' | 'planning' | 'staged' | 'committing' | 'resolved' | 'rolled-back';
};

export type ConstraintEvidence = {
  id: string;
  origin: Exclude<PartnerKind, 'room'>;
  label: string;
  value: string;
  detail: string;
  severity: 'info' | 'warning' | 'positive';
  observedAt: string;
  untrustedNote?: string;
};

export type InventoryOption = {
  sku?: string;
  location?: string;
  id: string;
  supplier: string;
  availableUnits: number;
  minReservation: number;
  readyAt: string;
  unitCostDeltaPct: number;
  source: 'original' | 'backup';
};

export type RouteOption = {
  origin?: string;
  destination?: string;
  departsAt?: string;
  id: string;
  carrier: string;
  label: string;
  capacityUnits: number;
  arrivesAt: string;
  costDeltaPct: number;
  delayHours: number;
};

export type RecoveryCandidate = {
  id: string;
  name: string;
  inventoryAllocations: Array<{
    lotId: string;
    supplier: string;
    quantity: number;
  }>;
  routeId: string;
  arrivesAt: string;
  totalUnits: number;
  addedLogisticsCostPct: number;
  hoursBeforeDeadline: number;
  feasible: boolean;
  violations: string[];
  score: number;
};

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'rolled-back' | 'skipped';

export type TransactionStep = {
  id: string;
  order: number;
  origin: Exclude<PartnerKind, 'room'>;
  stageTool: string;
  commitTool: string;
  label: string;
  status: StepStatus;
  stageId?: string;
  resultId?: string;
};

export type RollbackStep = {
  id: string;
  origin: Exclude<PartnerKind, 'room'>;
  tool: string;
  label: string;
  status: StepStatus;
};

export type StagedTransaction = {
  id: string;
  caseId: string;
  candidateId: string;
  createdAt: string;
  approvedAt?: string;
  status: 'draft' | 'staging' | 'staged' | 'committing' | 'committed' | 'failed' | 'rolling-back' | 'rolled-back';
  steps: TransactionStep[];
  rollback: RollbackStep[];
};

export type ToolAuditEvent = {
  id: string;
  transactionId?: string;
  tool: string;
  origin: string;
  inputSummary: string;
  result: 'success' | 'error' | 'cancelled';
  resultSummary: string;
  timestamp: string;
};

export type BuyerConstraints = {
  caseId: string;
  quantity: number;
  neededBy: string;
  maxAddedLogisticsCostPct: number;
  allowLateSplit: boolean;
  destination: string;
};

export type RecoveryPlanningRequest = {
  objective: string;
  constraints: BuyerConstraints;
  inventory: InventoryOption[];
  routes: RouteOption[];
};

export type RecoveryPlanningResponse = {
  source: 'openai' | 'gemini' | 'deterministic';
  model?: string;
  candidates: RecoveryCandidate[];
  selectedCandidateId: string;
  narrative: string;
  fallbackReason?: string;
};

export type PartnerToolResult<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; retryable: boolean };
};

export const identifierSchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/);
export const caseIdSchema = z.object({ caseId: identifierSchema });
export const inventoryQuerySchema = z.object({
  sku: identifierSchema,
  neededBy: z.string().datetime(),
});
export const routeQuerySchema = z.object({
  origin: z.string().min(2),
  destination: z.string().min(2),
  units: z.number().int().positive().max(10000000),
});

export const jsonSchemas = {
  caseId: {
    type: 'object',
    properties: { caseId: { type: 'string', minLength: 1 } },
    required: ['caseId'],
    additionalProperties: false,
  },
  inventoryQuery: {
    type: 'object',
    properties: {
      sku: { type: 'string', minLength: 1 },
      neededBy: { type: 'string', format: 'date-time' },
    },
    required: ['sku', 'neededBy'],
    additionalProperties: false,
  },
  routeQuery: {
    type: 'object',
    properties: {
      origin: { type: 'string' },
      destination: { type: 'string' },
      units: { type: 'integer', minimum: 1, maximum: 10000000 },
    },
    required: ['origin', 'destination', 'units'],
    additionalProperties: false,
  },
} as const;

export const HERO_PROMPT =
  "Resolve CASE-1047 without missing Friday's deadline and keep added logistics cost below 10%. Show me the plan before anything is committed.";

export const seedCase: ExceptionCase = {
  id: 'CASE-1047',
  sku: 'SM-480',
  productName: 'OptiSense sensor module',
  quantity: 480,
  neededBy: '2026-09-04T16:00:00.000Z',
  destination: 'Austin assembly plant',
  maxAddedLogisticsCostPct: 10,
  allowLateSplit: false,
  status: 'open',
};

export const seedBuyerConstraints: BuyerConstraints = {
  caseId: seedCase.id,
  quantity: seedCase.quantity,
  neededBy: seedCase.neededBy,
  maxAddedLogisticsCostPct: seedCase.maxAddedLogisticsCostPct,
  allowLateSplit: seedCase.allowLateSplit,
  destination: seedCase.destination,
};

export const seedInventory: InventoryOption[] = [
  {
    id: 'LOT-NORTHSTAR-310',
    supplier: 'Northstar Components',
    availableUnits: 310,
    minReservation: 1,
    readyAt: '2026-09-02T08:00:00.000Z',
    unitCostDeltaPct: 0,
    source: 'original',
  },
  {
    id: 'LOT-APEX-220',
    supplier: 'Apex Reserve',
    availableUnits: 220,
    minReservation: 150,
    readyAt: '2026-09-02T12:00:00.000Z',
    unitCostDeltaPct: 2.2,
    source: 'backup',
  },
];

export const seedRoutes: RouteOption[] = [
  {
    id: 'ROUTE-GROUND-17',
    carrier: 'Vector Freight',
    label: 'Original ground lane',
    capacityUnits: 600,
    arrivesAt: '2026-09-06T04:00:00.000Z',
    costDeltaPct: 0,
    delayHours: 36,
  },
  {
    id: 'ROUTE-PRIORITY-8',
    carrier: 'Vector Freight',
    label: 'Priority air relay',
    capacityUnits: 520,
    arrivesAt: '2026-09-04T04:00:00.000Z',
    costDeltaPct: 8,
    delayHours: -12,
  },
];

export const makeOrigins = (roomOrigin = 'http://localhost:4173'): PartnerOrigin[] => [
  { id: 'room', name: 'RelayRoom', origin: roomOrigin, color: '#171717' },
  { id: 'buyer', name: 'Atlas Buyer', origin: importMetaEnv('VITE_BUYER_ORIGIN', 'http://localhost:4174'), color: '#5e5ce6' },
  { id: 'supplier', name: 'Northstar Supply', origin: importMetaEnv('VITE_SUPPLIER_ORIGIN', 'http://localhost:4175'), color: '#bf5af2' },
  { id: 'carrier', name: 'Vector Freight', origin: importMetaEnv('VITE_CARRIER_ORIGIN', 'http://localhost:4176'), color: '#ff9f0a' },
];

function importMetaEnv(key: string, fallback: string): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  return env?.[key] || fallback;
}
