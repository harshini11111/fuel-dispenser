from flask import Flask, jsonify, request
from flask_cors import CORS
import joblib
import numpy as np
import csv
from datetime import datetime
import os

app = Flask(__name__)
CORS(app)

# ---------------- LOAD ML MODEL ----------------
model = joblib.load("model.pkl")
print("✅ ML MODEL LOADED:", model)

# ---------------- GLOBAL SENSOR DATA ----------------
sensor_data = {
    "temperature": 0.0,
    "current": 0.0,
    "flow": 0.0,
    "vibration": 0.0,
    "health": 0
}
# sensor_data = {
#     "temperature": 45,
#     "current": 1.5,
#     "flow": 32,
#     "vibration": 1.5,
#     "health": 1
# }
# sensor_data = {
#     "temperature": 25,
#     "current": 0.5,
#     "flow": 10,
#     "vibration": 0.003,
#     "health": 0
# }
# 🔴 FAILURE TEST DATA (temporary)
# sensor_data = {
#     "temperature": 100.0,
#     "current": 3.2,
#     "flow": 0,
#     "vibration": 300,
#     "health": 2
# }

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

    # Save to CSV
    with open(CSV_FILE, "a", newline="") as file:
        writer = csv.writer(file)
        writer.writerow([
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            sensor_data["temperature"],
            sensor_data["current"],
            sensor_data["flow"],
            sensor_data["vibration"],
            sensor_data["health"]
        ])

    return {"message": "ESP32 data stored successfully"}

# ---------------- API FOR DASHBOARD ----------------
@app.route("/api/data")
def get_data():
    temp = sensor_data["temperature"]
    curr = sensor_data["current"]
    flow = sensor_data["flow"]
    vib = sensor_data["vibration"]

    sample = np.array([[temp, curr, flow, vib]])

    # ML debug prints
    print("📥 ML INPUT:", sample)

    prediction = model.predict(sample)[0]
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
        "status": status_map.get(prediction, "Unknown")
    })

@app.route("/logs")
def view_logs():
    import pandas as pd
    df = pd.read_csv("sensor_log_augmented.csv")
    return df.tail(20).to_json(orient="records")

@app.route("/api/importance")
def feature_importance():

    try:
        importances = model.feature_importances_

        features = ["temperature", "current", "flow", "vibration"]

        result = dict(zip(features, importances.tolist()))

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)})

# ---------------- RUN SERVER ----------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
