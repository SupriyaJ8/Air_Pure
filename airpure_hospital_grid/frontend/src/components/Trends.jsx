import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Async, WARD_LABEL, hm } from "../ui.jsx";
import { api } from "../api.js";
import { useApi } from "../hooks.js";

const WINDOWS = [["24 h", 24], ["3 days", 72], ["7 days", 168], ["All data", 0]];

export function Chart({ data, lines, anomKey, unit, y2 }) {
  return (
    <div className="chart" role="img" aria-label={lines.map((l) => l.name).join(", ") + " chart"}>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 8, right: y2 ? 8 : 12, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="timestamp" tickFormatter={hm} minTickGap={48} tick={{ fontSize: 11 }} />
          <YAxis yAxisId="a" tick={{ fontSize: 11 }} domain={["auto", "auto"]} unit={unit ? " " + unit : ""} width={58} />
          {y2 && <YAxis yAxisId="b" orientation="right" tick={{ fontSize: 11 }} domain={["auto", "auto"]} unit={y2} width={48} />}
          <Tooltip labelFormatter={(l) => l} contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => (typeof v === "number" ? v.toFixed(2) : v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {lines.map((l) => <Line key={l.key} yAxisId={l.axis || "a"} dataKey={l.key} name={l.name} stroke={l.color} dot={false} strokeWidth={l.w || 1.4} strokeDasharray={l.dash} isAnimationActive={false} connectNulls />)}
          {anomKey && <Line yAxisId="a" dataKey={anomKey} name="Flagged anomaly" stroke="none" dot={{ r: 3.5, fill: "var(--s4)", stroke: "#fff" }} activeDot={{ r: 5 }} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function TrendCharts({ ward, wards, onSelect, windowHours, setWindowHours, refreshKey }) {
  const q = useApi(() => api.series(ward, windowHours), [ward, windowHours, refreshKey]);
  const rows = (q.data?.rows || []).map((r) => ({ ...r, co2_anom: r.predicted_anomaly ? r.co2_ppm : null, flow_anom: r.predicted_anomaly ? r.airflow_ms : null,
    pm25_anom: r.predicted_anomaly ? r.pm25 : null, temp_anom: r.predicted_anomaly ? r.temp_c : null }));
  const d = q.data;
  return (
    <>
      <div className="toolbar">
        <label>Ward<select value={ward} onChange={(e) => onSelect(e.target.value)}>{wards.map((w) => <option key={w} value={w}>{WARD_LABEL(w)}</option>)}</select></label>
        <div className="seg" role="group" aria-label="Time window">{WINDOWS.map(([l, h]) => <button key={h} className={windowHours === h ? "on" : ""} onClick={() => setWindowHours(h)} aria-pressed={windowHours === h}>{l}</button>)}</div>
        {d && <span className="muted small">{d.n_returned} points · {d.start?.slice(0, 16)} → {d.end?.slice(0, 16)} · {d.interval_sec / 60}-min interval{d.downsampled ? " · downsampled, anomalies kept" : ""}</span>}
      </div>
      <Async q={q} empty={(x) => !x.rows.length && "No readings in this window."}>{() => (
        <div className="grid2">
          <Card title="CO₂ concentration" sub={`${WARD_LABEL(ward)}, ppm`}><Chart data={rows} unit="ppm" anomKey="co2_anom" lines={[{ key: "co2_ppm", name: "CO₂", color: "var(--accent)" }]} /></Card>
          <Card title="Airflow velocity" sub="m/s"><Chart data={rows} unit="m/s" anomKey="flow_anom" lines={[{ key: "airflow_ms", name: "Airflow", color: "#2b6cb0" }]} /></Card>
          <Card title="Particulate matter" sub="µg/m³"><Chart data={rows} unit="µg/m³" anomKey="pm25_anom" lines={[{ key: "pm25", name: "PM2.5", color: "#b7791f" }, { key: "pm10", name: "PM10", color: "#718096" }]} /></Card>
          <Card title="Temperature and humidity" sub="°C (left) · % RH (right)"><Chart data={rows} y2="%" unit="°C" anomKey="temp_anom" lines={[{ key: "temp_c", name: "Temperature °C", color: "#c05621" }, { key: "humidity_pct", name: "Humidity %", axis: "b", color: "#2c7a7b" }]} /></Card>
        </div>)}</Async>
    </>
  );
}
