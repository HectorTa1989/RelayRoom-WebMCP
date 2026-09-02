import { Router, type Request } from "express";
import {
  type OrderRecord,
  type LotRecord,
  type RouteRecord,
  type ExecutionApproval,
  type Partner,
  type RecoveryCandidate,
  identifierSchema,
} from "@relayroom/contracts";
import { solveRecoveryPlan } from "@relayroom/simulator";
import {
  demoEnabled,
  mintGrant,
  partners,
  partnerBase,
  partnerRequest,
  requireRule,
  type Grant,
} from "@relayroom/operations";
import { accountDb, createAccount, type AppUser } from "./accounts";

type Authorized = Request & { user?: AppUser };
const grantFor = (user: AppUser, scope: Grant["scope"] = "read"): Grant => ({
  sub: user.id,
  role: user.role,
  scope,
});
const paid = (user: AppUser) =>
  requireRule(
    user.plan !== "free",
    "UPGRADE_REQUIRED",
    "Pro or an admin account is required",
    403,
  );
const approvalRow = (id: string, owner: string) => {
  const row = accountDb
    .prepare("SELECT * FROM approvals WHERE id=? AND owner=?")
    .get(id, owner) as { payload: string; status: string } | undefined;
  requireRule(row, "TRANSACTION_NOT_FOUND", "Transaction not found", 404);
  return row;
};
const tokensFor = async (user: AppUser, approval?: ExecutionApproval) =>
  Object.fromEntries(
    await Promise.all(
      partners.map(async (partner) => [
        partner,
        await mintGrant(partner, {
          ...grantFor(
            user,
            approval ? (user.plan === "free" ? "release" : "execute") : "read",
          ),
          approval,
        }),
      ]),
    ),
  );

