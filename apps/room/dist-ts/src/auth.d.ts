import type { RecoveryPlanningRequest, RecoveryPlanningResponse } from "@relayroom/contracts";
export declare function workspaceApi<T>(path: string, body?: unknown): Promise<T>;
export type SessionUser = {
    id: string;
    email: string;
    name: string;
    role: "admin" | "operator";
    plan: "free" | "pro" | "admin";
};
export type Entitlements = {
    allAccess: boolean;
    source: "admin-bypass" | "polar" | "free";
    features: Record<"crossOriginRecovery" | "coordinatedCommit" | "failureRehearsal" | "auditExport", boolean>;
};
export declare function useAuth(): {
    user: SessionUser | undefined;
    entitlements: Entitlements | undefined;
    loading: boolean;
    error: string | undefined;
    login: (email: string, password: string) => Promise<SessionUser>;
    logout: () => void;
    checkout: () => Promise<void>;
    grantDevPro: () => Promise<void>;
    planRecovery: (input: RecoveryPlanningRequest, signal?: AbortSignal) => Promise<RecoveryPlanningResponse & {
        error?: {
            message?: string;
        };
    }>;
    refresh: () => Promise<void>;
};
