from flask import Flask, jsonify, request
from flask_cors import CORS
import joblib
import numpy as np
import csv
from datetime import datetime
import os
import sqlite3
import random


app = Flask(__name__)
CORS(app)

# ---------------- LOAD ML MODEL ----------------
model = joblib.load("model.pkl")
print("✅ ML MODEL LOADED:", model)

# ---------------- DATABASE SETUP ----------------
def init_db():
    conn = sqlite3.connect("faults.db")
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sensor_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        temperature REAL,
        current REAL,
        flow REAL,
        vibration REAL,
        health INTEGER
    )
    """)

    conn.commit()
    conn.close()

init_db()

# ---------------- GLOBAL SENSOR DATA ----------------
sensor_data = {
    "temperature": 0.0,
    "current": 0.0,
    "flow": 0.0,
    "vibration": 0.0,
    "health": 0
}

CSV_FILE = "sensor_log_augmented.csv"

# ---------------- CREATE CSV IF NOT EXISTS ----------------
if not os.path.exists(CSV_FILE):
    with open(CSV_FILE, "w", newline="") as file:
        writer = csv.writer(file)
        writer.writerow([
            "timestamp",
            "temperature",
            "current",
            "flow",
            "vibration",
            "health"
        ])

# ---------------- RECEIVE ESP32 DATA ----------------
@app.route("/esp32", methods=["POST"])
def receive_esp32():
    global sensor_data

    data = request.get_json()
    if not data:
        return {"error": "No data received"}, 400

    sensor_data["temperature"] = float(data.get("temperature", 0))
    sensor_data["current"] = float(data.get("current", 0))
    sensor_data["flow"] = float(data.get("flow", 0))
    sensor_data["vibration"] = float(data.get("vibration", 0))
    sensor_data["health"] = int(data.get("health", 0))

    # Debug print
    print("📡 ESP DATA RECEIVED:", sensor_data)

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # ---------------- SAVE TO CSV ----------------
    with open(CSV_FILE, "a", newline="") as file:
        writer = csv.writer(file)
        writer.writerow([
            timestamp,
            sensor_data["temperature"],
            sensor_data["current"],
            sensor_data["flow"],
            sensor_data["vibration"],
            sensor_data["health"]
        ])

    # ---------------- SAVE TO DATABASE ----------------
    conn = sqlite3.connect("faults.db")
    cursor = conn.cursor()

    cursor.execute("""
    INSERT INTO sensor_data (timestamp, temperature, current, flow, vibration, health)
    VALUES (?, ?, ?, ?, ?, ?)
    """, (
        timestamp,
        sensor_data["temperature"],
        sensor_data["current"],
        sensor_data["flow"],
        sensor_data["vibration"],
        sensor_data["health"]
    ))

    conn.commit()
    conn.close()

    return {"message": "ESP32 data stored successfully"}

# ---------------- API FOR DASHBOARD ----------------
@app.route("/api/data")
def get_data():

    temp = sensor_data["temperature"]
    curr = sensor_data["current"]
    flow = sensor_data["flow"]
    vib = sensor_data["vibration"]

    sample = np.array([[temp, curr, flow, vib]])

    print("📥 ML INPUT:", sample)

    prediction = model.predict(sample)[0]
    prob = model.predict_proba(sample)[0]
    failure_probability = float(prob[2])

    print("🤖 ML OUTPUT:", prediction)

    status_map = {
        0: "Healthy",
        1: "Warning",
        2: "Failure"
    }

    return jsonify({
    "temperature": temp,
    "current": curr,
    "flow": flow,
    "vibration": vib,
    "status": status_map.get(prediction, "Unknown"),
    "failure_probability": failure_probability
})

#--------------DEMO DATA--------------

@app.route("/api/demo")
def demo_data():

    # Random values for sensors
    temperature = random.choice([25, 30, 35, 45, 55, 65])
    current = random.choice([0.5, 0.8, 1.2, 1.6, 2.0, 2.5])
    flow = random.choice([10, 12, 8, 3, 0])
    vibration = random.choice([0.01, 0.02, 0.05, 0.1, 15])

    sample = np.array([[temperature, current, flow, vibration]])

    prediction = model.predict(sample)[0]
    prob = model.predict_proba(sample)[0]
    failure_probability = float(prob[2])

    status_map = {
        0: "Healthy",
        1: "Warning",
        2: "Failure"
    }

    return jsonify({
    "temperature": temperature,
    "current": current,
    "flow": flow,
    "vibration": vibration,
    "status": status_map.get(prediction, "Unknown"),
    "failure_probability": failure_probability
})

# ---------------- VIEW CSV LOGS ----------------
@app.route("/logs")
def view_logs():
    import pandas as pd
    df = pd.read_csv("sensor_log_augmented.csv")
    return df.tail(20).to_json(orient="records")

# ---------------- FEATURE IMPORTANCE ----------------
@app.route("/api/importance")
def feature_importance():

    try:
        importances = model.feature_importances_
        features = ["temperature", "current", "flow", "vibration"]
        result = dict(zip(features, importances.tolist()))
        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)})

# ---------------- DATABASE HISTORY API ----------------
@app.route("/api/history")
def get_history():

    conn = sqlite3.connect("faults.db")
    cursor = conn.cursor()

    cursor.execute("""
    SELECT timestamp, temperature, current, flow, vibration, health
    FROM sensor_data
    ORDER BY id DESC
    LIMIT 20
    """)

    rows = cursor.fetchall()
    conn.close()

    result = []

    for row in rows:
        result.append({
            "timestamp": row[0],
            "temperature": row[1],
            "current": row[2],
            "flow": row[3],
            "vibration": row[4],
            "health": row[5]
        })

    return jsonify(result)

# ---------------- RUN SERVER ----------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
