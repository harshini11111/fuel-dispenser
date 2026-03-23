"""
generate_fault_data.py  ─  FuelGuard Fault Data Generator (FIXED)
"""

import sqlite3
import csv
import os
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import random

random.seed(42)
np.random.seed(42)

DB_FILE  = "faults.db"
CSV_FILE = "sensor_log.csv"

N_WARNING = 200
N_HEALTHY = 200   # 🔥 NEW

STATUS = {0: "HEALTHY", 1: "WARNING", 2: "FAILURE"}

print("=" * 60)
print("FuelGuard Fault Data Generator")
print("=" * 60)

# ─────────────────────────────
# STEP 1 — LOAD DATA
# ─────────────────────────────
if not os.path.exists(DB_FILE):
    print("❌ faults.db not found. Run backend first.")
    exit()

conn = sqlite3.connect(DB_FILE)
df = pd.read_sql(
    "SELECT temperature, current, flow, vibration, health FROM sensor_data",
    conn
)
conn.close()

# Clean
df = df[df["current"] >= 0]
df = df[df["temperature"] >= 0]
df = df[df["flow"] <= 300]
df = df[df["vibration"] <= 50]
df = df.dropna()

print(f"\nTotal rows: {len(df)}")

# ─────────────────────────────
# STEP 2 — SPLIT DATA
# ─────────────────────────────
healthy_real = df[df["health"] == 0]
failure_real = df[df["health"] == 2]

# ─────────────────────────────
# STEP 3 — FAILURE RANGE (PRIMARY)
# ─────────────────────────────
if len(failure_real) >= 10:
    F_temp_min = float(failure_real["temperature"].min())
    F_temp_max = float(failure_real["temperature"].max())
    F_curr_min = float(failure_real["current"].min())
    F_curr_max = float(failure_real["current"].max())
    F_flow_min = float(failure_real["flow"].min())
    F_flow_max = float(failure_real["flow"].max())
    F_vib_min  = float(failure_real["vibration"].min())
    F_vib_max  = float(failure_real["vibration"].max())
else:
    print("❌ Not enough failure data")
    exit()

print("\nFailure Range:")
print(f"Temp: {F_temp_min:.2f} - {F_temp_max:.2f}")

# ─────────────────────────────
# STEP 4 — HEALTHY RANGE (DERIVED)
# ─────────────────────────────
if len(healthy_real) >= 20:
    # Use real healthy if available
    H_temp_min = float(healthy_real["temperature"].min())
    H_temp_max = float(healthy_real["temperature"].max())
    H_curr_min = float(healthy_real["current"].min())
    H_curr_max = float(healthy_real["current"].max())
    H_flow_min = float(healthy_real["flow"].min())
    H_flow_max = float(healthy_real["flow"].max())
    H_vib_min  = float(healthy_real["vibration"].min())
    H_vib_max  = float(healthy_real["vibration"].max())

    print("\nUsing REAL healthy data")

else:
    print("\n⚠ No healthy data → deriving from failure")

    H_temp_min = max(10, F_temp_min - 30)
    H_temp_max = max(H_temp_min + 5, F_temp_min - 10)

    H_curr_min = 0.2
    H_curr_max = max(H_curr_min + 0.2, F_curr_min * 0.5)


    H_flow_min = max(5.0, F_flow_max * 2)
    H_flow_max = H_flow_min + 5

    H_vib_min  = 0.01
    H_vib_max  = max(0.1, F_vib_min * 0.5)

print("\nHealthy Range:")
print(f"Temp: {H_temp_min:.2f} - {H_temp_max:.2f}")

# ─────────────────────────────
# STEP 5 — WARNING RANGE
# ─────────────────────────────
W_temp_min = H_temp_max - 5
W_temp_max = F_temp_min + 2

W_curr_min = H_curr_max
W_curr_max = F_curr_min - 0.1

W_flow_min = max(1.0, F_flow_max - 10)
W_flow_max = H_flow_min + 10

W_vib_min  = H_vib_max
W_vib_max  = F_vib_min - 0.001

# Fix ranges
W_temp_max = max(W_temp_max, W_temp_min + 1)
W_curr_max = max(W_curr_max, W_curr_min + 0.1)
W_flow_min = max(1.0, W_flow_min)
W_flow_max = max(W_flow_min + 0.5, W_flow_max)
W_vib_max  = max(W_vib_max, W_vib_min + 0.001)

