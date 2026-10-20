import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Fragment } from "react";
import { Card, Async, Pill, WARD_LABEL, num, hm } from "../ui.jsx";
import { Chart } from "./Trends.jsx";
import { api, url } from "../api.js";
import { useApi } from "../hooks.js";
import { Download } from "lucide-react";

const TYPES = [["stagnation", "Stagnation", "#2b6cb0"], ["contamination_spike", "Contamination spike", "#b7791f"], ["hvac_fault", "HVAC fault", "#c53030"], ["false_positive", "Flagged, not injected", "#a0aec0"]];

export function AnomalyAnalytics({ refreshKey }) {
  const q = useApi(() => api.anomalies(), [refreshKey]);
  return (
    <Async q={q}>{(a) => {
      const m = a.metrics;
      const hist = a.histogram.edges.map((e, i) => ({ bin: e.toFixed(2), Normal: a.histogram.normal[i], "Injected anomaly": a.histogram.anomalous[i] }));
      return (
        <>
          <div className="kpis">
            <div className="kpi"><span className="k">Detected</span><b>{a.detected}</b></div>
            <div className="kpi"><span className="k">Anomaly rate</span><b>{num(a.rate_pct, 2)}%</b></div>
            <div className="kpi"><span className="k">Threshold (MSE)</span><b>{num(a.threshold, 4)}</b></div>
            <div className="kpi"><span className="k">Precision</span><b>{num(m.precision, 3)}</b></div>
            <div className="kpi"><span className="k">Recall</span><b>{num(m.recall, 3)}</b></div>
            <div className="kpi"><span className="k">F1</span><b>{num(m.f1, 3)}</b></div>
          </div>
          <div className="grid2">
            <Card title="Detection error" sub={`Normal vs injected anomalies · cutoff ${num(a.threshold, 4)} · last bin includes errors above ${num(a.histogram.max_clipped_at, 2)}`}>
              <div className="chart"><ResponsiveContainer width="100%" height={230}><BarChart data={hist} margin={{ left: -8, right: 8 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="bin" tick={{ fontSize: 10 }} interval={4} /><YAxis tick={{ fontSize: 11 }} scale="sqrt" /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Normal" fill="#7aa6a1" isAnimationActive={false} /><Bar dataKey="Injected anomaly" fill="var(--s4)" isAnimationActive={false} />
              </BarChart></ResponsiveContainer></div>
              <p className="note">Y axis is square-root scaled so the anomaly bars stay visible.</p>
            </Card>
            <Card title="Anomalies by ward" sub="Detected readings by type">
              <div className="chart"><ResponsiveContainer width="100%" height={230}><BarChart data={a.by_ward.map((w) => ({ ...w, name: WARD_LABEL(w.ward) }))} margin={{ left: -8, right: 8 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
                {TYPES.map(([k, n, c]) => <Bar key={k} dataKey={k} name={n} stackId="t" fill={c} isAnimationActive={false} />)}
              </BarChart></ResponsiveContainer></div>
              <p className="note">{a.type_source}</p>
            </Card>
            <Card title="Confusion matrix" sub="All readings, against injected synthetic labels">
              <table className="tbl small"><thead><tr><th></th><th>Flagged</th><th>Not flagged</th></tr></thead><tbody>
                <tr><th>Injected anomaly</th><td>TP {m.tp}</td><td>FN {m.fn}</td></tr><tr><th>Normal</th><td>FP {m.fp}</td><td>TN {m.tn}</td></tr></tbody></table>
              <p className="note">{a.disclaimer}</p>
            </Card>
            <Card title="Recent detections" sub="Latest 60 flagged readings">
              <div className="scroll short"><table className="tbl small"><thead><tr><th>Time</th><th>Ward</th><th>Error</th><th>Type</th><th>Priority</th></tr></thead><tbody>
                {a.history.map((h, i) => <tr key={i}><td>{hm(h.timestamp)}</td><td>{WARD_LABEL(h.ward)}</td><td>{num(h.reconstruction_error, 2)}</td><td>{h.detected_type}</td><td><Pill p={h.priority} /></td></tr>)}</tbody></table></div>
            </Card>
          </div>
        </>);
    }}</Async>
  );
}

export function ForecastPanel({ ward, refreshKey }) {
  const q = useApi(() => api.forecast(ward, 48), [ward, refreshKey]);
  return (
    <Async q={q}>{(f) => (
      <>
        <div className="kpis">
          <div className="kpi"><span className="k">CO₂ next reading</span><b>{num(f.next.co2_ppm, 0)} <small>ppm</small></b></div>
          <div className="kpi"><span className="k">Airflow next reading</span><b>{num(f.next.airflow_ms, 2)} <small>m/s</small></b></div>
          <div className="kpi"><span className="k">Horizon</span><b>{f.horizon_sec / 60} <small>min (1 step)</small></b></div>
          <div className="kpi"><span className="k">Made from data at</span><b className="sm">{f.next.made_at}</b></div>
          <div className="kpi"><span className="k">MAE · last 48 h</span><b className="sm">{f.window_mae ? `${num(f.window_mae.co2_ppm, 1)} ppm · ${num(f.window_mae.airflow_ms, 3)} m/s` : "—"}</b></div>
          <div className="kpi"><span className="k">MAE · backend test set</span><b className="sm">{num(f.backend_test_mae.co2_ppm, 1)} ppm · {num(f.backend_test_mae.airflow_ms, 3)} m/s</b></div>
        </div>
        <div className="grid2">
          <Card title="CO₂: actual vs predicted" sub="Each prediction uses the 6 readings before it"><Chart data={f.rows} unit="ppm" lines={[{ key: "co2_ppm", name: "Actual", color: "var(--accent)" }, { key: "forecast_co2", name: "Predicted", color: "#c05621", dash: "4 3" }]} /></Card>
          <Card title="Airflow: actual vs predicted" sub="m/s"><Chart data={f.rows} unit="m/s" lines={[{ key: "airflow_ms", name: "Actual", color: "#2b6cb0" }, { key: "forecast_flow", name: "Predicted", color: "#c05621", dash: "4 3" }]} /></Card>
        </div>
        <p className="note">One-step-ahead forecast only; this model does not produce a long-term outlook. Trained on simulated data.</p>
      </>)}</Async>
  );
}

export function ReportSection({ refreshKey }) {
  const st = useApi(() => api.status(), [refreshKey]);
  const an = useApi(() => api.anomalies(), [refreshKey]);
  const fc = useApi(() => api.forecast("ICU", 48), [refreshKey]);
  return (
    <Async q={st}>{(s) => (
      <>
        <p className="sub">{s.rows.toLocaleString()} readings · {s.range.start.slice(0, 10)} to {s.range.end.slice(0, 10)} · model trained {s.trained_at} · source: simulation (simulate_data.py)</p>
        <div className="grid2">
          <Card title="Anomaly detection">{an.data ? <dl className="dl"><dt>F1 / Precision / Recall</dt><dd>{num(an.data.metrics.f1, 3)} / {num(an.data.metrics.precision, 3)} / {num(an.data.metrics.recall, 3)}</dd>
            <dt>True / false positives</dt><dd>{an.data.metrics.tp} / {an.data.metrics.fp}</dd><dt>False / true negatives</dt><dd>{an.data.metrics.fn} / {an.data.metrics.tn}</dd>
            <dt>Readings analysed</dt><dd>{an.data.total.toLocaleString()} · anomaly rate {num(an.data.rate_pct, 2)}%</dd></dl> : <p className="muted">Loading…</p>}</Card>
          <Card title="Forecast accuracy">{fc.data ? <dl className="dl"><dt>CO₂ MAE</dt><dd>{num(fc.data.backend_test_mae.co2_ppm, 2)} ppm</dd><dt>Airflow MAE</dt><dd>{num(fc.data.backend_test_mae.airflow_ms, 4)} m/s</dd><dt>Basis</dt><dd>Held-out 20% split, existing train_forecaster()</dd></dl> : <p className="muted">Loading…</p>}</Card>
          <Card title="Anomaly types" sub="Detected readings, simulator label">{an.data ? <dl className="dl">{TYPES.map(([k, n]) => <Fragment key={k}><dt>{n}</dt><dd>{an.data.by_ward.reduce((t, w) => t + w[k], 0)}</dd></Fragment>)}</dl> : null}</Card>
          <Card title="Downloads"><a className="btn" href={url("/api/export/control_log.csv")}><Download size={15} />Download CSV log</a><p className="note">Every non-NONE recommendation produced by the optimizer across the history. Recommendations only; none were executed.</p></Card>
        </div>
        <p className="note">{s.notice}</p>
      </>)}</Async>
  );
}
