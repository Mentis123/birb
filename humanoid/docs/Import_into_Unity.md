# The Unity session (M1)

**Time: about an hour. You need the Windows box, a Unity ID and a VRChat account
at New User trust or above.**

> **This is the Windows session.** The Mac has nothing to do with it — no Unity
> install there, and the corpus never touches it. The Mac's job is the separate
> iPad session (M2: Xcode, build to device, run the export check). Doing Unity on
> Windows is the easier half of that split: VRChat officially supports Windows
> only, so you get the Creator Companion GUI instead of the VPM command line, and
> **Build & Test actually launches VRChat**, which was not possible on macOS.

This is the one gate no machine here can pass for you. Everything else has been
checked on Linux: the container, accessors and skin by the Khronos validator, the
rig by two independent Blender importers, the FBX by a ufbx reopen, the pixels by
a real PNG inflate, and the body itself by an oracle that re-derives it from its
own bytes. What none of those can tell us is whether **Unity's importer and the
VRChat SDK accept the result**. That is what this session answers.

There are two files per avatar because they hedge each other:

| File | Route | The unknown it settles |
|---|---|---|
| `.vrm` | UniVRM builds the Humanoid from an explicit bone map, no Configure step | Does the VRChat SDK accept a UniVRM-built avatar? No public precedent either way. |
| `.fbx` | Drag in, set Humanoid, Apply. No extra package. | Is Unity's Autodesk-based importer happy with ufbx-write's output? Nobody has published a test. |

**One of them passing is enough to unblock the build.** If both pass, we ship both
and the user picks.

---

## Before you start

1. **Creator Companion.** Download from <https://vrchat.com/download/vcc> and run
   the installer (it wants admin rights, and lands in
   `%LOCALAPPDATA%\Programs`).
2. **Let VCC install Unity.** It checks for Unity on launch and offers a button
   that installs Unity Hub and the correct editor for you. Take it. The version
   is **2022.3.22f1** and it is not negotiable — uploading from any other editor
   can leave content that simply will not load. Activate your Unity licence when
   Hub asks.
3. **No extra Unity modules.** On Windows the base editor already builds
   Windows standalone, which is what a PC avatar upload targets. You only need
   **Android Build Support** if you later want a Quest version, and Hub can add
   it afterwards (gear icon next to the version → Add Modules). Skip iOS, tvOS,
   WebGL, Linux and the rest.
4. **Make the project.** In VCC press **New**, choose the **Avatar** template,
   name it, and open it. That gives you Avatar 3.0 and the SDK already wired in.
5. **UniVRM**, for the `.vrm` half. In the Unity project: Window → Package Manager
   → + → Add package from git URL, twice:
   ```
   https://github.com/vrm-c/UniVRM.git?path=/Assets/UniGLTF#v0.131.2
   https://github.com/vrm-c/UniVRM.git?path=/Assets/VRM10#v0.131.2
   ```
6. **The corpus.** Copy it onto the Windows box — whatever was attached for you,
   or `humanoid/.build/corpus` after running `./tools/verify.sh`. Six `.vrm`, six
   `.fbx`, `corpus.json`, and two reference renders. (Use `verify.sh` rather than
   `humanoid-cli corpus` on its own: the CLI writes the models, and the renders
   come from the last verification stage.)

---

## Part A — the VRM route

1. Drag the six `.vrm` files into `Assets/`.
2. Select `neutral.vrm`. UniVRM imports it as a prefab. **You should not need to
   touch the Rig tab at all** — that is the whole point of this route.
3. Select the generated prefab, look at its Animator component, and check the
   **Avatar** field is populated. Click it: the Configure view should show a fully
   mapped humanoid with no red bones.
4. Drag the prefab into the scene. Add Component → **VRC Avatar Descriptor**.
5. Set **View Position** to roughly between the eyes. On the neutral body that is
   about `0, 1.55, 0.09`: the crown sits at 1.665 m and the nose tip at
   `0, 1.508, 0.168`, so the sphere the scene view draws should land just behind
   the bridge of the nose. Nudge it rather than trusting the number.
6. Leave **Lip Sync** on `Default` and **Eye Look** disabled. The body has no
   blendshapes, and selecting `Viseme Blend Shape` with none present gives silently
   broken lip sync rather than an error.
7. Open the VRChat SDK panel (VRChat SDK → Show Control Panel), sign in on the
   **Authentication** tab, and look at the **Builder** tab.

**Copy back:** the full contents of the Builder tab (every row, including the
green ones) and anything in the Console. That text is the deliverable.

8. If the panel shows no blocking errors, press **Build & Test**. VRChat should
   launch on this machine and put you in a room wearing the avatar. This is the
   step the Mac could never have done, so it is worth reaching.

---

## Part B — the FBX route

1. Drag the six `.fbx` files into `Assets/` (a different folder is tidier).
2. Select `neutral.fbx` → Inspector → **Rig** tab.
3. Animation Type → **Humanoid**, Avatar Definition → **Create From This Model**,
   then **Apply**.
4. Press **Configure…**. Expect every required bone mapped and no red.
5. Repeat steps 4–8 from Part A (descriptor, view position, SDK panel, Build &
   Test).

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

There are two renders in the corpus folder, `neutral_front.png` and
`neutral_threequarter.png`, made by Blender's own glTF importer reading the
exported file. Compare what Unity shows against those. If they disagree, the
disagreement is the finding.

---

## Things I already expect, so don't be alarmed

- **"This avatar is not imported as a humanoid rig"** on the FBX before you set the
  Rig tab. That is step 3, not a failure.
- **The corpus carries the real body**, not the old placeholder mannequin: 7,500
  triangles, 4,078 vertices, 51 bones, retopologised from MakeHuman's CC0 base
  mesh and posed into a T. Every case is that one body with its joints moved,
  which is exactly what the editor does. It has a face and separated fingers,
  and it is untextured beyond a flat skin fill.
- **Finger bones exist but carry no geometry.** That is intentional; Unity maps
  fingers even when unweighted because both hand passes treat dummy bones as
  real.
- Texture is a flat colour fill at 512 px in the corpus. The app ships 1024 with a
  2048 option.
- **Three of the twelve files are missing on purpose.** The corpus also contains
  three cases the Linux gate rejected (`neg-a-pose`, `neg-collapsed-neck`,
  `neg-doll-scale`) and those are deliberately never exported. If you see only
  six of each, that is correct.

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
hand-fixing on Windows is a file the app would ship broken. The whole design is
that this session either confirms the Linux gate or tells me exactly which rule I
transcribed wrongly, and the second outcome is nearly as useful as the first.

Every verdict, pass or fail, gets recorded in `tools/unity-verdicts.json` so the
gate can be tested against reality from then on.
