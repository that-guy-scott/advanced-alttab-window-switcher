import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Only small PNGs are accepted; Shell never fetches URLs supplied by a site.
export function decodeFavicon(data) {
    if (typeof data !== 'string' || data.length > 16384 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data))
        return null;
    const bytes = GLib.base64_decode(data.slice(data.indexOf(',') + 1));
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || !signature.every((byte, index) => bytes[index] === byte))
        return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452)
        return null;
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (!width || !height || width > 256 || height > 256)
        return null;
    return new Gio.BytesIcon({ bytes: new GLib.Bytes(bytes) });
}
