/**
 * Session Reset — background service worker (Manifest V3)
 *
 * Responsibility:
 *   Watch for the moment the *last* tab of a configured site is closed.
 *   After a short grace period (5s), clear that site's cookies so the next
 *   visit starts logged out. If the site is reopened during the grace period,
 *   the pending clear is cancelled.
 *
 * Design notes:
 *   - `chrome.tabs.onRemoved` only gives us a tabId, not a URL, so we keep a
 *     small in-memory map of tabId -> hostname (populated from onUpdated and a
 *     one-time scan on startup). We look the host up when the tab closes.
 *   - The grace period uses `setTimeout`. `chrome.alarms` has a 30s minimum, so
 *     it can't express a 5s delay. A service worker stays alive for ~30s after
 *     an event (the tab-close event we just handled), which comfortably covers
 *     our 5s timer.
 *   - We only ever see URLs for sites the user has granted host access to, which
 *     keeps the permission footprint minimal.
 */

// Grace period between closing the last tab and clearing cookies.
const GRACE_MS = 5000;

// tabId -> hostname, for tabs we can see (i.e. configured sites we have access to).
const tabHosts = new Map();

// site host -> timeout id, for clears currently waiting out their grace period.
const pendingTimers = new Map();

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

/**
 * Returns the configured sites: [{ host: "linkedin.com", enabled: true }, ...].
 */
async function getSites() {
  const { sites } = await chrome.storage.local.get({ sites: [] });
  return sites;
}

// ---------------------------------------------------------------------------
// Feedback (so you can tell it's working without digging through code)
// ---------------------------------------------------------------------------

/** Timestamped console log, all under one easy-to-spot prefix. */
function log(...args) {
  const time = new Date().toLocaleTimeString();
  console.log(`[Session Reset ${time}]`, ...args);
}

/**
 * Briefly show a badge on the toolbar icon so a reset is visible at a glance,
 * even with DevTools closed. Clears itself after a few seconds.
 */
function flashBadge(text) {
  chrome.action.setBadgeBackgroundColor({ color: "#0969da" });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 6000);
}

/**
 * Record a reset in a small rolling history (newest first, capped at 10) so the
 * popup can show a human-readable "Recently reset" list.
 */
async function recordClear(host, count) {
  const { history = [] } = await chrome.storage.local.get({ history: [] });
  history.unshift({ host, count, time: Date.now() });
  await chrome.storage.local.set({ history: history.slice(0, 10) });
}

// ---------------------------------------------------------------------------
// Host matching
// ---------------------------------------------------------------------------

/**
 * Extracts a hostname from a URL, or null for URLs we don't care about
 * (chrome://, about:, empty, etc.).
 */
