'use strict';

const test = require('node:test');
const assert = require('node:assert');
const engine = require('../public/lib/engine');

test('level 1 needs 100 XP and each level costs more', () => {
  assert.strictEqual(engine.levelFromXP(0), 1);
  assert.strictEqual(engine.levelFromXP(99), 1);
  assert.strictEqual(engine.levelFromXP(100), 2);
  assert.strictEqual(engine.xpForLevelStep(1), 100);
  assert.strictEqual(engine.xpForLevelStep(2), 160);
  assert.ok(engine.xpForLevelStep(3) > engine.xpForLevelStep(2));
});

test('levelProgress reports into-level and remaining correctly', () => {
  const p = engine.levelProgress(250);
  assert.strictEqual(p.level, 2);
  assert.strictEqual(p.xpIntoLevel, 150);
  assert.strictEqual(p.xpForNextLevel, 160);
  assert.strictEqual(p.xpToNextLevel, 10);
  assert.ok(p.progress > 0.9 && p.progress < 1);
});

test('titles unlock by level', () => {
  assert.strictEqual(engine.titleForLevel(1), 'Recruit');
  assert.strictEqual(engine.titleForLevel(30), 'Monk Mode');
  assert.strictEqual(engine.titleForLevel(100), 'Legend');
});

test('xpForDay grows with streak and pays milestone bonuses', () => {
  const day1 = engine.xpForDay(1);
  assert.strictEqual(day1.base, engine.BASE_XP_PER_DAY + 2);
  assert.strictEqual(day1.milestone.name, 'First Blood');
  assert.strictEqual(day1.xp, day1.base + 25);

  const day7 = engine.xpForDay(7);
  assert.strictEqual(day7.milestone.bonus, 100);
  assert.ok(day7.xp > day1.xp);

  const day31 = engine.xpForDay(31);
  const day60 = engine.xpForDay(60);
  assert.ok(day60.xp > day31.xp);
});

test('streak bonus caps after 30 days', () => {
  assert.strictEqual(engine.streakBonus(30), engine.STREAK_BONUS_CAP_DAYS * engine.STREAK_BONUS_PER_DAY);
  assert.strictEqual(engine.streakBonus(400), engine.streakBonus(30));
});

test('nextMilestone points at the next unclaimed beat', () => {
  const next = engine.nextMilestone(5);
  assert.strictEqual(next.days, 7);
  assert.strictEqual(next.remaining, 2);
  assert.strictEqual(engine.nextMilestone(365), null);
});
