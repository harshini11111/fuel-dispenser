"""
train_model.py  ─  FuelGuard ML Trainer
═══════════════════════════════════════════════════════════

READS:   faults.db  (real ESP32 rows + synthetic fault rows)
TRAINS:  RandomForestClassifier (300 trees)
SAVES:   model.pkl

WHEN TO RUN:
────────────
  After generate_fault_data.py has been run and you have
  200+ rows per class in faults.db.

HOW TO RUN:
───────────
  python train_model.py

AFTER RUNNING:
──────────────
  git add model.pkl
  git commit -m "Retrained on real ESP32 data"
  git push
  → Render auto-deploys new model
"""

import sqlite3
import os
import pandas as pd
import numpy as np
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import classification_report, confusion_matrix
import warnings
warnings.filterwarnings("ignore")

DB_FILE      = "faults.db"
CSV_FILE     = "sensor_log.csv"
MODEL_OUT    = "model.pkl"
FEATURES     = ["temperature", "current", "flow", "vibration"]
NAMES        = {0: "HEALTHY", 1: "WARNING", 2: "FAILURE"}
MIN_PER_CLS  = 50    # minimum rows per class to train

print("=" * 62)
print("  FuelGuard ML Trainer")
print("=" * 62)


# ─────────────────────────────────────────────
# STEP 1 — LOAD DATA
# ─────────────────────────────────────────────

frames = []

if os.path.exists(DB_FILE):
    conn  = sqlite3.connect(DB_FILE)
    db_df = pd.read_sql(
        "SELECT temperature, current, flow, vibration, health, "
        "COALESCE(source,'esp32') as source FROM sensor_data",
        conn
    )
    conn.close()
    frames.append(db_df)
    print(f"\n  faults.db     : {len(db_df)} rows")

    # Show source breakdown
    by_src = db_df["source"].value_counts()
    for src, n in by_src.items():
        print(f"    {src:12s}  {n} rows")

if os.path.exists(CSV_FILE):
    try:
        csv_df = pd.read_csv(CSV_FILE)
        if "source" not in csv_df.columns:
            csv_df["source"] = "csv"
        csv_df = csv_df[FEATURES + ["health", "source"]]
        frames.append(csv_df)
        print(f"  sensor_log.csv: {len(csv_df)} rows")
    except Exception as e:
        print(f"  CSV skipped: {e}")

if not frames:
    print("\n  ❌ No data found.")
    exit(1)

df = pd.concat(frames, ignore_index=True).drop_duplicates(subset=FEATURES + ["health"])

# ─────────────────────────────────────────────
# STEP 2 — CLEAN
# ─────────────────────────────────────────────

before = len(df)
df = df[df["current"]     >= 0]
df = df[df["temperature"] >= 0]
df = df[df["flow"]        <= 300]
df = df[df["vibration"]   <= 50]
df = df.dropna(subset=FEATURES + ["health"])
df = df.reset_index(drop=True)

print(f"\n  After cleaning: {len(df)} valid rows "
      f"({before - len(df)} removed)")


# ─────────────────────────────────────────────
# STEP 3 — CLASS DISTRIBUTION
# ─────────────────────────────────────────────