function parseHost(url) {
  if (!url) return null;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") return null;
    return hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True if `hostname` is `siteHost` or a subdomain of it.
 * e.g. hostMatches("www.linkedin.com", "linkedin.com") === true
 */
function hostMatches(hostname, siteHost) {
  return hostname === siteHost || hostname.endsWith("." + siteHost);
}

/**
 * True if any currently open tab belongs to `siteHost` (or a subdomain).
 */
async function hasOpenTabForHost(siteHost) {
  const tabs = await chrome.tabs.query({});
  return tabs.some((tab) => {
    const host = parseHost(tab.url);
    return host && hostMatches(host, siteHost);
  });
}

// ---------------------------------------------------------------------------
// Grace-period timers
// ---------------------------------------------------------------------------

/** Cancel a pending clear for a site (e.g. the user reopened it in time). */
function cancelTimer(siteHost) {
  const id = pendingTimers.get(siteHost);
  if (id !== undefined) {
    clearTimeout(id);
    pendingTimers.delete(siteHost);
  }
}

/** Start (or restart) the grace-period countdown for a site. */
function scheduleClear(siteHost) {
  cancelTimer(siteHost);
  const id = setTimeout(() => {
    pendingTimers.delete(siteHost);
    maybeClear(siteHost);
  }, GRACE_MS);
  pendingTimers.set(siteHost, id);
  log(`Last tab for ${siteHost} closed — clearing cookies in ${GRACE_MS / 1000}s (reopen to cancel).`);
}

/**
 * Fired when the grace period elapses. Re-checks the world before acting:
 * the site must still be enabled and still have no open tabs.
 */
async function maybeClear(siteHost) {
  const sites = await getSites();
  const site = sites.find((s) => s.enabled && s.host === siteHost);
  if (!site) return; // Removed or disabled while we waited.

  if (await hasOpenTabForHost(siteHost)) return; // Reopened just in time.

  await clearCookiesForHost(siteHost);
}

// ---------------------------------------------------------------------------
// Cookie clearing
// ---------------------------------------------------------------------------

/**
 * Removes all cookies for a host and its subdomains.
 *
 * `chrome.cookies.getAll({ domain })` returns cookies scoped to `domain` and
 * any subdomain. Each removal needs a URL reconstructed from the cookie's own
 * domain/path/secure flag.
 */
async function clearCookiesForHost(siteHost) {
  let cookies;
  try {
    cookies = await chrome.cookies.getAll({ domain: siteHost });
  } catch (err) {
    // Usually means host access was revoked. Nothing to do.
    log(`Cannot read cookies for ${siteHost} (host access missing?):`, err);
    return;
  }

  let removed = 0;
  for (const cookie of cookies) {
    // Cookie domains may have a leading dot (".example.com"); strip it for the URL.
    const domain = cookie.domain.replace(/^\./, "");
    const url = `${cookie.secure ? "https" : "http"}://${domain}${cookie.path}`;
    try {
      await chrome.cookies.remove({
        url,
        name: cookie.name,
        storeId: cookie.storeId,
      });
      removed++;
    } catch (err) {
      log(`Failed to remove cookie "${cookie.name}" for ${siteHost}:`, err);
    }
  }

  log(`✅ Cleared ${removed} cookie(s) for ${siteHost} — you'll be logged out next visit.`);
  flashBadge(String(removed));
  await recordClear(siteHost, removed);
}

// ---------------------------------------------------------------------------
// Tab tracking
// ---------------------------------------------------------------------------

/** Record a tab's host and cancel any grace timer the tab "rescues". */
function trackTab(tabId, url) {
  const host = parseHost(url);
  if (!host) {
    tabHosts.delete(tabId);
    return;
  }
  tabHosts.set(tabId, host);

  // Reopening/navigating to a site that's waiting to be cleared cancels it.
  for (const siteHost of pendingTimers.keys()) {
    if (hostMatches(host, siteHost)) {
      cancelTimer(siteHost);
      log(`${siteHost} reopened within the grace period — cookies kept.`);
    }
  }
}

/** Rebuild the tabId -> host map from scratch (used when the worker starts). */
async function rebuildTabHosts() {
  tabHosts.clear();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const host = parseHost(tab.url);
    if (host) tabHosts.set(tab.id, host);
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

// Keep the host map current as tabs navigate.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || tab.url) {
    trackTab(tabId, changeInfo.url || tab.url);
  }
});

// The core trigger: a tab was closed.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const host = tabHosts.get(tabId);
  tabHosts.delete(tabId);
  if (!host) return;

  const sites = await getSites();
  const site = sites.find((s) => s.enabled && hostMatches(host, s.host));
  if (!site) return;

  // Only start the countdown once the *last* tab for this site is gone.
  if (await hasOpenTabForHost(site.host)) return;

  scheduleClear(site.host);
});

// Rebuild state whenever the worker (re)starts.
chrome.runtime.onStartup.addListener(rebuildTabHosts);
chrome.runtime.onInstalled.addListener(rebuildTabHosts);

// Also rebuild on cold module load (covers the worker being respawned by an event).
rebuildTabHosts();
