// Browser window IDs are not Meta.Window IDs. Match the active tab's title,
// restricted to the browser family, and refuse ambiguous matches.
export function findBrowserWindow(windows, browser, title) {
    if (!title)
        return null;
    const family = /firefox/i.test(browser)
        ? /firefox|librewolf|floorp|zen/i
        : /chrom(e|ium)|brave|vivaldi|edge|opera/i;
    const matches = windows.filter(window => {
        if (!family.test(window.get_wm_class() || ''))
            return false;
        const windowTitle = window.get_title() || '';
        return windowTitle === title || [' - ', ' — ', ' – '].some(separator =>
            windowTitle.startsWith(`${title}${separator}`));
    });
    return matches.length === 1 ? matches[0] : null;
}
