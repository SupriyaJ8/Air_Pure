import { useEffect, useState } from "react";
import { Download, FileText, RefreshCw } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Empty, ErrorState, Loading, Pill, WARD_LABEL, num } from "../ui.jsx";
import { api, url } from "../api.js";
import { reportToPdf } from "../lib/pdf.js";

const TYPES = [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]];
const addDays = (d, k) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };

function ReportFilters({ f, set, wards, range, busy, onGenerate }) {
  const end = f.type === "weekly" && f.date ? addDays(f.date, 6) : null;
  return (
    <form className="filters" onSubmit={(e) => { e.preventDefault(); onGenerate(); }}>
      <div className="seg" role="tablist" aria-label="Report type">{TYPES.map(([k, l]) => <button type="button" role="tab" aria-selected={f.type === k} key={k} className={f.type === k ? "on" : ""} onClick={() => set({ ...f, type: k })}>{l} report</button>)}</div>
      {f.type !== "monthly" ? (
        <label>{f.type === "weekly" ? "Week starts" : "Date"}<input type="date" required value={f.date} onChange={(e) => set({ ...f, date: e.target.value })} /></label>
      ) : (
        <label>Month<input type="month" required value={f.month} onChange={(e) => set({ ...f, month: e.target.value })} /></label>
      )}
      {end && <span className="muted small period">to {end} (7 days)</span>}
      <label>Ward<select value={f.ward} onChange={(e) => set({ ...f, ward: e.target.value })}><option value="">All wards</option>{wards.map((w) => <option key={w} value={w}>{WARD_LABEL(w)}</option>)}</select></label>
      <button className="btn primary" disabled={busy} type="submit"><FileText size={15} />Generate report</button>
    </form>
  );
}

function ReportCharts({ r }) {
  return (
    <Card title={`CO₂ and anomalies by ${r.breakdown_granularity === "hourly" ? "hour" : "day"}`} sub="Mean CO₂ (ppm, line) · detected anomalies (bars)">
      <div className="chart"><ResponsiveContainer width="100%" height={240}><ComposedChart data={r.breakdown} margin={{ left: -8, right: 8 }}>
        <CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="period" tick={{ fontSize: 11 }} minTickGap={30} tickFormatter={(p) => (p.length > 10 ? p.slice(11, 16) : p.slice(5))} />
        <YAxis yAxisId="a" tick={{ fontSize: 11 }} domain={["auto", "auto"]} /><YAxis yAxisId="b" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="b" dataKey="anomalies" name="Anomalies" fill="var(--s3)" opacity={0.6} isAnimationActive={false} />
        <Line yAxisId="a" dataKey="co2_mean" name="Mean CO₂ (ppm)" stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={false} />
      </ComposedChart></ResponsiveContainer></div>
    </Card>
  );
}

