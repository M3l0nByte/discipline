'use strict';

/* DISCIPLINE dashboard.
   Storage strategy: if the browser extension is installed, it owns the data and
   this page talks to it over a postMessage bridge. Without the extension the
   page falls back to localStorage, so the site works on its own too. */

const $ = (id) => document.getElementById(id);

const MILESTONE_DAYS = [1, 3, 7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365];

// ---------------------------------------------------------------------------
// Extension bridge
// ---------------------------------------------------------------------------
const Bridge = (() => {
  const pending = new Map();
  let seq = 0;
  let present = false;
  let ready = null;

  function init() {
    if (ready) return ready;
    ready = new Promise((resolve) => {
      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.source !== 'discipline-ext') return;

        if (msg.type === 'hello-ack') {
          present = true;
          resolve(true);
          return;
        }
        if (msg.type === 'response' && pending.has(msg.id)) {
          const entry = pending.get(msg.id);
          pending.delete(msg.id);
          entry.resolve(msg.result);
        }
      });

      window.postMessage({ source: 'discipline-page', type: 'hello' }, '*');
      // Give the content script a moment to answer before falling back.
      setTimeout(() => resolve(present), 400);
    });
    return ready;
  }

  function call(action, payload) {
    return new Promise((resolve, reject) => {
      const id = `r${++seq}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('extension did not answer'));
      }, 4000);
      pending.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
      });
      window.postMessage({ source: 'discipline-page', type: 'request', id, action, payload }, '*');
    });
  }

  return { init, call, get present() { return present; } };
})();

// ---------------------------------------------------------------------------
// Local (extension-less) storage
// ---------------------------------------------------------------------------
const LocalStore = (() => {
  const KEY = 'discipline.state.v1';
  let state = DisciplineState.migrate(read());

  function read() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (err) {
      return null;
    }
  }
  function commit() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('could not persist state', err);
    }
    return state;
  }

  return {
    get raw() { return state; },
    summary() { return DisciplineState.buildSummary(state); },
    checkin() { const r = DisciplineState.checkIn(state); commit(); return { ...r, summary: this.summary() }; },
    relapse(note) { const r = DisciplineState.relapse(state, { note }); commit(); return { ...r, summary: this.summary() }; },
    urge() { const r = DisciplineState.logUrge(state); commit(); return { ...r, summary: this.summary() }; },
    blocklist() {
      return {
        blocklist: state.blocklist,
        pathRules: state.pathRules,
        safeHints: DisciplineBlocklist.SAFE_HINTS,
        defaults: DisciplineBlocklist.DEFAULT_BLOCKLIST,
      };
    },
    addBlock(domain) { const r = DisciplineState.addBlock(state, domain); commit(); return r; },
    removeBlock(domain) { const r = DisciplineState.removeBlock(state, domain); commit(); return r; },
    settings(patch) { const r = DisciplineState.updateSettings(state, patch); commit(); return { settings: r, summary: this.summary() }; },
    reset() { state = DisciplineState.createInitialState(); commit(); return { ok: true, summary: this.summary() }; },
  };
})();

// ---------------------------------------------------------------------------
// Store facade: prefer the extension, fall back to this browser
// ---------------------------------------------------------------------------
const Store = {
  mode: 'local',

  async init() {
    const hasExtension = await Bridge.init();
    this.mode = hasExtension ? 'extension' : 'local';
    if (hasExtension) {
      // Seed the extension from this browser the first time we meet it, so an
      // existing local streak is not lost when the extension is installed.
      const ext = await Bridge.call('summary').catch(() => null);
      if (ext && ext.ok && ext.summary && ext.summary.xp === 0 && LocalStore.raw.xp > 0) {
        await Bridge.call('import', { state: LocalStore.raw }).catch(() => {});
      }
    }
    updateConn();
  },

  async summary() {
    if (this.mode === 'extension') {
      const r = await Bridge.call('summary');
      if (r && r.ok) return r.summary;
      this.mode = 'local';
      updateConn();
    }
    return LocalStore.summary();
  },

  async checkin() {
    if (this.mode === 'extension') return Bridge.call('checkin');
    return LocalStore.checkin();
  },
  async relapse(note) {
    if (this.mode === 'extension') return Bridge.call('relapse', { note });
    return LocalStore.relapse(note);
  },
  async urge() {
    if (this.mode === 'extension') return Bridge.call('urge');
    return LocalStore.urge();
  },
  async blocklist() {
    if (this.mode === 'extension') {
      const r = await Bridge.call('blocklist');
      if (r && r.ok) return r.data;
    }
    return LocalStore.blocklist();
  },
  async addBlock(domain) {
    if (this.mode === 'extension') return Bridge.call('addBlock', { domain });
    return LocalStore.addBlock(domain);
  },
  async removeBlock(domain) {
    if (this.mode === 'extension') return Bridge.call('removeBlock', { domain });
    return LocalStore.removeBlock(domain);
  },
  async settings(patch) {
    if (this.mode === 'extension') return Bridge.call('settings', patch);
    return LocalStore.settings(patch);
  },
  async reset() {
    if (this.mode === 'extension') return Bridge.call('reset');
    return LocalStore.reset();
  },
};

function updateConn() {
  const el = $('connStatus');
  if (!el) return;
  const linked = Store.mode === 'extension';
  el.classList.toggle('is-off', !linked);
  el.querySelector('span').textContent = linked ? 'linked to extension' : 'browser storage';
  el.title = linked
    ? 'Connected to the DISCIPLINE browser extension'
    : 'No extension detected — saving in this browser only';
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
let summary = null;
let lastLevel = null;

function fmtNum(n) { return Number(n || 0).toLocaleString(); }

function render() {
  if (!summary) return;
  const s = summary;

  $('levelValue').textContent = s.level;
  $('rankTitle').textContent = s.title;
  $('rankRing').style.setProperty('--p', Math.max(0, Math.min(1, s.progress)).toFixed(4));

  $('streakValue').textContent = s.streak;
  $('streakUnit').textContent = s.streak === 1 ? 'day' : 'days';
  $('streakFlame').classList.toggle('is-cold', s.streak === 0);
  $('heroSub').textContent = s.today.checkedIn
    ? `Logged for today. Streak at ${s.streak} — come back tomorrow.`
    : s.streak === 0
      ? 'Press the button. One clean day = XP.'
      : `Keep it going. Day ${s.streak + 1} is waiting.`;

  const pct = Math.round(Math.max(0, Math.min(1, s.progress)) * 100);
  $('xpFill').style.width = `${pct}%`;
  $('xpText').textContent = `${fmtNum(s.xpIntoLevel)} / ${fmtNum(s.xpForNextLevel)} XP`;
  $('xpNext').textContent = `${fmtNum(s.xpToNextLevel)} XP to level ${s.level + 1}`;

  $('statBest').textContent = s.bestStreak;
  $('statClean').textContent = s.totalCleanDays;
  $('statUrges').textContent = s.urgesResisted;
  $('statUrgesUnit').textContent = `today ${s.urgesToday}/${s.urgesCap}`;
  $('statRelapses').textContent = s.relapses;
  $('statXP').textContent = fmtNum(s.xp);

  const checkBtn = $('checkinBtn');
  checkBtn.disabled = s.today.checkedIn;
  checkBtn.querySelector('.btn__label').textContent = s.today.checkedIn ? 'Already logged today' : 'I stayed clean today';

  const ms = s.nextMilestone;
  if (ms) {
    $('msName').textContent = ms.name;
    $('msDays').textContent = ms.days;
    $('msHint').textContent = `${ms.remaining} ${ms.remaining === 1 ? 'day' : 'days'} to go · +${fmtNum(ms.bonus)} XP bonus`;
    $('msFill').style.width = `${Math.round((s.streak / ms.days) * 100)}%`;
  } else {
    $('msName').textContent = 'All milestones cleared';
    $('msDays').textContent = s.streak;
    $('msHint').textContent = 'You are past the map. Keep stacking days.';
    $('msFill').style.width = '100%';
  }

  $('strictToggle').setAttribute('aria-checked', String(s.settings.strictMode));
  $('nameInput').value = s.profile.name || '';
  $('offsetSelect').value = String(s.settings.offsetMinutes || 0);
  $('notifyToggle').checked = !!s.settings.notifications;

  renderHeatmap(s);
  renderFooter(s);
}

function renderHeatmap(s) {
  const host = $('heatmap');
  host.innerHTML = '';
  let clean = 0;
  let relapses = 0;

  s.recent.forEach((day) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const d = new Date(`${day.date}T00:00:00Z`);
    const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const isToday = day.date === s.today.date;

    if (day.kind === 'clean') {
      cell.classList.add('cell--clean');
      clean += 1;
      cell.textContent = String(day.streak || '');
    } else if (day.kind === 'relapse') {
      cell.classList.add('cell--relapse');
      relapses += 1;
      cell.textContent = '×';
    } else {
      cell.textContent = d.getUTCDate();
    }
    if (MILESTONE_DAYS.includes(day.streak) && day.kind === 'clean') cell.classList.add('cell--milestone');
    if (isToday) cell.classList.add('cell--today');

    cell.title = `${label}${day.kind === 'clean' ? ` · clean (day ${day.streak}) +${day.xp} XP${day.milestone ? ` · ${day.milestone}` : ''}` : day.kind === 'relapse' ? ' · relapse' : ' · no entry'}`;
    host.appendChild(cell);
  });

  $('historyFoot').textContent = `${clean} clean · ${relapses} ${relapses === 1 ? 'relapse' : 'relapses'} in the last 28 days.`;
}

function renderFooter(s) {
  $('footMeta').textContent = [
    `${s.blocklistCount} domains blocked`,
    `${s.pathRuleCount} path rules`,
    `best streak ${s.bestStreak}`,
  ].join('  ·  ');
}

function renderBlocklist(data) {
  $('blockCount').textContent = `${data.blocklist.length} domains`;
  $('pathRuleCount').textContent = data.pathRules.length;

  const chips = $('blockChips');
  chips.innerHTML = '';
  data.blocklist.forEach((domain) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('span');
    label.textContent = domain;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Unblock';
    btn.textContent = '✕';
    btn.addEventListener('click', () => removeBlock(domain));
    chip.append(label, btn);
    chips.appendChild(chip);
  });

  const pathChips = $('pathChips');
  pathChips.innerHTML = '';
  data.pathRules.forEach((rule) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = rule;
    pathChips.appendChild(chip);
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function loadAll() {
  try {
    summary = await Store.summary();
    if (lastLevel === null) lastLevel = summary.level;
    render();
    renderBlocklist(await Store.blocklist());
  } catch (err) {
    toast(`Could not load your data: ${err.message}`, 'warn');
  }
}

async function checkIn() {
  const btn = $('checkinBtn');
  btn.disabled = true;
  try {
    const result = await Store.checkin();
    summary = result.summary;
    if (result.alreadyCheckedIn) {
      toast('Already logged for today.');
      render();
      return;
    }
    render();
    const xp = result.totalXP;
    const unlocked = result.unlocked && result.unlocked.length ? result.unlocked[result.unlocked.length - 1] : null;
    if (result.summary.level > lastLevel) {
      celebrate('level up', `Level ${result.summary.level}`, `+${xp} XP today · ${result.summary.title}`);
    } else if (unlocked) {
      celebrate(`${unlocked.days} day milestone`, unlocked.name, `+${unlocked.bonus} XP bonus · +${xp} XP today`);
    } else {
      celebrate('clean day logged', `+${xp} XP`, `Streak ${result.summary.streak} · ${result.summary.xpToNextLevel} XP to level ${result.summary.level + 1}`);
    }
    lastLevel = result.summary.level;
    notify(`Day ${result.summary.streak} clean. +${xp} XP`, 'Nice work.');
  } catch (err) {
    toast(err.message, 'warn');
    render();
  }
}

async function relapse(note) {
  try {
    const result = await Store.relapse(note);
    summary = result.summary;
    render();
    toast(`Streak reset. You had <b>${result.lostStreak}</b> days. Total XP is safe.`, 'warn');
  } catch (err) {
    toast(err.message, 'warn');
  }
}

async function beatUrge() {
  try {
    const result = await Store.urge();
    summary = result.summary;
    render();
    if (result.capped) toast('Daily urge bonus is maxed. Still counted the win.', 'xp');
    else toast(`Urge beaten. <b>+${result.xp} XP</b> (${result.count}/${result.cap} today)`, 'xp');
  } catch (err) {
    toast(err.message, 'warn');
  }
}

async function addBlock(domain) {
  try {
    const result = await Store.addBlock(domain);
    if (!result.ok) {
      toast('That does not look like a domain.', 'warn');
      return;
    }
    if (result.already) toast('Already on the list.');
    renderBlocklist(await Store.blocklist());
    summary = await Store.summary();
    render();
  } catch (err) {
    toast(err.message, 'warn');
  }
}

async function removeBlock(domain) {
  try {
    await Store.removeBlock(domain);
    renderBlocklist(await Store.blocklist());
    summary = await Store.summary();
    render();
  } catch (err) {
    toast(err.message, 'warn');
  }
}

async function saveSettings() {
  try {
    const result = await Store.settings({
      name: $('nameInput').value.trim(),
      offsetMinutes: Number($('offsetSelect').value),
      notifications: $('notifyToggle').checked,
    });
    summary = result.summary;
    render();
    toast('Settings saved.');
  } catch (err) {
    toast(err.message, 'warn');
  }
}

async function toggleStrict() {
  const current = $('strictToggle').getAttribute('aria-checked') === 'true';
  try {
    const result = await Store.settings({ strictMode: !current });
    summary = result.summary;
    render();
  } catch (err) {
    toast(err.message, 'warn');
  }
}

async function resetAll() {
  if (!window.confirm('Reset everything? XP, streak, history and blocklist go back to defaults.')) return;
  try {
    const result = await Store.reset();
    summary = result.summary;
    lastLevel = summary.level;
    render();
    renderBlocklist(await Store.blocklist());
    toast('Everything reset. Day one starts now.');
  } catch (err) {
    toast(err.message, 'warn');
  }
}

// ---------------------------------------------------------------------------
// Celebration, toasts, notifications
// ---------------------------------------------------------------------------
function celebrate(kicker, big, sub) {
  $('celebrateKicker').textContent = kicker;
  $('celebrateBig').textContent = big;
  $('celebrateSub').textContent = sub;
  const burst = $('burst');
  burst.innerHTML = '';
  const colors = ['#c6f24e', '#ff6a2b', '#eef1f6', '#9bd321'];
  for (let i = 0; i < 28; i += 1) {
    const s = document.createElement('span');
    s.className = 'spark';
    const angle = (Math.PI * 2 * i) / 28;
    const dist = 120 + Math.random() * 200;
    s.style.left = '50%';
    s.style.top = '40%';
    s.style.background = colors[i % colors.length];
    s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    s.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    s.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    s.style.animationDelay = `${Math.random() * 0.12}s`;
    burst.appendChild(s);
  }
  $('celebrateOverlay').hidden = false;
}

function toast(html, kind = '') {
  const el = document.createElement('div');
  el.className = `toast${kind ? ` toast--${kind}` : ''}`;
  el.innerHTML = html;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.3s, transform 0.3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

function notify(title, body) {
  if (!summary || !summary.settings.notifications) return;
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'icon.svg' }); } catch (err) { /* ignore */ }
  }
}

function maybeAskNotifyPermission() {
  if (summary && summary.settings.notifications && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Panic breathing
// ---------------------------------------------------------------------------
let breathTimer = null;
function startBreathing() {
  const circle = $('breathCircle');
  const phase = $('breathPhase');
  let inhaling = false;
  const step = () => {
    inhaling = !inhaling;
    circle.classList.toggle('inhale', inhaling);
    circle.classList.toggle('exhale', !inhaling);
    phase.textContent = inhaling ? 'Breathe in' : 'Breathe out';
  };
  step();
  breathTimer = setInterval(step, 4000);
}
function stopBreathing() {
  if (breathTimer) clearInterval(breathTimer);
  breathTimer = null;
}
function closePanic() {
  $('panicOverlay').hidden = true;
  stopBreathing();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function wire() {
  $('checkinBtn').addEventListener('click', checkIn);
  $('panicBtn').addEventListener('click', () => { $('panicOverlay').hidden = false; startBreathing(); });
  $('panicClose').addEventListener('click', closePanic);
  $('panicDone').addEventListener('click', closePanic);
  $('urgeBtn').addEventListener('click', async () => { await beatUrge(); closePanic(); });

  $('relapseBtn').addEventListener('click', () => { $('relapseOverlay').hidden = false; $('relapseNote').value = ''; });
  $('relapseClose').addEventListener('click', () => { $('relapseOverlay').hidden = true; });
  $('relapseCancel').addEventListener('click', () => { $('relapseOverlay').hidden = true; });
  $('relapseConfirm').addEventListener('click', async () => {
    const note = $('relapseNote').value;
    $('relapseOverlay').hidden = true;
    await relapse(note);
  });

  $('celebrateClose').addEventListener('click', () => { $('celebrateOverlay').hidden = true; });

  $('addBlockForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = $('addBlockInput').value.trim();
    if (!value) return;
    $('addBlockInput').value = '';
    addBlock(value);
  });

  $('strictToggle').addEventListener('click', toggleStrict);
  $('saveSettings').addEventListener('click', saveSettings);
  $('resetBtn').addEventListener('click', resetAll);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('panicOverlay').hidden = true;
      $('relapseOverlay').hidden = true;
      $('celebrateOverlay').hidden = true;
      stopBreathing();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) checkIn();
  });

  document.querySelectorAll('.overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => {
      if (e.target === ov) {
        ov.hidden = true;
        stopBreathing();
      }
    });
  });

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadAll(); });
}

wire();
Store.init().then(loadAll).then(maybeAskNotifyPermission);
