import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Clock3, Inbox, MessageCircleReply, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import { api, formatDue } from "../api";
import { Badge, Button, Empty, PageHeader } from "../components";
import type { Action } from "../types";

interface Summary { counts: { total: number; connected: number; pending: number; engaged: number }; dueCount: number; todayCount: number; tasks: Action[] }

export default function Dashboard() {
  const [data, setData] = useState<Summary>();
  const [error, setError] = useState("");
  const load = () => api<Summary>("/api/summary").then(setData).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  if (!data) return <div className="page"><PageHeader title="Today" body="Loading your next actions…" />{error && <div className="alert">{error}</div>}</div>;
  const due = data.tasks.filter((task) => new Date(task.dueAt) <= new Date());
  const upcoming = data.tasks.filter((task) => new Date(task.dueAt) > new Date());
  return <div className="page">
    <PageHeader eyebrow={new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} title={data.dueCount ? `${data.dueCount} conversation${data.dueCount === 1 ? "" : "s"} need you` : "You’re all caught up"} body="A focused view of the relationships that need attention next." action={<Link className="button button-primary" to="/prospects">View prospects <ArrowUpRight size={17} /></Link>} />
    <section className="metrics-grid">
      <div className="metric featured"><span>Due now</span><strong>{data.dueCount}</strong><Clock3 /></div>
      <div className="metric"><span>Prospects</span><strong>{data.counts.total}</strong><UsersRound /></div>
      <div className="metric"><span>Connected</span><strong>{data.counts.connected}</strong><Check /></div>
      <div className="metric"><span>Engaged</span><strong>{data.counts.engaged}</strong><MessageCircleReply /></div>
    </section>
    <section className="two-column">
      <div className="panel"><div className="panel-heading"><div><span className="section-label">Priority</span><h2>Due now</h2></div><Badge tone={due.length ? "yellow" : "green"}>{due.length} open</Badge></div>
        {due.length ? <div className="task-list">{due.map((task) => <TaskRow key={task.id} task={task} onDone={load} />)}</div> : <Empty icon={<Inbox />} title="Nothing waiting" body="Your next follow-ups will appear here when they’re due." />}
      </div>
      <div className="panel subtle"><div className="panel-heading"><div><span className="section-label">On deck</span><h2>Coming up</h2></div></div>
        {upcoming.length ? <div className="upcoming-list">{upcoming.slice(0, 6).map((task) => <Link to={`/prospects/${task.prospect.id}`} key={task.id}><div><strong>{task.prospect.name}</strong><span>{task.label}</span></div><time>{formatDue(task.dueAt)}</time></Link>)}</div> : <Empty title="Clear horizon" body="No upcoming tasks have been scheduled yet." />}
      </div>
    </section>
  </div>;
}

function TaskRow({ task, onDone }: { task: Action; onDone: () => void }) {
  const complete = async () => { await api(`/api/tasks/${task.id}/complete`, { method: "POST" }); onDone(); };
  return <article className="task-row"><div className="avatar">{task.prospect.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</div><div className="task-main"><div><Link to={`/prospects/${task.prospect.id}`}>{task.prospect.name}</Link><Badge tone={task.actionType === "reply_needed" ? "green" : "neutral"}>{task.label}</Badge></div><p>{task.prospect.jobTitle}{task.prospect.jobTitle && task.prospect.company ? " · " : ""}{task.prospect.company}</p><time className={new Date(task.dueAt) < new Date() ? "overdue" : ""}>{formatDue(task.dueAt)}</time></div>{task.actionType === "close_no_response" ? <Button variant="secondary" onClick={complete}>Close</Button> : <Link className="button button-secondary" to={`/prospects/${task.prospect.id}`}>Open</Link>}</article>;
}
