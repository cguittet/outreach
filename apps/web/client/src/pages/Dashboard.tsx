import { FormEvent, useEffect, useState } from "react";
import { Check, Clock3, Inbox, MessageCircleReply, Target, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import { api, formatDue } from "../api";
import { Badge, Button, Empty, PageHeader } from "../components";
import type { Action } from "../types";

interface Summary {
  counts: { total: number; connected: number; pending: number; engaged: number };
  engagedStageId: string | null;
  goal: { target: number; addedToday: number; isBusinessDay: boolean };
  dueCount: number; todayCount: number; tasks: Action[];
}

export default function Dashboard() {
  const [data, setData] = useState<Summary>(); const [error, setError] = useState(""); const [editingGoal, setEditingGoal] = useState(false); const [goal, setGoal] = useState(5);
  const load = () => api<Summary>("/api/summary").then((value) => { setData(value); setGoal(value.goal.target); }).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const saveGoal = async (event: FormEvent) => { event.preventDefault(); await api("/api/settings", { method: "PATCH", body: JSON.stringify({ dailyProspectGoal: goal }) }); setEditingGoal(false); load(); };
  if (!data) return <div className="page"><PageHeader title="Today" body="Loading your next actions…" />{error && <div className="alert">{error}</div>}</div>;
  const due = data.tasks.filter((task) => new Date(task.dueAt) <= new Date()); const upcoming = data.tasks.filter((task) => new Date(task.dueAt) > new Date());
  const progress = data.goal.target ? Math.min(100, Math.round((data.goal.addedToday / data.goal.target) * 100)) : 100;
  return <div className="page">
    <PageHeader eyebrow={new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} title={data.dueCount ? `${data.dueCount} conversation${data.dueCount === 1 ? "" : "s"} need you` : "You’re all caught up"} body="A focused view of the relationships that need attention next." />
    <section className="metrics-grid metrics-five">
      <div className="metric featured"><span>Due now</span><strong>{data.dueCount}</strong><Clock3 /></div>
      <Link className="metric metric-link" to="/prospects"><span>Prospects</span><strong>{data.counts.total}</strong><UsersRound /></Link>
      <Link className="metric metric-link" to="/prospects?connection=connected"><span>Connected</span><strong>{data.counts.connected}</strong><Check /></Link>
      <Link className="metric metric-link" to={`/prospects${data.engagedStageId ? `?stage=${data.engagedStageId}` : ""}`}><span>Engaged</span><strong>{data.counts.engaged}</strong><MessageCircleReply /></Link>
      <div className="metric goal-metric"><span>{data.goal.isBusinessDay ? "Today’s prospect goal" : "Next business-day goal"}</span><strong>{data.goal.addedToday}<small> / {data.goal.target}</small></strong><Target />
        <div className="goal-progress"><i style={{ width: `${progress}%` }} /></div>
        {editingGoal ? <form onSubmit={saveGoal}><input aria-label="Daily prospect goal" type="number" min={0} max={1000} value={goal} onChange={(e) => setGoal(Number(e.target.value))} /><button>Save</button></form> : <button className="goal-edit" onClick={() => setEditingGoal(true)}>Edit goal</button>}
      </div>
    </section>
    <section className="two-column">
      <div className="panel"><div className="panel-heading"><div><span className="section-label">Priority</span><h2>Due now</h2></div><Badge tone={due.length ? "yellow" : "green"}>{due.length} open</Badge></div>{due.length ? <div className="task-list">{due.map((task) => <TaskRow key={task.id} task={task} onDone={load} />)}</div> : <Empty icon={<Inbox />} title="Nothing waiting" body="Your next follow-ups will appear here when they’re due." />}</div>
      <div className="panel subtle"><div className="panel-heading"><div><span className="section-label">On deck</span><h2>Coming up</h2></div></div>{upcoming.length ? <div className="upcoming-list">{upcoming.slice(0, 6).map((task) => <Link to={`/prospects/${task.prospect.id}`} key={task.id}><div><strong>{task.prospect.name}</strong><span>{task.label}</span></div><time>{formatDue(task.dueAt)}</time></Link>)}</div> : <Empty title="Clear horizon" body="No upcoming tasks have been scheduled yet." />}</div>
    </section>
  </div>;
}

function TaskRow({ task, onDone }: { task: Action; onDone: () => void }) {
  const complete = async () => { await api(`/api/tasks/${task.id}/complete`, { method: "POST" }); onDone(); };
  return <article className="task-row"><div className="avatar">{task.prospect.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</div><div className="task-main"><div><Link to={`/prospects/${task.prospect.id}`}>{task.prospect.name}</Link><Badge tone={task.actionType === "reply_needed" || task.actionType === "advance_stage" ? "green" : "neutral"}>{task.label}</Badge></div><p>{task.prospect.jobTitle}{task.prospect.jobTitle && task.prospect.company ? " · " : ""}{task.prospect.company}</p><time className={new Date(task.dueAt) < new Date() ? "overdue" : ""}>{formatDue(task.dueAt)}</time></div>{task.actionType === "advance_stage" ? <Link className="button button-secondary" to={`/prospects/${task.prospect.id}`}>Review</Link> : task.actionType === "close_no_response" ? <Button variant="secondary" onClick={complete}>Close</Button> : <Link className="button button-secondary" to={`/prospects/${task.prospect.id}`}>Open</Link>}</article>;
}
