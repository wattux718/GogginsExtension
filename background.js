/* The worker serializes unlock requests and persists waits across reloads. */
importScripts('defaults.js', 'policy.js');
const F = globalThis.FOCUS;
const PREFIX = 'pass:';
let queue = Promise.resolve();
function serial(fn) {
  const result = queue.then(fn);
  queue = result.catch(() => {});
  return result;
}

async function initialize() {
  const raw = await chrome.storage.local.get(null);
  const patch = FocusPolicy.migrate(raw);
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  return { ...F.DEFAULTS, ...raw, ...patch };
}

chrome.runtime.onInstalled.addListener(() => serial(initialize).then(resync));
chrome.runtime.onStartup.addListener(() => serial(async () => {
  await initialize();
  // Tab IDs can be reused after a browser restart.
  const { unlockWaits = {} } = await chrome.storage.local.get('unlockWaits');
  for (const key of Object.keys(unlockWaits)) if (key.startsWith('recs:')) delete unlockWaits[key];
  await chrome.storage.local.set({ recommendationPasses: {}, unlockWaits });
}).then(resync));

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type === 'focus:init') {
    serial(initialize).then(reply, () => reply({ error: true }));
    return true;
  }
  if (!['focus:pass', 'focus:recs'].includes(message.type)) return;
  serial(async () => {
    const s = await initialize();
    const recs = message.type === 'focus:recs';
    const key = recs ? 'youtube:recs' : message.key;
    if (recs) {
      if (!FocusPolicy.isYouTube(sender.url) || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0) throw new Error('Invalid recommendations request');
    } else {
      const custom = String(s.customBlock || '').split(/[\s,;]+/)
        .map(d => d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[\/?#].*$/, '').toLowerCase()).filter(Boolean);
      const domains = typeof key === 'string' && key.startsWith('custom:')
        ? (custom.includes(key.slice(7)) ? [key.slice(7)] : [])
        : (F.SITES.find(site => site.key === key)?.domains || []);
      const host = new URL(sender.url).hostname;
      if (!domains.some(d => host === d || host.endsWith('.' + d))) throw new Error('Invalid pass site');
    }

    // Social passes are shared by a site. Recommendation windows belong to a tab;
    // middle-clicking videos leaves the original browsing window open.
    const slot = recs ? 'recs:' + sender.tab.id : key;
    const passKey = recs ? String(sender.tab.id) : key;
    const passField = recs ? 'recommendationPasses' : 'passes';
    const passes = { ...s[passField] };
    const waits = { ...s.unlockWaits };
    const progress = { ...s.unlockProgress };
    const now = Date.now();
    const action = message.end ? 'end' : message.action || 'start';
    let until = passes[passKey] > now ? passes[passKey] : 0;
    if (!until) delete passes[passKey];

    if (action === 'end' || action === 'cancel') {
      delete waits[slot];
      if (action === 'end') { delete passes[passKey]; until = 0; }
    } else if (action === 'start' || action === 'claim') {
      if (!until && !waits[slot] && action === 'start') {
        const seconds = FocusPolicy.waitSeconds(key, progress[key], now);
        const day = FocusPolicy.dayKey(now);
        const count = progress[key]?.day === day ? Number(progress[key].count) || 0 : 0;
        progress[key] = { day, count: count + 1 };
        waits[slot] = now + seconds * 1000;
      }
      if (!until && waits[slot] && waits[slot] <= now) {
        // Start the full allowance when a waiting page claims it, even if its
        // timer was throttled while the browser was in the background.
        until = now + (recs ? Math.max(15, Math.min(180, Number(s.recsSeconds) || 60)) * 1000 : 5 * 60000);
        passes[passKey] = until;
        delete waits[slot];
      }
    } else if (action !== 'status') throw new Error('Invalid unlock action');

    if (action !== 'status') {
      await chrome.storage.local.set({ [passField]: passes, unlockWaits: waits, unlockProgress: progress });
      const alarmName = recs ? 'recs:' + sender.tab.id : PREFIX + key;
      if (until > now) chrome.alarms.create(alarmName, { when: until });
      else await chrome.alarms.clear(alarmName);
    }
    return { until, readyAt: waits[slot] || 0,
      nextWait: FocusPolicy.waitSeconds(key, progress[key], now),
      ...(recs ? {} : { passes, unlockWaits: waits, unlockProgress: progress }) };
  }).then(reply, () => reply({ error: true }));
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name.startsWith(PREFIX)) expirePass(alarm.name.slice(PREFIX.length));
  if (alarm.name.startsWith('recs:')) {
    const tabId = Number(alarm.name.slice(5));
    chrome.tabs.sendMessage(tabId, { type: 'focus:recs-expired' }).catch(() => {});
  }
});

async function expirePass(key) {
  return serial(async () => {
    const { passes = {} } = await chrome.storage.local.get('passes');
    if (!(key in passes) || passes[key] > Date.now()) return;
    delete passes[key];
    await chrome.storage.local.set({ passes });
    await chrome.alarms.clear(PREFIX + key);
  });
}

async function resync() {
  const { passes = {}, recommendationPasses = {} } = await chrome.storage.local.get(['passes', 'recommendationPasses']);
  for (const alarm of await chrome.alarms.getAll()) {
    if (alarm.name.startsWith(PREFIX) || alarm.name.startsWith('recs:') || ['youtube:visit', 'youtube:meal'].includes(alarm.name)) await chrome.alarms.clear(alarm.name);
  }
  for (const [key, until] of Object.entries(passes)) {
    if (until <= Date.now()) await expirePass(key);
    else chrome.alarms.create(PREFIX + key, { when: until });
  }
  for (const [id, until] of Object.entries(recommendationPasses)) {
    if (until > Date.now()) chrome.alarms.create('recs:' + id, { when: until });
  }
}

chrome.tabs.onRemoved.addListener(tabId => serial(async () => {
  const { recommendationPasses = {}, unlockWaits = {} } = await chrome.storage.local.get(['recommendationPasses', 'unlockWaits']);
  delete recommendationPasses[tabId];
  delete unlockWaits['recs:' + tabId];
  await chrome.storage.local.set({ recommendationPasses, unlockWaits });
  await chrome.alarms.clear('recs:' + tabId);
}));
