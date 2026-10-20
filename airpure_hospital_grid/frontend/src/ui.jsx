import { AlertTriangle, Inbox, Loader2 } from "lucide-react";

export const WARD_LABEL = (w) => (w || "").replaceAll("_", " ");
export const LEVELS = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const LEVEL_META = {
  NONE: { label: "Nominal", c: "var(--s0)" }, LOW: { label: "Low", c: "var(--s1)" }, MEDIUM: { label: "Medium", c: "var(--s2)" },
  HIGH: { label: "High", c: "var(--s3)" }, CRITICAL: { label: "Critical", c: "var(--s4)" }, UNKNOWN: { label: "Unavailable", c: "var(--muted)" },
};
export const lvl = (p) => LEVEL_META[p] || LEVEL_META.UNKNOWN;
export const num = (v, d = 1) => (v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(d));
export const hm = (ts) => (ts ? ts.slice(5, 16).replace("T", " ") : "—");

export function Pill({ p }) {
  const m = lvl(p);
  return <span className="pill" style={{ "--c": m.c }}><i />{m.label}</span>;
}
export function Section({ id, title, sub, right, children }) {
  return (
    <section id={id} className="section" aria-labelledby={id + "-h"}>
      <header className="sec-head"><div><h2 id={id + "-h"}>{title}</h2>{sub && <p className="sub">{sub}</p>}</div>{right}</header>
      {children}
    </section>
  );
}
export const Card = ({ title, sub, right, children, className = "" }) => (
  <div className={"card " + className}>
    {(title || right) && <div className="card-head"><div><h3>{title}</h3>{sub && <p className="sub">{sub}</p>}</div>{right}</div>}
    {children}
  </div>
);
export const Loading = ({ label = "Loading…" }) => <div className="state" role="status"><Loader2 className="spin" size={18} />{label}</div>;
export const Empty = ({ children }) => <div className="state"><Inbox size={18} />{children}</div>;
export function ErrorState({ error, onRetry }) {
  return (
    <div className="state err" role="alert"><AlertTriangle size={18} /><span>{error?.message || "Something went wrong."}</span>
      {onRetry && <button className="btn sm" onClick={onRetry}>Retry</button>}</div>
  );
}
export function Async({ q, children, empty }) {
  if (q.loading && !q.data) return <Loading />;
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (empty && empty(q.data)) return <Empty>{typeof empty(q.data) === "string" ? empty(q.data) : "No data."}</Empty>;
  return <>{q.error && <ErrorState error={q.error} onRetry={q.reload} />}{children(q.data)}</>;
}
