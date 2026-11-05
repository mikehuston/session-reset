/**
 * Session Reset — Instagram feed filter, data side.
 *
 * Removes ads and "Suggested for you" posts from Instagram's feed data before
 * Instagram draws anything, so they never appear in the page at all.
 *
 * Why the data and not the page: the feed keeps only the posts near the screen
 * in the page and remembers each post's height. Hiding posts after they render
 * throws that bookkeeping off and makes scrolling bounce. Posts that are never
 * rendered can't cause that.
 *
 * How: every page of the feed is JSON that Instagram reads with JSON.parse, both
 * the first page (embedded in the HTML) and later pages (loaded as you scroll).
 * Each feed item is typed: "media" (a post from someone you follow), "ad", or
 * "explore_story" (a suggested post). This script wraps JSON.parse and drops the
 * last two types from the feed. Anything else Instagram parses passes through
 * untouched, and if filtering ever fails the original data is returned.
 *
 * This runs in the page's own JavaScript world (manifest: "world": "MAIN") so it
 * can wrap Instagram's JSON.parse, which means it can't use chrome.* APIs. The
 * popup setting reaches it through an attribute set by instagram-feed.js.
 */
(() => {
  const FEED_KEY = "xdt_api__v1__feed__timeline__connection";

  // Feed item types to remove.
  const REMOVED_TYPES = { ad: "ad", explore_story: "suggested post" };

  // instagram-feed.js sets this to "off" when the filter is switched off.
  const SETTING_ATTR = "data-session-reset-instagram-filter";

  // If this many feed pages in a row contain nothing but removed items, stop
  // asking Instagram for more. Otherwise, once you've seen every recent post from
  // accounts you follow (when Instagram serves only suggestions), the feed would
  // keep fetching pages that all come back empty.
  const MAX_EMPTY_PAGES = 3;

  let emptyPagesInARow = 0;

  const nativeParse = JSON.parse;

  function filterEnabled() {
    return document.documentElement.getAttribute(SETTING_ATTR) !== "off";
  }

  /** Finds every feed connection ({ edges, page_info }) inside parsed data. */
  function findFeedConnections(value, found = []) {
    if (!value || typeof value !== "object") return found;
    if (value[FEED_KEY] && Array.isArray(value[FEED_KEY].edges)) {
      found.push(value[FEED_KEY]);
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") findFeedConnections(child, found);
    }
    return found;
  }

  /** The removed type of a feed item, or null to keep it. */
  function removedType(edge) {
    const node = edge && edge.node;
    if (!node) return null;
    return Object.keys(REMOVED_TYPES).find((type) => node[type] != null) || null;
  }

  function filterConnection(connection) {
    const counts = {};
    const kept = connection.edges.filter((edge) => {
      const type = removedType(edge);
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
      .map(([type, count]) => `${count} ${REMOVED_TYPES[type]}${count === 1 ? "" : "s"}`)
      .join(", ");
    console.log(`[Session Reset] Removed ${summary} from an Instagram feed page.`);

    emptyPagesInARow = kept.length === 0 ? emptyPagesInARow + 1 : 0;
    if (emptyPagesInARow >= MAX_EMPTY_PAGES && connection.page_info) {
      connection.page_info.has_next_page = false;
      console.log("[Session Reset] Only suggestions left in your feed, so it stops here.");
    }
  }

  JSON.parse = function parse(text, reviver) {
    const result = nativeParse(text, reviver);
    if (typeof text !== "string" || !text.includes(FEED_KEY) || !filterEnabled()) {
      return result;
    }
    try {
      findFeedConnections(result).forEach(filterConnection);
    } catch (error) {
      console.warn("[Session Reset] Couldn't filter Instagram feed data:", error);
    }
    return result;
  };
})();
