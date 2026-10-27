#structures how the database stores information

from flask_sqlalchemy import SQLAlchemy

#create the database with sqlAlchemy
db=SQLAlchemy()


#the assignment model class takes db.Model as an parent model,
#the name of our database is called AssignmentModel
class AssignmentModel(db.Model):
    # we will make 7 columns, aka 7 data fields per row

    #id represents an integer which acts as the primary key
    id=db.Column(db.Integer,primary_key=True)
    #title is a string with a max of 100 chars and it cannot be null
    title=db.Column(db.String(100),nullable=False)
    course=db.Column(db.String(50),nullable=False)
    due_date=db.Column(db.DateTime,nullable=False)
    type=db.Column(db.String(30),nullable=False)
    completed=db.Column(db.Boolean,default=False)
    source=db.Column(db.String(30),default="manual")
    #v0.2: "assignment" (due_date is the deadline) or "event" (due_date is the start, end_date the end)
    kind=db.Column(db.String(20),nullable=False,default="assignment",server_default="assignment")
    end_date=db.Column(db.DateTime,nullable=True)
    