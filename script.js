// ============ Storage ============
const KEY = "tj.trades.v1";
let trades = load();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(trades)); } catch { /* storage unavailable */ }
}

// ============ Helpers ============
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (v, sign = false) => {
  const s = Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD" });
  if (!sign) return v < 0 ? "−" + s : s;
  return (v > 0 ? "+" : v < 0 ? "−" : "") + s;
};
const compact = (v) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? "$" + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + "k" : "$" + a.toFixed(0);
  return (v > 0 ? "+" : v < 0 ? "−" : "") + s;
};
const pct = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2) + "%";
const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
const pnlOf = (t) => (t.side === "short" ? t.entry - t.exit : t.exit - t.entry) * t.shares - (t.fees || 0);
const retOf = (t) => { const n = t.entry * t.shares; return n ? (pnlOf(t) / n) * 100 : 0; };
const sorted = () => [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

// ============ Stats ============
function stats() {
  const list = sorted();
  const pnls = list.map(pnlOf);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const net = pnls.reduce((a, b) => a + b, 0);
  const grossW = wins.reduce((a, b) => a + b, 0);
  const grossL = Math.abs(losses.reduce((a, b) => a + b, 0));
  let cum = 0, peak = 0, maxDD = 0;
  pnls.forEach((p) => { cum += p; peak = Math.max(peak, cum); maxDD = Math.min(maxDD, cum - peak); });
  let streak = 0;
  for (let i = pnls.length - 1; i >= 0; i--) {
    const s = Math.sign(pnls[i]);
    if (!s) break;
    if (streak === 0 || Math.sign(streak) === s) streak += s; else break;
  }
  return { list, pnls, wins, losses, net, grossW, grossL, maxDD, streak, n: list.length };
}

function renderKpis(s) {
  $("kNet").textContent = money(s.net, true);
  $("kNet").className = "big " + tone(s.net);
  $("kNetSub").textContent = s.n ? `${s.n} trade${s.n > 1 ? "s" : ""}` : "";

  const decided = s.wins.length + s.losses.length;
  const wr = decided ? (s.wins.length / decided) * 100 : 0;
  $("kWin").textContent = decided ? wr.toFixed(1) + "%" : "—";
  $("kWinSub").textContent = decided ? `${s.wins.length}W ${s.losses.length}L` : "";

  $("kPF").textContent = s.grossL ? (s.grossW / s.grossL).toFixed(2) : s.grossW ? "∞" : "—";
  $("kPF").className = s.grossL ? (s.grossW / s.grossL >= 1 ? "up" : "down") : "";

  const exp = s.n ? s.net / s.n : 0;
  $("kExp").textContent = s.n ? money(exp, true) : "—";
  $("kExp").className = tone(exp);

  $("kDD").textContent = s.n ? money(s.maxDD, true) : "—";
  $("kDD").className = s.maxDD < 0 ? "down" : "";

  const avgW = s.wins.length ? s.grossW / s.wins.length : 0;
  const avgL = s.losses.length ? s.grossL / s.losses.length : 0;
  $("kAvg").innerHTML = s.n ? `<span class="up">${money(avgW, true)}</span> / <span class="down">${money(-avgL, true)}</span>` : "—";
  $("kAvgSub").textContent = avgL ? `Payoff ${(avgW / avgL).toFixed(2)}` : "";

  $("kStreak").textContent = s.streak ? `${Math.abs(s.streak)}${s.streak > 0 ? "W" : "L"}` : "—";
  $("kStreak").className = tone(s.streak);

  $("tradeCount").textContent = s.n ? String(s.n) : "";
}

// ============ Ticker tape ============
function renderTape() {
  const byTicker = {};
  trades.forEach((t) => {
    const k = t.ticker;
    byTicker[k] = byTicker[k] || { net: 0, n: 0, ret: 0 };
    byTicker[k].net += pnlOf(t);
    byTicker[k].ret += retOf(t);
    byTicker[k].n++;
  });
  const items = Object.entries(byTicker).sort((a, b) => b[1].net - a[1].net);
  const html = items.length
    ? items.map(([k, v]) => `<span class="tk"><b>${esc(k)}</b><span class="${tone(v.net)}">${v.net >= 0 ? "▲" : "▼"} ${money(v.net, true)}</span><span class="n">${v.n} trade${v.n > 1 ? "s" : ""}</span></span>`).join("")
    : `<span class="tk muted">No trades</span>`;
  // Repeat enough times to fill wide screens, then double for a seamless loop
  const reps = Math.max(2, Math.ceil(12 / Math.max(1, items.length)));
  const half = html.repeat(reps);
  $("tape").innerHTML = half + half;
  $("tape").style.setProperty("--dur", Math.max(25, reps * Math.max(1, items.length) * 4) + "s");
}

// ============ Equity chart ============
const NS = "http://www.w3.org/2000/svg";
let chartState = null;
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function niceTicks(min, max, count = 6) {
  const span = max - min || 1;
  const raw = span / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  const end = Math.ceil(max / step) * step;
  for (let v = Math.floor(min / step) * step; v <= end + step * 0.001; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

function renderChart(s) {
  const svg = $("chart");
  svg.innerHTML = "";
  $("chartEmpty").hidden = s.n > 0;
  if (!s.n) { chartState = null; $("chartLegend").textContent = ""; return; }

  const W = $("chartWrap").clientWidth, H = $("chartWrap").clientHeight;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const m = { t: 16, r: 74, b: 26, l: 12 };

  let cum = 0;
  const data = [{ i: 0, cum: 0, t: null, p: 0 }];
  s.list.forEach((t, i) => { const p = pnlOf(t); cum += p; data.push({ i: i + 1, cum, t, p }); });
  const ticks = niceTicks(Math.min(0, ...data.map((d) => d.cum)), Math.max(0, ...data.map((d) => d.cum)));
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const x = (i) => m.l + (i / (data.length - 1)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - m.t - m.b);
  const color = cum >= 0 ? "var(--up)" : "var(--down)";
  const hex = cum >= 0 ? "#22c55e" : "#ef4444";

  const defs = el("defs", {}, svg);
  const lg = el("linearGradient", { id: "eqfill", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el("stop", { offset: 0, "stop-color": hex, "stop-opacity": 0.12 }, lg);
  el("stop", { offset: 1, "stop-color": hex, "stop-opacity": 0 }, lg);

  const grid = el("g", { class: "grid" }, svg);
  const axis = el("g", { class: "axis" }, svg);
  ticks.forEach((v) => {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, grid);
    const t = el("text", { x: W - m.r + 8, y: y(v) + 4 }, axis);
    t.textContent = compact(v).replace("+", "");
  });
  // vertical grid + date labels (up to 6)
  const nLabels = Math.min(6, data.length - 1);
  for (let k = 0; k <= nLabels; k++) {
    const idx = Math.max(1, Math.round((k / nLabels) * (data.length - 1)));
    const xi = x(idx);
    el("line", { x1: xi, x2: xi, y1: m.t, y2: H - m.b }, grid);
    if (k > 0 || nLabels === 0) {
      const t = el("text", { x: xi, y: H - 8, "text-anchor": k === nLabels ? "end" : "middle" }, axis);
      t.textContent = data[idx].t.date.slice(5);
    }
  }
  el("line", { class: "zero", x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }, svg);

  const pts = data.map((d) => [x(d.i), y(d.cum)]);
  const path = "M" + pts.map((p) => p.join(",")).join(" L");
  el("path", { d: `${path} L${pts[pts.length - 1][0]},${y(yMin)} L${pts[0][0]},${y(yMin)} Z`, fill: "url(#eqfill)" }, svg);
  el("path", { d: path, class: "line", stroke: color }, svg);

  // last-value tag on the price scale
  const last = pts[pts.length - 1];
  el("line", { x1: m.l, x2: W - m.r, y1: last[1], y2: last[1], stroke: hex, "stroke-opacity": 0.35, "stroke-dasharray": "2 3" }, svg);
  const lt = el("g", { class: "tag last-tag" }, svg);
  el("rect", { x: W - m.r + 2, y: last[1] - 9, width: m.r - 4, height: 18, fill: hex }, lt);
  el("text", { x: W - m.r + 8, y: last[1] + 4 }, lt).textContent = compact(cum);
  el("circle", { cx: last[0], cy: last[1], r: 3.5, fill: hex }, svg);

  // crosshair layer
  const xh = el("g", { visibility: "hidden" }, svg);
  const vx = el("line", { class: "xh", y1: m.t, y2: H - m.b }, xh);
  const hy = el("line", { class: "xh", x1: m.l, x2: W - m.r }, xh);
  const mk = el("circle", { class: "marker", r: 5, fill: hex }, xh);
  const yTag = el("g", { class: "tag" }, xh);
  const yRect = el("rect", { x: W - m.r + 2, width: m.r - 4, height: 18, fill: "#e7e9ec" }, yTag);
  const yText = el("text", { x: W - m.r + 8 }, yTag);
  const xTag = el("g", { class: "tag" }, xh);
  const xRect = el("rect", { y: H - m.b + 4, width: 76, height: 18, fill: "#e7e9ec" }, xTag);
  const xText = el("text", { y: H - m.b + 17, "text-anchor": "middle" }, xTag);

  chartState = { data, x, y, m, W, xh, vx, hy, mk, yRect, yText, xRect, xText };
  setLegend(null, s);
}

function setLegend(d, s) {
  const L = $("chartLegend");
  if (!d) {
    const st = s || stats();
    L.innerHTML = st.n ? `<span>Last <b class="${tone(st.net)}">${money(st.net, true)}</b></span><span>Max DD <b>${money(st.maxDD, true)}</b></span>` : "";
    return;
  }
  L.innerHTML = `<span><b>#${d.i}</b> ${esc(d.t.date)} <b>${esc(d.t.ticker)}</b> ${d.t.side.toUpperCase()}</span><span>Trade <b class="${tone(d.p)}">${money(d.p, true)}</b></span><span>Equity <b class="${tone(d.cum)}">${money(d.cum, true)}</b></span>`;
}

$("chartWrap").addEventListener("pointermove", (e) => {
  if (!chartState) return;
  const c = chartState;
  const r = $("chartWrap").getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - r.left - c.m.l) / (c.W - c.m.l - c.m.r)));
  const d = c.data[Math.max(1, Math.round(frac * (c.data.length - 1)))];
  const px = c.x(d.i), py = c.y(d.cum);
  c.xh.setAttribute("visibility", "visible");
  c.vx.setAttribute("x1", px); c.vx.setAttribute("x2", px);
  c.hy.setAttribute("y1", py); c.hy.setAttribute("y2", py);
  c.mk.setAttribute("cx", px); c.mk.setAttribute("cy", py);
  c.yRect.setAttribute("y", py - 9); c.yText.setAttribute("y", py + 4); c.yText.textContent = compact(d.cum);
  const xx = Math.min(Math.max(px, c.m.l + 38), c.W - c.m.r - 38);
  c.xRect.setAttribute("x", xx - 38); c.xText.setAttribute("x", xx); c.xText.textContent = d.t.date;
  setLegend(d);
});
$("chartWrap").addEventListener("pointerleave", () => { if (chartState) { chartState.xh.setAttribute("visibility", "hidden"); setLegend(null); } });

// ============ P&L calendar ============
let calMonth = null; // Date set to the 1st of the shown month
function renderCalendar() {
  if (!calMonth) {
    const latest = sorted().at(-1);
    const d = latest ? new Date(latest.date + "T00:00:00") : new Date();
    calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  }
  const yr = calMonth.getFullYear(), mo = calMonth.getMonth();
  const prefix = `${yr}-${String(mo + 1).padStart(2, "0")}`;
  const byDay = {};
  trades.filter((t) => t.date.startsWith(prefix)).forEach((t) => {
    const k = +t.date.slice(8, 10);
    byDay[k] = byDay[k] || { net: 0, n: 0 };
    byDay[k].net += pnlOf(t);
    byDay[k].n++;
  });
  const vals = Object.values(byDay);
  const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v.net)));
  const total = vals.reduce((a, v) => a + v.net, 0);
  const greenDays = vals.filter((v) => v.net > 0).length, redDays = vals.filter((v) => v.net < 0).length;

  $("calMonth").textContent = calMonth.toLocaleDateString("en-US", { month: "short", year: "numeric" }).toUpperCase();
  $("calTotal").innerHTML = vals.length ? `<span class="${tone(total)}">${money(total, true)}</span> ${greenDays}/${redDays}` : "";

  const todayStr = new Date().toISOString().slice(0, 10);
  const lead = (new Date(yr, mo, 1).getDay() + 6) % 7; // Monday-first
  const days = new Date(yr, mo + 1, 0).getDate();
  let html = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="dow">${d}</div>`).join("");
  html += '<div class="day blank"></div>'.repeat(lead);
  for (let d = 1; d <= days; d++) {
    const v = byDay[d];
    const iso = `${prefix}-${String(d).padStart(2, "0")}`;
    let style = "", cls = "day";
    if (v) {
      const a = 0.08 + 0.42 * (Math.abs(v.net) / maxAbs);
      style = `background: rgba(${v.net >= 0 ? "34, 197, 94" : "239, 68, 68"}, ${a.toFixed(2)})`;
      cls += v.net > 0 ? " pos" : v.net < 0 ? " neg" : "";
    }
    if (iso === todayStr) cls += " today";
    html += `<div class="${cls}" style="${style}" title="${v ? `${iso}: ${money(v.net, true)} over ${v.n} trade${v.n > 1 ? "s" : ""}` : iso}">
      <span class="d">${d}</span>
      ${v ? `<span class="v">${compact(v.net)}</span><span class="c">${v.n} tr</span>` : ""}
    </div>`;
  }
  $("cal").innerHTML = html;
}
$("calPrev").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); });
$("calNext").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); });

// ============ P&L by setup ============
function renderSetups() {
  const by = {};
  trades.forEach((t) => {
    by[t.setup] = by[t.setup] || { net: 0, n: 0, w: 0 };
    const p = pnlOf(t);
    by[t.setup].net += p; by[t.setup].n++; if (p > 0) by[t.setup].w++;
  });
  const rows = Object.entries(by).sort((a, b) => b[1].net - a[1].net);
  if (!rows.length) { $("setups").innerHTML = '<p class="none">No trades</p>'; return; }
  const maxAbs = Math.max(...rows.map(([, v]) => Math.abs(v.net)), 1);
  $("setups").innerHTML = rows.map(([name, v]) => `
    <div class="setup-row" title="${esc(name)}: ${v.n} trades, ${Math.round((v.w / v.n) * 100)}% win rate">
      <span class="name">${esc(name)}<small>${v.n}</small></span>
      <span class="bar-track"><span class="bar ${v.net >= 0 ? "pos" : "neg"}" style="width:${((Math.abs(v.net) / maxAbs) * 50).toFixed(1)}%"></span></span>
      <span class="val ${tone(v.net)}">${money(v.net, true)}</span>
    </div>`).join("");
}

// ============ Blotter ============
function renderTable() {
  const q = $("search").value.trim().toLowerCase();
  const rows = sorted().reverse().filter((t) =>
    !q || [t.ticker, t.setup, t.notes, t.side, t.date].join(" ").toLowerCase().includes(q));
  $("tbody").innerHTML = rows.map((t) => {
    const p = pnlOf(t);
    return `<tr class="${p > 0 ? "win" : p < 0 ? "loss" : ""}">
      <td>${esc(t.date)}</td>
      <td class="sym-cell">${esc(t.ticker)}</td>
      <td><span class="side-tag ${t.side}">${t.side === "short" ? "SHORT" : "LONG"}</span></td>
      <td class="num">${t.shares}</td>
      <td class="num">${t.entry.toFixed(2)}</td>
      <td class="num">${t.exit.toFixed(2)}</td>
      <td class="num pnl-cell ${tone(p)}">${money(p, true)}</td>
      <td class="num ${tone(p)}">${pct(retOf(t))}</td>
      <td>${esc(t.setup)}</td>
      <td class="notes">${esc(t.notes)}</td>
      <td><button class="del" data-id="${t.id}" aria-label="Delete ${esc(t.ticker)} trade" title="Delete">✕</button></td>
    </tr>`;
  }).join("");
  $("tableEmpty").hidden = rows.length > 0;
  $("tableEmpty").textContent = trades.length ? "No matches" : "No trades";
}

function renderAll() {
  const s = stats();
  renderKpis(s); renderTape(); renderChart(s); renderCalendar(); renderSetups(); renderTable();
}

// ============ Order ticket ============
const form = $("tradeForm");
form.date.value = new Date().toISOString().slice(0, 10);

function readForm() {
  const f = new FormData(form);
  return {
    id: Date.now() + Math.random(),
    date: f.get("date"),
    ticker: String(f.get("ticker")).trim().toUpperCase(),
    side: f.get("side"),
    shares: parseFloat(f.get("shares")),
    entry: parseFloat(f.get("entry")),
    exit: parseFloat(f.get("exit")),
    fees: parseFloat(f.get("fees")) || 0,
    setup: f.get("setup"),
    notes: String(f.get("notes")).trim(),
  };
}

function updateTicket() {
  const t = readForm();
  form.classList.toggle("long", t.side !== "short");
  form.classList.toggle("short", t.side === "short");
  $("submitBtn").textContent = t.side === "short" ? "Log short" : "Log buy";
  const ok = [t.shares, t.entry, t.exit].every(Number.isFinite) && t.entry > 0;
  const p = ok ? pnlOf(t) : 0;
  $("estPnl").textContent = ok ? money(p, true) : "—";
  $("estPnl").className = ok ? tone(p) : "";
  $("estRet").textContent = ok ? pct(retOf(t)) : "—";
  $("estRet").className = ok ? tone(p) : "";
  $("estNotional").textContent = ok ? money(t.entry * t.shares) : "—";
}
form.addEventListener("input", updateTicket);
form.addEventListener("change", updateTicket);

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const t = readForm();
  trades.push(t);
  save();
  calMonth = null;
  renderAll();
  const keep = { date: form.date.value, side: t.side };
  form.reset();
  form.date.value = keep.date;
  form.side.value = keep.side;
  updateTicket();
  toast(`${t.side.toUpperCase()} ${t.ticker} logged · ${money(pnlOf(t), true)}`);
});

// ============ Delete with undo ============
$("tbody").addEventListener("click", (e) => {
  const btn = e.target.closest(".del");
  if (!btn) return;
  const idx = trades.findIndex((t) => String(t.id) === btn.dataset.id);
  if (idx < 0) return;
  const [removed] = trades.splice(idx, 1);
  save(); renderAll();
  toast(`Deleted ${removed.ticker} trade`, () => { trades.push(removed); save(); renderAll(); });
});

$("search").addEventListener("input", renderTable);

// ============ Toast ============
let toastTimer;
function toast(msg, undo) {
  const t = $("toast");
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ""}`;
  t.hidden = false;
  if (undo) t.querySelector("button").onclick = () => { undo(); t.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 5000);
}

