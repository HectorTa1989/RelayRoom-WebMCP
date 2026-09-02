import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useReducer, useRef, useState, } from "react";
import { ArrowRight, BadgeCheck, Box, Building2, Check, CheckCircle2, ChevronDown, CircleDollarSign, Clock3, Command, Download, ExternalLink, FileCheck2, GitBranch, Github, LockKeyhole, PackageCheck, RefreshCcw, Route, ShieldCheck, Sparkles, Truck, UserRound, Wifi, X, Zap, } from "lucide-react";
import { makeOrigins, } from "@relayroom/contracts";
import { createTransaction, executeCoordinatedTransaction, } from "@relayroom/simulator";
import { CrossOriginToolClient } from "./orchestration";
import { initialRoomState, roomReducer } from "./state";
import { useAuth, workspaceApi, } from "./auth";
import { OperationsManager } from "./OperationsManager";
const formatDate = (value) => value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
    : "—";
const roomEnv = import.meta
    .env;
const BUYER_ORIGIN = roomEnv?.VITE_BUYER_ORIGIN || "http://localhost:4174";
const SUPPLIER_ORIGIN = roomEnv?.VITE_SUPPLIER_ORIGIN || "http://localhost:4175";
const CARRIER_ORIGIN = roomEnv?.VITE_CARRIER_ORIGIN || "http://localhost:4176";
const partnerOrigins = {
    buyer: BUYER_ORIGIN,
    supplier: SUPPLIER_ORIGIN,
    carrier: CARRIER_ORIGIN,
};
const origins = makeOrigins(window.location.origin);
function wait(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted)
            return reject(new DOMException("Cancelled", "AbortError"));
        const timeout = window.setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            window.clearTimeout(timeout);
            reject(new DOMException("Cancelled", "AbortError"));
        }, { once: true });
    });
}
function originForPartner(partner) {
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
    const [workspace, setWorkspace] = useState();
    const [selectedOrderId, setSelectedOrderId] = useState("");
    const [showManager, setShowManager] = useState(false);
    const activeOrder = workspace?.orders.find((order) => order.id === selectedOrderId) ??
        workspace?.orders[0];
    const objective = activeOrder
        ? `Recover ${activeOrder.id}: deliver ${activeOrder.quantity} units to ${activeOrder.destination} by ${formatDate(activeOrder.neededBy)}, with added logistics cost no higher than ${activeOrder.maxAddedLogisticsCostPct}%.`
        : "Create or import an order to plan a recovery.";
    const executionBusy = useRef(false);
    const refreshWorkspace = useCallback(async (id) => {
        const next = await workspaceApi("/workspace");
        setWorkspace(next);
        if (id)
            setSelectedOrderId(id);
        return next;
    }, []);
    useEffect(() => {
        if (!auth.user) {
            setWorkspace(undefined);
            dispatch({ type: "reset" });
            return;
        }
        void refreshWorkspace().catch((error) => dispatch({ type: "error", message: error.message }));
    }, [auth.user?.id, refreshWorkspace]);
    const buyerRef = useRef(null);
    const supplierRef = useRef(null);
    const carrierRef = useRef(null);
    const frames = {
        buyer: buyerRef,
        supplier: supplierRef,
        carrier: carrierRef,
    };
    const clientRef = useRef(undefined);
    const flowAbortRef = useRef(undefined);
    useEffect(() => {
        const client = new CrossOriginToolClient(() => ({
            buyer: buyerRef.current,
            supplier: supplierRef.current,
            carrier: carrierRef.current,
        }), partnerOrigins);
        clientRef.current = client;
        return () => client.destroy();
    }, []);
    const discover = useCallback(async () => {
        if (!clientRef.current)
            return [];
        const result = await clientRef.current.discover();
        dispatch({ type: "tools", tools: result.tools, mode: result.mode });
        return result.tools;
    }, []);
    useEffect(() => {
        if (framesReady < 3)
            return;
        const timeout = window.setTimeout(() => void discover(), 120);
        return () => window.clearTimeout(timeout);
    }, [discover, framesReady]);
    useEffect(() => {
        if (framesReady < 3 || executionBusy.current)
            return;
        void clientRef.current
            ?.setSession(workspace?.tokens ?? {}, activeOrder)
            .catch((error) => dispatch({ type: "error", message: error.message }));
    }, [framesReady, workspace?.tokens, activeOrder?.id]);
    const pulsePartner = useCallback((partner) => {
        dispatch({ type: "pulse", partner });
        window.setTimeout(() => dispatch({ type: "pulse" }), 700);
    }, []);
    const addAudit = useCallback((tool, partner, input, result, resultSummary, transactionId) => {
        const event = {
            id: crypto.randomUUID(),
            transactionId,
            tool,
            origin: originForPartner(partner),
            inputSummary: Object.entries(input)
                .slice(0, 3)
                .map(([key, value]) => `${key}: ${Array.isArray(value) ? `${value.length} item(s)` : String(value)}`)
                .join(" · "),
            result,
            resultSummary,
            timestamp: new Date().toISOString(),
        };
        dispatch({ type: "audit", event });
    }, []);
    const callTool = useCallback(async (tool, partner, input, signal, transactionId) => {
        if (!clientRef.current)
            throw new Error("Partner tool client is not ready");
        pulsePartner(partner);
        try {
            const result = await clientRef.current.execute(tool, input, signal);
            addAudit(tool, partner, input, "success", "Partner returned a validated result", transactionId);
            return result;
        }
        catch (error) {
            const cancelled = error instanceof DOMException && error.name === "AbortError";
            addAudit(tool, partner, input, cancelled ? "cancelled" : "error", error instanceof Error ? error.message : "Unknown error", transactionId);
            throw error;
        }
    }, [addAudit, pulsePartner]);
    const runRecovery = useCallback(async () => {
        if (!activeOrder || executionBusy.current)
            return;
        flowAbortRef.current?.abort();
        const controller = new AbortController();
        flowAbortRef.current = controller;
        dispatch({ type: "reset" });
        dispatch({ type: "stage", stage: "querying" });
        try {
            const current = await refreshWorkspace();
            await clientRef.current.setSession(current.tokens, activeOrder);
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
            const missing = required.filter((name) => !tools.some((tool) => tool.name === name));
            if (missing.length)
                throw new Error(`Partner unavailable: ${missing.join(", ")}`);
            const [buyer, supplier, carrier] = await Promise.all([
                callTool("get_order_constraints", "buyer", { caseId: activeOrder.id }, controller.signal),
                wait(180, controller.signal).then(() => callTool("get_inventory_options", "supplier", { sku: activeOrder.sku, location: activeOrder.origin }, controller.signal)),
                wait(360, controller.signal).then(() => callTool("get_route_options", "carrier", {
                    origin: activeOrder.origin,
                    destination: activeOrder.destination,
                    units: activeOrder.quantity,
                }, controller.signal)),
            ]);
            const constraints = {
                caseId: String(buyer.caseId),
                quantity: Number(buyer.quantity),
                neededBy: String(buyer.neededBy),
                maxAddedLogisticsCostPct: Number(buyer.maxAddedLogisticsCostPct),
                allowLateSplit: Boolean(buyer.allowLateSplit),
                destination: String(buyer.destination),
            };
            const inventory = Array.isArray(supplier.options)
                ? supplier.options
                : [];
            const routes = Array.isArray(carrier.options)
                ? carrier.options
                : [];
            if (!constraints.caseId ||
                !Number.isFinite(constraints.quantity) ||
                inventory.length === 0 ||
                routes.length === 0)
                throw new Error("Partner evidence failed normalization");
            const combinedUnits = inventory.reduce((total, option) => total + option.availableUnits, 0);
            const backup = inventory.find((option) => option.source === "backup");
            const priority = [...routes].sort((a, b) => Date.parse(a.arrivesAt) - Date.parse(b.arrivesAt))[0];
            const evidence = [
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
            evidence.forEach((item) => dispatch({ type: "evidence", evidence: item }));
            dispatch({ type: "stage", stage: "simulating" });
            await wait(350, controller.signal);
            const plan = await auth.planRecovery({ objective, constraints, inventory, routes }, controller.signal);
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
            const winner = candidates.find((candidate) => candidate.id === plan.selectedCandidateId && candidate.feasible);
            if (!winner)
                throw new Error("No feasible recovery plan satisfies all partner constraints");
            const transaction = createTransaction(winner, new Date(), activeOrder.id);
            dispatch({ type: "select", candidate: winner, transaction });
            clientRef.current?.broadcastPhase("selected");
            clientRef.current?.clearNativeCache();
            await wait(180, controller.signal);
            await discover();
        }
        catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                dispatch({
                    type: "error",
                    message: "Recovery simulation cancelled cleanly.",
                });
            }
            else
                dispatch({
                    type: "error",
                    message: error instanceof Error ? error.message : "Recovery planning failed",
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
            if (auth.user?.role === "admin")
                setShowManager(true);
            return;
        }
        void runRecovery();
    }, [auth.entitlements, auth.user, activeOrder, runRecovery]);
    const approveAndExecute = useCallback(async (resumeId, releaseOnly = false) => {
        if (!auth.entitlements?.features.coordinatedCommit &&
            !(resumeId && releaseOnly)) {
            setShowAccess(true);
            return;
        }
        if (executionBusy.current || !clientRef.current)
            return;
        if (!resumeId && (!state.selected || !state.transaction || !activeOrder))
            return;
        executionBusy.current = true;
        dispatch({ type: "stage", stage: "staging" });
        let approval;
        try {
            const response = resumeId
                ? await workspaceApi(`/transactions/${encodeURIComponent(resumeId)}`)
                : await workspaceApi("/approvals", {
                    transactionId: state.transaction.id,
                    caseId: activeOrder.id,
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
            const base = createTransaction(approved.candidate, new Date(approved.approvedAt), approved.order.id);
            base.id = approved.transactionId;
            base.approvedAt = approved.approvedAt;
            dispatch({
                type: "select",
                candidate: approved.candidate,
                transaction: base,
            });
            dispatch({ type: "stage", stage: "executing" });
            const run = async (command) => {
                const input = {
                    transactionId: base.id,
                    idempotencyKey: `${base.id}:${command.step.origin}:${command.phase}`,
                };
                if (command.phase === "stage") {
                    if (command.step.origin === "supplier")
                        input.allocations = approved.candidate.inventoryAllocations;
                    else if (command.step.origin === "carrier") {
                        input.routeId = approved.candidate.routeId;
                        input.units = approved.order.quantity;
                    }
                    else {
                        input.caseId = approved.order.id;
                        input.arrivals = [
                            {
                                quantity: approved.order.quantity,
                                arrivesAt: approved.candidate.arrivesAt,
                            },
                        ];
                    }
                }
                else if (command.phase === "commit")
                    input.stageId = command.step.stageId;
                const result = await callTool(command.tool, command.step.origin, input, undefined, base.id);
                const id = command.phase === "commit" ? result.resultId : result.stageId;
                if (typeof id !== "string" || !id)
                    throw new Error("Partner did not confirm an operation ID");
                return { id };
            };
            let result;
            if (releaseOnly) {
                result = structuredClone(base);
                result.status = "rolled-back";
                for (const step of [...result.steps].reverse()) {
                    const rollback = result.rollback.find((x) => x.origin === step.origin);
                    try {
                        await run({ step, phase: "rollback", tool: rollback.tool });
                        rollback.status = "rolled-back";
                        step.status = "rolled-back";
                    }
                    catch {
                        rollback.status = "failed";
                        result.status = "failed";
                    }
                }
            }
            else
                result = await executeCoordinatedTransaction(base, run);
            const verified = await workspaceApi(`/transactions/${encodeURIComponent(base.id)}/reconcile`, {});
            if (verified.status !== "committed" &&
                verified.status !== "rolled-back")
                result.status = "failed";
            dispatch({ type: "transaction", transaction: result });
            dispatch({
                type: "stage",
                stage: verified.status === "committed"
                    ? "success"
                    : verified.status === "rolled-back"
                        ? "rollback"
                        : "ready",
            });
            if (result.status === "failed")
                dispatch({
                    type: "error",
                    message: "Recovery needs attention. Use Release to retry compensation; inspect provider records if a connector result is unknown.",
                });
            clientRef.current.broadcastPhase(verified.status === "committed" ? "committed" : "selected");
            setShowAudit(true);
        }
        catch (error) {
            dispatch({ type: "stage", stage: "ready" });
            dispatch({
                type: "error",
                message: error instanceof Error
                    ? error.message
                    : "Execution interrupted. Resume the saved transaction.",
            });
        }
        finally {
            executionBusy.current = false;
            try {
                await refreshWorkspace();
            }
            catch {
                /* Keep the transaction visible when a partner is unavailable. */
            }
        }
    }, [
        auth.entitlements,
        state.selected,
        state.transaction,
        state.failureRehearsal,
        activeOrder,
        callTool,
        discover,
        refreshWorkspace,
    ]);
    const viewReceipt = async (id) => {
        try {
            const receipt = await workspaceApi(`/transactions/${encodeURIComponent(id)}/audit`);
            const tx = createTransaction(receipt.approval.candidate, new Date(receipt.approval.approvedAt), receipt.approval.order.id);
            tx.id = id;
            tx.approvedAt = receipt.approval.approvedAt;
            const complete = receipt.partners.every((x) => x.operation?.status === "committed");
            const released = receipt.partners.every((x) => x.operation?.status === "released");
            tx.status = complete ? "committed" : released ? "rolled-back" : "failed";
            for (const step of tx.steps) {
                const op = receipt.partners.find((x) => x.partner === step.origin)?.operation;
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
        }
        catch (error) {
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
    const winner = state.selected ?? state.candidates.find((candidate) => candidate.feasible);
    const isBusy = ["querying", "simulating", "staging", "executing"].includes(state.stage);
    const statusCopy = getStatusCopy(state.stage);
    const connectedOrigins = origins.filter((origin) => origin.id !== "room");
    return (_jsxs("div", { className: "room-app", children: [_jsxs("header", { className: "global-header", children: [_jsxs("div", { className: "wordmark", children: [_jsxs("span", { className: "relay-logo", children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }), _jsx("strong", { children: "RelayRoom" }), _jsx("span", { className: "beta", children: "BETA" })] }), _jsxs("nav", { className: "header-nav", "aria-label": "Primary", children: [_jsx("button", { className: "active", children: "Coordination room" }), _jsx("button", { onClick: () => setShowAudit(true), children: "Audit" }), _jsxs("a", { href: "https://github.com/HectorTa1989", target: "_blank", rel: "noreferrer", children: ["Docs ", _jsx(ExternalLink, { size: 11 })] })] }), _jsxs("div", { className: "header-actions", children: [_jsxs("button", { className: `plan-badge source-${auth.entitlements?.source ?? "free"}`, onClick: () => setShowAccess(true), children: [_jsx(Zap, { size: 11 }), " ", auth.user
                                        ? auth.entitlements?.allAccess
                                            ? `${auth.user.plan === "admin" ? "Admin" : "Pro"} · All access`
                                            : "Free plan"
                                        : "Sign in", " "] }), _jsxs("button", { className: "avatar-button", "aria-label": "Account", onClick: () => setShowAccess(true), children: [_jsx("span", { children: auth.user ? (auth.user.name
                                            .split(" ")
                                            .map((part) => part[0])
                                            .slice(0, 2)
                                            .join("")) : (_jsx(UserRound, { size: 13 })) }), _jsx(ChevronDown, { size: 12 })] })] })] }), _jsxs("div", { className: "trust-bar", children: [_jsxs("div", { className: "trust-title", children: [_jsx(ShieldCheck, { size: 14 }), _jsx("span", { children: "Trusted origin boundary" })] }), _jsx("div", { className: "origin-list", children: connectedOrigins.map((origin) => (_jsxs("span", { className: "origin-chip", children: [_jsx("i", { style: { background: origin.color } }), _jsx("span", { children: origin.origin.replace(/^https?:\/\//, "") }), _jsx("b", { children: state.tools.filter((tool) => tool.origin === origin.origin)
                                        .length })] }, origin.id))) }), _jsxs("button", { className: "runtime-button", onClick: () => setToolPopover((current) => !current), children: [_jsx(Wifi, { size: 12 }), _jsx("span", { children: state.mode === "native" ? "Native WebMCP" : "Compatibility bridge" }), _jsx(ChevronDown, { size: 11 })] }), toolPopover && (_jsx(ToolPopover, { tools: state.tools, mode: state.mode, onClose: () => setToolPopover(false) }))] }), _jsxs("main", { className: "room-main", children: [_jsxs("div", { className: "workspace-controls", children: [_jsxs("label", { children: ["Active order", _jsxs("select", { "aria-label": "Active order", disabled: isBusy, value: activeOrder?.id ?? "", onChange: (event) => {
                                            setSelectedOrderId(event.target.value);
                                            dispatch({ type: "reset" });
                                            clientRef.current?.broadcastPhase("idle");
                                        }, children: [_jsx("option", { value: "", disabled: true, children: auth.user
                                                    ? "Create your first order"
                                                    : "Sign in to load orders" }), workspace?.orders.map((order) => (_jsxs("option", { value: order.id, children: [order.id, " \u00B7 ", order.productName, " \u00B7 ", order.status] }, order.id)))] })] }), _jsx("div", { className: "integration-status", children: workspace?.integrations.map((item) => (_jsxs("span", { children: [item.partner, ":", " ", item.available
                                            ? item.mode === "remote"
                                                ? "External connector"
                                                : "Local operations"
                                            : "Unavailable"] }, item.partner))) }), auth.user?.role === "admin" && (_jsx("button", { disabled: isBusy, onClick: () => setShowManager(true), children: "Manage operations" }))] }), !!workspace?.transactions.length && (_jsxs("section", { className: "pending-recoveries", children: [_jsx("strong", { children: "Recovery history" }), workspace.transactions.map((t) => (_jsxs("div", { children: [_jsxs("span", { children: [t.caseId, " \u00B7 ", t.status, _jsx("small", { children: t.id })] }), ["committed", "rolled-back"].includes(t.status) ? (_jsx("button", { disabled: isBusy, onClick: () => void viewReceipt(t.id), children: "View receipt" })) : (_jsxs(_Fragment, { children: [_jsx("button", { disabled: isBusy, onClick: () => void approveAndExecute(t.id), children: "Resume" }), _jsx("button", { disabled: isBusy, onClick: () => void approveAndExecute(t.id, true), children: "Release reservations" })] }))] }, t.id)))] })), _jsxs("section", { className: "case-hero", children: [_jsxs("div", { className: "case-heading", children: [_jsxs("div", { className: "case-kicker", children: [_jsx("span", { className: "live-dot" }), " ACTIVE EXCEPTION", " ", _jsx("b", { children: activeOrder?.id ?? "NO ORDER SELECTED" })] }), _jsx("h1", { children: activeOrder ? (_jsxs(_Fragment, { children: ["Protect your ", _jsxs("em", { children: [activeOrder.quantity, "-unit"] }), " delivery."] })) : (_jsxs(_Fragment, { children: ["Plan your next ", _jsx("em", { children: "recovery." })] })) }), _jsx("p", { children: "One disruption. Three companies. One coordinated recovery plan." })] }), _jsxs("div", { className: "case-stats", children: [_jsxs("div", { children: [_jsx("span", { children: "Deadline" }), _jsx("strong", { children: formatDate(activeOrder?.neededBy) }), _jsx("small", { children: "Hard arrival window" })] }), _jsxs("div", { children: [_jsx("span", { children: "Destination" }), _jsx("strong", { children: activeOrder?.destination ?? "—" }), _jsx("small", { children: activeOrder?.sku ?? "No SKU selected" })] }), _jsxs("div", { children: [_jsx("span", { children: "Cost guardrail" }), _jsx("strong", { children: activeOrder
                                                    ? `≤ ${activeOrder.maxAddedLogisticsCostPct}%`
                                                    : "—" }), _jsx("small", { children: "Added logistics" })] })] })] }), _jsxs("section", { className: "prompt-card", children: [_jsx("div", { className: "prompt-icon", children: _jsx(Command, { size: 18 }) }), _jsxs("div", { className: "prompt-copy", children: [_jsx("span", { children: "OPERATIONS REQUEST" }), _jsx("p", { children: objective })] }), isBusy ? (["querying", "simulating"].includes(state.stage) ? (_jsxs("button", { className: "cancel-button", onClick: () => flowAbortRef.current?.abort(), children: [_jsx(X, { size: 15 }), " Cancel"] })) : (_jsx("span", { className: "execution-label", children: "Applying approved changes\u2026" }))) : (_jsxs("button", { className: "run-button", disabled: activeOrder?.status === "resolved", onClick: startRecovery, children: [_jsx(Sparkles, { size: 15 }), activeOrder?.status === "resolved"
                                        ? "Order resolved"
                                        : state.stage === "ready"
                                            ? "Resolve case"
                                            : "Run again", !auth.entitlements?.allAccess && _jsx(LockKeyhole, { size: 11 }), _jsx(ArrowRight, { size: 14 })] }))] }), state.error && (_jsxs("div", { className: "error-banner", children: [_jsx(ShieldCheck, { size: 15 }), _jsx("span", { children: state.error }), _jsx("button", { onClick: () => dispatch({ type: "error" }), children: _jsx(X, { size: 14 }) })] })), _jsxs("section", { className: "workspace-grid", children: [_jsxs("div", { className: "workspace-primary", children: [_jsx(ConstraintRibbon, { evidence: state.evidence, stage: state.stage }), _jsx(RouteMap, { stage: state.stage, winner: winner, order: activeOrder })] }), _jsxs("aside", { className: "plan-panel", children: [_jsxs("div", { className: "panel-head", children: [_jsxs("div", { children: [_jsx("span", { children: "COORDINATED PLAN" }), _jsx("h2", { children: winner ? winner.name : "Awaiting partner evidence" })] }), winner && (_jsxs("div", { className: "plan-pills", children: [_jsxs("span", { className: `planner-pill planner-${state.planner?.source ?? "deterministic"}`, children: [_jsx(Sparkles, { size: 10 }), state.planner?.source === "openai"
                                                                ? `OpenAI · ${state.planner.model}`
                                                                : state.planner?.source === "gemini"
                                                                    ? `Gemini · ${state.planner.model}`
                                                                    : "Deterministic"] }), _jsxs("span", { className: "feasible-pill", children: [_jsx(Check, { size: 11 }), " Feasible"] })] }))] }), winner ? (_jsx(PlanSummary, { candidate: winner, transaction: state.transaction, planner: state.planner, costCap: activeOrder?.maxAddedLogisticsCostPct ?? 0 })) : (_jsx(EmptyPlan, {})), _jsxs("div", { className: "approval-zone", children: [workspace?.demo && (_jsxs("label", { className: "failure-toggle", children: [_jsx("input", { type: "checkbox", checked: state.failureRehearsal, onChange: (event) => {
                                                            if (!auth.entitlements?.features.failureRehearsal) {
                                                                setShowAccess(true);
                                                                return;
                                                            }
                                                            dispatch({
                                                                type: "failure",
                                                                enabled: event.target.checked,
                                                            });
                                                        } }), _jsx("span", {}), _jsxs("div", { children: [_jsxs("strong", { children: ["Rehearse carrier failure", " ", !auth.entitlements?.features.failureRehearsal && (_jsx(LockKeyhole, { size: 8 }))] }), _jsx("small", { children: "Shows compensating rollback" })] })] })), _jsxs("button", { className: "approve-button", disabled: state.stage !== "preview", onClick: () => void approveAndExecute(), children: [_jsx(LockKeyhole, { size: 14 }), state.stage === "preview"
                                                        ? "Approve coordinated change"
                                                        : statusCopy] }), _jsxs("small", { className: "approval-note", children: [_jsx(ShieldCheck, { size: 11 }), " Signed approval is checked by every partner"] })] })] })] }), _jsxs("section", { className: "portal-section", children: [_jsxs("button", { className: "section-toggle", onClick: () => setShowPortals((current) => !current), children: [_jsxs("div", { children: [_jsx("span", { className: "section-index", children: "02" }), _jsxs("div", { children: [_jsx("strong", { children: "Live partner portals" }), _jsx("small", { children: "Actions execute inside the company that owns them" })] })] }), _jsx(ChevronDown, { className: showPortals ? "rotated" : "", size: 17 })] }), showPortals && (_jsxs("div", { className: "portal-grid", children: [_jsx(PortalFrame, { kind: "buyer", label: "Atlas Buyer", origin: BUYER_ORIGIN, iframeRef: buyerRef, pulse: state.partnerPulse === "buyer", onLoad: () => setFramesReady((value) => Math.min(3, value + 1)) }), _jsx(PortalFrame, { kind: "supplier", label: "Northstar Supply", origin: SUPPLIER_ORIGIN, iframeRef: supplierRef, pulse: state.partnerPulse === "supplier", onLoad: () => setFramesReady((value) => Math.min(3, value + 1)) }), _jsx(PortalFrame, { kind: "carrier", label: "Vector Freight", origin: CARRIER_ORIGIN, iframeRef: carrierRef, pulse: state.partnerPulse === "carrier", onLoad: () => setFramesReady((value) => Math.min(3, value + 1)) })] }))] })] }), _jsxs("footer", { className: "room-footer", children: [_jsxs("div", { children: [_jsx("span", { className: "footer-logo", children: _jsx(GitBranch, { size: 13 }) }), _jsx("span", { children: "Independent websites cooperating without surrendering control." })] }), _jsxs("div", { children: [_jsx("span", { children: "WebMCP build" }), _jsxs("a", { href: "https://github.com/HectorTa1989", target: "_blank", rel: "noreferrer", children: [_jsx(Github, { size: 13 }), " HectorTa1989"] })] })] }), showAudit && (_jsx(AuditDrawer, { events: state.audit, transaction: state.transaction, candidate: winner, stage: state.stage, canExport: Boolean(auth.entitlements?.features.auditExport), onLocked: () => setShowAccess(true), onClose: () => setShowAudit(false) })), showManager && (_jsx(OperationsManager, { onClose: () => setShowManager(false), onChanged: async (id) => {
                    await refreshWorkspace(id);
                } })), showAccess && (_jsx(AccessModal, { demo: Boolean(workspace?.demo), user: auth.user, entitlements: auth.entitlements, error: auth.error, loading: auth.loading, onLogin: auth.login, onLogout: auth.logout, onCheckout: auth.checkout, onGrantDevPro: auth.grantDevPro, onClose: () => setShowAccess(false) }))] }));
}
function ConstraintRibbon({ evidence, stage, }) {
    const placeholders = [
        { origin: "buyer", label: "Buyer constraints", icon: Building2 },
        { origin: "supplier", label: "Inventory options", icon: Box },
        { origin: "carrier", label: "Route options", icon: Truck },
    ];
    return (_jsxs("section", { className: "constraint-board", children: [_jsxs("div", { className: "subsection-head", children: [_jsxs("div", { children: [_jsx("span", { className: "section-index", children: "01" }), _jsxs("div", { children: [_jsx("strong", { children: "Shared constraint ribbon" }), _jsx("small", { children: "Only normalized tool results cross each origin boundary" })] })] }), _jsxs("span", { className: "evidence-count", children: [evidence.length, "/3 verified"] })] }), _jsx("div", { className: "constraint-ribbon", children: placeholders.map(({ origin, label, icon: Icon }, index) => {
                    const item = evidence.find((candidate) => candidate.origin === origin);
                    const loading = stage === "querying" && evidence.length <= index;
                    return (_jsxs("article", { className: `evidence-card origin-${origin} ${item ? "arrived" : ""}`, children: [_jsx("div", { className: "evidence-icon", children: loading ? (_jsx("span", { className: "mini-loader" })) : (_jsx(Icon, { size: 16 })) }), _jsxs("div", { children: [_jsx("span", { children: item ? item.label : label }), _jsx("strong", { children: item
                                            ? item.value
                                            : loading
                                                ? "Querying origin…"
                                                : "Waiting for tool" }), _jsx("small", { children: item ? item.detail : "Awaiting partner response" })] }), item && _jsx(BadgeCheck, { size: 15 })] }, origin));
                }) })] }));
}
function RouteMap({ stage, winner, order, }) {
    return (_jsxs("section", { className: "route-card", children: [_jsxs("div", { className: "route-card-head", children: [_jsxs("div", { children: [_jsx("span", { children: "RECOVERY ROUTE" }), _jsx("h2", { children: stage === "simulating"
                                    ? "Calculating feasible allocations…"
                                    : winner
                                        ? `${winner.totalUnits} units · ${formatDate(winner.arrivesAt)}`
                                        : "Cross-company recovery path" })] }), winner && (_jsxs("span", { className: "arrival-badge", children: [_jsx(Clock3, { size: 12 }), winner.hoursBeforeDeadline, "h before deadline"] }))] }), _jsx("div", { className: "dynamic-route", children: winner ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "allocation-list", children: winner.inventoryAllocations.map((lot) => (_jsxs("article", { children: [_jsx(PackageCheck, { size: 20 }), _jsxs("div", { children: [_jsx("strong", { children: lot.supplier }), _jsx("small", { children: lot.lotId })] }), _jsxs("b", { children: [lot.quantity, " units"] })] }, lot.lotId))) }), _jsxs("div", { className: "route-destination", children: [_jsx(Truck, { size: 24 }), _jsxs("div", { children: [_jsx("strong", { children: winner.routeId }), _jsxs("small", { children: ["+", winner.addedLogisticsCostPct, "% logistics \u00B7", " ", formatDate(winner.arrivesAt)] })] }), _jsx(ArrowRight, { size: 18 }), _jsxs("div", { children: [_jsx("strong", { children: order?.destination }), _jsxs("small", { children: [winner.totalUnits, " units reserved on approval"] })] })] })] })) : (_jsxs("div", { className: "route-empty-state", children: [_jsx(Route, { size: 28 }), _jsx("p", { children: "Current stock, matching lanes, and buyer constraints will determine this route." })] })) }), _jsx("div", { className: "route-legend", children: _jsxs("span", { children: [_jsx(ShieldCheck, { size: 11 }), "Availability rechecked before approval"] }) })] }));
}
function RouteNode({ className, icon, eyebrow, title, value, }) {
    return (_jsxs("div", { className: `route-node ${className}`, children: [_jsx("span", { className: "route-node-icon", children: icon }), _jsxs("div", { children: [_jsx("small", { children: eyebrow }), _jsx("strong", { children: title }), _jsx("span", { children: value })] })] }));
}
function PlanSummary({ candidate, transaction, planner, costCap, }) {
    return (_jsxs("div", { className: "plan-summary", children: [planner && (_jsxs("div", { className: "planner-note", children: [_jsx(Sparkles, { size: 13 }), _jsx("p", { children: planner.narrative })] })), _jsxs("div", { className: "plan-metrics", children: [_jsxs("div", { children: [_jsx("span", { children: "Units" }), _jsx("strong", { children: candidate.totalUnits }), _jsx("small", { children: "100% protected" })] }), _jsxs("div", { children: [_jsx("span", { children: "Arrival" }), _jsx("strong", { children: formatDate(candidate.arrivesAt) }), _jsxs("small", { children: [candidate.hoursBeforeDeadline, "h early"] })] }), _jsxs("div", { children: [_jsx("span", { children: "Added cost" }), _jsxs("strong", { children: ["+", candidate.addedLogisticsCostPct, "%"] }), _jsxs("small", { children: [costCap - candidate.addedLogisticsCostPct, "% headroom"] })] })] }), _jsxs("div", { className: "transaction-sequence", children: [_jsx("span", { className: "sequence-label", children: "ORDERED TRANSACTION" }), (transaction?.steps ?? []).map((step, index) => (_jsxs("div", { className: `sequence-step status-${step.status}`, children: [_jsx("span", { className: "step-number", children: step.status === "succeeded" ? _jsx(Check, { size: 11 }) : index + 1 }), _jsxs("div", { children: [_jsx("strong", { children: step.label }), _jsxs("small", { children: [step.origin, " \u00B7", " ", step.status === "pending"
                                                ? "stage → validate → commit"
                                                : step.status] })] }), _jsx("span", { className: "rollback-badge", children: "Rollback" })] }, step.id)))] }), _jsxs("div", { className: "plan-guardrails", children: [_jsxs("div", { children: [_jsx(ShieldCheck, { size: 14 }), _jsxs("span", { children: [_jsx("strong", { children: "All constraints satisfied" }), _jsx("small", { children: "Deadline, quantity, capacity, cost, and minimum lot rules" })] })] }), _jsxs("div", { children: [_jsx(RefreshCcw, { size: 14 }), _jsxs("span", { children: [_jsx("strong", { children: "Compensating actions ready" }), _jsx("small", { children: "Completed steps reverse if a later commit fails" })] })] })] })] }));
}
function EmptyPlan() {
    return (_jsxs("div", { className: "empty-plan", children: [_jsx("span", { className: "empty-plan-icon", children: _jsx(Sparkles, { size: 22 }) }), _jsx("h3", { children: "No plan proposed yet" }), _jsx("p", { children: "RelayRoom will query the smallest safe capability on each partner origin before proposing a change." }), _jsxs("div", { children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] })] }));
}
function PortalFrame({ kind, label, origin, iframeRef, pulse, onLoad, }) {
    return (_jsxs("article", { className: `portal-frame portal-${kind} ${pulse ? "pulse" : ""}`, children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("i", {}), _jsx("strong", { children: label }), _jsx("span", { children: origin })] }), _jsxs("span", { className: "portal-live", children: [_jsx("i", {}), " LIVE"] })] }), _jsx("iframe", { ref: iframeRef, src: origin, title: `${label} partner portal`, allow: "tools", onLoad: onLoad })] }));
}
function ToolPopover({ tools, mode, onClose, }) {
    return (_jsxs("div", { className: "tool-popover", children: [_jsxs("div", { className: "popover-head", children: [_jsxs("div", { children: [_jsx("strong", { children: "Discovered capabilities" }), _jsx("span", { children: mode === "native"
                                    ? "Browser-native WebMCP"
                                    : "Origin-checked compatibility bridge" })] }), _jsx("button", { onClick: onClose, children: _jsx(X, { size: 13 }) })] }), tools.length ? (_jsx("div", { className: "popover-tools", children: tools.map((tool) => (_jsxs("div", { children: [_jsx("span", { className: `tool-origin-dot origin-${tool.origin.includes("4174") ? "buyer" : tool.origin.includes("4175") ? "supplier" : "carrier"}` }), _jsxs("div", { children: [_jsx("strong", { children: tool.name }), _jsx("small", { children: tool.origin })] }), _jsx("span", { children: tool.annotations?.readOnlyHint ? "READ" : "WRITE" })] }, `${tool.origin}-${tool.name}`))) })) : (_jsx("p", { className: "no-tools", children: "Waiting for partner iframes\u2026" }))] }));
}
function AuditDrawer({ events, transaction, candidate, stage, canExport, onLocked, onClose, }) {
    const success = stage === "success";
    const rolledBack = stage === "rollback";
    const [exportError, setExportError] = useState("");
    const exportAudit = async () => {
        try {
            setExportError("");
            const persisted = transaction
                ? await workspaceApi(`/transactions/${encodeURIComponent(transaction.id)}/audit`)
                : undefined;
            const blob = new Blob([JSON.stringify({ transaction, events, persisted }, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `relayroom-${transaction?.id ?? "audit"}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
        }
        catch (error) {
            setExportError(error instanceof Error ? error.message : "Export failed");
        }
    };
    return (_jsx("div", { className: "drawer-backdrop", onMouseDown: (event) => {
            if (event.target === event.currentTarget)
                onClose();
        }, children: _jsxs("aside", { className: "audit-drawer", "aria-modal": "true", role: "dialog", "aria-label": "Transaction audit receipt", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("span", { className: "receipt-mark", children: _jsx(FileCheck2, { size: 18 }) }), _jsxs("div", { children: [_jsx("span", { children: "AUDIT RECEIPT" }), _jsx("h2", { children: success
                                                ? "Coordinated change complete"
                                                : rolledBack
                                                    ? "Rollback verified"
                                                    : "Tool activity" })] })] }), _jsx("button", { onClick: onClose, children: _jsx(X, { size: 17 }) })] }), _jsxs("div", { className: `receipt-status ${success ? "success" : rolledBack ? "rolledback" : ""}`, children: [_jsx("span", { children: success ? (_jsx(CheckCircle2, { size: 24 })) : rolledBack ? (_jsx(RefreshCcw, { size: 24 })) : (_jsx(Clock3, { size: 24 })) }), _jsxs("div", { children: [_jsx("strong", { children: success
                                        ? `${transaction?.caseId} recovered`
                                        : rolledBack
                                            ? "Original state restored"
                                            : "Execution trace" }), _jsx("small", { children: success
                                        ? `${candidate?.totalUnits} units · ${formatDate(candidate?.arrivesAt)}`
                                        : rolledBack
                                            ? "Committed partner actions were compensated in reverse order"
                                            : `${events.length} origin-scoped events recorded` })] })] }), _jsxs("div", { className: "receipt-meta", children: [_jsxs("div", { children: [_jsx("span", { children: "Transaction" }), _jsx("strong", { children: transaction?.id ?? "Not started" })] }), _jsxs("div", { children: [_jsx("span", { children: "Authorization" }), _jsx("strong", { children: "Local user approval" })] }), _jsxs("div", { children: [_jsx("span", { children: "Integrity" }), _jsxs("strong", { children: [_jsx(ShieldCheck, { size: 11 }), " Origin verified"] })] })] }), _jsxs("div", { className: "audit-events", children: [_jsxs("div", { className: "audit-events-head", children: [_jsx("span", { children: "TOOL EXECUTION LOG" }), _jsxs("b", { children: [events.length, " EVENTS"] })] }), events.length ? (events.map((event) => (_jsxs("article", { children: [_jsx("span", { className: `audit-result ${event.result}`, children: _jsx(Check, { size: 11 }) }), _jsxs("div", { children: [_jsxs("div", { children: [_jsx("strong", { children: event.tool }), _jsx("time", { children: new Date(event.timestamp).toLocaleTimeString([], {
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                        second: "2-digit",
                                                    }) })] }), _jsx("span", { children: event.origin }), _jsx("small", { children: event.inputSummary }), _jsx("p", { children: event.resultSummary })] })] }, event.id)))) : (_jsx("div", { className: "audit-empty", children: "No tools have run in this session." }))] }), _jsxs("footer", { children: [exportError && _jsx("p", { role: "alert", children: exportError }), _jsxs("button", { onClick: canExport ? () => void exportAudit() : onLocked, children: [canExport ? _jsx(Download, { size: 14 }) : _jsx(LockKeyhole, { size: 14 }), " ", canExport ? "Export audit JSON" : "Unlock audit export"] }), _jsxs("span", { children: [_jsx(LockKeyhole, { size: 10 }), " Partner confirmations persisted server-side"] })] })] }) }));
}
function AccessModal({ demo, user, entitlements, error, loading, onLogin, onLogout, onCheckout, onGrantDevPro, onClose, }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [localError, setLocalError] = useState();
    const act = async (action) => {
        setBusy(true);
        setLocalError(undefined);
        try {
            await action();
        }
        catch (caught) {
            setLocalError(caught instanceof Error ? caught.message : "Action failed");
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsx("div", { className: "access-backdrop", onMouseDown: (event) => {
            if (event.target === event.currentTarget)
                onClose();
        }, children: _jsxs("section", { className: "access-modal", role: "dialog", "aria-modal": "true", "aria-label": "RelayRoom access", children: [_jsx("button", { className: "access-close", onClick: onClose, children: _jsx(X, { size: 15 }) }), _jsxs("div", { className: "access-brand", children: [_jsx("span", { className: "access-logo", children: _jsx(Sparkles, { size: 20 }) }), _jsx("span", { children: "RELAYROOM PRO" }), _jsx("h2", { children: entitlements?.allAccess
                                ? "Every partner. Every recovery tool."
                                : "Resolve across company lines." }), _jsx("p", { children: entitlements?.allAccess
                                ? `Signed in as ${user?.name}. Your ${entitlements.source === "admin-bypass" ? "admin account bypasses billing and" : "Polar subscription"} unlocks every paid feature.`
                                : "Coordinate cross-origin recovery plans, approve staged commits, rehearse rollbacks, and export the audit trail." })] }), loading ? (_jsxs("div", { className: "access-loading", children: [_jsx("span", { className: "mini-loader" }), " Restoring session\u2026"] })) : user ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "account-card", children: [_jsx("span", { className: "account-avatar", children: user.name
                                        .split(" ")
                                        .map((part) => part[0])
                                        .slice(0, 2)
                                        .join("") }), _jsxs("div", { children: [_jsx("strong", { children: user.name }), _jsx("small", { children: user.email })] }), _jsx("span", { className: `account-plan plan-${user.plan}`, children: user.plan })] }), _jsxs("div", { className: "feature-list", children: [_jsxs("div", { children: [_jsx(CheckCircle2, { size: 15 }), _jsxs("span", { children: [_jsx("strong", { children: "Cross-origin recovery" }), _jsx("small", { children: "Discover and execute partner capabilities" })] })] }), _jsxs("div", { children: [_jsx(CheckCircle2, { size: 15 }), _jsxs("span", { children: [_jsx("strong", { children: "Coordinated commit + rollback" }), _jsx("small", { children: "Approval gate, idempotency, compensation" })] })] }), _jsxs("div", { children: [_jsx(CheckCircle2, { size: 15 }), _jsxs("span", { children: [_jsx("strong", { children: "Audit receipt export" }), _jsx("small", { children: "Origin, input, result, and timestamp" })] })] })] }), entitlements?.allAccess ? (_jsxs("button", { className: "access-primary", onClick: onClose, children: [_jsx(Check, { size: 15 }), " Continue with all access"] })) : (_jsxs("button", { className: "access-primary polar-button", disabled: busy, onClick: () => void act(onCheckout), children: [_jsx(CircleDollarSign, { size: 15 }), " Upgrade securely with Polar"] })), demo && !entitlements?.allAccess && (_jsxs("button", { className: "dev-pro-button", disabled: busy, onClick: () => void act(onGrantDevPro), children: [_jsx(Zap, { size: 13 }), " Simulate successful Polar webhook (dev)"] })), _jsx("button", { className: "access-secondary", onClick: () => {
                                onLogout();
                                setEmail("");
                                setPassword("");
                            }, children: "Sign out" })] })) : (_jsxs("form", { onSubmit: (event) => {
                        event.preventDefault();
                        void act(() => onLogin(email, password));
                    }, children: [_jsxs("label", { children: ["Email", _jsx("input", { value: email, type: "email", autoComplete: "username", onChange: (event) => setEmail(event.target.value) })] }), _jsxs("label", { children: ["Password", _jsx("input", { value: password, type: "password", autoComplete: "current-password", onChange: (event) => setPassword(event.target.value) })] }), _jsx("button", { className: "access-primary", disabled: busy, children: busy ? "Signing in…" : "Sign in" }), demo && (_jsxs("div", { className: "demo-accounts", children: [_jsx("span", { children: "DEMO ACCOUNTS" }), _jsxs("button", { type: "button", onClick: () => {
                                        setEmail("admin@relayroom.local");
                                        setPassword("relay-admin-local");
                                    }, children: [_jsx("strong", { children: "Hector admin" }), _jsx("small", { children: "All paid features \u00B7 billing bypass" })] }), _jsxs("button", { type: "button", onClick: () => {
                                        setEmail("operator@relayroom.local");
                                        setPassword("relay-demo-local");
                                    }, children: [_jsx("strong", { children: "Free operator" }), _jsx("small", { children: "Shows the Polar paywall" })] })] }))] })), (localError || error) && (_jsx("div", { className: "access-error", children: localError || error })), _jsxs("footer", { children: [_jsxs("span", { children: [_jsx(ShieldCheck, { size: 11 }), " Entitlements checked server-side"] }), _jsxs("span", { className: "polar-wordmark", children: ["Powered by ", _jsx("b", { children: "Polar" })] })] })] }) }));
}
function getStatusCopy(stage) {
    return ({
        staging: "Staging all partners…",
        staged: "Validated",
        executing: "Executing approved steps…",
        success: "Change committed",
        rollback: "Rollback complete",
        simulating: "Simulating…",
        querying: "Querying partners…",
    }[stage] ?? "Approve coordinated change");
}
function useRoomTools({ state, activeOrder, runRecovery, selectCandidate, }) {
    const runRef = useRef(runRecovery);
    runRef.current = runRecovery;
    const selectRef = useRef(selectCandidate);
    selectRef.current = selectCandidate;
    useEffect(() => {
        if (!document.modelContext?.registerTool)
            return;
        const controller = new AbortController();
        const tools = [
            {
                name: "inspect_exception_case",
                description: "Return the active RelayRoom exception summary and exact partner origins.",
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
                description: "Run the visible, cancellable recovery simulation from normalized partner evidence.",
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
                    if (signal.aborted)
                        throw new DOMException("Cancelled", "AbortError");
                    await runRef.current();
                    return { status: "rendered-in-room" };
                },
            },
            {
                name: "get_transaction_status",
                description: "Return ordered transaction status and available rollback steps.",
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
                description: "Select a feasible candidate and render its visible transaction preview.",
                inputSchema: {
                    type: "object",
                    properties: { candidateId: { type: "string" } },
                    required: ["candidateId"],
                },
                execute: ({ candidateId }) => {
                    const candidate = state.candidates.find((item) => item.id === candidateId);
                    if (!candidate?.feasible)
                        throw new Error("FEASIBLE_CANDIDATE_NOT_FOUND");
                    selectRef.current(candidate);
                    return { selected: candidate.id, status: "preview-rendered" };
                },
            });
        async function registerTools() {
            try {
                await Promise.all(tools.map((tool) => document.modelContext.registerTool(tool, {
                    signal: controller.signal,
                })));
            }
            catch (error) {
                if (controller.signal.aborted ||
                    (error instanceof DOMException && error.name === "AbortError"))
                    return;
                console.info("[RelayRoom] Room tool registration unavailable.", error);
            }
        }
        void registerTools();
        return () => controller.abort();
    }, [state.candidates, state.transaction, activeOrder]);
}
