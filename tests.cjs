const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const ctx = vm.createContext({ URL, Date });
vm.runInContext(source('defaults.js') + '\n' + source('policy.js'), ctx);
const P = ctx.FocusPolicy;
const now = new Date(2026, 10, 2, 12).getTime();
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }

test('social waits escalate independently and cap at ten minutes', () => {
  const day = P.dayKey(now);
  assert.deepEqual(Array.from({ length: 9 }, (_, count) => P.waitSeconds('blockReddit', { day, count }, now)),
    [10, 30, 60, 120, 240, 480, 600, 600, 600]);
  assert.equal(P.waitSeconds('blockInsta', undefined, now), 10);
});
test('YouTube recommendation waits start at ten seconds and escalate', () => {
  const day = P.dayKey(now);
  assert.deepEqual(Array.from({ length: 5 }, (_, count) => P.waitSeconds('youtube:recs', { day, count }, now)), [10, 30, 60, 120, 240]);
});
test('progress resets at local midnight', () => {
  const nextDay = new Date(2026, 10, 3).getTime();
  const old = { day: P.dayKey(now), count: 12 };
  assert.equal(P.waitSeconds('blockReddit', old, nextDay), 10);
  assert.equal(P.waitSeconds('youtube:recs', old, nextDay), 10);
});
test('migration retires meal/video restrictions while preserving site choices and tasks', () => {
  const m = P.migrate({ settingsVersion: 11, mealUntil: now + 10000, strictYouTube: true, dailyLimit: 7,
    focusTask: 'Write', blockReddit: false, passes: { blockInsta: now + 10000 } });
  assert.equal(m.settingsVersion, 12); assert.equal(m.mealUntil, 0);
  assert.equal(m.dailyLimit, 0); assert.equal(m.askWhy, false); assert.equal(m.playDelay, 0);
  assert.equal(m.recsSeconds, 60); assert.equal(m.passMinutes, 5);
  for (const key of ['focusTask', 'blockReddit', 'passes', 'lockUntil']) assert.equal(m[key], undefined);
  assert.equal(Object.keys(P.migrate({ settingsVersion: 12 })).length, 0);
});
test('Music and lookalike domains cannot request recommendation windows', () => {
  for (const url of ['https://m.youtube.com', 'https://www.youtube-nocookie.com/embed/x']) assert.equal(P.isYouTube(url), true);
  for (const url of ['https://music.youtube.com', 'https://youtube.com.evil.test', 'invalid']) assert.equal(P.isYouTube(url), false);
});

