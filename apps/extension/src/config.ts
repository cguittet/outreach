export interface ExtensionConfig { baseUrl: string; token: string }

export async function getConfig(): Promise<ExtensionConfig | null> {
  const value = await chrome.storage.local.get(["baseUrl", "token"]);
  return value.baseUrl && value.token ? { baseUrl: value.baseUrl, token: value.token } : null;
}

export async function extensionApi<T>(config: ExtensionConfig, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", authorization: `Bearer ${config.token}`, ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(body.message ?? "Request failed");
  }
  return response.status === 204 ? undefined as T : response.json();
}
