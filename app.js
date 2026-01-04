const STORAGE_KEY = "rn_tracker_v5";

// VASTE startdatum
const FIXED_START_DATE = "2026-01-05";

const DEFAULTS = {
  activeProfile: "Robin",
  startDate: FIXED_START_DATE,
  challengeLen: 75,
  profiles: {
    Robin: {
      waterGoal: 2000,
      calorieGoal: 2200,
      startWeight: null,
      days: {}
    },
    Noor: {
      waterGoal: 2000,
      calorieGoal: 1800,
      startWeight: null,
      days: {}
    }
  }
};

// iOS compat: structuredClone bestaat niet overal
function deepClone(obj){
  return JSON.parse(JSON.stringify(obj));
}


// ---------- helpers ----------
function isoDate(d){
  const x = new Date(d);
  // Zet op 12:00 om timezone "dag-terug" bugs te voorkomen (iOS)
  x.setHours(12,0,0,0);
  return x.toISOString().slice(0,10);
}
function parseISODate(s){
  const [y,m,dd] = s.split("-").map(Number);
  const d = new Date(y, m-1, dd);
  // 12:00 voorkomt dat de datum op iOS/UTC een dag verschuift
  d.setHours(12,0,0,0);
  return d;
}
function nowDateOnly(){
  const d = new Date();
  d.setHours(0,0,0,0);
  return d;
}
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => (t.style.display = "none"), 2000);
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return deepClone(DEFAULTS);
    const s = JSON.parse(raw);
    // merge defaults safely
    const st = deepClone(DEFAULTS);
    if (s && typeof s === "object") {
      Object.assign(st, s);
      st.startDate = FIXED_START_DATE; // altijd vast
      st.profiles = st.profiles || deepClone(DEFAULTS.profiles);
      for (const name of ["Robin","Noor"]) {
        st.profiles[name] = { ...deepClone(DEFAULTS.profiles[name]), ...(st.profiles[name] || {}) };
        st.profiles[name].days = st.profiles[name].days || {};
      }
    }
    return st;
  }catch{
    return deepClone(DEFAULTS);
  }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function dayIndexFor(date, startIso){
  const start = parseISODate(startIso);
  const target = parseISODate(isoDate(date));
  const diffDays = Math.floor((target - start) / (1000*60*60*24));
  return diffDays + 1; // dag 1 op startdatum
}
function dateForDayIndex(idx, startIso){
  const start = parseISODate(startIso);
  const d = new Date(start);
  d.setDate(d.getDate() + (idx - 1));
  return d;
}
function currentDayIndex(){
  return dayIndexFor(nowDateOnly(), state.startDate);
}
function isMonday(dateIso){
  return parseISODate(dateIso).getDay() === 1;
}

function getProfileName(){ return state.activeProfile; }
function getProfile(){ return state.profiles[getProfileName()]; }
function targetLen(){ return Number(state.challengeLen) || 75; }

// Fail-days tellen mee als “extra” dagen: elke FAIL schuift het einde 1 dag op.
function failCountForActive(){
  const prof = getProfile();
  let c = 0;
  for(const k in (prof.days || {})){
    const idx = Number(k);
    if(idx >= 1 && prof.days[k] && prof.days[k].failed) c++;
  }
  return c;
}
function effectiveLen(){
  return targetLen() + failCountForActive();
}

function defaultDayLog(dateIso){
  return {
    date: dateIso,
    // Robin-only
    pushupsSitups: false,
    instaMonday: false,
    // both
    steps: null,          // number >= 6000
    waterMl: 0,           // counter
    calories: null,       // number <= goal
    weightMonday: null,   // number monday only
    // Noor-only
    readingPages: null,   // number >= 10
    // meta
    completed: false,
    failed: false,
    completedAt: null,
    failedAt: null
  };
}

function getLogForDay(idx){
  const prof = getProfile();
  const k = String(idx);
  if (prof.days[k]) return prof.days[k];
  const dIso = isoDate(dateForDayIndex(idx, state.startDate));
  const fresh = defaultDayLog(dIso);
  prof.days[k] = fresh;
  return fresh;
}
function setLogForDay(idx, log){
  const prof = getProfile();
  prof.days[String(idx)] = log;
}

function calorieGoalForActive(){
  return Number(getProfile().calorieGoal);
}
function waterGoalForActive(){
  return Number(getProfile().waterGoal);
}

