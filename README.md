# Strict Focus Mode

Version 12 keeps YouTube available and adds escalating waits for social sites and recommendation browsing.

## Content filter

Version 12.1 blocks known adult sites and risky searches on X, Pinterest, and Google, including Google Images. Google results use SafeSearch. The extension hides posts, pins, and results when their labels, captions, or sensitive content warnings match. Ordinary images remain available. The filter stays active during a Quick check and works separately from the site timers. It checks text and labels locally, so unlabeled images can still slip through.

On X, the search filter also covers category names like “Latina” and “Asian”, appearance terms, adult slang, and common joined hashtags. It can also block ordinary searches that use those words.

## Social sites

- On Instagram, X/Twitter, Reddit and every other enabled site, click **Quick check** to start a countdown. Waiting on the block screen without clicking does not count.
- The first check requires **10 seconds**, then opens that site for **five minutes**.
- When the five minutes end, the page is covered again. The next checks require **30 seconds, 1 minute, 2 minutes, 4 minutes, 8 minutes**, then **10 minutes maximum**.
- Each site has its own daily progression. Twitter and X share theirs. Extra domains use the same rules.
- Countdown deadlines and passes are shared across tabs and survive refreshing or restarting the browser. Opening another tab cannot extend an active pass.
- Starting a new countdown advances the next wait; cancelling does not undo that step. Progress resets at local midnight. A countdown or pass already in progress keeps its original deadline.
- **Done checking** ends a pass early. **Cancel wait** stops a countdown. The cover preserves the underlying page and drafts, although the site itself may update its content.
- Uncheck a site in the popup to remove its timer. Passes never change this preference. Checks also work during focus sessions.

## YouTube

- Search, direct video links, live videos and embedded players are always available. There are no visit limits, daily caps, focus/schedule blocks, pre-video reasons, playback waits or check-in interruptions.
- The eating option has been removed. YouTube Music stays untouched.
- Recommendations start hidden. Click **Browse recommendations** to reveal them for **60 seconds** by default.
- The first recommendation window of each day requires **10 seconds**, then **30 seconds, 1 minute, 2 minutes**, and so on, up to **10 minutes**.
- Daily progression is shared across YouTube tabs, but each browsing window belongs to the tab that unlocked it. **Middle-click as many videos as you want** during the minute: they open in new tabs without closing the original recommendation window.
- When the minute ends, only recommendations hide. Videos keep playing and search stays available. Navigating in the same tab also hides recommendations; opening another window requires the next wait.
- Refreshing the same tab restores its current countdown or recommendation deadline without extending it. Closing a tab or restarting the browser ends that tab's recommendation window, while keeping its daily progression.
- Cancel a wait or hide recommendations early with the same button. Starting a countdown advances the next wait even if cancelled.
- The popup can adjust the recommendation window duration, hide comments and Shorts suggestions, hide thumbnails outside recommendation windows, and disable autoplay. Direct Shorts links remain available.
- The optional focus timer saves your next task and locks settings until ended. It does not block YouTube.

## Activate the update

1. Open your browser's Extensions page: chrome://extensions in Chrome or edge://extensions in Edge.
2. Find **Strict Focus Mode** and click **Reload** (enable Developer mode if needed).
3. Refresh existing YouTube, social, and Google tabs to load the updated scripts.

For a new installation, choose **Load unpacked** and select this YoutubeBlocker folder.

Updating an older installation removes the old YouTube restriction and eating state, sets recommendation windows to 60 seconds and starts the new wait progression. Saved site preferences, tasks and existing social passes are preserved.

The extension must remain enabled with access to the relevant sites. Browser suspension can delay visual enforcement until execution resumes. The Discord batch file is separate.

## Validation

From the parent Focus folder:

    node YoutubeBlocker/tests.cjs
    node YoutubeBlocker/browser-tests.cjs

The policy/worker suite checks migration, escalation, concurrent requests, five-minute passes, one-minute recommendations, site validation, midnight reset, startup and per-tab windows with a controlled clock.

Browser fixtures use Playwright and Chrome. Set FOCUS_PLAYWRIGHT to a local Playwright package path if needed. They run the actual worker code and cover middle-click queueing, expiry, refreshes, uninterrupted YouTube, social drafts, popup settings and removed controls. Both scripts can also run directly from this folder.

Fixtures do not replace checking the installed extension against live sites.
