import { Card, Pill, WARD_LABEL, num, hm } from "../ui.jsx";

// Conceptual layout only: the backend has no architectural geometry or airflow direction.
const ROOMS = {
  ICU:             { x: 20,  y: 20,  w: 310, h: 170, door: [175, 190] },
  Isolation_Ward:  { x: 390, y: 20,  w: 310, h: 170, door: [545, 190] },
  General_Ward_A:  { x: 20,  y: 240, w: 210, h: 160, door: [125, 240] },
  Nursing_Station: { x: 255, y: 240, w: 210, h: 160, door: [360, 240] },
  General_Ward_B:  { x: 490, y: 240, w: 210, h: 160, door: [595, 240] },
};
const LEVELS = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

export default function HospitalFloorPlan({ latest, ward, onSelect }) {
  const rows = Object.fromEntries((latest?.wards || []).map((r) => [r.ward, r]));
  const sel = rows[ward];
  return (
    <div className="plan-wrap">
      <Card className="plan-card">
        <svg viewBox="0 0 720 420" role="group" aria-label="Conceptual hospital floor plan" className="plan">
          <rect x="0" y="190" width="720" height="50" className="corridor" />
          <text x="360" y="220" textAnchor="middle" className="corr-label">Corridor</text>
          {Object.entries(ROOMS).map(([name, r]) => {
            const d = rows[name]; const i = d ? LEVELS.indexOf(d.priority) : -1;
            const c = i >= 0 ? `var(--s${i})` : "var(--muted)";
            const speed = d ? Math.max(0.6, Math.min(5, 0.5 / Math.max(d.airflow_ms, 0.05))) : 0;
            const up = r.y < 190; const [dx, dy] = r.door;
            const cx = r.x + r.w / 2;
            return (
              <g key={name} tabIndex={0} role="button" style={{ "--c": c }} aria-pressed={ward === name} aria-label={`${WARD_LABEL(name)}, ${d ? d.priority : "unavailable"}`}
                 onClick={() => onSelect(name)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(name))} className={"room " + (ward === name ? "sel" : "")}>
                <title>{d ? `${WARD_LABEL(name)}\nCO₂ ${num(d.co2_ppm, 0)} ppm · airflow ${num(d.airflow_ms, 2)} m/s\n${d.action}` : `${WARD_LABEL(name)} — data unavailable`}</title>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="10" className="room-fill" />
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="10" className="room-edge" />
                <text x={cx} y={r.y + (up ? 60 : 55)} textAnchor="middle" className="room-name">{WARD_LABEL(name)}</text>
                <text x={cx} y={r.y + (up ? 90 : 82)} textAnchor="middle" className="room-val">{d ? `${num(d.co2_ppm, 0)} ppm CO₂` : "No data"}</text>
                <text x={cx} y={r.y + (up ? 112 : 102)} textAnchor="middle" className="room-val2">{d ? `${num(d.airflow_ms, 2)} m/s` : ""}</text>
                {d && [-24, 0, 24].map((o) => (
                  <line key={o} x1={dx + o} x2={dx + o} y1={up ? 215 : 215} y2={up ? 170 : 262} className="flow" style={{ animationDuration: speed + "s" }} markerEnd="url(#ah)" />
                ))}
                {d?.predicted_anomaly && <circle cx={r.x + r.w - 18} cy={r.y + 18} r="7" className="alert-dot" />}
              </g>
            );
          })}
          <defs><marker id="ah" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#12302F" /></marker></defs>
        </svg>
        <div className="legend" aria-label="Legend">
          {["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <Pill key={p} p={p} />)}
        </div>
        <p className="note">Conceptual layout. Arrows show illustrative corridor-to-room flow; their speed scales with the measured airflow (m/s). No calibrated geometry or direction data exists in the backend.</p>
      </Card>
      <Card title={sel ? WARD_LABEL(sel.ward) : "Select a room"} sub={sel ? `Reading at ${hm(sel.timestamp)}` : "Choose a room on the plan."} right={sel && <Pill p={sel.priority} />}>
        {sel ? (
          <dl className="dl">
            <dt>CO₂</dt><dd>{num(sel.co2_ppm, 0)} ppm</dd><dt>PM2.5 / PM10</dt><dd>{num(sel.pm25)} / {num(sel.pm10)} µg/m³</dd>
            <dt>Temperature</dt><dd>{num(sel.temp_c)} °C</dd><dt>Humidity</dt><dd>{num(sel.humidity_pct, 0)} %</dd>
            <dt>Airflow</dt><dd>{num(sel.airflow_ms, 2)} m/s</dd>
            <dt>Anomaly</dt><dd>{sel.predicted_anomaly ? `Flagged · error ${num(sel.reconstruction_error, 2)}` : "Not flagged"}</dd>
            <dt>Recommended</dt><dd><b>{sel.action}</b><br /><span className="muted">{sel.reason}</span></dd>
            {(sel.fan_speed_delta_pct || sel.damper_delta_pct) ? (<><dt>Adjustment</dt><dd>Fan +{sel.fan_speed_delta_pct}% · Damper +{sel.damper_delta_pct}%</dd></>) : null}
          </dl>
        ) : null}
        <p className="note">Recommendation only — not executed.</p>
      </Card>
    </div>
  );
}
