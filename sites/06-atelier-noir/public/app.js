const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => n.append(k));
  return n;
};
async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

// ---------- Intro + split hero text ----------
setTimeout(() => $('#intro')?.remove(), 2600);
const h1 = $('.split');
const lines = h1.innerHTML.split('<br>');
h1.innerHTML = '';
let delay = 1.6;
lines.forEach((html) => {
  const tmp = el('div'); tmp.innerHTML = html;
  const line = el('span', { className: 'ln' });
  tmp.childNodes.forEach((node) => {
    const wrap = node.nodeType === 3 ? line : line.appendChild(el(node.tagName.toLowerCase()));
    [...node.textContent].forEach((ch) => {
      const s = el('span', { className: 'ch', textContent: ch === ' ' ? ' ' : ch });
      s.style.animationDelay = `${(delay += 0.04)}s`;
      wrap.append(s);
    });
  });
  h1.append(line);
});

// ---------- Custom cursor ----------
const cursor = $('#cursor'), label = $('#cursorLabel');
let cx = innerWidth / 2, cy = innerHeight / 2, tx = cx, ty = cy;
addEventListener('mousemove', (e) => { tx = e.clientX; ty = e.clientY; });
(function follow() {
  cx += (tx - cx) * 0.18; cy += (ty - cy) * 0.18;
  cursor.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
  requestAnimationFrame(follow);
})();
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-cursor]');
  cursor.classList.toggle('big', !!t);
  label.textContent = t ? t.dataset.cursor : '';
});

// ---------- Manifesto: words light up as you scroll ----------
const quote = $('#quote');
quote.innerHTML = quote.textContent.split(' ').map((w) => `<span class="w">${w}</span>`).join(' ');
const words = [...quote.querySelectorAll('.w')];

// ---------- Collections with horizontal scroll ----------
async function loadCollections() {
  const cols = await api('/api/collections');
  const root = $('#collections');
  cols.forEach((c, ci) => {
    const dark = ci % 2 === 1;
    const track = el('div', { className: 'track' }, c.looks.map((l) => {
      const light = parseInt(l.tone.slice(1), 16) > 0x888888;
      const likeBtn = el('button', { className: 'like' }, el('span', { textContent: `♡ ${l.likes}` }));
      likeBtn.dataset.cursor = 'Нравится';
      likeBtn.onclick = async () => {
        const r = await api(`/api/looks/${l.id}/like`, { method: 'POST' });
        likeBtn.firstChild.textContent = `♥ ${r.likes}`; likeBtn.classList.add('done');
      };
      const frame = el('div', { className: 'frame reveal' }, el('div', { className: 'figure' }), el('span', { className: 'num', textContent: String(l.number).padStart(2, '0') }));
      frame.style.setProperty('--tone', l.tone);
      frame.style.setProperty('--fig', light ? '#1a1a1a' : '#e8e4dc');
      frame.dataset.cursor = 'Смотреть';
      return el('article', { className: 'look' }, frame,
        el('div', { className: 'look-meta' }, el('div', {}, el('h3', { textContent: l.name }), el('small', { textContent: l.fabric })), likeBtn));
    }));
    const progress = el('div', { className: 'progress' }, el('i'));
    const section = el('section', { className: `collection ${dark ? 'dark' : ''}` },
      el('div', { className: 'sticky' },
        el('div', { className: 'col-head' }, el('span', { className: 'season', textContent: c.season }), el('h2', { textContent: c.title }), el('p', { textContent: c.manifesto })),
        track, progress));
    section.style.setProperty('--h', `${100 + c.looks.length * 35}vh`);
    root.append(section);
  });
  document.querySelectorAll('.collection').forEach((n) => io.observe(n));
  onScroll();
}

// Reveal every frame of a collection (staggered) as soon as the collection scrolls into view.
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  e.target.querySelectorAll('.reveal').forEach((f, i) => { f.style.transitionDelay = `${i * 120}ms`; f.classList.add('in'); });
  io.unobserve(e.target);
}), { threshold: 0.05 });

function onScroll() {
  // light manifesto words progressively
  const r = quote.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.4)));
  words.forEach((w, i) => w.classList.toggle('lit', i / words.length < p));
  // translate horizontal tracks based on vertical progress through each sticky section
  document.querySelectorAll('.collection').forEach((sec) => {
    const track = $('.track', sec), bar = $('.progress i', sec);
    const rect = sec.getBoundingClientRect();
    const total = sec.offsetHeight - innerHeight;
    const prog = Math.min(1, Math.max(0, -rect.top / total));
    const max = track.scrollWidth - innerWidth + innerWidth * 0.08;
    track.style.transform = `translateX(${-prog * Math.max(0, max)}px)`;
    bar.style.width = `${prog * 100}%`;
  });
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll);

// ---------- Appointment booking ----------
const state = { service: null, day: null, slot: null, days: [] };
const pick = (container, btn) => { container.querySelectorAll('.opt').forEach((b) => b.classList.remove('on')); btn.classList.add('on'); };

async function loadAvailability() {
  const a = await api('/api/availability');
  state.days = a.days;
  $('#services').replaceChildren(...a.services.map((s) => {
    const b = el('button', { type: 'button', className: `opt ${state.service === s ? 'on' : ''}`, textContent: s });
    b.onclick = () => { state.service = s; pick($('#services'), b); };
    return b;
  }));
  $('#days').replaceChildren(...a.days.map((d) => {
    const dt = new Date(d.day + 'T12:00:00Z');
    const full = d.slots.every((s) => !s.free);
    const b = el('button', { type: 'button', className: `opt ${state.day === d.day ? 'on' : ''}`, disabled: full },
      el('span', { className: 'dow', textContent: dt.toLocaleDateString('ru-RU', { weekday: 'short', month: 'short', timeZone: 'UTC' }) }),
      el('span', { className: 'dnum', textContent: dt.getUTCDate() }));
    b.onclick = () => { state.day = d.day; state.slot = null; pick($('#days'), b); renderSlots(); };
    return b;
  }));
  renderSlots();
}
function renderSlots() {
  const d = state.days.find((x) => x.day === state.day);
  if (!d) return;
  $('#slots').replaceChildren(...d.slots.map((s) => {
    const b = el('button', { type: 'button', className: `opt ${state.slot === s.slot ? 'on' : ''}`, textContent: s.slot, disabled: !s.free });
    b.onclick = () => { state.slot = s.slot; pick($('#slots'), b); };
    return b;
  }));
}

$('#rdvForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#confirm');
  if (!state.service || !state.day || !state.slot) { msg.textContent = 'Пожалуйста, выберите услугу, дату и время.'; return; }
  try {
    const f = Object.fromEntries(new FormData(e.target));
    const r = await api('/api/appointments', { method: 'POST', body: JSON.stringify({ ...f, service: state.service, day: state.day, slot: state.slot }) });
    const when = new Date(r.day + 'T12:00:00Z').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    msg.textContent = `Merci, ${r.name}. Ждём вас: ${when}, в ${r.slot}.`;
    e.target.reset(); state.slot = null;
  } catch (err) { msg.textContent = err.message; }
  loadAvailability();
});

loadCollections();
loadAvailability();
