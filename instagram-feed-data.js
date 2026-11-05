/**
 * Session Reset — Instagram filters, data side.
 *
 * Removes things from Instagram's data before Instagram draws anything:
 *   - Home feed: ads and "Suggested for you" posts.
 *   - Reels: everything except a reel you opened directly (from a link someone
 *     sent you, a DM, or a search result). The Reels tab itself shows nothing.
 *
 * Why the data and not the page: the feed keeps only the posts near the screen
 * in the page and remembers each post's height. Hiding posts after they render
 * throws that bookkeeping off and makes scrolling bounce. Posts that are never
 * rendered can't cause that.
 *
 * How: Instagram reads all of this data with JSON.parse, both the first page
 * (embedded in the HTML) and later pages (loaded as you scroll). This script
 * wraps JSON.parse and edits only the two lists below. Anything else Instagram
 * parses passes through untouched, and if filtering ever fails the original data
 * is returned.
 *
 * This runs in the page's own JavaScript world (manifest: "world": "MAIN") so it
 * can wrap Instagram's JSON.parse, which means it can't use chrome.* APIs. The
 * popup settings reach it through attributes set by instagram-feed.js.
 */
(() => {
  // The home feed. Each item is "media" (a post from someone you follow), "ad",
  // or "explore_story" (a suggested post).
  const FEED_KEY = "xdt_api__v1__feed__timeline__connection";
  const REMOVED_FEED_TYPES = { ad: "ad", explore_story: "suggested post" };

  // The Reels viewer. Opening a reel's link shows that reel first, followed by
  // an endless list of reels Instagram picks.
  const REELS_KEY = "xdt_api__v1__clips__home__connection_v2";

  // instagram-feed.js sets these to "off" when a filter is switched off.
  const FEED_SETTING_ATTR = "data-session-reset-instagram-filter";
  const REELS_SETTING_ATTR = "data-session-reset-instagram-reels";

  // If this many feed pages in a row contain nothing but removed items, stop
  // asking Instagram for more. Otherwise, once you've seen every recent post from
  // accounts you follow (when Instagram serves only suggestions), the feed would
  // keep fetching pages that all come back empty.
  const MAX_EMPTY_PAGES = 3;

  let emptyPagesInARow = 0;

  const nativeParse = JSON.parse;

  function isOn(settingAttr) {
    return document.documentElement.getAttribute(settingAttr) !== "off";
  }

  /** Finds every list ({ edges, page_info }) stored under `key` in parsed data. */
  function findConnections(value, key, found = []) {
    if (!value || typeof value !== "object") return found;
    if (value[key] && Array.isArray(value[key].edges)) found.push(value[key]);
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") findConnections(child, key, found);
    }
    return found;
  }

  // ---------------------------------------------------------------------------
  // Home feed
  // ---------------------------------------------------------------------------

  /** The removed type of a feed item, or null to keep it. */
  function removedFeedType(edge) {
    const node = edge && edge.node;
    if (!node) return null;
    return Object.keys(REMOVED_FEED_TYPES).find((type) => node[type] != null) || null;
  }

  function filterFeed(connection) {
    const counts = {};
    const kept = connection.edges.filter((edge) => {
      const type = removedFeedType(edge);
      if (type) counts[type] = (counts[type] || 0) + 1;
      return !type;
    });
    const removed = connection.edges.length - kept.length;
    if (removed === 0) {
      emptyPagesInARow = 0;
      return;
    }

    connection.edges = kept;
    const summary = Object.entries(counts)
      .map(([type, count]) => `${count} ${REMOVED_FEED_TYPES[type]}${count === 1 ? "" : "s"}`)
      .join(", ");
    console.log(`[Session Reset] Removed ${summary} from an Instagram feed page.`);

    emptyPagesInARow = kept.length === 0 ? emptyPagesInARow + 1 : 0;
    if (emptyPagesInARow >= MAX_EMPTY_PAGES && connection.page_info) {
      connection.page_info.has_next_page = false;
      console.log("[Session Reset] Only suggestions left in your feed, so it stops here.");
    }
  }

  // ---------------------------------------------------------------------------
  // Reels
  // ---------------------------------------------------------------------------

  /**
   * The code of the reel being opened, from an address like /reel/<code>/ or
   * /reels/<code>/. Null on the Reels tab itself (/reels/) and on audio pages.
   */
  function openedReelCode() {
    const match = location.pathname.match(/^\/reels?\/([A-Za-z0-9_-]+)/);
    return match && match[1] !== "audio" ? match[1] : null;
  }

  function filterReels(connection) {
    const code = openedReelCode();
    const kept = connection.edges.filter((edge) => code && edge?.node?.media?.code === code);
    const removed = connection.edges.length - kept.length;

    connection.edges = kept;
    // Nothing more to load, so Instagram stops fetching reels for this viewer.
    if (connection.page_info) connection.page_info.has_next_page = false;

    if (removed > 0) {
      console.log(
        `[Session Reset] Removed ${removed} reel${removed === 1 ? "" : "s"}` +
          (kept.length ? ", kept the one you opened." : ".")
      );
    }
  }

  // ---------------------------------------------------------------------------
  // JSON.parse wrapper
  // ---------------------------------------------------------------------------

  const FILTERS = [
    { key: FEED_KEY, settingAttr: FEED_SETTING_ATTR, filter: filterFeed },
    { key: REELS_KEY, settingAttr: REELS_SETTING_ATTR, filter: filterReels },
  ];

  JSON.parse = function parse(text, reviver) {
    const result = nativeParse(text, reviver);
    if (typeof text !== "string") return result;

    for (const { key, settingAttr, filter } of FILTERS) {
      if (!text.includes(key) || !isOn(settingAttr)) continue;
      try {
        findConnections(result, key).forEach(filter);
      } catch (error) {
        console.warn("[Session Reset] Couldn't filter Instagram data:", error);
      }
    }
    return result;
  };
})();
