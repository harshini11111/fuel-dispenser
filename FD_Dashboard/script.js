/* ═══════════════════════════════════════════════════
   FUELGUARD — Predictive Maintenance Dashboard
   script.js
═══════════════════════════════════════════════════ */


// ═══════════════════════════════════════
// MODE  (live = ESP32 API, demo = random)
// ═══════════════════════════════════════

let mode = "demo";

function setMode(newMode) {
  mode = newMode;
  document.getElementById("modeLabel").textContent = mode.toUpperCase();

  // Highlight active button
  document.getElementById("btn-live").classList.remove("active-mode");
  document.getElementById("btn-demo").classList.remove("active-mode");
  document.getElementById("btn-" + mode).classList.add("active-mode");

  // Toast instead of alert()
  if (mode === "live")
    showToast("⚡ LIVE MODE — ESP32 hardware data active");
  else
    showToast("🔵 DEMO MODE — Simulated random data active");
}


// ═══════════════════════════════════════
// TOAST NOTIFICATION
// ═══════════════════════════════════════

function showToast(msg) {
  let toast = document.getElementById("toast");

  // Create if it doesn't exist yet
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = msg;
  toast.style.opacity = "1";
  setTimeout(() => { toast.style.opacity = "0"; }, 3000);
}


// ═══════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════

function getTime() {
  return new Date().toLocaleTimeString();
}

function updateClock() {
  document.getElementById("timeClock").textContent =
    new Date().toLocaleTimeString("en-IN", { hour12: false });
}

setInterval(updateClock, 1000);
updateClock();


// ═══════════════════════════════════════
// DATA ARRAYS
// ═══════════════════════════════════════

let labels       = [];
let tempData     = [];
let currentData  = [];
let flowData     = [];
let vibrationData = [];
let faultHistory = [];

const MAX_POINTS = 10;


// ═══════════════════════════════════════
// CHART FACTORY
// Each chart has a data line + optional dashed threshold line
// ═══════════════════════════════════════

const sharedChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: {
    legend: {
      labels: {
        font: { family: "'Share Tech Mono', monospace", size: 9 },
        color: "#7a9bbf",
        boxWidth: 12,
      },
    },
    tooltip: {
      backgroundColor: "rgba(8,15,26,0.95)",
      borderColor: "rgba(0,212,255,0.2)",
      borderWidth: 1,
      titleFont: { family: "'Share Tech Mono', monospace", size: 9 },
      bodyFont:  { family: "'Share Tech Mono', monospace", size: 9 },
      titleColor: "#00d4ff",
      bodyColor:  "#7a9bbf",
    },
  },
  scales: {
    x: {
      grid: { color: "rgba(19,37,64,0.8)" },
      ticks: { font: { family: "'Share Tech Mono', monospace", size: 8 }, color: "#3a5570" },
    },
    y: {
      grid: { color: "rgba(19,37,64,0.8)" },
      ticks: { font: { family: "'Share Tech Mono', monospace", size: 8 }, color: "#3a5570" },
    },
  },
};

function createChart(canvasId, label, dataArray, lineColor, thresholdValue) {
  const datasets = [
    {
      label: label,
      data: dataArray,
      borderColor: lineColor,
      borderWidth: 2,
      fill: true,
      backgroundColor: lineColor + "18",   // 10% opacity fill
      tension: 0.4,
      pointRadius: 2,
      pointBackgroundColor: lineColor,
    },
  ];

  // Add dashed threshold line only when a value is given
  if (thresholdValue !== undefined) {
    datasets.push({
      label: "Threshold",
      data: [],                              // filled dynamically
      borderColor: "rgba(255,34,68,0.45)",
      borderWidth: 1,
      borderDash: [6, 3],
      pointRadius: 0,
      fill: false,
      tension: 0,
    });
  }

  return new Chart(document.getElementById(canvasId), {
    type: "line",
    data: { labels, datasets },
    options: sharedChartOptions,
  });
}