// ---------- tasks ----------
function activeTasks(profileName, log){
  const monday = isMonday(log.date);
  const waterGoal = waterGoalForActive();
  const calGoal = calorieGoalForActive();

  const tasks = [];

  if(profileName === "Robin"){
    tasks.push({ id:"pushupsSitups", label:"30 push-ups + 30 sit-ups", type:"checkbox", required:true });
  }
  if(profileName === "Noor"){
    tasks.push({ id:"pushupsSitups", label:"15 push-ups + 15 sit-ups", type:"checkbox", required:true });
  }

  tasks.push({ id:"steps", label:"Stappen", type:"number", required:true, goal:6000, unit:"stappen", mode:"gte" });

  tasks.push({ id:"waterMl", label:"Water", type:"counter", required:true, goal:waterGoal, unit:"ml" });

  tasks.push({ id:"calories", label:"Calorieën", type:"number", required:true, goal:calGoal, unit:"kcal", mode:"lte" });

  if(profileName === "Noor"){
    tasks.push({ id:"readingPages", label:"Lezen", type:"number", required:true, goal:10, unit:"pagina’s", mode:"gte" });
  }

  if(monday){
    tasks.push({ id:"weightMonday", label:"Maandag: gewicht", type:"number", required:true, unit:"kg", mondayOnly:true, mode:"present" });
    if(profileName === "Robin"){
      tasks.push({ id:"instaMonday", label:"Maandag: foto op Instagram geüpload", type:"checkbox", required:true, mondayOnly:true });
    }
  }

  return tasks;
}

function taskIsDone(task, log){
  const v = log[task.id];

  if(task.type === "checkbox") return !!v;

  if(task.type === "counter"){
    const n = Number(v) || 0;
    return n >= Number(task.goal);
  }

  if(task.type === "number"){
    if(v === null || v === "" || Number.isNaN(Number(v))) return false;
    const n = Number(v);
    if(task.mode === "present") return true;
    if(task.mode === "lte") return n <= Number(task.goal);
    if(task.mode === "gte") return n >= Number(task.goal);
    return true;
  }

  return false;
}

function progressFor(profileName, log){
  const tasks = activeTasks(profileName, log).filter(t => t.required);
  const done = tasks.filter(t => taskIsDone(t, log)).length;
  return { done, total: tasks.length, allDone: done === tasks.length, tasks };
}

// ---------- UI ----------
let state = loadState();
let selectedDay = null;

const el = (id) => document.getElementById(id);

// Tabs
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    showView(btn.dataset.view);
  });
});

function showView(view){
  ["today","calendar","stats","settings"].forEach(v => {
    el(`view-${v}`).classList.toggle("hidden", v !== view);
  });
  if(view === "today") renderToday();
  if(view === "calendar") renderCalendar();
  if(view === "stats") renderStats();
  if(view === "settings") renderSettings();
}

function headerUpdate(){
  const idx = currentDayIndex();
  const p = getProfileName();
  const start = parseISODate(state.startDate);
  const today = nowDateOnly();

  if (today < start) {
    el("headerSubtitle").textContent = `${p} • Start op ${start.toLocaleDateString("nl-NL")}`;
  } else {
    el("headerSubtitle").textContent = `${p} • Vandaag dag ${clamp(idx,1,effectiveLen())}/${effectiveLen()}`;
  }
}

// Typen zonder “stoppen”: we updaten storage zonder rerender
function patchLogQuiet(idx, patch){
  const log = getLogForDay(idx);
  setLogForDay(idx, { ...log, ...patch });
  saveState();
}
// acties (checkbox/buttons/blur): wél rerender
function patchLogRender(idx, patch){
  patchLogQuiet(idx, patch);
  renderToday(idx);
  if(!el("view-calendar").classList.contains("hidden")) renderCalendar();
}

function getActiveDayIndexForTodayView(){
  // Als user via kalender een dag opent: gebruik selectedDay
  // Anders: altijd echte huidige dag (obv startDate)
  return clamp(selectedDay ?? currentDayIndex(), 0, effectiveLen());
}

