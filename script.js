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
const money = (v, sign = false) => {
  const s = Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD" });
  if (!sign) return v < 0 ? "−" + s : s;
  return (v > 0 ? "+" : v < 0 ? "−" : "") + s;
};
const cls = (v) => (v > 0 ? "gain" : v < 0 ? "loss" : "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pnlOf = (t) => (t.side === "short" ? t.entry - t.exit : t.exit - t.entry) * t.shares - (t.fees || 0);
const sorted = () => [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

// ============ Stats ============
function renderStats() {
  const pnls = trades.map(pnlOf);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const net = pnls.reduce((a, b) => a + b, 0);
  const grossW = wins.reduce((a, b) => a + b, 0);
  const grossL = Math.abs(losses.reduce((a, b) => a + b, 0));
  const n = trades.length;

  $("kNet").textContent = money(net, true);
  $("kNet").className = "kpi-value " + cls(net);
  $("kNetFoot").textContent = n ? `${n} trade${n > 1 ? "s" : ""} · avg ${money(net / n, true)} / trade` : "No trades yet";

  const decided = wins.length + losses.length;
  const wr = decided ? (wins.length / decided) * 100 : 0;
  $("kWin").textContent = decided ? wr.toFixed(1) + "%" : "–";
  $("kWinBar").style.width = wr + "%";
  $("kWinFoot").textContent = `${wins.length} W · ${losses.length} L`;

  $("kPF").textContent = grossL ? (grossW / grossL).toFixed(2) : grossW ? "∞" : "–";

  const avgW = wins.length ? grossW / wins.length : 0;
  const avgL = losses.length ? grossL / losses.length : 0;
  $("kAvg").innerHTML = n ? `<span class="gain">${money(avgW, true)}</span> / <span class="loss">${money(-avgL, true)}</span>` : "–";
  $("kAvgFoot").textContent = avgL ? `Payoff ratio ${(avgW / avgL).toFixed(2)}` : "Payoff ratio –";

  if (n) {
    const withP = trades.map((t) => ({ t, p: pnlOf(t) }));
    const best = withP.reduce((a, b) => (b.p > a.p ? b : a));
    const worst = withP.reduce((a, b) => (b.p < a.p ? b : a));
    $("kBest").innerHTML = `<span class="${cls(best.p)}">${money(best.p, true)}</span> / <span class="${cls(worst.p)}">${money(worst.p, true)}</span>`;
    $("kBestFoot").textContent = `${best.t.ticker} · ${worst.t.ticker}`;
  } else {
    $("kBest").textContent = "–";
    $("kBestFoot").innerHTML = "&nbsp;";
  }
  $("tradeCount").textContent = `${n} trade${n === 1 ? "" : "s"}`;
}

// ============ Chart ============
const NS = "http://www.w3.org/2000/svg";
let chartPts = [];
let animateNext = true;

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

function renderChart() {
  const svg = $("chart");
  svg.innerHTML = "";
  const list = sorted();
  $("chartEmpty").hidden = list.length > 0;
  if (!list.length) { chartPts = []; return; }

  const W = $("chartWrap").clientWidth;
  const H = $("chartWrap").clientHeight;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const m = { t: 16, r: 16, b: 28, l: 64 };

  let cum = 0;
  const data = [{ i: 0, cum: 0, t: null, p: 0 }];
  list.forEach((t, i) => { const p = pnlOf(t); cum += p; data.push({ i: i + 1, cum, t, p }); });

  const ticks = niceTicks(Math.min(0, ...data.map((d) => d.cum)), Math.max(0, ...data.map((d) => d.cum)));
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const x = (i) => m.l + (i / (data.length - 1)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - m.t - m.b);

  // gradient
  const defs = el("defs", {}, svg);
  const lg = el("linearGradient", { id: "area", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el("stop", { offset: 0, "stop-color": "#a99dff", "stop-opacity": 0.35 }, lg);
  el("stop", { offset: 1, "stop-color": "#a99dff", "stop-opacity": 0 }, lg);

  // grid + y labels
  const grid = el("g", { class: "grid" }, svg);
  const axis = el("g", { class: "axis" }, svg);
  ticks.forEach((v) => {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, grid);
    const tx = el("text", { x: m.l - 10, y: y(v) + 4, "text-anchor": "end" }, axis);
    tx.textContent = Math.abs(v) >= 1000 ? (v < 0 ? "−" : "") + "$" + Math.abs(v / 1000) + "k" : money(v).replace(".00", "");
  });
  // x labels: first & last trade dates
  const xl = (d, anchor) => { const t = el("text", { x: x(d.i), y: H - 6, "text-anchor": anchor }, axis); t.textContent = d.t.date; };
  xl(data[1], data.length > 2 ? "start" : "middle");
  if (data.length > 2) xl(data[data.length - 1], "end");

  el("line", { class: "zero", x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }, svg);

  const pts = data.map((d) => [x(d.i), y(d.cum)]);
  const linePath = "M" + pts.map((p) => p.join(",")).join(" L");
  el("path", { d: `${linePath} L${pts[pts.length - 1][0]},${y(yMin)} L${pts[0][0]},${y(yMin)} Z`, fill: "url(#area)" }, svg);
  const line = el("path", { d: linePath, class: "line" }, svg);
  if (animateNext) {
    const len = line.getTotalLength();
    line.style.setProperty("--len", len);
    line.classList.add("draw");
    animateNext = false;
  }
  const last = pts[pts.length - 1];
  el("circle", { class: "end-halo", cx: last[0], cy: last[1], r: 6 }, svg);
  el("circle", { class: "end-dot", cx: last[0], cy: last[1], r: 4 }, svg);

  // hover layer
  const cross = el("line", { class: "cross", y1: m.t, y2: H - m.b, visibility: "hidden" }, svg);
  const marker = el("circle", { class: "marker", r: 5, visibility: "hidden" }, svg);
  chartPts = { data, x, y, cross, marker, m, W };
}

function chartHover(e) {
  if (!chartPts.data) return;
  const { data, x, y, cross, marker, m, W } = chartPts;
  const r = $("chartWrap").getBoundingClientRect();
  const mx = e.clientX - r.left;
  const frac = Math.max(0, Math.min(1, (mx - m.l) / (W - m.l - m.r)));
  const d = data[Math.max(1, Math.round(frac * (data.length - 1)))];
  if (!d) return;
  const px = x(d.i), py = y(d.cum);
  cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
  marker.setAttribute("cx", px); marker.setAttribute("cy", py); marker.setAttribute("visibility", "visible");
  const tip = $("tooltip");
  tip.hidden = false;
  tip.style.left = Math.min(Math.max(px, 90), W - 90) + "px";
  tip.style.top = py + "px";
  tip.innerHTML = `
    <div class="t-head">#${d.i} · ${esc(d.t.date)} · ${esc(d.t.ticker)}</div>
    <div class="t-row"><span>Trade</span><span class="${cls(d.p)}">${money(d.p, true)}</span></div>
    <div class="t-row"><span>Cumulative</span><span>${money(d.cum, true)}</span></div>`;
}
function chartLeave() {
  $("tooltip").hidden = true;
  if (chartPts.cross) { chartPts.cross.setAttribute("visibility", "hidden"); chartPts.marker.setAttribute("visibility", "hidden"); }
}
$("chartWrap").addEventListener("pointermove", chartHover);
$("chartWrap").addEventListener("pointerleave", chartLeave);

// ============ Table ============
function renderTable() {
  const q = $("search").value.trim().toLowerCase();
  const rows = sorted().reverse().filter((t) =>
    !q || [t.ticker, t.setup, t.notes, t.side, t.date].join(" ").toLowerCase().includes(q));
  $("tbody").innerHTML = rows.map((t) => {
    const p = pnlOf(t);
    return `<tr>
      <td>${esc(t.date)}</td>
      <td class="ticker">${esc(t.ticker)}</td>
      <td><span class="side">${t.side === "short" ? "Short ↓" : "Long ↑"}</span></td>
      <td class="num">${t.shares}</td>
      <td class="num">${t.entry.toFixed(2)}</td>
      <td class="num">${t.exit.toFixed(2)}</td>
      <td class="num pnl ${cls(p)}">${money(p, true)}</td>
      <td>${esc(t.setup)}</td>
      <td class="notes">${esc(t.notes)}</td>
      <td><button class="del" data-id="${t.id}" aria-label="Delete ${esc(t.ticker)} trade" title="Delete">✕</button></td>
    </tr>`;
  }).join("");
  $("tableEmpty").hidden = rows.length > 0;
  $("tableEmpty").textContent = trades.length ? "No trades match your search." : "No trades yet.";
}

function renderAll() { renderStats(); renderChart(); renderTable(); renderStatus(); }

// ============ Status bar ============
function renderStatus() {
  const net = trades.reduce((a, t) => a + pnlOf(t), 0);
  $("sbTrades").textContent = `${trades.length} trade${trades.length === 1 ? "" : "s"}`;
  $("sbNet").textContent = `net ${money(net, true)}`;
}
const tick = () => { $("sbTime").textContent = new Date().toLocaleTimeString("en-GB"); };
tick();
setInterval(tick, 1000);

// ============ Console log ============
function log(level, msg) {
  const out = $("console");
  const row = document.createElement("div");
  const ts = new Date().toLocaleTimeString("en-GB");
  row.innerHTML = `<span class="ts">[${ts}]</span><span class="lvl ${level}">${level.toUpperCase().padEnd(4, " ")}</span><span class="msg">${esc(msg)}</span>`;
  out.appendChild(row);
  out.scrollTop = out.scrollHeight;
}
$("clearLog").addEventListener("click", () => { $("console").innerHTML = ""; log("info", "console cleared"); });
const tradeStr = (t) => `${t.ticker} ${t.side} ${t.shares} @ ${t.entry} → ${t.exit}`;

// ============ Form ============
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

form.addEventListener("input", () => {
  const t = readForm();
  const ok = [t.shares, t.entry, t.exit].every(Number.isFinite);
  const p = ok ? pnlOf(t) : null;
  $("preview").innerHTML = `<i class="kw">return</i> pnl: <strong class="${ok ? cls(p) : ""}">${ok ? money(p, true) : "–"}</strong>`;
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const t = readForm();
  trades.push(t);
  save();
  animateNext = true;
  renderAll();
  const keepDate = form.date.value;
  form.reset();
  form.date.value = keepDate;
  $("preview").innerHTML = '<i class="kw">return</i> pnl: <strong>–</strong>';
  toast(`${t.ticker} logged: ${money(pnlOf(t), true)}`);
  log("ok", `INSERT ${tradeStr(t)}  pnl ${money(pnlOf(t), true)}`);
});

// ============ Delete with undo ============
$("tbody").addEventListener("click", (e) => {
  const btn = e.target.closest(".del");
  if (!btn) return;
  const idx = trades.findIndex((t) => String(t.id) === btn.dataset.id);
  if (idx < 0) return;
  const [removed] = trades.splice(idx, 1);
  save(); renderAll();
  log("warn", `DELETE ${tradeStr(removed)}`);
  toast(`Deleted ${removed.ticker} trade`, () => { trades.push(removed); save(); renderAll(); log("info", `ROLLBACK delete ${removed.ticker}`); });
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
  save(); animateNext = true; renderAll();
  log("info", `load --sample: inserted ${batch.length} sample trades`);
  toast("Loaded 28 sample trades", () => { trades = trades.filter((t) => !batch.includes(t)); save(); renderAll(); log("info", "ROLLBACK sample data"); });
});

$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(trades, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `trading-journal-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  log("ok", `export: wrote ${trades.length} trades to ${a.download}`);
});

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error();
    const valid = data.filter((t) => t && t.date && t.ticker && [t.shares, t.entry, t.exit].every(Number.isFinite));
    trades = valid; save(); animateNext = true; renderAll();
    toast(`Imported ${valid.length} trades`);
    log("ok", `import: loaded ${valid.length} trades from ${file.name}`);
  } catch {
    toast("That file isn't a valid journal export.");
    log("err", `import: ${file.name} is not a valid journal export`);
  }
  e.target.value = "";
});

// Redraw chart on resize
let rz;
window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(renderChart, 150); });

// ============ Keyboard shortcuts ============
document.addEventListener("keydown", (e) => {
  const typing = e.target.closest("input, textarea, select");
  if (e.key === "Escape" && typing) { e.target.blur(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "n" || e.key === "N") { e.preventDefault(); form.ticker.focus(); form.ticker.scrollIntoView({ block: "center", behavior: "smooth" }); }
  if (e.key === "/") { e.preventDefault(); $("search").focus(); $("search").scrollIntoView({ block: "center", behavior: "smooth" }); }
});

renderAll();
log("info", "journal v1.0 booted");
log("ok", `localStorage: ${trades.length} trade${trades.length === 1 ? "" : "s"} loaded`);
if (!trades.length) log("info", 'tip: press N to log a trade, or run "load --sample"');
