/**
 * Session Reset — Instagram filters, page side (content script).
 *
 * Two jobs:
 *   1. Pass the popup's on/off settings to instagram-feed-data.js, which filters
 *      the feed and Reels data. That script runs in Instagram's own JavaScript
 *      world and can't read extension storage, so each setting goes through an
 *      attribute on the <html> element. instagram-feed.css also reads the Reels
 *      attribute to hide the Reels button.
 *   2. Hide the "Suggested for you" accounts panel beside the feed. It isn't part
 *      of the feed data, so it's hidden in the page instead (instagram-feed.css).
 *      It sits outside the scrolling feed, so hiding it can't disturb scrolling.
 */
(() => {
  // Popup settings (storage key -> <html> attribute). Each is on unless it has
  // been switched off.
  const FEED_SETTING_KEY = "instagramFeedFilter";
  const SETTINGS = {
    [FEED_SETTING_KEY]: "data-session-reset-instagram-filter",
    instagramHideReels: "data-session-reset-instagram-reels",
  };

  // Elements with this attribute are hidden by instagram-feed.css.
  const HIDDEN_ATTR = "data-session-reset-hidden";

  // The panel's "See all" link, which points to Instagram's people suggestions.
  const SUGGESTIONS_LINK = 'main a[href^="/explore/people"]';

  // How far above the "See all" link to look for the panel's container.
  const MAX_PANEL_DEPTH = 6;

  let enabled = true;
  let checkQueued = false;

  /**
   * Finds the panel from its "See all" link: the nearest ancestor that also holds
   * Follow buttons. Never returns anything containing a post, so a change in
   * Instagram's layout can't hide the feed.
   */
  function findSuggestionsPanel(link) {
    let node = link.parentElement;
    for (let depth = 0; node && depth < MAX_PANEL_DEPTH; depth++) {
      if (node.querySelector("article")) return null;
      const hasFollowButton = [...node.querySelectorAll('button, [role="button"]')].some(
        (button) => button.textContent.trim() === "Follow"
      );
      if (hasFollowButton) return node;
      node = node.parentElement;
    }
    return null;
  }

  function hideSuggestionsPanel() {
    checkQueued = false;
    if (!enabled || location.pathname !== "/") return;

    document.querySelectorAll(SUGGESTIONS_LINK).forEach((link) => {
      if (link.closest("article")) return;
      const panel = findSuggestionsPanel(link);
      if (panel && !panel.hasAttribute(HIDDEN_ATTR)) {
        panel.setAttribute(HIDDEN_ATTR, "suggested");
        console.log('[Session Reset] Hid the "Suggested for you" panel.');
      }
    });
  }

  /** Instagram changes the page constantly, so check at most once per frame. */
  function queueCheck() {
    if (checkQueued || !enabled) return;
    checkQueued = true;
    requestAnimationFrame(hideSuggestionsPanel);
  }

  function applySetting(key, value) {
    const on = value !== false;
    document.documentElement.setAttribute(SETTINGS[key], on ? "on" : "off");
    if (key !== FEED_SETTING_KEY) return;

    // The suggestions panel follows the feed setting.
    enabled = on;
    if (enabled) {
      queueCheck();
    } else {
      document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((element) => {
        element.removeAttribute(HIDDEN_ATTR);
      });
    }
  }

  chrome.storage.local.get(Object.keys(SETTINGS)).then((stored) => {
    Object.keys(SETTINGS).forEach((key) => applySetting(key, stored[key]));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    Object.keys(SETTINGS).forEach((key) => {
      if (changes[key]) applySetting(key, changes[key].newValue);
    });
  });

  // The panel appears after the page loads and again after client-side navigation.
  new MutationObserver(queueCheck).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
