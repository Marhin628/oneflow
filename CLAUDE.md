# OneFlow

Personal academic calendar: Flask + Flask-RESTful + SQLite backend (`app.py`, `models.py`), React + Vite + FullCalendar frontend (`frontend/src/App.jsx`).

- Real data lives in `instance/oneflow.db`. Never delete, reset or write test data to it. Back it up before schema changes.
- Schema changes must be additive and migrate in place (see the `ALTER TABLE` block at the end of `app.py`), since `db.create_all()` does not add columns to existing tables.
- The user's dev servers run on 5000 (Flask, debug auto-reload) and 5173 (Vite). Editing `app.py`/`models.py` reloads the live server against the real DB, so try risky backend changes on a copy first.
- Dates are naive local times in ISO format (`2026-10-31T15:00:00`); never convert to UTC.

## Workflow for every change

Implement, then run the checks, fix failures, and rerun until green before reporting:

```bash
scripts/check.sh          # backend unittest + vite build + Playwright e2e
```

- Backend tests: `tests/test_api.py` (stdlib unittest, temporary DB via `ONEFLOW_DATABASE_URI`).
- Browser tests: `frontend/e2e/oneflow.spec.js`. Playwright starts its own Flask on 5001 (DB `tests/.e2e/oneflow-e2e.db`, recreated each run) and Vite on 5174; the clock is pinned to Wed 2026-10-28 10:00 America/Chicago.
- Add or update tests for new features. Report honestly which checks passed, failed or could not run.
- Don't commit or push unless asked.
