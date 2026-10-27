##IMPORTS
#this file runs flask itself and handles the API requests

import os
import secrets
from datetime import datetime, timedelta
from dotenv import load_dotenv
from flask import Flask, request, session, send_from_directory
from models import db, AssignmentModel, UserModel
from flask_restful import Api, Resource, abort, fields, marshal_with,marshal, reqparse
from werkzeug.exceptions import BadRequest
from sqlalchemy import inspect, text
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

#reads settings from a local .env file (tests set FLASK_SKIP_DOTENV so they stay isolated)
if not os.environ.get("FLASK_SKIP_DOTENV"):
    load_dotenv()

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "frontend", "dist")
#render sets RENDER=true on its servers
PRODUCTION = bool(os.environ.get("RENDER"))
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
#rows created before accounts existed are given to this person the first time they sign in
OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "").strip().lower()
#lets the automated tests sign in without google, never enabled on render
TEST_LOGIN = os.environ.get("ONEFLOW_TEST_LOGIN") == "1" and not PRODUCTION


##APP SETUP
app=Flask(__name__, static_folder=None)
api = Api(app)

#signs the login cookie, a random key works locally but logs everyone out whenever the server restarts
secret_key = os.environ.get("SECRET_KEY")
if not secret_key:
    if PRODUCTION:
        raise RuntimeError("SECRET_KEY must be set in production")
    secret_key = secrets.token_hex(32)
app.config["SECRET_KEY"] = secret_key
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = PRODUCTION
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)

#picks the database: tests use ONEFLOW_DATABASE_URI, render provides DATABASE_URL (postgres), otherwise the local sqlite file
def database_uri():
    uri = os.environ.get("ONEFLOW_DATABASE_URI") or os.environ.get("DATABASE_URL") or "sqlite:///oneflow.db"
    #sqlalchemy needs the driver name, render gives plain postgres:// or postgresql:// urls
    for prefix in ("postgres://", "postgresql://"):
        if uri.startswith(prefix):
            return "postgresql+psycopg://" + uri[len(prefix):]
    return uri

app.config["SQLALCHEMY_DATABASE_URI"]=database_uri()
app.config["SQLALCHEMY_ENGINE_OPTIONS"]={"pool_pre_ping": True}

#initializes the objects in sqlalchemy to flask
db.init_app(app)

#formats the AppModel into a dictionary
assignment_fields = {
    "id": fields.Integer,
    "title": fields.String,
    "course": fields.String,
    #iso8601 keeps the naive local time as-is (rfc822 mislabels it as UTC and shifts it in the browser)
    "due_date": fields.DateTime(dt_format="iso8601"),
    "type": fields.String,
    "completed": fields.Boolean,
    "source": fields.String,
    "kind": fields.String,
    "end_date": fields.DateTime(dt_format="iso8601")
}

#parse inputs
assignment_parser = reqparse.RequestParser()
assignment_parser.add_argument("title", type=str, required=True, location="json")
#course is only required for assignments (checked in validate_item), events like club meetings can skip it
assignment_parser.add_argument("course", type=str, location="json")
assignment_parser.add_argument("due_date", type=str, required=True, location="json")
assignment_parser.add_argument("type", type=str, required=True, location="json")
assignment_parser.add_argument("completed", type=bool, location="json")
assignment_parser.add_argument("kind", type=str, choices=("assignment", "event"), location="json")
assignment_parser.add_argument("end_date", type=str, location="json")

#rejects fields that are empty or only spaces
def blank_fields(args, names):
    return [n for n in names if args.get(n) is not None and not args[n].strip()]

#parses an ISO date string, returns None if it is invalid
def parse_date(value):
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None

#checks the rules that depend on the kind, returns an error message or None
def validate_item(item):
    if item.kind == "event":
        if item.end_date is None:
            return "Events need an end time"
        if item.end_date <= item.due_date:
            return "End time must be after the start time"
    else:
        if not item.course:
            return "course cannot be empty"
    return None


#returns the signed-in user's id, or stops the request with 401
def current_user_id():
    user_id = session.get("user_id")
    if user_id is None or db.session.get(UserModel, user_id) is None:
        abort(401, message="Please sign in")
    return user_id

