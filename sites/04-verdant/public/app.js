const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => n.append(k));
  return n;
};
const money = (c) => `${Math.round(c / 100).toLocaleString('ru-RU')} ₽`;

// Anonymous visitor id so the wishlist survives reloads (stored server-side per visitor).
let visitor;
try { visitor = localStorage.getItem('verdant-visitor'); } catch {}
if (!visitor) { visitor = crypto.randomUUID(); try { localStorage.setItem('verdant-visitor', visitor); } catch {} }

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Visitor': visitor } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2800);
}
const LIGHT = { low: '☁️ Мало света', medium: '⛅ Рассеянный свет', bright: '☀️ Яркий свет' };
const WATER = { rarely: '💧 Раз в 2–3 недели', weekly: '💧💧 Раз в неделю', often: '💧💧💧 Держать влажным' };
const DIFF = ['', 'Для новичков', 'Средний уровень', 'Для опытных'];
const SIZE = { small: 'Маленькое', medium: 'Среднее', large: 'Большое' };

// ---------- Catalog ----------
const filters = {};
let wishIds = new Set();

async function loadPlants() {
  const params = new URLSearchParams({ ...filters, sort: $('#sort').value });
  const q = $('#q').value.trim(); if (q) params.set('q', q);
  const plants = await api(`/api/plants?${params}`);
  const grid = $('#grid');
  if (!plants.length) return grid.replaceChildren(el('p', { className: 'empty', textContent: 'Ничего не нашлось — попробуйте ослабить фильтры 🌾' }));
  grid.replaceChildren(...plants.map((p, i) => {
    const heart = el('button', { className: `heart ${wishIds.has(p.id) ? 'on' : ''}`, textContent: wishIds.has(p.id) ? '♥' : '♡', ariaLabel: 'В избранное' });
    heart.onclick = (e) => { e.stopPropagation(); toggleWish(p, heart); };
    const card = el('article', { className: 'card' },
      el('div', { className: 'art' }, el('span', { textContent: p.emoji })), heart,
      el('h3', { textContent: p.name }),
      el('p', { className: 'latin', textContent: p.latin }),
      el('div', { className: 'row' },
        el('span', { className: 'price', textContent: money(p.price_cents) }),
        el('span', { className: 'badges', textContent: `${p.pet_safe ? '🐾' : ''}${p.light === 'low' ? '☁️' : p.light === 'bright' ? '☀️' : '⛅'}` })),
      p.stock <= 5 ? el('p', { className: 'low-stock', textContent: `Осталось всего ${p.stock}!` }) : '');
    card.style.animationDelay = `${i * 50}ms`;
    card.onclick = () => openPlant(p);
    return card;
  }));
}

$('#filters').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  const { k, v } = chip.dataset;
  const on = filters[k] !== v;
  document.querySelectorAll(`.chip[data-k="${k}"]`).forEach((c) => c.classList.remove('on'));
  if (on) { filters[k] = v; chip.classList.add('on'); } else delete filters[k];
  loadPlants();
});
$('#sort').onchange = loadPlants;
let deb; $('#q').oninput = () => { clearTimeout(deb); deb = setTimeout(loadPlants, 250); };

// ---------- Side panel (plant detail / wishlist) ----------
const panel = $('#panel'), scrim = $('#scrim');
const openPanel = (...content) => { $('#panelBody').replaceChildren(...content); panel.classList.add('open'); scrim.classList.add('show'); panel.setAttribute('aria-hidden', 'false'); };
const closePanel = () => { panel.classList.remove('open'); scrim.classList.remove('show'); panel.setAttribute('aria-hidden', 'true'); };
$('#closePanel').onclick = scrim.onclick = closePanel;
addEventListener('keydown', (e) => e.key === 'Escape' && closePanel());

function openPlant(p) {
  const btn = el('button', { className: 'btn', textContent: wishIds.has(p.id) ? '♥ В избранном' : '♡ В избранное' });
  btn.onclick = async () => { await toggleWish(p); btn.textContent = wishIds.has(p.id) ? '♥ В избранном' : '♡ В избранное'; };
  openPanel(
    el('div', { className: 'big', textContent: p.emoji }),
    el('h3', { textContent: p.name }),
    el('p', { className: 'latin', textContent: p.latin, style: 'font-style:italic;opacity:.6' }),
    el('p', { textContent: p.description, style: 'margin-top:1rem' }),
    el('div', { className: 'care' },
      ...[['Свет', LIGHT[p.light]], ['Полив', WATER[p.water]], ['Уход', DIFF[p.difficulty]], ['Питомцы', p.pet_safe ? '🐾 Безопасно' : '⚠️ Держать подальше'], ['Размер', SIZE[p.size]], ['Цена', money(p.price_cents)]]
        .map(([k, v]) => el('div', {}, el('small', { textContent: k }), v))),
    btn);
}

// ---------- Wishlist ----------
async function loadWishlist() {
  const items = await api('/api/wishlist');
  wishIds = new Set(items.map((p) => p.id));
  $('#wishCount').textContent = items.length;
  return items;
}
async function toggleWish(p, heartBtn) {
  const r = await api(`/api/wishlist/${p.id}`, { method: 'POST' });
  r.saved ? wishIds.add(p.id) : wishIds.delete(p.id);
  $('#wishCount').textContent = wishIds.size;
  if (heartBtn) { heartBtn.textContent = r.saved ? '♥' : '♡'; heartBtn.classList.toggle('on', r.saved); }
  toast(r.saved ? `${p.name} — в избранном 💚` : `${p.name} — убрано из избранного`);
}
$('#wishBtn').onclick = async () => {
  const items = await loadWishlist();
  openPanel(el('h3', { textContent: 'Избранное' }),
    items.length ? el('div', {}, items.map((p) => el('div', { className: 'wish-item' }, el('span', { textContent: p.emoji }), el('div', {}, el('b', { textContent: p.name }), el('div', { textContent: money(p.price_cents) })))))
      : el('p', { className: 'empty', textContent: 'Пока пусто. Нажмите ♡, чтобы начать свои джунгли.' }));
};

// ---------- Quiz ----------
$('#quiz').addEventListener('submit', async (e) => {
  e.preventDefault();
  const matches = await api('/api/match', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
  $('#matches').replaceChildren(...matches.map((p, i) => {
    const m = el('div', { className: 'match' },
      el('div', { className: 'rank', textContent: `#${i + 1}` }),
      el('div', { className: 'em', textContent: p.emoji }),
      el('b', { textContent: p.name }),
      el('p', { textContent: `${LIGHT[p.light]} · ${DIFF[p.difficulty]}` }));
    m.style.animationDelay = `${i * 150}ms`;
    m.onclick = () => openPlant(p);
    return m;
  }));
});

// ---------- Newsletter ----------
$('#subForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ email: e.target.email.value }) });
    toast(r.already ? 'Вы уже в клубе 🌿' : 'Добро пожаловать в клуб! 🌱');
    $('#community').textContent = `Нас уже ${r.community} — и становится больше.`;
    e.target.reset();
  } catch (err) { toast(err.message); }
});

loadWishlist().then(loadPlants);