function renderToday(forcedIdx=null){
  headerUpdate();

  let idx = forcedIdx ?? getActiveDayIndexForTodayView();
  idx = clamp(idx, 0, effectiveLen());

  const log = getLogForDay(idx);
  const d = parseISODate(log.date);
  const profileName = getProfileName();

  const totalLen = effectiveLen();

  // Voor de start (idx 0): toon datum, maar geen challenge-acties
  if(idx < 1){
    el("progressBadge").textContent = "—";
    el("tasksContainer").innerHTML = "";
    el("profileHeading").textContent = `Profiel: ${profileName} • (vandaag)`;

    const completeBtn = el("completeDayBtn");
    completeBtn.disabled = true;
    completeBtn.classList.remove("ready","done");
    el("failDayBtn").disabled = true;

    el("todayHint").textContent = `Start is morgen (${parseISODate(state.startDate).toLocaleDateString("nl-NL")}).`;
    return;
  }

  el("dayHeading").textContent = (idx >= 1)
    ? `Dag ${idx} / ${effectiveLen()}`
    : `Vandaag (voor start)`;
  el("dateHeading").textContent = d.toLocaleDateString("nl-NL", { weekday:"long", year:"numeric", month:"long", day:"numeric" });

  const todayIdx = currentDayIndex();
  const rel = idx === todayIdx ? "• (vandaag)" : idx === todayIdx + 1 ? "• (morgen)" : idx > todayIdx ? "• (toekomst)" : "• (eerder)";
  el("profileHeading").textContent = `Profiel: ${profileName} ${rel}`;

  const prog = progressFor(profileName, log);
  el("progressBadge").textContent = `${prog.done}/${prog.total}`;

  renderTasks(idx, log, prog.tasks, profileName);

  const alreadyDone = !!log.completed;
  const alreadyFail = !!log.failed;

  const completeBtn = el("completeDayBtn");
  const canComplete = prog.allDone && !alreadyDone && !alreadyFail;

  completeBtn.disabled = !canComplete;
  completeBtn.classList.toggle("ready", canComplete);
  completeBtn.classList.toggle("done", alreadyDone);

  const hint = el("todayHint");
  if(alreadyFail) hint.textContent = "Deze dag staat op FAIL.";
  else if(alreadyDone) hint.textContent = "Deze dag is afgerond.";
  else if(!prog.allDone) hint.textContent = "Maak alle taken compleet om af te ronden.";
  else hint.textContent = "Alles compleet — je kunt afronden.";
}

