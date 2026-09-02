import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  BadgeCheck,
  Box,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Cloud,
  Command,
  Download,
  ExternalLink,
  FileCheck2,
  GitBranch,
  Github,
  Globe2,
  LockKeyhole,
  PackageCheck,
  Play,
  RefreshCcw,
  Route,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRound,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import {
  makeOrigins,
  type OrderRecord,
  type ExecutionApproval,
  type OperationRecord,
  type Partner,
  type BuyerConstraints,
  type ConstraintEvidence,
  type InventoryOption,
  type PartnerKind,
  type RecoveryCandidate,
  type RouteOption,
  type StagedTransaction,
  type ToolAuditEvent,
} from "@relayroom/contracts";
import {
  createTransaction,
  executeCoordinatedTransaction,
  type TransactionCommand,
} from "@relayroom/simulator";
import type { DiscoveredTool, WebMCPTool } from "@relayroom/ui";
import { CrossOriginToolClient } from "./orchestration";
import { initialRoomState, roomReducer } from "./state";
import {
  useAuth,
  workspaceApi,
  type Entitlements,
  type SessionUser,
} from "./auth";
import { OperationsManager } from "./OperationsManager";

type Workspace = {
  orders: OrderRecord[];
  tokens: Record<Partner, string>;
  demo: boolean;
  integrations: { partner: Partner; mode: string; available: boolean }[];
  transactions: {
    id: string;
    caseId: string;
    status: string;
    createdAt: string;
  }[];
};
type AuditPayload = {
  approval: ExecutionApproval;
  status: string;
  partners: {
    partner: Partner;
    operation: OperationRecord | null;
    events: { id: number; action: string; target: string; at: string }[];
  }[];
};
const formatDate = (value?: string) =>
  value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const roomEnv = (import.meta as ImportMeta & { env?: Record<string, string> })
  .env;
const BUYER_ORIGIN = roomEnv?.VITE_BUYER_ORIGIN || "http://localhost:4174";
const SUPPLIER_ORIGIN =
  roomEnv?.VITE_SUPPLIER_ORIGIN || "http://localhost:4175";
const CARRIER_ORIGIN = roomEnv?.VITE_CARRIER_ORIGIN || "http://localhost:4176";
const partnerOrigins = {
  buyer: BUYER_ORIGIN,
  supplier: SUPPLIER_ORIGIN,
  carrier: CARRIER_ORIGIN,
} as const;
const origins = makeOrigins(window.location.origin);

type PartnerFrameRefs = {
  buyer: React.RefObject<HTMLIFrameElement | null>;
  supplier: React.RefObject<HTMLIFrameElement | null>;
  carrier: React.RefObject<HTMLIFrameElement | null>;
};

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException("Cancelled", "AbortError"));
    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}

function originForPartner(partner: Exclude<PartnerKind, "room">) {
  return partnerOrigins[partner];
}

