#backend API tests, run with: .venv/bin/python -m unittest discover tests
#every test uses a temporary database, the real instance/oneflow.db is never opened

import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="oneflow-test-")
os.environ["ONEFLOW_DATABASE_URI"] = "sqlite:///" + os.path.join(TMP, "api.db")
sys.path.insert(0, ROOT)

from app import app, db  # noqa: E402

API = "/api/assignments"
HW = {"title": "HW1", "course": "CSE 220", "due_date": "2026-10-31T15:00:00", "type": "assignment"}
CLUB = {"kind": "event", "title": "Club", "type": "club", "due_date": "2026-10-27T18:00:00", "end_date": "2026-10-27T19:30:00"}


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.c = app.test_client()
        with app.app_context():
            db.session.execute(db.text("DELETE FROM assignment_model"))
            db.session.commit()

    def post(self, data):
        return self.c.post(API, json=data)

    def test_uses_test_database(self):
        self.assertTrue(app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite:///" + TMP))

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


class MigrationTest(unittest.TestCase):
    #a v0.1 database (no kind/end_date columns) must be upgraded in place without losing rows
    def test_upgrades_v01_database(self):
        path = os.path.join(TMP, "v01.db")
        conn = sqlite3.connect(path)
        conn.execute("""CREATE TABLE assignment_model (id INTEGER NOT NULL, title VARCHAR(100) NOT NULL,
            course VARCHAR(50) NOT NULL, due_date DATETIME NOT NULL, type VARCHAR(30) NOT NULL,
            completed BOOLEAN, source VARCHAR(30), PRIMARY KEY (id))""")
        conn.execute("INSERT INTO assignment_model VALUES (1,'old hw','STA 301','2026-10-25 15:05:00.000000','assignment',1,'manual')")
        conn.commit()
        conn.close()

        script = "from app import app; import json; print(json.dumps(app.test_client().get('/api/assignments').json))"
        for _ in range(2):  #the second start checks the migration is safe to run again
            out = subprocess.run([sys.executable, "-c", script], cwd=ROOT, capture_output=True, text=True, check=True,
                                 env={**os.environ, "ONEFLOW_DATABASE_URI": "sqlite:///" + path}).stdout
        self.assertIn('"title": "old hw"', out)
        self.assertIn('"kind": "assignment"', out)
        self.assertIn('"completed": true', out)


if __name__ == "__main__":
    unittest.main()
