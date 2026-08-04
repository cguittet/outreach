import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Check, Clipboard, ExternalLink, MessageCircle, Pause, Play, Reply, Send, SkipForward, UserRoundCheck, XCircle } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api, formatDue, titleCase } from "../api";
import { Badge, Button, Empty, PageHeader } from "../components";
import type { Prospect } from "../types";

export default function ProspectDetail() {
  const { id } = useParams(); const [prospect, setProspect] = useState<Prospect>(); const [error, setError] = useState("");
  const load = () => api<Prospect>(`/api/prospects/${id}`).then(setProspect).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, [id]);
  const patch = async (changes: Record<string, unknown>) => { await api(`/api/prospects/${id}`, { method: "PATCH", body: JSON.stringify(changes) }); load(); };
  const activity = async (type: string, content = "") => { await api(`/api/prospects/${id}/activities`, { method: "POST", body: JSON.stringify({ type, content, scheduledActionId: prospect?.nextAction?.id }) }); load(); };
  const reschedule = async (date: string) => { const actionId = prospect?.nextAction?.id; if (!actionId || !date) return; const dueAt = new Date(`${date}T09:00:00`).toISOString(); await api(`/api/tasks/${actionId}`, { method: "PATCH", body: JSON.stringify({ dueAt }) }); load(); };
  if (!prospect) return <div className="page"><Link className="back-link" to="/prospects"><ArrowLeft size={17} />Prospects</Link><PageHeader title={error || "Loading prospect…"} /></div>;
  return <div className="page">
    <Link className="back-link" to="/prospects"><ArrowLeft size={17} />Prospects</Link>
    <PageHeader title={prospect.name} body={`${prospect.jobTitle}${prospect.jobTitle && prospect.company ? " at " : ""}${prospect.company}`} action={<div className="header-actions"><select value={prospect.connectionStatus} onChange={(e) => patch({ connectionStatus: e.target.value })}><option value="not_connected">Not connected</option><option value="pending">Pending</option><option value="connected">Connected</option></select><a className="button button-secondary" href={prospect.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn <ExternalLink size={16} /></a></div>} />
    <div className="detail-grid">
      <div className="detail-main">
        <section className="next-action-card"><div><span className="section-label">Next action</span>{prospect.nextAction ? <><h2>{prospect.nextAction.label}</h2><p className={new Date(prospect.nextAction.dueAt) < new Date() ? "overdue" : ""}>{formatDue(prospect.nextAction.dueAt)}</p></> : <><h2>No action scheduled</h2><p>This relationship is waiting for your direction.</p></>}</div>
          {prospect.nextAction?.message && <div className="message-preview"><p>{prospect.nextAction.message}</p><Button variant="secondary" onClick={() => navigator.clipboard.writeText(prospect.nextAction!.message)}><Clipboard size={16} />Copy</Button></div>}
          <div className="action-strip">
            {prospect.connectionStatus === "not_connected" && <Button onClick={() => activity("connection_request_sent")}><UserRoundCheck size={17} />Mark request sent</Button>}
            {prospect.nextAction?.actionType === "send_message" && <Button onClick={() => activity("message_sent", prospect.nextAction?.message)}><Send size={17} />Mark message sent</Button>}
            {prospect.nextAction?.actionType === "reply_needed" && <Button onClick={() => activity("reply_sent")}><Reply size={17} />Mark reply sent</Button>}
            {prospect.nextAction?.actionType === "close_no_response" && <Button onClick={() => api(`/api/tasks/${prospect.nextAction!.id}/complete`, { method: "POST" }).then(load)}><Check size={17} />Close sequence</Button>}
            <Button variant="secondary" onClick={() => activity("reply_received")}><MessageCircle size={17} />Reply received</Button>
            {prospect.nextAction?.actionType === "send_message" && <Button variant="ghost" onClick={() => api(`/api/tasks/${prospect.nextAction!.id}/skip`, { method: "POST" }).then(load)}><SkipForward size={17} />Skip step</Button>}
            <Button variant="ghost" onClick={() => patch({ workflowStatus: prospect.workflowStatus === "paused" ? "active" : "paused" })}>{prospect.workflowStatus === "paused" ? <Play size={17} /> : <Pause size={17} />}{prospect.workflowStatus === "paused" ? "Resume" : "Pause"}</Button>
            <Button variant="ghost" onClick={() => patch({ workflowStatus: prospect.workflowStatus === "closed" ? "active" : "closed" })}><XCircle size={17} />{prospect.workflowStatus === "closed" ? "Reopen" : "Close"}</Button>
          </div>
          {prospect.nextAction && <label className="reschedule">Reschedule <input type="date" min={new Date().toISOString().slice(0, 10)} onChange={(event) => void reschedule(event.target.value)} /></label>}
        </section>
        <section className="panel"><div className="panel-heading"><div><span className="section-label">History</span><h2>Conversation timeline</h2></div></div>{prospect.activities?.length ? <div className="timeline">{prospect.activities.map((item) => <div className="timeline-item" key={item.id}><span className="timeline-dot" /><div><div><strong>{titleCase(item.type)}</strong><time>{new Date(item.occurredAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></div>{item.content && <p>{item.content}</p>}</div></div>)}</div> : <Empty icon={<MessageCircle />} title="No activity yet" body="Sent messages, replies, and status changes will build this timeline." />}</section>
      </div>
      <aside className="detail-side"><section className="panel compact"><span className="section-label">Relationship</span><dl><div><dt>Connection</dt><dd><Badge tone={prospect.connectionStatus === "connected" ? "green" : "yellow"}>{titleCase(prospect.connectionStatus)}</Badge></dd></div><div><dt>Workflow</dt><dd>{titleCase(prospect.workflowStatus)}</dd></div><div><dt>Company size</dt><dd>{prospect.companySize}</dd></div></dl></section>
        <Contacts prospect={prospect} onSave={load} />
        <Notes prospect={prospect} onSave={load} />
      </aside>
    </div>
  </div>;
}

function Contacts({ prospect, onSave }: { prospect: Prospect; onSave: () => void }) {
  const [value, setValue] = useState(prospect.mutualContacts?.map((x) => x.name).join(", ") ?? "");
  const save = () => api(`/api/prospects/${prospect.id}`, { method: "PATCH", body: JSON.stringify({ mutualContacts: value.split(",").map((name) => ({ name: name.trim() })).filter((x) => x.name) }) }).then(onSave);
  return <section className="panel compact"><span className="section-label">Mutual contacts</span><textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Names, separated by commas" /><Button variant="secondary" onClick={save}>Save contacts</Button></section>;
}

function Notes({ prospect, onSave }: { prospect: Prospect; onSave: () => void }) {
  const [notes, setNotes] = useState(prospect.notes); const submit = (e: FormEvent) => { e.preventDefault(); api(`/api/prospects/${prospect.id}`, { method: "PATCH", body: JSON.stringify({ notes }) }).then(onSave); };
  return <form className="panel compact" onSubmit={submit}><span className="section-label">Notes</span><textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context, interests, or a useful detail…" /><Button variant="secondary">Save notes</Button></form>;
}