#finds one of the signed-in user's items, other people's items look the same as missing ones
def find_item(id):
    return AssignmentModel.query.filter_by(id=id, user_id=current_user_id()).first()

user_fields = {"id": fields.Integer, "email": fields.String, "name": fields.String, "picture": fields.String}

#creates or updates the user for a google account and signs them in
def sign_in(sub, email, name=None, picture=None):
    user = UserModel.query.filter_by(google_sub=sub).first()
    if user is None:
        user = UserModel(google_sub=sub, email=email)
        db.session.add(user)
    user.email, user.name, user.picture = email, name, picture
    db.session.flush()

    if OWNER_EMAIL and email.lower() == OWNER_EMAIL:
        AssignmentModel.query.filter_by(user_id=None).update({"user_id": user.id})

    db.session.commit()
    session.clear()
    session.permanent = True
    session["user_id"] = user.id
    return marshal(user, user_fields)


##RESOURCE CLASSES AND METHODS
patch_parser = reqparse.RequestParser()
patch_parser.add_argument("title", type=str, location="json")
patch_parser.add_argument("course", type=str, location="json")
patch_parser.add_argument("due_date", type=str, location="json")
patch_parser.add_argument("type", type=str, location="json")
patch_parser.add_argument("completed", type=bool, location="json")
patch_parser.add_argument("kind", type=str, choices=("assignment", "event"), location="json")
patch_parser.add_argument("end_date", type=str, location="json")

class AssignmentResource(Resource):
    #we use self with get so it uses resources
    @marshal_with(assignment_fields)
    def get(self):
        assignments = AssignmentModel.query.filter_by(user_id=current_user_id()).all()
        return (assignments)

    @marshal_with(assignment_fields)
    def post(self):
        user_id = current_user_id()
        args = assignment_parser.parse_args()

        blank = blank_fields(args, ["title", "type"])
        if blank:
            raise BadRequest(f"{', '.join(blank)} cannot be empty")

        due_date = parse_date(args["due_date"])
        if due_date is None:
            raise BadRequest("Invalid date format. Use YYYY-MM-DDTHH:MM:SS")

        kind = args["kind"] or "assignment"
        end_date = None
        if kind == "event" and args["end_date"] is not None:
            end_date = parse_date(args["end_date"])
            if end_date is None:
                raise BadRequest("Invalid end date format. Use YYYY-MM-DDTHH:MM:SS")

        assignment = AssignmentModel(
            title=args["title"].strip(),
            course=(args["course"] or "").strip(),
            due_date=due_date,
            type=args["type"].strip(),
            completed=bool(args["completed"]) if kind == "assignment" else False,
            kind=kind,
            end_date=end_date,
            user_id=user_id
        )

        error = validate_item(assignment)
        if error:
            raise BadRequest(error)

        db.session.add(assignment)
        db.session.commit()

        return assignment, 201
        
class AssignmentResource2(Resource):
    #requires an id to delete
    def delete(self,id):
        assignment=find_item(id)

        if assignment is None:
            return {"message":"Assignment not found"},404

        db.session.delete(assignment)
        db.session.commit()

        return {"message":"Assignment deleted successfully!"},200

    def patch(self, id):
        assignment = find_item(id)

        if assignment is None:
            return {"message": "Assignment not found"}, 404

        args = patch_parser.parse_args()

        blank = blank_fields(args, ["title", "type"])
        if blank:
            return {"message": f"{', '.join(blank)} cannot be empty"}, 400

        if args["title"] is not None:
            assignment.title = args["title"].strip()

        if args["course"] is not None:
            assignment.course = args["course"].strip()

        if args["due_date"] is not None:
            due_date = parse_date(args["due_date"])
            if due_date is None:
                return {"message": "Invalid date format. Use YYYY-MM-DDTHH:MM:SS"}, 400
            assignment.due_date = due_date

        if args["kind"] is not None:
            assignment.kind = args["kind"]

        if args["end_date"] is not None:
            end_date = parse_date(args["end_date"])
            if end_date is None:
                return {"message": "Invalid end date format. Use YYYY-MM-DDTHH:MM:SS"}, 400
            assignment.end_date = end_date

        if args["type"] is not None:
            assignment.type = args["type"].strip()

        if args["completed"] is not None:
            assignment.completed = args["completed"]

        #assignments have no end time and events have no completion status
        if assignment.kind == "assignment":
            assignment.end_date = None
        else:
            assignment.completed = False

        error = validate_item(assignment)
        if error:
            db.session.rollback()
            return {"message": error}, 400

        db.session.commit()

        return marshal(assignment, assignment_fields), 200
        
        

