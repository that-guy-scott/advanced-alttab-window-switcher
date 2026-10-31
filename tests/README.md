# Browser tab checks

Run from the repository root (Node.js, GJS, D-Bus, Python 3 and PyGObject required):

```sh
node tests/browser-search.cjs
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 tests/native-host.py
GIO_USE_VFS=local dbus-run-session -- gjs -m tests/browser-tabs.js
make zip
git diff --check
```

The D-Bus suite runs on an isolated session bus. It tests sender separation,
private/invalid tabs, snapshot replacement, directed activation and disconnect
cleanup, focus acknowledgements, stale replies and moved tabs, and launches the actual Python native host to check the stdio/D-Bus path.
The Node suite checks search integration and the companion with mocked browser APIs,
including favicon cache access and private-tab exclusion. The D-Bus suite also
checks favicon transfer and rejects unsupported image types or excessive dimensions.

For manual verification in GNOME:

1. Install the built AATWS package and the companion as described in
   `browser-extension/README.md`. Open two browser windows with several tabs.
2. Search a background tab by title or URL; select it using Enter and then by mouse.
   Confirm that the existing tab activates and its window receives focus.
3. Type `tabs`, cycle results, and narrow with `tabs words`. Check both app and
   window switcher modes, reverse ordering, captions and F-key selection.
4. On a tab result, try close, move, maximize, preview and app-menu shortcuts;
   confirm they do not act on the browser window or produce Shell errors.
5. Rename, close and move tabs between browser windows, then reopen AATWS to check
   refreshed results. Confirm private tabs never appear.
6. Run a second browser/profile, close one, and confirm only its results disappear.
   Disable/re-enable AATWS and allow five seconds for snapshots to recover.
7. With the companion disabled, verify ordinary window/app switching and search.
