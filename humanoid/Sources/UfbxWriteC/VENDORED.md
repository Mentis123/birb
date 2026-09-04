# ufbx-write (vendored)

Source: https://github.com/ufbx/ufbx-write
Pinned commit: 2b65caa (2026-06-07), header version 0.2.0
Licence: MIT OR Unlicense (see LICENSE)

Pinned rather than tracked because the project self-describes as
"still a work-in-progress, and issues/breaking changes are to be expected",
has no tagged releases, and its own skin unit test asserts geometry only —
no weights, cluster transforms or bind poses. Re-run the full corpus on
every bump.

Known issue that affects us: upstream #30 (open) — `ufbxw_prepare_scene()`
never generates a skeleton root, so the caller must build the bone hierarchy
itself. Typing a skinned bone as `UFBXW_BONE_ROOT` makes both Blender
importers drop it entirely; every bone we emit is `UFBXW_BONE_LIMB_NODE`
with a plain node as the armature parent.
