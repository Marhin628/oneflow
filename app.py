##IMPORTS
#this file runs flask itself and handles the API requests

import os
from flask import Flask
from models import db, AssignmentModel
from flask_restful import Api, Resource, fields, marshal_with,marshal, reqparse
from datetime import datetime
from werkzeug.exceptions import BadRequest
from sqlalchemy import inspect, text


##APP SETUP
app=Flask(__name__)
api = Api(app)

#configures the database (of our sqlalchemy) to sqlite with one flow
#tests set ONEFLOW_DATABASE_URI to a separate file so they never touch the real data
app.config["SQLALCHEMY_DATABASE_URI"]=os.environ.get("ONEFLOW_DATABASE_URI","sqlite:///oneflow.db")

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
        assignments = AssignmentModel.query.all()
        return (assignments)

    @marshal_with(assignment_fields)
    def post(self):
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
            end_date=end_date
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
        assignment=db.session.get(AssignmentModel,id)

        if assignment is None:
            return {"message":"Assignment not found"},404

        db.session.delete(assignment)
        db.session.commit()

        return {"message":"Assignment deleted successfully!"},200

    def patch(self, id):
        assignment = db.session.get(AssignmentModel, id)

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
        
        

##REGISTER ENDPOINTS for url

api.add_resource(AssignmentResource,"/api/assignments")
api.add_resource(AssignmentResource2,"/api/assignments/<int:id>")

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

##START THE SERVER

if __name__ == "__main__":
    app.run(debug=True)
    
