import { useCallback, useEffect, useState } from "react";
const API_ORIGIN = import.meta.env
    ?.VITE_API_ORIGIN || "http://localhost:8787";
const STORAGE_KEY = "relayroom.session";
export async function workspaceApi(path, body) {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token)
        throw new Error("Sign in to access your workspace");
    const response = await fetch(`${API_ORIGIN}/api${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
        throw new Error(data.error?.message || "Workspace request failed");
    return data;
}
export function useAuth() {
    const [user, setUser] = useState();
    const [entitlements, setEntitlements] = useState();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState();
    const session = useCallback(async () => {
        const token = localStorage.getItem(STORAGE_KEY);
        if (!token) {
            setLoading(false);
            return;
        }
        try {
            const response = await fetch(`${API_ORIGIN}/api/auth/session`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok)
                throw new Error("Session expired");
            const data = (await response.json());
            setUser(data.user);
            setEntitlements(data.entitlements);
        }
        catch {
            localStorage.removeItem(STORAGE_KEY);
            setUser(undefined);
            setEntitlements(undefined);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        void session();
    }, [session]);
    const login = useCallback(async (email, password) => {
        setError(undefined);
        const response = await fetch(`${API_ORIGIN}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });
        const data = (await response.json());
        if (!response.ok || !data.token || !data.user || !data.entitlements) {
            const message = data.error?.message || "Could not sign in";
            setError(message);
            throw new Error(message);
        }
        localStorage.setItem(STORAGE_KEY, data.token);
        setUser(data.user);
        setEntitlements(data.entitlements);
        return data.user;
    }, []);
    const logout = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY);
        setUser(undefined);
        setEntitlements(undefined);
        setError(undefined);
    }, []);
    const checkout = useCallback(async () => {
        const token = localStorage.getItem(STORAGE_KEY);
        if (!token)
            throw new Error("Sign in before upgrading");
        const response = await fetch(`${API_ORIGIN}/api/billing/checkout`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await response.json());
        if (!response.ok)
            throw new Error(data.error?.message || "Checkout is unavailable");
        if (data.url)
            window.location.assign(data.url);
        else if (data.alreadyEntitled)
            await session();
    }, [session]);
    const grantDevPro = useCallback(async () => {
        const token = localStorage.getItem(STORAGE_KEY);
        if (!token)
            throw new Error("Sign in first");
        const response = await fetch(`${API_ORIGIN}/api/dev/grant-pro`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok)
            throw new Error("Local Polar event simulator is unavailable");
        const data = (await response.json());
        setUser(data.user);
        setEntitlements(data.entitlements);
    }, []);
    const planRecovery = useCallback(async (input, signal) => {
        const token = localStorage.getItem(STORAGE_KEY);
        if (!token)
            throw new Error("Sign in before planning a recovery");
        const response = await fetch(`${API_ORIGIN}/api/agent/plan`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(input),
            signal,
        });
        const data = (await response.json());
        if (!response.ok)
            throw new Error(data.error?.message || "The planning service is unavailable");
        return data;
    }, []);
    return {
        user,
        entitlements,
        loading,
        error,
        login,
        logout,
        checkout,
        grantDevPro,
        planRecovery,
        refresh: session,
    };
}
