import { FormEvent, useEffect, useState } from "react";
import { ExternalLink, Plus, Search, UserPlus, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { companySizes } from "@trucea/shared";
import { api, formatDue, titleCase } from "../api";
import { Badge, Button, Empty, Modal, PageHeader } from "../components";
import type { Prospect } from "../types";

const blank = { linkedinUrl: "", name: "", jobTitle: "", company: "", companySize: "Unknown", connectionStatus: "not_connected", notes: "", mutualContacts: [] as Array<{ name: string }> };

export default function Prospects() {
  const [items, setItems] = useState<Prospect[]>([]);
  const [search, setSearch] = useState("");
  const [connection, setConnection] = useState("");
  const [adding, setAdding] = useState(false);
  const load = () => api<Prospect[]>(`/api/prospects?search=${encodeURIComponent(search)}&connection=${connection}`).then(setItems);
  useEffect(() => { const timer = setTimeout(load, 180); return () => clearTimeout(timer); }, [search, connection]);
  return <div className="page">
    <PageHeader eyebrow="Relationship pipeline" title="Prospects" body="Every conversation, context point, and next step in one place." action={<Button onClick={() => setAdding(true)}><Plus size={17} />Add prospect</Button>} />
    <div className="toolbar"><label className="search-field"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, company, or role" /></label><select value={connection} onChange={(e) => setConnection(e.target.value)}><option value="">All connections</option><option value="connected">Connected</option><option value="pending">Pending</option><option value="not_connected">Not connected</option></select></div>
    <section className="panel table-panel">{items.length ? <div className="table-wrap"><table><thead><tr><th>Prospect</th><th>Connection</th><th>Workflow</th><th>Next action</th><th /></tr></thead><tbody>{items.map((prospect) => <tr key={prospect.id}><td><Link className="person-cell" to={`/prospects/${prospect.id}`}><span className="avatar small">{prospect.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span><span><strong>{prospect.name}</strong><small>{prospect.jobTitle}{prospect.jobTitle && prospect.company ? " · " : ""}{prospect.company}</small></span></Link></td><td><Badge tone={prospect.connectionStatus === "connected" ? "green" : prospect.connectionStatus === "pending" ? "yellow" : "neutral"}>{titleCase(prospect.connectionStatus)}</Badge></td><td>{titleCase(prospect.workflowStatus)}</td><td>{prospect.nextAction ? <><strong>{prospect.nextAction.label}</strong><small className="block">{formatDue(prospect.nextAction.dueAt)}</small></> : <span className="muted">No action</span>}</td><td><a className="icon-button" href={prospect.linkedinUrl} target="_blank" rel="noreferrer" aria-label="Open LinkedIn"><ExternalLink size={17} /></a></td></tr>)}</tbody></table></div> : <Empty icon={<Users />} title="No prospects yet" body="Add a LinkedIn profile to start a thoughtful follow-up sequence." />}</section>
    {adding && <AddProspect onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
  </div>;
}

function AddProspect({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(blank); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { await api("/api/prospects", { method: "POST", body: JSON.stringify(form) }); onSaved(); } catch (e) { setError((e as Error).message); setSaving(false); } };
  return <Modal title="Add a prospect" onClose={onClose}><form className="form-grid" onSubmit={submit}>
    <label className="full">LinkedIn profile URL<input required type="url" value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} placeholder="https://www.linkedin.com/in/..." /></label>
    <label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Job title<input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></label>
    <label>Company<input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label><label>Company size<select value={form.companySize} onChange={(e) => setForm({ ...form, companySize: e.target.value })}>{companySizes.map((size) => <option key={size}>{size}</option>)}</select></label>
    <label className="full">Connection status<select value={form.connectionStatus} onChange={(e) => setForm({ ...form, connectionStatus: e.target.value })}><option value="not_connected">Not connected</option><option value="pending">Pending</option><option value="connected">Connected</option></select></label>
    {error && <div className="alert full">{error}</div>}<div className="form-actions full"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={saving}><UserPlus size={17} />{saving ? "Saving…" : "Add prospect"}</Button></div>
  </form></Modal>;
}
