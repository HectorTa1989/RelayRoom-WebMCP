import { useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleDot,
  Database,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wifi,
} from "lucide-react";
import type { WebMCPTool } from "./webmcp";
import { usePartnerToolHost } from "./webmcp";
import "./partner.css";

export type PortalPhase = "idle" | "selected" | "approved" | "committed";

export type PortalMetric = {
  label: string;
  value: string;
  sublabel?: string;
  tone?: "neutral" | "warning" | "positive";
};

export type PortalActivity = {
  time: string;
  label: string;
  detail: string;
  status: "complete" | "waiting" | "attention";
};

export type PartnerPortalProps = {
  kind: "buyer" | "supplier" | "carrier";
  company: string;
  product: string;
  eyebrow: string;
  accent: string;
  caseSummary?: string;
  metrics: PortalMetric[];
  activities: PortalActivity[];
  buildTools: (context: {
    phase: PortalPhase;
    addActivity: (activity: PortalActivity) => void;
    setPhase: (phase: PortalPhase) => void;
  }) => WebMCPTool[];
  loadPhase?: () => Promise<PortalPhase>;
  manualAction: (context: {
    phase: PortalPhase;
    setPhase: (phase: PortalPhase) => void;
    addActivity: (activity: PortalActivity) => void;
  }) => void | Promise<void>;
  manualLabel: string;
};

const ROOM_ORIGIN =
  (import.meta as ImportMeta & { env?: Record<string, string> }).env
    ?.VITE_ROOM_ORIGIN || "http://localhost:4173";

export function PartnerPortal(props: PartnerPortalProps) {
  const [phase, setPhase] = useState<PortalPhase>("idle");
  const [activities, setActivities] = useState(props.activities);
  const addActivity = (activity: PortalActivity) =>
    setActivities((current) => [activity, ...current].slice(0, 4));
  const tools = useMemo(
    () => props.buildTools({ phase, addActivity, setPhase }),
    // buildTools is stable module configuration; activity updates should not re-register tools.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, props.buildTools],
  );
  const { nativeActive, executingTool } = usePartnerToolHost(
    tools,
    ROOM_ORIGIN,
  );

  useEffect(() => {
    let active = true;
    void props
      .loadPhase?.()
      .then((persistedPhase) => {
        if (active) setPhase(persistedPhase);
      })
      .catch(() => {
        addActivity({
          time: "Now",
          label: "Partner API unavailable",
          detail: "Manual controls remain available",
          status: "attention",
        });
      });
    return () => {
      active = false;
    };
    // loadPhase is stable module configuration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== ROOM_ORIGIN || event.source !== window.parent)
        return;
      if (event.data?.type === "relayroom:phase")
        setPhase(event.data.phase as PortalPhase);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const phaseLabel =
    phase === "idle"
      ? "Watching"
      : phase === "selected"
        ? "Plan selected"
        : phase === "approved"
          ? "Approved"
          : "Committed";

  return (
    <main
      className={`partner-shell ${executingTool ? "is-executing" : ""}`}
      style={{ "--accent": props.accent } as React.CSSProperties}
    >
      <div className="portal-grain" />
      <header className="partner-topbar">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="brand-copy">
          <strong>{props.company}</strong>
          <small>{props.product}</small>
        </div>
        <button className="icon-button" aria-label="Security settings">
          <ShieldCheck size={17} />
        </button>
      </header>

      <section className="partner-hero">
        <div className="partner-eyebrow">
          <CircleDot size={12} /> {props.eyebrow}
        </div>
        <div className="partner-title-row">
          <h1>
            {props.kind === "buyer"
              ? "Purchase order"
              : props.kind === "supplier"
                ? "Inventory desk"
                : "Route control"}
          </h1>
          <span className={`phase-pill phase-${phase}`}>{phaseLabel}</span>
        </div>
        <p>{props.caseSummary || "Select an order in RelayRoom"}</p>
      </section>

      <section
        className="metric-grid"
        aria-label={`${props.company} case metrics`}
      >
        {props.metrics.map((metric) => (
          <article
            className={`metric-card ${metric.tone ?? "neutral"}`}
            key={metric.label}
          >
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            {metric.sublabel && <small>{metric.sublabel}</small>}
          </article>
        ))}
      </section>

      <section className="tool-surface">
        <div className="section-heading">
          <div>
            <small>ORIGIN-SCOPED CAPABILITIES</small>
            <h2>Tools shared with RelayRoom</h2>
          </div>
          <span className={`native-badge ${nativeActive ? "online" : ""}`}>
            <Wifi size={12} /> {nativeActive ? "Native" : "Bridge"}
          </span>
        </div>
        <div className="tool-list">
          {tools.map((tool) => (
            <div
              className={`tool-row ${executingTool === tool.name ? "executing" : ""}`}
              key={tool.name}
            >
              <span className="tool-icon">
                {tool.annotations?.readOnlyHint ? (
                  <Database size={15} />
                ) : (
                  <LockKeyhole size={15} />
                )}
              </span>
              <div>
                <strong>{tool.name}</strong>
                <small>
                  {tool.annotations?.readOnlyHint
                    ? "Read-only"
                    : phase === "approved"
                      ? "Approval unlocked"
                      : "State limited"}
                </small>
              </div>
              {executingTool === tool.name ? (
                <Sparkles className="spin-spark" size={15} />
              ) : (
                <Check size={14} />
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="activity-surface">
        <div className="section-heading">
          <div>
            <small>LOCAL AUDIT</small>
            <h2>Recent activity</h2>
          </div>
          <RotateCcw size={15} />
        </div>
        <ol className="activity-list">
          {activities.map((activity, index) => (
            <li key={`${activity.time}-${activity.label}-${index}`}>
              <span className={`activity-dot ${activity.status}`} />
              <time>{activity.time}</time>
              <div>
                <strong>{activity.label}</strong>
                <small>{activity.detail}</small>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="partner-footer">
        <button
          className="manual-button"
          onClick={() =>
            void Promise.resolve(
              props.manualAction({ phase, setPhase, addActivity }),
            ).catch((error) =>
              addActivity({
                time: "Now",
                label: "Action failed",
                detail:
                  error instanceof Error ? error.message : "Unknown error",
                status: "attention",
              }),
            )
          }
        >
          {props.manualLabel}
        </button>
        <span>Manual controls stay available</span>
      </footer>
    </main>
  );
}
