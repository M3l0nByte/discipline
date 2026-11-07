'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;
const $ = (id) => document.getElementById(id);

function send(type, payload) {
  return api.runtime.sendMessage({ type, payload }).catch((err) => ({ ok: false, error: err.message }));
}

// The blocked URL travels in the query string that the rule set.
const params = new URLSearchParams(location.search);
const raw = params.get('url') || params.get('domain') || '';
let host = raw;
try { host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname; } catch (err) { /* keep raw */ }
$('domain').textContent = host || 'blocked site';

// Breathing pacer.
const breath = $('breath');
const phase = $('breathPhase');
let inhaling = false;
const step = () => {
  inhaling = !inhaling;
  breath.classList.toggle('inhale', inhaling);
  breath.classList.toggle('exhale', !inhaling);
  phase.textContent = inhaling ? 'Breathe in' : 'Breathe out';
};
step();
setInterval(step, 4000);

send('summary').then((res) => {
  if (!res.ok || !res.summary) return;
  const s = res.summary;
  $('streakDays').textContent = s.streak;
  $('streakLabel').textContent = `day streak · level ${s.level} ${s.title}`;
  $('streakBox').hidden = false;
  $('foot').textContent = `DISCIPLINE · level ${s.level} ${s.title} · ${s.xp} XP`;
});

$('urgeBtn').addEventListener('click', async () => {
  const res = await send('urge');
  $('urgeBtn').textContent = res.ok
    ? (res.capped ? 'Win counted — bonus maxed' : `Logged. +${res.xp} XP. Now walk away.`)
    : 'Now walk away.';
  $('urgeBtn').disabled = true;
});

$('closeBtn').addEventListener('click', () => {
  // Only works if this tab was opened by the user, otherwise fall back to home.
  api.tabs.getCurrent().then((tab) => {
    if (tab) api.tabs.remove(tab.id);
    else api.tabs.update({ url: 'about:newtab' });
  }).catch(() => {});
});
