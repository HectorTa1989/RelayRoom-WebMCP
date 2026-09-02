import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { X, Upload, Plus } from "lucide-react";
import { workspaceApi } from "./auth";
const fields = {
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
export function OperationsManager({ onClose, onChanged, }) {
    const [tab, setTab] = useState("buyer");
    const [records, setRecords] = useState([]);
    const [values, setValues] = useState({});
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const refresh = async () => {
        if (tab !== "users")
            setRecords((await workspaceApi(`/records/${tab}`)).records);
        else
            setRecords([]);
    };
    useEffect(() => {
        setValues({});
        setError("");
        setNotice("");
        void refresh().catch((e) => setError(e.message));
    }, [tab]);
    const save = async (records) => {
        setBusy(true);
        setError("");
        setNotice("");
        try {
            if (tab === "users")
                await workspaceApi("/users", records[0]);
            else
                await workspaceApi(`/records/${tab}`, { records });
            await refresh();
            await onChanged(tab === "buyer" ? records[0].id : undefined);
            setValues({});
            setNotice(`${records.length} ${tab === "users" ? "operator created" : "record(s) saved"}.`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Save failed");
        }
        finally {
            setBusy(false);
        }
    };
    const submit = () => {
        const record = {};
        for (const [key, , type] of fields[tab])
            record[key] =
                type === "number"
                    ? Number(values[key])
                    : type === "datetime-local"
                        ? new Date(values[key]).toISOString()
                        : values[key] || (type === "source" ? "original" : "");
        if (tab === "buyer")
            record.allowLateSplit = false;
        if (tab === "carrier")
            record.delayHours = 0;
        void save([record]);
    };
    return (_jsx("div", { className: "access-backdrop", children: _jsxs("section", { className: "operations-modal", role: "dialog", "aria-modal": "true", "aria-label": "Manage operations", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("small", { children: "WORKSPACE DATA" }), _jsx("h2", { children: "Manage operations" })] }), _jsx("button", { "aria-label": "Close operations", disabled: busy, onClick: onClose, children: _jsx(X, { size: 18 }) })] }), _jsx("nav", { children: Object.keys(names).map((key) => (_jsx("button", { disabled: busy, className: tab === key ? "active" : "", onClick: () => setTab(key), children: names[key] }, key))) }), _jsxs("div", { className: "operations-body", children: [_jsxs("div", { children: [_jsxs("h3", { children: ["Add", " ", tab === "buyer"
                                            ? "an order"
                                            : tab === "supplier"
                                                ? "an inventory lot"
                                                : tab === "carrier"
                                                    ? "a route"
                                                    : "an operator"] }), _jsx("p", { children: "Use the same SKU and stock location across orders and inventory. Route origins and destinations must match the order. Times use your local time zone." }), _jsxs("form", { onSubmit: (event) => {
                                        event.preventDefault();
                                        submit();
                                    }, children: [_jsx("div", { className: "operations-fields", children: fields[tab].map(([key, label, type]) => (_jsxs("label", { children: [label, type === "source" ? (_jsxs("select", { value: values[key] || "original", onChange: (e) => setValues({ ...values, [key]: e.target.value }), children: [_jsx("option", { value: "original", children: "Primary" }), _jsx("option", { value: "backup", children: "Backup" })] })) : (_jsx("input", { required: true, type: type, step: type === "number" ? "any" : undefined, min: type === "number" ? 0 : undefined, maxLength: type === "password" ? 128 : 200, value: values[key] || "", onChange: (e) => setValues({ ...values, [key]: e.target.value }) }))] }, key))) }), _jsxs("button", { className: "access-primary", disabled: busy, children: [_jsx(Plus, { size: 14 }), busy ? "Saving…" : "Save record"] })] }), tab !== "users" && (_jsxs("label", { className: "import-control", children: [_jsx(Upload, { size: 15 }), " Import JSON array (up to 100 records)", _jsx("input", { type: "file", accept: ".json,application/json", disabled: busy, onChange: async (e) => {
                                                const file = e.target.files?.[0];
                                                e.target.value = "";
                                                if (!file)
                                                    return;
                                                try {
                                                    if (file.size > 250000)
                                                        throw new Error("File must be under 250 KB");
                                                    const parsed = JSON.parse(await file.text());
                                                    if (!Array.isArray(parsed))
                                                        throw new Error("Import requires a JSON array");
                                                    await save(parsed);
                                                }
                                                catch (e) {
                                                    setError(e instanceof Error ? e.message : "Invalid file");
                                                }
                                            } })] })), error && (_jsx("p", { role: "alert", className: "operations-error", children: error })), notice && _jsx("p", { role: "status", children: notice })] }), _jsxs("div", { className: "records-list", children: [_jsxs("h3", { children: [names[tab], " on record ", _jsx("span", { children: records.length })] }), records.length ? (records.map((record) => (_jsxs("article", { children: [_jsx("strong", { children: String(record.id) }), _jsx("span", { children: String(record.productName ??
                                                record.supplier ??
                                                record.label ??
                                                "") }), _jsx("small", { children: Object.entries(record)
                                                .filter(([k]) => [
                                                "sku",
                                                "quantity",
                                                "availableUnits",
                                                "capacityUnits",
                                                "origin",
                                                "destination",
                                                "location",
                                                "status",
                                                "revision",
                                            ].includes(k))
                                                .map(([k, v]) => `${k}: ${v}`)
                                                .join(" · ") })] }, String(record.id))))) : (_jsx("p", { children: "No records yet. Add one or import a JSON file." }))] })] })] }) }));
}
