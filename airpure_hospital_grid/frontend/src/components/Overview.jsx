import { Activity, PlayCircle, PlusCircle, RefreshCw, StopCircle, Wifi, WifiOff } from "lucide-react";
import { Pill, WARD_LABEL, num, hm, LEVELS } from "../ui.jsx";

export function LiveStatusIndicator({ status, busy, connected, lastFetch, streaming }) {
  const state = !connected ? "Disconnected" : busy ? "Fetching" : streaming ? "Streaming" : "Ready";
  return (
    <div className="live" role="status" aria-live="polite">
      {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
      <strong>{state}</strong>
      <span className="muted">{status?.mode === "simulation" ? "Simulation mode" : ""}{lastFetch ? ` · last fetch ${lastFetch}` : ""}</span>
    </div>
  );
}

export function SensorControls({ busy, streaming, onFetch, onStream, onAdd, interval }) {
  return (
    <div className="controls">
      <button className="btn" onClick={onFetch} disabled={busy}><RefreshCw size={15} className={busy ? "spin" : ""} />Fetch from sensor</button>
      <button className={"btn " + (streaming ? "on" : "")} onClick={onStream} aria-pressed={streaming}>
        {streaming ? <StopCircle size={15} /> : <PlayCircle size={15} />}{streaming ? "Stop live stream" : "Start live stream"}
      </button>
      <button className="btn" onClick={onAdd} disabled={busy} title="Appends one simulated reading per ward and re-runs the existing autoencoder, forecaster and optimizer">
        <PlusCircle size={15} />Add reading (+{interval >= 60 ? interval / 60 + " min" : interval + "s"})
      </button>
    </div>
  );
}

export function WardOverview({ latest, status, ward, onSelect }) {
  const rows = latest?.wards || [];
  const anomalies = rows.filter((r) => r.predicted_anomaly).length;
  const worst = rows.reduce((a, r) => (LEVELS.indexOf(r.priority) > LEVELS.indexOf(a) ? r.priority : a), "NONE");
  const crit = rows.filter((r) => ["HIGH", "CRITICAL"].includes(r.priority)).length;
  return (
    <>
      <div className="kpis">
        <div className="kpi"><span className="k">Hospital status</span><Pill p={rows.length ? worst : null} /></div>
        <div className="kpi"><span className="k">Monitored wards</span><b>{rows.length || "—"}</b></div>
        <div className="kpi"><span className="k">Anomalies now</span><b>{rows.length ? anomalies : "—"}</b></div>
        <div className="kpi"><span className="k">High / critical</span><b>{rows.length ? crit : "—"}</b></div>
        <div className="kpi"><span className="k">Sensors</span><b className="sm">Simulated · 0 real</b></div>
        <div className="kpi"><span className="k">Latest reading</span><b className="sm">{hm(rows.map((r) => r.timestamp).sort().at(-1))}</b></div>
      </div>
      <div className="wards">
        {rows.map((r) => (
          <button key={r.ward} className={"ward " + (ward === r.ward ? "sel" : "")} style={{ "--c": `var(--s${["NONE","LOW","MEDIUM","HIGH","CRITICAL"].indexOf(r.priority)})` }}
            onClick={() => onSelect(r.ward)} aria-pressed={ward === r.ward}>
            <div className="ward-top"><strong>{WARD_LABEL(r.ward)}</strong><Pill p={r.priority} /></div>
            <div className="ward-grid">
              <span>CO₂<b>{num(r.co2_ppm, 0)}</b><em>ppm</em></span><span>PM2.5<b>{num(r.pm25)}</b><em>µg/m³</em></span>
              <span>Airflow<b>{num(r.airflow_ms, 2)}</b><em>m/s</em></span><span>Temp<b>{num(r.temp_c)}</b><em>°C</em></span>
            </div>
            {r.predicted_anomaly && <div className="flag"><Activity size={13} />Anomaly flagged</div>}
          </button>
        ))}
      </div>
    </>
  );
}
