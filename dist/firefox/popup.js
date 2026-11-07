'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;
const $ = (id) => document.getElementById(id);

function send(type, payload) {
  return api.runtime.sendMessage({ type, payload }).catch((err) => ({ ok: false, error: err.message }));
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

function setStatus(ok, text) {
  $('statusDot').classList.toggle('off', !ok);
  $('statusText').textContent = text;
}

function render(s) {
  $('level').textContent = s.level;
  $('title').textContent = s.title;
  $('ring').style.setProperty('--p', Math.max(0, Math.min(1, s.progress)).toFixed(4));
  $('xpFill').style.width = `${Math.round(Math.max(0, Math.min(1, s.progress)) * 100)}%`;
  $('xpText').textContent = `${s.xpIntoLevel} / ${s.xpForNextLevel} XP`;
  $('xpNext').textContent = `${s.xpToNextLevel} to LVL ${s.level + 1}`;
  $('streak').textContent = s.streak;
  $('streakUnit').textContent = s.streak === 1 ? 'day clean' : 'days clean';
  $('flame').classList.toggle('is-cold', s.streak === 0);
  $('best').textContent = s.bestStreak;
  $('clean').textContent = s.totalCleanDays;
  $('urges').textContent = s.urgesResisted;

  const btn = $('checkinBtn');
  btn.disabled = s.today.checkedIn;
  btn.textContent = s.today.checkedIn ? 'Logged for today ✓' : 'I stayed clean today';
}

async function refresh() {
  const [summary, status] = await Promise.all([send('summary'), send('status')]);
  if (summary.ok && summary.summary) render(summary.summary);
  if (status.ok) {
    $('enabledToggle').checked = !!status.enabled;
    const when = status.lastSync ? new Date(status.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'never';
    setStatus(true, status.error ? 'rule error' : `blocking · synced ${when}`);
  }
}

$('checkinBtn').addEventListener('click', async () => {
  $('checkinBtn').disabled = true;
  const res = await send('checkin');
  if (res.ok) {
    toast(res.alreadyCheckedIn ? 'Already logged for today.' : `Day ${res.streak} logged. +${res.totalXP} XP.`);
    if (res.summary) render(res.summary);
  } else {
    toast(`Could not log: ${res.error || 'error'}`);
    $('checkinBtn').disabled = false;
  }
});

$('urgeBtn').addEventListener('click', async () => {
  const res = await send('urge');
  if (res.ok) {
    toast(res.capped ? 'Daily urge bonus maxed.' : `Urge beaten. +${res.xp} XP.`);
    if (res.summary) render(res.summary);
  } else {
    toast('Could not log the urge.');
  }
});

$('dashboardBtn').addEventListener('click', async () => {
  const status = await send('status');
  const url = (status.ok && status.siteUrl) || 'https://m3l0nbyte.github.io/discipline/';
  api.tabs.create({ url });
});

$('optionsBtn').addEventListener('click', () => api.runtime.openOptionsPage());

$('enabledToggle').addEventListener('change', async (e) => {
  const res = await send('setEnabled', { enabled: e.target.checked });
  if (res.ok) {
    toast(e.target.checked ? 'Blocking on.' : 'Blocking off.');
    setStatus(true, e.target.checked ? 'blocking' : 'paused');
  }
});

refresh();