// ============ Sample / export / import ============
$("sampleBtn").addEventListener("click", () => {
  const setups = ["Opening range breakout", "Bull flag", "Breakout", "Oversold bounce", "News / catalyst"];
  const tickers = [["TSLA", 250], ["NVDA", 135], ["AAPL", 225], ["AMD", 160], ["META", 560], ["MSFT", 420], ["PLTR", 42]];
  const notes = ["Followed the plan.", "Took profit at 2R.", "Stopped out, setup was fine.", "Chased the entry, wait for the close next time.", "Clean breakout on volume.", ""];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const start = new Date(); start.setDate(start.getDate() - 45);
  const batch = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(start); d.setDate(start.getDate() + Math.floor(i * 1.6));
    const [tk, base] = tickers[Math.floor(rnd() * tickers.length)];
    const entry = +(base * (0.95 + rnd() * 0.1)).toFixed(2);
    const win = rnd() < 0.56;
    const move = win ? 0.008 + rnd() * 0.025 : -(0.004 + rnd() * 0.012);
    const side = rnd() < 0.8 ? "long" : "short";
    const exit = +(side === "long" ? entry * (1 + move) : entry * (1 - move)).toFixed(2);
    batch.push({
      id: Date.now() + i, date: d.toISOString().slice(0, 10), ticker: tk, side,
      shares: Math.round((3000 / entry) / 5) * 5 || 5, entry, exit, fees: 1,
      setup: setups[Math.floor(rnd() * setups.length)], notes: notes[Math.floor(rnd() * notes.length)],
    });
  }
  trades = trades.concat(batch);
  save(); calMonth = null; renderAll();
  toast("Loaded 28 sample trades", () => { trades = trades.filter((t) => !batch.includes(t)); save(); calMonth = null; renderAll(); });
});

