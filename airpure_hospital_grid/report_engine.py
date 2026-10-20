"""Report aggregation (daily / weekly / monthly) over the annotated pipeline DataFrame.
All numbers come from rows produced by the existing pipeline modules; nothing is invented.
Timestamps are naive and interpreted as hospital local time (see HOSPITAL_TZ in api_server.py)."""
import math
import pandas as pd
from optimizer import CO2_WARN_PPM, CO2_CRITICAL_PPM

PRI = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]
STAT = ["co2_ppm", "pm25", "pm10", "temp_c", "humidity_pct", "airflow_ms"]
TS = "%Y-%m-%d %H:%M:%S"


def _f(x, nd=3):
    try:
        return None if x is None or math.isnan(x) else round(float(x), nd)
    except TypeError:
        return None


def bounds(kind, anchor):
    if kind == "daily":
        s = pd.Timestamp(anchor).normalize(); e = s + pd.Timedelta(days=1)
    elif kind == "weekly":
        s = pd.Timestamp(anchor).normalize(); e = s + pd.Timedelta(days=7)
    elif kind == "monthly":
        s = pd.Timestamp(str(anchor)[:7] + "-01"); e = s + pd.offsets.MonthBegin(1)
    else:
        raise ValueError("type must be daily, weekly or monthly")
    return s, e


def prev_bounds(kind, s, e):
    return (s - pd.offsets.MonthBegin(1), s) if kind == "monthly" else (s - (e - s), s)


def _stat_block(sub):
    out = {}
    for c in STAT:
        v = sub[c]; n = int(v.notna().sum())
        out[c] = dict(n=n, missing=int(len(v) - n), mean=_f(v.mean()), min=_f(v.min()), max=_f(v.max()))
    return out


def _summary(sub, expected):
    det = sub[sub.predicted_anomaly]
    ev = sub[sub.priority.notna()]
    pc = ev.priority.value_counts()
    return dict(
        readings=int(len(sub)), expected_readings=int(expected),
        coverage_pct=_f(100 * len(sub) / expected, 1) if expected else None,
        stats=_stat_block(sub),
        anomalies=dict(detected=int(len(det)), rate_pct=_f(100 * len(det) / len(sub), 2) if len(sub) else None,
                       tp=int((sub.predicted_anomaly & sub.is_anomaly).sum()),
                       fp=int((sub.predicted_anomaly & ~sub.is_anomaly).sum()),
                       fn=int((~sub.predicted_anomaly & sub.is_anomaly).sum()),
                       tn=int((~sub.predicted_anomaly & ~sub.is_anomaly).sum())),
        priority_counts={p: int(pc.get(p, 0)) for p in PRI}, priority_evaluated=int(len(ev)),
        critical_high=int(pc.get("HIGH", 0) + pc.get("CRITICAL", 0)),
        co2_above_warn=int((sub.co2_ppm > CO2_WARN_PPM).sum()),
        co2_above_critical=int((sub.co2_ppm > CO2_CRITICAL_PPM).sum()),
    )


def _breakdown(sub, freq):
    if sub.empty:
        return []
    g = sub.groupby(sub.timestamp.dt.floor(freq)).agg(
        readings=("ward", "size"), co2_mean=("co2_ppm", "mean"), pm25_mean=("pm25", "mean"),
        pm10_mean=("pm10", "mean"), temp_mean=("temp_c", "mean"), humidity_mean=("humidity_pct", "mean"),
        airflow_mean=("airflow_ms", "mean"), anomalies=("predicted_anomaly", "sum"),
        critical_high=("priority", lambda s: int(s.isin(["HIGH", "CRITICAL"]).sum())))
    rows = []
    for t, r in g.iterrows():
        d = {k: (_f(v) if k.endswith("_mean") else int(v)) for k, v in r.items()}
        rows.append(dict(period=t.strftime(TS if freq == "h" else "%Y-%m-%d"), **d))
    return rows


