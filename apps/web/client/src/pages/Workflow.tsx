import { useEffect, useState } from "react";
import { GripVertical, Plus, Save, Trash2 } from "lucide-react";
import { api } from "../api";
import { Button, PageHeader } from "../components";
import type { Step } from "../types";

interface WorkflowData { id: string; name: string; finalWaitBusinessDays: number; steps: Step[] }

export default function Workflow() {
  const [workflow, setWorkflow] = useState<WorkflowData>(); const [saved, setSaved] = useState(false); const [timezone, setTimezone] = useState("America/New_York");
  useEffect(() => { api<WorkflowData>("/api/workflow").then(setWorkflow); api<{ timezone: string }>("/api/settings").then((x) => setTimezone(x.timezone)); }, []);
  if (!workflow) return <div className="page"><PageHeader title="Workflow" body="Loading your sequence…" /></div>;
  const updateStep = (index: number, changes: Partial<Step>) => setWorkflow({ ...workflow, steps: workflow.steps.map((step, i) => i === index ? { ...step, ...changes } : step) });
  const save = async () => { await api("/api/workflow", { method: "PUT", body: JSON.stringify({ ...workflow, steps: workflow.steps.map((step, i) => ({ ...step, stepOrder: i + 1 })) }) }); await api("/api/settings", { method: "PATCH", body: JSON.stringify({ timezone }) }); setSaved(true); setTimeout(() => setSaved(false), 1600); };
  return <div className="page narrow-page"><PageHeader eyebrow="Sequence builder" title="Your Trucea workflow" body="Messages remain human-sent. This sequence decides what appears in your queue and when." action={<Button onClick={save}><Save size={17} />{saved ? "Saved" : "Save workflow"}</Button>} />
    <section className="workflow-intro"><label>Workflow name<input value={workflow.name} onChange={(e) => setWorkflow({ ...workflow, name: e.target.value })} /></label><label>Your timezone<select value={timezone} onChange={(e) => setTimezone(e.target.value)}>{["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris"].map((zone) => <option key={zone}>{zone}</option>)}</select></label></section>
    <div className="workflow-steps">{workflow.steps.map((step, index) => <section className="workflow-step" key={step.id ?? index}><div className="step-index"><GripVertical size={17} /><span>{index + 1}</span></div><div className="step-body"><div className="step-row"><label>Step name<input value={step.name} onChange={(e) => updateStep(index, { name: e.target.value })} /></label><label>Wait business days<input type="number" min={0} max={60} value={step.delayBusinessDays} onChange={(e) => updateStep(index, { delayBusinessDays: Number(e.target.value) })} /></label><button className="icon-button danger" aria-label="Remove step" onClick={() => setWorkflow({ ...workflow, steps: workflow.steps.filter((_, i) => i !== index) })}><Trash2 size={17} /></button></div><label>Message template<textarea rows={4} value={step.template} onChange={(e) => updateStep(index, { template: e.target.value })} /></label><small>Variables: {"{{first_name}}"}, {"{{name}}"}, {"{{company}}"}, {"{{job_title}}"}</small></div></section>)}</div>
    <Button variant="secondary" onClick={() => setWorkflow({ ...workflow, steps: [...workflow.steps, { id: crypto.randomUUID(), stepOrder: workflow.steps.length + 1, kind: "follow_up", name: `Follow-up ${workflow.steps.length}`, delayBusinessDays: 3, template: "Hi {{first_name}}, just following up on my last note." }] })}><Plus size={17} />Add follow-up</Button>
    <section className="workflow-close"><div><strong>After the final message</strong><p>Wait before offering to close the sequence as no response.</p></div><label><input type="number" min={1} max={60} value={workflow.finalWaitBusinessDays} onChange={(e) => setWorkflow({ ...workflow, finalWaitBusinessDays: Number(e.target.value) })} /> business days</label></section>
  </div>;
}