export function workspaceRouter() {
  const router = Router();
  router.get("/workspace", async (req: Authorized, res) => {
    const user = req.user!;
    let records: { records: OrderRecord[] } = { records: [] };
    try {
      records = await partnerRequest("buyer", "/api/records", grantFor(user));
    } catch {
      /* Keep saved recoveries accessible during buyer outages. */
    }
    const integrations = await Promise.all(
      partners.map(async (partner) => {
        try {
          const response = await fetch(`${partnerBase(partner)}/api/health`, {
            signal: AbortSignal.timeout(3000),
          });
          const health = await response.json();
          return { partner, mode: health.mode, available: response.ok };
        } catch {
          return { partner, mode: "unavailable", available: false };
        }
      }),
    );
    res.json({
      orders: records.records,
      integrations,
      demo: demoEnabled(),
      tokens: await tokensFor(user),
      transactions: (
        accountDb
          .prepare(
            "SELECT id,payload,status,created_at FROM approvals WHERE owner=? ORDER BY created_at DESC LIMIT 50",
          )
          .all(user.id) as {
          id: string;
          payload: string;
          status: string;
          created_at: string;
        }[]
      ).map((row) => ({
        id: row.id,
        status: row.status,
        caseId: (JSON.parse(row.payload) as ExecutionApproval).order.id,
        createdAt: row.created_at,
      })),
    });
  });
  router.get("/records/:partner", async (req: Authorized, res) => {
    const partner = req.params.partner as Partner;
    requireRule(
      partners.includes(partner),
      "UNKNOWN_PARTNER",
      "Unknown partner",
      400,
    );
    res.json(
      await partnerRequest(partner, "/api/records", grantFor(req.user!)),
    );
  });
  router.post("/records/:partner", async (req: Authorized, res) => {
    const partner = req.params.partner as Partner;
    requireRule(
      partners.includes(partner),
      "UNKNOWN_PARTNER",
      "Unknown partner",
      400,
    );
    requireRule(
      req.user!.role === "admin",
      "ADMIN_REQUIRED",
      "Only admins can create or import operational records",
      403,
    );
    res
      .status(201)
      .json(
        await partnerRequest(
          partner,
          "/api/records",
          grantFor(req.user!, "manage"),
          req.body,
        ),
      );
  });
  router.post("/users", (req: Authorized, res) => {
    requireRule(
      req.user!.role === "admin",
      "ADMIN_REQUIRED",
      "Only admins can create users",
      403,
    );
    const { email, password, name } = req.body ?? {};
    requireRule(
      typeof email === "string" &&
        typeof password === "string" &&
        typeof name === "string",
      "INVALID_ACCOUNT",
      "Email, name and password are required",
      400,
    );
    res.status(201).json({ user: createAccount(email, password, name) });
  });
  router.post("/approvals", async (req: Authorized, res) => {
    const user = req.user!;
    paid(user);
    const id = identifierSchema.parse(req.body.transactionId);
    const prior = accountDb
      .prepare("SELECT owner,payload FROM approvals WHERE id=?")
      .get(id) as { owner: string; payload: string } | undefined;
    if (prior) {
      requireRule(
        prior.owner === user.id,
        "FORBIDDEN",
        "Approval belongs to another user",
        403,
      );
      const approval = JSON.parse(prior.payload) as ExecutionApproval;
      requireRule(
        JSON.stringify(approval.candidate) ===
          JSON.stringify(req.body.candidate) &&
          approval.order.id === req.body.caseId &&
          approval.rehearsal === Boolean(req.body.rehearsal),
        "IDEMPOTENCY_CONFLICT",
        "Approval request changed",
      );
      return res.json({ approval, tokens: await tokensFor(user, approval) });
    }
    const caseId = identifierSchema.parse(req.body.caseId);
    const buyer = await partnerRequest(
      "buyer",
      `/api/cases/${encodeURIComponent(caseId)}/constraints`,
      grantFor(user),
    );
    const {
      caseId: _caseId,
      source: _source,
      note: _note,
      ...orderFields
    } = buyer;
    const order = orderFields as OrderRecord;
    requireRule(
      order.status === "open",
      "ORDER_CLOSED",
      "This order is already resolved",
    );
    const [stock, lanes] = await Promise.all([
      partnerRequest(
        "supplier",
        `/api/inventory/${encodeURIComponent(order.sku)}/options?location=${encodeURIComponent(order.origin)}`,
        grantFor(user),
      ),
      partnerRequest(
        "carrier",
        `/api/routes/options?origin=${encodeURIComponent(order.origin)}&destination=${encodeURIComponent(order.destination)}&units=${encodeURIComponent(String(order.quantity))}`,
        grantFor(user),
      ),
    ]);
    const requested = req.body.candidate as RecoveryCandidate | undefined;
    const candidates = solveRecoveryPlan(
      { ...order, caseId: order.id },
      stock.options as LotRecord[],
      lanes.options as RouteRecord[],
    );
    const candidate = candidates.find(
      (x) =>
        x.feasible &&
        x.routeId === requested?.routeId &&
        JSON.stringify(x.inventoryAllocations) ===
          JSON.stringify(requested?.inventoryAllocations) &&
        x.arrivesAt === requested?.arrivesAt &&
        x.addedLogisticsCostPct === requested?.addedLogisticsCostPct,
    );
    requireRule(
      candidate,
      "PLAN_STALE",
      "Availability or constraints changed. Run planning again before approval.",
    );
    const rehearsal = Boolean(req.body.rehearsal);
    requireRule(
      !rehearsal ||
        (demoEnabled() &&
          partners.every(
            (p) => process.env[`${p.toUpperCase()}_BACKEND`] !== "remote",
          )),
      "REHEARSAL_DISABLED",
      "Rehearsals require explicit demo mode and all-local partners",
      403,
    );
    const route = (lanes.options as RouteRecord[]).find(
      (x) => x.id === candidate.routeId,
    )!;
    const approval: ExecutionApproval = {
      transactionId: id,
      order,
      candidate,
      approvedAt: new Date().toISOString(),
      expiresAt: new Date(
        Math.min(Date.now() + 15 * 60_000, Date.parse(route.departsAt)),
      ).toISOString(),
      rehearsal,
    };
    // Recheck the active order lock after asynchronous partner reads to serialize competing approvals.
    accountDb.exec("BEGIN IMMEDIATE");
    try {
      const active = accountDb
        .prepare(
          "SELECT payload FROM approvals WHERE status NOT IN ('committed','rolled-back')",
        )
        .all() as { payload: string }[];
      requireRule(
        !active.some(
          (row) =>
            (JSON.parse(row.payload) as ExecutionApproval).order.id ===
            order.id,
        ),
        "RECOVERY_IN_PROGRESS",
        "Resume or release the existing recovery for this order first",
      );
      accountDb
        .prepare(
          "INSERT INTO approvals(id,owner,payload,created_at) VALUES (?,?,?,?)",
        )
        .run(id, user.id, JSON.stringify(approval), approval.approvedAt);
      accountDb.exec("COMMIT");
    } catch (error) {
      accountDb.exec("ROLLBACK");
      throw error;
    }
    return res
      .status(201)
      .json({ approval, tokens: await tokensFor(user, approval) });
  });
  router.get("/transactions/:id", async (req: Authorized, res) => {
    const row = approvalRow(String(req.params.id), req.user!.id);
    const approval = JSON.parse(row.payload) as ExecutionApproval;
    res.json({
      approval,
      status: row.status,
      tokens: await tokensFor(req.user!, approval),
    });
  });
  router.post("/transactions/:id/reconcile", async (req: Authorized, res) => {
    const id = String(req.params.id);
    approvalRow(id, req.user!.id);
    const operations = await Promise.all(
      partners.map(async (partner) => ({
        partner,
        ...(await partnerRequest(
          partner,
          `/api/transactions/${encodeURIComponent(id)}`,
          grantFor(req.user!),
        )),
      })),
    );
    const status = operations.every((x) => x.operation?.status === "committed")
      ? "committed"
      : operations.every((x) => x.operation?.status === "released")
        ? "rolled-back"
        : "needs-recovery";
    accountDb
      .prepare("UPDATE approvals SET status=? WHERE id=?")
      .run(status, id);
    res.json({ status, operations });
  });
  router.get("/transactions/:id/audit", async (req: Authorized, res) => {
    const id = String(req.params.id);
    const row = approvalRow(id, req.user!.id);
    paid(req.user!);
    const records = await Promise.all(
      partners.map(async (partner) => ({
        partner,
        ...(await partnerRequest(
          partner,
          `/api/transactions/${encodeURIComponent(id)}`,
          grantFor(req.user!),
        )),
        ...(await partnerRequest(
          partner,
          `/api/audit?transactionId=${encodeURIComponent(id)}`,
          grantFor(req.user!),
        )),
      })),
    );
    res.json({
      approval: JSON.parse(row.payload),
      status: row.status,
      partners: records,
    });
  });
  return router;
}
