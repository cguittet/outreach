import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, TrendingUp, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { PageHeader } from "../components";

interface KpiData {
  stages: Array<{ id: string; name: string; archivedAt?: string | null }>;
  currentTotals: { prospects: number; stages: Array<{ stageId: string; name: string; count: number }> };
  buckets: Array<{ label: string; start: string; end: string; value: number }>;
  comparison: { current: number; previous: number; percentage: number | null; isNew: boolean };
}

export default function Kpis() {
  const [granularity, setGranularity] = useState("daily"); const [view, setView] = useState("entries"); const [metric, setMetric] = useState("added"); const [mode, setMode] = useState("bar"); const [data, setData] = useState<KpiData>(); const [error, setError] = useState("");
  useEffect(() => { api<KpiData>(`/api/kpis?granularity=${granularity}&view=${view}&metric=${metric}`).then(setData).catch((e) => setError(e.message)); }, [granularity, view, metric]);
  const chartData = useMemo(() => { let running = 0; return data?.buckets.map((bucket) => { if (mode === "trend" && (metric === "added" || view === "entries")) running += bucket.value; return { ...bucket, displayValue: mode === "trend" && (metric === "added" || view === "entries") ? running : bucket.value }; }) ?? []; }, [data, mode, metric, view]);
  const metricName = metric === "added" ? "Prospects added" : data?.stages.find((stage) => stage.id === metric)?.name ?? "Stage";
  return <div className="page"><PageHeader eyebrow="Pipeline intelligence" title="KPIs" body="See how prospect acquisition and lifecycle movement change over time." />
    {error && <div className="alert">{error}</div>}
    <section className="kpi-cards"><button className={metric === "added" ? "active" : ""} onClick={() => setMetric("added")}><span><Users size={16} />Prospects added</span><strong>{data?.currentTotals.prospects ?? 0}</strong></button>{data?.currentTotals.stages.map((stage) => <button key={stage.stageId} className={metric === stage.stageId ? "active" : ""} onClick={() => setMetric(stage.stageId)}><span>{stage.name}</span><strong>{stage.count}</strong></button>)}</section>
    <section className="panel kpi-panel"><div className="kpi-toolbar"><div><span className="section-label">Selected metric</span><h2>{metricName}</h2></div><label className="metric-picker">Metric<select value={metric} onChange={(e) => setMetric(e.target.value)}><option value="added">Prospects added</option>{data?.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}{stage.archivedAt ? " (archived)" : ""}</option>)}</select></label><div className="segmented"><button className={granularity === "daily" ? "active" : ""} onClick={() => setGranularity("daily")}>10 days</button><button className={granularity === "weekly" ? "active" : ""} onClick={() => setGranularity("weekly")}>6 weeks</button><button className={granularity === "monthly" ? "active" : ""} onClick={() => setGranularity("monthly")}>6 months</button></div><div className="segmented"><button disabled={metric === "added"} className={view === "entries" ? "active" : ""} onClick={() => setView("entries")}>Stage entries</button><button disabled={metric === "added"} className={view === "totals" ? "active" : ""} onClick={() => setView("totals")}>Stage totals</button></div><div className="segmented icon-segment"><button aria-label="Bar chart" className={mode === "bar" ? "active" : ""} onClick={() => setMode("bar")}><BarChart3 size={16} /></button><button aria-label="Trend chart" className={mode === "trend" ? "active" : ""} onClick={() => setMode("trend")}><TrendingUp size={16} /></button></div></div>
      <div className="kpi-summary"><div><strong>{data?.comparison.current ?? 0}</strong><span>{view === "totals" && metric !== "added" ? "at period end" : "during this period"}</span></div><div className={`change ${data?.comparison.percentage != null && data.comparison.percentage < 0 ? "negative" : "positive"}`}>{data?.comparison.isNew ? <>New <ArrowUpRight size={15} /></> : <>{(data?.comparison.percentage ?? 0) >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{Math.abs(data?.comparison.percentage ?? 0).toFixed(0)}%</>}<small>vs previous period</small></div></div>
      <div className="chart-wrap">{mode === "bar" ? <ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid vertical={false} stroke="#e8eee5" /><XAxis dataKey="label" axisLine={false} tickLine={false} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} /><Tooltip /><Bar dataKey="displayValue" name={metricName} fill="#35704f" radius={[7, 7, 0, 0]} /></BarChart></ResponsiveContainer> : <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid vertical={false} stroke="#e8eee5" /><XAxis dataKey="label" axisLine={false} tickLine={false} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} /><Tooltip /><Line type="monotone" dataKey="displayValue" name={metricName} stroke="#35704f" strokeWidth={3} dot={{ fill: "#c9f36b", stroke: "#215c42", strokeWidth: 2, r: 4 }} /></LineChart></ResponsiveContainer>}</div>
    </section>
  </div>;
}
