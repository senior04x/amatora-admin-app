#!/usr/bin/env bash
set -euo pipefail
OUT="$PWD/artifacts/store-screenshots"
mkdir -p "$OUT"
export DEVELOPER_DIR=/Applications/Xcode_26.3.app/Contents/Developer
xcodebuild -version
git rev-parse HEAD > "$OUT/source-commit.txt"

# Use the release UI with a synthetic organization in this simulator build only.
# The Supabase host is replaced before bundling to keep the capture off production.
python3 - <<'PY'
from pathlib import Path
app = Path('App.tsx')
source = app.read_text()
source = source.replace('OrgProvider, useOrg', 'OrgContext, useOrg', 1)
start = source.index('function AppContent()')
end = source.index('export default function App()', start)
between = source[start:end]
# Keep any declarations after AppContent, if present.
body_end = between.rfind('\n}')
assert body_end >= 0
fixture = """
function AppContent() {
  const nothing = () => {};
  const resolved = async () => {};
  return (
    <OrgContext.Provider value={{
      orgId: null, currentOrg: { name: 'Amatora Demo', brand_colors: ['#00FF66', '#10B981'] },
      currentUser: { full_name: 'Demo Administrator' }, loading: false, userRole: 'org_admin',
      setUserRole: nothing, setCurrentUser: nothing, updateCurrentUserLocally: nothing,
      refreshCurrentUser: resolved, transferWindowOpen: false, setTransferWindowOpen: nothing,
      toggleTransferWindow: resolved, isRegistrationOpen: true, showToast: nothing,
    } as React.ContextType<typeof OrgContext>}>
      <MainAppContent onLogout={nothing} />
    </OrgContext.Provider>
  );
}
"""
source = source[:start] + fixture + source[start+body_end+2:]
app.write_text(source)
org = Path('src/context/OrgContext.tsx')
code = org.read_text()
assert 'const OrgContext = createContext' in code
org.write_text(code.replace('const OrgContext = createContext', 'export const OrgContext = createContext', 1))
client = Path('src/supabaseClient.ts')
code = client.read_text()
assert 'https://xzzyhfyazwohdqqbjiiy.supabase.co' in code
client.write_text(code.replace('https://xzzyhfyazwohdqqbjiiy.supabase.co', 'http://127.0.0.1:9', 1))
PY

xcrun simctl list runtimes -j > "$RUNNER_TEMP/runtimes.json"
xcrun simctl list devicetypes -j > "$RUNNER_TEMP/devices.json"
python3 - "$RUNNER_TEMP/runtimes.json" "$RUNNER_TEMP/devices.json" > "$RUNNER_TEMP/devices.tsv" <<'PY'
import json, sys
runtimes = [r for r in json.load(open(sys.argv[1]))['runtimes'] if r['isAvailable'] and r['version'] == '26.2' and '.iOS-' in r['identifier']]
runtime = max(runtimes, key=lambda r: tuple(map(int, r['version'].split('.'))))['identifier']
types = json.load(open(sys.argv[2]))['devicetypes']
for label, name in [('iphone', 'iPhone 16'), ('ipad', 'iPad Pro 13-inch (M4)')]:
    print(label, next(d['identifier'] for d in types if d['name'] == name), runtime, sep='\t')
PY
while IFS=$'\t' read -r label device runtime; do
  sim="$(xcrun simctl create "Admin-$label" "$device" "$runtime")"
  xcrun simctl boot "$sim"
  printf '%s\t%s\n' "$label" "$sim" >> "$RUNNER_TEMP/booted-devices.tsv"
done < "$RUNNER_TEMP/devices.tsv"

npx expo prebuild --platform ios --no-install
pod install --project-directory=ios > "$OUT/pods.log" 2>&1
workspace="$(find ios -maxdepth 1 -name '*.xcworkspace' -print -quit)"
xcodebuild -list -json -workspace "$workspace" > "$RUNNER_TEMP/schemes.json"
scheme="$(python3 - "$RUNNER_TEMP/schemes.json" <<'PY'
import json, sys
schemes = json.load(open(sys.argv[1]))['workspace']['schemes']
print(next(s for s in schemes if ''.join(c for c in s.lower() if c.isalnum()) == 'amatoraadmin'))
PY
)"
xcodebuild -workspace "$workspace" -scheme "$scheme" -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$RUNNER_TEMP/admin-derived" CODE_SIGNING_ALLOWED=NO ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  > "$OUT/native-build.log" 2>&1
app="$(find "$RUNNER_TEMP/admin-derived/Build/Products/Release-iphonesimulator" -maxdepth 1 -name '*.app' -print -quit)"
test -n "$app"
while IFS=$'\t' read -r label sim; do
  xcrun simctl bootstatus "$sim" -b
  xcrun simctl status_bar "$sim" override --time 9:41 --dataNetwork wifi --wifiBars 3 --batteryState charged --batteryLevel 100
  xcrun simctl install "$sim" "$app"
  xcrun simctl launch "$sim" com.amatora.admin
  sleep 12
  xcrun simctl io "$sim" screenshot "$OUT/$label.png"
  python3 - "$label" "$OUT/$label.png" <<'PY'
import struct, sys
with open(sys.argv[2], 'rb') as image:
    size = struct.unpack('>II', image.read(24)[16:24])
assert size == {'iphone': (1179,2556), 'ipad': (2064,2752)}[sys.argv[1]], size
PY
  xcrun simctl shutdown "$sim"
done < "$RUNNER_TEMP/booted-devices.tsv"
