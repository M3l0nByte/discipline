'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;
const $ = (id) => document.getElementById(id);

function send(type, payload) {
  return api.runtime.sendMessage({ type, payload }).catch((err) => ({ ok: false, error: err.message }));
}

function status(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = `status${kind ? ` status--${kind}` : ''}`;
}

function syncStatus(text, kind) {
  const el = $('syncStatus');
  el.textContent = text;
  el.className = `status${kind ? ` status--${kind}` : ''}`;
}

async function load() {
  const res = await send('status');
  if (!res.ok) {
    status('Could not read settings.', 'warn');
    return;
  }
  $('siteUrl').value = res.siteUrl || '';
  $('enabledToggle').checked = !!res.enabled;
  $('notificationsToggle').checked = !!res.notifications;

  const when = res.lastSync ? new Date(res.lastSync).toLocaleString() : 'never';
  if (res.error) syncStatus(`Rule error: ${res.error}`, 'warn');
  else syncStatus(`${res.ruleCount} rules active · last rebuilt ${when}`, 'ok');
}

$('saveBtn').addEventListener('click', async () => {
  const url = $('siteUrl').value.trim();
  if (url && !/^https?:\/\//.test(url)) {
    status('The URL must start with http:// or https://', 'warn');
    return;
  }
  const saved = await send('setSiteUrl', { siteUrl: url });
  const synced = await send('sync');
  if (saved.ok && synced.ok) status('Saved and rules rebuilt.', 'ok');
  else status('Saved, but the rules failed to rebuild.', 'warn');
});

$('openSiteBtn').addEventListener('click', async () => {
  const res = await send('status');
  const url = (res.ok && res.siteUrl) || 'https://m3l0nbyte.github.io/discipline/';
  api.tabs.create({ url });
});

$('enabledToggle').addEventListener('change', async (e) => {
  await send('setEnabled', { enabled: e.target.checked });
  status(e.target.checked ? 'Blocking enabled.' : 'Blocking paused.', 'ok');
});

$('notificationsToggle').addEventListener('change', async (e) => {
  await send('settings', { notifications: e.target.checked });
  status(e.target.checked ? 'Reminders on.' : 'Reminders off.', 'ok');
});

$('syncBtn').addEventListener('click', async () => {
  const res = await send('sync');
  if (res.ok) syncStatus(`Rebuilt ${res.count} rules just now.`, 'ok');
  else syncStatus(`Rebuild failed: ${res.error}`, 'warn');
});

load();
