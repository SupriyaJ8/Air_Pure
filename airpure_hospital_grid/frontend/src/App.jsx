import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { useApi, useInterval } from "./hooks.js";
import { Section, ErrorState, WARD_LABEL } from "./ui.jsx";
import { LiveStatusIndicator, SensorControls, WardOverview } from "./components/Overview.jsx";
import HospitalFloorPlan from "./components/FloorPlan.jsx";
import TrendCharts from "./components/Trends.jsx";
import { AnomalyAnalytics, ForecastPanel, ReportSection } from "./components/Anomalies.jsx";
import OptimizationActions from "./components/Actions.jsx";
import Reports from "./components/Reports.jsx";
import { Wind } from "lucide-react";

const useHash = () => {
  const [h, set] = useState(location.hash || "#/");
  useEffect(() => { const f = () => set(location.hash || "#/"); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return h;
};

export default function App() {
  const hash = useHash();
  const onReports = hash.startsWith("#/reports");
  const status = useApi(() => api.status(), []);
  const [latest, setLatest] = useState(null);
  const [ward, setWard] = useState("ICU");
  const [windowHours, setWindowHours] = useState(72);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const inflight = useRef(false);

  const run = useCallback(async (fn) => {
    if (inflight.current) return;
    inflight.current = true; setBusy(true);
    try { setLatest(await fn()); setConnected(true); setError(null); setLastFetch(new Date().toLocaleTimeString()); setRefreshKey((k) => k + 1); }
    catch (e) { setConnected(false); setError(e); setStreaming(false); }
    finally { inflight.current = false; setBusy(false); }
  }, []);
  const fetchLatest = useCallback(() => run(api.latest), [run]);
  const addReading = useCallback(() => run(api.step), [run]);

  useEffect(() => { fetchLatest(); }, [fetchLatest]);
  useInterval(addReading, 2000, streaming);                         // live stream = repeated simulated steps
  useInterval(() => { fetchLatest(); status.reload(); }, 10000, !connected); // reconnect attempts

  const wards = status.data?.wards || [];
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <a className="brand" href="#/"><Wind size={20} />AirPure<span>Hospital Grid</span></a>
        <nav aria-label="Primary">
          <a href="#/" className={!onReports ? "cur" : ""}>Dashboard</a>
          <a href="#/reports" className={onReports ? "cur" : ""}>Reports</a>
        </nav>
        <LiveStatusIndicator status={status.data} busy={busy} connected={connected} lastFetch={lastFetch} streaming={streaming} />
      </header>
      <main id="main">
        {error && <ErrorState error={error} onRetry={fetchLatest} />}
        {status.data && <div className="banner">Simulation mode: readings come from simulate_data.py, not physical sensors. Recommendations are advisory; no HVAC equipment is controlled.</div>}
        {onReports ? <Reports status={status.data} /> : (
          <>
            <Section id="overview" title="Ward overview" sub={`${wards.length ? wards.length + " wards monitored" : "Connecting…"}`}
              right={<SensorControls busy={busy} streaming={streaming} onFetch={fetchLatest} onStream={() => setStreaming((s) => !s)} onAdd={addReading} interval={status.data?.interval_sec || 900} />}>
              <WardOverview latest={latest} status={status.data} ward={ward} onSelect={setWard} />
            </Section>
            <Section id="plan" title="Floor plan" sub="Moving lines show airflow. Select a room for details."><HospitalFloorPlan latest={latest} ward={ward} onSelect={setWard} /></Section>
            <Section id="trends" title="Trends" sub={`Readings over time for ${WARD_LABEL(ward)}.`}>
              <TrendCharts ward={ward} wards={wards.length ? wards : [ward]} onSelect={setWard} windowHours={windowHours} setWindowHours={setWindowHours} refreshKey={refreshKey} />
              <h3 className="subhead">Anomaly detection</h3><AnomalyAnalytics refreshKey={refreshKey} />
              <h3 className="subhead">CO₂ and airflow forecast · {WARD_LABEL(ward)}</h3><ForecastPanel ward={ward} refreshKey={refreshKey} />
            </Section>
            <Section id="actions" title="Actions" sub="What to do in each ward right now."><OptimizationActions refreshKey={refreshKey} onSelect={setWard} /></Section>
            <Section id="report" title="Report" sub="Latest pipeline results and model performance."
              right={<a className="btn" href="#/reports">Daily, weekly and monthly reports</a>}><ReportSection refreshKey={refreshKey} /></Section>
          </>)}
      </main>
    </>
  );
}