const tempChart      = createChart("tempChart",      "Temperature (°C)", tempData,      "#ff6666", 50);
const currentChart   = createChart("currentChart",   "Current (A)",       currentData,   "#ffcc00", 1.8);
const flowChart      = createChart("flowChart",       "Flow Rate (L/m)",  flowData,      "#00d4ff");      // no threshold line
const vibrationChart = createChart("vibrationChart", "Vibration",         vibrationData, "#aa88ff", 10);


// ═══════════════════════════════════════
// FAILURE PROBABILITY GAUGE (half doughnut)
// ═══════════════════════════════════════

const gauge = new Chart(document.getElementById("probabilityGauge"), {
  type: "doughnut",
  data: {
    datasets: [{
      data: [0, 100],
      backgroundColor: ["#ff2244", "#0c1624"],
      borderWidth: 0,
    }],
  },
  options: {
    circumference: 180,
    rotation: 270,
    cutout: "72%",
    animation: { duration: 600 },
    plugins: {
      legend:  { display: false },
      tooltip: { enabled: false },
    },
  },
});


// ═══════════════════════════════════════
// SENSOR CARD COLOUR  (green / yellow / red)
// Maps to CSS classes and status pill text
// ═══════════════════════════════════════

function setBox(boxId, value, greenLimit, redLimit) {
  const box = document.getElementById(boxId);
  box.classList.remove("green", "yellow", "red");

  // Pill element id follows pattern: tempBox → tempPill, currentBox → currentPill, etc.
  const pillId = boxId.replace("Box", "Pill");
  const pill   = document.getElementById(pillId === "vibPill" ? "vibPill" : pillId);

  let cssClass, pillState;

  if (value <= greenLimit) {
    cssClass  = "green";
    pillState = "ok";
  } else if (value <= redLimit) {
    cssClass  = "yellow";
    pillState = "warn";
  } else {
    cssClass  = "red";
    pillState = "crit";
  }

  box.classList.add(cssClass);

  if (pill) {
    pill.className   = "sc-status-pill " + pillState;
    pill.textContent =
      pillState === "ok"   ? "● NORMAL"     :
      pillState === "warn" ? "▲ WARNING"    :
                             "⛔ CRITICAL";
  }
}

// Flow has a range check (not just a max threshold)
function setFlowBox(flow) {
  const box  = document.getElementById("flowBox");
  const pill = document.getElementById("flowPill");

  box.classList.remove("green", "yellow", "red");

  if (flow <= 1 || flow > 15) {
    box.classList.add("red");
    if (pill) { pill.className = "sc-status-pill crit"; pill.textContent = "⛔ CRITICAL"; }
  } else {
    box.classList.add("green");
    if (pill) { pill.className = "sc-status-pill ok";   pill.textContent = "● NORMAL"; }
  }
}


// ═══════════════════════════════════════
// HEALTH SCORE  (rule-based, 0–100)
// ═══════════════════════════════════════

function calculateHealthScore(t, c, f, v) {
  let score = 100;

  if (t > 50)             score -= 30;   // temperature too high
  if (c > 1.8)            score -= 25;   // current overload
  if (f <= 1 || f > 15)   score -= 25;   // flow out of range
  if (v > 0.06)           score -= 20;   // vibration too high

  return Math.max(score, 0);
}


// ═══════════════════════════════════════
// ALERT TICKER  (scrolling headline bar)
// ═══════════════════════════════════════

function updateAlertTicker(failures) {
  const txt = failures.length === 0
    ? "✅ System healthy — All parameters within safe limits"
    : failures.map(f => "⚠ " + f).join("  ·  ");

  document.getElementById("alertScroll").textContent      = txt;
  document.getElementById("alertScrollClone").textContent = txt;
}


// ═══════════════════════════════════════
// HEALTH DISPLAY  (status boxes + fault tracking)
// ═══════════════════════════════════════