function renderTasks(idx, log, tasks, profileName){
  const wrap = el("tasksContainer");
  wrap.innerHTML = "";

  tasks.forEach(task => {
    const done = taskIsDone(task, log);

    const row = document.createElement("div");
    row.className = `taskRow ${done ? "done":"open"}`;

    const top = document.createElement("div");
    top.className = "taskTop";

    const title = document.createElement("div");
    title.className = "taskTitle";
    title.textContent = task.label;

    const meta = document.createElement("div");
    meta.className = "taskMeta";

    if(task.mondayOnly){
      const t = document.createElement("div");
      t.className = "tag monday";
      t.textContent = "Maandag";
      meta.appendChild(t);
    }

    if(task.type === "counter"){
      const t = document.createElement("div");
      t.className = "tag goal";
      t.textContent = `≥ ${task.goal} ${task.unit}`;
      meta.appendChild(t);
    }
    if(task.type === "number" && task.mode === "lte"){
      const t = document.createElement("div");
      t.className = "tag goal";
      t.textContent = `≤ ${task.goal} ${task.unit}`;
      meta.appendChild(t);
    }
    if(task.type === "number" && task.mode === "gte"){
      const t = document.createElement("div");
      t.className = "tag goal";
      t.textContent = `≥ ${task.goal} ${task.unit}`;
      meta.appendChild(t);
    }

    const st = document.createElement("div");
    st.className = "tag";
    st.textContent = done ? "✅ gehaald" : "⬜ open";
    meta.appendChild(st);

    top.appendChild(title);
    top.appendChild(meta);
    row.appendChild(top);

    const control = document.createElement("div");

    if(task.type === "checkbox"){
      const lab = document.createElement("label");
      lab.className = "check";
      lab.innerHTML = `<input type="checkbox" ${log[task.id] ? "checked":""} /> <span>Afvinken</span>`;
      const cb = lab.querySelector("input");
      cb.addEventListener("change", () => patchLogRender(idx, { [task.id]: cb.checked }));
      control.appendChild(lab);
    }

    if(task.type === "counter"){
      const n = Number(log[task.id]) || 0;

      const line = document.createElement("div");
      line.className = "muted small";
      line.textContent = `${n} ml / ${task.goal} ml`;
      control.appendChild(line);

      const pr = document.createElement("progress");
      pr.max = Number(task.goal);
      pr.value = n;
      pr.style.margin = "8px 0";
      control.appendChild(pr);

      const btns = document.createElement("div");
      btns.className = "row wrap gap8";

      const mk = (txt, delta, ghost=false) => {
        const b = document.createElement("button");
        b.className = ghost ? "btn ghost" : "btn";
        b.textContent = txt;
        b.addEventListener("click", () => {
          const cur = Number(getLogForDay(idx)[task.id]) || 0;
          if(delta === null) patchLogRender(idx, { [task.id]: 0 });
          else patchLogRender(idx, { [task.id]: clamp(cur + delta, 0, 20000) });
        });
        return b;
      };

      btns.appendChild(mk("+250", 250));
      btns.appendChild(mk("+500", 500));
      btns.appendChild(mk("+1000", 1000));
      btns.appendChild(mk("Reset", null, true));
      control.appendChild(btns);
    }

    if(task.type === "number"){
      const input = document.createElement("input");
      input.className = "input";
      input.type = "number";
      input.inputMode = "numeric";
      input.pattern = (task.id === "weightMonday") ? "[0-9]*[.]?[0-9]*" : "[0-9]*";
      input.step = task.id === "weightMonday" ? "0.1" : "1";
      input.min = "0";
      input.placeholder = task.unit ? `Vul in (${task.unit})` : "Vul in";
      input.value = (log[task.id] ?? "") === null ? "" : String(log[task.id] ?? "");

      // tijdens typen: geen rerender
      input.addEventListener("input", () => {
        const raw = input.value;
        patchLogQuiet(idx, { [task.id]: raw === "" ? null : Number(raw) });

        // UI mini-update: progress + afrondknop
        const p = progressFor(profileName, getLogForDay(idx));
        el("progressBadge").textContent = `${p.done}/${p.total}`;

        const alreadyDone = !!getLogForDay(idx).completed;
        const alreadyFail = !!getLogForDay(idx).failed;
        const canComplete = p.allDone && !alreadyDone && !alreadyFail;

        const completeBtn = el("completeDayBtn");
        completeBtn.disabled = !canComplete;
        completeBtn.classList.toggle("ready", canComplete);
        completeBtn.classList.toggle("done", alreadyDone);
      });

      // bij blur: status-tags meteen correct
      input.addEventListener("blur", () => renderToday(idx));

      control.appendChild(input);

      const help = document.createElement("div");
      help.className = "muted small";
      help.style.marginTop = "6px";
      if(task.mode === "lte") help.textContent = `Onder of gelijk aan ${task.goal} kcal is goed.`;
      else if(task.mode === "gte") help.textContent = `Minimaal ${task.goal} ${task.unit}.`;
      else if(task.mode === "present") help.textContent = `Alleen invullen op maandag.`;
      control.appendChild(help);
    }

    row.appendChild(control);
    wrap.appendChild(row);
  });
}

// ---------- Calendar ----------
function renderCalendar(){
  headerUpdate();

  const grid = el("calendarGrid");
  grid.innerHTML = "";

  const todayIdx = currentDayIndex();

  for(let i=1; i<=effectiveLen(); i++){
    const log = getLogForDay(i);
    const d = parseISODate(log.date);

    const cell = document.createElement("div");
    cell.className = "dayCell";

    if(log.completed) cell.classList.add("done");
    if(log.failed) cell.classList.add("fail");
    if(i > todayIdx) cell.classList.add("future");
    if(selectedDay === i) cell.classList.add("selected");

    cell.innerHTML = `
      <div class="n">#${i}</div>
      <div class="d">${String(d.getDate()).padStart(2,"0")}-${String(d.getMonth()+1).padStart(2,"0")}</div>
    `;

    cell.addEventListener("click", () => {
      selectedDay = i;
      renderCalendar();
      updateSelectedInfo();
    });

    grid.appendChild(cell);
  }

  updateSelectedInfo();
}

