// Centralized API client. Base URL from VITE_API_BASE (empty = same origin / Vite proxy).
const BASE = import.meta.env.VITE_API_BASE || "";
const TIMEOUT_MS = 20000;

export class ApiError extends Error {}

async function request(path, { method = "GET", params } = {}) {
  const qs = params ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null)) : "";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path + qs, { method, signal: ctl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.error || `Request failed (${res.status})`);
    return body;
  } catch (e) {
    if (e.name === "AbortError") throw new ApiError("The backend did not respond in time.");
    if (e instanceof ApiError) throw e;
    throw new ApiError("Cannot reach the AirPure API. Is `python3 api_server.py` running?");
  } finally { clearTimeout(timer); }
}

export const api = {
  status: () => request("/api/status"),
  latest: () => request("/api/latest"),
  step: () => request("/api/simulate/step", { method: "POST" }),
  series: (ward, window_hours) => request("/api/series", { params: { ward, window_hours } }),
  forecast: (ward, window_hours) => request("/api/forecast", { params: { ward, window_hours } }),
  anomalies: () => request("/api/anomalies"),
  actions: () => request("/api/actions"),
  report: (p) => request("/api/report", { params: p }),
};
export const url = (path, params) => BASE + path + (params ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v)) : "");
