#!/usr/bin/python3
"""AATWS native messaging host. No files, ports or browser debugging APIs."""
import json
import struct
import sys
import threading

from gi.repository import Gio, GLib

PATH = '/org/gnome/Shell/Extensions/AATWS/BrowserTabs'
IFACE = 'org.gnome.Shell.Extensions.AATWS.BrowserTabs'
MAX_MESSAGE = 1024 * 1024


def read_message(stream):
    header = stream.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise ValueError('Truncated native message header')
    length, = struct.unpack('=I', header)
    if not 0 < length <= MAX_MESSAGE:
        raise ValueError('Invalid native message length')
    payload = bytearray()
    while len(payload) < length:
        chunk = stream.read(length - len(payload))
        if not chunk:
            raise ValueError('Truncated native message')
        payload.extend(chunk)
    return json.loads(payload)


def write_message(stream, message):
    payload = json.dumps(message).encode('utf-8')
    stream.write(struct.pack('=I', len(payload)) + payload)
    stream.flush()


class Host:
    def __init__(self):
        self.loop = GLib.MainLoop()
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.snapshot = None
        self.pending = False
        self.bus.signal_subscribe('org.gnome.Shell', IFACE, 'ActivateTab', PATH,
                                  None, Gio.DBusSignalFlags.NONE, self.activate)
        # Republish after Shell restarts or the extension is re-enabled.
        GLib.timeout_add_seconds(5, self.publish)

    def activate(self, _bus, _sender, _path, _interface, _signal, parameters):
        tab_id, request = parameters.unpack()
        try:
            write_message(sys.stdout.buffer, {'action': 'activate', 'id': tab_id,
                                              'request': request})
        except (BrokenPipeError, OSError):
            self.loop.quit()

    def update(self, snapshot):
        if snapshot.get('action') == 'activated':
            self.bus.call('org.gnome.Shell', PATH, IFACE, 'TabActivated',
                          GLib.Variant('(s)', (json.dumps(snapshot),)), None,
                          Gio.DBusCallFlags.NONE, 3000, None, self.acknowledged)
            return GLib.SOURCE_REMOVE
        self.snapshot = json.dumps(snapshot, ensure_ascii=True)
        self.publish()
        return GLib.SOURCE_REMOVE

    def publish(self):
        if self.snapshot is not None and not self.pending:
            self.pending = True
            self.bus.call('org.gnome.Shell', PATH, IFACE, 'UpdateTabs',
                          GLib.Variant('(s)', (self.snapshot,)), None,
                          Gio.DBusCallFlags.NONE, 3000, None, self.published)
        return GLib.SOURCE_CONTINUE

    def published(self, bus, result):
        self.pending = False
        self.acknowledged(bus, result)

    def acknowledged(self, bus, result):
        try:
            bus.call_finish(result)
        except GLib.Error:
            pass  # Shell or extension is not running; retry on the next heartbeat.

    def read(self):
        try:
            while True:
                message = read_message(sys.stdin.buffer)
                if message is None:
                    break
                GLib.idle_add(self.update, message)
        except (ValueError, OSError) as error:
            print(f'AATWS bridge: {error}', file=sys.stderr)
        finally:
            GLib.idle_add(self.loop.quit)

    def run(self):
        threading.Thread(target=self.read, daemon=True).start()
        self.loop.run()
        self.bus.close_sync(None)


if __name__ == '__main__':
    Host().run()
