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
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
const starStr = (r) => (r ? '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r)) : '☆☆☆☆☆');
const TAPES = ['rgba(243,182,31,.7)', 'rgba(126,161,107,.7)', 'rgba(118,181,197,.7)', 'rgba(228,87,46,.55)'];
const fmtQty = (q) => {
  if (q == null) return '';
  const whole = Math.floor(q), frac = q - whole;
  const fr = [[0.25, '¼'], [0.33, '⅓'], [0.5, '½'], [0.66, '⅔'], [0.75, '¾']].find(([v]) => Math.abs(frac - v) < 0.04);
  if (fr) return `${whole || ''}${fr[1]}`;
  return q >= 10 ? String(Math.round(q)) : String(Math.round(q * 10) / 10);
};

let state = { q: '', tag: '' };

// ---------- Board ----------
async function loadBoard() {
  const params = new URLSearchParams({ sort: $('#sort').value });
  if (state.q) params.set('q', state.q);
  if (state.tag) params.set('tag', state.tag);
  const recipes = await api(`/api/recipes?${params}`);
  const board = $('#board');
  if (!recipes.length) return board.replaceChildren(el('p', { className: 'empty', textContent: 'в кладовке такого нет… попробуйте другое слово!' }));
  board.replaceChildren(...recipes.map((r, i) => {
    const card = el('article', { className: 'card', tabIndex: 0 },
      el('div', { className: 'em', textContent: r.emoji }),
      el('h3', { textContent: r.title }),
      el('p', { textContent: r.summary }),
      el('div', { className: 'meta' },
        el('span', { className: 'stars', textContent: starStr(r.rating), title: `рейтинг ${r.rating ?? '—'} · голосов: ${r.rating_count}` }),
        el('span', { textContent: `⏱ ${r.minutes} мин · 💬 ${r.comment_count}` })));
    card.style.setProperty('--r', `${((i * 37) % 7) - 3}deg`);
    card.style.setProperty('--tr', `${((i * 53) % 9) - 4}deg`);
    card.style.setProperty('--tape', TAPES[i % TAPES.length]);
    card.style.animationDelay = `${i * 70}ms`;
    card.onclick = () => openRecipe(r.id);
    card.onkeydown = (e) => e.key === 'Enter' && openRecipe(r.id);
    return card;
  }));
}

async function loadTags() {
  const tags = await api('/api/tags');
  const render = () => $('#tags').replaceChildren(...['все', ...tags].map((t) => {
    const b = el('button', { className: `tag ${(state.tag || 'все') === t ? 'on' : ''}`, textContent: t });
    b.onclick = () => { state.tag = t === 'все' ? '' : t; render(); loadBoard(); };
    return b;
  }));
  render();
  $('#tagSelect').replaceChildren(...tags.map((t) => el('option', { value: t, textContent: t })));
}
let deb; $('#q').oninput = (e) => { clearTimeout(deb); deb = setTimeout(() => { state.q = e.target.value.trim(); loadBoard(); }, 250); };
$('#sort').onchange = loadBoard;

// ---------- Recipe page ----------
const book = $('#book');
const closeBook = () => { book.hidden = true; document.body.style.overflow = ''; };
book.addEventListener('click', (e) => e.target === book && closeBook());
addEventListener('keydown', (e) => e.key === 'Escape' && !book.hidden && closeBook());

async function openRecipe(id) {
  const r = await api(`/api/recipes/${id}`);
  let servings = r.servings;
  const ingList = el('ul', { className: 'ing' });
  const servingsLabel = el('b', { textContent: servings });
  const renderIng = () => {
    servingsLabel.textContent = servings;
    ingList.replaceChildren(...r.ingredients.map((i) => {
      const li = el('li', {}, el('span', {}, el('b', { textContent: `${fmtQty(i.qty == null ? null : (i.qty * servings) / r.servings)} ${i.unit} `.trimStart() }), i.item));
      li.onclick = () => li.classList.toggle('got');
      return li;
    }));
  };
  renderIng();

  const rate = el('span', { className: 'rate' });
  [1, 2, 3, 4, 5].forEach((n) => {
    const b = el('button', { textContent: '★', title: `${n} из 5` });
    b.onmouseenter = () => rate.querySelectorAll('button').forEach((x, i) => x.classList.toggle('hov', i < n));
    b.onclick = async () => {
      const res = await api(`/api/recipes/${id}/rate`, { method: 'POST', body: JSON.stringify({ stars: n }) });
      ratingLine.textContent = `${starStr(res.rating)} ${res.rating} (${res.rating_count})`;
      toast(`спасибо за ${n}★!`); loadBoard();
    };
    rate.append(b);
  });
  rate.onmouseleave = () => rate.querySelectorAll('button').forEach((x) => x.classList.remove('hov'));
  const ratingLine = el('span', { className: 'stars', textContent: `${starStr(r.rating)} ${r.rating ?? '–'} (${r.rating_count})` });

  const commentsBox = el('div');
  const renderComments = (list) => commentsBox.replaceChildren(...(list.length ? list.map((c, i) => {
    const n = el('div', { className: 'comment' }, el('b', { textContent: `${c.author}: ` }), c.body);
    n.style.setProperty('--r', `${(i % 2 ? 0.6 : -0.6)}deg`);
    return n;
  }) : [el('p', { className: 'by', textContent: 'заметок пока нет — будьте первым!' })]));
  renderComments(r.comments);

  const cForm = el('form', { className: 'comment-form' },
    el('input', { name: 'author', placeholder: 'ваше имя', maxLength: 50 }),
    el('input', { name: 'body', placeholder: 'оставьте заметку к рецепту…', maxLength: 600, required: true }),
    el('button', { className: 'sticker', type: 'submit', textContent: 'приклеить' }));
  cForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/recipes/${id}/comments`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(cForm))) });
      cForm.reset(); renderComments((await api(`/api/recipes/${id}`)).comments); loadBoard();
    } catch (err) { toast(err.message); }
  };

  const minus = el('button', { textContent: '−', type: 'button', onclick: () => { if (servings > 1) { servings--; renderIng(); } } });
  const plus = el('button', { textContent: '+', type: 'button', onclick: () => { if (servings < 48) { servings++; renderIng(); } } });

  $('#page').replaceChildren(
    el('button', { className: 'close', textContent: '✕', onclick: closeBook, ariaLabel: 'Закрыть' }),
    el('header', {},
      el('h2', { textContent: `${r.emoji} ${r.title}` }),
      el('p', { className: 'by', textContent: `с кухни: ${r.author}` }),
      el('div', { className: 'facts' },
        el('span', { textContent: `⏱ ${r.minutes} минут` }),
        el('span', { className: 'scaler' }, '🍽 порций: ', minus, servingsLabel, plus),
        ratingLine)),
    el('div', { className: 'cols' },
      el('section', {}, el('h3', { textContent: 'понадобится' }), ingList),
      el('section', {}, el('h3', { textContent: 'приготовление' }), el('ol', { className: 'steps' }, r.steps.map((s) => el('li', { textContent: s }))))),
    el('section', { className: 'comments' },
      el('h3', { textContent: 'оцените' }), rate,
      el('h3', { textContent: 'кухонные заметки' }), commentsBox, cForm));
  book.hidden = false; document.body.style.overflow = 'hidden';
  $('#page').scrollTop = 0;
  // retrigger flip animation
  $('#page').style.animation = 'none'; void $('#page').offsetWidth; $('#page').style.animation = '';
}

// ---------- New recipe form ----------
const dlg = $('#newDlg'), nf = $('#newForm');
const ingRow = () => {
  const row = el('div', { className: 'ing-row' },
    el('input', { placeholder: 'кол-во', type: 'number', step: 'any', min: 0, className: 'i-qty' }),
    el('input', { placeholder: 'ед.', maxLength: 12, className: 'i-unit' }),
    el('input', { placeholder: 'ингредиент', maxLength: 80, className: 'i-item' }),
    el('button', { type: 'button', className: 'rm', textContent: '×', onclick: () => row.remove() }));
  $('#ingRows').append(row);
};
const stepRow = () => {
  const row = el('div', { className: 'step-row' },
    el('input', { placeholder: `шаг ${$('#stepRows').children.length + 1}`, maxLength: 500, className: 's-body' }),
    el('button', { type: 'button', className: 'rm', textContent: '×', onclick: () => row.remove() }));
  $('#stepRows').append(row);
};
$('#addIng').onclick = ingRow; $('#addStep').onclick = stepRow;
$('#newBtn').onclick = () => {
  nf.reset(); $('#ingRows').replaceChildren(); $('#stepRows').replaceChildren();
  ingRow(); ingRow(); ingRow(); stepRow(); stepRow();
  dlg.showModal();
};
$('#cancelNew').onclick = () => dlg.close();
nf.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(nf));
  f.ingredients = [...nf.querySelectorAll('.ing-row')].map((r) => ({ qty: $('.i-qty', r).value, unit: $('.i-unit', r).value, item: $('.i-item', r).value }));
  f.steps = [...nf.querySelectorAll('.s-body')].map((i) => i.value);
  try {
    const { id } = await api('/api/recipes', { method: 'POST', body: JSON.stringify(f) });
    dlg.close(); toast('рецепт на доске! 📌');
    state.tag = ''; await loadTags(); await loadBoard(); openRecipe(id);
  } catch (err) { toast(err.message); }
});

loadTags(); loadBoard();
