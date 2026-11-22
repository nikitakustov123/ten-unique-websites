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
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3500);
}
const fmtK = (k) => (k >= 1000 ? `$${(k / 1000).toFixed(1)}M` : `$${k}K`);
const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const CABINS = { explorer: ['Explorer', 1], pioneer: ['Pioneer suite', 1.6], zenith: ['Zenith observatory', 2.5] };

// ---------- Starfield with mouse parallax + warp streaks ----------
const cvs = $('#stars'), ctx = cvs.getContext('2d');
let stars = [], mouse = { x: 0, y: 0 }, W, H;
function resize() {
  W = cvs.width = innerWidth * devicePixelRatio; H = cvs.height = innerHeight * devicePixelRatio;
  stars = Array.from({ length: 420 }, () => ({ x: Math.random() * W, y: Math.random() * H, z: Math.random() * 3 + 0.2, t: Math.random() * 6 }));
}
addEventListener('resize', resize); resize();
addEventListener('mousemove', (e) => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; });
let scrollV = 0, lastY = scrollY;
(function frame(t) {
  scrollV = scrollV * 0.9 + (scrollY - lastY) * 0.1; lastY = scrollY;
  ctx.fillStyle = 'rgba(3,4,11,0.55)'; ctx.fillRect(0, 0, W, H);
  for (const s of stars) {
    s.y -= scrollV * s.z * 0.3; s.y = (s.y + H) % H;
    const px = s.x + mouse.x * s.z * 30, py = s.y + mouse.y * s.z * 30;
    const a = 0.5 + Math.sin(t / 600 + s.t) * 0.5;
    ctx.strokeStyle = ctx.fillStyle = `rgba(${200 + s.z * 18}, ${220}, 255, ${a * (s.z / 3.2)})`;
    if (Math.abs(scrollV) > 2) {
      ctx.lineWidth = s.z; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + scrollV * s.z * 2); ctx.stroke();
    } else { ctx.beginPath(); ctx.arc(px, py, s.z * 0.8, 0, Math.PI * 2); ctx.fill(); }
  }
  requestAnimationFrame(frame);
})(0);

// ---------- Destinations ----------
let destinations = [];
async function loadDestinations() {
  destinations = await api('/api/destinations');
  $('#destGrid').replaceChildren(...destinations.map((d, i) => {
    const card = el('article', { className: 'dest', tabIndex: 0 },
      el('div', { className: 'orb' }),
      el('h3', { textContent: d.name }),
      el('p', { className: 'tag', textContent: d.tagline }),
      el('dl', {},
        el('div', {}, el('dt', { textContent: 'Distance' }), el('dd', { textContent: d.distance })),
        el('div', {}, el('dt', { textContent: 'Duration' }), el('dd', { textContent: `${d.duration_days} days` })),
        el('div', {}, el('dt', { textContent: 'Gravity' }), el('dd', { textContent: d.gravity })),
        el('div', {}, el('dt', { textContent: 'Seats left' }), el('dd', { textContent: d.seats_left }))),
      el('p', { className: 'price' }, el('small', { textContent: 'from ' }), fmtK(d.price_k)));
    card.style.setProperty('--h', d.hue);
    card.style.animationDelay = `${i * 120}ms`;
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const rx = ((e.clientY - r.top) / r.height - 0.5) * -14, ry = ((e.clientX - r.left) / r.width - 0.5) * 14;
      card.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    });
    card.addEventListener('mouseleave', () => (card.style.transform = ''));
    card.onclick = () => openDestination(d.slug);
    card.onkeydown = (e) => e.key === 'Enter' && openDestination(d.slug);
    return card;
  }));
  startCountdown(destinations.map((d) => d.next_launch).sort()[0]);
}

