import { useEffect, useRef, useState } from "react";

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
};

export type WebMCPTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  execute: (
    input: Record<string, unknown>,
    context: { signal: AbortSignal },
  ) => unknown | Promise<unknown>;
};

export type DiscoveredTool = Omit<WebMCPTool, "execute"> & {
  origin: string;
  native?: unknown;
};

type ModelContext = EventTarget & {
  registerTool(
    tool: WebMCPTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<void> | void;
  getTools(options?: {
    fromOrigins?: string[];
  }): Promise<Array<DiscoveredTool & { window?: Window }>>;
  executeTool(
    tool: unknown,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
};

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

export function hasNativeWebMCP() {
  const context = document.modelContext;
  return (
    typeof context?.registerTool === "function" &&
    typeof context?.getTools === "function" &&
    typeof context?.executeTool === "function"
  );
}

export function usePartnerToolHost(tools: WebMCPTool[], roomOrigin: string) {
  const [nativeActive, setNativeActive] = useState(false);
  const [executingTool, setExecutingTool] = useState<string>();
  const toolsRef = useRef(tools);
  toolsRef.current = tools;

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    async function register() {
      if (!document.modelContext?.registerTool) return;
      try {
        await Promise.all(
          tools.map((tool) =>
            document.modelContext!.registerTool(
              {
                ...tool,
                execute: async (input, context) => {
                  setExecutingTool(tool.name);
                  try {
                    return await tool.execute(input, context);
                  } finally {
                    window.setTimeout(() => setExecutingTool(undefined), 480);
                  }
                },
              },
              { signal: controller.signal, exposedTo: [roomOrigin] },
            ),
          ),
        );
        if (live) setNativeActive(true);
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        )
          return;
        console.info(
          "[RelayRoom] Native WebMCP registration unavailable; manual controls remain active.",
          error,
        );
        if (live) setNativeActive(false);
      }
    }

    void register();
    return () => {
      live = false;
      controller.abort();
    };
  }, [roomOrigin, tools]);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== roomOrigin || event.source !== window.parent) return;
      const message = event.data as {
        type?: string;
        requestId?: string;
        tool?: string;
        input?: Record<string, unknown>;
      };

      if (message.type === "relayroom:discover") {
        window.parent.postMessage(
          {
            type: "relayroom:tools",
            requestId: message.requestId,
            origin: window.location.origin,
            tools: toolsRef.current.map(
              ({ execute: _execute, ...tool }) => tool,
            ),
          },
          roomOrigin,
        );
      }

      if (
        message.type === "relayroom:execute" &&
        message.requestId &&
        message.tool
      ) {
        const tool = toolsRef.current.find(
          (candidate) => candidate.name === message.tool,
        );
        if (!tool) {
          window.parent.postMessage(
            {
              type: "relayroom:result",
              requestId: message.requestId,
              ok: false,
              error: {
                code: "TOOL_NOT_AVAILABLE",
                message: "Tool is not available in the current partner state.",
                retryable: true,
              },
            },
            roomOrigin,
          );
          return;
        }

        setExecutingTool(tool.name);
        try {
          const result = await tool.execute(message.input ?? {}, {
            signal: new AbortController().signal,
          });
          window.parent.postMessage(
            {
              type: "relayroom:result",
              requestId: message.requestId,
              ok: true,
              result,
            },
            roomOrigin,
          );
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : "Partner tool failed";
          window.parent.postMessage(
            {
              type: "relayroom:result",
              requestId: message.requestId,
              ok: false,
              error: {
                code: "TOOL_EXECUTION_FAILED",
                message: messageText,
                retryable: false,
              },
            },
            roomOrigin,
          );
        } finally {
          window.setTimeout(() => setExecutingTool(undefined), 480);
        }
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [roomOrigin]);

  return { nativeActive, executingTool };
}

export async function discoverNativeTools(
  origins: string[],
): Promise<DiscoveredTool[]> {
  if (!document.modelContext?.getTools) return [];
  const tools = await document.modelContext.getTools({ fromOrigins: origins });
  return tools.map((tool) => ({ ...tool, native: tool }));
}

export async function executeNativeTool(
  tool: DiscoveredTool,
  input: Record<string, unknown>,
  signal?: AbortSignal,
) {
  if (!document.modelContext?.executeTool || !tool.native)
    throw new Error("Native WebMCP execution is unavailable");
  const result = await document.modelContext.executeTool(tool.native, input, {
    signal,
  });
  return JSON.parse(result);
}
