// ================= MODE =================
let mode = "demo";

function setMode(newMode){

    mode = newMode;

    if(mode === "live")
        alert("LIVE MODE: ESP32 hardware data");

    if(mode === "demo")
        alert("DEMO MODE: Random simulated data");

}

// ================= TIME =================
function getTime() {
    return new Date().toLocaleTimeString();
}

// ================= DOM =================
const tempBox = document.getElementById("tempBox");
const currentBox = document.getElementById("currentBox");
const flowBox = document.getElementById("flowBox");
const vibrationBox = document.getElementById("vibrationBox");
const healthText = document.getElementById("healthText");
const healthBar = document.getElementById("healthBar");
const healthScoreValue = document.getElementById("healthScoreValue");
const rulValue = document.getElementById("rulValue");
const faultTable = document.querySelector("#faultTable tbody");

// ================= DATA =================
let labels = [];
let tempData = [];
let currentData = [];
let flowData = [];
let vibrationData = [];
let faultHistory = [];

const MAX_POINTS = 10;

// ================= CHART FUNCTION =================
function createChart(id,label,data,color){

return new Chart(document.getElementById(id),{

type:"line",

data:{
labels:labels,

datasets:[{
label:label,
data:data,
borderColor:color,
tension:0.4
}]
},

options:{responsive:true,animation:false}

});

}

// charts

const tempChart=createChart("tempChart","Temperature",tempData,"red");
const currentChart=createChart("currentChart","Current",currentData,"orange");
const flowChart=createChart("flowChart","Flow Rate",flowData,"blue");
const vibrationChart=createChart("vibrationChart","Vibration",vibrationData,"purple");

// ================= FAILURE PROBABILITY =================

const gauge=new Chart(document.getElementById("probabilityGauge"),{

type:"doughnut",

data:{
datasets:[{
data:[0,100],
backgroundColor:["#e53935","#333"]
}]
},

options:{
circumference:180,
rotation:270,
cutout:"70%",
plugins:{legend:{display:false}}
}

});

// ================= KPI COLORS =================

function setBox(box,value,greenLimit,redLimit){

box.classList.remove("green","yellow","red");

if(value<=greenLimit)
box.classList.add("green");

else if(value<=redLimit)
box.classList.add("yellow");

else
box.classList.add("red");

}

function setFlowBox(flow){

flowBox.classList.remove("green","yellow","red");

if(flow<=1||flow>15)
flowBox.classList.add("red");

else
flowBox.classList.add("green");

}

// ================= HEALTH SCORE =================

function calculateHealthScore(t,c,f,v){

let score=100;

if(t>50) score-=30;
if(c>1.8) score-=25;
if(f<=1||f>15) score-=25;
if(v>0.06) score-=20;

return Math.max(score,0);

}

// ================= HEALTH DISPLAY =================

function updateHealth(t,c,f,v){

let failures=[];

if(t>50) failures.push("TEMPERATURE SENSOR FAILURE");
if(c>1.8) failures.push("MOTOR CURRENT OVERLOAD");
if(f<=1||f>15) failures.push("FLOW METER FAILURE");
if(v>12) failures.push("PUMP BEARING FAILURE");

healthText.innerHTML="";
healthText.className="health-wrapper";

if(failures.length>0){

failures.forEach(fault=>{

const div=document.createElement("div");

div.className="failure-box";
div.innerText=fault;

healthText.appendChild(div);

faultHistory.push({

time:getTime(),
fault:fault

});

});

updateFaultTable();

}

else{

const div=document.createElement("div");

div.className="healthy-box";
div.innerText="SYSTEM HEALTHY";

healthText.appendChild(div);

}

}

// ================= FAULT TABLE =================

function updateFaultTable(){

faultTable.innerHTML="";

faultHistory.slice(-10).forEach(row=>{

const tr=document.createElement("tr");

tr.innerHTML=`<td>${row.time}</td><td>${row.fault}</td>`;

faultTable.appendChild(tr);

});

}

// ================= RUL =================

function estimateRUL(value,threshold){

if(value>=threshold) return "0";

return ((threshold-value)/5).toFixed(1);

}

// ================= UPDATE DASHBOARD =================

async function updateDashboard(){

let apiURL;

if(mode==="live")
apiURL="https://fuel-dispenser.onrender.com/api/data";

else
apiURL="https://fuel-dispenser.onrender.com/api/demo";

const response=await fetch(apiURL);
const data=await response.json();

const {temperature,current,flow,vibration}=data;
const failure_probability = data.failure_probability ?? Math.random();

tempBox.querySelector("h2").innerText=temperature+" °C";
currentBox.querySelector("h2").innerText=current+" A";
flowBox.querySelector("h2").innerText=flow+" L/min";
vibrationBox.querySelector("h2").innerText=vibration;

setBox(tempBox,temperature,45,50);
setBox(currentBox,current,1.5,1.8);
setFlowBox(flow);
setBox(vibrationBox,vibration,10,20);

updateHealth(temperature,current,flow,vibration);

const healthScore=calculateHealthScore(temperature,current,flow,vibration);

healthBar.style.width=healthScore+"%";
healthScoreValue.innerText=healthScore+"%";

const prob=failure_probability*100;

gauge.data.datasets[0].data=[prob,100-prob];
gauge.update();

rulValue.innerText=estimateRUL(temperature,50)+" Hours";

labels.push(getTime());

tempData.push(temperature);
currentData.push(current);
flowData.push(flow);
vibrationData.push(vibration);

if(labels.length>MAX_POINTS){

labels.shift();
tempData.shift();
currentData.shift();
flowData.shift();
vibrationData.shift();

}

tempChart.update();
currentChart.update();
flowChart.update();
vibrationChart.update();

}

setInterval(updateDashboard,1000);
updateDashboard();
