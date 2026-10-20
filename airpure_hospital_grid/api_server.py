"""Thin HTTP adapter around the existing AirPure pipeline modules (nothing in them is modified).
Run:  python3 api_server.py        (default http://127.0.0.1:8000)

Data is SIMULATED (simulate_data.py). The adapter extends the simulated history so daily/weekly/monthly
reports have something to aggregate, trains the existing autoencoder + forecaster once (cached), and
scores new simulated readings on demand. It never talks to HVAC hardware."""
import contextlib, io, json, os, pickle, sys, threading
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Flask, Response, jsonify, request

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import simulate_data as sim
from simulate_data import WARDS, FEATURES, BASELINE
from autoencoder_anomaly import train_and_detect, evaluate, zscore_apply
from airflow_forecast import train_forecaster, forecast_next, build_windows, WINDOW
from optimizer import decide_action
import report_engine as RE

HISTORY_DAYS = int(os.getenv("AIRPURE_HISTORY_DAYS", "59"))
INTERVAL = int(os.getenv("AIRPURE_INTERVAL_SEC", "900"))
EPOCHS = int(os.getenv("AIRPURE_EPOCHS", "100"))
TZ = os.getenv("HOSPITAL_TZ", "Asia/Kolkata")
SEED = 42
CACHE = ROOT / "outputs" / "api_cache"; CACHE.mkdir(parents=True, exist_ok=True)
NOTICE = ("Simulated data from simulate_data.py - not real sensor readings. Model metrics are experimental "
          "results on synthetic data, not clinical validation. Recommendations are advisory only; "
          "no control commands are sent to any equipment.")
TS = "%Y-%m-%d %H:%M:%S"
LOCK = threading.Lock()
S = {}


def _quiet(fn, *a, **k):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*a, **k)


def _action_cols(df):
    """Mirror main.py step 4: forecast comes from the WINDOW rows before the reading; anomaly flag =
    predicted_anomaly; type = simulator label when the reading is a true anomaly, else 'predicted'."""
    acts = []
    for r in df.itertuples():
        if np.isnan(r.forecast_co2):
            acts.append((None,) * 5); continue
        a = decide_action(r.ward, dict(co2_ppm=r.co2_ppm, airflow_ms=r.airflow_ms, pm25=r.pm25),
                          dict(co2_ppm=r.forecast_co2, airflow_ms=r.forecast_flow), bool(r.predicted_anomaly),
                          r.anomaly_type if r.is_anomaly else "predicted")
        acts.append((a.priority, a.action, a.fan_speed_delta_pct, a.damper_delta_pct, a.reason))
    df[["priority", "action", "fan_speed_delta_pct", "damper_delta_pct", "reason"]] = pd.DataFrame(acts, index=df.index)
    return df


def _annotate(scored, bundle):
    parts = []
    for w in WARDS:
        g = scored[scored.ward == w].sort_values("timestamp").reset_index(drop=True)
        X, _ = build_windows(g)
        P = bundle["y_scaler"].inverse_transform(bundle["model"].predict(bundle["x_scaler"].transform(X)))
        g["forecast_co2"] = np.nan; g["forecast_flow"] = np.nan
        g.loc[WINDOW:, "forecast_co2"] = P[:, 0]; g.loc[WINDOW:, "forecast_flow"] = P[:, 1]
        parts.append(g)
    df = pd.concat(parts, ignore_index=True)
    df["detected_type"] = np.where(df.is_anomaly, df.anomaly_type, "false_positive")
    df["origin"] = "simulated-history"
    return _action_cols(df).sort_values(["timestamp", "ward"]).reset_index(drop=True)


def build_state():
    cache = CACHE / f"state_{HISTORY_DAYS}_{INTERVAL}_{EPOCHS}_{SEED}.pkl"
    if cache.exists():
        S.update(pickle.load(open(cache, "rb"))); return
    print("Building pipeline state (first run only; cached afterwards)...")
    sim.RNG = np.random.default_rng(SEED); np.random.seed(0)
    n = HISTORY_DAYS * 86400 // INTERVAL
    df = pd.concat([sim.simulate_ward(w, n_steps=n, interval_sec=INTERVAL) for w in WARDS], ignore_index=True)
    df = df[["timestamp", "ward"] + FEATURES + ["anomaly_type", "is_anomaly"]]
    scored, ae, thr, (mu, sigma) = _quiet(train_and_detect, df, EPOCHS)
    bundle, fm = _quiet(train_forecaster, df)
    S.update(df=_annotate(scored, bundle), ae=ae, thr=float(thr), mu=mu, sigma=sigma, bundle=bundle,
             fm={k: float(v) for k, v in fm.items()}, built_at=datetime.now().strftime(TS))
    pickle.dump({k: S[k] for k in S}, open(cache, "wb"))


