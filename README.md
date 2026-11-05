# Session Reset

A Chrome (Manifest V3) extension that automatically logs you out of chosen
websites. When you close the **last** tab for a configured site, Session Reset
waits **5 seconds** and then clears that site's cookies — so your next visit
starts fresh (logged out). Reopen the site within those 5 seconds and nothing
is cleared.

## Features

- Configure a list of sites (e.g. `linkedin.com`, `instagram.com`, `reddit.com`).
- Enable/disable each site individually without removing it.
- 5-second grace period so a quick reopen (or accidental close) is forgiven.
- Subdomains count too — closing `www.linkedin.com` clears `linkedin.com` cookies.
- Visible feedback: a toolbar badge flashes on each reset and the popup shows a
  "Recently reset" history (see [How to tell it worked](#how-to-tell-it-worked)).
- Settings stored locally (`chrome.storage.local`); nothing leaves your machine.
- Instagram feed filter: hides ads and "Suggested for you" on the home feed, with
  a toggle in the popup (on by default).
- **Minimal permissions:** `storage` and `cookies`, plus access to
  `www.instagram.com` for the feed filter (needs Chrome 111 or newer). Access to any other site's cookies is
  requested *per site*, when you add it — not broadly.

## Load the unpacked extension

1. Open **`chrome://extensions`** in Chrome (or a Chromium browser like Edge/Brave).
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select this folder (the one containing `manifest.json`).
5. The **Session Reset** icon appears in the toolbar. Pin it for easy access.

## Usage

1. Click the toolbar icon to open the popup.
2. Type a site (e.g. `linkedin.com`) and click **Add**.
3. Chrome will prompt for permission to access that site — click **Allow**.
   (This grants only that one site's host access.)
4. Use the toggle to enable/disable a site, or **Remove** to delete it.

That's it. Browse normally; when you close a configured site's last tab, its
cookies are cleared 5 seconds later.

## How to tell it worked

You get feedback in three places — no coding knowledge required:

1. **Toolbar badge.** When a site is reset, a small number briefly appears on the
   Session Reset icon — that's how many cookies were cleared.
2. **"Recently reset" list.** Open the popup; recent resets are listed at the
   bottom with the site, cookie count, and how long ago (e.g. `reddit.com · 2
   cookies · just now`).
3. **The real proof.** Revisit the site — you should be logged out.

### Watching the live log (optional, for the curious)

The extension logs each step to its own console:

1. Go to `chrome://extensions`.
2. Find **Session Reset** and click the **service worker** link (blue text under
   the card; enable Developer mode if you don't see it).
3. A DevTools window opens. Watch the **Console** as you close a site's last tab:

   ```
   [Session Reset 3:42:10 PM] Last tab for reddit.com closed — clearing cookies in 5s (reopen to cancel).
   [Session Reset 3:42:15 PM] ✅ Cleared 2 cookie(s) for reddit.com — you'll be logged out next visit.
   ```

   Reopen the site within 5 seconds instead and you'll see it was cancelled:

   ```
   [Session Reset 3:42:13 PM] reddit.com reopened within the grace period — cookies kept.
   ```

## How it works

- **`background.js`** (service worker) tracks which host each tab is on. On
  `tabs.onRemoved` it checks whether the closed tab was the last one for an
  enabled site; if so it starts a 5-second timer. Navigating back to the site
  cancels the timer. When the timer fires, it removes every cookie for that host
  (and its subdomains) via the `cookies` API.
- **`popup.*`** is the settings UI. Adding a site requests host access for just
  that site (`chrome.permissions.request`); removing it releases that access.
- **`instagram-feed-data.js`** runs inside Instagram's own page code and removes
  ads and suggested posts from the feed data before Instagram draws it.
- **`instagram-feed.js`** (content script) passes the popup setting to that script
  and hides the "Suggested for you" panel beside the feed, styled by
  **`instagram-feed.css`**. Both only change what your browser shows, and send
  nothing anywhere.

### Instagram feed filter

It's on by default. After switching it under **Instagram** in the popup, reload
Instagram to see the change. To see what it removes, open DevTools on the feed
(Cmd+Option+J) and look for lines like this in the Console:

```
[Session Reset] Removed 2 ads, 3 suggested posts from an Instagram feed page.
```

- Ads and suggested posts are removed from the data Instagram loads, not hidden
  on the page. Hiding them on the page made scrolling bounce, because Instagram's
  feed remembers each post's height.
- Instagram labels each feed item as a regular post, an ad, or a suggestion, so
  this works in any language. It relies on Instagram's internal data format,
  though. If Instagram changes it, ads and suggestions simply show up again.
- Once you've seen every recent post from people you follow, Instagram serves only
  suggestions. When three loads in a row contain nothing else, the feed stops
  there instead of fetching empty pages.
- The panel beside the feed is only recognized when Instagram is set to English.

### Notes / limitations

- The grace period uses `setTimeout` rather than `chrome.alarms`, because alarms
  have a 30-second minimum and can't express a 5-second delay. The service worker
  stays alive well past 5 seconds after the tab-close event, so the timer runs
  reliably.
- Only regular cookies are cleared. `localStorage`/`IndexedDB` are left untouched;
  most sites treat you as logged out once the session cookie is gone.

## Files

| File            | Purpose                                             |
| --------------- | --------------------------------------------------- |
| `manifest.json` | Extension manifest (MV3), permissions, entry points |
| `background.js` | Tab tracking, grace period, cookie clearing         |
| `popup.html`    | Popup markup                                        |
| `popup.css`     | Popup styles                                        |
| `popup.js`      | Popup logic + per-site permission requests          |
| `instagram-feed-data.js` | Removes ads and suggested posts from Instagram's feed data |
| `instagram-feed.js`      | Passes the popup setting along; hides the suggestions panel |
| `instagram-feed.css`     | Hides the panel `instagram-feed.js` marks                   |