function updateHealth(t, c, f, v) {
  const failures = [];

  if (t > 50)           failures.push("TEMPERATURE SENSOR FAILURE");
  if (c > 1.8)          failures.push("MOTOR CURRENT OVERLOAD");
  if (f <= 1 || f > 15) failures.push("FLOW METER FAILURE");
  if (v > 12)           failures.push("PUMP BEARING FAILURE");

  const container = document.getElementById("healthText");
  container.innerHTML = "";

  if (failures.length > 0) {
    // Render one red box per fault
    failures.forEach(fault => {
      const div = document.createElement("div");
      div.className   = "failure-box";
      div.innerHTML   = "⛔ " + fault;
      container.appendChild(div);

      // Log every new fault into history
      faultHistory.push({ time: getTime(), fault, sev: "high" });
    });

    document.getElementById("activeFaults").textContent        = failures.length;
    document.getElementById("faultHint").textContent           = failures.length + " active fault(s)";
    document.getElementById("overviewStatus").style.color      = "var(--red)";
    document.getElementById("overviewStatus").textContent      = "FAULT";
    document.getElementById("healthScoreValue").style.color    = "var(--red)";

    updateFaultTable();

  } else {
    const div = document.createElement("div");
    div.className   = "healthy-box";
    div.innerHTML   = "✅ SYSTEM HEALTHY — All parameters within safe operating limits";
    container.appendChild(div);

    document.getElementById("activeFaults").textContent        = "0";
    document.getElementById("faultHint").textContent           = "All systems nominal";
    document.getElementById("overviewStatus").style.color      = "var(--green)";
    document.getElementById("overviewStatus").textContent      = "HEALTHY";
    document.getElementById("healthScoreValue").style.color    = "var(--green)";
  }

  updateAlertTicker(failures);
}


// ═══════════════════════════════════════
// FAULT TABLE
// Shows last 10 faults, newest first
// ═══════════════════════════════════════

function updateFaultTable() {
  const tbody = document.querySelector("#faultTable tbody");
  tbody.innerHTML = "";

  const recent = faultHistory.slice(-10).reverse();

  recent.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--txtd);">${row.time}</td>
      <td>${row.fault}</td>
      <td><span class="sev-badge ${row.sev === "high" ? "high" : "med"}">${row.sev.toUpperCase()}</span></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("faultCountBadge").textContent = faultHistory.length + " EVENTS";
}


// ═══════════════════════════════════════
// RUL  (Remaining Useful Life estimate)
// Simple linear degradation from threshold
// ═══════════════════════════════════════

function estimateRUL(value, threshold) {
  if (value >= threshold) return "0";
  return ((threshold - value) / 5).toFixed(1);
}


// ═══════════════════════════════════════
// THRESHOLD LINES
// Keep the dashed red threshold lines in sync with the rolling window
// ═══════════════════════════════════════

function syncThresholdLines() {
  const sync = (chart, length, value) => {
    if (chart.data.datasets[1]) {
      chart.data.datasets[1].data = Array(length).fill(value);
    }
  };

  sync(tempChart,      labels.length, 50);
  sync(currentChart,   labels.length, 1.8);
  sync(vibrationChart, labels.length, 10);
}


// ═══════════════════════════════════════
// MAIN UPDATE  (called every 1 second)
// Fetches from API or falls back to simulation
// ═══════════════════════════════════════

