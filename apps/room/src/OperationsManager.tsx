import { useEffect, useState } from "react";
import { X, Upload, Plus } from "lucide-react";
import type { Partner } from "@relayroom/contracts";
import { workspaceApi } from "./auth";

type Field = [
  string,
  string,
  "text" | "number" | "datetime-local" | "checkbox" | "source" | "password",
];
const fields: Record<Partner | "users", Field[]> = {
  buyer: [
    ["id", "Order ID", "text"],
    ["sku", "SKU", "text"],
    ["productName", "Product", "text"],
    ["quantity", "Quantity", "number"],
    ["origin", "Origin / stock location", "text"],
    ["destination", "Destination", "text"],
    ["neededBy", "Delivery deadline", "datetime-local"],
    ["maxAddedLogisticsCostPct", "Maximum added logistics cost (%)", "number"],
  ],
  supplier: [
    ["id", "Lot ID", "text"],
    ["sku", "SKU", "text"],
    ["supplier", "Supplier", "text"],
    ["location", "Stock location", "text"],
    ["availableUnits", "Stock on hand", "number"],
    ["minReservation", "Minimum reservation", "number"],
    ["readyAt", "Ready at", "datetime-local"],
    ["unitCostDeltaPct", "Unit cost change (%)", "number"],
    ["source", "Lot priority", "source"],
  ],
  carrier: [
    ["id", "Route ID", "text"],
    ["carrier", "Carrier", "text"],
    ["label", "Route name", "text"],
    ["origin", "Origin / stock location", "text"],
    ["destination", "Destination", "text"],
    ["capacityUnits", "Capacity", "number"],
    ["departsAt", "Departure", "datetime-local"],
    ["arrivesAt", "Arrival", "datetime-local"],
    ["costDeltaPct", "Added logistics cost (%)", "number"],
  ],
  users: [
    ["name", "Operator name", "text"],
    ["email", "Email", "text"],
    ["password", "Password (at least 12 characters)", "password"],
  ],
};
const names = {
  buyer: "Orders",
  supplier: "Inventory",
  carrier: "Routes",
  users: "Operators",
};
export function OperationsManager({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: (id?: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<Partner | "users">("buyer");
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    if (tab !== "users")
      setRecords(
        (
          await workspaceApi<{ records: Record<string, unknown>[] }>(
            `/records/${tab}`,
          )
        ).records,
      );
    else setRecords([]);
  };
  useEffect(() => {
    setValues({});
    setError("");
    setNotice("");
    void refresh().catch((e) => setError(e.message));
  }, [tab]);
  const save = async (records: unknown[]) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (tab === "users") await workspaceApi("/users", records[0]);
      else await workspaceApi(`/records/${tab}`, { records });
      await refresh();
      await onChanged(
        tab === "buyer" ? (records[0] as { id: string }).id : undefined,
      );
      setValues({});
      setNotice(
        `${records.length} ${tab === "users" ? "operator created" : "record(s) saved"}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    const record: Record<string, unknown> = {};
    for (const [key, , type] of fields[tab])
      record[key] =
        type === "number"
          ? Number(values[key])
          : type === "datetime-local"
            ? new Date(values[key]).toISOString()
            : values[key] || (type === "source" ? "original" : "");
    if (tab === "buyer") record.allowLateSplit = false;
    if (tab === "carrier") record.delayHours = 0;
    void save([record]);
  };
  return (
    <div className="access-backdrop">
      <section
        className="operations-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Manage operations"
      >
        <header>
          <div>
            <small>WORKSPACE DATA</small>
            <h2>Manage operations</h2>
          </div>
          <button
            aria-label="Close operations"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <nav>
          {(Object.keys(names) as Array<keyof typeof names>).map((key) => (
            <button
              key={key}
              disabled={busy}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              {names[key]}
            </button>
          ))}
        </nav>
        <div className="operations-body">
          <div>
            <h3>
              Add{" "}
              {tab === "buyer"
                ? "an order"
                : tab === "supplier"
                  ? "an inventory lot"
                  : tab === "carrier"
                    ? "a route"
                    : "an operator"}
            </h3>
            <p>
              Use the same SKU and stock location across orders and inventory.
              Route origins and destinations must match the order. Times use
              your local time zone.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="operations-fields">
                {fields[tab].map(([key, label, type]) => (
                  <label key={key}>
                    {label}
                    {type === "source" ? (
                      <select
                        value={values[key] || "original"}
                        onChange={(e) =>
                          setValues({ ...values, [key]: e.target.value })
                        }
                      >
                        <option value="original">Primary</option>
                        <option value="backup">Backup</option>
                      </select>
                    ) : (
                      <input
                        required
                        type={type}
                        step={type === "number" ? "any" : undefined}
                        min={type === "number" ? 0 : undefined}
                        maxLength={type === "password" ? 128 : 200}
                        value={values[key] || ""}
                        onChange={(e) =>
                          setValues({ ...values, [key]: e.target.value })
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
              <button className="access-primary" disabled={busy}>
                <Plus size={14} />
                {busy ? "Saving…" : "Save record"}
              </button>
            </form>
            {tab !== "users" && (
              <label className="import-control">
                <Upload size={15} /> Import JSON array (up to 100 records)
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    try {
                      if (file.size > 250000)
                        throw new Error("File must be under 250 KB");
                      const parsed = JSON.parse(await file.text());
                      if (!Array.isArray(parsed))
                        throw new Error("Import requires a JSON array");
                      await save(parsed);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Invalid file");
                    }
                  }}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="operations-error">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
          </div>
          <div className="records-list">
            <h3>
              {names[tab]} on record <span>{records.length}</span>
            </h3>
            {records.length ? (
              records.map((record) => (
                <article key={String(record.id)}>
                  <strong>{String(record.id)}</strong>
                  <span>
                    {String(
                      record.productName ??
                        record.supplier ??
                        record.label ??
                        "",
                    )}
                  </span>
                  <small>
                    {Object.entries(record)
                      .filter(([k]) =>
                        [
                          "sku",
                          "quantity",
                          "availableUnits",
                          "capacityUnits",
                          "origin",
                          "destination",
                          "location",
                          "status",
                          "revision",
                        ].includes(k),
                      )
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")}
                  </small>
                </article>
              ))
            ) : (
              <p>No records yet. Add one or import a JSON file.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