def jsonable(o):
    if isinstance(o, dict): return {k: jsonable(v) for k, v in o.items()}
    if isinstance(o, np.ndarray): return jsonable(o.tolist())
    if isinstance(o, (list, tuple)): return [jsonable(v) for v in o]
    if isinstance(o, (np.floating, float)): return None if np.isnan(o) else round(float(o), 5)
    if isinstance(o, (np.integer,)): return int(o)
    if isinstance(o, (np.bool_,)): return bool(o)
    if isinstance(o, pd.Timestamp): return o.strftime(TS)
    return o


def J(o, code=200):
    return Response(json.dumps(jsonable(o)), status=code, mimetype="application/json")


def rows_out(df):
    d = df.copy(); d["timestamp"] = d.timestamp.dt.strftime(TS)
    return jsonable(d.where(d.notna(), None).to_dict("records"))


def metrics_now():
    m = _quiet(evaluate, S["df"]); return {k: (float(v) if "." in str(v) or k in ("precision", "recall", "f1") else int(v)) for k, v in m.items()}


def ward_latest(w):
    g = S["df"][S["df"].ward == w]; last = g.iloc[-1]
    nxt = forecast_next(S["bundle"], g.iloc[-WINDOW:])
    return dict(ward=w, timestamp=last.timestamp.strftime(TS), co2_ppm=last.co2_ppm, pm25=last.pm25, pm10=last.pm10,
                temp_c=last.temp_c, humidity_pct=last.humidity_pct, airflow_ms=last.airflow_ms,
                reconstruction_error=last.reconstruction_error, predicted_anomaly=bool(last.predicted_anomaly),
                anomaly_type=(last.detected_type if last.predicted_anomaly else None),
                anomaly_type_source="simulator ground-truth label", origin=last.origin,
                priority=last.priority, action=last.action, fan_speed_delta_pct=last.fan_speed_delta_pct,
                damper_delta_pct=last.damper_delta_pct, reason=last.reason,
                forecast_next=dict(co2_ppm=nxt["co2_ppm"], airflow_ms=nxt["airflow_ms"], horizon_sec=INTERVAL,
                                   made_at=last.timestamp.strftime(TS)))