real_counts = df["health"].value_counts().sort_index().to_dict()
print("\n  Class distribution:")
ok = True
for cls in [0, 1, 2]:
    n   = real_counts.get(cls, 0)
    bar = "█" * min(n // 10, 30)
    src_note = ""
    if "source" in df.columns:
        real_n  = len(df[(df["health"] == cls) & (df["source"] == "esp32")])
        synth_n = n - real_n
        src_note = f"  (real={real_n}  synthetic={synth_n})"
    flag = "✅" if n >= MIN_PER_CLS else f"⚠ need {MIN_PER_CLS - n} more"
    print(f"    {NAMES[cls]:8s} ({cls})  {n:>5} rows  {bar}  {flag}{src_note}")
    if n < MIN_PER_CLS:
        ok = False

if not ok:
    print("\n  ⚠  Some classes are below minimum.")
    print("     Run generate_fault_data.py first, then retrain.")
    print("     Continuing anyway with available data...")


# ─────────────────────────────────────────────
# STEP 4 — SENSOR RANGES PER CLASS
# ─────────────────────────────────────────────

print("\n  Sensor ranges per class:")
for cls in [0, 1, 2]:
    sub = df[df["health"] == cls]
    if len(sub) == 0:
        print(f"    {NAMES[cls]:8s}  — no data")
        continue
    print(f"    {NAMES[cls]:8s}  "
          f"temp={sub['temperature'].min():.1f}–{sub['temperature'].max():.1f}  "
          f"curr={sub['current'].min():.2f}–{sub['current'].max():.2f}  "
          f"flow={sub['flow'].min():.1f}–{sub['flow'].max():.1f}  "
          f"vib={sub['vibration'].min():.3f}–{sub['vibration'].max():.3f}")


# ─────────────────────────────────────────────
# STEP 5 — TRAIN
# ─────────────────────────────────────────────

X = df[FEATURES]
y = df["health"]

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

print(f"\n  Train={len(X_train)}  Test={len(X_test)}")
print("  Training RandomForest (300 trees)...")

clf = RandomForestClassifier(
    n_estimators=300,
    max_depth=None,
    min_samples_leaf=1,
    max_features="sqrt",
    class_weight="balanced",
    random_state=42,
    n_jobs=-1
)
clf.fit(X_train, y_train)


# ─────────────────────────────────────────────
# STEP 6 — EVALUATE
# ─────────────────────────────────────────────

cv = cross_val_score(clf, X, y, cv=min(5, len(df) // 10), scoring="accuracy")
print(f"\n  Cross-val accuracy : {cv.mean():.1%} ± {cv.std():.1%}")

y_pred = clf.predict(X_test)
print("\n  Classification Report:")
print(classification_report(
    y_test, y_pred,
    target_names=["HEALTHY", "WARNING", "FAILURE"],
    zero_division=0
))

cm = confusion_matrix(y_test, y_pred, labels=[0, 1, 2])
print("  Confusion Matrix (rows=actual  cols=predicted):")
print("             HEALTHY  WARNING  FAILURE")
for i, row in enumerate(cm):
    print(f"  {NAMES[i]:8s}  {row[0]:>7}  {row[1]:>7}  {row[2]:>7}")


# ─────────────────────────────────────────────
# STEP 7 — SPOT CHECK
# Uses your real ESP32 failure values + derived ranges
# ─────────────────────────────────────────────

classes_list = list(clf.classes_)
STATUS       = {0: "HEALTHY", 1: "WARNING", 2: "FAILURE"}

def check(t, c, f, v, expected, label):
    s    = pd.DataFrame([[t,c,f,v]], columns=FEATURES)
    pred = int(clf.predict(s)[0])
    prob = clf.predict_proba(s)[0]
    fp   = prob[classes_list.index(2)] if 2 in classes_list else prob[-1]
    ok   = "✅" if pred == expected else "❌"
    print(f"  {label:26s}  [{t}, {c}, {f}, {v}]  "
          f"→ {STATUS[pred]:8s}  "
          f"H={prob[0]:.0%} W={prob[1]:.0%} F={prob[2]:.0%}  "
          f"fail={fp:.0%}  {ok}")
    return pred == expected

print("\n  Spot-checks:")

# Use real failure values from your faults.db
f_rows = df[df["health"] == 2]
h_rows = df[df["health"] == 0]
w_rows = df[df["health"] == 1]

spot_results = []

# Real failure readings
if len(f_rows) >= 2:
    r1 = f_rows.iloc[0]
    r2 = f_rows.iloc[len(f_rows)//2]
    spot_results.append(check(
        r1["temperature"], r1["current"], r1["flow"], r1["vibration"],
        2, "real failure row 1"
    ))
    spot_results.append(check(
        r2["temperature"], r2["current"], r2["flow"], r2["vibration"],
        2, "real failure row 2"
    ))

# Real healthy readings
if len(h_rows) >= 2:
    r1 = h_rows.iloc[0]
    r2 = h_rows.iloc[len(h_rows)//2]
    spot_results.append(check(
        r1["temperature"], r1["current"], r1["flow"], r1["vibration"],
        0, "real healthy row 1"
    ))
    spot_results.append(check(
        r2["temperature"], r2["current"], r2["flow"], r2["vibration"],
        0, "real healthy row 2"
    ))

# Real warning readings
if len(w_rows) >= 2:
    r1 = w_rows.iloc[0]
    r2 = w_rows.iloc[len(w_rows)//2]
    spot_results.append(check(
        r1["temperature"], r1["current"], r1["flow"], r1["vibration"],
        1, "real warning row 1"
    ))
    spot_results.append(check(
        r2["temperature"], r2["current"], r2["flow"], r2["vibration"],
        1, "real warning row 2"
    ))


# ─────────────────────────────────────────────
# STEP 8 — FEATURE IMPORTANCE
# ─────────────────────────────────────────────

print("\n  Feature importances (what the model learned):")
for feat, imp in sorted(
    zip(FEATURES, clf.feature_importances_),
    key=lambda x: -x[1]
):
    bar = "█" * int(imp * 40)
    print(f"    {feat:<15}  {imp:.3f}  {bar}")


# ─────────────────────────────────────────────
# STEP 9 — SAVE
# ─────────────────────────────────────────────

joblib.dump(clf, MODEL_OUT)
all_ok = all(spot_results) if spot_results else True

print("\n" + "=" * 62)
if all_ok:
    print(f"  ✅ {MODEL_OUT} saved — all spot-checks passed")
else:
    print(f"  ⚠  {MODEL_OUT} saved — some spot-checks failed")
    print("     Collect more real data and retrain")

print(f"""
  NEXT STEPS:
  ───────────
  git add model.pkl
  git commit -m "Retrained on real ESP32 data"
  git push
  → Render auto-deploys in ~1 minute

  Current data:
    HEALTHY  {real_counts.get(0,0):>5} rows
    WARNING  {real_counts.get(1,0):>5} rows
    FAILURE  {real_counts.get(2,0):>5} rows

  To improve further:
    Collect more real ESP32 readings in each state,
    run generate_fault_data.py again, then retrain.
""")
print("=" * 62)
