#backend API tests, run with: .venv/bin/python -m unittest discover tests
#every test uses a temporary database, the real instance/oneflow.db is never opened

import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="oneflow-test-")
#set ONEFLOW_TEST_DATABASE_URI (e.g. a throwaway postgres) to run the same tests against another database
TEST_DB = os.environ.get("ONEFLOW_TEST_DATABASE_URI") or "sqlite:///" + os.path.join(TMP, "api.db")
TEST_ENV = {
    "ONEFLOW_DATABASE_URI": TEST_DB,
    "FLASK_SKIP_DOTENV": "1",
    "ONEFLOW_TEST_LOGIN": "1",
    "GOOGLE_CLIENT_ID": "test-client-id",
    "OWNER_EMAIL": "Owner@Example.com",
    "SECRET_KEY": "test-secret",
}
os.environ.update(TEST_ENV)
for key in ("DATABASE_URL", "RENDER"):
    os.environ.pop(key, None)
sys.path.insert(0, ROOT)

import app as app_module  # noqa: E402
from app import app, db  # noqa: E402
from models import AssignmentModel  # noqa: E402

API = "/api/assignments"
HW = {"title": "HW1", "course": "CSE 220", "due_date": "2026-10-31T15:00:00", "type": "assignment"}
CLUB = {"kind": "event", "title": "Club", "type": "club", "due_date": "2026-10-27T18:00:00", "end_date": "2026-10-27T19:30:00"}


def reset_db():
    with app.app_context():
        db.session.execute(db.text("DELETE FROM assignment_model"))
        db.session.execute(db.text("DELETE FROM users"))
        db.session.commit()


def signed_in(email="tester@example.com"):
    c = app.test_client()
    r = c.post("/api/auth/test-login", json={"email": email})
    assert r.status_code == 200, r.json
    return c


#runs a fresh python process that imports the app with the given environment
def run_app(code, **env):
    full = {k: v for k, v in os.environ.items() if k not in TEST_ENV and k not in ("DATABASE_URL", "RENDER")}
    full.update({"FLASK_SKIP_DOTENV": "1", "ONEFLOW_DATABASE_URI": "sqlite:///" + os.path.join(TMP, "sub.db")})
    full.update(env)
    return subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, env=full)


class ApiTest(unittest.TestCase):
    def setUp(self):
        reset_db()
        self.c = signed_in()

    def post(self, data):
        return self.c.post(API, json=data)

    def test_uses_test_database(self):
        self.assertEqual(app.config["SQLALCHEMY_DATABASE_URI"], app_module.database_uri())
        self.assertNotIn("instance", app.config["SQLALCHEMY_DATABASE_URI"])
        self.assertNotIn("oneflow.db", app.config["SQLALCHEMY_DATABASE_URI"].replace("oneflow-test-", ""))

    def test_assignment_crud(self):
        r = self.post({**HW, "title": "  HW1  "})
        self.assertEqual(r.status_code, 201)
        a = r.json
        self.assertEqual((a["title"], a["kind"], a["end_date"], a["completed"]), ("HW1", "assignment", None, False))
        self.assertEqual(a["due_date"], "2026-10-31T15:00:00")

        r = self.c.patch(f"{API}/{a['id']}", json={"title": "HW1 v2", "due_date": "2026-11-01T09:30:00"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json["title"], r.json["due_date"]), ("HW1 v2", "2026-11-01T09:30:00"))

        self.assertEqual(self.c.delete(f"{API}/{a['id']}").status_code, 200)
        self.assertEqual(self.c.get(API).json, [])
        self.assertEqual(self.c.delete(f"{API}/{a['id']}").status_code, 404)
        self.assertEqual(self.c.patch(f"{API}/{a['id']}", json={"title": "x"}).status_code, 404)

    def test_completion_toggle(self):
        i = self.post(HW).json["id"]
        self.assertTrue(self.c.patch(f"{API}/{i}", json={"completed": True}).json["completed"])
        self.assertFalse(self.c.patch(f"{API}/{i}", json={"completed": False}).json["completed"])

    def test_assignment_validation(self):
        self.assertEqual(self.post({**HW, "title": "  "}).status_code, 400)
        self.assertEqual(self.post({**HW, "course": ""}).status_code, 400)
        self.assertEqual(self.post({**HW, "due_date": "tomorrow"}).status_code, 400)
        self.assertEqual(self.post({"course": "x"}).status_code, 400)
        self.assertEqual(self.post({**HW, "kind": "meeting"}).status_code, 400)
        i = self.post(HW).json["id"]
        self.assertEqual(self.c.patch(f"{API}/{i}", json={"title": ""}).status_code, 400)
        self.assertEqual(self.c.patch(f"{API}/{i}", json={"due_date": "bad"}).status_code, 400)

    def test_event_crud(self):
        r = self.post(CLUB)
        self.assertEqual(r.status_code, 201)
        e = r.json
        self.assertEqual((e["kind"], e["course"], e["end_date"]), ("event", "", "2026-10-27T19:30:00"))

        r = self.c.patch(f"{API}/{e['id']}", json={"due_date": "2026-10-28T09:00:00", "end_date": "2026-10-28T10:15:00", "course": "CSE 220"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json["due_date"], r.json["end_date"], r.json["course"]), ("2026-10-28T09:00:00", "2026-10-28T10:15:00", "CSE 220"))

        self.assertEqual(self.c.delete(f"{API}/{e['id']}").status_code, 200)
        self.assertEqual(self.c.get(API).json, [])

    def test_event_validation(self):
        self.assertEqual(self.post({**CLUB, "end_date": None}).status_code, 400)
        self.assertEqual(self.post({**CLUB, "end_date": "2026-10-27T17:00:00"}).status_code, 400)
        self.assertEqual(self.post({**CLUB, "end_date": "2026-10-27T18:00:00"}).status_code, 400)
        i = self.post(CLUB).json["id"]
        r = self.c.patch(f"{API}/{i}", json={"end_date": "2026-10-27T17:00:00"})
        self.assertEqual(r.status_code, 400)
        #a rejected patch must not leave a half-applied change behind
        self.assertEqual(self.c.get(API).json[0]["end_date"], "2026-10-27T19:30:00")

    def test_events_ignore_completion(self):
        e = self.post({**CLUB, "completed": True}).json
        self.assertFalse(e["completed"])
        self.assertFalse(self.c.patch(f"{API}/{e['id']}", json={"completed": True}).json["completed"])

    def test_switching_kind(self):
        i = self.post(HW).json["id"]
        self.assertEqual(self.c.patch(f"{API}/{i}", json={"kind": "event"}).status_code, 400)
        r = self.c.patch(f"{API}/{i}", json={"kind": "event", "end_date": "2026-10-31T16:00:00"})
        self.assertEqual((r.status_code, r.json["kind"]), (200, "event"))
        r = self.c.patch(f"{API}/{i}", json={"kind": "assignment"})
        self.assertEqual((r.json["kind"], r.json["end_date"]), ("assignment", None))


