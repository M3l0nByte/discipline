/* DISCIPLINE blocklist — defaults and domain/wildcard/path matching.
   Runs in the browser, in the service worker, and in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DisciplineBlocklist = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_BLOCKLIST = [
    'pornhub.com', 'www.pornhub.com', 'pornhub.org', 'pornhub.net',
    'xvideos.com', 'www.xvideos.com', 'xnxx.com', 'www.xnxx.com',
    'xhamster.com', 'www.xhamster.com', 'xhamster.desi',
    'redtube.com', 'www.redtube.com', 'youporn.com', 'www.youporn.com',
    'youporngay.com', 'spankbang.com', 'www.spankbang.com', 'spankbang.porn',
    'eporner.com', 'www.eporner.com', 'beeg.com', 'www.beeg.com',
    'txxx.com', 'www.txxx.com', 'hqporner.com', 'www.hqporner.com', 'hqporner.porn',
    'porntrex.com', 'www.porntrex.com', 'tnaflix.com', 'www.tnaflix.com',
    'porn.com', 'www.porn.com', 'porn300.com', 'www.porn300.com',
    'pornone.com', 'www.pornone.com', 'porndig.com', 'www.porndig.com',
    'pornhd.com', 'www.pornhd.com', 'pornmd.com', 'www.pornmd.com',
    'motherless.com', 'www.motherless.com', 'motherless.net',
    'efukt.com', 'www.efukt.com', 'heavy-r.com', 'www.heavy-r.com',
    'tubegalore.com', 'www.tubegalore.com', 'upornia.com', 'www.upornia.com',
    'vjav.com', 'www.vjav.com', 'noodlemagazine.com', 'www.noodlemagazine.com',
    'sexvid.xxx', 'www.sexvid.xxx', 'sextingpics.com', 'www.sextingpics.com',
    'javhd.com', 'www.javhd.com', 'javhub.net', 'www.javhub.net',
    'hanime.tv', 'www.hanime.tv', 'nhentai.net', 'www.nhentai.net',
    'e-hentai.org', 'www.e-hentai.org', 'exhentai.org', 'www.exhentai.org',
    'hentaihaven.xxx', 'www.hentaihaven.xxx',
    'rule34.xxx', 'www.rule34.xxx', 'rule34.paheal.net',
    'rule34video.com', 'www.rule34video.com',
    'gelbooru.com', 'www.gelbooru.com', 'danbooru.donmai.us',
    'sankakucomplex.com', 'www.sankakucomplex.com',
    'chaturbate.com', 'www.chaturbate.com', 'stripchat.com', 'www.stripchat.com',
    'bongacams.com', 'www.bongacams.com', 'livejasmin.com', 'www.livejasmin.com',
    'camsoda.com', 'www.camsoda.com', 'myfreecams.com', 'www.myfreecams.com',
    'cam4.com', 'www.cam4.com', 'flirt4free.com', 'www.flirt4free.com',
    'onlyfans.com', 'www.onlyfans.com', 'fansly.com', 'www.fansly.com',
    'manyvids.com', 'www.manyvids.com', 'clips4sale.com', 'www.clips4sale.com',
    'iwantclips.com', 'www.iwantclips.com',
    'literotica.com', 'www.literotica.com', 'asstr.org', 'www.asstr.org',
    'nifty.org', 'www.nifty.org',
  ];

  // Path-scoped rules. The whole site stays usable, only the risky corners go dark.
  const DEFAULT_PATH_RULES = [
    'reddit.com/r/gonewild',
    'reddit.com/r/nsfw',
    'reddit.com/r/porn',
    'reddit.com/r/rule34',
    'reddit.com/r/onlyfans',
    'x.com/search',
    'twitter.com/search',
  ];

  const SAFE_HINTS = ['youtube.com', 'twitch.tv', 'netflix.com', 'spotify.com', 'instagram.com', 'tiktok.com'];

  function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase()
      .replace(/^[a-z]+:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[/?#].*$/, '')
      .replace(/:\d+$/, '');
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch (err) {
      return null;
    }
  }

  function entryParts(entry) {
    const raw = String(entry || '').trim().toLowerCase();
    if (!raw) return null;
    const [entryHost, ...pathParts] = raw
      .replace(/^[a-z]+:\/\//, '')
      .replace(/^www\./, '')
      .split('?')[0]
      .split('/');
    const wildcard = entryHost.startsWith('*.');
    const base = wildcard ? entryHost.slice(2) : entryHost.replace(/:\d+$/, '');
    if (!base) return null;
    return { base, wildcard, path: pathParts.length ? `/${pathParts.join('/')}` : '' };
  }

  function domainHit(target, entry) {
    const parts = entryParts(entry);
    if (!parts) return false;
    return parts.wildcard
      ? target !== parts.base && target.endsWith(`.${parts.base}`)
      : target === parts.base || target.endsWith(`.${parts.base}`);
  }

  // "example.com" blocks the domain and every subdomain.
  // "*.example.com" blocks subdomains only.
  // "example.com/path" blocks that path and everything under it.
  function matchesBlock(host, entry) {
    const target = hostOf(`https://${host}`) || normalizeDomain(host);
    if (!target) return false;
    const parts = entryParts(entry);
    if (!parts || parts.path) return false;
    return domainHit(target, entry);
  }

  function matchesUrl(url, entry) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      return matchesBlock(String(url), entry);
    }
    const target = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!domainHit(target, entry)) return false;
    const parts = entryParts(entry);
    if (!parts || !parts.path) return true;
    const entryPath = parts.path.replace(/\/$/, '');
    const targetPath = parsed.pathname.replace(/\/$/, '');
    return targetPath === entryPath || targetPath.startsWith(`${entryPath}/`);
  }

  function isBlocked(url, blocklist, pathRules) {
    if (!hostOf(url)) return false;
    if ((blocklist || []).some((entry) => matchesUrl(url, entry))) return true;
    return (pathRules || []).some((entry) => matchesUrl(url, entry));
  }

  // Validates a user-supplied entry and returns a cleaned form, or null.
  function cleanEntry(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    const wildcard = raw.startsWith('*.');
    const body = wildcard ? raw.slice(2) : raw.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
    const [host, ...rest] = body.split('/');
    const cleanHost = host.replace(/:\d+$/, '');
    if (!cleanHost.includes('.')) return null;
    if (!/^[a-z0-9.-]+$/.test(cleanHost)) return null;
    const path = rest.join('/').replace(/[?#].*$/, '');
    return `${wildcard ? '*.' : ''}${cleanHost}${path ? `/${path}` : ''}`;
  }

  return {
    DEFAULT_BLOCKLIST,
    DEFAULT_PATH_RULES,
    SAFE_HINTS,
    normalizeDomain,
    hostOf,
    matchesBlock,
    matchesUrl,
    isBlocked,
    cleanEntry,
  };
}));
