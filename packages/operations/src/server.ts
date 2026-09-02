import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import path from "node:path";
import {
  batchSchema,
  type ExecutionApproval,
  type Partner,
} from "@relayroom/contracts";
import {
  demoEnabled,
  mintGrant,
  signingKey,
  verifyGrant,
  type Grant,
} from "./security";
import { DomainError, openDatabase, PartnerStore, requireRule } from "./store";

export const partners: Partner[] = ["buyer", "supplier", "carrier"];
export const partnerBase = (partner: Partner) =>
  process.env[`${partner.toUpperCase()}_API_URL`] ||
  `http://localhost:${{ buyer: 8784, supplier: 8785, carrier: 8786 }[partner]}`;
export async function partnerRequest(
  partner: Partner,
  path: string,
  grant: Grant,
  body?: unknown,
) {
  const response = await fetch(`${partnerBase(partner)}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${await mintGrant(partner, grant)}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new DomainError(
      data.error?.code || "PARTNER_ERROR",
      data.error?.message || "Partner request failed",
      response.status,
    );
  return data;
}
type AuthorizedRequest = Request & { grant?: Grant };
const actionPaths = {
  buyer: ["/api/order/stage", "/api/order/commit", "/api/order/rollback"],
  supplier: [
    "/api/inventory/stage",
    "/api/inventory/commit",
    "/api/inventory/release",
  ],
  carrier: ["/api/routes/stage", "/api/routes/commit", "/api/routes/cancel"],
} as const;

export function createPartnerApp(partner: Partner, store: PartnerStore) {
  signingKey();
  const mode = process.env[`${partner.toUpperCase()}_BACKEND`] || "local";
  requireRule(
    ["local", "remote"].includes(mode),
    "INVALID_CONFIGURATION",
    "Backend must be local or remote",
  );
  const upstream = process.env[`${partner.toUpperCase()}_CONNECTOR_URL`];
  const upstreamKey = process.env[`${partner.toUpperCase()}_CONNECTOR_TOKEN`];
  if (mode === "remote") {
    requireRule(
      upstream && upstreamKey,
      "CONNECTOR_NOT_CONFIGURED",
      `${partner} remote backend requires URL and token`,
    );
    const url = new URL(upstream);
    requireRule(
      url.protocol === "https:" ||
        (process.env.NODE_ENV !== "production" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)),
      "INSECURE_CONNECTOR",
      "Use HTTPS for remote connectors",
    );
  }
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.get("/api/health", (_req, res) =>
    res.json({
      ok: true,
      service: partner,
      mode,
      demo: demoEnabled(),
      persistence: mode === "local" ? "sqlite" : "external-provider",
      connectionVerified: false,
    }),
  );
  app.use("/api", async (req: AuthorizedRequest, res, next) => {
    try {
      req.grant = await verifyGrant(
        partner,
        req.headers.authorization?.replace(/^Bearer\s+/i, "") || "",
      );
      next();
    } catch {
      res
        .status(401)
        .json({
          error: {
            code: "PARTNER_AUTH_REQUIRED",
            message: "A current partner-specific session is required",
          },
        });
    }
  });
  app.use("/api", async (req: AuthorizedRequest, _res, next) => {
    const grant = req.grant!;
    if (req.method !== "GET") {
      const isAction = actionPaths[partner].some(
        (p) => p === req.originalUrl.split("?")[0],
      );
      if (isAction) {
        const cleanup =
          req.originalUrl.split("?")[0] === actionPaths[partner][2];
        requireRule(
          (grant.scope === "execute" ||
            (cleanup && grant.scope === "release")) &&
            grant.approval,
          "APPROVAL_REQUIRED",
          "Approve this transaction in RelayRoom first",
          403,
        );
        requireRule(
          req.body.transactionId === grant.approval.transactionId,
          "APPROVAL_MISMATCH",
          "Transaction does not match approval",
          403,
        );
        const phase = req.path.endsWith("/stage")
          ? "stage"
          : req.path.endsWith("/commit")
            ? "commit"
            : "rollback";
        requireRule(
          req.body.idempotencyKey ===
            `${grant.approval.transactionId}:${partner}:${phase}`,
          "IDEMPOTENCY_CONFLICT",
          "Use the approved transaction idempotency key",
        );
        if (phase === "stage") {
          const { order, candidate } = grant.approval;
          const expected =
            partner === "supplier"
              ? { allocations: candidate.inventoryAllocations }
              : partner === "carrier"
                ? { routeId: candidate.routeId, units: order.quantity }
                : {
                    caseId: order.id,
                    arrivals: [
                      {
                        quantity: order.quantity,
                        arrivesAt: candidate.arrivesAt,
                      },
                    ],
                  };
          for (const [key, value] of Object.entries(expected))
            requireRule(
              JSON.stringify(req.body[key]) === JSON.stringify(value),
              "APPROVAL_MISMATCH",
              `${key} differs from the approved plan`,
              403,
            );
        }
        if (phase === "commit") {
          const dependencies: Partner[] =
            partner === "buyer"
              ? ["supplier", "carrier"]
              : partner === "carrier"
                ? ["supplier"]
                : [];
          for (const dependency of dependencies) {
            const data = await partnerRequest(
              dependency,
              `/api/transactions/${encodeURIComponent(grant.approval.transactionId)}`,
              { ...grant, scope: "read" },
            );
            requireRule(
              data.operation?.status === "committed",
              "DEPENDENCY_NOT_COMMITTED",
              `${dependency} must confirm before ${partner} commits`,
            );
          }
        }
      } else
        requireRule(
          grant.scope === "manage" && grant.role === "admin",
          "ADMIN_REQUIRED",
          "Only an administrator may change operational data",
          403,
        );
    }
    next();
  });
  // A configured connector is authoritative. Never fall back to local records on its failure.
  if (mode === "remote")
    app.use("/api", async (req: AuthorizedRequest, res) => {
      const grant = req.grant!;
      requireRule(
        !grant.approval?.rehearsal,
        "REHEARSAL_DISABLED",
        "Rehearsals cannot execute against external providers",
        403,
      );
      try {
        const response = await fetch(
          `${upstream!.replace(/\/$/, "")}${req.originalUrl}`,
          {
            method: req.method,
            headers: {
              Authorization: `Bearer ${upstreamKey}`,
              "Content-Type": "application/json",
              "X-RelayRoom-Context": Buffer.from(
                JSON.stringify(grant),
              ).toString("base64url"),
            },
            body: req.method === "GET" ? undefined : JSON.stringify(req.body),
            signal: AbortSignal.timeout(10000),
            redirect: "error",
          },
        );
        const data = await response.json();
        res.status(response.status).json(data);
      } catch {
        res
          .status(502)
          .json({
            error: {
              code: "CONNECTOR_RESULT_UNKNOWN",
              message:
                "Connector did not confirm the result. Reconcile the transaction before retrying.",
            },
          });
      }
    });
  app.get("/api/state", (_req, res) => res.json({ phase: "idle" }));
  app.get("/api/records", (_req, res) =>
    res.json({ records: store.list(), mode }),
  );
  app.post("/api/records", (req: AuthorizedRequest, res) =>
    res
      .status(201)
      .json({
        records: store.createBatch(
          batchSchema.parse(req.body.records),
          req.grant!.sub,
        ),
      }),
  );
  app.get("/api/transactions/:id", (req: AuthorizedRequest, res) => {
    const operation = store.operation(String(req.params.id), req.grant!.sub);
    res.json({ operation: operation ?? null });
  });
  app.get("/api/audit", (req: AuthorizedRequest, res) => {
    requireRule(
      typeof req.query.transactionId === "string",
      "TRANSACTION_REQUIRED",
      "Specify a transaction ID",
      400,
    );
    store.operation(req.query.transactionId, req.grant!.sub);
    res.json({
      events: store.db
        .prepare("SELECT * FROM audit WHERE target=? AND actor=? ORDER BY id")
        .all(req.query.transactionId, req.grant!.sub),
    });
  });
  if (partner === "buyer")
    app.get("/api/cases/:caseId/constraints", (req, res) => {
      const order = store.get(String(req.params.caseId));
      res.json({
        ...order,
        caseId: order.id,
        source: "local-operations",
        note: "Constraints loaded from the current order record",
      });
    });
  if (partner === "supplier")
    app.get("/api/inventory/:sku/options", (req, res) =>
      res.json({
        options: store.lots(
          String(req.params.sku),
          typeof req.query.location === "string"
            ? req.query.location
            : undefined,
        ),
        source: "local-operations",
      }),
    );
  if (partner === "carrier")
    app.get("/api/routes/options", (req, res) => {
      requireRule(
        typeof req.query.origin === "string" &&
          typeof req.query.destination === "string",
        "LANE_REQUIRED",
        "Origin and destination are required",
        400,
      );
      res.json({
        options: store.routes(req.query.origin, req.query.destination),
        source: "local-operations",
      });
    });
  app.post(actionPaths[partner][0], (req: AuthorizedRequest, res) => {
    const approval = req.grant!.approval!;
    const expected =
      partner === "supplier"
        ? { allocations: approval.candidate.inventoryAllocations }
        : partner === "carrier"
          ? {
              routeId: approval.candidate.routeId,
              units: approval.order.quantity,
            }
          : {
              caseId: approval.order.id,
              arrivals: [
                {
                  quantity: approval.order.quantity,
                  arrivesAt: approval.candidate.arrivesAt,
                },
              ],
            };
    for (const [key, value] of Object.entries(expected))
      requireRule(
        JSON.stringify(req.body[key]) === JSON.stringify(value),
        "APPROVAL_MISMATCH",
        `${key} differs from the approved plan`,
        403,
      );
    res.json(result(store.stage(approval, req.grant!.sub)));
  });
  app.post(actionPaths[partner][1], async (req: AuthorizedRequest, res) => {
    const grant = req.grant!;
    requireRule(
      typeof req.body.stageId === "string",
      "STAGE_REQUIRED",
      "A confirmed stage ID is required",
      400,
    );
    res.json(
      result(store.commit(grant.approval!, grant.sub, req.body.stageId)),
    );
  });
  app.post(actionPaths[partner][2], (req: AuthorizedRequest, res) =>
    res.json(result(store.release(req.grant!.approval!, req.grant!.sub))),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const validation = error instanceof Error && error.name === "ZodError";
      const status =
        error instanceof DomainError ? error.status : validation ? 400 : 500;
      res
        .status(status)
        .json({
          error: {
            code:
              error instanceof DomainError
                ? error.code
                : validation
                  ? "INVALID_INPUT"
                  : "INTERNAL_ERROR",
            message:
              status < 500 && error instanceof Error
                ? error.message
                : "Partner request failed",
          },
        });
    },
  );
  return app;
}
function result(op: import("@relayroom/contracts").OperationRecord) {
  return {
    stageId: op.stageId,
    resultId: op.resultId,
    status: op.status,
    expiresAt: op.expiresAt,
    persisted: true,
  };
}
export function startPartner(partner: Partner) {
  const store = new PartnerStore(
    partner,
    openDatabase(`${partner}-operations-v2`),
  );
  const app = createPartnerApp(partner, store);
  if (process.env.NODE_ENV === "production") {
    const room = process.env.VITE_ROOM_ORIGIN || "http://localhost:4173";
    app.use((_req, res, next) => {
      res.setHeader("Permissions-Policy", `tools=(self "${room}")`);
      res.setHeader("Origin-Agent-Cluster", "?1");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors ${room}; base-uri 'self'; object-src 'none'`,
      );
      next();
    });
    app.use(express.static(path.resolve(process.cwd(), "dist")));
    app.listen(
      Number(
        process.env[`${partner.toUpperCase()}_WEB_PORT`] ||
          { buyer: 4174, supplier: 4175, carrier: 4176 }[partner],
      ),
    );
  }
  const port = Number(
    process.env[`${partner.toUpperCase()}_API_PORT`] ||
      { buyer: 8784, supplier: 8785, carrier: 8786 }[partner],
  );
  app.listen(port, () =>
    console.log(
      `${partner} operations API listening on http://localhost:${port}`,
    ),
  );
}
