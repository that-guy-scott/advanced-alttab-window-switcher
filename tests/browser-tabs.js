import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { BrowserTabs, PATH, IFACE } from '../src/browserTabs.js';
import { findBrowserWindow } from '../src/browserWindow.js';
import { decodeFavicon } from '../src/browserIcon.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
function connect() {
    return Gio.DBusConnection.new_for_address_sync(GLib.getenv('DBUS_SESSION_BUS_ADDRESS'),
        Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, null, null);
}
const windows = [];
const focused = [];
const service = new BrowserTabs({
    getWindows: () => windows,
    activateWindow: (window, time) => focused.push({ window, time }),
    getCurrentTime: () => 123,
});
const client = connect();
const other = connect();
const destination = Gio.DBus.session.get_unique_name();
function update(connection, data, method = 'UpdateTabs') {
    return new Promise((resolve, reject) => connection.call(destination, PATH, IFACE,
        method, new GLib.Variant('(s)', [JSON.stringify(data)]), null,
        Gio.DBusCallFlags.NONE, 2000, null, (bus, result) => {
            try {
                resolve(bus.call_finish(result));
            } catch (error) {
                reject(error);
            }
        }));
}
const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
const favicon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==';
assert(decodeFavicon(favicon) instanceof Gio.BytesIcon, 'PNG favicon creates a GIcon');
for (const invalid of [null, '', 'https://example.org/favicon.png', 'file:///tmp/icon.png',
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,!!!!',
    'data:image/png;base64,' + 'A'.repeat(20000)])
    assert(decodeFavicon(invalid) === null, 'unsupported or oversized icons use fallback');
const huge = GLib.base64_decode(favicon.split(',')[1]);
new DataView(huge.buffer, huge.byteOffset, huge.byteLength).setUint32(16, 100000);
assert(decodeFavicon('data:image/png;base64,' + GLib.base64_encode(huge)) === null,
    'reject oversized decoded image dimensions');