function updateSelectedInfo(){
  const info = el("selectedDayInfo");
  const openBtn = el("openSelectedInTodayBtn");
  const clearBtn = el("clearSelectedBtn");

  if(!selectedDay){
    info.textContent = "Geen geselecteerde dag.";
    openBtn.disabled = true;
    clearBtn.disabled = true;
    return;
  }

  const log = getLogForDay(selectedDay);
  const d = parseISODate(log.date);
  const p = progressFor(getProfileName(), log);

  info.textContent = `Dag ${selectedDay} — ${d.toLocaleDateString("nl-NL")} — ${p.done}/${p.total} — ` +
    (log.completed ? "AFGEROND" : log.failed ? "FAIL" : "OPEN");

  openBtn.disabled = false;
  clearBtn.disabled = false;
}

// ---------- Stats ----------
function renderStats(){
  headerUpdate();
  el("profileBadge").textContent = getProfileName();

  const todayIdx = currentDayIndex();
  const idx = clamp(todayIdx, 0, effectiveLen());
  el("statDay").textContent = String(idx < 1 ? 0 : idx);

  let completed = 0;
  for(let i=1; i<=effectiveLen(); i++){
    if(getLogForDay(i).completed) completed++;
  }
  el("statCompleted").textContent = `${completed}/${targetLen()}`;
  el("statPercent").textContent = `${Math.round((completed/targetLen())*100)}%`;

  let streak = 0;
  for(let i = clamp(todayIdx,1,effectiveLen()); i>=1; i--){
    const log = getLogForDay(i);
    if(log.completed) streak++;
    else break;
  }
  el("statStreak").textContent = String(streak);

  el("profileStatsTitle").textContent = `${getProfileName()} — stats`;
  const box = el("profileStats");
  box.innerHTML = "";

  const prof = getProfile();

  let stepsTotal = 0, stepsDays = 0;
  let waterTotal = 0, waterDays = 0;
  let calTotal = 0, calDays = 0;
  let pagesTotal = 0, pagesDays = 0;

  const mondayWeights = [];

  for(let i=1; i<=effectiveLen(); i++){
    const log = getLogForDay(i);

    if(log.steps !== null && !Number.isNaN(Number(log.steps))){
      stepsTotal += Number(log.steps);
      stepsDays++;
    }

    if((Number(log.waterMl)||0) > 0){
      waterTotal += Number(log.waterMl)||0;
      waterDays++;
    }

    if(log.calories !== null && !Number.isNaN(Number(log.calories))){
      calTotal += Number(log.calories);
      calDays++;
    }

    if(getProfileName() === "Noor"){
      if(log.readingPages !== null && !Number.isNaN(Number(log.readingPages))){
        pagesTotal += Number(log.readingPages);
        pagesDays++;
      }
    }

    if(isMonday(log.date) && log.weightMonday !== null && !Number.isNaN(Number(log.weightMonday))){
      mondayWeights.push({ date: log.date, w: Number(log.weightMonday) });
    }
  }

  const lines = [];
  lines.push(["Totaal stappen", stepsDays ? String(stepsTotal) : "—"]);
  lines.push(["Gem. stappen", stepsDays ? String(Math.round(stepsTotal / stepsDays)) : "—"]);
  lines.push(["Water gemiddeld", waterDays ? `${Math.round(waterTotal / waterDays)} ml` : "—"]);
  lines.push(["Gem. calorieën", calDays ? `${Math.round(calTotal / calDays)} kcal` : "—"]);

  if(getProfileName() === "Noor"){
    lines.push(["Totaal pagina’s", pagesDays ? String(pagesTotal) : "—"]);
    lines.push(["Gem. pagina’s", pagesDays ? String(Math.round(pagesTotal / pagesDays)) : "—"]);
  }

  // Gewicht: alleen "Afgevallen sinds start"
  const startW = (prof.startWeight !== null && !Number.isNaN(Number(prof.startWeight)))
    ? Number(prof.startWeight)
    : null;

  if (startW === null) {
    lines.push(["Afgevallen sinds start", "Vul startgewicht in bij Settings"]);
  } else {
    if (mondayWeights.length) {
      const last = mondayWeights[mondayWeights.length - 1].w;
      const delta = Math.round((startW - last) * 10) / 10; // positief = afgevallen
      lines.push(["Afgevallen sinds start", `${delta >= 0 ? "" : "+"}${delta} kg`]);
    } else {
      lines.push(["Afgevallen sinds start", "Nog geen maandag-gewicht ingevuld"]);
    }
  }

  lines.forEach(([k,v]) => {
    const div = document.createElement("div");
    div.className = "statLine";
    div.innerHTML = `<div>${k}</div><span>${v}</span>`;
    box.appendChild(div);
  });
}

