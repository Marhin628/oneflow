# OneFlow

Academic calendar with Google sign-in and private per-user calendars. Flask + Flask-RESTful backend (`app.py`, `models.py`), React + Vite + FullCalendar frontend (`frontend/src/App.jsx`). Hosted on Render (`render.yaml`, `DEPLOY.md`): gunicorn serves the API and the built `frontend/dist`, data in Postgres via `DATABASE_URL`. Locally it uses SQLite, with settings in `.env` (gitignored).

- Real data lives in `instance/oneflow.db`. Never delete, reset or write test data to it. Back it up before schema changes.
- Schema changes must be additive and migrate in place (see the `ALTER TABLE` block at the end of `app.py`), since `db.create_all()` does not add columns to existing tables.
- The user's dev servers run on 5000 (Flask, debug auto-reload) and 5173 (Vite). Editing `app.py`/`models.py` reloads the live server against the real DB, so try risky backend changes on a copy first.
- Dates are naive local times in ISO format (`2026-10-31T15:00:00`); never convert to UTC.
- Every item query must be filtered by `current_user_id()`, and another user's item must return 404. `/api/auth/test-login` exists only when `ONEFLOW_TEST_LOGIN=1`, and it is always off when `RENDER` is set; never enable it in `render.yaml`.

## Workflow for every change

Implement, then run the checks, fix failures, and rerun until green before reporting:

```bash
scripts/check.sh          # backend unittest + vite build + Playwright e2e
```

- Backend tests: `tests/test_api.py` (stdlib unittest, temporary DB). Set `ONEFLOW_TEST_DATABASE_URI=postgresql://...` to run them against a throwaway Postgres.
- Browser tests: `frontend/e2e/oneflow.spec.js`. Playwright starts its own Flask on 5001 (DB `tests/.e2e/oneflow-e2e.db`, recreated each run, test login on, `.env` skipped) and Vite on 5174. Each test signs in via the test login. The clock is pinned to Wed 2026-10-28 10:00 America/Chicago.
- To test a production-style server instead, run it with `ONEFLOW_TEST_LOGIN=1` and set `ONEFLOW_E2E_BASE_URL=http://localhost:<port>` for `npx playwright test`.
- Add or update tests for new features. Report honestly which checks passed, failed or could not run.
- Don't commit or push unless asked.
