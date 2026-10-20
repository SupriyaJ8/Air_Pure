# AirPure Hospital Grid: frontend + API adapter

## Run
    pip install -r requirements.txt
    python3 api_server.py                        # http://127.0.0.1:8000 (first start trains + caches models, ~25 s)
    cd frontend && npm install && npm run dev    # http://127.0.0.1:5173 (proxies /api to the adapter)

## Configuration
| Variable | Where | Default | Purpose |
|---|---|---|---|
| VITE_API_BASE | frontend/.env | empty | API origin for production builds (empty = same origin / Vite proxy) |
| VITE_API_PROXY_TARGET | frontend/.env | http://127.0.0.1:8000 | Dev proxy target |
| HOSPITAL_TZ | backend | Asia/Kolkata | Timezone label; simulated timestamps are treated as hospital-local and never converted |
| AIRPURE_HISTORY_DAYS / _INTERVAL_SEC / _EPOCHS | backend | 59 / 900 / 100 | Simulated history length, reading interval, autoencoder epochs (changing them retrains) |

## Endpoints (api_server.py)
GET /api/status, /api/latest, /api/series, /api/forecast, /api/anomalies, /api/actions, /api/report,
/api/report/export, /api/report/export_summary, /api/export/control_log.csv; POST /api/simulate/step.

## Reports
Reports page: choose Daily / Weekly / Monthly, a date (weekly = start date, 7 days) or month, an optional ward, then Generate report.
Exports: PDF (client-side, from the report JSON), CSV (records), CSV (summary), JSON.

## Things to know
* All data is simulated. "Fetch from sensor" re-reads the adapter; "Add reading" and "Start live stream" append simulated readings.
  No real sensor or HVAC interface exists, and none is called.
* Original modules are unmodified. main.py's optimizer step feeds the forecast of the latest reading (made from the 6 readings before it),
  not of the following one; the adapter mirrors this so actions match the pipeline's CSVs.
* Anomaly "type" is the simulator's ground-truth label; the autoencoder only flags readings.
