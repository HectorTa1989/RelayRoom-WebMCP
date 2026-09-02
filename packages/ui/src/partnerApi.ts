let partnerToken: string | undefined;
export function setPartnerToken(token?: string) {
  partnerToken = token;
}

export async function partnerApi<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: {
      ...(partnerToken ? { Authorization: `Bearer ${partnerToken}` } : {}),
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const data = (await response.json()) as T & {
    error?: { code?: string; message?: string };
  };
  if (!response.ok)
    throw new Error(
      data.error?.message ||
        data.error?.code ||
        `Partner API returned ${response.status}`,
    );
  return data;
}
