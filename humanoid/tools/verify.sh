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
#
# Tool locations are overridable so this works both here and in CI.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/.build/corpus}"

SWIFT_BIN="${SWIFT_BIN:-swift}"
BLENDER_BIN="${BLENDER_BIN:-blender}"
GLTF_VALIDATOR_DIR="${GLTF_VALIDATOR_DIR:-}"
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
if [ -n "$GLTF_VALIDATOR_DIR" ] && [ -d "$GLTF_VALIDATOR_DIR/node_modules/gltf-validator" ]; then
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
    skip "glTF validator (set GLTF_VALIDATOR_DIR to a dir with 'npm i gltf-validator')"
fi

step "4. embedded PNG decodes"
# The validator parses image headers and never inflates the data, so a PNG built
# on raw deflate passes it and opens in nothing. This decodes for real.
if python3 "$ROOT/tools/check_glb_png.py" "$OUT"/*.vrm; then
    ok "PNG payloads inflate to the expected size"
else
    bad "PNG payload decode"
fi

step "5. Blender glTF import"
if command -v "$BLENDER_BIN" >/dev/null 2>&1; then
    for f in "$OUT"/*.vrm; do
        if "$BLENDER_BIN" --factory-startup --background \
             --python "$ROOT/tools/blender_check_vrm.py" -- "$f" 2>/dev/null | grep -q "GLTF_IMPORT"; then
            ok "$(basename "$f")"
        else
            bad "$(basename "$f") did not import cleanly"
        fi
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

printf '\n'
if [ "$failures" -eq 0 ]; then
    printf 'verify: PASS — corpus in %s is ready for the Unity session\n' "$OUT"
    printf 'Reminder: Unity and the VRChat SDK are the only remaining oracles, and\n'
    printf 'neither can run here. See humanoid/docs/Import_into_Unity.md.\n'
    exit 0
fi
printf 'verify: %d FAILURE(S)\n' "$failures"
exit 1
