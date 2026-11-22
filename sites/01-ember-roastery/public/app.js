const $ = (s, el = document) => el.querySelector(s);
const money = (c) => `${Math.round(c / 100).toLocaleString('ru-RU')} ₽`;
const CATS = { espresso: 'эспрессо', filter: 'фильтр', beans: 'зерно', bakery: 'выпечка' };
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

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- Menu ----------
let products = [];
async function loadMenu(cat = '') {
  products = await api(`/api/products${cat ? `?category=${cat}` : ''}`);
  const grid = $('#menuGrid');
  grid.replaceChildren(
    ...products.map((p, i) => {
      const card = el('article', { className: 'item' },
        el('span', { className: 'cat', textContent: CATS[p.category] }),
        el('h3', { textContent: p.name }),
        el('p', { className: 'origin', textContent: p.origin }),
        el('p', { className: 'notes', textContent: p.notes }),
        el('div', { className: 'roast', title: `Степень обжарки ${p.roast}/5` },
          [1, 2, 3, 4, 5].map((n) => el('i', { className: n <= p.roast ? 'on' : '' }))),
        el('div', { className: 'item-foot' },
          el('span', { className: 'price', textContent: money(p.price_cents) }),
          el('button', { className: 'add', textContent: '+', ariaLabel: `Добавить ${p.name}`, onclick: () => addToCart(p) })),
      );
      card.style.animationDelay = `${i * 60}ms`;
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
      return card;
    }),
  );
}

$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
  loadMenu(btn.dataset.cat);
});

// ---------- Cart (persisted in localStorage) ----------
let cart = [];
try { cart = JSON.parse(localStorage.getItem('ember-cart')) || []; } catch { cart = []; }
const saveCart = () => { try { localStorage.setItem('ember-cart', JSON.stringify(cart)); } catch {} };

function addToCart(p) {
  const line = cart.find((l) => l.id === p.id);
  if (line) line.qty = Math.min(20, line.qty + 1);
  else cart.push({ id: p.id, name: p.name, price_cents: p.price_cents, qty: 1 });
  renderCart();
  const badge = $('#cartCount');
  badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
  toast(`${p.name} — в корзине ☕`);
}

function renderCart() {
  saveCart();
  $('#cartCount').textContent = cart.reduce((s, l) => s + l.qty, 0);
  $('#cartTotal').textContent = money(cart.reduce((s, l) => s + l.qty * l.price_cents, 0));
  const list = $('#cartList');
  if (!cart.length) return list.replaceChildren(el('li', { className: 'empty', textContent: 'Корзина пуста — самое время взять что-нибудь тёплое.' }));
  list.replaceChildren(...cart.map((l) =>
    el('li', {},
      el('span', { textContent: l.name }),
      el('div', { className: 'qty' },
        el('button', { textContent: '−', onclick: () => { l.qty--; cart = cart.filter((x) => x.qty > 0); renderCart(); } }),
        el('span', { textContent: l.qty }),
        el('button', { textContent: '+', onclick: () => { l.qty = Math.min(20, l.qty + 1); renderCart(); } })),
      el('span', { textContent: money(l.qty * l.price_cents) }))));
}

const drawer = $('#drawer'), overlay = $('#overlay');
const toggleDrawer = (open) => { drawer.classList.toggle('open', open); overlay.classList.toggle('show', open); drawer.setAttribute('aria-hidden', String(!open)); };
$('#cartBtn').onclick = () => toggleDrawer(true);
$('#closeDrawer').onclick = overlay.onclick = () => toggleDrawer(false);

$('#orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const order = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ ...Object.fromEntries(f), items: cart.map(({ id, qty }) => ({ id, qty })) }),
    });
    cart = []; renderCart(); e.target.reset(); toggleDrawer(false);
    toast(`Заказ №${order.id} принят — ждём вас в ${order.pickup_time}!`);
  } catch (err) { toast(err.message); }
});

// ---------- Reviews ----------
let rating = 5;
const stars = document.querySelectorAll('#starPicker button');
const paintStars = () => stars.forEach((s) => s.classList.toggle('on', Number(s.dataset.v) <= rating));
stars.forEach((s) => (s.onclick = () => { rating = Number(s.dataset.v); paintStars(); }));
paintStars();

async function loadReviews() {
  const { reviews, stats } = await api('/api/reviews');
  $('#ratingSummary').textContent = `★ ${stats.avg ?? '–'} · ${stats.count} отзывов`;
  $('#reviews-list').replaceChildren(...reviews.map((r) =>
    el('article', { className: 'review' },
      el('div', { className: 'stars-view', textContent: '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) }),
      el('p', { textContent: `“${r.body}”` }),
      el('span', { className: 'who', textContent: `— ${r.author}` }))));
}

$('#reviewForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    await api('/api/reviews', { method: 'POST', body: JSON.stringify({ ...f, rating }) });
    e.target.reset(); rating = 5; paintStars();
    toast('Спасибо за тёплые слова!');
    loadReviews();
  } catch (err) { toast(err.message); }
});

// ---------- Scroll reveal ----------
const io = new IntersectionObserver((entries) => entries.forEach((en) => {
  if (en.isIntersecting) { en.target.classList.add('visible'); io.unobserve(en.target); }
}), { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach((n) => io.observe(n));

loadMenu();
loadReviews();
renderCart();