def _events(sub, interval, limit=25):
    x = sub[sub.priority.isin(["HIGH", "CRITICAL"])].sort_values(["ward", "timestamp"])
    if x.empty:
        return dict(total=0, items=[])
    new = (x.ward != x.ward.shift()) | ((x.timestamp - x.timestamp.shift()) > pd.Timedelta(seconds=interval * 1.5))
    r = x.assign(run=new.cumsum()).groupby("run").agg(
        ward=("ward", "first"), start=("timestamp", "min"), end=("timestamp", "max"), readings=("ward", "size"),
        priority=("priority", lambda s: max(s, key=PRI.index)), action=("action", "first"),
        reason=("reason", "first"), peak_co2_ppm=("co2_ppm", "max")).sort_values("start")
    items = [dict(ward=a.ward, start=a.start.strftime(TS), end=a.end.strftime(TS), readings=int(a.readings),
                  priority=a.priority, action=a.action, reason=a.reason, peak_co2_ppm=_f(a.peak_co2_ppm, 0))
             for a in r.itertuples()]
    return dict(total=len(items), items=items[:limit])


def _recommendations(sub):
    x = sub[sub.priority.notna() & (sub.action != "MAINTAIN")]
    if x.empty:
        return []
    g = x.groupby(["ward", "action", "priority"]).agg(
        count=("ts_day", "size"), days_affected=("ts_day", "nunique"),
        fan=("fan_speed_delta_pct", "max"), damper=("damper_delta_pct", "max"), reason=("reason", "first")).reset_index()
    return json_rows(g.sort_values("count", ascending=False).head(30))


def json_rows(df):
    return [{k: (_f(v) if isinstance(v, float) else (v.item() if hasattr(v, "item") else v)) for k, v in r.items()}
            for r in df.to_dict("records")]


def _forecast(sub):
    f = sub.dropna(subset=["forecast_co2", "forecast_flow"])
    if f.empty:
        return dict(n=0, mae_co2_ppm=None, mae_airflow_ms=None)
    return dict(n=int(len(f)), mae_co2_ppm=_f((f.co2_ppm - f.forecast_co2).abs().mean(), 2),
                mae_airflow_ms=_f((f.airflow_ms - f.forecast_flow).abs().mean(), 4))


def _compare(cur, prev, prev_rows, prev_exp):
    if prev_rows == 0:
        return dict(available=False, reason="No readings were collected in the previous period.")
    keys = [("anomaly_rate_pct", cur["anomalies"]["rate_pct"], prev["anomalies"]["rate_pct"]),
            ("critical_high_readings", cur["critical_high"], prev["critical_high"]),
            ("co2_mean_ppm", cur["stats"]["co2_ppm"]["mean"], prev["stats"]["co2_ppm"]["mean"]),
            ("pm25_mean", cur["stats"]["pm25"]["mean"], prev["stats"]["pm25"]["mean"]),
            ("pm10_mean", cur["stats"]["pm10"]["mean"], prev["stats"]["pm10"]["mean"]),
            ("airflow_mean_ms", cur["stats"]["airflow_ms"]["mean"], prev["stats"]["airflow_ms"]["mean"])]
    return dict(available=True, previous_coverage_pct=prev["coverage_pct"],
                partial=bool(prev["coverage_pct"] is not None and prev["coverage_pct"] < 95),
                metrics=[dict(metric=k, current=c, previous=p, delta=_f(c - p) if None not in (c, p) else None)
                         for k, c, p in keys])


def _observations(rep):
    s, out = rep["summary"], []
    st = s["stats"]
    out.append(f"{s['anomalies']['detected']} of {s['readings']} readings were flagged by the autoencoder "
               f"({s['anomalies']['rate_pct']}%).")
    if s["co2_above_critical"]:
        out.append(f"CO2 exceeded {CO2_CRITICAL_PPM} ppm in {s['co2_above_critical']} readings (max {st['co2_ppm']['max']} ppm).")
    elif s["co2_above_warn"]:
        out.append(f"CO2 exceeded {CO2_WARN_PPM} ppm in {s['co2_above_warn']} readings (max {st['co2_ppm']['max']} ppm).")
    else:
        out.append(f"CO2 stayed at or below {CO2_WARN_PPM} ppm (max {st['co2_ppm']['max']} ppm).")
    if s["critical_high"]:
        out.append(f"{s['critical_high']} readings produced HIGH or CRITICAL recommendations in the optimizer.")
    bw = rep["by_ward"]
    if len(bw) > 1:
        top = max(bw, key=lambda w: bw[w]["anomalies"]["rate_pct"] or 0)
        out.append(f"Highest detected anomaly rate: {top} ({bw[top]['anomalies']['rate_pct']}%).")
    if rep["peak_anomaly_hour"] is not None:
        out.append(f"Most detections occurred around {rep['peak_anomaly_hour']['hour']:02d}:00 "
                   f"({rep['peak_anomaly_hour']['count']} readings).")
    if s["coverage_pct"] is not None and s["coverage_pct"] < 95:
        out.append(f"Data coverage is {s['coverage_pct']}% of expected readings; results are partial.")
    return out


