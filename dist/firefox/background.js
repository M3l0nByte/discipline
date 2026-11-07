'use strict';

/* DISCIPLINE background worker.
   The extension owns the canonical state, so the score follows you across every
   site. The website reads it through the page bridge in content.js.

   Cross-browser: `api` is the promise-returning namespace. Chrome MV3 exposes
   promises on chrome.*; Firefox exposes them on browser.*. */

const api = typeof browser !== 'undefined' ? browser : chrome;

if (typeof importScripts === 'function') {
  // MV3 service worker. On Firefox MV2 the manifest lists these scripts instead.
  importScripts('lib/engine.js', 'lib/blocklist.js', 'lib/state.js', 'rulebuilder.js');
}

const STATE_KEY = 'discipline.state';
const CONFIG_KEY = 'discipline.config';
const SYNC_KEY = 'discipline.sync';
const RULE_ID_BASE = 100000;

const Engine = self.DisciplineEngine;
const Blocklist = self.DisciplineBlocklist;
const State = self.DisciplineState;

const DEFAULT_CONFIG = {
  enabled: true,
  notifications: true,
  siteUrl: 'https://m3l0nbyte.github.io/discipline/',
};

// ---------------------------------------------------------------------------
// Config + state
// ---------------------------------------------------------------------------
async function getConfig() {
  const stored = await api.storage.local.get(CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...(stored[CONFIG_KEY] || {}) };
}

async function setConfig(patch) {
  const next = { ...(await getConfig()), ...patch };
  await api.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}

async function loadState() {
  const stored = await api.storage.local.get(STATE_KEY);
  return State.migrate(stored[STATE_KEY] || null);
}

async function saveState(state) {
  await api.storage.local.set({ [STATE_KEY]: state });
  broadcast(state);
  return state;
}

