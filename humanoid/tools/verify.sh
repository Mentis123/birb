#!/usr/bin/env bash
# Full Phase 0 verification chain. Everything here runs on Linux with no Apple
# toolchain and no Unity; it is what must be green before anything is handed to
# the Mac for the M1 session.
#
#   ./tools/verify.sh [output-dir]
#
# Stages:
#   1. swift test               unit + format tests
#   2. humanoid-cli corpus      generate positives, prove negatives are refused
#   3. Khronos glTF validator   container, accessors, skin (VRM/GLB)
#   4. PNG decode               the validator reads image headers only
#   5. Blender glTF import      independent reconstruction of the rig
#   6. Blender FBX import x2    legacy Python importer and the C++/ufbx one
#   7. template oracle          independent re-derivation of both templates
#   8. render                   a picture of the exported file, for human eyes
#
# Tool locations are overridable so this works both here and in CI.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/.build/corpus}"

SWIFT_BIN="${SWIFT_BIN:-swift}"
BLENDER_BIN="${BLENDER_BIN:-blender}"
GLTF_VALIDATOR_DIR="${GLTF_VALIDATOR_DIR:-}"
GLTF_VALIDATOR_BIN="${GLTF_VALIDATOR_BIN:-}"
export SWIFT_FORCE_MODULE_LOADING="${SWIFT_FORCE_MODULE_LOADING:-prefer-interface}"

