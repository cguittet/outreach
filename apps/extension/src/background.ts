import { extensionApi, getConfig } from "./config";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("refresh-due-count", { periodInMinutes: 15 });
  void refresh();
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "refresh-due-count") void refresh(); });
chrome.notifications.onClicked.addListener(() => void getConfig().then((config) => config && chrome.tabs.create({ url: config.baseUrl })));

async function refresh() {
  const config = await getConfig();
  if (!config) return;
  try {
    const result = await extensionApi<{ count: number; next?: { prospect?: { name: string }; label?: string } }>(config, "/api/extension/due-count");
    await chrome.action.setBadgeText({ text: result.count ? String(result.count) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#215c42" });
    const state = await chrome.storage.local.get("lastDueCount");
    if (result.count > Number(state.lastDueCount ?? 0)) {
      await chrome.notifications.create("trucea-due", { type: "basic", iconUrl: "icons/icon128.png", title: `${result.count} follow-up${result.count === 1 ? "" : "s"} due`, message: result.next?.prospect?.name ? `${result.next.label} with ${result.next.prospect.name}` : "Open Trucea to review your queue." });
    }
    await chrome.storage.local.set({ lastDueCount: result.count });
  } catch { await chrome.action.setBadgeText({ text: "!" }); }
}
