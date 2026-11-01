const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/windowSwitcherPopup.js', 'utf8')
    .replace(/^import .*;$/gm, '').replace(/^export /gm, '');
let destroyed = 0;
let created = 0;
const context = vm.createContext({
    global: { window_group: { add_child() {}, set_child_above_sibling() {} } },
    Util: { WindowPreview: class {
        constructor() { created++; }
        destroy() { destroyed++; }
    } },
});
vm.runInContext(`${source}\nglobalThis.Popup = WindowSwitcherPopup; globalThis.init = init;`, context);
context.init({ opt: {}, _: text => text });
const window = {};
const tab = { _isBrowserTab: true, getPreviewWindow: () => window };
const popup = Object.assign(Object.create(context.Popup), { _items: [tab], _selectedIndex: 0 });
assert.equal(popup._getSelectedTarget(), null, 'preview does not enable window actions on tabs');
popup._showPreview();
assert.equal(popup._winPreview.window, window, 'selected tab displays its live window preview');
assert.equal(popup._winPreview.caption, 'Containing browser window', 'tab preview explains the window contents');
popup._showPreview(true);
assert.equal(popup._winPreview, null, 'preview can be toggled off');
assert.equal(destroyed, 1);
popup._showPreview();
tab.getPreviewWindow = () => null;
popup._showPreview();
assert.equal(popup._winPreview, null, 'unavailable tab clears previous preview');
assert.equal(destroyed, 2);
tab.getPreviewWindow = undefined;
popup._showPreview();
assert.equal(created, 2, 'missing preview metadata stays harmless');
popup._items = [{ _isWindow: true, window }];
popup._showPreview();
assert.equal(popup._winPreview.window, window, 'ordinary window previews still work');
assert.equal(popup._winPreview.caption, '', 'window previews do not carry the tab caption');
popup._items = [{ _isApp: true, app: { get_windows() {}, cachedWindows: [window] } }];
popup._showPreview();
assert.equal(popup._winPreview.window, window, 'application previews still work');
popup._items[0].app.cachedWindows = [];
popup._showPreview();
assert.equal(popup._winPreview, null, 'apps without windows clear the preview');
console.log('Browser selected-result preview tests passed');