async function workerTests() {
  let clock = now;
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
  const store = {}, alarmMap = new Map();
  const chrome = {
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
    storage: { onChanged: event(), local: {
      async get() { return structuredClone(store); },
      async set(patch) { Object.assign(store, structuredClone(patch)); }
    } },
    alarms: { onAlarm: event(), async getAll() { return [...alarmMap].map(([name]) => ({ name })); },
      async clear(name) { alarmMap.delete(name); }, create(name, info) { alarmMap.set(name, info.when); } },
    tabs: { onRemoved: event(), async sendMessage() {} }
  };
  function launchWorker() {
    for (const e of [chrome.runtime.onInstalled, chrome.runtime.onStartup, chrome.runtime.onMessage, chrome.alarms.onAlarm, chrome.tabs.onRemoved]) e.listeners = [];
    const context = vm.createContext({ chrome, URL, Date: FakeDate });
    context.importScripts = (...files) => files.forEach(file => vm.runInContext(source(file), context));
    vm.runInContext(source('background.js'), context);
    return context;
  }
  launchWorker();
  const send = (message, url = 'https://www.youtube.com/watch?v=x', id = 1, frameId = 0) =>
    new Promise(resolve => chrome.runtime.onMessage.listeners[0](message, { url, tab: { id }, frameId }, resolve));
  const social = (action = 'start', key = 'blockReddit', url = 'https://www.reddit.com') => send({ type: 'focus:pass', action, key }, url);
  const recs = (action = 'start', id = 1) => send({ type: 'focus:recs', action }, undefined, id);
  await send({ type: 'focus:init' });
  assert.equal(store.settingsVersion, 12);
  store.lockUntil = now + 1500000; // social checks still work during focus
  store.blockReddit = true;
  const starts = await Promise.all(Array.from({ length: 8 }, () => social()));
  assert.ok(starts.every(r => r.readyAt === now + 10000 && !r.until));
  assert.equal(store.unlockProgress.blockReddit.count, 1);
  assert.equal(store.passes.blockReddit, undefined);
  clock += 9999;
  assert.equal((await social('claim')).until, 0);
  clock++;
  const first = await social('claim');
  assert.equal(first.until, clock + 300000);
  const expiry = first.until;
  assert.equal((await social()).until, expiry);
  assert.equal(store.unlockProgress.blockReddit.count, 1);
  console.log('PASS worker requires the click and full wait, serializes tabs, and grants exactly five minutes');

  clock = expiry;
  await chrome.alarms.onAlarm.listeners[0]({ name: 'pass:blockReddit' });
  await send({ type: 'focus:init' });
  assert.equal(store.passes.blockReddit, undefined);
  let second = await social();
  assert.equal(second.readyAt, clock + 30000);
  clock += 10000;
  // Restart only the worker: storage, waits and progress survive suspension.
  launchWorker();
  assert.equal((await social()).readyAt, second.readyAt);
  clock += 20000;
  await social('claim');
  await social('end');
  assert.equal((await social()).readyAt, clock + 60000);
  const instagram = await social('start', 'blockInsta', 'https://www.instagram.com/direct/inbox/');
  assert.equal(instagram.readyAt, clock + 10000);
  assert.equal(store.blockReddit, true);
  console.log('PASS expiry reblocks and advances 30s then 1m; sites have independent progress and reloads cannot shorten waits');

  for (const [key, url] of [['blockReddit', 'https://reddit.com.evil.test'], ['custom:bad.test', 'https://bad.test']]) {
    assert.equal((await social('start', key, url)).error, true);
  }
  store.customBlock = 'custom.test';
  assert.equal((await social('start', 'custom:custom.test', 'https://sub.custom.test')).readyAt, clock + 10000);
  for (const url of ['https://twitter.com', 'https://x.com']) {
    const state = await social('start', 'blockTwitter', url);
    assert.equal(state.readyAt, clock + 10000);
  }
  assert.equal(store.unlockProgress.blockTwitter.count, 1);
  console.log('PASS custom sites are validated and Twitter/X share one pass and countdown');

  const firstRecsWait = await recs();
  assert.equal(firstRecsWait.readyAt, clock + 10000);
  clock += 10000;
  const firstRecs = await recs('claim');
  assert.equal(firstRecs.until, clock + 60000);
  assert.equal((await recs()).until, firstRecs.until);
  assert.equal((await recs('status', 2)).until, 0);
  assert.equal((await recs('start', 2)).readyAt, clock + 30000);
  assert.equal((await recs('status')).until, firstRecs.until);
  await recs('end');
  assert.equal((await recs()).readyAt, clock + 60000);
  clock += 29999;
  assert.equal((await recs('claim', 2)).until, 0);
  clock++;
  const secondRecs = await recs('claim', 2);
  assert.equal(secondRecs.until, clock + 60000);
  assert.equal((await recs('status', 2)).until, secondRecs.until);
  assert.equal((await send({ type: 'focus:recs' }, 'https://music.youtube.com')).error, true);
  assert.equal((await send({ type: 'focus:recs' }, 'https://www.youtube.com', 3, 1)).error, true);
  console.log('PASS recommendation windows are per tab, last sixty seconds, share daily progression and reject frames/wrong sites');

  await recs('cancel');
  assert.equal((await recs('status')).readyAt, 0);
  assert.equal((await recs()).readyAt, clock + 120000);
  const storedCount = store.unlockProgress['youtube:recs'].count;
  await chrome.runtime.onStartup.listeners[0]();
  assert.deepEqual(store.recommendationPasses, {});
  assert.equal(store.unlockWaits['recs:1'], undefined);
  assert.equal(store.unlockProgress['youtube:recs'].count, storedCount);
  assert.ok(store.unlockWaits.blockReddit, 'social countdown survives browser restart');
  console.log('PASS cancelling and browser restarts cannot reset progression; old tab IDs cannot inherit recommendation windows');

  clock = new Date(2026, 10, 3).getTime();
  await social('cancel');
  assert.equal((await social()).readyAt, clock + 10000);
  assert.equal((await recs()).readyAt, clock + 10000);
  console.log('PASS worker resets each site and YouTube at the next local day');
  console.log((passed + 6) + ' regression groups passed.');
}
workerTests().catch(error => { console.error(error); process.exitCode = 1; });