export function App() {
  const auth = useAuth();
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const [framesReady, setFramesReady] = useState(0);
  const [showAudit, setShowAudit] = useState(false);
  const [showPortals, setShowPortals] = useState(true);
  const [toolPopover, setToolPopover] = useState(false);
  const [showAccess, setShowAccess] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [showManager, setShowManager] = useState(false);
  const activeOrder =
    workspace?.orders.find((order) => order.id === selectedOrderId) ??
    workspace?.orders[0];
  const objective = activeOrder
    ? `Recover ${activeOrder.id}: deliver ${activeOrder.quantity} units to ${activeOrder.destination} by ${formatDate(activeOrder.neededBy)}, with added logistics cost no higher than ${activeOrder.maxAddedLogisticsCostPct}%.`
    : "Create or import an order to plan a recovery.";
  const executionBusy = useRef(false);
  const refreshWorkspace = useCallback(async (id?: string) => {
    const next = await workspaceApi<Workspace>("/workspace");
    setWorkspace(next);
    if (id) setSelectedOrderId(id);
    return next;
  }, []);
  useEffect(() => {
    if (!auth.user) {
      setWorkspace(undefined);
      dispatch({ type: "reset" });
      return;
    }
    void refreshWorkspace().catch((error) =>
      dispatch({ type: "error", message: error.message }),
    );
  }, [auth.user?.id, refreshWorkspace]);
  const buyerRef = useRef<HTMLIFrameElement>(null);
  const supplierRef = useRef<HTMLIFrameElement>(null);
  const carrierRef = useRef<HTMLIFrameElement>(null);
  const frames: PartnerFrameRefs = {
    buyer: buyerRef,
    supplier: supplierRef,
    carrier: carrierRef,
  };
  const clientRef = useRef<CrossOriginToolClient | undefined>(undefined);
  const flowAbortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const client = new CrossOriginToolClient(
      () => ({
        buyer: buyerRef.current,
        supplier: supplierRef.current,
        carrier: carrierRef.current,
      }),
      partnerOrigins,
    );
    clientRef.current = client;
    return () => client.destroy();
  }, []);

  const discover = useCallback(async () => {
    if (!clientRef.current) return [] as DiscoveredTool[];
    const result = await clientRef.current.discover();
    dispatch({ type: "tools", tools: result.tools, mode: result.mode });
    return result.tools;
  }, []);

  useEffect(() => {
    if (framesReady < 3) return;
    const timeout = window.setTimeout(() => void discover(), 120);
    return () => window.clearTimeout(timeout);
  }, [discover, framesReady]);

  useEffect(() => {
    if (framesReady < 3 || executionBusy.current) return;
    void clientRef.current
      ?.setSession(workspace?.tokens ?? {}, activeOrder)
      .catch((error) => dispatch({ type: "error", message: error.message }));
  }, [framesReady, workspace?.tokens, activeOrder?.id]);

  const pulsePartner = useCallback(
    (partner: "buyer" | "supplier" | "carrier") => {
      dispatch({ type: "pulse", partner });
      window.setTimeout(() => dispatch({ type: "pulse" }), 700);
    },
    [],
  );

  const addAudit = useCallback(
    (
      tool: string,
      partner: "buyer" | "supplier" | "carrier",
      input: Record<string, unknown>,
      result: "success" | "error" | "cancelled",
      resultSummary: string,
      transactionId?: string,
    ) => {
      const event: ToolAuditEvent = {
        id: crypto.randomUUID(),
        transactionId,
        tool,
        origin: originForPartner(partner),
        inputSummary: Object.entries(input)
          .slice(0, 3)
          .map(
            ([key, value]) =>
              `${key}: ${Array.isArray(value) ? `${value.length} item(s)` : String(value)}`,
          )
          .join(" · "),
        result,
        resultSummary,
        timestamp: new Date().toISOString(),
      };
      dispatch({ type: "audit", event });
    },
    [],
  );

  const callTool = useCallback(
    async (
      tool: string,
      partner: "buyer" | "supplier" | "carrier",
      input: Record<string, unknown>,
      signal?: AbortSignal,
      transactionId?: string,
    ) => {
      if (!clientRef.current)
        throw new Error("Partner tool client is not ready");
      pulsePartner(partner);
      try {
        const result = await clientRef.current.execute(tool, input, signal);
        addAudit(
          tool,
          partner,
          input,
          "success",
          "Partner returned a validated result",
          transactionId,
        );
        return result as Record<string, unknown>;
      } catch (error) {
        const cancelled =
          error instanceof DOMException && error.name === "AbortError";
        addAudit(
          tool,
          partner,
          input,
          cancelled ? "cancelled" : "error",
          error instanceof Error ? error.message : "Unknown error",
          transactionId,
        );
        throw error;
      }
    },
    [addAudit, pulsePartner],
  );

  const runRecovery = useCallback(async () => {
    if (!activeOrder || executionBusy.current) return;
    flowAbortRef.current?.abort();
    const controller = new AbortController();
    flowAbortRef.current = controller;
    dispatch({ type: "reset" });
    dispatch({ type: "stage", stage: "querying" });

    try {
      const current = await refreshWorkspace();
      await clientRef.current!.setSession(current.tokens, activeOrder);
      let tools = await discover();
      if (tools.length < 3) {
        await wait(250, controller.signal);
        tools = await discover();
      }
      const required = [
        "get_order_constraints",
        "get_inventory_options",
        "get_route_options",
      ];
      const missing = required.filter(
        (name) => !tools.some((tool) => tool.name === name),
      );
      if (missing.length)
        throw new Error(`Partner unavailable: ${missing.join(", ")}`);

      const [buyer, supplier, carrier] = await Promise.all([
        callTool(
          "get_order_constraints",
          "buyer",
          { caseId: activeOrder.id },
          controller.signal,
        ),
        wait(180, controller.signal).then(() =>
          callTool(
            "get_inventory_options",
            "supplier",
            { sku: activeOrder.sku, location: activeOrder.origin },
            controller.signal,
          ),
        ),
        wait(360, controller.signal).then(() =>
          callTool(
            "get_route_options",
            "carrier",
            {
              origin: activeOrder.origin,
              destination: activeOrder.destination,
              units: activeOrder.quantity,
            },
            controller.signal,
          ),
        ),
      ]);

      const constraints: BuyerConstraints = {
        caseId: String(buyer.caseId),
        quantity: Number(buyer.quantity),
        neededBy: String(buyer.neededBy),
        maxAddedLogisticsCostPct: Number(buyer.maxAddedLogisticsCostPct),
        allowLateSplit: Boolean(buyer.allowLateSplit),
        destination: String(buyer.destination),
      };
      const inventory = Array.isArray(supplier.options)
        ? (supplier.options as InventoryOption[])
        : [];
      const routes = Array.isArray(carrier.options)
        ? (carrier.options as RouteOption[])
        : [];
      if (
        !constraints.caseId ||
        !Number.isFinite(constraints.quantity) ||
        inventory.length === 0 ||
        routes.length === 0
      )
        throw new Error("Partner evidence failed normalization");
      const combinedUnits = inventory.reduce(
        (total, option) => total + option.availableUnits,
        0,
      );
      const backup = inventory.find((option) => option.source === "backup");
      const priority = [...routes].sort(
        (a, b) => Date.parse(a.arrivesAt) - Date.parse(b.arrivesAt),
      )[0];

      const evidence: ConstraintEvidence[] = [
        {
          id: "EVID-BUY-1",
          origin: "buyer",
          label: "Hard deadline",
          value: formatDate(constraints.neededBy),
          detail: `${constraints.quantity} units · maximum +${constraints.maxAddedLogisticsCostPct}% logistics`,
          severity: "warning",
          observedAt: new Date().toISOString(),
          untrustedNote: String(buyer.note ?? ""),
        },
        {
          id: "EVID-SUP-1",
          origin: "supplier",
          label: "Combined inventory",
          value: `${combinedUnits} units`,
          detail: `${inventory.length} persisted lots · backup minimum ${backup?.minReservation ?? "n/a"}`,
          severity: "positive",
          observedAt: new Date().toISOString(),
          untrustedNote: String(supplier.note ?? ""),
        },
        {
          id: "EVID-CAR-1",
          origin: "carrier",
          label: "Earliest route",
          value: formatDate(priority.arrivesAt),
          detail: `+${priority.costDeltaPct}% logistics · ${priority.capacityUnits}-unit capacity`,
          severity: "positive",
          observedAt: new Date().toISOString(),
          untrustedNote: String(carrier.note ?? ""),
        },
      ];
      evidence.forEach((item) =>
        dispatch({ type: "evidence", evidence: item }),
      );

      dispatch({ type: "stage", stage: "simulating" });
      await wait(350, controller.signal);
      const plan = await auth.planRecovery(
        { objective, constraints, inventory, routes },
        controller.signal,
      );
      dispatch({
        type: "planner",
        planner: {
          source: plan.source,
          model: plan.model,
          narrative: plan.narrative,
          fallbackReason: plan.fallbackReason,
        },
      });
      const candidates = plan.candidates;
      dispatch({ type: "candidates", candidates });
      const winner = candidates.find(
        (candidate) =>
          candidate.id === plan.selectedCandidateId && candidate.feasible,
      );
      if (!winner)
        throw new Error(
          "No feasible recovery plan satisfies all partner constraints",
        );
      const transaction = createTransaction(winner, new Date(), activeOrder.id);
      dispatch({ type: "select", candidate: winner, transaction });
      clientRef.current?.broadcastPhase("selected");
      clientRef.current?.clearNativeCache();
      await wait(180, controller.signal);
      await discover();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        dispatch({
          type: "error",
          message: "Recovery simulation cancelled cleanly.",
        });
      } else
        dispatch({
          type: "error",
          message:
            error instanceof Error ? error.message : "Recovery planning failed",
        });
      dispatch({ type: "stage", stage: "ready" });
    }
  }, [
    auth.planRecovery,
    callTool,
    discover,
    activeOrder,
    objective,
    refreshWorkspace,
  ]);

  const startRecovery = useCallback(() => {
    if (!auth.entitlements?.features.crossOriginRecovery) {
      setShowAccess(true);
      return;
    }
    if (!activeOrder) {
      if (auth.user?.role === "admin") setShowManager(true);
      return;
    }
    void runRecovery();
  }, [auth.entitlements, auth.user, activeOrder, runRecovery]);

  const approveAndExecute = useCallback(
    async (resumeId?: string, releaseOnly = false) => {
      if (
        !auth.entitlements?.features.coordinatedCommit &&
        !(resumeId && releaseOnly)
      ) {
        setShowAccess(true);
        return;
      }
      if (executionBusy.current || !clientRef.current) return;
      if (!resumeId && (!state.selected || !state.transaction || !activeOrder))
        return;
      executionBusy.current = true;
      dispatch({ type: "stage", stage: "staging" });
      let approval: ExecutionApproval | undefined;
      try {
        const response = resumeId
          ? await workspaceApi<{
              approval: ExecutionApproval;
              tokens: Record<Partner, string>;
            }>(`/transactions/${encodeURIComponent(resumeId)}`)
          : await workspaceApi<{
              approval: ExecutionApproval;
              tokens: Record<Partner, string>;
            }>("/approvals", {
              transactionId: state.transaction!.id,
              caseId: activeOrder!.id,
              candidate: state.selected,
              rehearsal: state.failureRehearsal,
            });
        approval = response.approval;
        const approved = approval;
        setSelectedOrderId(approved.order.id);
        await clientRef.current.setSession(response.tokens, approved.order);
        clientRef.current.broadcastPhase("approved");
        clientRef.current.clearNativeCache();
        await wait(200);
        await discover();
        const base = createTransaction(
          approved.candidate,
          new Date(approved.approvedAt),
          approved.order.id,
        );
        base.id = approved.transactionId;
        base.approvedAt = approved.approvedAt;
        dispatch({
          type: "select",
          candidate: approved.candidate,
          transaction: base,
        });
        dispatch({ type: "stage", stage: "executing" });
        const run = async (command: TransactionCommand) => {
          const input: Record<string, unknown> = {
            transactionId: base.id,
            idempotencyKey: `${base.id}:${command.step.origin}:${command.phase}`,
          };
          if (command.phase === "stage") {
            if (command.step.origin === "supplier")
              input.allocations = approved.candidate.inventoryAllocations;
            else if (command.step.origin === "carrier") {
              input.routeId = approved.candidate.routeId;
              input.units = approved.order.quantity;
            } else {
              input.caseId = approved.order.id;
              input.arrivals = [
                {
                  quantity: approved.order.quantity,
                  arrivesAt: approved.candidate.arrivesAt,
                },
              ];
            }
          } else if (command.phase === "commit")
            input.stageId = command.step.stageId;
          const result = await callTool(
            command.tool,
            command.step.origin,
            input,
            undefined,
            base.id,
          );
          const id =
            command.phase === "commit" ? result.resultId : result.stageId;
          if (typeof id !== "string" || !id)
            throw new Error("Partner did not confirm an operation ID");
          return { id };
        };
        let result: StagedTransaction;
        if (releaseOnly) {
          result = structuredClone(base);
          result.status = "rolled-back";
          for (const step of [...result.steps].reverse()) {
            const rollback = result.rollback.find(
              (x) => x.origin === step.origin,
            )!;
            try {
              await run({ step, phase: "rollback", tool: rollback.tool });
              rollback.status = "rolled-back";
              step.status = "rolled-back";
            } catch {
              rollback.status = "failed";
              result.status = "failed";
            }
          }
        } else result = await executeCoordinatedTransaction(base, run);
        const verified = await workspaceApi<{ status: string }>(
          `/transactions/${encodeURIComponent(base.id)}/reconcile`,
          {},
        );
        if (
          verified.status !== "committed" &&
          verified.status !== "rolled-back"
        )
          result.status = "failed";
        dispatch({ type: "transaction", transaction: result });
        dispatch({
          type: "stage",
          stage:
            verified.status === "committed"
              ? "success"
              : verified.status === "rolled-back"
                ? "rollback"
                : "ready",
        });
        if (result.status === "failed")
          dispatch({
            type: "error",
            message:
              "Recovery needs attention. Use Release to retry compensation; inspect provider records if a connector result is unknown.",
          });
        clientRef.current.broadcastPhase(
          verified.status === "committed" ? "committed" : "selected",
        );
        setShowAudit(true);
      } catch (error) {
        dispatch({ type: "stage", stage: "ready" });
        dispatch({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Execution interrupted. Resume the saved transaction.",
        });
      } finally {
        executionBusy.current = false;
        try {
          await refreshWorkspace();
        } catch {
          /* Keep the transaction visible when a partner is unavailable. */
        }
      }
    },
    [
      auth.entitlements,
      state.selected,
      state.transaction,
      state.failureRehearsal,
      activeOrder,
      callTool,
      discover,
      refreshWorkspace,
    ],
  );

  const viewReceipt = async (id: string) => {
    try {
      const receipt = await workspaceApi<AuditPayload>(
        `/transactions/${encodeURIComponent(id)}/audit`,
      );
      const tx = createTransaction(
        receipt.approval.candidate,
        new Date(receipt.approval.approvedAt),
        receipt.approval.order.id,
      );
      tx.id = id;
      tx.approvedAt = receipt.approval.approvedAt;
      const complete = receipt.partners.every(
        (x) => x.operation?.status === "committed",
      );
      const released = receipt.partners.every(
        (x) => x.operation?.status === "released",
      );
      tx.status = complete ? "committed" : released ? "rolled-back" : "failed";
      for (const step of tx.steps) {
        const op = receipt.partners.find(
          (x) => x.partner === step.origin,
        )?.operation;
        step.stageId = op?.stageId;
        step.resultId = op?.resultId;
        step.status =
          op?.status === "committed"
            ? "succeeded"
            : op?.status === "released"
              ? "rolled-back"
              : "pending";
      }
      dispatch({ type: "reset" });
      setSelectedOrderId(receipt.approval.order.id);
      dispatch({
        type: "select",
        candidate: receipt.approval.candidate,
        transaction: tx,
      });
      dispatch({
        type: "stage",
        stage: complete ? "success" : released ? "rollback" : "ready",
      });
      for (const partner of receipt.partners)
        for (const event of partner.events)
          dispatch({
            type: "audit",
            event: {
              id: `${partner.partner}-${event.id}`,
              transactionId: id,
              tool: event.action,
              origin: partnerOrigins[partner.partner],
              inputSummary: event.target,
              result: "success",
              resultSummary: "Confirmed in partner audit log",
              timestamp: event.at,
            },
          });
      setShowAudit(true);
    } catch (error) {
      dispatch({
        type: "error",
        message: error instanceof Error ? error.message : "Receipt unavailable",
      });
    }
  };

  useRoomTools({
    state,
    activeOrder,
    runRecovery,
    selectCandidate: (candidate) => {
      dispatch({
        type: "select",
        candidate,
        transaction: createTransaction(candidate, new Date(), activeOrder?.id),
      });
      clientRef.current?.broadcastPhase("selected");
    },
  });

  const winner =
    state.selected ?? state.candidates.find((candidate) => candidate.feasible);
  const isBusy = ["querying", "simulating", "staging", "executing"].includes(
    state.stage,
  );
  const statusCopy = getStatusCopy(state.stage);
  const connectedOrigins = origins.filter((origin) => origin.id !== "room");

  return (
    <div className="room-app">
      <header className="global-header">
        <div className="wordmark">
          <span className="relay-logo">
            <i />
            <i />
            <i />
          </span>
          <strong>RelayRoom</strong>
          <span className="beta">BETA</span>
        </div>
        <nav className="header-nav" aria-label="Primary">
          <button className="active">Coordination room</button>
          <button onClick={() => setShowAudit(true)}>Audit</button>
          <a
            href="https://github.com/HectorTa1989"
            target="_blank"
            rel="noreferrer"
          >
            Docs <ExternalLink size={11} />
          </a>
        </nav>
        <div className="header-actions">
          <button
            className={`plan-badge source-${auth.entitlements?.source ?? "free"}`}
            onClick={() => setShowAccess(true)}
          >
            <Zap size={11} />{" "}
            {auth.user
              ? auth.entitlements?.allAccess
                ? `${auth.user.plan === "admin" ? "Admin" : "Pro"} · All access`
                : "Free plan"
              : "Sign in"}{" "}
          </button>
          <button
            className="avatar-button"
            aria-label="Account"
            onClick={() => setShowAccess(true)}
          >
            <span>
              {auth.user ? (
                auth.user.name
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")
              ) : (
                <UserRound size={13} />
              )}
            </span>
            <ChevronDown size={12} />
          </button>
        </div>
      </header>

      <div className="trust-bar">
        <div className="trust-title">
          <ShieldCheck size={14} />
          <span>Trusted origin boundary</span>
        </div>
        <div className="origin-list">
          {connectedOrigins.map((origin) => (
            <span className="origin-chip" key={origin.id}>
              <i style={{ background: origin.color }} />
              <span>{origin.origin.replace(/^https?:\/\//, "")}</span>
              <b>
                {
                  state.tools.filter((tool) => tool.origin === origin.origin)
                    .length
                }
              </b>
            </span>
          ))}
        </div>
        <button
          className="runtime-button"
          onClick={() => setToolPopover((current) => !current)}
        >
          <Wifi size={12} />
          <span>
            {state.mode === "native" ? "Native WebMCP" : "Compatibility bridge"}
          </span>
          <ChevronDown size={11} />
        </button>
        {toolPopover && (
          <ToolPopover
            tools={state.tools}
            mode={state.mode}
            onClose={() => setToolPopover(false)}
          />
        )}
      </div>

      <main className="room-main">
        <div className="workspace-controls">
          <label>
            Active order
            <select
              aria-label="Active order"
              disabled={isBusy}
              value={activeOrder?.id ?? ""}
              onChange={(event) => {
                setSelectedOrderId(event.target.value);
                dispatch({ type: "reset" });
                clientRef.current?.broadcastPhase("idle");
              }}
            >
              <option value="" disabled>
                {auth.user
                  ? "Create your first order"
                  : "Sign in to load orders"}
              </option>
              {workspace?.orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.id} · {order.productName} · {order.status}
                </option>
              ))}
            </select>
          </label>
          <div className="integration-status">
            {workspace?.integrations.map((item) => (
              <span key={item.partner}>
                {item.partner}:{" "}
                {item.available
                  ? item.mode === "remote"
                    ? "External connector"
                    : "Local operations"
                  : "Unavailable"}
              </span>
            ))}
          </div>
          {auth.user?.role === "admin" && (
            <button disabled={isBusy} onClick={() => setShowManager(true)}>
              Manage operations
            </button>
          )}
        </div>
        {!!workspace?.transactions.length && (
          <section className="pending-recoveries">
            <strong>Recovery history</strong>
            {workspace.transactions.map((t) => (
              <div key={t.id}>
                <span>
                  {t.caseId} · {t.status}
                  <small>{t.id}</small>
                </span>
                {["committed", "rolled-back"].includes(t.status) ? (
                  <button
                    disabled={isBusy}
                    onClick={() => void viewReceipt(t.id)}
                  >
                    View receipt
                  </button>
                ) : (
                  <>
                    <button
                      disabled={isBusy}
                      onClick={() => void approveAndExecute(t.id)}
                    >
                      Resume
                    </button>
                    <button
                      disabled={isBusy}
                      onClick={() => void approveAndExecute(t.id, true)}
                    >
                      Release reservations
                    </button>
                  </>
                )}
              </div>
            ))}
          </section>
        )}
        <section className="case-hero">
          <div className="case-heading">
            <div className="case-kicker">
              <span className="live-dot" /> ACTIVE EXCEPTION{" "}
              <b>{activeOrder?.id ?? "NO ORDER SELECTED"}</b>
            </div>
            <h1>
              {activeOrder ? (
                <>
                  Protect your <em>{activeOrder.quantity}-unit</em> delivery.
                </>
              ) : (
                <>
                  Plan your next <em>recovery.</em>
                </>
              )}
            </h1>
            <p>
              One disruption. Three companies. One coordinated recovery plan.
            </p>
          </div>
          <div className="case-stats">
            <div>
              <span>Deadline</span>
              <strong>{formatDate(activeOrder?.neededBy)}</strong>
              <small>Hard arrival window</small>
            </div>
            <div>
              <span>Destination</span>
              <strong>{activeOrder?.destination ?? "—"}</strong>
              <small>{activeOrder?.sku ?? "No SKU selected"}</small>
            </div>
            <div>
              <span>Cost guardrail</span>
              <strong>
                {activeOrder
                  ? `≤ ${activeOrder.maxAddedLogisticsCostPct}%`
                  : "—"}
              </strong>
              <small>Added logistics</small>
            </div>
          </div>
        </section>

        <section className="prompt-card">
          <div className="prompt-icon">
            <Command size={18} />
          </div>
          <div className="prompt-copy">
            <span>OPERATIONS REQUEST</span>
            <p>{objective}</p>
          </div>
          {isBusy ? (
            ["querying", "simulating"].includes(state.stage) ? (
              <button
                className="cancel-button"
                onClick={() => flowAbortRef.current?.abort()}
              >
                <X size={15} /> Cancel
              </button>
            ) : (
              <span className="execution-label">
                Applying approved changes…
              </span>
            )
          ) : (
            <button
              className="run-button"
              disabled={activeOrder?.status === "resolved"}
              onClick={startRecovery}
            >
              <Sparkles size={15} />
              {activeOrder?.status === "resolved"
                ? "Order resolved"
                : state.stage === "ready"
                  ? "Resolve case"
                  : "Run again"}
              {!auth.entitlements?.allAccess && <LockKeyhole size={11} />}
              <ArrowRight size={14} />
            </button>
          )}
        </section>

        {state.error && (
          <div className="error-banner">
            <ShieldCheck size={15} />
            <span>{state.error}</span>
            <button onClick={() => dispatch({ type: "error" })}>
              <X size={14} />
            </button>
          </div>
        )}

        <section className="workspace-grid">
          <div className="workspace-primary">
            <ConstraintRibbon evidence={state.evidence} stage={state.stage} />
            <RouteMap stage={state.stage} winner={winner} order={activeOrder} />
          </div>
          <aside className="plan-panel">
            <div className="panel-head">
              <div>
                <span>COORDINATED PLAN</span>
                <h2>{winner ? winner.name : "Awaiting partner evidence"}</h2>
              </div>
              {winner && (
                <div className="plan-pills">
                  <span
                    className={`planner-pill planner-${state.planner?.source ?? "deterministic"}`}
                  >
                    <Sparkles size={10} />
                    {state.planner?.source === "openai"
                      ? `OpenAI · ${state.planner.model}`
                      : state.planner?.source === "gemini"
                        ? `Gemini · ${state.planner.model}`
                        : "Deterministic"}
                  </span>
                  <span className="feasible-pill">
                    <Check size={11} /> Feasible
                  </span>
                </div>
              )}
            </div>
            {winner ? (
              <PlanSummary
                candidate={winner}
                transaction={state.transaction}
                planner={state.planner}
                costCap={activeOrder?.maxAddedLogisticsCostPct ?? 0}
              />
            ) : (
              <EmptyPlan />
            )}
            <div className="approval-zone">
              {workspace?.demo && (
                <label className="failure-toggle">
                  <input
                    type="checkbox"
                    checked={state.failureRehearsal}
                    onChange={(event) => {
                      if (!auth.entitlements?.features.failureRehearsal) {
                        setShowAccess(true);
                        return;
                      }
                      dispatch({
                        type: "failure",
                        enabled: event.target.checked,
                      });
                    }}
                  />
                  <span />
                  <div>
                    <strong>
                      Rehearse carrier failure{" "}
                      {!auth.entitlements?.features.failureRehearsal && (
                        <LockKeyhole size={8} />
                      )}
                    </strong>
                    <small>Shows compensating rollback</small>
                  </div>
                </label>
              )}
              <button
                className="approve-button"
                disabled={state.stage !== "preview"}
                onClick={() => void approveAndExecute()}
              >
                <LockKeyhole size={14} />
                {state.stage === "preview"
                  ? "Approve coordinated change"
                  : statusCopy}
              </button>
              <small className="approval-note">
                <ShieldCheck size={11} /> Signed approval is checked by every
                partner
              </small>
            </div>
          </aside>
        </section>

        <section className="portal-section">
          <button
            className="section-toggle"
            onClick={() => setShowPortals((current) => !current)}
          >
            <div>
              <span className="section-index">02</span>
              <div>
                <strong>Live partner portals</strong>
                <small>Actions execute inside the company that owns them</small>
              </div>
            </div>
            <ChevronDown className={showPortals ? "rotated" : ""} size={17} />
          </button>
          {showPortals && (
            <div className="portal-grid">
              <PortalFrame
                kind="buyer"
                label="Atlas Buyer"
                origin={BUYER_ORIGIN}
                iframeRef={buyerRef}
                pulse={state.partnerPulse === "buyer"}
                onLoad={() => setFramesReady((value) => Math.min(3, value + 1))}
              />
              <PortalFrame
                kind="supplier"
                label="Northstar Supply"
                origin={SUPPLIER_ORIGIN}
                iframeRef={supplierRef}
                pulse={state.partnerPulse === "supplier"}
                onLoad={() => setFramesReady((value) => Math.min(3, value + 1))}
              />
              <PortalFrame
                kind="carrier"
                label="Vector Freight"
                origin={CARRIER_ORIGIN}
                iframeRef={carrierRef}
                pulse={state.partnerPulse === "carrier"}
                onLoad={() => setFramesReady((value) => Math.min(3, value + 1))}
              />
            </div>
          )}
        </section>
      </main>

      <footer className="room-footer">
        <div>
          <span className="footer-logo">
            <GitBranch size={13} />
          </span>
          <span>
            Independent websites cooperating without surrendering control.
          </span>
        </div>
        <div>
          <span>WebMCP build</span>
          <a
            href="https://github.com/HectorTa1989"
            target="_blank"
            rel="noreferrer"
          >
            <Github size={13} /> HectorTa1989
          </a>
        </div>
      </footer>
      {showAudit && (
        <AuditDrawer
          events={state.audit}
          transaction={state.transaction}
          candidate={winner}
          stage={state.stage}
          canExport={Boolean(auth.entitlements?.features.auditExport)}
          onLocked={() => setShowAccess(true)}
          onClose={() => setShowAudit(false)}
        />
      )}
      {showManager && (
        <OperationsManager
          onClose={() => setShowManager(false)}
          onChanged={async (id) => {
            await refreshWorkspace(id);
          }}
        />
      )}
      {showAccess && (
        <AccessModal
          demo={Boolean(workspace?.demo)}
          user={auth.user}
          entitlements={auth.entitlements}
          error={auth.error}
          loading={auth.loading}
          onLogin={auth.login}
          onLogout={auth.logout}
          onCheckout={auth.checkout}
          onGrantDevPro={auth.grantDevPro}
          onClose={() => setShowAccess(false)}
        />
      )}
    </div>
  );
}