// ---------- Settings ----------
function renderSettings(){
  headerUpdate();

  el("profileSelect").value = state.activeProfile;
  const prof = getProfile();
  el("waterGoal").value = String(prof.waterGoal);
  el("calGoal").value = String(prof.calorieGoal);
  el("startWeight").value = (prof.startWeight ?? "") === null ? "" : String(prof.startWeight ?? "");
}

// ---------- Events ----------
function bindEvents(){
  // top nav for days
  el("todayBtn").addEventListener("click", () => { selectedDay = null; renderToday(); });
  el("prevDayBtn").addEventListener("click", () => {
    const idx = getActiveDayIndexForTodayView();
    selectedDay = clamp(idx - 1, 0, effectiveLen());
    renderToday(selectedDay);
  });
  el("nextDayBtn").addEventListener("click", () => {
    const idx = getActiveDayIndexForTodayView();
    selectedDay = clamp(idx + 1, 0, effectiveLen());
    renderToday(selectedDay);
  });

  // complete/fail
  el("completeDayBtn").addEventListener("click", () => {
    const idx = getActiveDayIndexForTodayView();
    const log = getLogForDay(idx);
    const prog = progressFor(getProfileName(), log);

    if(!prog.allDone) return toast("Nog niet alles compleet");
    if(log.failed) return toast("Dag staat op FAIL");

    setLogForDay(idx, { ...log, completed:true, failed:false, completedAt:new Date().toISOString() });
    saveState();
    renderToday(idx);
    toast("Dag afgerond ✅");
  });

  el("failDayBtn").addEventListener("click", () => {
    const idx = getActiveDayIndexForTodayView();
    if(idx < 1) return toast("Start is morgen — vandaag kan geen FAIL zijn.");
    if(!confirm("Fail Day markeren?")) return;

    const log = getLogForDay(idx);
    setLogForDay(idx, { ...log, failed:true, completed:false, failedAt:new Date().toISOString() });
    saveState();
    renderToday(idx);
    toast("Fail opgeslagen");
  });

  // Calendar
  el("jumpTodayBtn").addEventListener("click", () => {
    const idx = currentDayIndex();
    if(idx < 1){
      selectedDay = null;
      renderCalendar();
      return toast(`Vandaag is ${new Date().toLocaleDateString("nl-NL")} — kalender start morgen.`);
    }
    selectedDay = clamp(idx, 1, effectiveLen());
    renderCalendar();
  });

  el("openSelectedInTodayBtn").addEventListener("click", () => {
    if(!selectedDay) return;
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelector('.tab[data-view="today"]').classList.add("active");
    showView("today");
    renderToday(selectedDay);
    toast(`Open dag ${selectedDay}`);
  });

  el("clearSelectedBtn").addEventListener("click", () => {
    if(!selectedDay) return;
    if(!confirm(`Data van dag ${selectedDay} wissen?`)) return;
    const dIso = isoDate(dateForDayIndex(selectedDay, state.startDate));
    setLogForDay(selectedDay, defaultDayLog(dIso));
    saveState();
    renderCalendar();
    toast("Dag gewist");
  });

  // Settings: profile switch (ook meteen andere waarden)
  el("profileSelect").addEventListener("change", () => {
    state.activeProfile = el("profileSelect").value;
    saveState();
    selectedDay = null;
    renderSettings();
    renderToday();
  });

  el("saveSettingsBtn").addEventListener("click", () => {    const prof = getProfile();
    prof.waterGoal = clamp(Number(el("waterGoal").value || 2000), 0, 20000);
    prof.calorieGoal = clamp(Number(el("calGoal").value || (state.activeProfile==="Robin"?2200:1800)), 0, 10000);

    const swRaw = el("startWeight").value;
    prof.startWeight = (swRaw === "" ? null : Number(swRaw));

    saveState();
    toast("Instellingen opgeslagen");
    renderToday();
  });

  // Wipe
  el("wipeAllBtn").addEventListener("click", () => {
    if(!confirm("Alles wissen?")) return;
    state = deepClone(DEFAULTS);
    state.challengeLen = 75;
    saveState();
    selectedDay = null;
    toast("Alles gewist");
    renderToday();
  });
}

// ---------- boot ----------
function boot(){
  bindEvents();
  showView("today");
  renderToday();
}
boot();
