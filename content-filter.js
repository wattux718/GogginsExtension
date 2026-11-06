/* This filter runs independently of social passes and never changes their timers. */
(() => {
  'use strict';
  const host = location.hostname.toLowerCase().replace(/\.$/, '');
  const google = /^(?:(?:www|m|images)\.)?google\.(?:com(?:\.[a-z]{2})?|co\.[a-z]{2}|[a-z]{2}|cat)$/.test(host);
  const twitter = /(?:^|\.)(?:x|twitter)\.com$/.test(host);
  const pinterest = /(?:^|\.)pinterest\.(?:com(?:\.[a-z]{2})?|co\.[a-z]{2}|[a-z]{2})$/.test(host);
  if (!google && !twitter && !pinterest) return;

  const explicit = /\b(?:porn(?:o(?:graph(?:y|ic|ie))?|hub|pics|stars?)?|nsfw|xxx|nudes?|nudity|naked|topless|uncensored|hentai|erotic(?:a)?|only\s*fans|fansly|xvideos|xnxx|xhamster|spankbang|redgifs|chaturbate|lingerie|bikinis?|thirst\s*traps?|sexy|nues?|tits|boobs|sex\s+(?:videos?|tapes?|cams?)|adult\s+(?:content|videos?|entertainment))\b/;
  const people = '(?:girls?|wom[ae]n|babes?|females?|filles?|femmes?)';
  const appearance = new RegExp('\\b(?:hot|pretty|cute|beautiful|sexy|busty|attractive|jolies?|belles?) ' + people + '\\b');
  const peopleImages = new RegExp('^(?:(?:photos?|pics?|images?|pictures?|videos?) (?:of|de) )?' + people +
    '(?: (?:photos?|pics?|images?|pictures?|videos?|models?|wallpapers?))?$');
  // X search uses a broader list than post captions. Allow common joins in hashtags.
  const xPeople = [
    'lad(?:y|ies)|girlies?|egirls?|e girls?|chicks?|femboys?|milfs?|gilfs?|dilfs?',
    'latin[ao]s?|latinx|latine|hispanics?|brazilians?|colombians?|mexicans?|puerto ricans?|dominicans?|cubans?',
    'asians?|desis?|indians?|koreans?|japanese|chinese|viet(?:namese)?|thais?|filipin[ao]s?|pinays?|pinoys?|indonesians?|malaysians?',
    'arabs?|persians?|turkish|middle eastern|russians?|ukrainians?|africans?|ebony|mixed race'
  ].join('|');
  const xSearchTerms = [
    new RegExp('(?:' + people + '|\\b(?:hot|sexy|cute|pretty|beautiful|young|thick|thicc|curvy|petite|busty|fit)?(?:' + xPeople + '))' +
      '(?:photos?|pics?|images?|pictures?|videos?|models?|wallpapers?|baddies?|daily|hub|of(?:twitter|x))?\\b'),
    /\b(?:baddies?|blondes?|brunettes?|redheads?|curvy|curvaceous|petite|busty|thicc|hourglass|cleavage|booty|bbl|breasts?|nipples?)\b/,
    /\b(?:swimwear|swimsuits?|skin tones?|body types?|toned bod(?:y|ies)|fitness models?)\b/,
    /\b(?:sex|seggs|p0rn|pr0n|n s f w|lewd|horny|soft ?core|fetish(?:es)?|fap(?:ping)?|goon(?:ing)?|rule ?34|r34|18 ?plus|adults? only)\b/,
    /\b(?:after ?dark|spicy (?:content|pics|videos?)|(?:of|only ?fans) ?leaks?|leaked (?:pics|photos|videos?|content)|ass (?:pics|photos|videos?))\b/,
    /\b(?:step ?moms?|step ?sisters?|sugar ?bab(?:y|ies)|sugar ?dadd(?:y|ies))\b/,
    /^(?:black|white|brown|mixed|thick|models?|leaks?|spicy|hardcore|adult|ass|cougars?|mature|mommy|feet|cosplay)$/
  ];
  const sensitive = /\b(?:sensitive (?:content|media|material)|(?:content|media) warning|age restricted (?:content|media|adult))\b/;
  function risky(value, xSearch = false) {
    if (xSearch) value = value.replace(/\b18\s*\+/g, '18 plus');
    const label = value.normalize('NFKD').toLowerCase().replace(/[\p{M}\p{Cf}]/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
    return explicit.test(label) || appearance.test(label) || peopleImages.test(label) || sensitive.test(label) ||
      (xSearch && xSearchTerms.some(pattern => pattern.test(label)));
  }

  let root = document.documentElement;
  const hidden = 'data-focus-filter-hidden';
  const blocked = 'focus-filter-blocked';
  const coverId = 'focus-content-block';
  const cards = twitter ? 'article,[data-testid="tweet"],[data-testid="UserCell"]'
    : pinterest ? '[data-test-id="pin"],[data-testid="pin"],[data-test-id="pinWrapper"],[data-test-id="closeup-container"]'
    : '[data-docid],[data-ri],#search .g';
  const labels = '[alt],[title],[aria-label],a[href],video[poster]';
  const warnings = '[data-sensitive="true"],[data-testid="sensitiveMediaWarning"],[data-testid="sensitiveMediaWarningOverlay"]';
  const items = cards + ',[role="option"],img[alt],a[href],video[poster],[' + hidden + '],' + warnings;
  let lastUrl = '';
  let redirecting = false;
  let blockedSearch = false;

  function checkLocation() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const url = new URL(lastUrl);
      const params = url.searchParams;
      const googleResults = google && /^\/(?:search|images|imgres)\/?$/.test(url.pathname);
      const terms = [...params.getAll('q'), ...params.getAll('query')];
      if (googleResults) terms.push(params.get('as_q'), params.get('as_epq'), params.get('as_oq'), params.get('imgrefurl'), params.get('imgurl'));
      blockedSearch = terms.some(term => term && risky(term, twitter));
      if (!blockedSearch && (twitter || pinterest)) {
        // Profile, hashtag and topic names can lead to the same feeds as a query.
        const [, route, topic] = url.pathname.split('/');
        let term = ['hashtag', 'ideas'].includes(route) ? topic : route;
        try { if (term) term = decodeURIComponent(term); } catch { /* Keep the original text. */ }
        blockedSearch = !!term && risky(term, twitter && route === 'hashtag');
      }
      redirecting = googleResults && !blockedSearch &&
        (params.get('safe') !== 'active' || params.getAll('safe').length > 1);
      root.classList.toggle(blocked, blockedSearch || redirecting);
      if (redirecting) {
        params.set('safe', 'active');
        location.replace(url.href);
      }
    }

    if (!blockedSearch) document.getElementById(coverId)?.remove();
    if (blockedSearch && document.body && !document.getElementById(coverId)) {
      const cover = document.createElement('section');
      cover.id = coverId;
      const card = document.createElement('div');
      card.className = 'focus-card';
      const heading = document.createElement('h1');
      heading.textContent = 'Search blocked';
      const detail = document.createElement('p');
      detail.className = 'focus-sub';
      detail.textContent = 'Your content filter is active.';
      const back = document.createElement('button');
      back.type = 'button';
      back.textContent = 'Back to my task';
      back.addEventListener('click', () => location.replace('about:blank'));
      card.append(heading, detail, back);
      cover.append(card);
      document.body.append(cover);
      back.focus();
      document.querySelectorAll('video, audio').forEach(media => media.pause());
    }
    return blockedSearch || redirecting;
  }

  function riskyLabel(node, xSuggestion) {
    return ['alt', 'title', 'aria-label', 'href', 'poster'].some(attr => {
      const label = node.getAttribute(attr);
      if (!label) return false;
      if (attr !== 'href' && attr !== 'poster') return risky(label, xSuggestion);
      try {
        const url = new URL(label, location.href);
        return risky(decodeURIComponent(url.pathname), xSuggestion) || risky(url.hostname);
      } catch { return false; }
    });
  }

  function filter(item) {
    const xSuggestion = twitter && item.matches('[role="option"]');
    const flagged = risky(item.textContent, xSuggestion) || riskyLabel(item, xSuggestion) ||
      [...item.querySelectorAll(labels)].some(node => riskyLabel(node, xSuggestion)) ||
      item.matches(warnings) || !!item.querySelector(warnings);
    item.toggleAttribute(hidden, flagged);
    if (flagged) item.querySelectorAll('video, audio').forEach(media => media.pause());
  }

  function scan(records) {
    if (!root) {
      root = document.documentElement;
      records = null;
    }
    if (!root || checkLocation()) return;
    const candidates = new Set();
    function collect(node, descendants) {
      const element = node.nodeType === 1 ? node : node.parentElement;
      if (!element) return;
      const container = element.closest(cards) || element.closest(items);
      if (container) candidates.add(container);
      if (descendants) element.querySelectorAll(items).forEach(item => candidates.add(item.closest(cards) || item));
    }
    if (!records) collect(root, true);
    else for (const record of records) {
      collect(record.target, false);
      for (const node of record.addedNodes) collect(node, true);
    }
    for (const item of candidates) if (item.isConnected) filter(item);
  }

  document.addEventListener('play', event => {
    const media = event.target;
    if (media instanceof HTMLMediaElement &&
        (root?.classList.contains(blocked) || media.closest('[' + hidden + ']'))) media.pause();
  }, true);
  window.navigation?.addEventListener('currententrychange', () => scan());
  window.addEventListener('popstate', () => scan());
  new MutationObserver(scan).observe(document, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['alt', 'title', 'aria-label', 'href', 'poster', 'data-testid', 'data-test-id', 'data-sensitive', 'role']
  });
  scan();
})();
