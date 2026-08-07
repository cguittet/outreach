import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Clipboard, ExternalLink, MessageCircle, Pause, Pencil, Play, Reply, Send, SkipForward, UserRoundCheck, XCircle } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api, formatDue, titleCase } from "../api";
import { Badge, Button, Empty, Modal, PageHeader } from "../components";
import type { Prospect, WorkflowData } from "../types";

export default function ProspectDetail() {
  const { id } = useParams(); const [prospect, setProspect] = useState<Prospect>(); const [workflow, setWorkflow] = useState<WorkflowData>(); const [error, setError] = useState(""); const [editing, setEditing] = useState(false); const [selectedStage, setSelectedStage] = useState("");
  const load = () => api<Prospect>(`/api/prospects/${id}`).then((value) => { setProspect(value); setSelectedStage(value.stage?.id ?? ""); }).catch((e) => setError(e.message));
  useEffect(() => { void load(); api<WorkflowData>("/api/workflow").then(setWorkflow); }, [id]);
  const patch = async (changes: Record<string, unknown>) => { await api(`/api/prospects/${id}`, { method: "PATCH", body: JSON.stringify(changes) }); load(); };
  const activity = async (type: string, content = "") => { await api(`/api/prospects/${id}/activities`, { method: "POST", body: JSON.stringify({ type, content, scheduledActionId: prospect?.nextAction?.id }) }); load(); };
  const reschedule = async (date: string) => { const actionId = prospect?.nextAction?.id; if (!actionId || !date) return; await api(`/api/tasks/${actionId}`, { method: "PATCH", body: JSON.stringify({ dueAt: new Date(`${date}T09:00:00`).toISOString() }) }); load(); };
  const moveStage = async (stageId = selectedStage, reason = "manual") => { if (!stageId || stageId === prospect?.stage?.id) return; await api(`/api/prospects/${id}/stage`, { method: "POST", body: JSON.stringify({ stageId, reason }) }); load(); };
  const nextStage = workflow?.stages[(workflow.stages.findIndex((stage) => stage.id === prospect?.stage?.id) + 1)] ?? null;
  if (!prospect) return <div className="page"><Link className="back-link" to="/prospects"><ArrowLeft size={17} />Prospects</Link><PageHeader title={error || "Loading prospect…"} /></div>;
  return <div className="page">
    <Link className="back-link" to="/prospects"><ArrowLeft size={17} />Prospects</Link>
    <PageHeader title={prospect.name} body={`${prospect.jobTitle}${prospect.jobTitle && prospect.company ? " at " : ""}${prospect.company}`} action={<div className="header-actions"><Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={16} />Edit</Button><select value={prospect.connectionStatus} onChange={(e) => patch({ connectionStatus: e.target.value })}><option value="not_connected">Not connected</option><option value="pending">Pending</option><option value="connected">Connected</option></select><a className="button button-secondary" href={prospect.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn <ExternalLink size={16} /></a></div>} />
    <div className="detail-grid"><div className="detail-main">
      <section className="next-action-card"><div><span className="section-label">Next action</span>{prospect.nextAction ? <><h2>{prospect.nextAction.label}</h2><p className={new Date(prospect.nextAction.dueAt) < new Date() ? "overdue" : ""}>{formatDue(prospect.nextAction.dueAt)}</p></> : <><h2>No action scheduled</h2><p>This relationship is waiting for your direction.</p></>}</div>
        {prospect.nextAction?.message && <div className="message-preview"><p>{prospect.nextAction.message}</p><Button variant="secondary" onClick={() => navigator.clipboard.writeText(prospect.nextAction!.message)}><Clipboard size={16} />Copy</Button></div>}
        <div className="action-strip">
          {prospect.connectionStatus === "not_connected" && <Button onClick={() => activity("connection_request_sent")}><UserRoundCheck size={17} />Mark request sent</Button>}
          {prospect.nextAction?.actionType === "send_message" && <Button onClick={() => activity("message_sent", prospect.nextAction?.message)}><Send size={17} />Mark message sent</Button>}
          {prospect.nextAction?.actionType === "reply_needed" && <Button onClick={() => activity("reply_sent", prospect.nextAction?.message)}><Reply size={17} />Mark reply sent</Button>}
          {prospect.nextAction?.actionType === "advance_stage" && nextStage && <Button onClick={() => moveStage(nextStage.id, "advance_confirmed")}><SkipForward size={17} />Confirm move to {nextStage.name}</Button>}
          <Button variant="secondary" onClick={() => activity("reply_received")}><MessageCircle size={17} />Reply received</Button>
          {prospect.nextAction?.actionType === "send_message" && <Button variant="ghost" onClick={() => api(`/api/tasks/${prospect.nextAction!.id}/skip`, { method: "POST" }).then(load)}><SkipForward size={17} />Skip message</Button>}
          <Button variant="ghost" onClick={() => patch({ trackingStatus: prospect.trackingStatus === "paused" ? "open" : "paused" })}>{prospect.trackingStatus === "paused" ? <Play size={17} /> : <Pause size={17} />}{prospect.trackingStatus === "paused" ? "Resume" : "Pause"}</Button>
          <Button variant="ghost" onClick={() => patch({ trackingStatus: prospect.trackingStatus === "closed" ? "open" : "closed" })}><XCircle size={17} />{prospect.trackingStatus === "closed" ? "Reopen" : "Close"}</Button>
        </div>{prospect.nextAction && <label className="reschedule">Reschedule <input type="date" min={new Date().toISOString().slice(0, 10)} onChange={(event) => void reschedule(event.target.value)} /></label>}
      </section>
      <section className="panel"><div className="panel-heading"><div><span className="section-label">History</span><h2>Conversation timeline</h2></div></div>{prospect.activities?.length ? <div className="timeline">{prospect.activities.map((item) => <div className="timeline-item" key={item.id}><span className="timeline-dot" /><div><div><strong>{titleCase(item.type)}</strong><time>{new Date(item.occurredAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></div>{item.content && <p>{item.content}</p>}</div></div>)}</div> : <Empty icon={<MessageCircle />} title="No activity yet" body="Sent messages, replies, and stage changes will build this timeline." />}</section>
    </div><aside className="detail-side">
      <section className="panel compact"><span className="section-label">Relationship</span><dl><div><dt>Connection</dt><dd><Badge tone={prospect.connectionStatus === "connected" ? "green" : "yellow"}>{titleCase(prospect.connectionStatus)}</Badge></dd></div><div><dt>Lifecycle stage</dt><dd>{prospect.stage?.name ?? "—"}</dd></div><div><dt>Tracking</dt><dd>{titleCase(prospect.trackingStatus)}</dd></div><div><dt>Company size</dt><dd>{prospect.companySize}</dd></div></dl><div className="stage-control"><select aria-label="Lifecycle stage" value={selectedStage} onChange={(e) => setSelectedStage(e.target.value)}>{workflow?.stages.map((stage) => <option value={stage.id} key={stage.id}>{stage.name}</option>)}</select><Button variant="secondary" disabled={!selectedStage || selectedStage === prospect.stage?.id} onClick={() => moveStage()}>Confirm stage change</Button></div></section>
      <Contacts prospect={prospect} onSave={load} /><Notes prospect={prospect} onSave={load} />
    </aside></div>
    {editing && <EditProspect prospect={prospect} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
  </div>;
}

function EditProspect({ prospect, onClose, onSaved }: { prospect: Prospect; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: prospect.name, jobTitle: prospect.jobTitle, company: prospect.company }); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); try { await api(`/api/prospects/${prospect.id}`, { method: "PATCH", body: JSON.stringify(form) }); onSaved(); } catch (e) { setError((e as Error).message); setSaving(false); } };
  return <Modal title="Edit prospect" onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="full">Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Job title<input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></label><label>Company<input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>{error && <div className="alert full">{error}</div>}<div className="form-actions full"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button></div></form></Modal>;
}

function Contacts({ prospect, onSave }: { prospect: Prospect; onSave: () => void }) { const [value, setValue] = useState(prospect.mutualContacts?.map((x) => x.name).join(", ") ?? ""); const save = () => api(`/api/prospects/${prospect.id}`, { method: "PATCH", body: JSON.stringify({ mutualContacts: value.split(",").map((name) => ({ name: name.trim() })).filter((x) => x.name) }) }).then(onSave); return <section className="panel compact"><span className="section-label">Mutual contacts</span><textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Names, separated by commas" /><Button variant="secondary" onClick={save}>Save contacts</Button></section>; }
function Notes({ prospect, onSave }: { prospect: Prospect; onSave: () => void }) { const [notes, setNotes] = useState(prospect.notes); const submit = (e: FormEvent) => { e.preventDefault(); api(`/api/prospects/${prospect.id}`, { method: "PATCH", body: JSON.stringify({ notes }) }).then(onSave); }; return <form className="panel compact" onSubmit={submit}><span className="section-label">Notes</span><textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context, interests, or a useful detail…" /><Button variant="secondary">Save notes</Button></form>; }