failures=0
step() { printf '\n=== %s ===\n' "$1"; }
ok()   { printf '  ok   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; failures=$((failures + 1)); }
skip() { printf '  skip %s\n' "$1"; }

step "1. swift test"
# Use the exit code, not a grep: Swift Testing and XCTest print different
# summary lines and the last one is not the authoritative result.
test_log="$(mktemp)"
if "$SWIFT_BIN" test --package-path "$ROOT" >"$test_log" 2>&1; then
    ok "unit tests ($(grep -oE 'Executed [0-9]+ tests' "$test_log" | tail -1))"
else
    bad "unit tests"
    grep -E "error:|XCTAssert" "$test_log" | head -10
fi
rm -f "$test_log"

step "2. golden corpus"
rm -rf "$OUT"
if "$SWIFT_BIN" run --package-path "$ROOT" humanoid-cli corpus "$OUT" 2>&1 | grep -q "corpus ok"; then
    ok "corpus written to $OUT"
else
    bad "corpus generation"
fi

step "3. Khronos glTF validator"
# Two shapes of the same tool. GLTF_VALIDATOR_BIN is the official standalone
# binary from KhronosGroup/glTF-Validator releases and needs no node; the npm
# module is the fallback. Either is authoritative, so accept whichever is here.
validate_one() {
    local file="$1"
    # The validator dispatches on the extension and will not read a .vrm, so it
    # is handed a .glb copy. Same bytes: VRM 1.0 IS a GLB.
    local copy="$OUT/.validate.glb"
    cp "$file" "$copy"
    "$GLTF_VALIDATOR_BIN" -o -a "$copy" 2>/dev/null | python3 -c "
import json, sys
issues = json.load(sys.stdin)['issues']
print(issues['numErrors'], issues['numWarnings'])
for m in issues['messages']:
    if m['severity'] <= 1:
        print('   ' + m['code'] + ' @ ' + m.get('pointer', '') + ': ' + m['message'],
              file=sys.stderr)
"
    rm -f "$copy"
}

if [ -n "${GLTF_VALIDATOR_BIN:-}" ] && [ -x "${GLTF_VALIDATOR_BIN:-}" ]; then
    for f in "$OUT"/*.vrm "$OUT"/*.glb; do
        [ -e "$f" ] || continue
        report=$(validate_one "$f")
        errors=$(echo "$report" | awk '{print $1}')
        warnings=$(echo "$report" | awk '{print $2}')
        if [ "$errors" = "0" ] && [ "$warnings" = "0" ]; then
            ok "$(basename "$f") 0 errors 0 warnings"
        else
            bad "$(basename "$f") $errors errors $warnings warnings"
        fi
    done
elif [ -n "$GLTF_VALIDATOR_DIR" ] && [ -d "$GLTF_VALIDATOR_DIR/node_modules/gltf-validator" ]; then
    for f in "$OUT"/*.vrm; do
        report=$(cd "$GLTF_VALIDATOR_DIR" && node -e "
            const v=require('gltf-validator'), fs=require('fs');
            v.validateBytes(new Uint8Array(fs.readFileSync('$f'))).then(r=>{
              const i=r.issues;
              console.log(i.numErrors+' '+i.numWarnings);
              i.messages.filter(m=>m.severity<=1).forEach(m=>console.error('   '+m.code+' @ '+m.pointer+': '+m.message));
            }).catch(e=>{console.log('99 99'); console.error('   '+e);});
        ")
        errors=$(echo "$report" | awk '{print $1}')
        warnings=$(echo "$report" | awk '{print $2}')
        if [ "$errors" = "0" ] && [ "$warnings" = "0" ]; then
            ok "$(basename "$f") 0 errors 0 warnings"
        else
            bad "$(basename "$f") $errors errors $warnings warnings"
        fi
    done
else
    skip "glTF validator (set GLTF_VALIDATOR_BIN to the standalone binary, or GLTF_VALIDATOR_DIR to a dir with 'npm i gltf-validator')"
fi

step "4. embedded PNG decodes"
# The validator parses image headers and never inflates the data, so a PNG built
# on raw deflate passes it and opens in nothing. This decodes for real.
if python3 "$ROOT/tools/check_glb_png.py" "$OUT"/*.vrm "$OUT"/*.glb; then
    ok "PNG payloads inflate to the expected size"
else
    bad "PNG payload decode"
fi

step "5. Blender glTF import"
if command -v "$BLENDER_BIN" >/dev/null 2>&1; then
    for f in "$OUT"/*.vrm "$OUT"/*.glb; do
        [ -e "$f" ] || continue
        # The exit code, not a grep: the oracle prints its GLTF_IMPORT line
        # whatever it found, so grepping for it passed every file including the
        # ones it had just rejected.
        import_log="$(mktemp)"
        if "$BLENDER_BIN" --factory-startup --background \
             --python "$ROOT/tools/blender_check_vrm.py" -- "$f" >"$import_log" 2>/dev/null; then
            ok "$(basename "$f")"
        else
            bad "$(basename "$f") did not import cleanly"
            grep -E "GLTF_IMPORT|IMPORT_FAIL" "$import_log" | head -2
        fi
        rm -f "$import_log"
    done
else
    skip "Blender glTF import (set BLENDER_BIN)"
fi

step "6. Blender FBX import (both importers)"
if command -v "$BLENDER_BIN" >/dev/null 2>&1; then
    for f in "$OUT"/*.fbx; do
        if "$BLENDER_BIN" --factory-startup --background \
             --python "$ROOT/tools/blender_check_fbx.py" -- "$f" 2>/dev/null | grep -q '"ok": true'; then
            ok "$(basename "$f")"
        else
            bad "$(basename "$f") did not import cleanly in both importers"
        fi
    done
else
    skip "Blender FBX import (set BLENDER_BIN)"
fi

step "7. shipped body template"
# An oracle that shares no code with the baker. The baker's own T-pose report is
# tautological — it measures head-to-tail of the bones it just aimed — so this
# re-derives everything from the bytes and measures head to CHILD head, which is
# what Unity's mapper scores.
for template in clay-v1 body-v1; do
    if python3 "$ROOT/tools/check_template.py" \
         "$ROOT/Sources/HumanoidCore/Resources/$template.bin"; then
        ok "$template.bin"
    else
        bad "$template.bin failed its own oracle"
    fi
done

step "8. exported models render as models"
# Stages 3 to 6 prove the file is well formed and reconstructs into a correctly
# skinned mesh. None of them can tell a body from a bag of valid triangles, and
# the PNGs are the only artefact a person can check by eye.
if command -v "$BLENDER_BIN" >/dev/null 2>&1; then
    for pair in "neutral.vrm:neutral" "clay-neutral.glb:clay-neutral" "clay-sculpted.glb:clay-sculpted"; do
        file="${pair%%:*}"; prefix="${pair##*:}"
        if "$BLENDER_BIN" --factory-startup --background \
             --python "$ROOT/tools/blender_render_vrm.py" -- \
             "$OUT/$file" "$OUT/$prefix" 2>/dev/null | grep -q "RENDER_OK"; then
            ok "$prefix renders written"
        else
            bad "$file did not render"
        fi
    done
else
    skip "render (set BLENDER_BIN)"
fi

printf '\n'
if [ "$failures" -eq 0 ]; then
    printf 'verify: PASS — corpus in %s is ready for the Unity session\n' "$OUT"
    printf 'Reminder: Unity and the VRChat SDK are the only remaining oracles, and\n'
    printf 'neither can run here. See humanoid/docs/Import_into_Unity.md.\n'
    exit 0
fi
printf 'verify: %d FAILURE(S)\n' "$failures"
exit 1
