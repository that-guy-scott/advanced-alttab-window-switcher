#!/usr/bin/python3
"""Build companion directories and register the host for the current user."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium-id', help='ID shown by chrome://extensions (32 letters a-p)')
args = parser.parse_args()
if args.chromium_id and not re.fullmatch('[a-p]{32}', args.chromium_id):
    parser.error('--chromium-id must be the 32-letter extension ID')
source = Path(__file__).resolve().parent
home = Path.home()
root = Path(os.environ.get('XDG_DATA_HOME', home / '.local/share')) / 'aatws-browser-tabs'
root.mkdir(parents=True, exist_ok=True)
host = root / 'native-host.py'
shutil.copy2(source / 'native-host.py', host)
host.chmod(0o755)
for browser in ('firefox', 'chromium'):
    target = root / browser
    target.mkdir(exist_ok=True)
    shutil.copy2(source / browser / 'manifest.json', target / 'manifest.json')
    shutil.copy2(source / 'background.js', target / 'background.js')
manifest = dict(name='org.gnome.shell.extensions.aatws',
                description='AATWS browser tab bridge', path=str(host), type='stdio')
firefox = dict(manifest, allowed_extensions=['aatws-tabs@G-dH.github.com'])
locations = [(home / '.mozilla/native-messaging-hosts', firefox)]
if args.chromium_id:
    config = Path(os.environ.get('XDG_CONFIG_HOME', home / '.config'))
    chromium = dict(manifest, allowed_origins=[f'chrome-extension://{args.chromium_id}/'])
    for browser in ('chromium', 'google-chrome', 'BraveSoftware/Brave-Browser', 'microsoft-edge'):
        locations.append((config / browser / 'NativeMessagingHosts', chromium))
for directory, data in locations:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'org.gnome.shell.extensions.aatws.json').write_text(json.dumps(data, indent=2) + '\n')
print(f'Companions built in {root}')
print('Native host registered. Load the companion in your browser; see README.md.')
