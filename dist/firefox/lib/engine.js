/* DISCIPLINE engine — XP curve, levels, ranks, milestones.
   Pure functions, no I/O. Runs in the browser, in the service worker, and in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DisciplineEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE_XP_PER_DAY = 25;
  const STREAK_BONUS_PER_DAY = 2;
  const STREAK_BONUS_CAP_DAYS = 30; // bonus stops growing after a month
  const URGE_RESIST_XP = 5;
  const URGE_RESIST_DAILY_CAP = 5;

  const MILESTONES = {
    1: { name: 'First Blood', bonus: 25 },
    3: { name: 'Three Days Strong', bonus: 50 },
    7: { name: 'One Week Clean', bonus: 100 },
    14: { name: 'Two Weeks Deep', bonus: 150 },
    21: { name: 'Habit Forming', bonus: 200 },
    30: { name: 'One Month Monk', bonus: 300 },
    45: { name: 'Six Weeks Strong', bonus: 400 },
    60: { name: 'Two Months In', bonus: 500 },
    90: { name: 'The 90 Day Reboot', bonus: 1000 },
    120: { name: 'Four Months', bonus: 1200 },
    180: { name: 'Half Year Legend', bonus: 2000 },
    270: { name: 'Nine Months', bonus: 2500 },
    365: { name: 'One Year Immortal', bonus: 5000 },
  };

  const TITLES = [
    { min: 100, title: 'Legend' },
    { min: 75, title: 'Ascended' },
    { min: 50, title: 'Iron Will' },
    { min: 30, title: 'Monk Mode' },
    { min: 20, title: 'Disciplined' },
    { min: 10, title: 'Adept' },
    { min: 5, title: 'Apprentice' },
    { min: 3, title: 'Initiate' },
    { min: 1, title: 'Recruit' },
  ];

  function xpForLevelStep(level) {
    return 100 + 60 * (level - 1);
  }

  function levelFromXP(xp) {
    let level = 1;
    let remaining = Math.max(0, Math.floor(xp));
    while (remaining >= xpForLevelStep(level)) {
      remaining -= xpForLevelStep(level);
      level += 1;
      if (level > 10000) break;
    }
    return level;
  }

  function levelProgress(xp) {
    const total = Math.max(0, Math.floor(xp));
    let level = 1;
    let into = total;
    while (into >= xpForLevelStep(level)) {
      into -= xpForLevelStep(level);
      level += 1;
      if (level > 10000) break;
    }
    const need = xpForLevelStep(level);
    return {
      level,
      title: titleForLevel(level),
      xpIntoLevel: into,
      xpForNextLevel: need,
      xpToNextLevel: Math.max(0, need - into),
      progress: need > 0 ? into / need : 0,
    };
  }

  function titleForLevel(level) {
    const found = TITLES.find((t) => level >= t.min);
    return found ? found.title : 'Recruit';
  }

  function streakBonus(streak) {
    return Math.min(Math.max(streak, 0), STREAK_BONUS_CAP_DAYS) * STREAK_BONUS_PER_DAY;
  }

  function milestoneFor(streak) {
    return MILESTONES[streak] || null;
  }

  function xpForDay(streak) {
    const base = BASE_XP_PER_DAY + streakBonus(streak);
    const milestone = milestoneFor(streak);
    return { xp: base + (milestone ? milestone.bonus : 0), base, bonus: streakBonus(streak), milestone };
  }

  function nextMilestone(streak) {
    const keys = Object.keys(MILESTONES).map(Number).sort((a, b) => a - b);
    const next = keys.find((k) => k > streak);
    if (next === undefined) return null;
    return { days: next, ...MILESTONES[next], remaining: next - streak };
  }

  return {
    BASE_XP_PER_DAY,
    STREAK_BONUS_PER_DAY,
    STREAK_BONUS_CAP_DAYS,
    URGE_RESIST_XP,
    URGE_RESIST_DAILY_CAP,
    MILESTONES,
    TITLES,
    xpForLevelStep,
    levelFromXP,
    levelProgress,
    titleForLevel,
    streakBonus,
    milestoneFor,
    xpForDay,
    nextMilestone,
  };
}));
