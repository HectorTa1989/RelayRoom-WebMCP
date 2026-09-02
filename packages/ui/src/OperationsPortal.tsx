import { useCallback, useEffect, useMemo, useState } from "react";
import type { OrderRecord, Partner } from "@relayroom/contracts";
import {
  PartnerPortal,
  type PartnerPortalProps,
  type PortalMetric,
} from "./PartnerPortal";
import { partnerApi, setPartnerToken } from "./partnerApi";
import type { WebMCPTool } from "./webmcp";

const roomOrigin =
  (import.meta as ImportMeta & { env?: Record<string, string> }).env
    ?.VITE_ROOM_ORIGIN || "http://localhost:4173";
const settings = {
  buyer: {
    company: "Buyer operations",
    product: "Order management",
    accent: "#5e5ce6",
    read: "get_order_constraints",
    stage: "stage_order_revision",
    commit: "commit_order_revision",
    release: "rollback_order_revision",
    path: "order",
  },
  supplier: {
    company: "Supplier operations",
    product: "Inventory allocation",
    accent: "#af52de",
    read: "get_inventory_options",
    stage: "stage_inventory_hold",
    commit: "commit_inventory_hold",
    release: "release_inventory_hold",
    path: "inventory",
  },
  carrier: {
    company: "Carrier operations",
    product: "Route booking",
    accent: "#ff9f0a",
    read: "get_route_options",
    stage: "stage_route_booking",
    commit: "commit_route_booking",
    release: "cancel_route_booking",
    path: "routes",
  },
};
const formatTime = (value: string) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export function OperationsPortal({ kind }: { kind: Partner }) {
  const config = settings[kind];
  const [order, setOrder] = useState<OrderRecord>();
  const [session, setSession] = useState(0);
  const [metrics, setMetrics] = useState<PortalMetric[]>([]);
  const [message, setMessage] = useState(
    "Sign in to RelayRoom to view records",
  );
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== roomOrigin ||
        event.source !== window.parent ||
        event.data?.type !== "relayroom:session"
      )
        return;
      setPartnerToken(
        typeof event.data.token === "string" ? event.data.token : undefined,
      );
      setOrder(event.data.order);
      setSession((x) => x + 1);
      window.parent.postMessage(
        {
          type: "relayroom:result",
          requestId: event.data.requestId,
          ok: true,
          result: { session: "ready" },
        },
        roomOrigin,
      );
    };
    window.addEventListener("message", receive);
    window.parent.postMessage(
      { type: "relayroom:session-request" },
      roomOrigin,
    );
    return () => {
      window.removeEventListener("message", receive);
      setPartnerToken(undefined);
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!order) {
      setMetrics([]);
      return;
    }
    if (kind === "buyer") {
      const value = await partnerApi<OrderRecord>(
        `/api/cases/${encodeURIComponent(order.id)}/constraints`,
      );
      setMetrics([
        {
          label: "Quantity",
          value: String(value.quantity),
          sublabel: value.sku,
        },
        { label: "Deadline", value: formatTime(value.neededBy) },
        {
          label: "Revision",
          value: String(value.revision),
          sublabel: value.status,
        },
        { label: "Cost limit", value: `+${value.maxAddedLogisticsCostPct}%` },
      ]);
    } else if (kind === "supplier") {
      const data = await partnerApi<{
        options: { availableUnits: number; id: string }[];
      }>(
        `/api/inventory/${encodeURIComponent(order.sku)}/options?location=${encodeURIComponent(order.origin)}`,
      );
      setMetrics([
        {
          label: "Available units",
          value: String(data.options.reduce((n, x) => n + x.availableUnits, 0)),
        },
        { label: "Matching lots", value: String(data.options.length) },
        { label: "SKU", value: order.sku },
        { label: "Location", value: order.origin },
      ]);
    } else {
      const data = await partnerApi<{ options: { capacityUnits: number }[] }>(
        `/api/routes/options?origin=${encodeURIComponent(order.origin)}&destination=${encodeURIComponent(order.destination)}`,
      );
      setMetrics([
        { label: "Available lanes", value: String(data.options.length) },
        {
          label: "Open capacity",
          value: String(data.options.reduce((n, x) => n + x.capacityUnits, 0)),
        },
        { label: "From", value: order.origin },
        { label: "To", value: order.destination },
      ]);
    }
    setMessage(`${order.id} · ${order.sku}`);
  }, [kind, order, session]);
  useEffect(() => {
    void refresh().catch((error) => {
      setMetrics([]);
      setMessage(error.message);
    });
  }, [refresh]);
  const buildTools = useMemo<PartnerPortalProps["buildTools"]>(
    () =>
      ({ phase, addActivity, setPhase }) => {
        const inputSchema = {
          type: "object",
          properties:
            kind === "buyer"
              ? { caseId: { type: "string" } }
              : kind === "supplier"
                ? { sku: { type: "string" }, location: { type: "string" } }
                : {
                    origin: { type: "string" },
                    destination: { type: "string" },
                    units: { type: "integer" },
                  },
          required:
            kind === "buyer"
              ? ["caseId"]
              : kind === "supplier"
                ? ["sku", "location"]
                : ["origin", "destination", "units"],
          additionalProperties: false,
        };
        const tools: WebMCPTool[] = [
          {
            name: config.read,
            description:
              "Read current operational records and availability for the selected order.",
            inputSchema,
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: async (input, { signal }) => {
              const path =
                kind === "buyer"
                  ? `/api/cases/${encodeURIComponent(String(input.caseId))}/constraints`
                  : kind === "supplier"
                    ? `/api/inventory/${encodeURIComponent(String(input.sku))}/options?location=${encodeURIComponent(String(input.location))}`
                    : `/api/routes/options?origin=${encodeURIComponent(String(input.origin))}&destination=${encodeURIComponent(String(input.destination))}&units=${Number(input.units)}`;
              const value = await partnerApi(path, { signal });
              addActivity({
                time: "Now",
                label: "Records shared",
                detail: "Current partner data returned",
                status: "complete",
              });
              return value;
            },
          },
        ];
        for (const action of ["stage", "commit", "release"] as const) {
          if (
            action === "commit" &&
            phase !== "approved" &&
            phase !== "committed"
          )
            continue;
          const extra =
            action === "stage"
              ? kind === "buyer"
                ? {
                    caseId: { type: "string" },
                    arrivals: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          quantity: { type: "integer" },
                          arrivesAt: { type: "string" },
                        },
                        required: ["quantity", "arrivesAt"],
                      },
                    },
                  }
                : kind === "supplier"
                  ? {
                      allocations: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            lotId: { type: "string" },
                            supplier: { type: "string" },
                            quantity: { type: "integer" },
                          },
                          required: ["lotId", "supplier", "quantity"],
                        },
                      },
                    }
                  : { routeId: { type: "string" }, units: { type: "integer" } }
              : action === "commit"
                ? { stageId: { type: "string" } }
                : {};
          tools.push({
            name: config[action],
            description:
              action === "release"
                ? "Release this transaction and restore its previous state; safe to retry."
                : `${action} the exact plan authorized by a signed approval.`,
            inputSchema: {
              type: "object",
              properties: {
                transactionId: { type: "string" },
                idempotencyKey: { type: "string" },
                ...extra,
              },
              required: [
                "transactionId",
                "idempotencyKey",
                ...Object.keys(extra),
              ],
              additionalProperties: false,
            },
            execute: async (input, { signal }) => {
              const endpoint =
                action === "release"
                  ? kind === "buyer"
                    ? "rollback"
                    : kind === "carrier"
                      ? "cancel"
                      : "release"
                  : action;
              const result = await partnerApi<Record<string, unknown>>(
                `/api/${config.path}/${endpoint}`,
                { body: input, signal },
              );
              if (action === "commit") setPhase("committed");
              if (action === "release") setPhase("selected");
              addActivity({
                time: "Now",
                label: `${action} confirmed`,
                detail: String(
                  result.resultId ?? result.stageId ?? result.status,
                ),
                status: "complete",
              });
              void refresh().catch(() => {});
              return result;
            },
          });
        }
        return tools;
      },
    [kind, config, refresh],
  );
  return (
    <PartnerPortal
      kind={kind}
      company={config.company}
      product={config.product}
      eyebrow="Authenticated partner operations"
      accent={config.accent}
      caseSummary={message}
      metrics={metrics}
      activities={[]}
      buildTools={buildTools}
      manualLabel="Refresh partner records"
      manualAction={refresh}
    />
  );
}
