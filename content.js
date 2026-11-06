/* Strict Focus Mode - content script */
(() => {
  'use strict';
  const F = globalThis.FOCUS, P = globalThis.FocusPolicy;
  if (!F || !P) return;
  const host = location.hostname.replace(/^www\./, '').toLowerCase();
  const isHost = d => host === d || host.endsWith('.' + d);
  if (isHost('music.youtube.com')) return;
  const IS_YT = isHost('youtube.com') || isHost('youtube-nocookie.com');
  if (!IS_YT && window.top !== window) return;
  const KNOWN = F.SITES.find(s => s.domains.some(isHost));
  const root = document.documentElement;
  if (IS_YT) root.classList.add('focus-hide-recs', 'focus-hide-comments', 'focus-hide-shorts', 'focus-search-only');

  let S, social, gateBtn, recsUntil = 0, readyAt = 0, requestId = 0, pending = false;
  let lastKey = '', nextWait = 0, errorText = '';
  const recsOpen = () => recsUntil > Date.now();

  chrome.runtime.sendMessage({ type: 'focus:init' }, raw => {
    if (chrome.runtime.lastError || !raw || raw.error) return;
    S = { ...F.DEFAULTS, ...raw };
    if (IS_YT) {
      applyClasses();
      if (window.top !== window) return;
      whenBody(startYouTube);
    } else whenBody(syncSocial);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !S) return;
    for (const key in changes) S[key] = changes[key].newValue;
    if (!IS_YT) return syncSocial();
    nextWait = P.waitSeconds('youtube:recs', S.unlockProgress?.['youtube:recs'], Date.now());
    applyClasses();
    paintGate();
    renderHomePanel();
  });

  // Social expiry never reloads the page or discards a draft.
  setInterval(() => {
    if (!S || IS_YT || !(KNOWN || customDomain())) return;
    chrome.storage.local.get(null, data => { Object.assign(S, data); syncSocial(); });
  }, 1000);

  function customDomain() {
    return String(S.customBlock || '').split(/[\s,;]+/)
      .map(d => d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[\/?#].*$/, '').toLowerCase())
      .filter(Boolean).find(isHost);
  }

  function syncSocial() {
    if (!document.body) return;
    const custom = customDomain();
    const key = KNOWN ? KNOWN.key : custom ? 'custom:' + custom : null;
    if (social && social.key !== key) { social.update(S, false); social = null; }
    if (!social && key) social = new globalThis.FocusSocial(key, KNOWN ? KNOWN.label : custom);
    if (social) social.update(S, !!key && (!KNOWN || S[KNOWN.key] !== false));
  }

  function whenBody(fn) {
    if (document.body) return fn();
    new MutationObserver((_, observer) => {
      if (document.body) { observer.disconnect(); fn(); }
    }).observe(root, { childList: true, subtree: true });
  }

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  }

  function applyClasses() {
    root.classList.toggle('focus-hide-recs', !recsOpen());
    root.classList.toggle('focus-hide-comments', !!S.hideComments);
    root.classList.toggle('focus-hide-shorts', !!S.hideShorts);
    root.classList.toggle('focus-search-only', !!S.searchOnly);
    root.classList.toggle('focus-no-thumbs', !!S.noThumbs && !recsOpen());
    root.classList.toggle('focus-gray', !!S.grayscale);
    root.classList.toggle('focus-hide-music', S.allowMusic === false);
    root.classList.toggle('focus-no-autoplay', !!S.noAutoplay);
  }

  function startYouTube() {
    gateBtn = el('button', { id: 'focus-gate', type: 'button' });
    gateBtn.addEventListener('click', onGateClick);
    document.body.append(el('div', { id: 'focus-hud' }, gateBtn));
    nextWait = P.waitSeconds('youtube:recs', S.unlockProgress?.['youtube:recs'], Date.now());
    lastKey = pageKey();
    renderHomePanel();
    paintGate();
    forceAutoplayOff();
    requestRecs('status'); // restore this tab's deadline after a refresh
    const check = () => {
      const key = pageKey();
      if (key === lastKey) return;
      lastKey = key;
      // A navigation in this tab hides recommendations. Opening a video in a
      // different tab does not navigate here and cannot end this window.
      recsUntil = readyAt = 0;
      requestRecs('end');
      applyClasses();
      renderHomePanel();
      forceAutoplayOff();
    };
    window.addEventListener('yt-navigate-finish', check, true);
    document.addEventListener('yt-navigate-finish', check, true);
    window.addEventListener('popstate', check);
    setInterval(check, 350);
    setInterval(tickRecs, 250);
    document.addEventListener('visibilitychange', tickRecs);
    chrome.runtime.onMessage.addListener(message => {
      if (message.type === 'focus:recs-expired') tickRecs();
    });
  }

  function pageKey() {
    const u = new URL(location.href);
    return [u.pathname, u.searchParams.get('v') || '', u.searchParams.get('search_query') || ''].join('|');
  }

  function onGateClick() {
    if (pending) return;
    requestRecs(errorText ? 'start' : recsOpen() ? 'end' : readyAt ? 'cancel' : 'start');
  }

  function requestRecs(action) {
    const id = ++requestId;
    pending = true;
    errorText = '';
    paintGate();
    chrome.runtime.sendMessage({ type: 'focus:recs', action }, result => {
      if (id !== requestId) return; // ignore a reply overtaken by navigation
      pending = false;
      if (chrome.runtime.lastError || !result || result.error) {
        errorText = 'Could not save. Click to try again';
        paintGate();
        return;
      }
      recsUntil = result.until || 0;
      readyAt = result.readyAt || 0;
      nextWait = result.nextWait;
      applyClasses();
      renderHomePanel();
      paintGate();
    });
  }

  function tickRecs() {
    if (recsUntil && recsUntil <= Date.now()) {
      recsUntil = 0;
      applyClasses();
      renderHomePanel();
      requestRecs('end');
    } else if (readyAt && readyAt <= Date.now() && !pending && !errorText) {
      requestRecs('claim');
    }
    if (!readyAt && !recsUntil) nextWait = P.waitSeconds('youtube:recs', S.unlockProgress?.['youtube:recs'], Date.now());
    paintGate();
  }

  function paintGate() {
    for (const button of [gateBtn, document.getElementById('focus-home-recs')]) {
      if (!button) continue;
      button.disabled = pending;
      if (errorText) {
        button.textContent = errorText;
        button.dataset.state = 'locked';
      } else if (recsOpen()) {
        button.textContent = 'Recommendations close in ' + Math.ceil((recsUntil - Date.now()) / 1000) + 's · hide now';
        button.dataset.state = 'open';
      } else if (readyAt) {
        button.textContent = 'Opening in ' + Math.max(0, Math.ceil((readyAt - Date.now()) / 1000)) + 's · cancel';
        button.dataset.state = 'counting';
      } else {
        button.textContent = 'Browse recommendations' + (nextWait ? ' (' + nextWait + 's wait)' : ' · ' + S.recsSeconds + ' seconds');
        button.dataset.state = 'locked';
      }
    }
  }

  function renderHomePanel() {
    const panel = document.getElementById('focus-home');
    const home = ['/', '/feed/explore'].includes(location.pathname);
    if (!S.searchOnly || recsOpen() || !home) { panel?.remove(); return; }
    if (panel) return; // keep a search query intact while the wait counts down
    const input = el('input', { id: 'focus-home-input', type: 'text', placeholder: 'Search YouTube...', autocomplete: 'off' });
    const form = el('form', { id: 'focus-home-form' }, input, el('button', { type: 'submit', textContent: 'Search' }));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const query = input.value.trim();
      if (query) location.href = '/results?search_query=' + encodeURIComponent(query);
    });
    const browse = el('button', { id: 'focus-home-recs', type: 'button' });
    browse.addEventListener('click', onGateClick);
    const card = el('div', { className: 'focus-card' },
      el('h1', { textContent: 'What would you like to watch?' }),
      el('p', { className: 'focus-sub', textContent: 'Search or open a video link anytime.' }),
      form, el('div', { className: 'focus-row' }, browse),
      el('p', { className: 'focus-sub', textContent: 'Browse for ' + S.recsSeconds + ' seconds. Middle-click videos to queue them in new tabs. Each new recommendation window takes longer to unlock.' }));
    document.body.append(el('div', { id: 'focus-home' }, card));
    paintGate();
  }

  function forceAutoplayOff() {
    if (!S.noAutoplay) return;
    let tries = 0;
    const timer = setInterval(() => {
      const button = document.querySelector('.ytp-autonav-toggle-button');
      if (button) {
        if (button.getAttribute('aria-checked') === 'true') button.click();
        clearInterval(timer);
      } else if (++tries > 40) clearInterval(timer);
    }, 500);
  }
})();
