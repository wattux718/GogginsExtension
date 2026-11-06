/* Strict Focus Mode - popup. The controls are generated from FOCUS.FIELDS so
   a new setting only has to be declared once, in defaults.js. */
(() => {
  "use strict";

  const { DEFAULTS, SITES, FIELDS } = globalThis.FOCUS;

  const settings = document.getElementById("settings");
  const usageEl = document.getElementById("usage");
  const lockSetup = document.getElementById("lock-setup");
  const lockActive = document.getElementById("lock-active");
  const lockTime = document.getElementById("lockTime");
  const startLock = document.getElementById("startLock");
  const countdown = document.getElementById("countdown");
  const focusTask = document.getElementById('focusTask');
  const quickFocus = document.getElementById('quickFocus');
  const endFocus = document.getElementById('endFocus');

  const inputs = {};      // key -> element
  const passLabels = {};  // site key -> the "closes in 12:04" span
  const SITE_KEYS = new Set(SITES.map(s => s.key));
  let passes = {};        // site key -> expiry ms
  let countdownTimer = null;
  let passTimer = null;

  /* ------------------------------------------------------------------ UI */

  function head(text) {
    const d = document.createElement("div");
    d.className = "head";
    d.textContent = text;
    settings.appendChild(d);
  }

  function note(text) {
    const d = document.createElement("div");
    d.className = "note";
    d.textContent = text;
    settings.appendChild(d);
  }

  function row(key, label, input, suffix, extra) {
    const wrap = document.createElement("div");
    wrap.className = "row";
    const l = document.createElement("label");
    l.textContent = label;
    l.htmlFor = input.id = "f_" + key;
    wrap.append(l);
    if (extra) wrap.append(extra);
    wrap.append(input);
    if (suffix) {
      const s = document.createElement("span");
      s.className = "suffix";
      s.textContent = suffix;
      wrap.appendChild(s);
    }
    settings.appendChild(wrap);
    inputs[key] = input;
  }

  function build() {
    for (const f of FIELDS) {
      if (f.type === "head") { head(f.label); continue; }
      if (f.type === "note") { note(f.label); continue; }

      if (f.type === "sites") {
        for (const site of SITES) {
          const cb = document.createElement("input");
          cb.type = "checkbox";
          const span = document.createElement("span");
          span.className = "pass";
          passLabels[site.key] = span;
          row(site.key, site.label, cb, null, span);
        }
        continue;
      }

      if (f.type === "bool") {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        row(f.key, f.label, cb);
      } else if (f.type === "num") {
        const n = document.createElement("input");
        n.type = "number";
        if (f.min !== undefined) n.min = f.min;
        if (f.max !== undefined) n.max = f.max;
        row(f.key, f.label, n, f.suffix);
      } else if (f.type === "time") {
        const t = document.createElement("input");
        t.type = "time";
        row(f.key, f.label, t);
      } else if (f.type === "text") {
        const d = document.createElement("div");
        const l = document.createElement("div");
        l.textContent = f.label;
        const ta = document.createElement("textarea");
        ta.placeholder = f.placeholder || "";
        ta.id = "f_" + f.key;
        d.append(l, ta);
        settings.appendChild(d);
        inputs[f.key] = ta;
      }
    }
  }

  /* -------------------------------------------------------------- state */

  function read(key, data) {
    const v = data[key];
    return v === undefined ? DEFAULTS[key] : v;
  }

  function load(data) {
    focusTask.value = data.focusTask || '';
    for (const key in inputs) {
      const el = inputs[key];
      const v = read(key, data);
      if (el.type === "checkbox") el.checked = v !== false;
      else el.value = v;
    }
    passes = Object.assign({}, read("passes", data));
    renderPasses();
    renderUsage(data);
    renderLock(read("lockUntil", data));
  }

  function save(e) {
    if (settings.disabled) return;
    const target = e && e.target;
    const key = target && target.id.startsWith('f_') ? target.id.slice(2) : null;
    if (!key || !inputs[key]) return;
    const patch = {};
    {
      const el = inputs[key];
      if (el.type === "checkbox") patch[key] = el.checked;
      else if (el.type === "number") {
        patch[key] = Math.min(Number(el.max) || Infinity, Math.max(Number(el.min) || 0, Number(el.value) || 0));
        el.value = patch[key];
      }
      else patch[key] = el.value;
    }

    // Site preferences and temporary passes are independent.
    chrome.storage.local.set(patch);
  }

  /* Display pass time without changing the permanent site preference. */
  function renderPasses() {
    if (passTimer) { clearInterval(passTimer); passTimer = null; }
    let live = false;

    for (const site of SITES) {
      const until = passes[site.key] || 0;
      const left = until - Date.now();
      if (left > 0) {
        live = true;
        const t = Math.ceil(left / 1000);
        passLabels[site.key].textContent = "open " + Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
      } else {
        passLabels[site.key].textContent = "";
      }
    }

    if (live) passTimer = setInterval(renderPasses, 1000);
  }

  function renderUsage() {
    usageEl.textContent = 'YouTube search and videos are always available.';
  }

  /* --------------------------------------------------------------- lock */

  function renderLock(lockUntil) {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

    const active = lockUntil && lockUntil > Date.now();
    lockSetup.hidden = !!active;
    lockActive.hidden = !active;
    settings.disabled = !!active;
    quickFocus.disabled = !!active;
    endFocus.hidden = !active;
    if (!active) return;

    const tick = () => {
      const left = lockUntil - Date.now();
      if (left <= 0) return renderLock(null);
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      countdown.textContent = m + "m " + String(s).padStart(2, "0") + "s";
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  startLock.addEventListener("click", () => {
    const minutes = Math.min(1440, parseInt(lockTime.value, 10));
    if (!minutes || minutes <= 0) return;
    const until = Date.now() + minutes * 60000;
    chrome.storage.local.set({ lockUntil: until }, () => {
      renderLock(until);
    });
  });

  // Save immediately; closing the popup must not discard the next step.
  focusTask.addEventListener('input', () => chrome.storage.local.set({ focusTask: focusTask.value.trim().slice(0, 240) }));
  quickFocus.addEventListener('click', () => {
    const until = Date.now() + 25 * 60000;
    chrome.storage.local.set({ focusTask: focusTask.value.trim().slice(0, 240), lockUntil: until }, () => {
      renderLock(until);
    });
  });

  endFocus.addEventListener('click', () => {
    chrome.storage.local.set({ lockUntil: 0 }, () => renderLock(0));
  });
  /* --------------------------------------------------------------- init */

  build();
  settings.addEventListener("change", save);

  /* Mirror site preferences, passes and focus state without replacing edits. */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key in changes) {
      if (SITE_KEYS.has(key) && inputs[key]) inputs[key].checked = changes[key].newValue !== false;
    }
    if (changes.passes) { passes = Object.assign({}, changes.passes.newValue); renderPasses(); }
    if (changes.lockUntil) renderLock(changes.lockUntil.newValue);
  });

  // A textarea only fires `change` on blur, and blurring the popup closes it,
  // so the custom domain list saves as it is typed.
  settings.addEventListener("input", (e) => {
    if (e.target.tagName !== "TEXTAREA") return;
    save(e);
  });

  chrome.runtime.sendMessage({ type: 'focus:init' }, data => {
    if (chrome.runtime.lastError || !data || data.error) {
      usageEl.textContent = 'Reload the extension to finish updating.';
      settings.disabled = true;
      return;
    }
    load(data);
  });
})();