print("\nWarning Range computed")
# 🔥 IMPROVE TEMPERATURE VARIATION
# healthy slightly lower
H_temp_max = H_temp_max + 2

# warning centered
W_temp_min = W_temp_min + 1
W_temp_max = W_temp_max + 3

# failure slightly pushed higher
F_temp_min = F_temp_min + 2

# ─────────────────────────────
# STEP 6 — GENERATE DATA (UPDATED WITH NOISE)
# ─────────────────────────────
def add_noise(val, scale):
    return val + random.uniform(-scale, scale)

def make_rows(cls, n, tlo, thi, clo, chi, flo, fhi, vlo, vhi):
    rows = []
    base = datetime.now()

    for i in range(n):
        ts = (base - timedelta(seconds=n - i)).strftime("%Y-%m-%d %H:%M:%S")

        # 🎯 Generate base values
        temp = random.uniform(tlo, thi)
        curr = random.uniform(clo, chi)
        flow = random.uniform(flo, fhi)
        vib  = random.uniform(vlo, vhi)

        # 🔥 ADD NOISE (REALISM)
        temp = add_noise(temp, 5.0)
        curr = add_noise(curr, 0.4)
        flow = add_noise(flow, 3.0)
        vib  = add_noise(vib, 0.6)

        # 🔥 ADD CLASS OVERLAP (VERY IMPORTANT)
        if random.random() < 0.25:
            temp += random.uniform(-6, 6)
            curr += random.uniform(-0.6, 0.6)
            flow += random.uniform(-3, 3)
            vib  += random.uniform(-0.8, 0.8)

        # occasional anomaly
        if cls == 0 and random.random() < 0.25:
            # healthy behaving like warning
            temp += random.uniform(5, 10)
            curr += random.uniform(0.5, 1.0)
        if cls == 1 and random.random() < 0.25:
             # warning behaving like failure OR healthy
            if random.random() < 0.5:
                flow -= random.uniform(1.0, 2.0)
                vib += random.uniform(0.5, 1.0)
            else:
                temp -= random.uniform(5, 10)
                curr -= random.uniform(0.5, 1.0)
        if cls == 2 and random.random() < 0.2:
            # failure behaving slightly normal
            flow += random.uniform(1.0, 2.5)
            curr -= random.uniform(0.5, 1.0)

        # 🔒 Clamp values (avoid negatives / invalid)
        temp = max(0, temp)
        curr = max(0, curr)
        flow = max(0, flow)
        vib  = max(0, vib)

        rows.append((
            ts,
            round(temp, 2),
            round(curr, 2),
            round(flow, 2),
            round(vib, 4),
            cls,
            "synthetic"
        ))

    return rows

# ─────────────────────────────
# STEP 6.5 — CREATE DATA (MISSING PART 🔥)
# ─────────────────────────────

healthy_rows = make_rows(
    0, N_HEALTHY,
    H_temp_min, H_temp_max,
    H_curr_min, H_curr_max,
    H_flow_min, H_flow_max,
    H_vib_min,  H_vib_max
)

warning_rows = make_rows(
    1, N_WARNING,
    W_temp_min, W_temp_max,
    W_curr_min, W_curr_max,
    W_flow_min, W_flow_max,
    W_vib_min,  W_vib_max
)

all_rows = healthy_rows + warning_rows
random.shuffle(all_rows)

print(f"\nGenerated {len(all_rows)} rows")

# ─────────────────────────────
# STEP 7 — SAVE
# ─────────────────────────────
conn = sqlite3.connect(DB_FILE)

conn.executemany("""
INSERT INTO sensor_data
(timestamp, temperature, current, flow, vibration, health, source)
VALUES (?,?,?,?,?,?,?)
""", all_rows)

conn.commit()
conn.close()

# CSV
write_header = not os.path.exists(CSV_FILE)

with open(CSV_FILE, "a", newline="") as f:
    writer = csv.writer(f)

    if write_header:
        writer.writerow([
            "timestamp","temperature","current",
            "flow","vibration","health","source"
        ])

    writer.writerows(all_rows)

print("\n✅ Data added to DB and CSV")
print("👉 Now run: python train_model.py")
print("=" * 60)