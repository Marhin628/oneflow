##IMPORTS
#this file runs flask itself and handles the API requests

from flask import Flask
from models import db, AssignmentModel
from flask_restful import Api, Resource, fields, marshal_with,marshal, reqparse
from datetime import datetime
from werkzeug.exceptions import BadRequest


##APP SETUP
app=Flask(__name__)
api = Api(app)

#configures the database (of our sqlalchemy) to sqlite with one flow
app.config["SQLALCHEMY_DATABASE_URI"]="sqlite:///oneflow.db"

#initializes the objects in sqlalchemy to flask
db.init_app(app)

#formats the AppModel into a dictionary
assignment_fields = {
    "id": fields.Integer,
    "title": fields.String,
    "course": fields.String,
    "due_date": fields.DateTime,
    "type": fields.String,
    "completed": fields.Boolean,
    "source": fields.String
}

#parse inputs
assignment_parser = reqparse.RequestParser()
assignment_parser.add_argument("title", type=str, required=True, location="json")
assignment_parser.add_argument("course", type=str, required=True, location="json")
assignment_parser.add_argument("due_date", type=str, required=True, location="json")
assignment_parser.add_argument("type", type=str, required=True, location="json")


##RESOURCE CLASSES AND METHODS
patch_parser = reqparse.RequestParser()
patch_parser.add_argument("title", type=str, location="json")
patch_parser.add_argument("course", type=str, location="json")
patch_parser.add_argument("due_date", type=str, location="json")
patch_parser.add_argument("type", type=str, location="json")
patch_parser.add_argument("completed", type=bool, location="json")

class AssignmentResource(Resource):
    #we use self with get so it uses resources
    @marshal_with(assignment_fields)
    def get(self):
        assignments = AssignmentModel.query.all()
        return (assignments)

    @marshal_with(assignment_fields)
    def post(self):
        args = assignment_parser.parse_args()

        try:
            due_date = datetime.fromisoformat(args["due_date"])
        except ValueError:
            raise BadRequest("Invalid date format. Use YYYY-MM-DDTHH:MM:SS")

        assignment = AssignmentModel(
            title=args["title"],
            course=args["course"],
            due_date=due_date,
            type=args["type"]
        )

        db.session.add(assignment)
        db.session.commit()

        return assignment, 201
        
class AssignmentResource2(Resource):
    #requires an id to delete
    def delete(self,id):
        assignment=db.session.get(AssignmentModel,id)

        if assignment is None:
            return {"message":"Assignment not found}"},404

        db.session.delete(assignment)
        db.session.commit()

        return {"message":"Assignment deleted successfully!"},200

    def patch(self, id):
        assignment = db.session.get(AssignmentModel, id)

        if assignment is None:
            return {"message": "Assignment not found"}, 404

        args = patch_parser.parse_args()

        if args["title"] is not None:
            assignment.title = args["title"]

        if args["course"] is not None:
            assignment.course = args["course"]

        if args["due_date"] is not None:
            try:
                assignment.due_date = datetime.fromisoformat(args["due_date"])
            except ValueError:
                return {"message": "Invalid date format. Use YYYY-MM-DDTHH:MM:SS"}, 400

        if args["type"] is not None:
            assignment.type = args["type"]

        if args["completed"] is not None:
            assignment.completed = args["completed"]

        db.session.commit()

        return marshal(assignment, assignment_fields), 200
        
        

##REGISTER ENDPOINTS for url

api.add_resource(AssignmentResource,"/api/assignments")
api.add_resource(AssignmentResource2,"/api/assignments/<int:id>")

##CREATES DATABASE TABLES

#we defined the structure in models but it hasnt been actually created (linked to flask above)

with app.app_context():
    db.create_all()

##START THE SERVER

if __name__ == "__main__":
    app.run(debug=True)
    
