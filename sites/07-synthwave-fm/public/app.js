const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => n.append(k));
  return n;
};
let visitor;
try { visitor = localStorage.getItem('swfm-visitor'); } catch {}
if (!visitor) { visitor = crypto.randomUUID(); try { localStorage.setItem('swfm-visitor', visitor); } catch {} }

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Visitor': visitor } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2800);
}

// ---------- Procedural synthwave generator (WebAudio) ----------
let ac, master, analyser, playing = false, timer, step = 0, nextTime = 0;
const BPM = 100, STEP = 60 / BPM / 4;
const PROG = [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 52, 55]]; // Am F G Em
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function setupAudio() {
  ac = new AudioContext();
  master = ac.createGain(); master.gain.value = Number($('#volume').value);
  analyser = ac.createAnalyser(); analyser.fftSize = 256;
  const delay = ac.createDelay(); delay.delayTime.value = STEP * 3;
  const fb = ac.createGain(); fb.gain.value = 0.3;
  delay.connect(fb).connect(delay);
  master.connect(analyser).connect(ac.destination);
  master.connect(delay).connect(analyser);
}
function voice(freq, t, dur, { type = 'sawtooth', vol = 0.1, cutoff = 1800, attack = 0.01 } = {}) {
  const o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
  o.type = type; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = cutoff;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function drum(t, kind) {
  if (kind === 'kick') {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.3);
  } else {
    const buf = ac.createBuffer(1, ac.sampleRate * 0.2, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter();
    src.buffer = buf; f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1800;
    g.gain.setValueAtTime(kind === 'hat' ? 0.05 : 0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'hat' ? 0.05 : 0.18));
    src.connect(f).connect(g).connect(master); src.start(t);
  }
}
function schedule() {
  while (nextTime < ac.currentTime + 0.12) {
    const bar = Math.floor(step / 16) % PROG.length, s = step % 16, chord = PROG[bar];
    if (s % 4 === 0) drum(nextTime, 'kick');
    if (s === 4 || s === 12) drum(nextTime, 'snare');
    if (s % 2 === 1) drum(nextTime, 'hat');
    voice(mtof(chord[0] - 12), nextTime, STEP * 0.9, { vol: 0.12, cutoff: 500 + (s % 4) * 200 }); // driving bass
    if (s === 0) chord.forEach((n) => voice(mtof(n + 12), nextTime, STEP * 15, { vol: 0.035, cutoff: 2400, attack: 0.4 })); // pad
    if ([0, 3, 6, 10, 12].includes(s) && Math.random() > 0.25) voice(mtof(chord[((s / 3) | 0) % 4] + 24), nextTime, STEP * 2, { type: 'square', vol: 0.03, cutoff: 3500 }); // lead arp
    nextTime += STEP; step++;
  }
}
async function togglePlay() {
  if (!ac) setupAudio();
  if (ac.state === 'suspended') await ac.resume();
  playing = !playing;
  $('#playBtn').textContent = playing ? '❚❚' : '▶';
  $('#playBtn').classList.toggle('on', playing);
  if (playing) { nextTime = ac.currentTime + 0.05; timer = setInterval(schedule, 25); refreshNow(); }
  else clearInterval(timer);
}
$('#playBtn').onclick = togglePlay;
$('#volume').oninput = (e) => master && (master.gain.value = Number(e.target.value));

// ---------- Visualizer ----------
const cvs = $('#viz'), ctx = cvs.getContext('2d');
(function draw() {
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  const bars = 64, w = cvs.width / bars;
  const data = new Uint8Array(128);
  if (analyser && playing) analyser.getByteFrequencyData(data);
  for (let i = 0; i < bars; i++) {
    const v = playing ? data[i] / 255 : 0.04 + Math.sin(Date.now() / 400 + i / 3) * 0.03;
    const h = Math.max(3, v * cvs.height);
    const g = ctx.createLinearGradient(0, cvs.height, 0, cvs.height - h);
    g.addColorStop(0, '#7b2cbf'); g.addColorStop(0.6, '#ff2a6d'); g.addColorStop(1, '#05d9e8');
    ctx.fillStyle = g; ctx.shadowBlur = 12; ctx.shadowColor = '#ff2a6d';
    ctx.fillRect(i * w + 2, cvs.height - h, w - 4, h);
  }
  requestAnimationFrame(draw);
})();

// ---------- Now playing / schedule / requests ----------
async function refreshNow() {
  const n = await api('/api/now');
  $('#listeners').textContent = n.listeners.toLocaleString('en-US');
  if (n.show) { $('#showTitle').textContent = n.show.title; $('#showHost').textContent = n.show.host; }
  if (playing) {
    $('#trackLine').textContent = n.track ? `${n.track.artist} — ${n.track.title}` : 'Synthwave FM · Live generated mix';
    $('#dedication').textContent = n.track?.dedication ? `“${n.track.dedication}” — ${n.track.requested_by}` : n.track ? `requested by ${n.track.requested_by}` : '';
  }
}
async function loadSchedule() {
  const { shows } = await api('/api/schedule');
  $('#schedule').replaceChildren(...shows.map((s) => {
    const li = el('li', { className: s.live ? 'live' : '' },
      el('span', { className: 'time', textContent: `${String(s.start_hour).padStart(2, '0')}:00 – ${String(s.end_hour % 24).padStart(2, '0')}:00` }),
      el('b', { textContent: s.title }), el('small', { textContent: `${s.host} · ${s.vibe}` }));
    li.style.setProperty('--c', s.color);
    return li;
  }));
}
async function loadQueue() {
  const rows = await api('/api/requests');
  $('#queue').replaceChildren(...rows.map((r, i) => {
    const vote = el('button', { className: `vote ${r.voted ? 'on' : ''}`, textContent: `▲ ${r.votes}` });
    vote.onclick = async () => { await api(`/api/requests/${r.id}/vote`, { method: 'POST' }); loadQueue(); };
    const li = el('li', {}, el('span', { className: 'pos', textContent: String(i + 1).padStart(2, '0') }),
      el('div', { className: 'song' }, el('b', { textContent: `${r.artist} — ${r.title}` }), el('small', { textContent: r.dedication ? `“${r.dedication}” · @${r.requested_by}` : `@${r.requested_by}` })),
      vote);
    li.style.animationDelay = `${i * 40}ms`;
    return li;
  }));
}
$('#reqForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/requests', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
    e.target.reset(); toast('📼 REQUEST RECEIVED!'); loadQueue(); refreshNow();
  } catch (err) { toast(err.message); }
});
$('#djNext').onclick = async () => {
  try { await api('/api/requests/next', { method: 'POST' }); toast('⏭ NEXT TRACK SPINNING'); loadQueue(); refreshNow(); }
  catch (err) { toast(err.message); }
};

loadSchedule(); loadQueue(); refreshNow();
setInterval(refreshNow, 15000);
setInterval(loadSchedule, 60000);
