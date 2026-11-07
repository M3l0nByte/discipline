'use strict';

/* Turns blocklist entries into declarativeNetRequest rules.
   Shared by the extension background worker. Exposes globals so it can be
   importScripts()'d in an MV3 service worker or listed in an MV2 manifest. */
(function attach(scope) {
  const FRAME_TYPES = ['main_frame', 'sub_frame'];
  const RESOURCE_TYPES = [
    'xmlhttprequest', 'media', 'image', 'websocket', 'other',
    'script', 'stylesheet', 'font', 'object', 'ping', 'csp_report',
  ];

  function esc(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Turns a blocklist entry into { domain, regexFilter }.
  function patternFor(entry) {
    const clean = String(entry).trim().toLowerCase()
      .replace(/^[a-z]+:\/\//, '')
      .replace(/^www\./, '');
    const wildcard = clean.startsWith('*.');

    if (wildcard) {
      const domain = clean.slice(2);
      return { domain, regexFilter: `^https?://([^/]+\\.)+${esc(domain)}(:\\d+)?([/?#]|$)` };
    }
    if (clean.includes('/')) {
      const [host, ...rest] = clean.split('/');
      return {
        domain: host,
        regexFilter: `^https?://([^/]+\\.)?${esc(host)}(:\\d+)?/${esc(rest.join('/'))}([/?#]|$)`,
      };
    }
    return {
      domain: clean,
      regexFilter: `^https?://([^/]+\\.)?${esc(clean)}(:\\d+)?([/?#]|$)`,
    };
  }

  // Two rules per entry: frames get the "blocked" page, sub-resources are
  // dropped outright so a page cannot keep pulling media from a blocked host.
  // blockedUrl is the extension's own wall page, e.g. chrome.runtime.getURL('blocked.html').
  function rulesFor(entry, nextId, blockedUrl) {
    const { domain, regexFilter } = patternFor(entry);
    const target = `${blockedUrl}?domain=${encodeURIComponent(domain)}`;
    const redirect = {
      id: nextId(),
      priority: 2,
      action: { type: 'redirect', redirect: { url: target } },
      condition: { regexFilter, resourceTypes: FRAME_TYPES },
    };
    const block = {
      id: nextId(),
      priority: 1,
      action: { type: 'block' },
      condition: { regexFilter, resourceTypes: RESOURCE_TYPES },
    };
    return [redirect, block];
  }

  function buildRules(entries, blockedUrl) {
    let id = 1;
    const nextId = () => id++;
    const rules = [];
    for (const entry of entries) {
      if (!entry) continue;
      rules.push(...rulesFor(entry, nextId, blockedUrl));
    }
    return rules;
  }

  scope.DisciplineRules = { esc, patternFor, rulesFor, buildRules };
})(typeof self !== 'undefined' ? self : this);