def create_app():
    app = Flask(__name__)
    build_state()

    @app.errorhandler(Exception)
    def err(e):
        code = getattr(e, "code", 500) if isinstance(getattr(e, "code", 500), int) else 500
        return J(dict(error=str(e)), code)

    @app.get("/api/status")
    def status():
        df = S["df"]
        return J(dict(mode="simulation", real_sensor_connected=False, hvac_control_enabled=False, notice=NOTICE,
                      wards=WARDS, rows=len(df), interval_sec=INTERVAL, timezone=TZ, threshold=S["thr"],
                      history_days=HISTORY_DAYS, range=dict(start=df.timestamp.min(), end=df.timestamp.max()),
                      forecast_horizon_sec=INTERVAL, window=WINDOW, trained_at=S["built_at"],
                      server_time=datetime.now().strftime(TS), live_rows_added=int((df.origin == "simulated-live").sum())))

    @app.get("/api/latest")
    def latest():
        return J(dict(wards=[ward_latest(w) for w in WARDS], fetched_at=datetime.now().strftime(TS)))

    @app.post("/api/simulate/step")
    def step():
        """Append one simulated reading per ward (simulator draw -> existing autoencoder/forecaster/optimizer)."""
        with LOCK:
            df = S["df"]; new = []
            for w in WARDS:
                g = df[df.ward == w]; last = g.iloc[-1]
                row = {f: m + sim.RNG.normal(0, sd) for f, (m, sd) in BASELINE.items()}
                kind = "none"
                if sim.RNG.random() < 0.03:
                    kind = str(sim.RNG.choice(sim.ANOMALY_TYPES)); row = sim._apply_anomaly(row, kind)
                err = float(S["ae"].reconstruction_error(zscore_apply(np.array([[row[f] for f in FEATURES]]), S["mu"], S["sigma"]))[0])
                fc = forecast_next(S["bundle"], g.iloc[-WINDOW:])
                is_a = kind != "none"; pred = err > S["thr"]
                a = decide_action(w, row, fc, pred, kind if is_a else "predicted")
                new.append(dict(timestamp=last.timestamp + pd.Timedelta(seconds=INTERVAL), ward=w, **row, anomaly_type=kind,
                                is_anomaly=is_a, reconstruction_error=err, predicted_anomaly=pred,
                                forecast_co2=fc["co2_ppm"], forecast_flow=fc["airflow_ms"],
                                detected_type=kind if is_a else "false_positive", origin="simulated-live",
                                priority=a.priority, action=a.action, fan_speed_delta_pct=a.fan_speed_delta_pct,
                                damper_delta_pct=a.damper_delta_pct, reason=a.reason))
            S["df"] = pd.concat([df, pd.DataFrame(new)], ignore_index=True)
        return latest()

    @app.get("/api/series")
    def series():
        w = request.args.get("ward", WARDS[0]); hrs = float(request.args.get("window_hours", 72)); mx = int(request.args.get("max_points", 700))
        g = S["df"][S["df"].ward == w]
        if w not in WARDS: return J(dict(error="unknown ward"), 404)
        g = g[g.timestamp > g.timestamp.max() - pd.Timedelta(hours=hrs)] if hrs > 0 else g
        n = len(g)
        if n > mx:
            keep = np.zeros(n, bool); keep[::int(np.ceil(n / mx))] = True; keep |= g.predicted_anomaly.values
            g = g[keep]
        cols = ["timestamp", "ward", *FEATURES, "reconstruction_error", "predicted_anomaly", "detected_type", "forecast_co2", "forecast_flow"]
        return J(dict(ward=w, n_in_window=n, n_returned=len(g), downsampled=n > mx, interval_sec=INTERVAL,
                      start=g.timestamp.min() if len(g) else None, end=g.timestamp.max() if len(g) else None,
                      rows=rows_out(g[cols])))

    @app.get("/api/forecast")
    def forecast():
        w = request.args.get("ward", WARDS[0]); hrs = float(request.args.get("window_hours", 48))
        g = S["df"][(S["df"].ward == w)].dropna(subset=["forecast_co2"])
        g = g[g.timestamp > g.timestamp.max() - pd.Timedelta(hours=hrs)]
        mae = (dict(co2_ppm=float((g.co2_ppm - g.forecast_co2).abs().mean()), airflow_ms=float((g.airflow_ms - g.forecast_flow).abs().mean())) if len(g) else None)
        return J(dict(ward=w, horizon_sec=INTERVAL, backend_test_mae=dict(co2_ppm=S["fm"]["mae_co2"], airflow_ms=S["fm"]["mae_flow"]),
                      window_mae=mae, next=ward_latest(w)["forecast_next"],
                      rows=rows_out(g[["timestamp", "co2_ppm", "forecast_co2", "airflow_ms", "forecast_flow"]])))

    @app.get("/api/anomalies")
    def anomalies():
        df = S["df"]; err = df.reconstruction_error
        hi = float(np.percentile(err, 99)); edges = np.linspace(0, hi, 31)
        clip = lambda s: np.histogram(np.clip(s, 0, hi), bins=edges)[0]
        det = df[df.predicted_anomaly]
        by = [dict(ward=w, readings=int(len(g)), detected=int(g.predicted_anomaly.sum()), rate_pct=float(100 * g.predicted_anomaly.mean()),
                   **{t: int(((g.detected_type == t) & g.predicted_anomaly).sum()) for t in ["stagnation", "contamination_spike", "hvac_fault", "false_positive"]})
              for w, g in df.groupby("ward")]
        hist = det.sort_values("timestamp", ascending=False).head(60)
        return J(dict(metrics=metrics_now(), threshold=S["thr"], detected=len(det), rate_pct=100 * len(det) / len(df), total=len(df),
                      histogram=dict(edges=edges[:-1], width=edges[1] - edges[0], max_clipped_at=hi, normal=clip(err[~df.is_anomaly]), anomalous=clip(err[df.is_anomaly])),
                      by_ward=by, type_source="Simulator ground-truth label; the autoencoder only flags readings and does not classify them.",
                      history=rows_out(hist[["timestamp", "ward", "reconstruction_error", "detected_type", "priority", "co2_ppm", "airflow_ms"]]),
                      disclaimer="Metrics are computed against injected synthetic labels: experimental, not clinical validation."))

    @app.get("/api/actions")
    def actions():
        L = [ward_latest(w) for w in WARDS]; top = max(x["timestamp"] for x in L)
        for x in L:
            lag = (pd.Timestamp(top) - pd.Timestamp(x["timestamp"])).total_seconds()
            x["stale"] = lag > 3 * INTERVAL; x["lag_sec"] = lag
        return J(dict(rows=L, executed=False, note="Recommendations only. Nothing has been sent to HVAC equipment.", simulation_clock=top))

    @app.get("/api/report")
    def report():
        kind = request.args.get("type", "daily"); anchor = request.args.get("date") or request.args.get("month")
        if not anchor: return J(dict(error="date (daily/weekly start) or month (YYYY-MM) is required"), 400)
        df = S["df"]
        meta = dict(generated_at_now=datetime.now().strftime(TS), timezone=TZ, source="simulation (simulate_data.py)", notice=NOTICE,
                    range_start=df.timestamp.min().strftime(TS), range_end=df.timestamp.max().strftime(TS),
                    fm_co2=S["fm"]["mae_co2"], fm_flow=S["fm"]["mae_flow"])
        w = request.args.get("ward") or None
        if w and w not in WARDS: return J(dict(error="unknown ward"), 404)
        try:
            rep = RE.build_report(df, kind, anchor, w, INTERVAL, meta)
        except ValueError as e:
            return J(dict(error=str(e)), 400)
        return J(rep)

    @app.get("/api/report/export")
    def report_export():
        kind = request.args.get("type", "daily"); anchor = request.args.get("date") or request.args.get("month"); w = request.args.get("ward") or None
        sub = RE.records_frame(S["df"], kind, anchor, w).copy()
        if sub.empty: return J(dict(error="No readings in this period."), 404)
        sub["timestamp"] = sub.timestamp.dt.strftime(TS); sub["data_source"] = "simulated"
        name = f"airpure_{kind}_{anchor}_{w or 'ALL'}_records.csv"
        return Response(sub.to_csv(index=False), mimetype="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})

    @app.get("/api/report/export_summary")
    def report_summary_csv():
        kind = request.args.get("type", "daily"); anchor = request.args.get("date") or request.args.get("month"); w = request.args.get("ward") or None
        sub = RE.records_frame(S["df"], kind, anchor, w)
        if sub.empty: return J(dict(error="No readings in this period."), 404)
        g = sub.groupby("ward").agg(readings=("ward", "size"), **{f"{c}_{a}": (c, a) for c in FEATURES for a in ("mean", "min", "max")},
                                    anomalies_detected=("predicted_anomaly", "sum"),
                                    critical_high=("priority", lambda s: int(s.isin(["HIGH", "CRITICAL"]).sum()))).round(4).reset_index()
        g.insert(0, "period", f"{kind}:{anchor}"); g["data_source"] = "simulated"
        return Response(g.to_csv(index=False), mimetype="text/csv", headers={"Content-Disposition": f'attachment; filename="airpure_{kind}_{anchor}_summary.csv"'})

    @app.get("/api/export/control_log.csv")
    def control_log():
        x = S["df"][S["df"].priority.notna() & (S["df"].priority != "NONE")].copy(); x["timestamp"] = x.timestamp.dt.strftime(TS)
        x = x[["timestamp", "ward", "priority", "action", "fan_speed_delta_pct", "damper_delta_pct", "reason", "predicted_anomaly", "detected_type", "origin"]]
        return Response(x.to_csv(index=False), mimetype="text/csv", headers={"Content-Disposition": 'attachment; filename="airpure_control_log.csv"'})

    return app


if __name__ == "__main__":
    create_app().run(host=os.getenv("AIRPURE_HOST", "127.0.0.1"), port=int(os.getenv("AIRPURE_PORT", "8000")), threaded=True)
