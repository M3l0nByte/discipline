'use strict';

const test = require('node:test');
const assert = require('node:assert');
const state = require('../public/lib/state');
const engine = require('../public/lib/engine');

function fresh() {
  return state.createInitialState();
}

test('first check-in awards day 1 and the First Blood bonus', () => {
  const s = fresh();
  const r = state.checkIn(s, { date: '2026-01-01' });
  assert.strictEqual(r.alreadyCheckedIn, false);
  assert.strictEqual(r.streak, 1);
  assert.strictEqual(s.totalCleanDays, 1);
  assert.ok(r.totalXP >= 50);
  assert.ok(s.unlockedMilestones.includes(1));
});

test('check-in is idempotent per day', () => {
  const s = fresh();
  state.checkIn(s, { date: '2026-01-01' });
  const xp = s.xp;
  const again = state.checkIn(s, { date: '2026-01-01' });
  assert.strictEqual(again.alreadyCheckedIn, true);
  assert.strictEqual(s.xp, xp);
});

test('consecutive days build the streak', () => {
  const s = fresh();
  state.checkIn(s, { date: '2026-01-01' });
  state.checkIn(s, { date: '2026-01-02' });
  const r = state.checkIn(s, { date: '2026-01-03' });
  assert.strictEqual(r.streak, 3);
  assert.strictEqual(s.bestStreak, 3);
  assert.strictEqual(s.totalCleanDays, 3);
});

test('a gap with no relapse is backfilled', () => {
  const s = fresh();
  state.checkIn(s, { date: '2026-01-01' });
  const r = state.checkIn(s, { date: '2026-01-05' });
  assert.strictEqual(r.streak, 5);
  assert.strictEqual(s.totalCleanDays, 5);
  assert.ok(r.backfill);
});

test('relapse resets the streak but keeps XP and history', () => {
  const s = fresh();
  state.checkIn(s, { date: '2026-01-01' });
  state.checkIn(s, { date: '2026-01-02' });
  const xpBefore = s.xp;
  const r = state.relapse(s, { date: '2026-01-03', note: 'stress' });
  assert.strictEqual(r.streak, 0);
  assert.strictEqual(s.streak, 0);
  assert.strictEqual(s.bestStreak, 2);
  assert.strictEqual(s.xp, xpBefore);
  assert.strictEqual(s.relapses, 1);
  assert.strictEqual(s.relapseLog[0].lostStreak, 2);
});

test('urge logging awards XP and respects the daily cap', () => {
  const s = fresh();
  let last;
  for (let i = 0; i < engine.URGE_RESIST_DAILY_CAP + 2; i += 1) {
    last = state.logUrge(s, { date: '2026-01-01' });
  }
  assert.strictEqual(s.urgesResisted, engine.URGE_RESIST_DAILY_CAP);
  assert.strictEqual(s.xp, engine.URGE_RESIST_DAILY_CAP * engine.URGE_RESIST_XP);
  assert.strictEqual(last.capped, true);
  assert.strictEqual(last.xp, 0);
});

test('blocklist add and remove handle domains, wildcards and junk', () => {
  const s = fresh();
  const before = s.blocklist.length;

  assert.strictEqual(state.addBlock(s, 'example.com').ok, true);
  assert.strictEqual(s.blocklist.includes('example.com'), true);

  assert.strictEqual(state.addBlock(s, 'https://WWW.SomeSite.com/path').ok, true);
  assert.strictEqual(s.blocklist.includes('somesite.com/path'), true);

  assert.strictEqual(state.addBlock(s, '*.wild.example').ok, true);
  assert.strictEqual(s.blocklist.includes('*.wild.example'), true);

  assert.strictEqual(state.addBlock(s, '').ok, false);
  assert.strictEqual(state.addBlock(s, 'notadomain').ok, false);

  const dup = state.addBlock(s, 'example.com');
  assert.strictEqual(dup.already, true);

  state.removeBlock(s, 'example.com');
  assert.strictEqual(s.blocklist.includes('example.com'), false);
  assert.ok(s.blocklist.length >= before - 0);
});

test('summary exposes everything the UI needs', () => {
  const s = fresh();
  state.checkIn(s, { date: state.todayKey(s.settings.offsetMinutes) });
  const sum = state.buildSummary(s);
  for (const key of ['xp', 'streak', 'level', 'title', 'progress', 'today', 'recent', 'nextMilestone', 'blocklistCount']) {
    assert.ok(key in sum, `missing ${key}`);
  }
  assert.strictEqual(sum.recent.length, 28);
  assert.strictEqual(sum.today.checkedIn, true);
});

test('migrate fills in missing fields on an old file', () => {
  const migrated = state.migrate({ xp: 500, streak: 4 });
  assert.strictEqual(migrated.xp, 500);
  assert.strictEqual(migrated.streak, 4);
  assert.ok(Array.isArray(migrated.blocklist));
  assert.ok(migrated.settings);
  assert.ok(migrated.history);
});
