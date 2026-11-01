const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Run the popup's actual release and timeout handlers without a GNOME session.
const source = fs.readFileSync('src/windowSwitcherPopup.js', 'utf8')
    .replace(/^import .*;$/gm, '').replace(/^export /gm, '');
const opt = { REQUIRE_ENTER: true, QUICK_SWITCH_TIMEOUT: 250, NO_MODS_TIMEOUT: 5000 };
let modifiers = 0;
let now = 1000;
let timerCallback;
let timerId = 0;
const removedTimers = [];
const context = vm.createContext({
    Date: { now: () => now },
    global: { get_pointer: () => [0, 0, modifiers] },
    Clutter: { EVENT_STOP: true },
    GLib: {
        timeout_add(priority, interval, callback) {
            timerCallback = callback;
            return ++timerId;
        },
        source_remove: id => removedTimers.push(id),
        SOURCE_REMOVE: false,
        SOURCE_CONTINUE: true,
    },
});
vm.runInContext(`${source}\nglobalThis.Popup = WindowSwitcherPopup; globalThis.init = init;`, context);
context.init({ opt, _: text => text });

function popup(keyboard = true) {
    const signals = {};
    const instance = Object.assign(Object.create(context.Popup), {
        _initTime: now,
        _keyboardTriggered: keyboard,
        _modifierMask: 8,
        _firstRun: true,
        _searchQuery: '',
        _selectedIndex: 0,
        _noModsTimeoutId: 0,
        _dashMode: !keyboard,
        _inputHandler: { isPointerOut: () => true },
        finished: 0,
        dismissed: 0,
        _finish() { this.finished++; },
        fadeAndDestroy() { this.dismissed++; },
        connect(name, handler) { signals[name] = handler; },
    });
    instance._connectKeyHandler();
    instance.release = () => signals['key-release-event']();
    return instance;
}

for (const mask of [8, 9, 64]) { // Alt, Shift+Alt, and a Super shortcut.
    const primary = mask === 64 ? 64 : 8;
    modifiers = mask;
    const quick = popup();
    assert.equal(quick._resetNoModsTimeoutOrFinish('', mask), false);
    quick._firstRun = false;
    now += 249;
    modifiers = primary; // Tab or Shift release while Alt/Super remains held.
    quick.release();
    assert.equal(quick.finished, 0, 'non-primary release does not activate');
    quick._resetNoModsTimeoutOrFinish(); // Repeated Tab/list rebuild while held.
    opt.cancelTimeout = true; // Search handler sets this even for Tab.
    modifiers = 0;
    quick.release();
    assert.equal(quick.finished, 1, 'quick release activates without Enter');
    assert.equal(quick._modifierMask, 0);
    opt.cancelTimeout = false;

    modifiers = 0;
    const beforeGrab = popup();
    now += 1000; // A slow build must not swallow an already-released shortcut.
    assert.equal(beforeGrab._resetNoModsTimeoutOrFinish('', mask), true);
    assert.equal(beforeGrab.finished, 1, 'release before grab activates immediately');

    for (const elapsed of [250, 500, 5000]) {
        modifiers = mask;
        const slow = popup();
        slow._resetNoModsTimeoutOrFinish('', mask);
        slow._firstRun = false;
        now += elapsed;
        modifiers = 0;
        slow.release();
        assert.equal(slow.finished, 0, 'release at or beyond the threshold stays open');
        assert.equal(slow._modifierMask, 0);
        slow._searchQuery = 'tabs';
        slow._resetNoModsTimeoutOrFinish();
        slow.release();
        assert.equal(slow.finished, 0, 'search updates cannot rearm quick switching');
        assert.equal(slow._noModsTimeoutId, 0, 'keyboard popup has no dismissal timer');
        slow._selectedIndex = -1;
        slow.release();
        assert.equal(slow.dismissed, 0, 'an empty search stays open for editing');
    }
}

// A rebuild can detect modifier release before the release signal arrives.
modifiers = 8;
const rebuilt = popup();
rebuilt._resetNoModsTimeoutOrFinish('', 8);
rebuilt._firstRun = false;
modifiers = 0;
assert.equal(rebuilt._resetNoModsTimeoutOrFinish(), true);
assert.equal(rebuilt.finished, 1);

for (const property of ['_searchQuery', '_secondarySearchToggle', '_overlayKeyTriggered']) {
    modifiers = 8;
    const search = popup();
    search._resetNoModsTimeoutOrFinish('', 8);
    search._firstRun = false;
    search[property] = property === '_searchQuery' ? 'tabs' : true;
    modifiers = 0;
    search.release();
    assert.equal(search.finished, 0, `${property} prevents quick activation`);
}

modifiers = 0;
const overlay = popup();
overlay._overlayKeyTriggered = true;
assert.equal(overlay._resetNoModsTimeoutOrFinish('', 64), false);
overlay.release();
assert.equal(overlay.finished, 0, 'Super overlay stays open even before the grab');

opt.QUICK_SWITCH_TIMEOUT = 0;
for (const mask of [8, 64]) {
    for (const held of [0, mask]) {
        modifiers = held;
        const explicit = popup();
        assert.equal(explicit._resetNoModsTimeoutOrFinish('', mask), false);
        explicit._firstRun = false;
        modifiers = 0;
        explicit.release();
        assert.equal(explicit.finished, 0, 'zero timeout always requires explicit activation');
    }
}
opt.QUICK_SWITCH_TIMEOUT = 250;

// Custom timing takes effect independently of the popup display delay.
opt.QUICK_SWITCH_TIMEOUT = 500;
modifiers = 8;
const custom = popup();
custom._resetNoModsTimeoutOrFinish('', 8);
custom._firstRun = false;
now += 400;
modifiers = 0;
custom.release();
assert.equal(custom.finished, 1);
opt.QUICK_SWITCH_TIMEOUT = 250;

const instance = popup();
instance._noModsTimeoutId = 99;
instance._resetNoModsTimeout();
assert.ok(removedTimers.includes(99), 'any existing keyboard timeout is removed');
assert.equal(instance._noModsTimeoutId, 0);

const mouse = popup(false);
mouse._resetNoModsTimeoutOrFinish('', 0);
assert.ok(mouse._noModsTimeoutId, 'mouse-triggered popup retains its timeout');
timerCallback();
assert.equal(mouse.dismissed, 1, 'mouse-triggered popup can still dismiss on timeout');

opt.REQUIRE_ENTER = false;
modifiers = 8;
const classic = popup();
classic._resetNoModsTimeoutOrFinish('', 8);
classic._firstRun = false;
now += 1000;
modifiers = 0;
classic.release();
assert.equal(classic.finished, 1, 'classic mode activates on release regardless of timing');
assert.equal(classic._resetNoModsTimeoutOrFinish('', 8), true);
assert.equal(classic.finished, 2, 'classic mode retains the early-release race check');

console.log('Switcher activation tests passed');