function ReportPreview({ r }) {
  if (r.empty) return <Empty>{r.message}</Empty>;
  const s = r.summary, st = s.stats;
  const label = r.type === "monthly" ? r.period.start.slice(0, 7) : r.type === "weekly" ? `${r.period.start} to ${r.period.end_inclusive}` : r.period.start;
  return (
    <div className="report" id="report-preview">
      <div className="rep-head"><h3>{r.type[0].toUpperCase() + r.type.slice(1)} report · {label}</h3>
        <p className="muted small">{r.ward === "ALL" ? "All wards" : WARD_LABEL(r.ward)} · timezone {r.timezone} · generated {r.generated_at} · source: {r.data_source}</p></div>
      <p className="note strong">{r.data_notice}</p>
      <div className="kpis">
        <div className="kpi"><span className="k">Readings</span><b>{s.readings.toLocaleString()}</b><em>{num(s.coverage_pct)}% of {s.expected_readings.toLocaleString()} expected</em></div>
        <div className="kpi"><span className="k">CO₂ mean / min / max</span><b className="sm">{num(st.co2_ppm.mean, 0)} / {num(st.co2_ppm.min, 0)} / {num(st.co2_ppm.max, 0)} ppm</b></div>
        <div className="kpi"><span className="k">PM2.5 · PM10 mean</span><b className="sm">{num(st.pm25.mean)} · {num(st.pm10.mean)} µg/m³</b></div>
        <div className="kpi"><span className="k">Temp · humidity mean</span><b className="sm">{num(st.temp_c.mean)} °C · {num(st.humidity_pct.mean, 0)} %</b></div>
        <div className="kpi"><span className="k">Airflow mean / min</span><b className="sm">{num(st.airflow_ms.mean, 2)} / {num(st.airflow_ms.min, 2)} m/s</b></div>
        <div className="kpi"><span className="k">Anomalies detected</span><b>{s.anomalies.detected}</b><em>{num(s.anomalies.rate_pct, 2)}% of readings</em></div>
      </div>
      <div className="grid2">
        <ReportCharts r={r} />
        <Card title="Key observations" sub="Computed from the measured data in this period"><ul className="obs">{r.observations.map((o, i) => <li key={i}>{o}</li>)}</ul></Card>
      </div>
      <Card title="Ward statistics"><div className="scroll"><table className="tbl small"><thead><tr><th>Ward</th><th>Readings</th><th>CO₂ mean / max</th><th>PM2.5</th><th>PM10</th><th>Temp</th><th>RH</th><th>Airflow mean / min</th><th>Anomalies</th><th>High / Crit.</th></tr></thead><tbody>
        {Object.entries(r.by_ward).map(([w, x]) => <tr key={w}><td>{WARD_LABEL(w)}</td><td>{x.readings}</td><td>{num(x.stats.co2_ppm.mean, 0)} / {num(x.stats.co2_ppm.max, 0)}</td><td>{num(x.stats.pm25.mean)}</td><td>{num(x.stats.pm10.mean)}</td><td>{num(x.stats.temp_c.mean)}</td><td>{num(x.stats.humidity_pct.mean, 0)}</td><td>{num(x.stats.airflow_ms.mean, 2)} / {num(x.stats.airflow_ms.min, 2)}</td><td>{x.anomalies.detected} ({num(x.anomalies.rate_pct)}%)</td><td>{x.critical_high}</td></tr>)}</tbody></table></div></Card>
      <div className="grid2">
        <Card title={`High and critical events (${r.events.total})`} sub={r.events.total > r.events.items.length ? `First ${r.events.items.length} shown; the CSV holds every record.` : "Consecutive readings grouped per ward"}>
          {r.events.items.length === 0 ? <p className="muted">No HIGH or CRITICAL recommendations in this period.</p> : <div className="scroll short"><table className="tbl small"><thead><tr><th>Ward</th><th>Start</th><th>Readings</th><th>Priority</th><th>Action</th></tr></thead><tbody>
            {r.events.items.map((e, i) => <tr key={i}><td>{WARD_LABEL(e.ward)}</td><td>{e.start.slice(5, 16)}</td><td>{e.readings}</td><td><Pill p={e.priority} /></td><td>{e.action}</td></tr>)}</tbody></table></div>}</Card>
        <Card title="HVAC recommendations issued" sub="Advisory only — none were executed">
          {r.recommendations.length === 0 ? <p className="muted">No non-NONE recommendations.</p> : <div className="scroll short"><table className="tbl small"><thead><tr><th>Ward</th><th>Action</th><th>Priority</th><th>Readings</th><th>Days</th></tr></thead><tbody>
            {r.recommendations.map((x, i) => <tr key={i}><td>{WARD_LABEL(x.ward)}</td><td>{x.action}</td><td><Pill p={x.priority} /></td><td>{x.count}</td><td>{x.days_affected}</td></tr>)}</tbody></table></div>}</Card>
        <Card title="Anomaly types" sub={r.anomaly_types.source}>
          <div className="scroll short"><table className="tbl small"><thead><tr><th>Ward</th><th>Type</th><th>Count</th></tr></thead><tbody>{r.anomaly_types.rows.map((x, i) => <tr key={i}><td>{WARD_LABEL(x.ward)}</td><td>{x.detected_type}</td><td>{x.count}</td></tr>)}</tbody></table></div></Card>
        <Card title="Forecast performance"><dl className="dl"><dt>Predictions</dt><dd>{r.forecast.n}</dd><dt>CO₂ MAE</dt><dd>{num(r.forecast.mae_co2_ppm, 2)} ppm</dd><dt>Airflow MAE</dt><dd>{num(r.forecast.mae_airflow_ms, 4)} m/s</dd></dl><p className="note">{r.forecast.note}</p></Card>
      </div>
      <Card title="Comparison with previous period" sub={r.previous_period ? `${r.previous_period.start} to ${r.previous_period.end_exclusive} (exclusive)` : ""}>
        {!r.comparison.available ? <p className="muted">{r.comparison.reason}</p> : <>
          {r.comparison.partial && <p className="note strong">The previous period has only {r.comparison.previous_coverage_pct}% data coverage.</p>}
          <table className="tbl small"><thead><tr><th>Metric</th><th>Current</th><th>Previous</th><th>Change</th></tr></thead><tbody>{r.comparison.metrics.map((m) => <tr key={m.metric}><td>{m.metric.replaceAll("_", " ")}</td><td>{num(m.current, 2)}</td><td>{num(m.previous, 2)}</td><td>{num(m.delta, 2)}</td></tr>)}</tbody></table></>}</Card>
      {r.weekly_breakdown && <Card title="Weekly summary (Monday-based weeks, clipped to the month)"><div className="scroll short"><table className="tbl small"><thead><tr><th>Week of</th><th>Readings</th><th>CO₂ mean</th><th>PM2.5</th><th>Anomalies</th><th>High / Crit.</th></tr></thead><tbody>{r.weekly_breakdown.map((w) => <tr key={w.period}><td>{w.period}</td><td>{w.readings}</td><td>{num(w.co2_mean, 0)}</td><td>{num(w.pm25_mean)}</td><td>{w.anomalies}</td><td>{w.critical_high}</td></tr>)}</tbody></table></div></Card>}
    </div>
  );
}