def build_report(df, kind, anchor, ward, interval, meta):
    s, e = bounds(kind, anchor)
    scope = df if not ward else df[df.ward == ward]
    n_w = scope.ward.nunique() or 1
    sub = scope[(scope.timestamp >= s) & (scope.timestamp < e)].copy()
    base = dict(type=kind, ward=ward or "ALL", generated_at=meta["generated_at_now"], timezone=meta["timezone"],
                period=dict(start=s.strftime("%Y-%m-%d"), end_exclusive=e.strftime("%Y-%m-%d"),
                            end_inclusive=(e - pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
                            days=int((e - s).days)),
                data_source=meta["source"], simulated=True, data_notice=meta["notice"],
                available_range=dict(start=meta["range_start"], end=meta["range_end"]))
    if sub.empty:
        return dict(base, empty=True, message="No readings exist for this period. "
                    f"Data is available from {meta['range_start']} to {meta['range_end']}.")
    sub["ts_day"] = sub.timestamp.dt.strftime("%Y-%m-%d")
    per_day = 86400 / interval
    expected = lambda a, b, nw: (b - a).days * per_day * nw
    summ = _summary(sub, expected(s, e, n_w))
    by_ward = {w: _summary(g, expected(s, e, 1)) for w, g in sub.groupby("ward")}
    pb = prev_bounds(kind, s, e); psub = scope[(scope.timestamp >= pb[0]) & (scope.timestamp < pb[1])]
    prev = _summary(psub, expected(pb[0], pb[1], n_w)) if len(psub) else None
    det = sub[sub.predicted_anomaly]
    types = det.groupby(["ward", "detected_type"]).size().reset_index(name="count")
    hr = det.groupby(det.timestamp.dt.hour).size()
    rep = dict(base, empty=False, summary=summ, by_ward=by_ward,
               anomaly_types=dict(source="Simulator ground-truth label (the autoencoder only flags; it does not classify). "
                                          "'false_positive' = flagged but not injected.",
                                  rows=json_rows(types)),
               peak_anomaly_hour=(dict(hour=int(hr.idxmax()), count=int(hr.max())) if len(hr) else None),
               breakdown_granularity="hourly" if kind == "daily" else "daily",
               breakdown=_breakdown(sub, "h" if kind == "daily" else "D"),
               weekly_breakdown=(_breakdown(sub.assign(timestamp=sub.timestamp - pd.to_timedelta(sub.timestamp.dt.dayofweek, "D")), "D") if kind == "monthly" else None),
               events=_events(sub, interval), recommendations=_recommendations(sub),
               forecast=dict(_forecast(sub), note="One-step-ahead: each reading is predicted from the 6 readings before it. "
                                                  "Backend test-set MAE: CO2 %.2f ppm, airflow %.4f m/s." % (meta["fm_co2"], meta["fm_flow"])),
               comparison=_compare(summ, prev, len(psub), 0) if prev else dict(available=False, reason="No readings were collected in the previous period."),
               previous_period=dict(start=pb[0].strftime("%Y-%m-%d"), end_exclusive=pb[1].strftime("%Y-%m-%d")))
    if kind == "monthly" and prev is None:
        pass
    rep["observations"] = _observations(rep)
    return rep


def records_frame(df, kind, anchor, ward):
    s, e = bounds(kind, anchor)
    x = df if not ward else df[df.ward == ward]
    return x[(x.timestamp >= s) & (x.timestamp < e)]
