/* Shared unlock rules. Deadlines and daily progression are owned by the worker. */
globalThis.FocusPolicy = {
  migrate(raw) {
    if (raw.settingsVersion >= 12) return {};
    const patch = {
      settingsVersion: 12, recsSeconds: 60, passMinutes: 5,
      strictYouTube: false, gateRecs: true, mealUntil: 0,
      dailyLimit: 0, playDelay: 0, askWhy: false, nagMinutes: 0,
      ytVisit: { until: 0, breakUntil: 0 },
      unlockProgress: {}, unlockWaits: {}, recommendationPasses: {}
    };
    // Very old passes changed the permanent site preference. Repair that once.
    if (!(raw.settingsVersion >= 9)) {
      for (const key of Object.keys(raw.passes || {})) {
        if (key.startsWith('block') && raw[key] === false) patch[key] = true;
      }
    }
    return patch;
  },

  dayKey(now) {
    const d = new Date(now);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },

  waitSeconds(key, progress, now) {
    const count = progress && progress.day === this.dayKey(now) ? Math.max(0, Number(progress.count) || 0) : 0;
    // Both social checks and recommendation windows start with a 10-second wait.
    const step = count;
    if (step === 0) return 10;
    // 10s, 30s, 1m, 2m, 4m, 8m, then a maximum wait of 10m.
    return Math.min(600, 30 * 2 ** Math.min(step - 1, 5));
  },

  isYouTube(url) {
    try {
      const h = new URL(url).hostname;
      if (h === 'music.youtube.com' || h.endsWith('.music.youtube.com')) return false;
      return ['youtube.com', 'youtube-nocookie.com'].some(d => h === d || h.endsWith('.' + d));
    } catch { return false; }
  }
};
