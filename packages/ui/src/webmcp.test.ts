import { afterEach, expect, it, vi } from "vitest";
import { executeNativeTool, hasNativeWebMCP } from "./webmcp";
afterEach(() => vi.unstubAllGlobals());
it("passes an object and decodes the native WebMCP string result", async () => {
  const executeTool = vi.fn(async () => '{"stageId":"confirmed-1"}');
  vi.stubGlobal("document", {
    modelContext: { registerTool: vi.fn(), getTools: vi.fn(), executeTool },
  });
  const native = { name: "stage_inventory_hold" };
  const input = { transactionId: "tx" };
  const result = await executeNativeTool(
    {
      name: "stage_inventory_hold",
      description: "Stage stock",
      inputSchema: {},
      origin: "https://supplier.example",
      native,
    },
    input,
  );
  expect(executeTool).toHaveBeenCalledWith(native, input, {
    signal: undefined,
  });
  expect(result).toEqual({ stageId: "confirmed-1" });
  expect(hasNativeWebMCP()).toBe(true);
});
