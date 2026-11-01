# Switcher and browser tab checks

Run from the repository root (Node.js, GJS, D-Bus, Python 3 and PyGObject required):

```sh
node tests/switcher-activation.cjs
node tests/browser-search.cjs
node tests/browser-preview.cjs
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 tests/native-host.py
GIO_USE_VFS=local dbus-run-session -- gjs -m tests/browser-tabs.js
make zip
git diff --check
```

The activation suite checks quick modifier release (including release before the
keyboard grab), the timeout boundary, slow release followed by search updates,
explicit search, disabling quick switching, and Super overlay activation. It also
checks empty search results, mouse timeouts, and classic activation on release.

The D-Bus suite runs on an isolated session bus. It tests sender separation,
private/invalid tabs, snapshot replacement, directed activation and disconnect
cleanup, focus acknowledgements, stale replies and moved tabs, and launches the actual Python native host to check the stdio/D-Bus path.
The Node suite checks search integration and the companion with mocked browser APIs,
including favicon cache access and private-tab exclusion. The D-Bus suite also
checks favicon transfer and rejects unsupported image types or excessive dimensions.
The preview suite checks selected tab previews, preview toggling, missing metadata,
and existing window/app previews. D-Bus tests check that active and background tabs
resolve their containing browser window, while missing or ambiguous matches have
no preview.

For manual verification in GNOME:

1. With Require Enter enabled, tap Alt+Tab and release Alt within 250 ms: the
   selected window should activate without Enter. Try Alt+Shift+Tab and several
   quick Tab presses while holding Alt. Hold Alt longer than 250 ms, then release:
   the switcher should stay open for typing, Tab/Shift+Tab, Enter, and Esc.
   In preferences, move the Quick Switch Timeout slider below its 250 ms default
   mark and verify the quick-switch window shortens. Set it to 0 and verify even
   a quick tap stays open; restore 250 ms. Close and reopen preferences to confirm
   the value persists. Confirm the Super overlay key still opens search without
   activating.
2. Install the built AATWS package and the companion as described in
   `browser-extension/README.md`. Open two browser windows with several tabs.
3. Search a background tab by title or URL; select it using Enter and then by mouse.
   Confirm that the existing tab activates and its window receives focus.
4. Type `tabs`, cycle results, and narrow with `tabs words`. Check both app and
   window switcher modes, reverse ordering, captions and F-key selection.
5. Enable large selected-result previews (or toggle with Space outside search).
   Select the active tab of each browser window; confirm its live preview appears.
   Select a background tab; confirm its containing window appears, labeled
   **Containing browser window**, without switching tabs in the browser.
   With identical selected-tab titles in two windows of the same browser,
   confirm no arbitrary window is previewed.
   Try close, move, maximize and app-menu shortcuts on tab results; confirm they
   do not act on the browser window or produce Shell errors.
6. Rename, close and move tabs between browser windows, then reopen AATWS to check
   refreshed results. Confirm private tabs never appear.
7. Run a second browser/profile, close one, and confirm only its results disappear.
   Disable/re-enable AATWS and allow five seconds for snapshots to recover.
8. With the companion disabled, verify ordinary window/app switching and search.