// Tell any open dashboard tab that the numbers moved.
function broadcast(state) {
  api.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (!tab.id) continue;
      api.tabs.sendMessage(tab.id, { type: 'state-changed', summary: State.buildSummary(state) }).catch(() => {});
    }
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Blocking rules (dynamic only, so a single code path covers both browsers)
// ---------------------------------------------------------------------------
async function rebuildRules() {
  const config = await getConfig();
  const state = await loadState();
  const entries = [...state.blocklist, ...state.pathRules];

  try {
    const existing = await api.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.map((r) => r.id);
    const blockedUrl = api.runtime.getURL('blocked.html');
    const addRules = config.enabled
      ? DisciplineRules.buildRules(entries, blockedUrl).map((r) => ({ ...r, id: RULE_ID_BASE + r.id }))
      : [];
    await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
    await api.storage.local.set({ [SYNC_KEY]: { at: Date.now(), count: addRules.length, error: null } });
    return { ok: true, count: addRules.length };
  } catch (err) {
    await api.storage.local.set({ [SYNC_KEY]: { at: Date.now(), count: 0, error: err.message } });
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Actions, shared by the popup, the options page, the wall page and the bridge
// ---------------------------------------------------------------------------
const Actions = {
  async summary() {
    return { ok: true, summary: State.buildSummary(await loadState()) };
  },
  async checkin() {
    const state = await loadState();
    const result = State.checkIn(state);
    await saveState(state);
    return { ok: true, ...result, summary: State.buildSummary(state) };
  },
  async relapse(payload) {
    const state = await loadState();
    const result = State.relapse(state, { note: payload && payload.note });
    await saveState(state);
    return { ok: true, ...result, summary: State.buildSummary(state) };
  },
  async urge() {
    const state = await loadState();
    const result = State.logUrge(state);
    await saveState(state);
    return { ok: true, ...result, summary: State.buildSummary(state) };
  },
  async blocklist() {
    const state = await loadState();
    return {
      ok: true,
      data: {
        blocklist: state.blocklist,
        pathRules: state.pathRules,
        safeHints: Blocklist.SAFE_HINTS,
        defaults: Blocklist.DEFAULT_BLOCKLIST,
      },
    };
  },
  async addBlock(payload) {
    const state = await loadState();
    const result = State.addBlock(state, payload && payload.domain);
    if (result.ok) {
      await saveState(state);
      await rebuildRules();
    }
    return { ok: result.ok, error: result.error, already: result.already };
  },
  async removeBlock(payload) {
    const state = await loadState();
    State.removeBlock(state, payload && payload.domain);
    await saveState(state);
    await rebuildRules();
    return { ok: true };
  },
  async settings(payload) {
    const state = await loadState();
    const settings = State.updateSettings(state, payload || {});
    await saveState(state);
    if (payload && typeof payload.notifications === 'boolean') {
      await setConfig({ notifications: payload.notifications });
    }
    return { ok: true, settings, summary: State.buildSummary(state) };
  },
  async reset() {
    const state = State.createInitialState();
    await saveState(state);
    await rebuildRules();
    return { ok: true, summary: State.buildSummary(state) };
  },
  // Lets the website hand over a streak it collected before the extension existed.
  async import(payload) {
    if (!payload || !payload.state) return { ok: false, error: 'no state' };
    const incoming = State.migrate(payload.state);
    await saveState(incoming);
    await rebuildRules();
    return { ok: true, summary: State.buildSummary(incoming) };
  },
  async sync() {
    const result = await rebuildRules();
    return { ok: result.ok, error: result.error, count: result.count };
  },
  async setEnabled(payload) {
    const config = await setConfig({ enabled: !!(payload && payload.enabled) });
    await rebuildRules();
    return { ok: true, enabled: config.enabled };
  },
  async status() {
    const config = await getConfig();
    const stored = await api.storage.local.get(SYNC_KEY);
    const sync = stored[SYNC_KEY] || {};
    return {
      ok: true,
      enabled: config.enabled,
      notifications: config.notifications,
      siteUrl: config.siteUrl,
      lastSync: sync.at || null,
      ruleCount: sync.count || 0,
      error: sync.error || null,
    };
  },
  async setSiteUrl(payload) {
    const config = await setConfig({ siteUrl: String((payload && payload.siteUrl) || '').trim() });
    return { ok: true, siteUrl: config.siteUrl };
  },
};

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------
function scheduleAlarm() {
  api.alarms.create('discipline-daily', { periodInMinutes: 180, delayInMinutes: 1 });
}

async function maybeRemind() {
  const config = await getConfig();
  if (!config.notifications) return;

  const hour = new Date().getHours();
  if (hour < 19 || hour > 23) return;

  const stored = await api.storage.local.get('discipline.remindedOn');
  const today = new Date().toISOString().slice(0, 10);
  if (stored['discipline.remindedOn'] === today) return;

  const summary = State.buildSummary(await loadState());
  if (summary.today.checkedIn) return;

  api.notifications.create('discipline-reminder', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'DISCIPLINE — check in',
    message: summary.streak > 0
      ? `You are on a ${summary.streak} day streak. Log today before it rolls over.`
      : 'Log today and start the streak. One clean day = XP.',
  });
  await api.storage.local.set({ 'discipline.remindedOn': today });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return undefined;

  // A request relayed from the website by the content script.
  if (msg.type === 'bridge') {
    const action = Actions[msg.action];
    if (!action) { sendResponse({ ok: false, error: 'unknown action' }); return undefined; }
    Promise.resolve(action(msg.payload)).then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  const action = Actions[msg.type];
  if (action) {
    Promise.resolve(action(msg.payload)).then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'getConfig') {
    getConfig().then((config) => sendResponse({ ok: true, config }));
    return true;
  }

  return undefined;
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
api.runtime.onInstalled.addListener(async () => {
  const state = await loadState();
  await saveState(state); // writes defaults on first run
  scheduleAlarm();
  rebuildRules();
});

if (api.runtime.onStartup) {
  api.runtime.onStartup.addListener(() => {
    scheduleAlarm();
    rebuildRules();
  });
}

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'discipline-daily') {
    rebuildRules();
    maybeRemind();
  }
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[CONFIG_KEY]) rebuildRules();
});

// Expose for the MV2 background page's own debugging.
self.DisciplineActions = Actions;
