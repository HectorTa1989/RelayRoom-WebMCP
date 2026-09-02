import { afterEach, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { createPartnerApp } from "./server";
import { PartnerStore } from "./store";
import { mintGrant } from "./security";

let gateway: Server;
let upstream: Server;
let db: DatabaseSync;
let url: string;
let calls: number;
let malformed = false;
let reject = false;
const listen = (app: ReturnType<typeof express>) =>
  new Promise<Server>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
const address = (server: Server) =>
  `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
beforeEach(async () => {
  calls = 0;
  malformed = false;
  reject = false;
  const external = express();
  external.use(express.json());
  external.use((req, res) => {
    calls++;
    expect(req.headers.authorization).toBe("Bearer test-connector-key");
    expect(req.headers["x-relayroom-context"]).toBeTruthy();
    if (malformed) return res.type("text").send("invalid response");
    if (reject)
      return res
        .status(503)
        .json({
          error: { code: "PROVIDER_OFFLINE", message: "Provider unavailable" },
        });
    res.json({ records: [{ id: "external-confirmed-record" }] });
  });
  upstream = await listen(external);
  vi.stubEnv("SUPPLIER_BACKEND", "remote");
  vi.stubEnv("SUPPLIER_CONNECTOR_URL", address(upstream));
  vi.stubEnv("SUPPLIER_CONNECTOR_TOKEN", "test-connector-key");
  db = new DatabaseSync(":memory:");
  gateway = await listen(
    createPartnerApp("supplier", new PartnerStore("supplier", db)),
  );
  url = address(gateway);
});
afterEach(async () => {
  await Promise.all(
    [gateway, upstream]
      .filter(Boolean)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  db?.close();
  vi.unstubAllEnvs();
});
it("authenticates before forwarding and uses the configured connector response", async () => {
  expect((await fetch(`${url}/api/records`)).status).toBe(401);
  expect(calls).toBe(0);
  const token = await mintGrant("supplier", {
    sub: "operator",
    role: "operator",
    scope: "read",
  });
  const response = await fetch(`${url}/api/records`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(await response.json()).toEqual({
    records: [{ id: "external-confirmed-record" }],
  });
  expect(calls).toBe(1);
});
it("never substitutes local inventory on provider errors or unknown responses", async () => {
  const token = await mintGrant("supplier", {
    sub: "operator",
    role: "operator",
    scope: "read",
  });
  const headers = { Authorization: `Bearer ${token}` };
  reject = true;
  expect((await fetch(`${url}/api/records`, { headers })).status).toBe(503);
  reject = false;
  malformed = true;
  const unknown = await fetch(`${url}/api/records`, { headers });
  expect(unknown.status).toBe(502);
  expect((await unknown.json()).error.code).toBe("CONNECTOR_RESULT_UNKNOWN");
});
