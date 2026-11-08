using System.Collections.Generic;
using UnityEngine;

namespace PS2CC
{
    /// <summary>
    /// Drives a PS2CC character's expression blendshapes by name (blink_L, jawOpen, AA, ...)
    /// on every renderer that has them: the head, and the brows, lashes, teeth and hair,
    /// which get the same shapes. Weights are 0..1 (Unity's blendshape weights are 0..100).
    /// Added to the prefab by the importer when the export has blendshapes.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PS2Expressions : MonoBehaviour
    {
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
                int i = m.GetBlendShapeIndex(blendshape);
                if (i < 0) continue;
                r.SetBlendShapeWeight(i, w);
                n++;
            }
            return n;
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
