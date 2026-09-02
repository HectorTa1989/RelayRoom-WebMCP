import type { DiscoveredTool } from "@relayroom/ui";
import type { OrderRecord } from "@relayroom/contracts";
type FrameMap = Record<"buyer" | "supplier" | "carrier", HTMLIFrameElement | null>;
export type RuntimeMode = "native" | "bridge";
export declare class CrossOriginToolClient {
    private frames;
    private origins;
    private pending;
    private bridgeTools;
    private nativeTools;
    private messageHandler;
    private session?;
    constructor(frames: () => FrameMap, origins: Record<"buyer" | "supplier" | "carrier", string>);
    destroy(): void;
    setSession(tokens: Partial<Record<keyof FrameMap, string>>, order?: OrderRecord): Promise<void>;
    private sendSession;
    discover(): Promise<{
        tools: DiscoveredTool[];
        mode: RuntimeMode;
    }>;
    execute(toolName: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
    broadcastPhase(phase: "idle" | "selected" | "approved" | "committed"): void;
    clearNativeCache(): void;
    private handleMessage;
    private partnerForOrigin;
}
export {};