try {
    await update(client, { browser: 'Firefox', icons: { site: favicon, invalid: 'https://example.org/favicon.png' }, tabs: [
        { id: 1, title: 'First', lastAccessed: 10, iconKey: 'site' },
        { id: 2, title: 'Private', incognito: true },
        { id: -1, title: 'Invalid' },
    ] });
    await update(other, { browser: 'Chrome', tabs: [{ id: 1, title: 'Second', lastAccessed: 20 }] });
    let tabs = service.getTabs();
    assert(tabs.length === 2, 'exclude private/invalid tabs');
    assert(tabs.find(tab => tab.title === 'First').gicon instanceof Gio.BytesIcon,
        'favicon travels with its tab through the D-Bus snapshot');
    assert(tabs.find(tab => tab.title === 'Second').gicon === null, 'missing icons use fallback');
    assert(tabs[0].title === 'Second', 'MRU ordering');
    assert(tabs[0].id !== tabs[1].id, 'profile IDs must not collide');
    let activated = null;
    let request = null;
    let leaked = false;
    client.signal_subscribe(destination, IFACE, 'ActivateTab', PATH, null,
        Gio.DBusSignalFlags.NONE, (_b, _s, _p, _i, _n, args) => { [activated, request] = args.deep_unpack(); });
    other.signal_subscribe(destination, IFACE, 'ActivateTab', PATH, null,
        Gio.DBusSignalFlags.NONE, () => { leaked = true; });
    tabs[1].activate();
    await wait(100);
    assert(activated === 1 && !leaked, 'activation is directed to the owning profile');
    // Resolve the containing window using its current active tab, before selecting
    // the background tab changes its title. Unrelated browsers must not match.
    const chrome = { get_title: () => 'ChatGPT - Google Chrome', get_wm_class: () => 'Google-chrome' };
    const firefox = { get_title: () => 'ChatGPT — Mozilla Firefox', get_wm_class: () => 'firefox' };
    windows.push(chrome, firefox);
    const otherChrome = { get_title: () => 'Other - Google Chrome', get_wm_class: () => 'Google-chrome' };
    windows.push(otherChrome);
    await update(client, { browser: 'Chromium', tabs: [
        { id: 10, title: 'ChatGPT', windowTitle: 'ChatGPT' },
        { id: 11, title: 'Amazon', windowTitle: 'ChatGPT' },
        { id: 12, title: 'ChatGPT' },
        { id: 13, title: 'Amazon', windowTitle: 'Other' },
        { id: 14, title: 'ChatGPT', windowTitle: 'Outdated title' },
    ] });
    const previewTabs = service.getTabs().filter(tab => tab.browser === 'Chromium');
    assert(previewTabs[0].getPreviewWindow() === chrome, 'active tab can preview its live browser window');
    assert(previewTabs[1].getPreviewWindow() === chrome, 'background tab previews its containing window');
    assert(previewTabs[2].getPreviewWindow() === null, 'missing window title has no preview');
    assert(previewTabs[3].getPreviewWindow() === otherChrome,
        'same tab title in a different window previews the correct containing window');
    assert(previewTabs[4].getPreviewWindow() === null, 'stale window titles have no preview');
    windows.pop();
    windows.push({ ...chrome });
    assert(previewTabs[0].getPreviewWindow() === null && previewTabs[1].getPreviewWindow() === null,
        'ambiguous browser windows have no live preview');
    windows.pop();
    windows.splice(0, 1);
    assert(previewTabs[1].getPreviewWindow() === null,
        'closed windows cannot be previewed, even with the same title in another browser');
    windows.unshift(chrome);
    await wait(50);
    assert(activated === 1 && focused.length === 0, 'previewing does not activate tabs or focus windows');
    assert(findBrowserWindow(windows, 'Chromium', 'ChatGPT') === chrome,
        'identical tab titles in different browsers stay separate');
    const duplicate = { ...chrome };
    assert(findBrowserWindow([...windows, duplicate], 'Chromium', 'ChatGPT') === null,
        'ambiguous same-browser titles do not focus an arbitrary window');
    await update(client, { browser: 'Chromium', tabs: [
        { id: 10, title: 'Amazon', windowId: 8, windowTitle: 'ChatGPT' },
    ] });
    assert(service.getTabs().find(tab => tab.title === 'Amazon').windowTitle === 'ChatGPT',
        'selected tab title survives the snapshot for search deduplication');
    service.getTabs().find(tab => tab.title === 'Amazon').activate();
    await wait(100);
    assert(focused.length === 0, 'wait until the browser confirms tab selection');
    const acknowledgement = { request, id: 10, windowId: 8, title: 'Amazon' };
    await update(other, acknowledgement, 'TabActivated');
    await wait(100);
    assert(focused.length === 0, 'another profile cannot acknowledge an activation');
    await update(client, { ...acknowledgement, request: 'stale' }, 'TabActivated');
    await wait(100);
    assert(focused.length === 0, 'ignore stale activation replies');
    await update(client, acknowledgement, 'TabActivated');
    await wait(100);
    assert(focused.length === 1 && focused[0].window === chrome && focused[0].time === 123,
        'Shell focuses the original Chrome window with the user timestamp');
    await update(client, acknowledgement, 'TabActivated');
    await wait(100);
    assert(focused.length === 1, 'activation acknowledgements cannot be replayed');
    // If a tab moves after the snapshot, discard the captured window and wait for
    // the new window's title to reflect the selected tab.
    let movedTitle = 'Other - Google Chrome';
    const movedWindow = { get_title: () => movedTitle, get_wm_class: () => 'Google-chrome' };
    windows.push(movedWindow);
    service.getTabs().find(tab => tab.title === 'Amazon').activate();
    await wait(100);
    await update(client, { request, id: 10, windowId: 9, title: 'Amazon' }, 'TabActivated');
    await wait(100);
    assert(focused.length === 1, 'do not focus the old window after a tab moves');
    movedTitle = 'Amazon - Google Chrome';
    await wait(100);
    assert(focused.length === 2 && focused[1].window === movedWindow,
        'a delayed title update resolves the new window');
    const beforeDisconnect = focused.length;
    service.getTabs().find(tab => tab.title === 'Amazon').activate();
    await wait(100);
    await update(client, { request, id: 10, windowId: 8, title: 'Amazon' }, 'TabActivated');
    // Closing this profile below must cancel the pending focus request.
    let rejected = false;
    try {
        await update(client, { tabs: 'invalid' });
    } catch {
        rejected = true;
    }
    assert(rejected && service.getTabs().length === 2, 'invalid update keeps last valid snapshot');
    await update(client, { tabs: [{ id: 3, title: 'Replacement' }] });
    assert(service.getTabs().some(tab => tab.title === 'Replacement'), 'snapshot replaces old tabs');
    client.close_sync(null);
    await wait(100);
    assert(service.getTabs().length === 1, 'disconnect clears profile tabs');
    assert(focused.length === beforeDisconnect, 'disconnect cancels pending window activation');
    // Exercise the real native host over browser-compatible stdio frames.
    const name = Gio.bus_own_name_on_connection(Gio.DBus.session, 'org.gnome.Shell',
        Gio.BusNameOwnerFlags.NONE, null, null);
    await wait(100);
    const host = Gio.Subprocess.new(['/usr/bin/python3', 'browser-extension/native-host.py'],
        Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
    try {
        const payload = new TextEncoder().encode(JSON.stringify({
            browser: 'Chromium', tabs: [{ id: 42, title: 'Host tab', windowId: 8, windowTitle: 'ChatGPT' }],
        }));
        const header = new Uint8Array(4);
        new DataView(header.buffer).setUint32(0, payload.length, true);
        host.get_stdin_pipe().write_all(header, null);
        host.get_stdin_pipe().write_all(payload, null);
        await wait(300);
        const tab = service.getTabs().find(item => item.title === 'Host tab');
        assert(tab, 'native host publishes snapshots to Shell');
        tab.activate();
        const bytes = await new Promise((resolve, reject) =>
            host.get_stdout_pipe().read_bytes_async(1024, GLib.PRIORITY_DEFAULT, null,
                (stream, result) => {
                    try { resolve(stream.read_bytes_finish(result).get_data()); }
                    catch (error) { reject(error); }
                }));
        const reply = JSON.parse(new TextDecoder().decode(bytes.slice(4)));
        assert(reply.action === 'activate' && reply.id === 42 && reply.request,
            'native host frames activation command and request token');
        const ack = new TextEncoder().encode(JSON.stringify({ action: 'activated',
            id: 42, request: reply.request, windowId: 8, title: 'Host tab' }));
        new DataView(header.buffer).setUint32(0, ack.length, true);
        host.get_stdin_pipe().write_all(header, null);
        host.get_stdin_pipe().write_all(ack, null);
        await wait(150);
        assert(focused.length === 3 && focused[2].window === chrome,
            'native host routes the selection acknowledgement back to Shell focus');
        assert(service.getTabs().some(tab => tab.title === 'Host tab'),
            'acknowledgement does not replace the tab snapshot');
    } finally {
        host.force_exit();
        Gio.bus_unown_name(name);
    }
    await wait(100);
    assert(service.getTabs().length === 1, 'host exit clears its tabs');
    print('Browser tab D-Bus and native-host tests passed');
} finally {
    service.destroy();
    other.close_sync(null);
}
