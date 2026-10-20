import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const n = (v, d = 1) => (v == null ? "n/a" : Number(v).toFixed(d));
const TITLE = { daily: "Daily report", weekly: "Weekly report", monthly: "Monthly report" };

/** Builds a PDF from the report JSON returned by /api/report (no data is generated here). */
export function reportToPdf(r) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), M = 40;
  let y = 48;
  const head = (t) => { if (y > 740) { doc.addPage(); y = 48; } doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(15, 90, 85).text(t, M, y); y += 8; };
  const table = (columns, body, opt = {}) => {
    autoTable(doc, { startY: y, head: [columns], body, margin: { left: M, right: M }, styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [15, 90, 85] }, ...opt });
    y = doc.lastAutoTable.finalY + 18;
  };
  doc.setFont("helvetica", "bold").setFontSize(20).setTextColor(18, 48, 47).text("AirPure Hospital Grid", M, y); y += 22;
  doc.setFontSize(14).text(`${TITLE[r.type]} · ${r.type === "monthly" ? r.period.start.slice(0, 7) : r.period.start + (r.period.days > 1 ? " to " + r.period.end_inclusive : "")}`, M, y); y += 16;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  doc.text(`Scope: ${r.ward === "ALL" ? "All wards" : r.ward.replaceAll("_", " ")} · Timezone: ${r.timezone} · Generated: ${r.generated_at}`, M, y); y += 12;
  doc.text(doc.splitTextToSize(`Data source: ${r.data_source}. ${r.data_notice}`, W - 2 * M), M, y); y += 36;
  if (r.empty) { doc.setFontSize(11).setTextColor(0).text(doc.splitTextToSize(r.message, W - 2 * M), M, y); return doc; }

  const s = r.summary, st = s.stats;
  head("Summary"); y += 4;
  table(["Metric", "Mean", "Min", "Max", "Readings with value", "Missing"], [
    ["CO2 (ppm)", "co2_ppm"], ["PM2.5 (ug/m3)", "pm25"], ["PM10 (ug/m3)", "pm10"], ["Temperature (C)", "temp_c"], ["Humidity (%)", "humidity_pct"], ["Airflow (m/s)", "airflow_ms"],
  ].map(([l, k]) => [l, n(st[k].mean, 2), n(st[k].min, 2), n(st[k].max, 2), st[k].n, st[k].missing]));
  doc.setFontSize(9).setTextColor(0).text(`Readings: ${s.readings} of ${s.expected_readings} expected (${n(s.coverage_pct)}% coverage) · Anomalies detected: ${s.anomalies.detected} (${n(s.anomalies.rate_pct, 2)}%) · HIGH/CRITICAL readings: ${s.critical_high}`, M, y); y += 20;

  // Simple line chart of the mean CO2 across the breakdown.
  const b = r.breakdown.filter((x) => x.co2_mean != null);
  if (b.length > 1) {
    head(`CO2 mean by ${r.breakdown_granularity === "hourly" ? "hour" : "day"} (ppm)`); y += 6;
    const cw = W - 2 * M, ch = 110, lo = Math.min(...b.map((x) => x.co2_mean)), hi = Math.max(...b.map((x) => x.co2_mean)), span = hi - lo || 1;
    doc.setDrawColor(200).rect(M, y, cw, ch);
    doc.setDrawColor(15, 90, 85).setLineWidth(1.2);
    b.forEach((p, i) => { if (!i) return; const q = b[i - 1], X = (k) => M + (k / (b.length - 1)) * cw, Y = (v) => y + ch - 6 - ((v - lo) / span) * (ch - 12); doc.line(X(i - 1), Y(q.co2_mean), X(i), Y(p.co2_mean)); });
    doc.setFontSize(7).setTextColor(90).text(`${n(hi, 0)}`, M + 2, y + 9).text(`${n(lo, 0)}`, M + 2, y + ch - 2).text(`${b[0].period}`, M, y + ch + 10).text(`${b.at(-1).period}`, M + cw, y + ch + 10, { align: "right" });
    y += ch + 26;
  }
  head("Ward statistics"); y += 4;
  table(["Ward", "Readings", "CO2 mean/max", "PM2.5 mean", "PM10 mean", "Temp", "RH", "Airflow mean/min", "Anomalies", "High/Crit"],
    Object.entries(r.by_ward).map(([w, x]) => [w.replaceAll("_", " "), x.readings, `${n(x.stats.co2_ppm.mean, 0)} / ${n(x.stats.co2_ppm.max, 0)}`, n(x.stats.pm25.mean), n(x.stats.pm10.mean), n(x.stats.temp_c.mean), n(x.stats.humidity_pct.mean, 0), `${n(x.stats.airflow_ms.mean, 2)} / ${n(x.stats.airflow_ms.min, 2)}`, `${x.anomalies.detected} (${n(x.anomalies.rate_pct)}%)`, x.critical_high]));
  head("Anomalies by type (simulator label)"); y += 4;
  table(["Ward", "Type", "Count"], r.anomaly_types.rows.map((x) => [x.ward.replaceAll("_", " "), x.detected_type, x.count]));
  head(`HIGH / CRITICAL events (${r.events.total}${r.events.total > r.events.items.length ? `, first ${r.events.items.length} shown` : ""})`); y += 4;
  table(["Ward", "Start", "End", "Readings", "Priority", "Action", "Peak CO2"], r.events.items.map((e) => [e.ward.replaceAll("_", " "), e.start, e.end, e.readings, e.priority, e.action, n(e.peak_co2_ppm, 0)]));
  head("Recommendations issued (not executed)"); y += 4;
  table(["Ward", "Action", "Priority", "Readings", "Days", "Reason"], r.recommendations.map((x) => [x.ward.replaceAll("_", " "), x.action, x.priority, x.count, x.days_affected, x.reason]));
  head("Forecast performance"); y += 4;
  doc.setFontSize(9).setTextColor(0).text(doc.splitTextToSize(`${r.forecast.n} one-step predictions in this period. MAE: CO2 ${n(r.forecast.mae_co2_ppm, 2)} ppm, airflow ${n(r.forecast.mae_airflow_ms, 4)} m/s. ${r.forecast.note}`, W - 2 * M), M, y); y += 36;
  head("Comparison with previous period"); y += 4;
  if (r.comparison.available) table(["Metric", "Current", "Previous", "Change"], r.comparison.metrics.map((m) => [m.metric, n(m.current, 2), n(m.previous, 2), n(m.delta, 2)]));
  else { doc.setFontSize(9).text(r.comparison.reason, M, y); y += 22; }
  head("Observations"); y += 4;
  r.observations.forEach((o) => { doc.setFontSize(9).setTextColor(0).text(doc.splitTextToSize("• " + o, W - 2 * M), M, y); y += 14 * Math.ceil(o.length / 105); });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(7).setTextColor(120).text(`AirPure Hospital Grid · simulated data · page ${i}/${pages}`, M, 820); }
  return doc;
}
