import importlib.util
import io
from pathlib import Path
import struct
import unittest

spec = importlib.util.spec_from_file_location('host', Path(__file__).resolve().parents[1] / 'browser-extension/native-host.py')
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class FramingTest(unittest.TestCase):
    def test_roundtrip(self):
        stream = io.BytesIO()
        message = {'tabs': [{'title': 'Résumé 🐈', 'id': 1}]}
        host.write_message(stream, message)
        stream.seek(0)
        self.assertEqual(host.read_message(stream), message)
        self.assertIsNone(host.read_message(stream))

    def test_bad_frames(self):
        for payload in [b'x', struct.pack('=I', 0), struct.pack('=I', 1024 * 1024 + 1),
                        struct.pack('=I', 10) + b'{}', struct.pack('=I', 1) + b'x']:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                host.read_message(io.BytesIO(payload))


if __name__ == '__main__':
    unittest.main()
