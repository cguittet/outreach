export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(body.message ?? "Request failed");
  }
  return response.status === 204 ? undefined as T : response.json();
}

export function formatDue(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return `Today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (days === 1) return "Tomorrow";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
