# The Unity session (M1)

**Time: about an hour. You need a Mac, a Unity ID and a VRChat account at New User trust or above.**

This is the one gate no machine here can pass for you. Everything else in Phase 0
has been checked on Linux: the container, accessors and skin by the Khronos
validator, the rig by two independent Blender importers, the FBX by a ufbx
reopen, and the pixels by a real PNG inflate. What none of those can tell us is
whether **Unity's importer and the VRChat SDK accept the result**. That is what
this session answers.

There are two files per avatar because they hedge each other:

| File | Route | The unknown it settles |
|---|---|---|
| `.vrm` | UniVRM builds the Humanoid from an explicit bone map, no Configure step | Does the VRChat SDK accept a UniVRM-built avatar? No public precedent either way. |
| `.fbx` | Drag in, set Humanoid, Apply. No extra package. | Is Unity's Autodesk-based importer happy with ufbx-write's output? Nobody has published a test. |

**One of them passing is enough to unblock the build.** If both pass, we ship both
and the user picks.

---

## Before you start

1. **Unity Hub**, then add **Unity 2022.3.22f1** through it. VRChat accepts no
   other version, and uploads from newer editors are rejected server-side.
2. **The VRChat SDK.** The Creator Companion GUI is Windows-only, so on macOS use
   either:
   - the **VPM command line tool** (`vpm check hub`, `vpm check unity`, then
     `vpm new MyAvatars Avatar`), or
   - **ALCOM**, the community cross-platform VCC client.
3. **UniVRM**, for the `.vrm` half. In the Unity project: Window → Package Manager
   → + → Add package from git URL, twice:
   ```
   https://github.com/vrm-c/UniVRM.git?path=/Assets/UniGLTF#v0.131.2
   https://github.com/vrm-c/UniVRM.git?path=/Assets/VRM10#v0.131.2
   ```
4. The corpus folder from this repo (`humanoid-cli corpus <dir>`, or whatever was
   attached for you).

---

## Part A — the VRM route

1. Drag the six `.vrm` files into `Assets/`.
2. Select `neutral.vrm`. UniVRM imports it as a prefab. **You should not need to
   touch the Rig tab at all** — that is the whole point of this route.
3. Select the generated prefab, look at its Animator component, and check the
   **Avatar** field is populated. Click it: the Configure view should show a fully
   mapped humanoid with no red bones.
4. Drag the prefab into the scene. Add Component → **VRC Avatar Descriptor**.
5. Set **View Position** to roughly between the eyes (about `0, 1.60, 0.08` on the
   neutral avatar; the scene view shows a small sphere).
6. Leave **Lip Sync** on `Default` and **Eye Look** disabled. The mannequin has no
   blendshapes, and selecting `Viseme Blend Shape` with none present gives silently
   broken lip sync rather than an error.
7. Open the VRChat SDK panel (VRChat SDK → Show Control Panel), sign in, and look
   at the **Builder** tab.

**Copy back:** the full contents of the Builder tab (every row, including the
green ones) and anything in the Console. That text is the deliverable.

8. If the panel shows no blocking errors, press **Build & Test**. VRChat should
   launch and put you in a room wearing the avatar.

---

## Part B — the FBX route

1. Drag the six `.fbx` files into `Assets/` (a different folder is tidier).
2. Select `neutral.fbx` → Inspector → **Rig** tab.
3. Animation Type → **Humanoid**, Avatar Definition → **Create From This Model**,
   then **Apply**.
4. Press **Configure…**. Expect every required bone mapped and no red.
5. Repeat steps 4–7 from Part A (descriptor, view position, SDK panel).

---

## What I need back

Paste these, even when everything is green:

1. The SDK Builder panel text, for both routes.
2. Any Console warnings or errors, verbatim. Yellow ones matter as much as red.
3. For each of the six, whether Configure showed a clean humanoid.
4. A screenshot of the avatar in the scene view, or in VRChat if you got that far.

**And one specific thing to look at:** which way is the avatar facing, and is it
mirrored? Stand the camera at the default position and tell me whether it faces
you or away, and whether the hand that reads as its left is on your right. Both
files are written right-handed, Y-up, facing +Z, and Unity is left-handed. I have
deliberately not guessed the conversion — it is a one-line change once you tell
me what you see, and guessing it would be worse than asking.

---

## Things I already expect, so don't be alarmed

- **"This avatar is not imported as a humanoid rig"** on the FBX before you set the
  Rig tab. That is step 3, not a failure.
- The mannequin is a **placeholder**: swept tubes, no face, mitten hands. It is
  built to exercise the pipeline, not to look like anything. The real body
  (retopologised from the MakeHuman CC0 base) is Phase 1.
- **Finger bones exist but carry no geometry.** That is intentional; Unity maps
  fingers even when unweighted because both hand passes treat dummy bones as
  real.
- Texture is a flat colour fill at 512 px in the corpus. The app ships 1024 with a
  2048 option.

## Things that WOULD be real problems

Tell me immediately if you see any of these, and stop:

- **"Character not in T-Pose."** The rig gate here checks Unity's own tolerances
  (5° on arms, 15–20° on legs, 30° on the spine chain), so this firing means my
  transcription of those rules is wrong, which matters far beyond this file.
- **"Required human bone 'X' not found."** Same: the gate checks all 19.
- **"Spine hierarchy missing elements"** or anything about Chest/Neck/Shoulders.
- **The avatar imports at 100× or 1/100 scale.** That would mean the
  UnitScaleFactor choice is wrong. It is one number in one place.
- **A limb that folds inside out or pinches to a point when posed.** Try bending an
  elbow in the Configure preview.

## If it fails

Send the errors and stop; do not try to fix it in Unity. A file that needs
hand-fixing on the Mac is a file the app would ship broken. The whole design is
that this session either confirms the Linux gate or tells me exactly which rule I
transcribed wrongly, and the second outcome is nearly as useful as the first.

Every verdict, pass or fail, gets recorded in `tools/unity-verdicts.json` so the
gate can be tested against reality from then on.