export default function Reports({ status }) {
  const range = status?.range;
  const [f, set] = useState({ type: "daily", date: "", month: "", ward: "" });
  const [res, setRes] = useState({ r: null, loading: false, error: null, key: null });
  useEffect(() => { // sensible defaults inside the available data range (last day / last 7 days / last month)
    if (range && !f.date) { const last = range.end.slice(0, 10); set((x) => ({ ...x, date: f.type === "weekly" ? addDays(last, -6) : last, month: last.slice(0, 7) })); }
  }, [range]); // eslint-disable-line
  useEffect(() => { if (range) set((x) => ({ ...x, date: x.type === "weekly" ? addDays(range.end.slice(0, 10), -6) : range.end.slice(0, 10) })); }, [f.type]); // eslint-disable-line
  const params = () => ({ type: f.type, ward: f.ward, ...(f.type === "monthly" ? { month: f.month } : { date: f.date }) });
  const generate = async () => {
    setRes((s) => ({ ...s, loading: true, error: null }));
    try { const p = params(); setRes({ r: await api.report(p), loading: false, error: null, p }); } catch (e) { setRes((s) => ({ ...s, loading: false, error: e })); }
  };
  const r = res.r, p = res.p, can = r && !r.empty && !res.loading;
  const dl = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const base = r ? `airpure_${r.type}_${r.type === "monthly" ? r.period.start.slice(0, 7) : r.period.start}_${r.ward}` : "";
  return (
    <div className="page">
      <h2>Reports</h2><p className="sub">Daily, weekly and monthly summaries computed by the backend from the stored readings. Calendar days use the hospital timezone ({status?.timezone || "—"}).</p>
      <Card><ReportFilters f={f} set={set} wards={status?.wards || []} range={range} busy={res.loading} onGenerate={generate} />
        {range && <p className="note">Available data: {range.start} to {range.end} (simulated).</p>}</Card>
      {res.loading && <Loading label="Generating report…" />}
      {res.error && <ErrorState error={res.error} onRetry={generate} />}
      {!r && !res.loading && !res.error && <Empty>Choose a report type and period, then select Generate report.</Empty>}
      {r && (
        <>
          <div className="exports">
            <button className="btn" onClick={generate} disabled={res.loading}><RefreshCw size={15} />Regenerate</button>
            <button className="btn" disabled={!can} onClick={() => reportToPdf(r).save(base + ".pdf")}><Download size={15} />PDF</button>
            <a className={"btn " + (can ? "" : "disabled")} aria-disabled={!can} href={can ? url("/api/report/export", p) : undefined}><Download size={15} />CSV (records)</a>
            <a className={"btn " + (can ? "" : "disabled")} aria-disabled={!can} href={can ? url("/api/report/export_summary", p) : undefined}><Download size={15} />CSV (summary)</a>
            <button className="btn" disabled={!can} onClick={() => dl(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }), base + ".json")}><Download size={15} />JSON</button>
          </div>
          <ReportPreview r={r} />
        </>)}
    </div>
  );
}
