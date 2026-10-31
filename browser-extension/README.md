# Browser tab search

This optional companion lets AATWS search titles and URLs of open browser tabs.
Enable AATWS, install the native host, then load the browser companion. Normal
search includes tab results; type `tabs` to list all shared tabs, or `tabs words`
to search only tabs. Use the usual selection keys and Enter (or click) to activate
a tab and focus its browser window. Results are ordered by last access when the
browser supplies that timestamp. Tab results span all workspaces and monitors;
browser tab IDs do not expose GNOME workspace/monitor information. Single-app
window mode does not include tabs.

## Install for development

Requires a native Linux browser and `/usr/bin/python3` with PyGObject (`python3-gi`
on Debian/Ubuntu, `python3-gobject` on Fedora). Sandboxed Flatpak/Snap browsers
require their own native messaging support and are not covered by this installer.

From this directory run:

```sh
python3 install.py
```

The script copies the host and builds both browser companions under
`~/.local/share/aatws-browser-tabs` (or `$XDG_DATA_HOME/aatws-browser-tabs`). It
registers the Firefox host under `~/.mozilla/native-messaging-hosts`.

- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
  Add-on**, then select the generated `firefox/manifest.json`. Temporary add-ons
  disappear on browser restart; permanent distribution requires Mozilla signing.
- **Chromium/Chrome/Brave/Edge:** open the browser's extensions page, enable
  **Developer mode**, choose **Load unpacked**, and select the generated `chromium`
  directory. Copy its extension ID, then run `python3 install.py --chromium-id ID`.
  Reload the companion. The installer registers that specific ID for those four
  browsers using `$XDG_CONFIG_HOME` (default `~/.config`).

The companion retries the native host connection every five seconds. The host
also republishes its snapshot every five seconds so Shell restarts and disabling
then re-enabling AATWS recover automatically. Reopen AATWS to refresh search
results after tabs are opened/closed/renamed; an already open popup keeps its
snapshot. Activating a tab that has since closed is harmless.

## Data and cleanup

The companion requests `tabs` and `nativeMessaging`, plus `favicon` on Chromium
to read icons from the browser cache. There are no content scripts, external
network requests, browser debugging ports, or on-disk tab snapshots. Titles, URLs,
browser window/tab IDs, favicons and access timestamps travel over native messaging
and the user's session D-Bus. Private/incognito tabs are excluded. Each browser
profile's native-host process has its own D-Bus identity, so tab IDs cannot collide.
Closing its connection removes its results; disabling AATWS clears all snapshots.
Window actions (close, move, preview, etc.) do not apply to tab results.

To uninstall, remove the companion in your browser, delete its
`org.gnome.shell.extensions.aatws.json` native-host manifests from the directories
above, and remove the `aatws-browser-tabs` data directory.

## Updating an existing installation

Update the Shell extension and companion together:

```sh
# From the repository root
make install
python3 browser-extension/install.py
```

The installer preserves existing Chromium host registrations when no
`--chromium-id` is supplied. In `chrome://extensions`, reload AATWS Browser Tabs;
then log out and back in to load the updated Shell extension. The companion should
show version 1.0.2. Firefox users must also reload their companion.

The browser selects the tab and acknowledges that selection; AATWS then activates
the matching GNOME window with the original input timestamp. The browser no
longer requests focus itself, avoiding GNOME's background-application attention
banner. Browser windows are identified by their current active-tab title within
the browser family. If multiple windows have indistinguishable titles, AATWS
retries using the newly selected tab's title; if that is also ambiguous, it avoids
raising an arbitrary window.

Chrome/Chromium tab results display site favicons from the browser's own cache.
Firefox can supply inline PNG favicons; other Firefox icons and missing site icons
fall back to the running browser's app icon. Icons are kept in memory with size
limits, and identical site icons are sent only once in a snapshot. No external
favicon service or access to website contents is required.
