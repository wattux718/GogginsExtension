/* A reversible cover preserves the page and drafts between five-minute passes. */
globalThis.FocusSocial = class {
  constructor(key, label) {
    this.key = key;
    this.label = label;
    this.cover = null;
    this.hud = null;
    this.inert = new Map();
    this.pending = false;
    this.error = false;
    document.addEventListener('play', event => {
      if (this.cover && event.target.pause) event.target.pause();
    }, true);
  }

  element(tag, props, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  }

  removeCover() {
    this.cover?.remove();
    this.cover = null;
    for (const [node, value] of this.inert) node.inert = value;
    this.inert.clear();
  }

  request(action) {
    if (this.pending) return;
    this.pending = true;
    this.error = false;
    chrome.runtime.sendMessage({ type: 'focus:pass', key: this.key, action }, result => {
      this.pending = false;
      if (chrome.runtime.lastError || !result || result.error) this.error = true;
      else Object.assign(this.settings, {
        passes: result.passes, unlockWaits: result.unlockWaits, unlockProgress: result.unlockProgress
      });
      this.update(this.settings, this.enabled);
    });
    this.paintWait();
  }

  paintWait() {
    if (!this.cover) return;
    const readyAt = this.settings.unlockWaits?.[this.key] || 0;
    const seconds = Math.max(0, Math.ceil((readyAt - Date.now()) / 1000));
    this.go.disabled = this.pending || (!!readyAt && !this.error);
    this.cancel.hidden = !readyAt;
    this.cancel.disabled = this.pending;
    const wait = globalThis.FocusPolicy.waitSeconds(this.key, this.settings.unlockProgress?.[this.key], Date.now());
    this.go.textContent = this.error ? 'Could not save. Try again'
      : readyAt ? 'Opening in ' + seconds + 's'
      : 'Quick check · 5 minutes (' + wait + 's wait)';
    if (readyAt && !seconds && !this.pending && !this.error) this.request('claim');
  }

  update(settings, enabled) {
    this.settings = settings;
    this.enabled = enabled;
    if (!enabled) {
      this.removeCover();
      this.hud?.remove();
      this.hud = null;
      clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (!this.timer) this.timer = setInterval(() => this.update(this.settings, this.enabled), 250);
    const remaining = (settings.passes?.[this.key] || 0) - Date.now();
    if (remaining > 0) {
      this.removeCover();
      if (!this.hud) {
        this.stop = this.element('button', { id: 'focus-gate', type: 'button', textContent: 'Done checking' });
        this.stop.addEventListener('click', () => this.request('end'));
        this.left = this.element('div', { id: 'focus-usage' });
        this.hud = this.element('div', { id: 'focus-hud' }, this.left, this.stop);
        document.body.append(this.hud);
      }
      this.stop.disabled = this.pending;
      this.stop.textContent = this.error ? 'Could not save. Try again' : 'Done checking';
      const seconds = Math.ceil(remaining / 1000);
      this.left.textContent = this.label + ' · ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') + ' left to check';
      return;
    }
    this.hud?.remove();
    this.hud = null;
    if (!this.cover) {
      this.go = this.element('button', { id: 'focus-quick-check', type: 'button' });
      this.go.addEventListener('click', () => this.request('start'));
      this.cancel = this.element('button', { type: 'button', className: 'ghost', textContent: 'Cancel wait' });
      this.cancel.addEventListener('click', () => this.request('cancel'));
      const close = this.element('button', { type: 'button', className: 'ghost', textContent: 'Back to my task' });
      close.addEventListener('click', () => { location.href = 'about:blank'; });
      const task = settings.focusTask ? 'Your next step: ' + settings.focusTask : 'Look up what you need, then return to your task.';
      const card = this.element('div', { className: 'focus-card' },
        this.element('h1', { textContent: 'Need something on ' + this.label + '?' }),
        this.element('p', { className: 'focus-sub', textContent: task }),
        this.element('p', { className: 'focus-sub', textContent: 'Click to start the wait, then get five minutes. Each new check takes longer: 10s, 30s, 1m and up. Waits reset daily.' }),
        this.element('div', { className: 'focus-row' }, this.go, this.cancel, close));
      this.cover = this.element('div', { id: 'focus-social', role: 'dialog' }, card);
      this.cover.setAttribute('aria-modal', 'true');
      this.cover.setAttribute('aria-label', this.label + ' quick check');
      document.body.append(this.cover);
      this.go.focus();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    }
    this.paintWait();
    for (const child of document.body.children) {
      if (child === this.cover || this.inert.has(child)) continue;
      this.inert.set(child, child.inert);
      child.inert = true;
    }
    document.querySelectorAll('video, audio').forEach(video => video.pause());
  }
};
