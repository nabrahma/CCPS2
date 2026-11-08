# PS2CC Importer (`com.ps2cc.importer`)

Sets up PS2CC character exports in Unity 6 (URP) with no manual steps.

## Install

Package Manager → **+** → **Add package from disk…** → choose `unity/com.ps2cc.importer/package.json` in the PS2CC folder.
(Or add `"com.ps2cc.importer": "file:<path to>/unity/com.ps2cc.importer"` to `Packages/manifest.json`.)

## What happens on import

PS2CC writes `Assets/PS2CC/<Name>/` with `<Name>.fbx`, `<Name>.ps2cc.json`, `Textures/` and optionally `<Name>.glb`. For every FBX that has a matching `.ps2cc.json`:

- **Model:** Humanoid rig built from `Editor/humanoid_map.json` (MakeHuman GameEngine bone names → Unity Humanoid bones). The reference pose is the T-pose from the sidecar, so A-pose exports retarget correctly (the same as Unity's "Enforce T-Pose"). Blendshapes on, exported normals kept, scale 1, 4 bone weights.
- **Textures:** max size from the sidecar, bilinear, mipmaps, high-quality compression, alpha as transparency for hair, eyes, brows and lashes.
- **Materials** in `Materials/`, one per material group, using the PS2 shaders below.
- **Prefab** `<Name>.prefab` with an `Animator` (Humanoid avatar) and a `PS2CharacterInfo` component (budgets and the settings the character was made with).
- **Expressions:** the exported blendshapes (`blink_L`, `blink_R`, `jawOpen`, `smile`, `frown`, `browsUp`, `browsDown`, `squint` and the visemes `AA`, `EE`, `IH`, `OH`, `OU`, `FV`, `MBP`) are on the head and on every mesh they move: the eyes atlas (brows, lashes, teeth) and the hair. The prefab gets a `PS2Expressions` component to set one by name on all of them at once:

  ```csharp
  var face = GetComponent<PS2CC.PS2Expressions>();
  face.Set("blink_L", 1f);   // 0..1
  face.Set("jawOpen", 0.4f);
  face.ResetAll();
  ```

  For Timeline or Animator clips, animate `SkinnedMeshRenderer.blendShape.<name>` on each renderer (Unity weights are 0 to 100).

Re-exporting the same character updates the FBX, textures, materials and prefab in place.

## Shaders (URP)

| Shader | Use |
| --- | --- |
| `PS2/Skin` | Head and body. Vertex-lit Lambert from the main light, ambient (spherical harmonics), optional rim, optional colour-depth reduction (`Colour depth levels`, 32 = 15-bit). |
| `PS2/Cutout` | Hair cards, eyes, brows, lashes. The same lighting with an alpha clip, double-sided. |
| `PS2/Cloth` | Garments. The same with an alpha clip and a dirt mask slot. |
| `PS2/LookFullscreen` | Optional PS2 look: low internal resolution, 16-bit dither, grain, VHS bleed. Add URP's **Full Screen Pass Renderer Feature** to your renderer and give it a material with this shader. |

All respond to the URP main light and ambient light, have shadow caster, depth and depth-normals passes, and work in Forward and Forward+.

## Test harness

`tests/UnityHarness` imports the 10 PS2CC test characters in batchmode and checks avatars, materials, triangle budgets, blendshapes (present on every mesh they move, and that blink and jawOpen deform the face), scale, facing and retargeting, and renders the expressions (`pnpm test:unity` from the PS2CC folder). Drop Mixamo or other Humanoid animation clips into `tests/UnityHarness/Assets/Animations` to have them retargeted and rendered too.