async function updateDashboard() {
  let temperature, current, flow, vibration, failure_probability;

  try {
    // ── API CALL ──────────────────────────
    const apiURL = mode === "live"
      ? "https://fuel-dispenser.onrender.com/api/data"
      : "https://fuel-dispenser.onrender.com/api/demo";

    const response = await fetch(apiURL);
    const data     = await response.json();

    ({ temperature, current, flow, vibration } = data);
    failure_probability = data.failure_probability ?? Math.random();

  } catch (e) {
    // ── SIMULATION FALLBACK (API offline) ─
    temperature         = +(40 + Math.random() * 15).toFixed(1);
    current             = +(1  + Math.random() * 1.2).toFixed(2);
    flow                = +(2  + Math.random() * 12).toFixed(2);
    vibration           = +(Math.random() * 0.15).toFixed(3);
    failure_probability = Math.random() * 0.5;
  }

  // ── SENSOR VALUE TEXT ──────────────────
  document.getElementById("tempVal").textContent    = temperature;
  document.getElementById("currentVal").textContent = current;
  document.getElementById("flowVal").textContent    = flow;
  document.getElementById("vibVal").textContent     = vibration;

  // ── SENSOR PROGRESS BARS ───────────────
  document.getElementById("tempBar").style.width      = Math.min(100, temperature / 60 * 100) + "%";
  document.getElementById("currentBar").style.width   = Math.min(100, current    / 2  * 100) + "%";
  document.getElementById("flowBar").style.width      = Math.min(100, flow       / 20 * 100) + "%";
  document.getElementById("vibrationBar").style.width = Math.min(100, vibration  / 20 * 100) + "%";

  // ── SENSOR CARD COLOURS ────────────────
  setBox("tempBox",      temperature, 45,  50);
  setBox("currentBox",   current,     1.5, 1.8);
  setBox("vibrationBox", vibration,   10,  20);
  setFlowBox(flow);

  // ── HEALTH SCORE ───────────────────────
  updateHealth(temperature, current, flow, vibration);

  const hs = calculateHealthScore(temperature, current, flow, vibration);

  document.getElementById("healthBar").style.width = hs + "%";
  document.getElementById("healthBar").style.background =
    hs >= 80 ? "linear-gradient(90deg, var(--green),  var(--cyan))"   :
    hs >= 50 ? "linear-gradient(90deg, var(--yellow), var(--orange))" :
               "linear-gradient(90deg, var(--red),    var(--orange))";

  document.getElementById("healthScoreValue").textContent = hs + "%";
  document.getElementById("healthScoreBar").textContent   = hs + "%";

  // ── FAILURE PROBABILITY GAUGE ──────────
  const prob = +(failure_probability * 100).toFixed(1);

  gauge.data.datasets[0].data             = [prob, 100 - prob];
  gauge.data.datasets[0].backgroundColor[0] =
    prob < 30 ? "#00ff88" :
    prob < 60 ? "#ffcc00" :
                "#ff2244";
  gauge.update();

  document.getElementById("gaugeNum").textContent = prob.toFixed(0);
  document.getElementById("gaugeNum").style.color =
    prob < 30 ? "var(--green)"  :
    prob < 60 ? "var(--yellow)" :
                "var(--red)";

  // ── RUL ───────────────────────────────
  const rul = estimateRUL(temperature, 50);
  document.getElementById("rulValue").innerHTML = rul + '<span class="kpi-unit"> hr</span>';
  document.getElementById("rulBar").textContent = rul + " hr";

  // ── CHART ROLLING WINDOW ───────────────
  const t = getTime();
  labels.push(t);
  tempData.push(temperature);
  currentData.push(current);
  flowData.push(flow);
  vibrationData.push(vibration);

  if (labels.length > MAX_POINTS) {
    labels.shift();
    tempData.shift();
    currentData.shift();
    flowData.shift();
    vibrationData.shift();
  }

  // Keep threshold lines the right length then redraw
  syncThresholdLines();
  tempChart.update();
  currentChart.update();
  flowChart.update();
  vibrationChart.update();
}

// ═══════════════════════════════════════
// INITIAL VALUES (Dashboard starts with 0)
// ═══════════════════════════════════════

document.getElementById("tempVal").textContent = 0;
document.getElementById("currentVal").textContent = 0;
document.getElementById("flowVal").textContent = 0;
document.getElementById("vibVal").textContent = 0;

document.getElementById("healthScoreValue").textContent = "0%";
document.getElementById("gaugeNum").textContent = "0";
document.getElementById("rulValue").innerHTML = '0<span class="kpi-unit"> hr</span>';

// ── KICK OFF ──────────────────────────
setInterval(updateDashboard, 1000);
updateDashboard();
