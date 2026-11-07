/* DISCIPLINE state — the rules for check-ins, streaks, relapses and urges.
   Pure: callers hand in a state object, this module mutates and reports back. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine'), require('./blocklist'));
  } else {
    root.DisciplineState = factory(root.DisciplineEngine, root.DisciplineBlocklist);
  }
}(typeof self !== 'undefined' ? self : this, function (engine, blocklist) {
  'use strict';

  const SCHEMA_VERSION = 2;
  const MAX_BACKFILL_DAYS = 60; // guard against a giant clock jump

  function todayKey(offsetMinutes = 0) {
    const shifted = new Date(Date.now() + Number(offsetMinutes || 0) * 60000);
    return shifted.toISOString().slice(0, 10);
  }

  function parseDay(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
  }

  function dayDiff(a, b) {
    return Math.round((parseDay(a) - parseDay(b)) / 86400000);
  }

  function addDays(key, n) {
    const d = new Date(parseDay(key) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }

  function createInitialState() {
    return {
      version: SCHEMA_VERSION,
      profile: { name: 'Operative', createdAt: new Date().toISOString() },
      xp: 0,
      streak: 0,
      bestStreak: 0,
      totalCleanDays: 0,
      relapses: 0,
      relapseLog: [],
      urgesResisted: 0,
      urgesToday: { date: null, count: 0 },
      lastCheckin: null,
      lastRelapse: null,
      history: {},
      unlockedMilestones: [],
      blocklist: blocklist.DEFAULT_BLOCKLIST.slice(),
      pathRules: blocklist.DEFAULT_PATH_RULES.slice(),
      settings: { strictMode: true, notifications: true, offsetMinutes: 0 },
    };
  }

  // Fill in anything missing so an older or hand-edited record still works.
  function migrate(state) {
    const base = createInitialState();
    const merged = { ...base, ...(state || {}) };
    merged.profile = { ...base.profile, ...(state && state.profile) };
    merged.settings = { ...base.settings, ...(state && state.settings) };
    merged.urgesToday = { ...base.urgesToday, ...(state && state.urgesToday) };
    merged.history = (state && state.history) || {};
    merged.relapseLog = (state && state.relapseLog) || [];
    merged.unlockedMilestones = (state && state.unlockedMilestones) || [];
    merged.blocklist = (state && state.blocklist) || base.blocklist;
    merged.pathRules = (state && state.pathRules) || base.pathRules;
    return merged;
  }

  function recordHistory(state, date, entry) {
    state.history[date] = { ...(state.history[date] || {}), ...entry };
  }

  function awardDay(state, date, streak) {
    const award = engine.xpForDay(streak);
    state.xp += award.xp;
    state.totalCleanDays += 1;

    let unlocked = null;
    if (award.milestone && !state.unlockedMilestones.includes(streak)) {
      state.unlockedMilestones.push(streak);
      unlocked = { days: streak, ...award.milestone };
    }

    recordHistory(state, date, {
      kind: 'clean',
      xp: award.xp,
      streak,
      base: award.base,
      bonus: award.bonus,
      milestone: award.milestone ? award.milestone.name : null,
    });

    return { ...award, unlocked, date, streak };
  }

  function finalizeCheckIn(state, awards, day, backfill) {
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.lastCheckin = day > (state.lastCheckin || '') ? day : state.lastCheckin;
    const totalXP = awards.reduce((sum, a) => sum + a.xp, 0);
    return {
      alreadyCheckedIn: false,
      awards,
      totalXP,
      streak: state.streak,
      backfill,
      unlocked: awards.map((a) => a.unlocked).filter(Boolean),
    };
  }

  // Check in for a given day. Idempotent per day. Missed days with no relapse
  // are credited as backfill so a forgotten button press never costs a streak.
  function checkIn(state, options = {}) {
    const day = options.date || todayKey(options.offsetMinutes ?? state.settings.offsetMinutes);

    if (state.lastCheckin === day || (state.history[day] && state.history[day].kind === 'clean')) {
      return { alreadyCheckedIn: true, awards: [], streak: state.streak };
    }

    const awards = [];

    if (!state.lastCheckin) {
      state.streak = 1;
      awards.push(awardDay(state, day, state.streak));
    } else {
      const gap = dayDiff(day, state.lastCheckin);
      if (gap <= 0) {
        state.streak = Math.max(1, state.streak);
        awards.push(awardDay(state, day, state.streak));
        if (parseDay(day) < parseDay(state.lastCheckin)) state.lastCheckin = day;
        return finalizeCheckIn(state, awards, day, false);
      }
      const days = Math.min(gap, MAX_BACKFILL_DAYS);
      const skipped = gap - days;
      for (let i = skipped + 1; i <= gap; i += 1) {
        state.streak += 1;
        awards.push(awardDay(state, addDays(state.lastCheckin, i), state.streak));
      }
    }

    state.lastCheckin = day > (state.lastCheckin || '') ? day : state.lastCheckin;
    return finalizeCheckIn(state, awards, day, awards.length > 1);
  }

  function relapse(state, options = {}) {
    const day = options.date || todayKey(state.settings.offsetMinutes);
    const lostStreak = state.streak;
    state.bestStreak = Math.max(state.bestStreak, lostStreak);
    state.streak = 0;
    state.relapses += 1;
    state.lastRelapse = day;
    state.lastCheckin = null;
    const note = String(options.note || '').slice(0, 280);
    state.relapseLog.unshift({ date: day, note, lostStreak });
    state.relapseLog = state.relapseLog.slice(0, 100);
    recordHistory(state, day, { kind: 'relapse', xp: 0, streak: 0, note });
    return { ok: true, lostStreak, streak: 0, message: 'Streak reset. The next day starts now.' };
  }

  function logUrge(state, options = {}) {
    const day = options.date || todayKey(state.settings.offsetMinutes);
    if (state.urgesToday.date !== day) state.urgesToday = { date: day, count: 0 };
    if (state.urgesToday.count >= engine.URGE_RESIST_DAILY_CAP) {
      return { ok: false, capped: true, xp: 0, count: state.urgesToday.count, cap: engine.URGE_RESIST_DAILY_CAP };
    }
    state.urgesToday.count += 1;
    state.urgesResisted += 1;
    state.xp += engine.URGE_RESIST_XP;
    return { ok: true, capped: false, xp: engine.URGE_RESIST_XP, count: state.urgesToday.count, cap: engine.URGE_RESIST_DAILY_CAP };
  }

  function addBlock(state, entry) {
    const clean = blocklist.cleanEntry(entry);
    if (!clean) return { ok: false, error: 'invalid' };
    if (state.blocklist.includes(clean)) return { ok: true, already: true, blocklist: state.blocklist };
    state.blocklist.push(clean);
    state.blocklist.sort();
    return { ok: true, already: false, blocklist: state.blocklist };
  }

  function removeBlock(state, entry) {
    const clean = blocklist.cleanEntry(entry) || String(entry || '').trim().toLowerCase();
    const before = state.blocklist.length;
    state.blocklist = state.blocklist.filter((d) => d !== clean && blocklist.normalizeDomain(d) !== blocklist.normalizeDomain(clean));
    return { ok: true, removed: before - state.blocklist.length, blocklist: state.blocklist };
  }

  function updateSettings(state, patch = {}) {
    if (typeof patch.strictMode === 'boolean') state.settings.strictMode = patch.strictMode;
    if (typeof patch.notifications === 'boolean') state.settings.notifications = patch.notifications;
    if (Number.isFinite(patch.offsetMinutes)) state.settings.offsetMinutes = patch.offsetMinutes;
    if (typeof patch.name === 'string' && patch.name.trim()) state.profile.name = patch.name.trim().slice(0, 40);
    return state.settings;
  }

  function recentHistory(state, days = 28, offsetMinutes = 0) {
    const today = todayKey(offsetMinutes);
    const out = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const key = addDays(today, -i);
      const h = state.history[key];
      out.push({
        date: key,
        kind: h ? h.kind : 'none',
        xp: h ? h.xp || 0 : 0,
        streak: h ? h.streak || 0 : 0,
        milestone: h ? h.milestone || null : null,
      });
    }
    return out;
  }

  function buildSummary(state) {
    const offset = state.settings.offsetMinutes;
    const today = todayKey(offset);
    const progress = engine.levelProgress(state.xp);
    const todayEntry = state.history[today];

    return {
      profile: state.profile,
      xp: state.xp,
      streak: state.streak,
      bestStreak: state.bestStreak,
      totalCleanDays: state.totalCleanDays,
      relapses: state.relapses,
      urgesResisted: state.urgesResisted,
      urgesToday: state.urgesToday.date === today ? state.urgesToday.count : 0,
      urgesCap: engine.URGE_RESIST_DAILY_CAP,
      level: progress.level,
      title: progress.title,
      xpIntoLevel: progress.xpIntoLevel,
      xpForNextLevel: progress.xpForNextLevel,
      xpToNextLevel: progress.xpToNextLevel,
      progress: progress.progress,
      today: { date: today, checkedIn: !!(todayEntry && todayEntry.kind === 'clean'), relapsed: !!(todayEntry && todayEntry.kind === 'relapse') },
      nextMilestone: engine.nextMilestone(state.streak),
      unlockedMilestones: state.unlockedMilestones.slice(),
      recent: recentHistory(state, 28, offset),
      settings: state.settings,
      blocklistCount: state.blocklist.length,
      pathRuleCount: state.pathRules.length,
      lastRelapse: state.lastRelapse,
    };
  }

  return {
    SCHEMA_VERSION,
    todayKey,
    dayDiff,
    addDays,
    createInitialState,
    migrate,
    checkIn,
    relapse,
    logUrge,
    addBlock,
    removeBlock,
    updateSettings,
    recentHistory,
    buildSummary,
  };
}));
