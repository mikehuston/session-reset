/**
 * Session Reset — popup UI logic.
 *
 * Lets you add/remove sites and enable/disable each one. Settings live in
 * chrome.storage.local under the `sites` key:
 *   [{ host: "linkedin.com", enabled: true }, ...]
 *
 * When you add a site we request host access *just for that site* (optional
 * permissions), so the extension never holds broad access it doesn't use.
 */

const listEl = document.getElementById("site-list");
const emptyEl = document.getElementById("empty");
const formEl = document.getElementById("add-form");
const inputEl = document.getElementById("site-input");
const errorEl = document.getElementById("error");
const historySectionEl = document.getElementById("history-section");
const historyListEl = document.getElementById("history-list");

// Instagram toggles: storage key -> checkbox. Both are on by default.
const INSTAGRAM_TOGGLES = {
  instagramFeedFilter: document.getElementById("instagram-filter"),
  instagramHideReels: document.getElementById("instagram-reels"),
};

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function getSites() {
  const { sites } = await chrome.storage.local.get({ sites: [] });
  return sites;
}

async function setSites(sites) {
  await chrome.storage.local.set({ sites });
}

// ---------------------------------------------------------------------------
// Host + permission helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes freeform input ("https://www.LinkedIn.com/feed", "reddit.com/")
 * down to a bare hostname ("www.linkedin.com", "reddit.com"). Returns null if
 * the input can't be understood as a host.
 */
function normalizeHost(input) {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (!value.includes("://")) value = "https://" + value;
  try {
    const host = new URL(value).hostname;
    // Require at least one dot so "asdf" doesn't slip through.
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** Match patterns needed to read/clear a host's cookies (incl. subdomains). */
function originsForHost(host) {
  return [`*://${host}/*`, `*://*.${host}/*`];
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function render() {
  const sites = await getSites();
  listEl.textContent = "";
  emptyEl.hidden = sites.length > 0;

  sites.forEach((site, index) => {
    const li = document.createElement("li");
    li.className = "site-row" + (site.enabled ? "" : " disabled");

    // Enable/disable toggle.
    const toggle = document.createElement("label");
    toggle.className = "toggle";
    toggle.title = site.enabled ? "Enabled" : "Disabled";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = site.enabled;
    checkbox.addEventListener("change", () => toggleSite(index));
    const slider = document.createElement("span");
    slider.className = "slider";
    toggle.append(checkbox, slider);

    // Host label.
    const host = document.createElement("span");
    host.className = "site-host";
    host.textContent = site.host;

    // Remove button.
    const remove = document.createElement("button");
    remove.className = "remove-btn";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.title = `Remove ${site.host}`;
    remove.addEventListener("click", () => removeSite(index));

    li.append(toggle, host, remove);
    listEl.append(li);
  });
}

/** Turn a timestamp into a short "just now / 5m ago / 2h ago / date" label. */
function timeAgo(ts) {
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

/** Render the "Recently reset" list from stored history. */
async function renderHistory() {
  const { history = [] } = await chrome.storage.local.get({ history: [] });
  historySectionEl.hidden = history.length === 0;
  historyListEl.textContent = "";

  history.forEach((entry) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${entry.host} · ${entry.count} cookie${entry.count === 1 ? "" : "s"}`;
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = timeAgo(entry.time);
    li.append(label, when);
    historyListEl.append(li);
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function addSite(rawInput) {
  clearError();
  const host = normalizeHost(rawInput);
  if (!host) {
    showError("Enter a valid website, like linkedin.com");
    return;
  }

  const sites = await getSites();
  if (sites.some((s) => s.host === host)) {
    showError(`${host} is already in the list.`);
    return;
  }

  // Ask for host access for just this site. Must be triggered by this click
  // (a user gesture), which is why the request lives here in the popup.
  let granted;
  try {
    granted = await chrome.permissions.request({ origins: originsForHost(host) });
  } catch (err) {
    showError("Could not request permission: " + err.message);
    return;
  }
  if (!granted) {
    showError(`Permission is required to clear ${host}'s cookies.`);
    return;
  }

  sites.push({ host, enabled: true });
  await setSites(sites);
  inputEl.value = "";
  await render();
}

async function toggleSite(index) {
  const sites = await getSites();
  if (!sites[index]) return;
  sites[index].enabled = !sites[index].enabled;
  await setSites(sites);
  await render();
}

async function removeSite(index) {
  const sites = await getSites();
  const [removed] = sites.splice(index, 1);
  await setSites(sites);

  // Give the host permission back so we don't retain access we no longer need.
  if (removed) {
    try {
      await chrome.permissions.remove({ origins: originsForHost(removed.host) });
    } catch {
      /* Non-fatal: the site is gone from the list either way. */
    }
  }
  await render();
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  addSite(inputEl.value);
});

inputEl.addEventListener("input", clearError);

// Instagram toggles. Content already loaded stays as it is, so a change shows
// fully after Instagram is reloaded.
const instagramDefaults = Object.fromEntries(Object.keys(INSTAGRAM_TOGGLES).map((key) => [key, true]));
chrome.storage.local.get(instagramDefaults).then((stored) => {
  for (const [key, checkbox] of Object.entries(INSTAGRAM_TOGGLES)) {
    checkbox.checked = stored[key];
  }
});
for (const [key, checkbox] of Object.entries(INSTAGRAM_TOGGLES)) {
  checkbox.addEventListener("change", () => {
    chrome.storage.local.set({ [key]: checkbox.checked });
  });
}

// Keep the "Recently reset" list fresh if a reset happens while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.history) renderHistory();
});

render();
renderHistory();
