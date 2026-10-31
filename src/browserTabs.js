import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { findBrowserWindow } from './browserWindow.js';
import { decodeFavicon } from './browserIcon.js';

export const PATH = '/org/gnome/Shell/Extensions/AATWS/BrowserTabs';
export const IFACE = 'org.gnome.Shell.Extensions.AATWS.BrowserTabs';
const XML = `<node><interface name="${IFACE}">
    <method name="UpdateTabs"><arg type="s" direction="in"/></method>
    <method name="TabActivated"><arg type="s" direction="in"/></method>
    <signal name="ActivateTab"><arg type="u"/><arg type="s"/></signal>
</interface></node>`;

// Each native host has its own unique bus sender, including separate profiles.
// Tab metadata is kept in memory and disappears when that host disconnects.
export class BrowserTabs {
    constructor({ getWindows = () => [], activateWindow = () => {}, getCurrentTime = () => 0 } = {}) {
        this._getWindows = getWindows;
        this._activateWindow = activateWindow;
        this._getCurrentTime = getCurrentTime;
        this._pending = null;
        this._focusTimeout = 0;
        this._clients = new Map();
        this._object = Gio.DBusExportedObject.wrapJSObject(XML, this);
        this._object.export(Gio.DBus.session, PATH);
        this._subscription = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_bus, _sender, _path, _iface, _signal, parameters) => {
                const [name, , owner] = parameters.deep_unpack();
                if (!owner) {
                    this._clients.delete(name);
                    if (this._pending?.sender === name)
                        this._clearPending();
                }
            });
    }

    UpdateTabsAsync([json], invocation) {
        try {
            if (json.length > 1024 * 1024)
                throw new Error('Tab snapshot too large');
            const data = JSON.parse(json);
            if (!Array.isArray(data.tabs) || data.tabs.length > 5000)
                throw new Error('Invalid tab snapshot');
            const sender = invocation.get_sender();
            const browser = String(data.browser || 'Browser').slice(0, 80);
            const icons = new Map();
            if (data.icons && typeof data.icons === 'object' && !Array.isArray(data.icons)) {
                for (const [key, value] of Object.entries(data.icons).slice(0, 256))
                    icons.set(key, decodeFavicon(value));
            }
            const tabs = data.tabs.filter(tab => Number.isInteger(tab.id) &&
                tab.id >= 0 && tab.id <= 0xffffffff && !tab.incognito).map(tab => ({
                _isBrowserTab: true,
                id: `${sender}:${tab.id}`,
                title: String(tab.title || tab.url || 'Browser tab').slice(0, 2000),
                url: String(tab.url || '').slice(0, 4000),
                browser,
                gicon: icons.get(tab.iconKey) || null,
                lastAccessed: Number(tab.lastAccessed) || 0,
                activate: () => this._activate(sender, browser, tab),
            }));
            this._clients.set(sender, tabs);
            invocation.return_value(null);
        } catch (error) {
            invocation.return_dbus_error(`${IFACE}.InvalidSnapshot`, error.message);
        }
    }

    _clearPending() {
        if (this._focusTimeout)
            GLib.source_remove(this._focusTimeout);
        this._focusTimeout = 0;
        this._pending = null;
    }

    _activate(sender, browser, tab) {
        this._clearPending();
        const request = GLib.uuid_string_random();
        this._pending = {
            sender, request, browser, id: tab.id, windowId: tab.windowId,
            window: findBrowserWindow(this._getWindows(), browser, tab.windowTitle),
            time: this._getCurrentTime(), expires: GLib.get_monotonic_time() + 2000000,
        };
        // Bound the request even when the tab closes or the browser never replies.
        this._focusTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._tryFocus();
            if (!this._pending) {
                this._focusTimeout = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        Gio.DBus.session.emit_signal(sender, PATH, IFACE,
            'ActivateTab', new GLib.Variant('(us)', [tab.id, request]));
    }

    TabActivatedAsync([json], invocation) {
        try {
            if (json.length > 16384)
                throw new Error('Activation reply too large');
            const reply = JSON.parse(json);
            const pending = this._pending;
            if (pending && pending.sender === invocation.get_sender() &&
                pending.request === reply.request && pending.id === reply.id) {
                // A tab may have moved to another window since the search snapshot.
                if (pending.windowId !== reply.windowId)
                    pending.window = null;
                pending.reply = reply;
            }
            invocation.return_value(null);
        } catch (error) {
            invocation.return_dbus_error(`${IFACE}.InvalidReply`, error.message);
        }
    }

    _tryFocus() {
        const pending = this._pending;
        if (!pending)
            return;
        if (GLib.get_monotonic_time() > pending.expires) {
            this._pending = null;
            return;
        }
        if (!pending.reply)
            return;
        const windows = this._getWindows();
        const window = windows.includes(pending.window) ? pending.window
            : findBrowserWindow(windows, pending.browser, pending.reply.title);
        // Title updates can arrive after the browser acknowledgement; retry briefly.
        if (window) {
            this._pending = null;
            this._activateWindow(window, pending.time);
        }
    }

    getTabs() {
        return [...this._clients.values()].flat()
            .sort((a, b) => b.lastAccessed - a.lastAccessed);
    }

    destroy() {
        this._clearPending();
        Gio.DBus.session.signal_unsubscribe(this._subscription);
        this._object.unexport();
        this._clients.clear();
    }
}
