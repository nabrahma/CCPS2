using UnityEngine;

namespace PS2CC
{
    /// <summary>
    /// Added to every imported PS2CC character prefab: budgets and the settings the
    /// character was made with (read from the .ps2cc.json sidecar at import).
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PS2CharacterInfo : MonoBehaviour
    {
        [Tooltip("PS2CC version that wrote the export.")]
        public string appVersion;
        public int triangles;
        public int triangleBudget;
        public int hardMax;
        public bool exportedInTPose;
        public string bodyMesh;
        public string skin;
        public string hair;
        public string[] garments;
        public string[] blendshapes;
        [TextArea(3, 12)]
        public string sidecarJson;
    }
}
