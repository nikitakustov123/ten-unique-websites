const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => n.append(k));
  return n;
};
async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
const money = (c, dec = 0) => (c < 0 ? '−' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const monthName = (m) => new Date(m + '-15T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortMonth = (m) => new Date(m + '-15T00:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

// Smoothly count numbers up/down
function countTo(node, cents) {
  const from = Number(node.dataset.v || 0), start = performance.now(), dur = 900;
  node.dataset.v = cents;
  const tick = (t) => {
    const k = Math.min(1, (t - start) / dur), e = 1 - (1 - k) ** 3;
    node.textContent = money(from + (cents - from) * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let month = new Date().toISOString().slice(0, 7);
let categories = [];
const shiftMonth = (d) => { const [y, m] = month.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1 + d, 1)); month = dt.toISOString().slice(0, 7); refresh(); };
$('#prevMonth').onclick = () => shiftMonth(-1);
$('#nextMonth').onclick = () => shiftMonth(1);

// ---------- Charts (hand-drawn canvas, animated) ----------
function animate(draw, dur = 1000) {
  const start = performance.now();
  const f = (t) => { const k = Math.min(1, (t - start) / dur); draw(1 - (1 - k) ** 3); if (k < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}
function drawTrend(trend) {
  const c = $('#trend'), ctx = c.getContext('2d'), W = c.width, H = c.height, P = 36;
  const max = Math.max(1, ...trend.flatMap((t) => [t.income, t.expenses])) * 1.15;
  const x = (i) => P + (i * (W - P * 2)) / Math.max(1, trend.length - 1);
  const y = (v) => H - P - (v / max) * (H - P * 2);
  animate((k) => {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.fillStyle = '#9aa3c7'; ctx.font = '12px Plus Jakarta Sans';
    for (let i = 0; i <= 4; i++) { const yy = P + (i * (H - P * 2)) / 4; ctx.beginPath(); ctx.moveTo(P, yy); ctx.lineTo(W - P, yy); ctx.stroke(); }
    trend.forEach((t, i) => ctx.fillText(shortMonth(t.month), x(i) - 12, H - 10));
    [['income', '#5eead4'], ['expenses', '#f472b6']].forEach(([key, color]) => {
      const pts = trend.map((t, i) => [x(i), y(t[key] * k)]);
      if (!pts.length) return;
      const grad = ctx.createLinearGradient(0, P, 0, H - P); grad.addColorStop(0, color + '55'); grad.addColorStop(1, color + '00');
      ctx.beginPath(); ctx.moveTo(pts[0][0], H - P);
      pts.forEach(([px, py], i) => { if (i === 0) ctx.lineTo(px, py); else { const [qx, qy] = pts[i - 1]; const mx = (qx + px) / 2; ctx.bezierCurveTo(mx, qy, mx, py, px, py); } });
      ctx.lineTo(pts.at(-1)[0], H - P); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath(); pts.forEach(([px, py], i) => { if (i === 0) ctx.moveTo(px, py); else { const [qx, qy] = pts[i - 1]; const mx = (qx + px) / 2; ctx.bezierCurveTo(mx, qy, mx, py, px, py); } });
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.shadowBlur = 14; ctx.shadowColor = color; ctx.stroke(); ctx.shadowBlur = 0;
      pts.forEach(([px, py]) => { ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fillStyle = '#0b1020'; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); });
    });
  }, 1200);
}
function drawDonut(byCat) {
  const c = $('#donut'), ctx = c.getContext('2d'), R = c.width / 2;
  const items = byCat.filter((b) => b.spent > 0), total = items.reduce((s, b) => s + b.spent, 0);
  countTo($('#donutTotal'), total);
  animate((k) => {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineWidth = 28; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(R, R, R - 24, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.stroke();
    let a = -Math.PI / 2;
    items.forEach((b) => {
      const sweep = (b.spent / total) * Math.PI * 2 * k;
      ctx.beginPath(); ctx.arc(R, R, R - 24, a + 0.04, a + Math.max(0.05, sweep - 0.04));
      ctx.strokeStyle = b.color; ctx.shadowBlur = 16; ctx.shadowColor = b.color; ctx.stroke(); ctx.shadowBlur = 0;
      a += sweep;
    });
  }, 1100);
}

// ---------- Render ----------
async function refresh() {
  $('#monthLabel').textContent = monthName(month);
  const [s, txs] = await Promise.all([api(`/api/summary?month=${month}`), api(`/api/transactions?month=${month}`)]);
  countTo($('#balance'), s.balance); countTo($('#kIncome'), s.income); countTo($('#kExpenses'), s.expenses); countTo($('#kNet'), s.net);
  const pct = s.income ? Math.round((s.net / s.income) * 100) : 0;
  $('#kNetPct').textContent = `${pct}% saved`; $('#kNetPct').className = pct >= 0 ? 'up' : 'down';
  drawTrend(s.trend); drawDonut(s.byCategory);

  $('#budgets').replaceChildren(...s.byCategory.map((b) => {
    const pctB = b.budget ? Math.min(100, (b.spent / b.budget) * 100) : 0;
    const li = el('li', { className: b.budget && b.spent > b.budget ? 'over' : '', title: 'Click to edit budget' },
      el('div', { className: 'row' }, el('span', { textContent: `${b.icon} ${b.name}` }), el('small', { textContent: `${money(b.spent)} / ${b.budget ? money(b.budget) : '—'}` })),
      el('div', { className: 'bar' }, el('i')));
    li.style.setProperty('--c', b.color);
    requestAnimationFrame(() => requestAnimationFrame(() => (li.querySelector('i').style.width = `${b.budget ? pctB : 0}%`)));
    li.onclick = async () => {
      const v = prompt(`Monthly budget for ${b.name} (USD, empty to clear):`, b.budget ? b.budget / 100 : '');
      if (v === null) return;
      try { await api(`/api/categories/${b.id}/budget`, { method: 'PATCH', body: JSON.stringify({ budget: v.trim() }) }); toast('Budget updated'); refresh(); }
      catch (err) { toast(err.message); }
    };
    return li;
  }));

  $('#txList').replaceChildren(...(txs.length ? txs.map((t, i) => {
    const li = el('li', {},
      el('span', { className: 'ic', textContent: t.icon }),
      el('div', {}, el('b', { textContent: t.note || t.category }), el('small', { textContent: `${t.category} · ${new Date(t.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` })),
      el('span', { className: `amt ${t.kind === 'income' ? 'in' : ''}`, textContent: `${t.kind === 'income' ? '+' : '−'}${money(t.amount_cents, 2)}` }));
    li.style.setProperty('--c', t.color); li.style.animationDelay = `${Math.min(i, 15) * 30}ms`;
    li.onclick = () => openTx(t);
    return li;
  }) : [el('li', { className: 'empty', textContent: 'No transactions this month yet.' })]));
}

// ---------- Transaction dialog ----------
const dlg = $('#txDlg'), form = $('#txForm');
let editing = null;
function fillCategories(kind, selected) {
  form.elements.category_id.replaceChildren(...categories.filter((c) => c.kind === kind).map((c) => el('option', { value: c.id, textContent: `${c.icon} ${c.name}`, selected: c.id === selected })));
}
form.querySelectorAll('input[name=kind]').forEach((r) => (r.onchange = () => fillCategories(r.value)));
function openTx(t = null) {
  editing = t; form.reset();
  $('#txTitle').textContent = t ? 'Edit transaction' : 'New transaction';
  $('#txDelete').hidden = !t;
  const kind = t?.kind || 'expense';
  form.querySelector(`input[name=kind][value=${kind}]`).checked = true;
  fillCategories(kind, t?.category_id);
  form.elements.amount.value = t ? (t.amount_cents / 100).toFixed(2) : '';
  form.elements.note.value = t?.note || '';
  const today = new Date().toISOString().slice(0, 10);
  form.elements.date.value = t?.date || (today.startsWith(month) ? today : `${month}-01`);
  dlg.showModal();
}
$('#addBtn').onclick = () => openTx();
$('#txCancel').onclick = () => dlg.close();
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = JSON.stringify({ amount: form.elements.amount.value, category_id: form.elements.category_id.value, date: form.elements.date.value, note: form.elements.note.value });
  try {
    await api(editing ? `/api/transactions/${editing.id}` : '/api/transactions', { method: editing ? 'PUT' : 'POST', body });
    dlg.close(); toast(editing ? 'Transaction updated' : 'Transaction added ✨'); refresh();
  } catch (err) { toast(err.message); }
});
$('#txDelete').onclick = async () => { await api(`/api/transactions/${editing.id}`, { method: 'DELETE' }); dlg.close(); toast('Transaction deleted'); refresh(); };

api('/api/categories').then((c) => { categories = c; refresh(); });
