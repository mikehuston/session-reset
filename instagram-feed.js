/**
 * Session Reset — Instagram feed filter, page side (content script).
 *
 * Two jobs:
 *   1. Pass the popup's on/off setting to instagram-feed-data.js, which removes
 *      ads and suggested posts from the feed data. That script runs in
 *      Instagram's own JavaScript world and can't read extension storage, so the
 *      setting goes through an attribute on the <html> element.
 *   2. Hide the "Suggested for you" accounts panel beside the feed. It isn't part
 *      of the feed data, so it's hidden in the page instead (instagram-feed.css).
 *      It sits outside the scrolling feed, so hiding it can't disturb scrolling.
 */
(() => {
  // Popup setting. The filter is on unless it has been switched off.
  const SETTING_KEY = "instagramFeedFilter";

  // Read by instagram-feed-data.js.
  const SETTING_ATTR = "data-session-reset-instagram-filter";

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

  function applySetting(value) {
    enabled = value !== false;
    document.documentElement.setAttribute(SETTING_ATTR, enabled ? "on" : "off");
    if (enabled) {
      queueCheck();
    } else {
      document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((element) => {
        element.removeAttribute(HIDDEN_ATTR);
      });
    }
  }

  chrome.storage.local.get(SETTING_KEY).then((stored) => applySetting(stored[SETTING_KEY]));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SETTING_KEY]) {
      applySetting(changes[SETTING_KEY].newValue);
    }
  });

  // The panel appears after the page loads and again after client-side navigation.
  new MutationObserver(queueCheck).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
