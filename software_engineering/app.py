from flask import Flask, render_template, request, jsonify, g
import sqlite3
import os
from datetime import datetime

APP_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(APP_DIR, "attendance.db")

app = Flask(__name__)

# ---------- DB helpers ----------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(_):
    db = g.pop("db", None)
    if db:
        db.close()

def init_db():
    db = get_db()
    db.executescript(
        """
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            roll_no TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS subjects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        );

        /* date stored as dd-mm-yyyy text */
        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            subject_id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            status TEXT CHECK(status IN ('Present','Absent')) NOT NULL,
            UNIQUE(date, subject_id, student_id),
            FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
            FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
        );
        """
    )

    # seed subjects + students if empty
    cur = db.execute("SELECT COUNT(*) c FROM subjects")
    if cur.fetchone()["c"] == 0:
        subjects = [
            "Software Engineering","Mobile Applications","Data Structure","Mathematics",
            "Information Security","Frontend Development","Basic Indian Language",
            "Information Security lab","Frontend Development lab","Mobile Applications lab",
            "Data Structure lab","Integral Yoga"
        ]
        db.executemany("INSERT INTO subjects(name) VALUES(?)", [(s,) for s in subjects])

    cur = db.execute("SELECT COUNT(*) c FROM students")
    if cur.fetchone()["c"] == 0:
        students = [
            ("AIAT/SDML/01","Aravindh"),
            ("AIAT/SDML/02","Aswin"),
            ("AIAT/SDML/03","Bavana"),
            ("AIAT/SDML/04","Gokul"),
            ("AIAT/SDML/05","Hariharan"),
            ("AIAT/SDML/06","Meenatchi"),
            ("AIAT/SDML/07","Siva Bharathi"),
            ("AIAT/SDML/08","Visal Stephen Raj"),
        ]
        db.executemany("INSERT INTO students(roll_no,name) VALUES(?,?)", students)

    db.commit()

# ---------- pages ----------
@app.route("/")
def home():
    return render_template("home.html", page="home")

@app.route("/store")
def store():
    return render_template("store.html", page="store")

@app.route("/view")
def view_attendance():
    return render_template("view.html", page="view")

@app.route("/individual")
def individual():
    return render_template("individual.html", page="individual")

# ---------- apis ----------
@app.route("/api/subjects")
def api_subjects():
    db = get_db()
    rows = db.execute("SELECT id, name FROM subjects ORDER BY name").fetchall()
    return jsonify([dict(row) for row in rows])

@app.route("/api/students")
def api_students():
    db = get_db()
    rows = db.execute("SELECT id, roll_no, name FROM students ORDER BY name").fetchall()
    return jsonify([dict(row) for row in rows])

@app.route("/api/save_attendance", methods=["POST"])
def api_save_attendance():
    """
    expects JSON: { "date":"dd-mm-yyyy", "subject_id":1, "marks": [ {student_id, status}, ... ] }
    will upsert rows and enforce all students provided.
    """
    data = request.get_json(force=True)
    date = data.get("date")
    subject_id = data.get("subject_id")
    marks = data.get("marks", [])

    # basic validation
    try:
        datetime.strptime(date, "%d-%m-%Y")
    except Exception:
        return jsonify({"ok": False, "error": "Invalid date format; use dd-mm-yyyy"}), 400

    if not subject_id or not isinstance(marks, list) or len(marks) == 0:
        return jsonify({"ok": False, "error": "Missing subject or marks"}), 400

    db = get_db()
    # ensure subject exists
    s = db.execute("SELECT id FROM subjects WHERE id=?", (subject_id,)).fetchone()
    if not s:
        return jsonify({"ok": False, "error": "Subject not found"}), 404

    # write (upsert)
    for m in marks:
        sid = m.get("student_id")
        status = m.get("status")
        if status not in ("Present","Absent"):
            return jsonify({"ok": False, "error": "Invalid status"}), 400
        st = db.execute("SELECT id FROM students WHERE id=?", (sid,)).fetchone()
        if not st:
            return jsonify({"ok": False, "error": f"Student {sid} not found"}), 404
        db.execute(
            """
            INSERT INTO attendance(date, subject_id, student_id, status)
            VALUES(?,?,?,?)
            ON CONFLICT(date, subject_id, student_id)
            DO UPDATE SET status=excluded.status
            """,
            (date, subject_id, sid, status)
        )
    db.commit()
    return jsonify({"ok": True})

@app.route("/api/get_attendance")
def api_get_attendance():
    """
    query params: subject_id, date(dd-mm-yyyy)
    returns: [{roll_no,name,status}]
    """
    subject_id = request.args.get("subject_id", type=int)
    date = request.args.get("date", type=str)

    try:
        datetime.strptime(date, "%d-%m-%Y")
    except Exception:
        return jsonify({"ok": False, "error": "Invalid date format; use dd-mm-yyyy"}), 400

    db = get_db()
    rows = db.execute(
        """
        SELECT st.roll_no, st.name, COALESCE(a.status,'Absent') AS status
        FROM students st
        LEFT JOIN attendance a
            ON a.student_id = st.id AND a.subject_id = ? AND a.date = ?
        ORDER BY st.name
        """,
        (subject_id, date)
    ).fetchall()

    return jsonify({"ok": True, "records": [dict(r) for r in rows]})

@app.route("/api/student_report")
def api_student_report():
    """
    query params: query (name substring or roll no)
    returns: {student:{id,roll_no,name}, rows:[{date,subject,status}]}
    """
    q = (request.args.get("query") or "").strip()
    if not q:
        return jsonify({"ok": False, "error": "Provide a search query"}), 400

    db = get_db()
    stu = db.execute(
        "SELECT * FROM students WHERE roll_no LIKE ? OR name LIKE ? ORDER BY name LIMIT 1",
        (f"%{q}%", f"%{q}%")
    ).fetchone()

    if not stu:
        return jsonify({"ok": True, "student": None, "rows": []})

    rows = db.execute(
        """
        SELECT a.date, s.name AS subject, a.status
        FROM attendance a
        JOIN subjects s ON s.id = a.subject_id
        WHERE a.student_id = ?
        ORDER BY date(a.date) ASC, s.name ASC
        """,
        (stu["id"],)
    ).fetchall()

    return jsonify({
        "ok": True,
        "student": {"id": stu["id"], "roll_no": stu["roll_no"], "name": stu["name"]},
        "rows": [dict(r) for r in rows]
    })

if __name__ == "__main__":
    with app.app_context():
        init_db()
    app.run(debug=True)