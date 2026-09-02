import type { DiscoveredTool } from "@relayroom/ui";
import {
  discoverNativeTools,
  executeNativeTool,
  hasNativeWebMCP,
} from "@relayroom/ui";
import type { PartnerKind, OrderRecord } from "@relayroom/contracts";

type FrameMap = Record<
  "buyer" | "supplier" | "carrier",
  HTMLIFrameElement | null
>;
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: number;
  origin: string;
};

export type RuntimeMode = "native" | "bridge";

export class CrossOriginToolClient {
  private pending = new Map<string, PendingRequest>();
  private bridgeTools = new Map<string, DiscoveredTool>();
  private nativeTools = new Map<string, DiscoveredTool>();
  private messageHandler: (event: MessageEvent) => void;
  private session?: {
    tokens: Partial<Record<keyof FrameMap, string>>;
    order?: OrderRecord;
  };

  constructor(
    private frames: () => FrameMap,
    private origins: Record<"buyer" | "supplier" | "carrier", string>,
  ) {
    this.messageHandler = (event) => this.handleMessage(event);
    window.addEventListener("message", this.messageHandler);
  }

  destroy() {
    window.removeEventListener("message", this.messageHandler);
    this.pending.forEach(({ reject, timeout }) => {
      window.clearTimeout(timeout);
      reject(new Error("Tool client closed"));
    });
    this.pending.clear();
  }

  async setSession(
    tokens: Partial<Record<keyof FrameMap, string>>,
    order?: OrderRecord,
  ) {
    this.session = { tokens, order };
    await Promise.all(
      (Object.keys(this.origins) as Array<keyof FrameMap>).map((partner) =>
        this.sendSession(partner),
      ),
    );
  }

  private sendSession(partner: keyof FrameMap): Promise<unknown> {
    if (!this.session) return Promise.resolve();
    const requestId = crypto.randomUUID();
    const origin = this.origins[partner];
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${partner} session handshake timed out`));
      }, 7000);
      this.pending.set(requestId, { resolve, reject, timeout, origin });
      this.frames()[partner]?.contentWindow?.postMessage(
        {
          type: "relayroom:session",
          requestId,
          token: this.session!.tokens[partner],
          order: this.session!.order,
        },
        origin,
      );
    });
  }

  async discover(): Promise<{ tools: DiscoveredTool[]; mode: RuntimeMode }> {
    const requestedOrigins = Object.values(this.origins);
    if (hasNativeWebMCP()) {
      try {
        // getTools({ fromOrigins }) also includes same-origin room tools. Only partner
        // origins count when reporting native cross-origin connectivity.
        const native = (await discoverNativeTools(requestedOrigins)).filter(
          (tool) => requestedOrigins.includes(tool.origin),
        );
        this.nativeTools = new Map(native.map((tool) => [tool.name, tool]));
        if (
          requestedOrigins.every((origin) =>
            native.some((tool) => tool.origin === origin),
          )
        )
          return { tools: native, mode: "native" };
      } catch (error) {
        console.info(
          "[RelayRoom] Native discovery did not return partner tools.",
          error,
        );
      }
    }

    this.nativeTools.clear();
    this.bridgeTools.clear();
    const requestId = crypto.randomUUID();
    const frames = this.frames();
    (Object.keys(frames) as Array<keyof FrameMap>).forEach((partner) => {
      frames[partner]?.contentWindow?.postMessage(
        { type: "relayroom:discover", requestId },
        this.origins[partner],
      );
    });
    await new Promise((resolve) => window.setTimeout(resolve, 160));
    return { tools: [...this.bridgeTools.values()], mode: "bridge" };
  }

  async execute(
    toolName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const native = this.nativeTools.get(toolName);
    if (native) return executeNativeTool(native, input, signal);

    const tool = this.bridgeTools.get(toolName);
    if (!tool) throw new Error(`Tool not available: ${toolName}`);
    const partner = this.partnerForOrigin(tool.origin);
    const frame = this.frames()[partner];
    const targetWindow = frame?.contentWindow;
    if (!targetWindow) throw new Error(`${partner} portal is unavailable`);

    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      if (signal?.aborted)
        return reject(new DOMException("Cancelled", "AbortError"));
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${toolName} timed out`));
      }, 35_000);
      const onAbort = () => {
        window.clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(requestId, {
        origin: tool.origin,
        timeout,
        resolve: (value) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      });
      targetWindow.postMessage(
        { type: "relayroom:execute", requestId, tool: toolName, input },
        tool.origin,
      );
    });
  }

  broadcastPhase(phase: "idle" | "selected" | "approved" | "committed") {
    const frames = this.frames();
    (Object.keys(frames) as Array<keyof FrameMap>).forEach((partner) => {
      frames[partner]?.contentWindow?.postMessage(
        { type: "relayroom:phase", phase },
        this.origins[partner],
      );
    });
  }

  clearNativeCache() {
    this.nativeTools.clear();
  }

  private handleMessage(event: MessageEvent) {
    if (!Object.values(this.origins).includes(event.origin)) return;
    const partner = this.partnerForOrigin(event.origin);
    const sourceIsTrustedFrame =
      this.frames()[partner]?.contentWindow === event.source;
    if (!sourceIsTrustedFrame) return;
    const message = event.data as {
      type?: string;
      requestId?: string;
      tools?: DiscoveredTool[];
      ok?: boolean;
      result?: unknown;
      error?: { message?: string };
    };

    if (message.type === "relayroom:session-request")
      void this.sendSession(partner).catch(() => {});

    if (message.type === "relayroom:tools" && Array.isArray(message.tools)) {
      message.tools.forEach((tool) =>
        this.bridgeTools.set(tool.name, { ...tool, origin: event.origin }),
      );
    }
    if (message.type === "relayroom:result" && message.requestId) {
      const pending = this.pending.get(message.requestId);
      if (!pending || pending.origin !== event.origin) return;
      window.clearTimeout(pending.timeout);
      this.pending.delete(message.requestId);
      if (message.ok) pending.resolve(message.result);
      else
        pending.reject(
          new Error(message.error?.message || "Partner tool failed"),
        );
    }
  }

  private partnerForOrigin(origin: string): Exclude<PartnerKind, "room"> {
    const match = (
      Object.entries(this.origins) as Array<
        [Exclude<PartnerKind, "room">, string]
      >
    ).find(([, value]) => value === origin);
    if (!match) throw new Error(`Untrusted partner origin: ${origin}`);
    return match[0];
  }
}