$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(trades, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `trading-journal-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`Exported ${trades.length} trades`);
});

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error();
    const valid = data.filter((t) => t && t.date && t.ticker && [t.shares, t.entry, t.exit].every(Number.isFinite));
    trades = valid; save(); calMonth = null; renderAll();
    toast(`Imported ${valid.length} trades`);
  } catch { toast("That file isn't a valid journal export."); }
  e.target.value = "";
});

// ============ Market clocks (NYSE regular hours; holidays not included) ============
function zoned(tz) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date()).reduce((o, p) => (o[p.type] = p.value, o), {});
  const h = +parts.hour % 24, mi = +parts.minute, s = +parts.second;
  return { wd: parts.weekday, h, mi, s, mins: h * 60 + mi, str: `${String(h).padStart(2, "0")}:${parts.minute}:${parts.second}` };
}
const hm = (mins) => `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
const hhmm = (mins) => { const m = ((mins % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

function tickClocks() {
  const ny = zoned("America/New_York");
  const jhb = zoned("Africa/Johannesburg");
  $("nyTime").textContent = ny.str + " ET";
  $("jhbTime").textContent = jhb.str;
  $("jhbDate").textContent = new Date().toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", day: "numeric", month: "short" });

  const offset = ((jhb.mins - ny.mins) % 1440 + 1440) % 1440; // JHB minus NY, in minutes
  const openJ = hhmm(570 + offset), closeJ = hhmm(960 + offset);
  const weekday = !["Sat", "Sun"].includes(ny.wd);
  let state = "closed", label = "CLOSED", note;
  if (weekday && ny.mins >= 570 && ny.mins < 960) { state = "open"; label = "OPEN"; note = `Closes in ${hm(960 - ny.mins)} · ${closeJ} JHB`; }
  else if (weekday && ny.mins >= 240 && ny.mins < 570) { state = "ext"; label = "PRE-MARKET"; note = `Opens in ${hm(570 - ny.mins)} · ${openJ} JHB`; }
  else if (weekday && ny.mins >= 960 && ny.mins < 1200) { state = "ext"; label = "AFTER-HOURS"; note = `Next open ${ny.wd === "Fri" ? "Mon" : "tomorrow"} ${openJ} JHB`; }
  else if (weekday && ny.mins < 240) { note = `Opens in ${hm(570 - ny.mins)} · ${openJ} JHB`; }
  else { note = `Next open ${ny.wd === "Fri" || ny.wd === "Sat" || ny.wd === "Sun" ? "Mon" : "tomorrow"} ${openJ} JHB`; }
  const st = $("nyseStatus");
  st.className = "session " + state;
  st.querySelector("b").textContent = label;
  $("nyseNote").textContent = note;
}
tickClocks();
setInterval(tickClocks, 1000);

// ============ Hotkeys: B = buy/long, S = sell/short, / = filter ============
document.addEventListener("keydown", (e) => {
  const typing = e.target.closest("input, textarea, select");
  if (e.key === "Escape" && typing) { e.target.blur(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "b" || k === "s") {
    e.preventDefault();
    form.side.value = k === "b" ? "long" : "short";
    updateTicket();
    form.ticker.focus();
  }
  if (e.key === "/") { e.preventDefault(); $("search").focus(); }
});

// Redraw chart on resize
let rz;
window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => renderChart(stats()), 150); });

updateTicket();
renderAll();
