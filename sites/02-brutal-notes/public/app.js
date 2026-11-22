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
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2500);
}
const ago = (iso) => {
  const s = (Date.now() - new Date(iso.replace(' ', 'T') + 'Z')) / 1000;
  if (s < 60) return 'JUST NOW';
  if (s < 3600) return `${Math.floor(s / 60)} MIN AGO`;
  if (s < 86400) return `${Math.floor(s / 3600)} H AGO`;
  return `${Math.floor(s / 86400)} DAYS AGO`;
};

let state = { q: '', tag: '', editing: null };

async function refresh() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.tag) params.set('tag', state.tag);
  const [notes, tags, stats] = await Promise.all([api(`/api/notes?${params}`), api('/api/tags'), api('/api/stats')]);

  $('#stats').replaceChildren(
    el('span', { textContent: `${stats.total} NOTES` }),
    el('span', { textContent: `${stats.pinned || 0} PINNED` }),
    el('span', { textContent: `${stats.tags} TAGS` }),
  );

  $('#tagBar').replaceChildren(
    el('button', { className: `tag ${state.tag ? '' : 'active'}`, textContent: '#ALL', onclick: () => { state.tag = ''; refresh(); } }),
    ...tags.map((t) => el('button', {
      className: `tag ${state.tag === t.name ? 'active' : ''}`,
      textContent: `#${t.name} (${t.count})`,
      onclick: () => { state.tag = state.tag === t.name ? '' : t.name; refresh(); },
    })),
  );

  $('#empty').hidden = notes.length > 0;
  $('#board').replaceChildren(...notes.map((n, i) => {
    const card = el('article', { className: `note ${n.color}`, tabIndex: 0 },
      el('button', {
        className: `pin ${n.pinned ? 'on' : ''}`, textContent: '📌', title: n.pinned ? 'Unpin' : 'Pin',
        onclick: async (e) => { e.stopPropagation(); await api(`/api/notes/${n.id}/pin`, { method: 'PATCH' }); refresh(); },
      }),
      el('h3', { textContent: n.title }),
      el('p', { textContent: n.body }),
      el('div', { className: 'meta' },
        el('div', { className: 'chips' }, n.tags.map((t) => el('span', { textContent: `#${t}` }))),
        el('time', { textContent: ago(n.updated_at) })),
    );
    card.style.animationDelay = `${i * 50}ms`;
    card.onclick = () => openEditor(n);
    card.onkeydown = (e) => { if (e.key === 'Enter') openEditor(n); };
    return card;
  }));
}

const dlg = $('#editor'), form = $('#noteForm');
function openEditor(note = null) {
  state.editing = note;
  form.reset();
  $('#dlgTitle').textContent = note ? 'EDIT NOTE' : 'NEW NOTE';
  $('#deleteBtn').hidden = !note;
  if (note) {
    form.elements.title.value = note.title;
    form.elements.body.value = note.body;
    form.elements.tags.value = note.tags.join(', ');
    form.elements.pinned.checked = note.pinned;
    form.querySelector(`input[name=color][value=${note.color}]`).checked = true;
  }
  dlg.showModal();
  form.elements.title.focus();
}

$('#newBtn').onclick = () => openEditor();
$('#closeDlg').onclick = () => dlg.close();
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: form.elements.title.value,
    body: form.elements.body.value,
    color: form.elements.color.value,
    pinned: form.elements.pinned.checked,
    tags: form.elements.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
  };
  try {
    if (state.editing) await api(`/api/notes/${state.editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/notes', { method: 'POST', body: JSON.stringify(payload) });
    dlg.close();
    toast(state.editing ? 'SAVED.' : 'NOTE CREATED. BOOM.');
    refresh();
  } catch (err) { toast(err.message.toUpperCase()); }
});

$('#deleteBtn').onclick = async () => {
  if (!state.editing) return;
  await api(`/api/notes/${state.editing.id}`, { method: 'DELETE' });
  dlg.close();
  toast('DELETED. GONE. FOREVER.');
  refresh();
};

let debounce;
$('#search').addEventListener('input', (e) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => { state.q = e.target.value; refresh(); }, 250);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'n' && !dlg.open && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); openEditor(); }
});

refresh();
