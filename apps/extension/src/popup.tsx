import { FormEvent, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { Check, Clipboard, ExternalLink, Link2, MessageCircle, RefreshCw, Save, Send, Settings } from "lucide-react";
import { companySizes, normalizeLinkedInUrl } from "@trucea/shared";
import { extensionApi, getConfig, type ExtensionConfig } from "./config";
import "./popup.css";

interface Prospect {
  id?: string; linkedinUrl: string; name?: string; jobTitle?: string; company?: string; companySize?: string; connectionStatus?: string; notes?: string;
  mutualContacts?: Array<{ name: string }>;
  nextAction?: { id: string; actionType: string; label?: string; message?: string; dueAt: string } | null;
}

const empty = (url: string): Prospect => ({ linkedinUrl: url, name: "", jobTitle: "", company: "", companySize: "Unknown", connectionStatus: "not_connected", notes: "", mutualContacts: [] });

function Popup() {
  const [config, setConfig] = useState<ExtensionConfig | null>(); const [tabUrl, setTabUrl] = useState(""); const [prospect, setProspect] = useState<Prospect>(); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [showSettings, setShowSettings] = useState(false);
  const load = async () => {
    setLoading(true); setError("");
    try {
      const saved = await getConfig(); setConfig(saved);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ? normalizeLinkedInUrl(tab.url) : ""; setTabUrl(url);
      if (saved) setProspect(await extensionApi<Prospect>(saved, `/api/extension/context?linkedinUrl=${encodeURIComponent(url)}`)); else setShowSettings(true);
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  if (loading) return <Frame onSettings={() => setShowSettings(true)}><div className="loading"><RefreshCw className="spin" />Loading profile…</div></Frame>;
  if (showSettings || !config) return <Frame onSettings={() => setShowSettings(true)}><SettingsForm config={config} onSaved={() => { setShowSettings(false); void load(); }} /></Frame>;
  if (error || !tabUrl) return <Frame onSettings={() => setShowSettings(true)}><div className="empty"><Link2 /><h2>Open a LinkedIn profile</h2><p>{error || "Visit a linkedin.com/in/... page, then open Trucea again."}</p><button onClick={() => void load()}>Try again</button></div></Frame>;
  return <Frame onSettings={() => setShowSettings(true)}><ProfileForm config={config} prospect={prospect ?? empty(tabUrl)} onUpdated={setProspect} /></Frame>;
}

function Frame({ children, onSettings }: { children: React.ReactNode; onSettings: () => void }) {
  return <main><header><div className="mark">T</div><div><strong>Trucea</strong><span>Outreach companion</span></div><button className="icon" onClick={onSettings}><Settings size={17} /></button></header>{children}</main>;
}

function SettingsForm({ config, onSaved }: { config: ExtensionConfig | null | undefined; onSaved: () => void }) {
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? ""); const [token, setToken] = useState(config?.token ?? ""); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); try { const url = new URL(baseUrl); const originPattern = `${url.origin}/*`; const granted = await chrome.permissions.request({ origins: [originPattern] }); if (!granted) throw new Error("Dashboard access was not granted"); await chrome.storage.local.set({ baseUrl: url.origin, token }); onSaved(); } catch (e) { setError((e as Error).message); } };
  return <form className="settings-form" onSubmit={submit}><div className="intro-icon"><Link2 /></div><h1>Pair your dashboard</h1><p>Paste the Replit app URL and the one-time token created in Extension settings.</p><label>Dashboard URL<input required type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-app.replit.app" /></label><label>Pairing token<input required value={token} onChange={(e) => setToken(e.target.value)} placeholder="trucea_…" /></label>{error && <div className="error">{error}</div>}<button className="primary"><Check size={16} />Save and pair</button></form>;
}

function ProfileForm({ config, prospect, onUpdated }: { config: ExtensionConfig; prospect: Prospect; onUpdated: (p: Prospect) => void }) {
  const [form, setForm] = useState({ ...prospect, mutualNames: prospect.mutualContacts?.map((x) => x.name).join(", ") ?? "" }); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  const save = async (event?: FormEvent) => { event?.preventDefault(); setSaving(true); setMessage(""); try { const saved = await extensionApi<Prospect>(config, "/api/extension/prospects", { method: "POST", body: JSON.stringify({ ...form, mutualContacts: form.mutualNames.split(",").map((name) => ({ name: name.trim() })).filter((x) => x.name) }) }); setForm({ ...saved, mutualNames: saved.mutualContacts?.map((x) => x.name).join(", ") ?? "" }); onUpdated(saved); setMessage("Saved"); } catch (e) { setMessage((e as Error).message); } setSaving(false); };
  const event = async (type: string) => { if (!prospect.id) await save(); const id = prospect.id ?? form.id; if (!id) return; const updated = await extensionApi<Prospect>(config, `/api/extension/prospects/${id}/activities`, { method: "POST", body: JSON.stringify({ type, content: type === "message_sent" ? prospect.nextAction?.message : "", scheduledActionId: prospect.nextAction?.id }) }); onUpdated(updated); setForm({ ...updated, mutualNames: updated.mutualContacts?.map((x) => x.name).join(", ") ?? "" }); };
  return <form className="profile-form" onSubmit={save}><div className="profile-heading"><div><span>{prospect.id ? "Saved prospect" : "New prospect"}</span><h1>{form.name || "Add this profile"}</h1></div>{prospect.id && <a href={`${config.baseUrl}/prospects/${prospect.id}`} target="_blank">Dashboard <ExternalLink size={14} /></a>}</div>
    <label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Prospect name" /></label><div className="split"><label>Job title<input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></label><label>Company<input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label></div><div className="split"><label>Company size<select value={form.companySize} onChange={(e) => setForm({ ...form, companySize: e.target.value })}>{companySizes.map((x) => <option key={x}>{x}</option>)}</select></label><label>Connection<select value={form.connectionStatus} onChange={(e) => setForm({ ...form, connectionStatus: e.target.value })}><option value="not_connected">Not connected</option><option value="pending">Pending</option><option value="connected">Connected</option></select></label></div><label>Mutual contacts<input value={form.mutualNames} onChange={(e) => setForm({ ...form, mutualNames: e.target.value })} placeholder="Names, separated by commas" /></label>
    {prospect.nextAction && <section className="next"><span>Next action</span><div><strong>{prospect.nextAction.label ?? "Follow up"}</strong><small>{new Date(prospect.nextAction.dueAt).toLocaleDateString()}</small></div>{prospect.nextAction.message && <p>{prospect.nextAction.message}</p>}<div className="next-actions">{prospect.nextAction.message && <button type="button" onClick={() => navigator.clipboard.writeText(prospect.nextAction!.message!)}><Clipboard size={15} />Copy</button>}{prospect.nextAction.actionType === "send_message" && <button type="button" onClick={() => void event("message_sent")}><Send size={15} />Mark sent</button>}{prospect.nextAction.actionType === "reply_needed" && <button type="button" onClick={() => void event("reply_sent")}><Send size={15} />Reply sent</button>}</div></section>}
    <div className="footer-actions"><button type="button" className="secondary" onClick={() => void event("reply_received")}><MessageCircle size={15} />Reply received</button><button className="primary" disabled={saving}><Save size={15} />{saving ? "Saving…" : "Save prospect"}</button></div>{message && <div className={message === "Saved" ? "success" : "error"}>{message}</div>}
  </form>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Popup />);
