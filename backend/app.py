from flask import Flask, jsonify, request
from flask_cors import CORS
import joblib
import pandas as pd
import csv
from datetime import datetime
import os
import sqlite3
import random
from sklearn.ensemble import RandomForestClassifier

app = Flask(__name__)
CORS(app)

DB_FILE = "faults.db"
CSV_FILE = "sensor_log.csv"
MODEL_FILE = "model.pkl"

FEATURES = ["temperature", "current", "flow", "vibration"]
STATUS_MAP = {0: "Healthy", 1: "Warning", 2: "Failure"}

# ───────── MODEL LOAD ─────────
try:
    model = joblib.load(MODEL_FILE)
    print("✅ Model loaded")
except:
    model = None
    print("⚠ No model found — training required")

# ───────── DB INIT ─────────
def init_db():
    conn = sqlite3.connect(DB_FILE)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sensor_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            temperature REAL,
            current REAL,
            flow REAL,
            vibration REAL,
            health INTEGER,
            source TEXT
        )
    """)
    conn.commit()
    conn.close()

init_db()

# ───────── CSV INIT ─────────
if not os.path.exists(CSV_FILE):
    with open(CSV_FILE, "w", newline="") as f:
        csv.writer(f).writerow(
            ["timestamp","temperature","current","flow","vibration","health","source"]
        )

# ───────── SENSOR STATE ─────────
sensor_data = {
    "temperature": 0,
    "current": 0,
    "flow": 0,
    "vibration": 0,
    "health": 0
}

# ───────── RULE LABEL ─────────
def rule_label(t, c, f, v):
    if t > 55 or c > 2.0 or f < 1.5 or v > 2.0:
        return 2
    elif t > 45 or c > 1.5 or f < 2.5 or v > 1.2:
        return 1
    return 0

# ───────── ML PREDICT ─────────
def ml_predict(t, c, f, v):
    if model is None:
        return 0, 0.0, "No Model"

    sample = pd.DataFrame([[t, c, f, v]], columns=FEATURES)
    pred = int(model.predict(sample)[0])
    prob = model.predict_proba(sample)[0]

    classes = list(model.classes_)
    fail_prob = float(prob[classes.index(2)]) if 2 in classes else float(prob[-1])

    return pred, fail_prob, STATUS_MAP.get(pred)

# ───────── FAKE FAULT GENERATOR (KEEP SAME) ─────────
def generate_fault_data(n=200):
    rows = []
    now = datetime.now()

    for i in range(n):
        ts = now.strftime("%Y-%m-%d %H:%M:%S")

        rows.append((ts,
            random.uniform(45,55),
            random.uniform(1.5,2.2),
            random.uniform(1.5,3.0),
            random.uniform(1.0,2.5),
            1,"synthetic"
        ))

        rows.append((ts,
            random.uniform(60,80),
            random.uniform(2.5,4.0),
            random.uniform(0.0,1.5),
            random.uniform(2.0,5.0),
            2,"synthetic"
        ))

    conn = sqlite3.connect(DB_FILE)
    conn.executemany("""
        INSERT INTO sensor_data
        (timestamp, temperature, current, flow, vibration, health, source)
        VALUES (?,?,?,?,?,?,?)
    """, rows)
    conn.commit()
    conn.close()

    print(f"🔥 Generated {len(rows)} synthetic fault rows")

# ───────── TRAIN MODEL ─────────
def train_model():
    global model

    conn = sqlite3.connect(DB_FILE)
    df = pd.read_sql("SELECT * FROM sensor_data", conn)
    conn.close()

    if len(df) < 100:
        print("⚠ Not enough data")
        return

    X = df[FEATURES]
    y = df["health"]

    model = RandomForestClassifier(n_estimators=150)
    model.fit(X, y)

    joblib.dump(model, MODEL_FILE)
    print("✅ Model trained")

# ───────── ESP32 ROUTE (FIXED) ─────────
@app.route("/esp32", methods=["POST"])
def receive():
    global sensor_data

    data = request.get_json()

    if not data:
        return jsonify({"error": "No data received"}), 400

    print("📡 ESP32 DATA:", data)

    try:
        t = float(data.get("temperature", 0))
        c = float(data.get("current", 0))
        f = float(data.get("flow", 0))
        v = float(data.get("vibration", 0))
    except:
        return jsonify({"error": "Invalid data"}), 400

    health = rule_label(t, c, f, v)

    sensor_data = {
        "temperature": t,
        "current": c,
        "flow": f,
        "vibration": v,
        "health": health
    }

    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # CSV
    with open(CSV_FILE, "a", newline="") as fcsv:
        csv.writer(fcsv).writerow([ts,t,c,f,v,health,"esp32"])

    # DB
    conn = sqlite3.connect(DB_FILE)
    conn.execute("""
        INSERT INTO sensor_data
        (timestamp, temperature, current, flow, vibration, health, source)
        VALUES (?,?,?,?,?,?,?)
    """, (ts,t,c,f,v,health,"esp32"))
    conn.commit()
    conn.close()

    return jsonify({"status": "stored"})

# ───────── LIVE DATA ─────────
@app.route("/api/data")
def data():

    if sensor_data["temperature"] == 0:
        return jsonify({"error": "No ESP32 data yet"})

    t = sensor_data["temperature"]
    c = sensor_data["current"]
    f = sensor_data["flow"]
    v = sensor_data["vibration"]

    pred, prob, status = ml_predict(t,c,f,v)

    return jsonify({
        "temperature": t,
        "current": c,
        "flow": f,
        "vibration": v,
        "status": status,
        "failure_probability": prob,
        "health": rule_label(t, c, f, v)
    })

# ───────── DEMO DATA ─────────
@app.route("/api/demo")
def demo():
    t = round(random.uniform(30, 70), 1)
    c = round(random.uniform(0.5, 2.7), 2)
    f = round(random.uniform(0, 15), 2)
    v = round(random.uniform(0.1, 3.3), 3)
    health = rule_label(t, c, f, v)

    pred, prob, status = ml_predict(t, c, f, v)

    return jsonify({
        "temperature": t,
        "current": c,
        "flow": f,
        "vibration": v,
        "status": status,
        "failure_probability": prob,
        "health": health
    })

# ───────── ROUTES ─────────
@app.route("/generate_faults")
def faults():
    generate_fault_data()
    return jsonify({"message": "Fault data generated"})

@app.route("/train")
def train():
    train_model()
    return jsonify({"message": "Model trained"})

@app.route("/history")
def history():
    conn = sqlite3.connect(DB_FILE)
    rows = conn.execute("SELECT * FROM sensor_data ORDER BY id DESC LIMIT 20").fetchall()
    conn.close()
    return jsonify(rows)

#---temp---
def generate_healthy_data(n=200):
    rows = []
    from datetime import datetime
    import random

    now = datetime.now()

    for i in range(n):
        ts = now.strftime("%Y-%m-%d %H:%M:%S")

        rows.append((ts,
            random.uniform(30,45),   # temp
            random.uniform(0.5,1.5), # current
            random.uniform(2.5,4.0), # flow
            random.uniform(0.5,1.2), # vibration
            0,
            "synthetic"
        ))

    conn = sqlite3.connect(DB_FILE)
    conn.executemany("""
        INSERT INTO sensor_data
        (timestamp, temperature, current, flow, vibration, health, source)
        VALUES (?,?,?,?,?,?,?)
    """, rows)
    conn.commit()
    conn.close()

    print(f"✅ Generated {len(rows)} healthy rows")

@app.route("/generate_healthy")
def healthy():
    generate_healthy_data()
    return jsonify({"message": "Healthy data generated"})


# ───────── RUN ─────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
