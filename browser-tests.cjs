const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.FOCUS_PLAYWRIGHT || 'playwright');
const source = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  async function attach(page, raw = {}, tabId = 1) {
    await page.addScriptTag({ content: source('defaults.js') });
    await page.addScriptTag({ content: source('policy.js') });
    await page.evaluate(({ raw, tabId, workerSource }) => {
      window.data = { ...FOCUS.DEFAULTS, ...raw };
      window.messages = [];
      const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
      const changed = event(), contentMessages = event();
      const local = {
        get(keys, cb) { const result = structuredClone(data); if (cb) queueMicrotask(() => cb(result)); return Promise.resolve(result); },
        set(patch, cb) {
          const changes = {};
          for (const [key, value] of Object.entries(patch)) changes[key] = { oldValue: data[key], newValue: structuredClone(value) };
          Object.assign(data, structuredClone(patch));
          queueMicrotask(() => changed.listeners.forEach(fn => fn(changes, 'local')));
          if (cb) queueMicrotask(cb);
          return Promise.resolve();
        }
      };
      const workerChrome = {
        runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
        storage: { local, onChanged: changed },
        alarms: { onAlarm: event(), create() {}, async clear() {}, async getAll() { return []; } },
        tabs: { onRemoved: event(), async sendMessage(id, m) { contentMessages.listeners.forEach(fn => fn(m)); } }
      };
      // Run the actual service worker in an isolated function, using the page's
      // controlled clock and shared storage rather than a second policy mock.
      new Function('chrome', 'importScripts', workerSource)(workerChrome, () => {});
      window.chrome = {
        runtime: { onMessage: contentMessages, sendMessage(message, cb) {
          messages.push(message);
          workerChrome.runtime.onMessage.listeners[0](message, { url: location.href, tab: { id: tabId }, frameId: 0 }, cb);
        } },
        storage: { local, onChanged: changed }
      };
      window.pauseCalls = 0;
      document.querySelectorAll('video').forEach(video => { video.pause = () => { pauseCalls++; }; });
    }, { raw, tabId, workerSource: source('background.js') });
    await page.addStyleTag({ content: source('styles.css') });
    await page.addScriptTag({ content: source('content-filter.js') });
    await page.addScriptTag({ content: source('social.js') });
    await page.addScriptTag({ content: source('content.js') });
  }
  async function setup(url = 'https://www.youtube.com/', raw = {}) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.clock.install();
    page.on('pageerror', error => errors.push(error.message));
    await page.context().route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      '<html><head><title>Test video - YouTube</title></head><body><video></video><div id="related">Recommended videos <a id="video-link" href="https://www.youtube.com/watch?v=queued">Queue this video</a></div><ytd-thumbnail><img id="test-thumb"></ytd-thumbnail><button class="ytp-next-button">Next</button><div class="ytp-endscreen-content">Suggestions</div></body></html>' }));
    await page.goto(url);
    await attach(page, raw);
    return page;
  }
  async function settled(page) {
    await page.waitForFunction(() => !document.querySelector('#focus-gate')?.disabled);
  }
  async function reload(page) {
    const raw = await page.evaluate(() => structuredClone(data));
    await page.reload();
    await attach(page, raw);
  }

  try {
    for (const [url, key, markup] of [
      ['https://x.com/home', 'blockTwitter', '<article><img alt="Wildflowers" width="32" height="32"></article>'],
      ['https://www.pinterest.com/', 'blockPinterest', '<div data-test-id="pin"><img alt="Wildflowers" width="32" height="32"></div>']
    ]) {
      const filtered = await setup(url, { passes: { [key]: Date.now() + 300000 } });
      await filtered.locator('#focus-hud').waitFor();
      await filtered.evaluate(markup => {
        document.body.insertAdjacentHTML('beforeend', markup);
        const card = document.body.lastElementChild;
        card.id = 'ordinary-card';
        const other = card.cloneNode(true);
        other.id = 'risky-card';
        other.querySelector('img').alt = 'Pretty girls';
        document.body.append(other);
      }, markup);
      assert.equal(await filtered.locator('#ordinary-card img').isVisible(), true);
      assert.equal(await filtered.locator('#risky-card').isVisible(), false);
      await filtered.locator('#risky-card img').evaluate(node => node.alt = 'Garden path');
      assert.equal(await filtered.locator('#risky-card img').isVisible(), true);
      await filtered.locator('#risky-card').evaluate(node => {
        node.insertAdjacentHTML('beforeend', '<p>This media may contain sensitive material.</p>');
      });
      assert.equal(await filtered.locator('#risky-card').isVisible(), false);
      const searches = ['/search/?q=Girls%20photos'];
      if (key === 'blockTwitter') {
        searches.push('/search?q=Asian+girl', '/search?q=outfits+for+young+women', '/search?q=asian-girls',
          '/search?q=Asian+gi%E2%80%8Brl', '/search?q=asiangirlpics', '/hashtag/AsianGirl',
          '/search?q=latina', '/search?q=latinas+filter%3Amedia', '/hashtag/HotLatinasDaily',
          '/search?q=pinay', '/search?q=curvy+model', '/search?q=ofleaks', '/search?q=18%2B', '/hashtag/MilfPics');
        await filtered.locator('#ordinary-card').evaluate(node => {
          node.append('A Latina gardener planted wildflowers.');
          node.insertAdjacentHTML('afterend', '<div role="option" id="trigger-suggestion" aria-label="Latina photos">Suggestion</div>');
        });
        assert.equal(await filtered.locator('#ordinary-card img').isVisible(), true);
        assert.equal(await filtered.locator('#trigger-suggestion').isVisible(), false);
      }
      for (const search of searches) {
        await filtered.evaluate(path => history.pushState({}, '', path), search);
        await filtered.getByRole('heading', { name: 'Search blocked' }).waitFor();
        assert.equal(await filtered.locator('#focus-hud').isVisible(), false);
        await filtered.evaluate(path => history.pushState({}, '', path),
          key === 'blockTwitter' ? '/search?q=scarabs+design' : '/search/?q=girls+who+code');
        assert.equal(await filtered.locator('#focus-content-block').count(), 0);
        assert.equal(await filtered.locator('#ordinary-card img').isVisible(), true);
      }
      await filtered.close();
    }
    console.log('PASS X and Pinterest filter labeled cards and risky searches during active passes while preserving ordinary images');

    const google = await browser.newPage();
    google.on('pageerror', error => errors.push(error.message));
    const style = source('styles.css');
    await google.context().route('**/*', route => route.fulfill({
      contentType: 'text/html',
      body: '<style>' + style + '</style><div data-docid="safe" id="flower"><img alt="Wildflowers" width="32" height="32"></div>' +
        '<div data-docid="risky" id="risky"><img alt="Sexy girls" width="32" height="32"></div>'
    }));
    await google.addInitScript({ content: source('content-filter.js') });
    await google.goto('https://www.google.ca/search?q=wildflowers&udm=2&safe=off', { waitUntil: 'commit' });
    await google.waitForURL(url => url.searchParams.get('safe') === 'active');
    assert.equal(new URL(google.url()).searchParams.get('udm'), '2');
    assert.equal(await google.locator('#flower img').isVisible(), true);
    assert.equal(await google.locator('#risky').isVisible(), false);
    await google.goto('https://images.google.com/search?q=%EF%BD%87irls&tbm=isch');
    await google.getByRole('heading', { name: 'Search blocked' }).waitFor();
    assert.equal(await google.locator('#flower').isVisible(), false);
    await google.close();
    console.log('PASS Google Images forces SafeSearch, filters labeled results, and blocks trigger searches on both Google hosts');

    let p = await setup();
    await settled(p);
    await p.locator('#focus-home-recs').click();
    await p.waitForFunction(() => document.querySelector('#focus-gate')?.dataset.state === 'counting');
    await p.clock.runFor(9000);
    assert.equal(await p.locator('#related').isVisible(), false);
    await p.clock.runFor(1200);
    await p.waitForFunction(() => document.querySelector('#focus-gate')?.dataset.state === 'open');
    assert.equal(await p.locator('#related').isVisible(), true);
    assert.equal(await p.locator('#focus-home').count(), 0);
    assert.equal(await p.locator('#test-thumb').evaluate(node => getComputedStyle(node).opacity), '1');
    assert.equal(await p.locator('.ytp-next-button').isVisible(), false);
    assert.equal(await p.locator('.ytp-endscreen-content').isVisible(), false);

    const popupPromise = p.context().waitForEvent('page');
    await p.locator('#video-link').click({ button: 'middle' });
    const queued = await popupPromise;
    // Some headless Chrome builds report middle-clicked tabs without an opener.
    // Navigate explicitly so the new tab receives the routed fixture as well.
    await queued.goto('https://www.youtube.com/watch?v=queued');
    await attach(queued, await p.evaluate(() => structuredClone(data)), 2);
    await settled(queued);
    assert.equal(await queued.locator('#focus-playgate, #focus-social, #focus-blk-title').count(), 0);
    assert.equal(await queued.locator('#related').isVisible(), false);
    assert.equal(await p.locator('#related').isVisible(), true);
    await queued.close();
    await p.clock.runFor(61000);
    assert.equal(await p.locator('#related').isVisible(), false);
    assert.ok((await p.locator('#focus-home-recs').textContent()).includes('30s wait'));
    await p.locator('#focus-home-recs').click();
    await p.waitForFunction(() => document.querySelector('#focus-gate')?.dataset.state === 'counting');
    await p.clock.runFor(29000);
    assert.equal(await p.locator('#related').isVisible(), false);
    await reload(p);
    await p.waitForFunction(() => document.querySelector('#focus-gate')?.dataset.state === 'counting');
    await p.clock.runFor(1200);
    await p.waitForFunction(() => document.querySelector('#focus-gate')?.dataset.state === 'open');
    await p.clock.runFor(61000);
    assert.ok((await p.locator('#focus-home-recs').textContent()).includes('60s wait'));
    await p.locator('#focus-home-recs').click();
    await p.waitForFunction(() => document.querySelector('#focus-gate')?.dataset.state === 'counting');
    await p.locator('#focus-home-input').fill('my specific search');
    await p.clock.runFor(1000);
    assert.equal(await p.locator('#focus-home-input').inputValue(), 'my specific search');
    await p.locator('#focus-home-recs').click();
    await p.waitForFunction(() => document.querySelector('#focus-gate')?.dataset.state === 'locked');
    await p.clock.fastForward(61000);
    assert.equal(await p.locator('#related').isVisible(), false);
    await p.close();
    console.log('PASS recommendations require a wait, middle-click queues videos, windows expire, waits escalate, refresh preserves countdowns and cancellation works');

    for (const url of ['https://www.youtube.com/watch?v=test', 'https://www.youtube.com/results?search_query=tutorial',
      'https://www.youtube.com/live/test', 'https://www.youtube-nocookie.com/embed/test', 'https://www.youtube.com/shorts/test']) {
      p = await setup(url, { dailyLimit: 1, usageSeconds: 99999, mealUntil: Date.now() - 1, playDelay: 120,
        askWhy: true, nagMinutes: 1, lockUntil: Date.now() + 1500000,
        scheduleOn: true, scheduleStart: '00:00', scheduleEnd: '23:59',
        ytVisit: { until: 1, breakUntil: Date.now() + 1500000 } });
      await settled(p);
      await p.clock.fastForward(6 * 60000);
      assert.equal(await p.locator('#focus-playgate, #focus-social, #focus-blk-title, #focus-nag, #focus-meal').count(), 0);
      assert.equal(await p.evaluate(() => pauseCalls), 0);
      assert.equal(await p.evaluate(() => messages.some(m => ['focus:usage', 'focus:meal'].includes(m.type))), false);
      await p.close();
    }
    console.log('PASS search, direct videos, live links, embeds and Shorts stay available despite old limits, meals, focus or schedule; playback is never paused by a timer');

    p = await setup('https://music.youtube.com/watch?v=test', { lockUntil: Date.now() + 1500000, customBlock: 'youtube.com' });
    assert.equal(await p.locator('[id^="focus-"]').count(), 0);
    assert.equal(await p.evaluate(() => messages.length), 0);
    await p.close();
    console.log('PASS YouTube Music stays untouched');

    for (const url of ['https://www.reddit.com/r/test', 'https://www.instagram.com/direct/inbox/', 'https://x.com/home', 'https://custom.test/page']) {
      p = await setup(url, { customBlock: 'custom.test', lockUntil: Date.now() + 1500000 });
      await p.locator('#focus-quick-check').waitFor();
      await p.clock.runFor(20000);
      assert.ok((await p.locator('#focus-quick-check').textContent()).includes('10s wait'));
      await p.locator('#focus-quick-check').click();
      await p.waitForFunction(() => document.querySelector('#focus-quick-check')?.disabled);
      await p.clock.runFor(9000);
      assert.equal(await p.locator('#focus-social').isVisible(), true);
      await reload(p);
      await p.locator('#focus-social').waitFor();
      await p.clock.runFor(1200);
      await p.locator('#focus-hud').waitFor();
      assert.equal(await p.locator('#focus-social').count(), 0);
      await p.evaluate(() => {
        const draft = document.createElement('textarea');
        draft.id = 'draft'; draft.value = 'My unfinished reply';
        document.body.append(draft); window.originalDraft = draft;
      });
      await p.clock.fastForward(5 * 60000 + 1000);
      await p.locator('#focus-quick-check').waitFor();
      assert.ok((await p.locator('#focus-quick-check').textContent()).includes('30s wait'));
      assert.equal(await p.locator('#draft').inputValue(), 'My unfinished reply');
      assert.equal(await p.evaluate(() => originalDraft === document.querySelector('#draft')), true);
      assert.equal(await p.locator('#draft').evaluate(node => node.inert), true);
      if (url.includes('reddit')) await p.screenshot({ path: path.join(__dirname, 'block-screen.png') });
      await p.locator('#focus-quick-check').click();
      await p.clock.runFor(31000);
      await p.locator('#focus-hud').waitFor();
      assert.equal(await p.locator('#draft').evaluate(node => node.inert), false);
      await p.getByRole('button', { name: 'Done checking' }).click();
      await p.locator('#focus-quick-check').waitFor();
      assert.ok((await p.locator('#focus-quick-check').textContent()).includes('60s wait'));
      await p.close();
    }
    console.log('PASS social waits start on click, survive refresh, reblock after five minutes, escalate and preserve drafts');

    p = await setup('https://www.reddit.com', { blockReddit: false });
    await p.clock.runFor(2000);
    assert.equal(await p.locator('#focus-social').count(), 0);
    await p.close();

    p = await setup('https://example.test/');
    await p.setViewportSize({ width: 300, height: 560 });
    await p.setContent(source('popup.html').replace(/<script[\s\S]*?<\/script>/g, ''));
    await p.addScriptTag({ content: source('popup.js') });
    await p.locator('#f_recsSeconds').waitFor();
    await p.waitForFunction(() => document.querySelector('#f_recsSeconds').value === '60');
    assert.equal(await p.locator('#mealBreak, #f_mealMinutes, #f_dailyLimit, #f_playDelay, #f_askWhy, #f_sessionMinutes, #f_scheduleOn').count(), 0);
    await p.locator('#focusTask').fill('Write the first paragraph');
    assert.equal(await p.evaluate(() => data.focusTask), 'Write the first paragraph');
    await p.screenshot({ path: path.join(__dirname, 'popup-preview.png') });
    await p.locator('#quickFocus').click();
    await p.locator('#lock-active').waitFor();
    assert.equal(await p.locator('#f_recsSeconds').isDisabled(), true);
    await p.getByRole('button', { name: 'End focus session' }).click();
    await p.waitForFunction(() => !document.querySelector('#settings').disabled);
    await p.locator('#f_blockReddit').uncheck();
    assert.equal(await p.evaluate(() => data.blockReddit), false);
    assert.equal(await p.evaluate(() => data.passes.blockReddit), undefined);
    await p.close();
    console.log('PASS popup removes eating and video restriction controls, preserves focus timer and site preferences');
    assert.deepEqual(errors, []);
    console.log('All browser fixture checks passed without page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