class AccountTest(unittest.TestCase):
    def setUp(self):
        reset_db()

    def test_signed_out_requests_are_rejected(self):
        c = app.test_client()
        for method, url in [("get", API), ("post", API), ("patch", f"{API}/1"), ("delete", f"{API}/1"), ("get", "/api/me")]:
            r = getattr(c, method)(url, json={})
            self.assertEqual(r.status_code, 401, (method, url))
            self.assertEqual(r.json["message"], "Please sign in")

    def test_users_only_see_and_change_their_own_items(self):
        alice, bob = signed_in("alice@example.com"), signed_in("bob@example.com")
        a = alice.post(API, json=HW).json
        self.assertEqual(bob.get(API).json, [])
        self.assertEqual(bob.patch(f"{API}/{a['id']}", json={"title": "hacked"}).status_code, 404)
        self.assertEqual(bob.delete(f"{API}/{a['id']}").status_code, 404)
        b = bob.post(API, json={**HW, "title": "Bob HW"}).json
        self.assertEqual([x["title"] for x in alice.get(API).json], ["HW1"])
        self.assertEqual([x["title"] for x in bob.get(API).json], ["Bob HW"])
        self.assertEqual(alice.delete(f"{API}/{b['id']}").status_code, 404)

    def test_me_and_logout(self):
        c = signed_in("alice@example.com")
        self.assertEqual(c.get("/api/me").json["email"], "alice@example.com")
        self.assertEqual(c.post("/api/auth/logout").status_code, 200)
        self.assertEqual(c.get("/api/me").status_code, 401)
        self.assertEqual(c.get(API).status_code, 401)

    def test_config_exposes_client_id(self):
        self.assertEqual(app.test_client().get("/api/config").json, {"google_client_id": "test-client-id", "test_login": True})

    def test_google_sign_in(self):
        info = {"sub": "g-123", "email": "pat@example.com", "email_verified": True, "name": "Pat", "picture": "https://x/p.png"}
        c = app.test_client()
        with mock.patch.object(app_module.google_id_token, "verify_oauth2_token", return_value=info) as verify:
            r = c.post("/api/auth/google", json={"credential": "token-from-google"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json["email"], r.json["name"]), ("pat@example.com", "Pat"))
        #the token must be checked against our own client id
        self.assertEqual(verify.call_args.args[0], "token-from-google")
        self.assertEqual(verify.call_args.args[2], "test-client-id")
        self.assertEqual(c.post(API, json=HW).status_code, 201)

        #signing in again with the same google account reuses the user (and updates a changed email)
        with mock.patch.object(app_module.google_id_token, "verify_oauth2_token", return_value={**info, "email": "pat@new.com"}):
            c2 = app.test_client()
            self.assertEqual(c2.post("/api/auth/google", json={"credential": "t"}).json["id"], r.json["id"])
        self.assertEqual(len(c2.get(API).json), 1)

    def test_google_sign_in_rejects_bad_tokens(self):
        c = app.test_client()
        self.assertEqual(c.post("/api/auth/google", json={}).status_code, 400)
        with mock.patch.object(app_module.google_id_token, "verify_oauth2_token", side_effect=ValueError("bad signature")):
            self.assertEqual(c.post("/api/auth/google", json={"credential": "forged"}).status_code, 401)
        with mock.patch.object(app_module.google_id_token, "verify_oauth2_token", return_value={"sub": "g", "email": "x@example.com", "email_verified": False}):
            self.assertEqual(c.post("/api/auth/google", json={"credential": "t"}).status_code, 401)
        self.assertEqual(c.get("/api/me").status_code, 401)

    def test_owner_claims_items_from_before_accounts(self):
        with app.app_context():
            db.session.add(AssignmentModel(title="old hw", course="STA 301", type="assignment", due_date=app_module.parse_date("2026-10-25T15:05:00")))
            db.session.commit()
        self.assertEqual(signed_in("someone@example.com").get(API).json, [])
        #OWNER_EMAIL matching ignores case
        owner = signed_in("owner@example.com")
        self.assertEqual([x["title"] for x in owner.get(API).json], ["old hw"])
        self.assertEqual(signed_in("someone@example.com").get(API).json, [])