function startCountdown(dateStr) {
  if (!dateStr) return;
  const target = new Date(dateStr + 'T09:00:00Z');
  const box = $('#countdown');
  const tick = () => {
    let s = Math.max(0, (target - Date.now()) / 1000);
    const parts = [['Days', 86400], ['Hrs', 3600], ['Min', 60], ['Sec', 1]].map(([l, v]) => { const n = Math.floor(s / v); s -= n * v; return [l, n]; });
    box.replaceChildren(...parts.map(([l, n]) => el('div', {}, el('b', { textContent: String(n).padStart(2, '0') }), el('small', { textContent: l }))));
  };
  tick(); setInterval(tick, 1000);
}

// ---------- Booking modal ----------
const modal = $('#modal');
$('#closeModal').onclick = () => modal.close();
modal.addEventListener('click', (e) => e.target === modal && modal.close());

async function openDestination(slug) {
  const d = await api(`/api/destinations/${slug}`);
  let selected = d.launches.find((l) => l.seats_left > 0);
  const est = el('span', { className: 'estimate' });
  const form = el('form', { className: 'book-form' },
    el('input', { name: 'full_name', placeholder: 'Full name', required: true, maxLength: 100, className: 'full-row' }),
    el('input', { name: 'email', type: 'email', placeholder: 'Email', required: true, maxLength: 120, className: 'full-row' }),
    el('select', { name: 'cabin' }, Object.entries(CABINS).map(([v, [label, m]]) => el('option', { value: v, textContent: `${label} ×${m}` }))),
    el('input', { name: 'seats', type: 'number', min: 1, max: 6, value: 1, required: true }),
    est,
    el('button', { className: 'btn', type: 'submit', textContent: 'Reserve seats', disabled: !selected }));
  const updateEst = () => { est.textContent = `Est. ${fmtK(Math.round(d.price_k * CABINS[form.cabin.value][1] * (Number(form.seats.value) || 1)))}`; };
  form.addEventListener('input', updateEst); updateEst();

  const list = el('div', { className: 'launches' }, d.launches.map((l) => {
    const row = el('div', { className: `launch ${l.seats_left <= 0 ? 'full' : ''} ${l === selected ? 'sel' : ''}` },
      el('span', { textContent: fmtDate(l.launch_date) }),
      el('span', { className: 'muted', textContent: l.vessel }),
      el('span', { textContent: l.seats_left > 0 ? `${l.seats_left}/${l.seats_total} seats` : 'FULL' }),
      el('span', { className: 'seats-bar' }, Object.assign(el('i'), { style: `width:${(l.seats_left / l.seats_total) * 100}%` })));
    row.onclick = () => { selected = l; list.querySelectorAll('.launch').forEach((r) => r.classList.remove('sel')); row.classList.add('sel'); };
    return row;
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const b = await api('/api/bookings', { method: 'POST', body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), launch_id: selected.id }) });
      modal.close();
      toast(`Booked! Your mission code: ${b.code}`);
      showTicket(b);
      loadDestinations();
      $('#lookup').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { toast(err.message); }
  });

  $('#modalBody').replaceChildren(
    el('div', { className: 'modal-head' }, el('h3', { textContent: d.name }), el('p', { textContent: d.description })),
    el('p', { className: 'muted', textContent: 'Select a launch window:' }), list, form);
  modal.showModal();
}

// ---------- Lookup ----------
function showTicket(b) {
  $('#lookupResult').replaceChildren(el('div', { className: 'ticket' },
    el('h4', { textContent: `BOARDING PASS · ${b.code}` }),
    ...[['Destination', b.destination], ['Crew', b.full_name ?? '—'], ['Launch', fmtDate(b.launch_date)], ['Vessel', b.vessel],
      ['Cabin', CABINS[b.cabin][0]], ['Seats', b.seats], ['Total', fmtK(b.total_k)]]
      .map(([k, v]) => el('p', {}, el('span', { textContent: k }), el('b', { textContent: v })))));
}
$('#lookupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { showTicket(await api(`/api/bookings/${encodeURIComponent(e.target.code.value.trim())}`)); }
  catch (err) { toast(err.message); $('#lookupResult').replaceChildren(); }
});

loadDestinations();
