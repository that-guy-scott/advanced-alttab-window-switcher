const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise the real list provider with desktop dependencies replaced by fixtures.
const source = fs.readFileSync('src/listProvider.js', 'utf8')
    .replace(/^import .*;$/gm, '').replace('export class ListProvider', 'class ListProvider');
let windows = [];
const context = vm.createContext({ Enum: { FilterMode: { ALL: 1 } }, Util: { getWindows: () => windows } });
vm.runInContext(fs.readFileSync('src/browserWindow.js', 'utf8').replace('export function', 'function'), context);
vm.runInContext(`${source}\nglobalThis.Provider = ListProvider;`, context);
const tabs = [
    { title: 'Résumé', url: 'https://example.org', browser: 'Firefox' },
    { title: 'Work', url: 'https://code.example.com', browser: 'Chrome' },
];
const wsp = { _getBrowserTabs: () => tabs };
const provider = new context.Provider(wsp, { SEARCH_APPS: false });
provider._updateCoreParams = () => {
    provider._singleApp = wsp._singleApp;
    provider._showApps = wsp._showApps;
    provider._insufficientResultsLimit = 0;
    provider._filterSwitchAllowed = false;
};
provider.getCustomWindowList = () => [{ window: true }];
provider.getAppList = () => [{ app: true }];
assert.equal(provider.getItemList('').length, 1, 'tabs do not affect ordinary Alt-Tab');
assert.equal(provider.getItemList('resume').at(-1).title, 'Résumé', 'accent insensitive tab search');
assert.equal(provider.getItemList('code.example').at(-1).title, 'Work', 'URL search');
assert.equal(provider.getItemList('tabs').length, 2, 'tabs lists all browser tabs');
assert.equal(provider.getItemList('tabs firefox').length, 1, 'browser filter');
assert.equal(provider.getItemList('tabs work')[0].title, 'Work', 'tabs prefix filters');
wsp._singleApp = {};
assert.equal(provider.getItemList('tabs').length, 1, 'single app mode excludes tabs');
wsp._singleApp = null;
wsp._showApps = true;
assert.equal(provider.getItemList('work').at(-1).title, 'Work', 'app mode includes tabs');

const chrome = { get_title: () => 'Work - Google Chrome', get_wm_class: () => 'Google-chrome' };
const firefox = { get_title: () => 'Work — Mozilla Firefox', get_wm_class: () => 'firefox' };
const editor = { get_title: () => 'Work', get_wm_class: () => 'code' };
windows = [chrome, firefox, editor];
provider.getCustomWindowList = () => [...windows];
wsp._showApps = false;
tabs[1].windowTitle = 'Work';
let results = provider.getItemList('work');
assert.ok(!results.includes(chrome), 'selected tab replaces its browser window in search');
assert.ok(results.includes(tabs[1]), 'keep the tab result with its URL and favicon');
assert.ok(results.includes(firefox), 'same title in another browser is preserved');
assert.ok(results.includes(editor), 'same title in a non-browser app is preserved');
assert.equal(provider.getItemList('').length, 3, 'ordinary Alt-Tab keeps all browser windows');
tabs[1].windowTitle = 'Other tab';
assert.ok(provider.getItemList('work').includes(chrome), 'background tab does not replace the window');
delete tabs[1].windowTitle;
assert.ok(provider.getItemList('work').includes(chrome), 'missing snapshot metadata preserves windows');
tabs[1].windowTitle = 'Work';
const otherProfile = { ...chrome };
windows.push(otherProfile);
results = provider.getItemList('work');
assert.ok(results.includes(chrome) && results.includes(otherProfile), 'ambiguous profiles preserve both windows');
windows.pop();
wsp._singleApp = {};
assert.ok(provider.getItemList('work').includes(chrome), 'single-app mode keeps browser windows');
wsp._singleApp = null;
wsp._showApps = true;
const app = { app: true };
provider.getAppList = () => [app];
assert.ok(provider.getItemList('work').includes(app), 'application results remain available');
console.log('Browser tab search tests passed');

(async () => {
    const callbacks = {};
    const posted = [];
    const activated = [];
    const focused = [];
    const fetched = [];
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==', 'base64');
    const port = {
        postMessage: data => posted.push(data),
        onDisconnect: { addListener: fn => { callbacks.disconnect = fn; } },
        onMessage: { addListener: fn => { callbacks.message = fn; } },
    };
    const event = { addListener() {} };
    const api = {
        runtime: { connectNative: () => port, getURL: path => `chrome-extension://test${path}` },
        tabs: {
            query: async () => [
                { id: 1, title: 'Public', active: true, windowId: 8, url: 'https://example.org', favIconUrl: 'https://example.org/icon.png' },
                { id: 2, incognito: true, url: 'https://private.example', favIconUrl: 'https://private.example/icon.png' },
                { id: 3, title: 'Background', windowId: 8, url: 'https://background.example.org' },
                { id: 4, title: 'Other window', active: true, windowId: 9, url: 'https://other.example.org' },
            ],
            get: async id => ({ id, windowId: 8, title: 'Amazon' }),
            update: async id => { activated.push(id); return { id, windowId: 8, title: 'Amazon' }; },
            onCreated: event, onUpdated: event, onRemoved: event,
            onActivated: event, onAttached: event, onDetached: event,
        },
        windows: { update: async id => focused.push(id) },
    };
    const sandbox = vm.createContext({ chrome: api, console, clearTimeout, URL, AbortSignal,
        btoa: value => Buffer.from(value, 'binary').toString('base64'),
        fetch: async url => {
            fetched.push(url);
            return { ok: true, arrayBuffer: async () => image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) };
        },
        setTimeout: fn => { callbacks.timer = fn; } });
    vm.runInContext(fs.readFileSync('browser-extension/background.js', 'utf8'), sandbox);
    await callbacks.timer();
    assert.equal(posted[0].tabs.length, 3, 'companion never publishes private tabs');
    assert.equal(posted[0].tabs.find(tab => tab.id === 3).windowTitle, 'Public',
        'background tab carries its containing window title for previews');
    assert.equal(posted[0].tabs.find(tab => tab.id === 4).windowTitle, 'Other window',
        'tabs in another window carry that window title');
    assert.equal(fetched.length, 1, 'only public tab favicon is requested');
    assert.equal(new URL(fetched[0]).protocol, 'chrome-extension:', 'favicon comes from browser cache');
    assert.equal(Object.keys(posted[0].icons).length, 1);
    assert.ok(posted[0].icons[posted[0].tabs[0].iconKey].startsWith('data:image/png;base64,'));
    await callbacks.timer();
    assert.equal(fetched.length, 1, 'cached favicons are reused between snapshots');
    await callbacks.message({ action: 'activate', id: 1, request: 'request-1' });
    assert.deepEqual(activated, [1]);
    assert.deepEqual(focused, [], 'browser does not request background window focus');
    assert.equal(posted.at(-1).action, 'activated');
    assert.equal(posted.at(-1).request, 'request-1');
    assert.equal(posted.at(-1).windowId, 8);
    await callbacks.message({ action: 'activate', id: '1' });
    assert.equal(activated.length, 1, 'reject invalid activation command');
    console.log('Browser companion tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