class ServingTest(unittest.TestCase):
    def test_serves_built_frontend_with_spa_fallback(self):
        dist = tempfile.mkdtemp(dir=TMP)
        os.makedirs(os.path.join(dist, "assets"))
        for name, body in (("index.html", "<div id=root></div>"), ("assets/app.js", "console.log(1)")):
            with open(os.path.join(dist, name), "w") as f:
                f.write(body)
        c = app.test_client()

        def body(url):
            with c.get(url) as r:
                return r.get_data()

        with mock.patch.object(app_module, "DIST", dist):
            self.assertIn(b"id=root", body("/"))
            self.assertIn(b"console.log", body("/assets/app.js"))
            self.assertIn(b"id=root", body("/some/page"))
            r = c.get("/api/nope")
            self.assertEqual((r.status_code, r.json["message"]), (404, "Not found"))
        self.assertEqual(c.get("/api/health").json, {"ok": True})

    def test_database_url_gets_the_postgres_driver(self):
        with mock.patch.dict(os.environ, {"DATABASE_URL": "postgres://u:p@h/db"}):
            os.environ.pop("ONEFLOW_DATABASE_URI")
            try:
                self.assertEqual(app_module.database_uri(), "postgresql+psycopg://u:p@h/db")
                os.environ["DATABASE_URL"] = "postgresql://u:p@h/db"
                self.assertEqual(app_module.database_uri(), "postgresql+psycopg://u:p@h/db")
            finally:
                os.environ["ONEFLOW_DATABASE_URI"] = TEST_ENV["ONEFLOW_DATABASE_URI"]


class SafetyTest(unittest.TestCase):
    PROBE = "from app import app; print(app.test_client().post('/api/auth/test-login', json={}).status_code)"

    def test_test_login_is_off_by_default(self):
        r = run_app(self.PROBE)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotEqual(r.stdout.strip(), "200")

    def test_test_login_cannot_be_enabled_on_render(self):
        r = run_app(self.PROBE, RENDER="true", ONEFLOW_TEST_LOGIN="1", SECRET_KEY="x")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotEqual(r.stdout.strip(), "200")

    def test_production_requires_a_secret_key(self):
        r = run_app("import app", RENDER="true")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("SECRET_KEY must be set", r.stderr)


class MigrationTest(unittest.TestCase):
    #a v0.1 database (no kind/end_date/user_id columns) must be upgraded in place without losing rows
    def test_upgrades_v01_database(self):
        path = os.path.join(TMP, "v01.db")
        conn = sqlite3.connect(path)
        conn.execute("""CREATE TABLE assignment_model (id INTEGER NOT NULL, title VARCHAR(100) NOT NULL,
            course VARCHAR(50) NOT NULL, due_date DATETIME NOT NULL, type VARCHAR(30) NOT NULL,
            completed BOOLEAN, source VARCHAR(30), PRIMARY KEY (id))""")
        conn.execute("INSERT INTO assignment_model VALUES (1,'old hw','STA 301','2026-10-25 15:05:00.000000','assignment',1,'manual')")
        conn.commit()
        conn.close()

        script = ("from app import app; import json; c = app.test_client(); "
                  "c.post('/api/auth/test-login', json={'email': 'me@example.com'}); print(json.dumps(c.get('/api/assignments').json))")
        for _ in range(2):  #the second start checks the migration is safe to run again
            r = run_app(script, ONEFLOW_DATABASE_URI="sqlite:///" + path, ONEFLOW_TEST_LOGIN="1", OWNER_EMAIL="me@example.com")
            self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('"title": "old hw"', r.stdout)
        self.assertIn('"kind": "assignment"', r.stdout)
        self.assertIn('"completed": true', r.stdout)
        with sqlite3.connect(path) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM assignment_model WHERE user_id IS NOT NULL").fetchone()[0], 1)
        conn.close()


if __name__ == "__main__":
    unittest.main()
