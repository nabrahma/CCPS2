using System.Collections.Generic;
using UnityEngine;

namespace PS2CC
{
    /// <summary>
    /// Drives a PS2CC character's expression blendshapes by name on every renderer that has
    /// them: the head, and the eyes, lashes, teeth, tongue, garments and hair, which get the
    /// same shapes. Weights are 0..1 (Unity's blendshape weights are 0..100).
    ///
    /// Characters export the 52 ARKit face units under their ARKit names (eyeBlinkLeft,
    /// jawOpen, mouthSmileLeft, ...), as ARKit face capture and lip-sync tools expect; names
    /// are matched without regard to case, so EyeBlinkLeft works too. Visemes (AA, EE, IH, OH,
    /// OU, FV, MBP) and the names exported before PS2CC 0.25.0 (blink_L, smile, ...) are
    /// separate shapes when they were chosen at export.
    /// Added to the prefab by the importer when the export has blendshapes.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PS2Expressions : MonoBehaviour
    {
        /// <summary>Apple ARKit's 52 blendshape locations, in ARKit's order.</summary>
        public static readonly string[] ARKit =
        {
            "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
            "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
            "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight",
            "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
            "eyeWideLeft", "eyeWideRight",
            "jawForward", "jawLeft", "jawOpen", "jawRight",
            "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight", "mouthFunnel",
            "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft", "mouthPressRight", "mouthPucker",
            "mouthRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper", "mouthSmileLeft",
            "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight",
            "noseSneerLeft", "noseSneerRight",
            "tongueOut",
        };

        SkinnedMeshRenderer[] renderers;

        void Awake() => Refresh();

        /// <summary>Find the renderers again (call after adding or removing meshes).</summary>
        public void Refresh() => renderers = GetComponentsInChildren<SkinnedMeshRenderer>(true);

        /// <summary>The blendshape names any renderer has.</summary>
        public IEnumerable<string> Names()
        {
            if (renderers == null) Refresh();
            var seen = new HashSet<string>();
            foreach (SkinnedMeshRenderer r in renderers)
            {
                Mesh m = r.sharedMesh;
                if (m == null) continue;
                for (int i = 0; i < m.blendShapeCount; i++)
                    if (seen.Add(m.GetBlendShapeName(i))) yield return m.GetBlendShapeName(i);
            }
        }

        /// <summary>Set a blendshape (0..1) on every renderer that has it. Returns how many renderers did.</summary>
        public int Set(string blendshape, float weight)
        {
            if (renderers == null) Refresh();
            int n = 0;
            float w = Mathf.Clamp01(weight) * 100f;
            foreach (SkinnedMeshRenderer r in renderers)
            {
                Mesh m = r.sharedMesh;
                if (m == null) continue;
                int i = IndexOf(m, blendshape);
                if (i < 0) continue;
                r.SetBlendShapeWeight(i, w);
                n++;
            }
            return n;
        }

        /// <summary>Set many blendshapes at once, e.g. a frame of ARKit face capture. Returns how many names any renderer had.</summary>
        public int SetMany(IReadOnlyDictionary<string, float> weights)
        {
            int found = 0;
            foreach (var kv in weights)
                if (Set(kv.Key, kv.Value) > 0) found++;
            return found;
        }

        /// <summary>The blendshape's index on a mesh: exact name first, then ignoring case. -1 when it has none.</summary>
        static int IndexOf(Mesh m, string name)
        {
            int i = m.GetBlendShapeIndex(name);
            if (i >= 0) return i;
            for (int k = 0; k < m.blendShapeCount; k++)
                if (string.Equals(m.GetBlendShapeName(k), name, System.StringComparison.OrdinalIgnoreCase)) return k;
            return -1;
        }

        /// <summary>Back to the neutral face.</summary>
        public void ResetAll()
        {
            if (renderers == null) Refresh();
            foreach (SkinnedMeshRenderer r in renderers)
            {
                Mesh m = r.sharedMesh;
                if (m == null) continue;
                for (int i = 0; i < m.blendShapeCount; i++) r.SetBlendShapeWeight(i, 0f);
            }
        }
    }
}