function ConstraintRibbon({
  evidence,
  stage,
}: {
  evidence: ConstraintEvidence[];
  stage: string;
}) {
  const placeholders = [
    { origin: "buyer", label: "Buyer constraints", icon: Building2 },
    { origin: "supplier", label: "Inventory options", icon: Box },
    { origin: "carrier", label: "Route options", icon: Truck },
  ] as const;
  return (
    <section className="constraint-board">
      <div className="subsection-head">
        <div>
          <span className="section-index">01</span>
          <div>
            <strong>Shared constraint ribbon</strong>
            <small>
              Only normalized tool results cross each origin boundary
            </small>
          </div>
        </div>
        <span className="evidence-count">{evidence.length}/3 verified</span>
      </div>
      <div className="constraint-ribbon">
        {placeholders.map(({ origin, label, icon: Icon }, index) => {
          const item = evidence.find(
            (candidate) => candidate.origin === origin,
          );
          const loading = stage === "querying" && evidence.length <= index;
          return (
            <article
              className={`evidence-card origin-${origin} ${item ? "arrived" : ""}`}
              key={origin}
            >
              <div className="evidence-icon">
                {loading ? (
                  <span className="mini-loader" />
                ) : (
                  <Icon size={16} />
                )}
              </div>
              <div>
                <span>{item ? item.label : label}</span>
                <strong>
                  {item
                    ? item.value
                    : loading
                      ? "Querying origin…"
                      : "Waiting for tool"}
                </strong>
                <small>
                  {item ? item.detail : "Awaiting partner response"}
                </small>
              </div>
              {item && <BadgeCheck size={15} />}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RouteMap({
  stage,
  winner,
  order,
}: {
  stage: string;
  winner?: RecoveryCandidate;
  order?: OrderRecord;
}) {
  return (
    <section className="route-card">
      <div className="route-card-head">
        <div>
          <span>RECOVERY ROUTE</span>
          <h2>
            {stage === "simulating"
              ? "Calculating feasible allocations…"
              : winner
                ? `${winner.totalUnits} units · ${formatDate(winner.arrivesAt)}`
                : "Cross-company recovery path"}
          </h2>
        </div>
        {winner && (
          <span className="arrival-badge">
            <Clock3 size={12} />
            {winner.hoursBeforeDeadline}h before deadline
          </span>
        )}
      </div>
      <div className="dynamic-route">
        {winner ? (
          <>
            <div className="allocation-list">
              {winner.inventoryAllocations.map((lot) => (
                <article key={lot.lotId}>
                  <PackageCheck size={20} />
                  <div>
                    <strong>{lot.supplier}</strong>
                    <small>{lot.lotId}</small>
                  </div>
                  <b>{lot.quantity} units</b>
                </article>
              ))}
            </div>
            <div className="route-destination">
              <Truck size={24} />
              <div>
                <strong>{winner.routeId}</strong>
                <small>
                  +{winner.addedLogisticsCostPct}% logistics ·{" "}
                  {formatDate(winner.arrivesAt)}
                </small>
              </div>
              <ArrowRight size={18} />
              <div>
                <strong>{order?.destination}</strong>
                <small>{winner.totalUnits} units reserved on approval</small>
              </div>
            </div>
          </>
        ) : (
          <div className="route-empty-state">
            <Route size={28} />
            <p>
              Current stock, matching lanes, and buyer constraints will
              determine this route.
            </p>
          </div>
        )}
      </div>
      <div className="route-legend">
        <span>
          <ShieldCheck size={11} />
          Availability rechecked before approval
        </span>
      </div>
    </section>
  );
}

function RouteNode({
  className,
  icon,
  eyebrow,
  title,
  value,
}: {
  className: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  value: string;
}) {
  return (
    <div className={`route-node ${className}`}>
      <span className="route-node-icon">{icon}</span>
      <div>
        <small>{eyebrow}</small>
        <strong>{title}</strong>
        <span>{value}</span>
      </div>
    </div>
  );
}

function PlanSummary({
  candidate,
  transaction,
  planner,
  costCap,
}: {
  candidate: RecoveryCandidate;
  transaction?: StagedTransaction;
  planner?: typeof initialRoomState.planner;
  costCap: number;
}) {
  return (
    <div className="plan-summary">
      {planner && (
        <div className="planner-note">
          <Sparkles size={13} />
          <p>{planner.narrative}</p>
        </div>
      )}
      <div className="plan-metrics">
        <div>
          <span>Units</span>
          <strong>{candidate.totalUnits}</strong>
          <small>100% protected</small>
        </div>
        <div>
          <span>Arrival</span>
          <strong>{formatDate(candidate.arrivesAt)}</strong>
          <small>{candidate.hoursBeforeDeadline}h early</small>
        </div>
        <div>
          <span>Added cost</span>
          <strong>+{candidate.addedLogisticsCostPct}%</strong>
          <small>{costCap - candidate.addedLogisticsCostPct}% headroom</small>
        </div>
      </div>
      <div className="transaction-sequence">
        <span className="sequence-label">ORDERED TRANSACTION</span>
        {(transaction?.steps ?? []).map((step, index) => (
          <div className={`sequence-step status-${step.status}`} key={step.id}>
            <span className="step-number">
              {step.status === "succeeded" ? <Check size={11} /> : index + 1}
            </span>
            <div>
              <strong>{step.label}</strong>
              <small>
                {step.origin} ·{" "}
                {step.status === "pending"
                  ? "stage → validate → commit"
                  : step.status}
              </small>
            </div>
            <span className="rollback-badge">Rollback</span>
          </div>
        ))}
      </div>
      <div className="plan-guardrails">
        <div>
          <ShieldCheck size={14} />
          <span>
            <strong>All constraints satisfied</strong>
            <small>
              Deadline, quantity, capacity, cost, and minimum lot rules
            </small>
          </span>
        </div>
        <div>
          <RefreshCcw size={14} />
          <span>
            <strong>Compensating actions ready</strong>
            <small>Completed steps reverse if a later commit fails</small>
          </span>
        </div>
      </div>
    </div>
  );
}

function EmptyPlan() {
  return (
    <div className="empty-plan">
      <span className="empty-plan-icon">
        <Sparkles size={22} />
      </span>
      <h3>No plan proposed yet</h3>
      <p>
        RelayRoom will query the smallest safe capability on each partner origin
        before proposing a change.
      </p>
      <div>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function PortalFrame({
  kind,
  label,
  origin,
  iframeRef,
  pulse,
  onLoad,
}: {
  kind: "buyer" | "supplier" | "carrier";
  label: string;
  origin: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  pulse: boolean;
  onLoad: () => void;
}) {
  return (
    <article className={`portal-frame portal-${kind} ${pulse ? "pulse" : ""}`}>
      <header>
        <div>
          <i />
          <strong>{label}</strong>
          <span>{origin}</span>
        </div>
        <span className="portal-live">
          <i /> LIVE
        </span>
      </header>
      <iframe
        ref={iframeRef}
        src={origin}
        title={`${label} partner portal`}
        allow="tools"
        onLoad={onLoad}
      />
    </article>
  );
}

function ToolPopover({
  tools,
  mode,
  onClose,
}: {
  tools: DiscoveredTool[];
  mode: string;
  onClose: () => void;
}) {
  return (
    <div className="tool-popover">
      <div className="popover-head">
        <div>
          <strong>Discovered capabilities</strong>
          <span>
            {mode === "native"
              ? "Browser-native WebMCP"
              : "Origin-checked compatibility bridge"}
          </span>
        </div>
        <button onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      {tools.length ? (
        <div className="popover-tools">
          {tools.map((tool) => (
            <div key={`${tool.origin}-${tool.name}`}>
              <span
                className={`tool-origin-dot origin-${tool.origin.includes("4174") ? "buyer" : tool.origin.includes("4175") ? "supplier" : "carrier"}`}
              />
              <div>
                <strong>{tool.name}</strong>
                <small>{tool.origin}</small>
              </div>
              <span>{tool.annotations?.readOnlyHint ? "READ" : "WRITE"}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="no-tools">Waiting for partner iframes…</p>
      )}
    </div>
  );
}

function AuditDrawer({
  events,
  transaction,
  candidate,
  stage,
  canExport,
  onLocked,
  onClose,
}: {
  events: ToolAuditEvent[];
  transaction?: StagedTransaction;
  candidate?: RecoveryCandidate;
  stage: string;
  canExport: boolean;
  onLocked: () => void;
  onClose: () => void;
}) {
  const success = stage === "success";
  const rolledBack = stage === "rollback";
  const [exportError, setExportError] = useState("");
  const exportAudit = async () => {
    try {
      setExportError("");
      const persisted = transaction
        ? await workspaceApi<AuditPayload>(
            `/transactions/${encodeURIComponent(transaction.id)}/audit`,
          )
        : undefined;
      const blob = new Blob(
        [JSON.stringify({ transaction, events, persisted }, null, 2)],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `relayroom-${transaction?.id ?? "audit"}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed");
    }
  };
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="audit-drawer"
        aria-modal="true"
        role="dialog"
        aria-label="Transaction audit receipt"
      >
        <header>
          <div>
            <span className="receipt-mark">
              <FileCheck2 size={18} />
            </span>
            <div>
              <span>AUDIT RECEIPT</span>
              <h2>
                {success
                  ? "Coordinated change complete"
                  : rolledBack
                    ? "Rollback verified"
                    : "Tool activity"}
              </h2>
            </div>
          </div>
          <button onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div
          className={`receipt-status ${success ? "success" : rolledBack ? "rolledback" : ""}`}
        >
          <span>
            {success ? (
              <CheckCircle2 size={24} />
            ) : rolledBack ? (
              <RefreshCcw size={24} />
            ) : (
              <Clock3 size={24} />
            )}
          </span>
          <div>
            <strong>
              {success
                ? `${transaction?.caseId} recovered`
                : rolledBack
                  ? "Original state restored"
                  : "Execution trace"}
            </strong>
            <small>
              {success
                ? `${candidate?.totalUnits} units · ${formatDate(candidate?.arrivesAt)}`
                : rolledBack
                  ? "Committed partner actions were compensated in reverse order"
                  : `${events.length} origin-scoped events recorded`}
            </small>
          </div>
        </div>
        <div className="receipt-meta">
          <div>
            <span>Transaction</span>
            <strong>{transaction?.id ?? "Not started"}</strong>
          </div>
          <div>
            <span>Authorization</span>
            <strong>Local user approval</strong>
          </div>
          <div>
            <span>Integrity</span>
            <strong>
              <ShieldCheck size={11} /> Origin verified
            </strong>
          </div>
        </div>
        <div className="audit-events">
          <div className="audit-events-head">
            <span>TOOL EXECUTION LOG</span>
            <b>{events.length} EVENTS</b>
          </div>
          {events.length ? (
            events.map((event) => (
              <article key={event.id}>
                <span className={`audit-result ${event.result}`}>
                  <Check size={11} />
                </span>
                <div>
                  <div>
                    <strong>{event.tool}</strong>
                    <time>
                      {new Date(event.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </time>
                  </div>
                  <span>{event.origin}</span>
                  <small>{event.inputSummary}</small>
                  <p>{event.resultSummary}</p>
                </div>
              </article>
            ))
          ) : (
            <div className="audit-empty">
              No tools have run in this session.
            </div>
          )}
        </div>
        <footer>
          {exportError && <p role="alert">{exportError}</p>}
          <button onClick={canExport ? () => void exportAudit() : onLocked}>
            {canExport ? <Download size={14} /> : <LockKeyhole size={14} />}{" "}
            {canExport ? "Export audit JSON" : "Unlock audit export"}
          </button>
          <span>
            <LockKeyhole size={10} /> Partner confirmations persisted
            server-side
          </span>
        </footer>
      </aside>
    </div>
  );
}

function AccessModal({
  demo,
  user,
  entitlements,
  error,
  loading,
  onLogin,
  onLogout,
  onCheckout,
  onGrantDevPro,
  onClose,
}: {
  demo: boolean;
  user?: SessionUser;
  entitlements?: Entitlements;
  error?: string;
  loading: boolean;
  onLogin: (email: string, password: string) => Promise<SessionUser>;
  onLogout: () => void;
  onCheckout: () => Promise<void>;
  onGrantDevPro: () => Promise<void>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setLocalError(undefined);
    try {
      await action();
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="access-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="access-modal"
        role="dialog"
        aria-modal="true"
        aria-label="RelayRoom access"
      >
        <button className="access-close" onClick={onClose}>
          <X size={15} />
        </button>
        <div className="access-brand">
          <span className="access-logo">
            <Sparkles size={20} />
          </span>
          <span>RELAYROOM PRO</span>
          <h2>
            {entitlements?.allAccess
              ? "Every partner. Every recovery tool."
              : "Resolve across company lines."}
          </h2>
          <p>
            {entitlements?.allAccess
              ? `Signed in as ${user?.name}. Your ${entitlements.source === "admin-bypass" ? "admin account bypasses billing and" : "Polar subscription"} unlocks every paid feature.`
              : "Coordinate cross-origin recovery plans, approve staged commits, rehearse rollbacks, and export the audit trail."}
          </p>
        </div>
        {loading ? (
          <div className="access-loading">
            <span className="mini-loader" /> Restoring session…
          </div>
        ) : user ? (
          <>
            <div className="account-card">
              <span className="account-avatar">
                {user.name
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div>
                <strong>{user.name}</strong>
                <small>{user.email}</small>
              </div>
              <span className={`account-plan plan-${user.plan}`}>
                {user.plan}
              </span>
            </div>
            <div className="feature-list">
              <div>
                <CheckCircle2 size={15} />
                <span>
                  <strong>Cross-origin recovery</strong>
                  <small>Discover and execute partner capabilities</small>
                </span>
              </div>
              <div>
                <CheckCircle2 size={15} />
                <span>
                  <strong>Coordinated commit + rollback</strong>
                  <small>Approval gate, idempotency, compensation</small>
                </span>
              </div>
              <div>
                <CheckCircle2 size={15} />
                <span>
                  <strong>Audit receipt export</strong>
                  <small>Origin, input, result, and timestamp</small>
                </span>
              </div>
            </div>
            {entitlements?.allAccess ? (
              <button className="access-primary" onClick={onClose}>
                <Check size={15} /> Continue with all access
              </button>
            ) : (
              <button
                className="access-primary polar-button"
                disabled={busy}
                onClick={() => void act(onCheckout)}
              >
                <CircleDollarSign size={15} /> Upgrade securely with Polar
              </button>
            )}
            {demo && !entitlements?.allAccess && (
              <button
                className="dev-pro-button"
                disabled={busy}
                onClick={() => void act(onGrantDevPro)}
              >
                <Zap size={13} /> Simulate successful Polar webhook (dev)
              </button>
            )}
            <button
              className="access-secondary"
              onClick={() => {
                onLogout();
                setEmail("");
                setPassword("");
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void act(() => onLogin(email, password));
            }}
          >
            <label>
              Email
              <input
                value={email}
                type="email"
                autoComplete="username"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                value={password}
                type="password"
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className="access-primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            {demo && (
              <div className="demo-accounts">
                <span>DEMO ACCOUNTS</span>
                <button
                  type="button"
                  onClick={() => {
                    setEmail("admin@relayroom.local");
                    setPassword("relay-admin-local");
                  }}
                >
                  <strong>Hector admin</strong>
                  <small>All paid features · billing bypass</small>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEmail("operator@relayroom.local");
                    setPassword("relay-demo-local");
                  }}
                >
                  <strong>Free operator</strong>
                  <small>Shows the Polar paywall</small>
                </button>
              </div>
            )}
          </form>
        )}
        {(localError || error) && (
          <div className="access-error">{localError || error}</div>
        )}
        <footer>
          <span>
            <ShieldCheck size={11} /> Entitlements checked server-side
          </span>
          <span className="polar-wordmark">
            Powered by <b>Polar</b>
          </span>
        </footer>
      </section>
    </div>
  );
}

function getStatusCopy(stage: string) {
  return (
    (
      {
        staging: "Staging all partners…",
        staged: "Validated",
        executing: "Executing approved steps…",
        success: "Change committed",
        rollback: "Rollback complete",
        simulating: "Simulating…",
        querying: "Querying partners…",
      } as Record<string, string>
    )[stage] ?? "Approve coordinated change"
  );
}

function useRoomTools({
  state,
  activeOrder,
  runRecovery,
  selectCandidate,
}: {
  activeOrder?: OrderRecord;
  state: typeof initialRoomState;
  runRecovery: () => Promise<void>;
  selectCandidate: (candidate: RecoveryCandidate) => void;
}) {
  const runRef = useRef(runRecovery);
  runRef.current = runRecovery;
  const selectRef = useRef(selectCandidate);
  selectRef.current = selectCandidate;
  useEffect(() => {
    if (!document.modelContext?.registerTool) return;
    const controller = new AbortController();
    const tools: WebMCPTool[] = [
      {
        name: "inspect_exception_case",
        description:
          "Return the active RelayRoom exception summary and exact partner origins.",
        inputSchema: {
          type: "object",
          properties: { caseId: { type: "string", minLength: 1 } },
          required: ["caseId"],
        },
        annotations: { readOnlyHint: true },
        execute: ({ caseId }) => {
          if (caseId !== activeOrder?.id)
            throw new Error("Select this order in the room first");
          return { case: activeOrder, partnerOrigins };
        },
      },
      {
        name: "simulate_recovery_plan",
        description:
          "Run the visible, cancellable recovery simulation from normalized partner evidence.",
        inputSchema: {
          type: "object",
          properties: {
            caseId: { type: "string" },
            objective: { type: "string" },
          },
          required: ["caseId", "objective"],
        },
        annotations: { readOnlyHint: true },
        execute: async (_input, { signal }) => {
          if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
          await runRef.current();
          return { status: "rendered-in-room" };
        },
      },
      {
        name: "get_transaction_status",
        description:
          "Return ordered transaction status and available rollback steps.",
        inputSchema: {
          type: "object",
          properties: { transactionId: { type: "string" } },
          required: ["transactionId"],
        },
        annotations: { readOnlyHint: true },
        execute: () => state.transaction ?? { status: "not-started" },
      },
    ];
    if (state.candidates.length)
      tools.push({
        name: "select_recovery_plan",
        description:
          "Select a feasible candidate and render its visible transaction preview.",
        inputSchema: {
          type: "object",
          properties: { candidateId: { type: "string" } },
          required: ["candidateId"],
        },
        execute: ({ candidateId }) => {
          const candidate = state.candidates.find(
            (item) => item.id === candidateId,
          );
          if (!candidate?.feasible)
            throw new Error("FEASIBLE_CANDIDATE_NOT_FOUND");
          selectRef.current(candidate);
          return { selected: candidate.id, status: "preview-rendered" };
        },
      });
    async function registerTools() {
      try {
        await Promise.all(
          tools.map((tool) =>
            document.modelContext!.registerTool(tool, {
              signal: controller.signal,
            }),
          ),
        );
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        )
          return;
        console.info("[RelayRoom] Room tool registration unavailable.", error);
      }
    }
    void registerTools();
    return () => controller.abort();
  }, [state.candidates, state.transaction, activeOrder]);
}
