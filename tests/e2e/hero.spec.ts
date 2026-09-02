import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
const api = "http://localhost:8887";
const partnerApi = {
  buyer: "http://localhost:8884",
  supplier: "http://localhost:8885",
  carrier: "http://localhost:8886",
};
const time = (hours: number) =>
  new Date(Date.now() + hours * 3600000).toISOString();
async function admin(request: APIRequestContext) {
  await expect
    .poll(
      async () => {
        try {
          return (await request.get(`${api}/api/health`)).ok();
        } catch {
          return false;
        }
      },
      { timeout: 30000 },
    )
    .toBe(true);
  const login = await request.post(`${api}/api/auth/login`, {
    data: { email: "admin@test.local", password: "test-admin-password" },
  });
  expect(login.ok()).toBe(true);
  return (await login.json()).token as string;
}
async function scenario(
  request: APIRequestContext,
  token: string,
  createOrder = true,
) {
  const suffix = randomUUID().slice(0, 8);
  const origin = `Depot-${suffix}`;
  const destination = `Plant-${suffix}`;
  const order = {
    id: `ORDER-${suffix}`,
    sku: `SKU-${suffix}`,
    productName: "Precision valve",
    quantity: 73,
    origin,
    destination,
    neededBy: time(72),
    maxAddedLogisticsCostPct: 15,
    allowLateSplit: false,
  };
  const lot = {
    id: `LOT-${suffix}`,
    sku: order.sku,
    location: origin,
    supplier: "Real input supplier",
    availableUnits: 100,
    minReservation: 5,
    readyAt: time(1),
    unitCostDeltaPct: 0,
    source: "original",
  };
  const route = {
    id: `ROUTE-${suffix}`,
    origin,
    destination,
    carrier: "Configured carrier",
    label: "Regional delivery",
    capacityUnits: 110,
    departsAt: time(12),
    arrivesAt: time(48),
    costDeltaPct: 7,
    delayHours: 0,
  };
  for (const [partner, record] of [
    ...(createOrder ? [["buyer", order]] : []),
    ["supplier", lot],
    ["carrier", route],
  ] as const) {
    await expect
      .poll(async () => {
        try {
          return (
            await request.get(
              `${partnerApi[partner as keyof typeof partnerApi]}/api/health`,
            )
          ).ok();
        } catch {
          return false;
        }
      })
      .toBe(true);
    const result = await request.post(`${api}/api/records/${partner}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { records: [record] },
    });
    expect(result.ok(), await result.text()).toBe(true);
  }
  return { order, lot, route };
}
async function signIn(page: Page, orderId?: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: /sign in/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "RelayRoom access" });
  await dialog.getByLabel("Email").fill("admin@test.local");
  await dialog.getByLabel("Password").fill("test-admin-password");
  await dialog.getByRole("button", { name: /^sign in$/i }).click();
  await dialog
    .getByRole("button", { name: /continue with all access/i })
    .click();
  if (orderId) await page.getByLabel("Active order").selectOption(orderId);
}
async function plan(page: Page) {
  await page.getByRole("button", { name: /resolve case/i }).click();
  await expect(page.getByText("3/3 verified")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve coordinated change" }),
  ).toBeEnabled();
}
test("custom 73-unit recovery commits real inventory, capacity, and order revision", async ({
  page,
  request,
}) => {
  const token = await admin(request);
  const { order, lot, route } = await scenario(request, token);
  await signIn(page, order.id);
  await plan(page);
  await expect(page.locator(".plan-metrics")).toContainText("73");
  await expect(page.locator(".dynamic-route")).toContainText(lot.id);
  await page
    .getByRole("button", { name: "Approve coordinated change" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Transaction audit receipt" }),
  ).toContainText("Coordinated change complete");
  const workspace = await (
    await request.get(`${api}/api/workspace`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  expect(
    workspace.orders.find((x: { id: string }) => x.id === order.id),
  ).toMatchObject({
    status: "resolved",
    revision: 2,
    arrivals: [{ quantity: 73, arrivesAt: route.arrivesAt }],
  });
  const inventory = await (
    await request.get(
      `${partnerApi.supplier}/api/inventory/${order.sku}/options`,
      { headers: { Authorization: `Bearer ${workspace.tokens.supplier}` } },
    )
  ).json();
  expect(inventory.options[0].availableUnits).toBe(27);
  const transaction = workspace.transactions.find((x: { caseId: string }) => x.caseId === order.id);
  const persisted = await (await request.get(`${api}/api/transactions/${transaction.id}/audit`, { headers: { Authorization: `Bearer ${token}` } })).json();
  expect(persisted.partners).toHaveLength(3);
  expect(persisted.partners.every((p: {operation: {status:string}; events: {action:string}[]}) => p.operation.status === 'committed' && p.events.some(e=>e.action==='commit'))).toBe(true);
  await page.reload();
  await page.locator('.pending-recoveries>div').filter({hasText:transaction.id}).getByRole('button',{name:'View receipt'}).click();
  await expect(page.getByRole('dialog',{name:'Transaction audit receipt'})).toContainText(order.id);
  await page.locator('.audit-drawer>header button').click();
  await expect(page.frameLocator('iframe[title="Northstar Supply partner portal"]').getByRole('heading',{name:'Inventory desk'})).toBeVisible();
  await expect(page.frameLocator('iframe[title="Northstar Supply partner portal"]').getByText('27',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({
    path: "test-results/operations-completed.png",
    fullPage: true,
    animations: 'disabled',
  });
});
test("carrier rejection releases every staged partner and restores stock", async ({
  page,
  request,
}) => {
  const token = await admin(request);
  const { order } = await scenario(request, token);
  await signIn(page, order.id);
  await plan(page);
  await page.getByText("Rehearse carrier failure").click();
  await page
    .getByRole("button", { name: "Approve coordinated change" })
    .click();
  const receipt = page.getByRole("dialog", {
    name: "Transaction audit receipt",
  });
  await expect(receipt).toContainText("Rollback verified");
  await expect(receipt).toContainText("release_inventory_hold");
  await expect(receipt).toContainText("cancel_route_booking");
  await expect(receipt).toContainText("rollback_order_revision");
  const workspace = await (
    await request.get(`${api}/api/workspace`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const inventory = await (
    await request.get(
      `${partnerApi.supplier}/api/inventory/${order.sku}/options`,
      { headers: { Authorization: `Bearer ${workspace.tokens.supplier}` } },
    )
  ).json();
  expect(inventory.options[0].availableUnits).toBe(100);
});
test("order form creates a fresh order with no scenario constants", async ({
  page,
  request,
}) => {
  const token = await admin(request);
  const { order } = await scenario(request, token, false);
  await signIn(page);
  await page.getByRole("button", { name: "Manage operations" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage operations" });
  await dialog.getByLabel("Order ID", { exact: true }).fill(order.id);
  await dialog.getByLabel("SKU", { exact: true }).fill(order.sku);
  await dialog.getByLabel("Product", { exact: true }).fill(order.productName);
  await dialog.getByLabel("Quantity", { exact: true }).fill("73");
  await dialog
    .getByLabel("Origin / stock location", { exact: true })
    .fill(order.origin);
  await dialog
    .getByLabel("Destination", { exact: true })
    .fill(order.destination);
  await dialog
    .getByLabel("Delivery deadline", { exact: true })
    .fill("2031-01-01T12:00");
  await dialog
    .getByLabel("Maximum added logistics cost (%)", { exact: true })
    .fill("15");
  await dialog.getByRole("button", { name: "Save record" }).click();
  await expect(dialog.getByRole("status")).toContainText("saved");
  await dialog.getByRole("button", { name: "Close operations" }).click();
  await expect(page.getByLabel("Active order")).toHaveValue(order.id);
  await expect(page.locator(".case-heading")).toContainText("73-unit");
});
test("API requires paid approval, exact quantities, partner audience, and commit dependencies", async ({
  request,
}) => {
  const token = await admin(request);
  const { order, lot, route } = await scenario(request, token);
  const headers = { Authorization: `Bearer ${token}` };
  expect(
    (
      await request.post(`${partnerApi.carrier}/api/routes/stage`, {
        data: { units: 73 },
      })
    ).status(),
  ).toBe(401);
  const workspace = await (
    await request.get(`${api}/api/workspace`, { headers })
  ).json();
  expect(
    (
      await request.get(`${partnerApi.carrier}/api/records`, {
        headers: { Authorization: `Bearer ${workspace.tokens.supplier}` },
      })
    ).status(),
  ).toBe(401);
  const planned = await (
    await request.post(`${api}/api/agent/plan`, {
      headers,
      data: {
        objective: "Recover this order",
        constraints: {
          caseId: order.id,
          quantity: order.quantity,
          neededBy: order.neededBy,
          maxAddedLogisticsCostPct: 15,
          allowLateSplit: false,
          destination: order.destination,
        },
        inventory: [lot],
        routes: [route],
      },
    })
  ).json();
  const candidate = planned.candidates.find(
    (x: { feasible: boolean }) => x.feasible,
  );
  const transactionId = `TX-${randomUUID()}`;
  const approved = await (
    await request.post(`${api}/api/approvals`, {
      headers,
      data: { caseId: order.id, candidate, transactionId },
    })
  ).json();
  const carrierHeaders = { Authorization: `Bearer ${approved.tokens.carrier}` };
  const input = {
    transactionId,
    idempotencyKey: `${transactionId}:carrier:stage`,
    routeId: route.id,
    units: 74,
  };
  expect(
    (
      await request.post(`${partnerApi.carrier}/api/routes/stage`, {
        headers: carrierHeaders,
        data: input,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(`${partnerApi.carrier}/api/routes/stage`, {
        headers: { Authorization: `Bearer ${workspace.tokens.carrier}` },
        data: { ...input, units: 73 },
      })
    ).status(),
  ).toBe(403);
  const stage = await (
    await request.post(`${partnerApi.carrier}/api/routes/stage`, {
      headers: carrierHeaders,
      data: { ...input, units: 73 },
    })
  ).json();
  expect(
    (
      await request.post(`${partnerApi.carrier}/api/routes/commit`, {
        headers: carrierHeaders,
        data: {
          transactionId,
          idempotencyKey: `${transactionId}:carrier:commit`,
          stageId: stage.stageId,
        },
      })
    ).status(),
  ).toBe(409);
});
test("saved approval can resume after a page reload", async ({
  page,
  request,
}) => {
  const token = await admin(request);
  const { order, lot, route } = await scenario(request, token);
  const headers = { Authorization: `Bearer ${token}` };
  const planResponse = await (
    await request.post(`${api}/api/agent/plan`, {
      headers,
      data: {
        objective: "Recover order",
        constraints: {
          caseId: order.id,
          quantity: 73,
          neededBy: order.neededBy,
          maxAddedLogisticsCostPct: 15,
          allowLateSplit: false,
          destination: order.destination,
        },
        inventory: [lot],
        routes: [route],
      },
    })
  ).json();
  const transactionId = `TX-${randomUUID()}`;
  const candidate = planResponse.candidates[0];
  const approved = await (
    await request.post(`${api}/api/approvals`, {
      headers,
      data: { caseId: order.id, transactionId, candidate },
    })
  ).json();
  const staged = await request.post(
    `${partnerApi.supplier}/api/inventory/stage`,
    {
      headers: { Authorization: `Bearer ${approved.tokens.supplier}` },
      data: {
        transactionId,
        idempotencyKey: `${transactionId}:supplier:stage`,
        allocations: candidate.inventoryAllocations,
      },
    },
  );
  expect(staged.ok()).toBe(true);
  await signIn(page, order.id);
  await page.reload();
  const recovery = page
    .locator(".pending-recoveries>div")
    .filter({ hasText: transactionId });
  await recovery.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Transaction audit receipt" }),
  ).toContainText("Coordinated change complete");
});
test("signed-out recovery opens the access gate", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /resolve case/i }).click();
  await expect(
    page.getByRole("dialog", { name: "RelayRoom access" }),
  ).toContainText("Powered by Polar");
});
