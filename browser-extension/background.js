/* global browser, chrome */
'use strict';

const api = typeof browser === 'undefined' ? chrome : browser;
let port;
let retry;
let revision = 0;
let timer;
const faviconCache = new Map();

async function favicon(tab) {
    if (!tab.favIconUrl)
        return null;
    if (tab.favIconUrl.startsWith('data:image/png;base64,'))
        return tab.favIconUrl.length <= 16384 ? tab.favIconUrl : null;
    // Firefox has no equivalent cache endpoint; use the browser icon instead
    // of requesting permission to fetch arbitrary website resources.
    if (api.runtime.getBrowserInfo || !/^https?:/.test(tab.url || ''))
        return null;
    const key = `${tab.url}\n${tab.favIconUrl}`;
    if (faviconCache.has(key))
        return faviconCache.get(key);
    const pending = (async () => {
        try {
            const url = new URL(api.runtime.getURL('/_favicon/'));
            url.searchParams.set('pageUrl', tab.url);
            url.searchParams.set('size', '64');
            const response = await fetch(url.href, { signal: AbortSignal.timeout(1500) });
            if (!response.ok)
                return null;
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.length > 12000)
                return null;
            return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
        } catch {
            return null;
        }
    })();
    faviconCache.set(key, pending);
    if (faviconCache.size > 256)
        faviconCache.delete(faviconCache.keys().next().value);
    const result = await pending;
    if (!result)
        faviconCache.delete(key); // Retry if the browser hasn't cached it yet.
    return result;
}

async function publish() {
    const current = ++revision;
    try {
        const tabs = (await api.tabs.query({})).filter(tab => !tab.incognito);
        if (!port || current !== revision)
            return;
        const activeTitles = new Map(tabs.filter(tab => tab.active)
            .map(tab => [tab.windowId, tab.title]));
        // Deduplicate site icons and keep the snapshot below native messaging's
        // message limit. Missing/over-budget icons use the browser's app icon.
        const candidates = [...new Map(tabs.filter(tab => tab.favIconUrl)
            .map(tab => [tab.favIconUrl, tab])).values()].slice(0, 256);
        const images = await Promise.all(candidates.map(favicon));
        if (!port || current !== revision)
            return;
        const icons = {};
        const iconKeys = new Map();
        let budget = 256 * 1024;
        for (let index = 0; index < candidates.length; index++) {
            const image = images[index];
            if (!image || image.length > budget)
                continue;
            const key = String(index);
            icons[key] = image;
            iconKeys.set(candidates[index].favIconUrl, key);
            budget -= image.length;
        }
        port.postMessage({
            browser: api.runtime.getBrowserInfo ? 'Firefox' : 'Chromium',
            icons,
            tabs: tabs.map(tab => ({
                id: tab.id, title: tab.title, url: tab.url,
                iconKey: iconKeys.get(tab.favIconUrl),
                windowId: tab.windowId, windowTitle: activeTitles.get(tab.windowId),
                lastAccessed: tab.lastAccessed || 0,
            })),
        });
    } catch (error) {
        console.debug('AATWS tab snapshot:', error);
    }
}

function schedulePublish() {
    // Coalesce bursts when sessions are restored or many tabs are closed.
    clearTimeout(timer);
    timer = setTimeout(publish, 100);
}

function connect() {
    clearTimeout(retry);
    port = api.runtime.connectNative('org.gnome.shell.extensions.aatws');
    port.onDisconnect.addListener(() => {
        // Read lastError to suppress Chromium's unchecked-error warning.
        const error = api.runtime.lastError;
        if (error)
            console.debug('AATWS bridge:', error.message);
        port = null;
        retry = setTimeout(connect, 5000);
    });
    port.onMessage.addListener(async message => {
        if (message.action !== 'activate' || !Number.isInteger(message.id))
            return;
        try {
            const tab = await api.tabs.get(message.id);
            if (tab.incognito)
                return;
            const selected = await api.tabs.update(tab.id, { active: true });
            // Shell owns window focus. A browser-side focused:true request lacks
            // the user's activation timestamp and can produce an attention banner.
            port?.postMessage({
                action: 'activated', request: message.request, id: tab.id,
                windowId: selected.windowId, title: selected.title || tab.title,
            });
        } catch (error) {
            console.debug('AATWS tab activation:', error);
            schedulePublish();
        }
    });
    schedulePublish();
}

for (const event of [api.tabs.onCreated, api.tabs.onUpdated, api.tabs.onRemoved,
    api.tabs.onActivated, api.tabs.onAttached, api.tabs.onDetached])
    event.addListener(schedulePublish);
connect();
