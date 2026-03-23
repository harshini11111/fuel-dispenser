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

  document.getElementById("btn-live").classList.remove("active-mode");
  document.getElementById("btn-demo").classList.remove("active-mode");
  document.getElementById("btn-" + mode).classList.add("active-mode");

  if (mode === "live")
    showToast("⚡ LIVE MODE — ESP32 hardware data active");
  else
    showToast("🔵 DEMO MODE — Simulated random data active");
}


// ═══════════════════════════════════════
// DATABASE BUTTON — open data table page
// ═══════════════════════════════════════

function openDatabase() {
  window.location.href = "database.html";
}


// ═══════════════════════════════════════
// TOAST NOTIFICATION
// ═══════════════════════════════════════

function showToast(msg) {
  let toast = document.getElementById("toast");

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

let labels        = [];
let tempData      = [];
let currentData   = [];
let flowData      = [];
let vibrationData = [];
let faultHistory  = [];

const MAX_POINTS = 10;


// ═══════════════════════════════════════
// CHART FACTORY
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
      backgroundColor: lineColor + "18",
      tension: 0.4,
      pointRadius: 2,
      pointBackgroundColor: lineColor,
    },
  ];

  if (thresholdValue !== undefined) {
    datasets.push({
      label: "Threshold",
      data: [],
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

const tempChart      = createChart("tempChart",      "Temperature (°C)", tempData,      "#ff6666", 55);
const currentChart   = createChart("currentChart",   "Current (A)",       currentData,   "#ffcc00", 2.0);
const flowChart      = createChart("flowChart",       "Flow Rate (L/m)",  flowData,      "#00d4ff");
const vibrationChart = createChart("vibrationChart", "Vibration",         vibrationData, "#aa88ff", 2.0);


// ═══════════════════════════════════════
// FAILURE PROBABILITY GAUGE
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
// SENSOR CARD COLOUR
// ═══════════════════════════════════════

function setBox(boxId, value, warnLimit, critLimit) {
  const box = document.getElementById(boxId);
  box.classList.remove("green", "yellow", "red");

  const pillId = boxId.replace("Box", "Pill");
  const pill = document.getElementById(pillId);

  let cssClass, pillState;

  if (value <= warnLimit) {
    cssClass = "green";
    pillState = "ok";
  } else if (value <= critLimit) {
    cssClass = "yellow";
    pillState = "warn";
  } else {
    cssClass = "red";
    pillState = "crit";
  }

  box.classList.add(cssClass);

  if (pill) {
    pill.className = "sc-status-pill " + pillState;
    pill.textContent =
      pillState === "ok" ? "● NORMAL" :
      pillState === "warn" ? "▲ WARNING" :
      "⛔ CRITICAL";
  }
}
//=================================
//FLOW LOGIC
//=================================
function setFlowBox(flow) {
  const box  = document.getElementById("flowBox");
  const pill = document.getElementById("flowPill");

  box.classList.remove("green", "yellow", "red");

  if (flow < 1.5) {
    box.classList.add("red");
    if (pill) { pill.className = "sc-status-pill crit"; 
      pill.textContent = "⛔ CRITICAL"; }
  }
  else if (flow<2.5){
    box.classList.add("yellow");
    if (pill) {pill.className = "sc-status-pill warn"; 
      pill.textContent= "▲ WARNING"
    }
  } 
  else {
    box.classList.add("green");
    if (pill) { pill.className = "sc-status-pill ok";
      pill.textContent = "● NORMAL"; }
  }
}


// ═══════════════════════════════════════
// HEALTH SCORE
// ═══════════════════════════════════════

function calculateHealthScore(t, c, f, v) {
  let score = 100;

  if (t > 55) score -= 30; 
  else if (t > 45) score -= 15; 
  
  if (c > 2.0) score -= 25; 
  else if (c > 1.5) score -= 10; 
  
  if (f < 1.5) score -= 25; 
  else if (f < 2.5) score -= 10; 
  
  if (v > 2.0) score -= 20; 
  else if (v > 1.2) score -= 10; 
  
  return Math.max(score, 0);
 }


// ═══════════════════════════════════════
// ALERT TICKER
// ═══════════════════════════════════════

function updateAlertTicker(failures) {
  const txt = failures.length === 0
    ? "✅ System healthy — All parameters within safe limits"
    : failures.map(f => "⚠ " + f).join("  ·  ");

  document.getElementById("alertScroll").textContent      = txt;
  document.getElementById("alertScrollClone").textContent = txt;
}


// ═══════════════════════════════════════
// HEALTH DISPLAY
// ═══════════════════════════════════════

function updateHealth(t, c, f, v) {
  const failures = [];

  if (t > 55)           failures.push("TEMPERATURE SENSOR FAILURE");
  if (c > 2.0)          failures.push("MOTOR CURRENT OVERLOAD");
  if (f <= 1 || f > 15) failures.push("FLOW METER FAILURE");
  if (v > 2.0)           failures.push("PUMP BEARING FAILURE");

  const container = document.getElementById("healthText");
  container.innerHTML = "";

  if (failures.length > 0) {
    failures.forEach(fault => {
      const div = document.createElement("div");
      div.className = "failure-box";
      div.innerHTML = "⛔ " + fault;
      container.appendChild(div);

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
    div.className = "healthy-box";
    div.innerHTML = "✅ SYSTEM HEALTHY — All parameters within safe operating limits";
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
// RUL
// ═══════════════════════════════════════

function estimateRUL(value, threshold) {
  if (value >= threshold) return "0";
  return ((threshold - value) / 5).toFixed(1);
}


// ═══════════════════════════════════════
// THRESHOLD LINES
// ═══════════════════════════════════════

function syncThresholdLines() {
  const sync = (chart, length, value) => {
    if (chart.data.datasets[1]) {
      chart.data.datasets[1].data = Array(length).fill(value);
    }
  };

  sync(tempChart,      labels.length, 55);
  sync(currentChart,   labels.length, 2.0);
  sync(vibrationChart, labels.length, 2.0);
}


// ═══════════════════════════════════════
// MAIN UPDATE
// ═══════════════════════════════════════

async function updateDashboard() {
  let temperature, current, flow, vibration, failure_probability;

  try {
    const apiURL = mode === "live"
      ? "https://fuel-dispenser.onrender.com/api/data"
      : "https://fuel-dispenser.onrender.com/api/demo";

    const response = await fetch(apiURL);
    const data     = await response.json();

    ({ temperature, current, flow, vibration } = data);
    failure_probability = data.failure_probability ?? Math.random();

  } catch (e) {
    // Simulation fallback
    temperature         = +(30 + Math.random() * 40).toFixed(1);
    current             = +(0.5  + Math.random() * 2.5).toFixed(2);
    flow                = +(0  + Math.random() * 15).toFixed(2);
    vibration           = +(0.1 +Math.random() * 3.2).toFixed(3);
    failure_probability = Math.random() ;
  }

  // Sensor value text
  document.getElementById("tempVal").textContent    = temperature;
  document.getElementById("currentVal").textContent = current;
  document.getElementById("flowVal").textContent    = flow;
  document.getElementById("vibVal").textContent     = vibration;

  // Sensor progress bars
  document.getElementById("tempBar").style.width      = Math.min(100, temperature / 60 * 100) + "%";
  document.getElementById("currentBar").style.width   = Math.min(100, current    / 2  * 100) + "%";
  document.getElementById("flowBar").style.width      = Math.min(100, flow       / 20 * 100) + "%";
  document.getElementById("vibrationBar").style.width = Math.min(100, vibration  / 20 * 100) + "%";

  // Sensor card colours
  setBox("tempBox",      temperature, 45,  55);
  setBox("currentBox",   current,     1.5, 2.0);
  setBox("vibrationBox", vibration,   1.2,  2.0);
  setFlowBox(flow);

  // Health
  updateHealth(temperature, current, flow, vibration);

  const hs = calculateHealthScore(temperature, current, flow, vibration);

  document.getElementById("healthBar").style.width = hs + "%";
  document.getElementById("healthBar").style.background =
    hs >= 80 ? "linear-gradient(90deg, var(--green),  var(--cyan))"   :
    hs >= 50 ? "linear-gradient(90deg, var(--yellow), var(--orange))" :
               "linear-gradient(90deg, var(--red),    var(--orange))";

  document.getElementById("healthScoreValue").textContent = hs + "%";
  document.getElementById("healthScoreBar").textContent   = hs + "%";

  // Failure probability gauge
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

  // RUL
  const rul = estimateRUL(temperature, 50);
  document.getElementById("rulValue").innerHTML = rul + '<span class="kpi-unit"> hr</span>';
  document.getElementById("rulBar").textContent = rul + " hr";

  // Chart rolling window
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

  syncThresholdLines();
  tempChart.update();
  currentChart.update();
  flowChart.update();
  vibrationChart.update();
}

// ── INITIAL VALUES ─────────────────────
document.getElementById("tempVal").textContent    = 0;
document.getElementById("currentVal").textContent = 0;
document.getElementById("flowVal").textContent    = 0;
document.getElementById("vibVal").textContent     = 0;
document.getElementById("healthScoreValue").textContent = "0%";
document.getElementById("gaugeNum").textContent         = "0";
document.getElementById("rulValue").innerHTML = '0<span class="kpi-unit"> hr</span>';

// ── KICK OFF ───────────────────────────
setInterval(updateDashboard, 1000);
updateDashboard();
