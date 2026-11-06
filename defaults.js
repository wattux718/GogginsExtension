/* Shared settings schema. Loaded by both the content script and the popup,
   so there is exactly one place where a default lives. */
globalThis.FOCUS = {

  DEFAULTS: {
    settingsVersion: 12,
    recsSeconds: 60,
    focusTask: '',
    /* --- YouTube friction --- */
    searchOnly: true,      // home feed replaced by a bare search box
    hideComments: true,
    hideShorts: true,      // hide suggestions; direct links still work
    noThumbs: true,        // text-only listings
    grayscale: true,       // desaturate thumbnails + player
    noAutoplay: true,      // force the autoplay-next switch off
    allowMusic: true,      // music mixes on the main video site; Music itself is exempt

    /* --- Unlocks shared across tabs and browser restarts --- */
    passes: {},
    unlockProgress: {},
    unlockWaits: {},
    recommendationPasses: {},

    /* --- Blocked sites --- */
    blockInsta: true,
    blockTikTok: true,
    blockTwitter: true,
    blockFacebook: true,
    blockReddit: true,
    blockSnapchat: true,
    blockPinterest: true,
    blockTwitch: true,
    blockLinkedIn: false,
    blockThreads: true,
    blockTumblr: true,
    customBlock: '',

    /* Focus timer locks settings until ended, without blocking YouTube. */
    lockUntil: 0
  },

  SITES: [
    { key: 'blockInsta',     label: 'Instagram', domains: ['instagram.com'] },
    { key: 'blockTikTok',    label: 'TikTok',    domains: ['tiktok.com'] },
    { key: 'blockTwitter',   label: 'X / Twitter', domains: ['twitter.com', 'x.com'] },
    { key: 'blockFacebook',  label: 'Facebook',  domains: ['facebook.com', 'messenger.com'] },
    { key: 'blockReddit',    label: 'Reddit',    domains: ['reddit.com'] },
    { key: 'blockSnapchat',  label: 'Snapchat',  domains: ['snapchat.com'] },
    { key: 'blockPinterest', label: 'Pinterest', domains: ['pinterest.com'] },
    { key: 'blockTwitch',    label: 'Twitch',    domains: ['twitch.tv'] },
    { key: 'blockLinkedIn',  label: 'LinkedIn',  domains: ['linkedin.com'] },
    { key: 'blockThreads',   label: 'Threads',   domains: ['threads.net', 'threads.com'] },
    { key: 'blockTumblr',    label: 'Tumblr',    domains: ['tumblr.com'] }
  ],

  /* Drives the popup UI. Site toggles are appended automatically. */
  FIELDS: [
    { type: 'head', label: 'YouTube' },
    { type: 'note', label: 'Search and video links always work. Recommendation waits start at 10s, then 30s, 1m, 2m and up, resetting daily.' },
    { type: 'num', key: 'recsSeconds', label: 'Browse recommendations for', suffix: 's', min: 15, max: 180 },
    { type: 'bool', key: 'searchOnly', label: 'Search-only home page' },
    { type: 'bool', key: 'hideComments', label: 'Hide comments' },
    { type: 'bool', key: 'hideShorts', label: 'Hide Shorts suggestions' },
    { type: 'bool', key: 'noThumbs', label: 'Hide thumbnails outside recommendation windows' },
    { type: 'bool', key: 'grayscale', label: 'Grayscale' },
    { type: 'bool', key: 'noAutoplay', label: 'Force autoplay off' },
    { type: 'bool', key: 'allowMusic', label: 'Keep music mixes' },

    { type: 'head', label: 'Content filter' },
    { type: 'note', label: 'Blocks known adult sites and filters searches and labeled posts on X, Pinterest, and Google. Google SafeSearch and the filter stay on during Quick checks.' },
    { type: 'head', label: 'Sites to limit' },
    { type: 'note', label: 'Click for a five-minute pass after a wait: 10s, 30s, 1m, 2m, 4m, 8m, then 10m maximum. Each site resets daily. Uncheck a site to remove its timer.' },
    { type: 'sites' },
    { type: 'text', key: 'customBlock', label: 'Extra domains', placeholder: 'kick.com  9gag.com' }
  ]
};
