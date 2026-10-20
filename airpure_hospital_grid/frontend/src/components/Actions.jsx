import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, Async, Pill, LEVELS, WARD_LABEL, num, hm } from "../ui.jsx";
import { api } from "../api.js";
import { useApi } from "../hooks.js";

export default function OptimizationActions({ refreshKey, onSelect }) {
  const q = useApi(() => api.actions(), [refreshKey]);
  const [filter, setFilter] = useState("ALL");
  const [sort, setSort] = useState({ k: "priority", dir: -1 });
  const rows = useMemo(() => {
    const r = (q.data?.rows || []).filter((x) => filter === "ALL" || x.priority === filter);
    const val = { priority: (x) => LEVELS.indexOf(x.priority), ward: (x) => x.ward, co2: (x) => x.co2_ppm, action: (x) => x.action }[sort.k];
    return [...r].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [q.data, filter, sort]);
  const th = (k, label) => (
    <th aria-sort={sort.k === k ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
      <button className="thbtn" onClick={() => setSort((s) => ({ k, dir: s.k === k ? -s.dir : -1 }))}>{label}{sort.k === k ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</button></th>);
  return (
    <Async q={q}>{(d) => {
      const stale = d.rows.filter((r) => r.stale);
      return (
        <>
          {stale.length > 0 && <div className="warn" role="alert"><AlertTriangle size={16} />Stale data for {stale.map((s) => WARD_LABEL(s.ward)).join(", ")}: the latest reading is more than 3 intervals behind.</div>}
          <div className="prio-grid">
            {[...d.rows].sort((a, b) => LEVELS.indexOf(b.priority) - LEVELS.indexOf(a.priority)).map((r) => (
              <button key={r.ward} className="card prio" style={{ "--c": `var(--s${LEVELS.indexOf(r.priority)})` }} onClick={() => onSelect(r.ward)}>
                <Pill p={r.priority} /><strong>{WARD_LABEL(r.ward)}</strong><span>{r.action}</span>
                <span className="muted small">{r.fan_speed_delta_pct || r.damper_delta_pct ? `Fan +${r.fan_speed_delta_pct}% · Damper +${r.damper_delta_pct}%` : "No adjustment"}</span>
              </button>))}
          </div>
          <Card title="Control matrix" sub={d.note} right={
            <label className="inline">Priority<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="ALL">All</option>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></label>}>
            <div className="scroll"><table className="tbl"><thead><tr>{th("priority", "Priority")}{th("ward", "Ward")}{th("co2", "CO₂ / Airflow")}<th>PM2.5 / PM10</th><th>Temp / Humidity</th>{th("action", "Action")}<th>Reason</th><th>Anomaly</th><th>Reading</th></tr></thead>
              <tbody>{rows.length === 0 ? <tr><td colSpan="9" className="muted">No wards match this filter.</td></tr> : rows.map((r) => (
                <tr key={r.ward} className={r.stale ? "stale" : ""}>
                  <td><Pill p={r.priority} /></td><td><button className="link" onClick={() => onSelect(r.ward)}>{WARD_LABEL(r.ward)}</button></td>
                  <td>{num(r.co2_ppm, 0)} ppm / {num(r.airflow_ms, 2)} m/s</td><td>{num(r.pm25)} / {num(r.pm10)} µg/m³</td><td>{num(r.temp_c)} °C / {num(r.humidity_pct, 0)} %</td>
                  <td><b>{r.action}</b>{(r.fan_speed_delta_pct || r.damper_delta_pct) ? <div className="muted small">Fan +{r.fan_speed_delta_pct}% · Damper +{r.damper_delta_pct}%</div> : null}<div className="muted small">Recommended, not executed</div></td>
                  <td>{r.reason}</td><td>{r.predicted_anomaly ? `Flagged (${r.anomaly_type})` : "Not flagged"}</td><td>{hm(r.timestamp)}{r.stale ? " · stale" : ""}</td></tr>))}</tbody></table></div>
          </Card>
        </>);
    }}</Async>
  );
}