##ACCOUNTS

#non flask-restful routes (like /api/me) also answer errors with json
@app.errorhandler(401)
def unauthorized(e):
    return {"message": getattr(e, "data", {}).get("message", "Please sign in")}, 401

#the frontend needs the google client id to show the sign-in button
@app.get("/api/config")
def config():
    return {"google_client_id": GOOGLE_CLIENT_ID, "test_login": TEST_LOGIN}

@app.get("/api/health")
def health():
    return {"ok": True}

@app.get("/api/me")
def me():
    return marshal(db.session.get(UserModel, current_user_id()), user_fields)

#the browser sends the token google gave it, we check it really came from google for our app
@app.post("/api/auth/google")
def google_sign_in():
    if not GOOGLE_CLIENT_ID:
        return {"message": "Google sign-in is not configured (set GOOGLE_CLIENT_ID)"}, 503
    credential = (request.get_json(silent=True) or {}).get("credential")
    if not credential:
        return {"message": "Missing Google credential"}, 400
    try:
        info = google_id_token.verify_oauth2_token(credential, google_requests.Request(), GOOGLE_CLIENT_ID)
    except ValueError:
        return {"message": "Google sign-in failed, please try again"}, 401
    if not info.get("email") or not info.get("email_verified"):
        return {"message": "Your Google account needs a verified email"}, 401
    return sign_in(info["sub"], info["email"], info.get("name"), info.get("picture"))

@app.post("/api/auth/logout")
def logout():
    session.clear()
    return {"message": "Signed out"}

if TEST_LOGIN:
    @app.post("/api/auth/test-login")
    def test_login():
        data = request.get_json(silent=True) or {}
        email = data.get("email", "tester@example.com")
        return sign_in("test:" + email, email, data.get("name", "Test User"))


##REGISTER ENDPOINTS for url

api.add_resource(AssignmentResource,"/api/assignments")
api.add_resource(AssignmentResource2,"/api/assignments/<int:id>")

##SERVE THE BUILT FRONTEND (frontend/dist, made by npm run build) so the whole app lives on one url

@app.get("/")
@app.get("/<path:path>")
def frontend(path="index.html"):
    if path.startswith("api/"):
        return {"message": "Not found"}, 404
    if not os.path.exists(os.path.join(DIST, "index.html")):
        return "Frontend not built. Run npm run build in frontend/, or use the Vite dev server on port 5173.", 404
    if os.path.isfile(os.path.join(DIST, path)):
        return send_from_directory(DIST, path)
    return send_from_directory(DIST, "index.html")

##CREATES DATABASE TABLES

#we defined the structure in models but it hasnt been actually created (linked to flask above)

with app.app_context():
    db.create_all()

    #create_all doesn't add new columns to an existing table, so add the v0.2 columns in place (keeps all rows)
    columns = [c["name"] for c in inspect(db.engine).get_columns("assignment_model")]
    with db.engine.begin() as conn:
        if "kind" not in columns:
            conn.execute(text("ALTER TABLE assignment_model ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'assignment'"))
        if "end_date" not in columns:
            conn.execute(text("ALTER TABLE assignment_model ADD COLUMN end_date DATETIME"))
        #v0.3: existing rows keep user_id NULL until OWNER_EMAIL signs in
        if "user_id" not in columns:
            conn.execute(text("ALTER TABLE assignment_model ADD COLUMN user_id INTEGER REFERENCES users(id)"))

    #gunicorn --preload runs this once and then forks workers, they must not share these connections
    db.engine.dispose()

##START THE SERVER

if __name__ == "__main__":
    app.run(debug=True)
    
