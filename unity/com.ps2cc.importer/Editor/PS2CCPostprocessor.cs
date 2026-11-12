using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace PS2CC.Editor
{
    /// <summary>
    /// Imports PS2CC exports (PRD 6.4). For an FBX with a matching .ps2cc.json:
    /// Humanoid avatar from humanoid_map.json with the sidecar's T-pose as the
    /// reference pose, blendshapes on, exported normals kept, scale 1. Textures
    /// get the sidecar's import settings. After import, PS2 materials and a
    /// prefab (Animator + PS2CharacterInfo) are created next to the FBX.
    /// </summary>
    public sealed class PS2CCPostprocessor : AssetPostprocessor
    {
        // Bump to reimport existing exports when the import rules change.
        public override uint GetVersion() => 4;

        void OnPreprocessModel()
        {
            Sidecar sidecar = Sidecar.ForModel(assetPath);
            if (sidecar == null) return;
            var mi = (ModelImporter)assetImporter;
            mi.globalScale = 1f;
            mi.useFileScale = true;
            mi.importBlendShapes = true;
            mi.importBlendShapeNormals = ModelImporterNormals.Import; // the exporter writes normal deltas per shape
            mi.importVisibility = false;
            mi.importCameras = false;
            mi.importLights = false;
            mi.importNormals = ModelImporterNormals.Import;
            mi.importTangents = ModelImporterTangents.None; // no normal maps (PRD: no PBR inputs)
            mi.weldVertices = false;
            mi.importAnimation = false;
            mi.materialImportMode = ModelImporterMaterialImportMode.None; // materials come from the sidecar
            mi.optimizeGameObjects = false;
            mi.skinWeights = ModelImporterSkinWeights.Standard; // 4 influences (PRD 6.2)
            mi.animationType = ModelImporterAnimationType.Human;
            mi.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
            mi.humanDescription = BuildHumanDescription(sidecar, Path.GetFileNameWithoutExtension(assetPath));
        }

        /// <summary>Human bone mapping plus the skeleton in its T-pose (Unity's "Enforce T-Pose").</summary>
        public static HumanDescription BuildHumanDescription(Sidecar sidecar, string rootName)
        {
            var human = new List<HumanBone>();
            var names = new HashSet<string>(sidecar.skeleton.Select(b => b.name));
            foreach (KeyValuePair<string, string> kv in HumanoidMap.Bones)
            {
                if (!names.Contains(kv.Value)) continue;
                var hb = new HumanBone { humanName = kv.Key, boneName = kv.Value };
                hb.limit.useDefaultValues = true;
                human.Add(hb);
            }
            var skeleton = new List<SkeletonBone>
            {
                new SkeletonBone { name = rootName, position = Vector3.zero, rotation = Quaternion.identity, scale = Vector3.one },
            };
            foreach (BoneInfo b in sidecar.skeleton)
            {
                Trs t = b.tPose != null && b.tPose.position != null && b.tPose.position.Length == 3 ? b.tPose : new Trs { position = b.position, rotation = b.rotation, scale = b.scale };
                skeleton.Add(new SkeletonBone { name = b.name, position = ToUnityPosition(t.position), rotation = ToUnityRotation(t.rotation), scale = Vector3.one });
            }
            return new HumanDescription
            {
                human = human.ToArray(),
                skeleton = skeleton.ToArray(),
                upperArmTwist = 0.5f,
                lowerArmTwist = 0.5f,
                upperLegTwist = 0.5f,
                lowerLegTwist = 0.5f,
                armStretch = 0.05f,
                legStretch = 0.05f,
                feetSpacing = 0f,
                hasTranslationDoF = false,
            };
        }

        /// <summary>FBX (right-handed) to Unity (left-handed): Unity's importer mirrors X.</summary>
        public static Vector3 ToUnityPosition(float[] p) => new Vector3(-p[0], p[1], p[2]);

        public static Quaternion ToUnityRotation(float[] q) => new Quaternion(q[0], -q[1], -q[2], q[3]);

        void OnPreprocessTexture()
        {
            Sidecar sidecar = Sidecar.ForTexture(assetPath);
            if (sidecar == null) return;
            MaterialInfo mat = sidecar.MaterialForTexture(assetPath);
            if (mat == null) return;
            var ti = (TextureImporter)assetImporter;
            ti.textureType = TextureImporterType.Default;
            ti.sRGBTexture = true;
            ti.alphaSource = TextureImporterAlphaSource.FromInput;
            ti.alphaIsTransparency = mat.alphaIsTransparency;
            ti.maxTextureSize = Mathf.ClosestPowerOfTwo(Mathf.Clamp(mat.maxSize, 32, 8192));
            ti.filterMode = FilterMode.Bilinear;
            ti.mipmapEnabled = true;
            ti.textureCompression = TextureImporterCompression.CompressedHQ;
            // Atlases and the head/body textures clamp; hair textures may tile.
            ti.wrapMode = mat.role == "hair" ? TextureWrapMode.Repeat : TextureWrapMode.Clamp;
        }

        static void OnPostprocessAllAssets(string[] imported, string[] deleted, string[] moved, string[] movedFrom)
        {
            foreach (string path in imported)
            {
                if (!path.EndsWith(".fbx", System.StringComparison.OrdinalIgnoreCase)) continue;
                Sidecar sidecar = Sidecar.ForModel(path);
                if (sidecar == null) continue;
                try
                {
                    BuildPrefab(path, sidecar);
                }
                catch (System.Exception e)
                {
                    Debug.LogError($"PS2CC: could not set up {path}: {e}");
                }
            }
        }

        /// <summary>Materials from the sidecar and the &lt;Name&gt;.prefab with an Animator.</summary>
        public static GameObject BuildPrefab(string fbxPath, Sidecar sidecar)
        {
            string dir = Path.GetDirectoryName(fbxPath).Replace('\\', '/');
            string matDir = dir + "/Materials";
            if (!AssetDatabase.IsValidFolder(matDir)) AssetDatabase.CreateFolder(dir, "Materials");
            var materials = new Dictionary<string, Material>();
            foreach (MaterialInfo info in sidecar.materials)
            {
                Shader shader = Shader.Find(info.shader);
                if (shader == null)
                {
                    Debug.LogError($"PS2CC: shader {info.shader} not found (is the URP package installed?)");
                    continue;
                }
                string matPath = $"{matDir}/{info.name}.mat";
                Material mat = AssetDatabase.LoadAssetAtPath<Material>(matPath);
                bool created = mat == null;
                if (created) mat = new Material(shader);
                mat.shader = shader;
                mat.name = info.name;
                var tex = AssetDatabase.LoadAssetAtPath<Texture2D>($"{dir}/{info.texture}");
                if (tex == null) Debug.LogError($"PS2CC: texture {dir}/{info.texture} is missing");
                mat.SetTexture("_BaseMap", tex);
                if (mat.HasProperty("_Cutoff")) mat.SetFloat("_Cutoff", info.alphaClip > 0 ? info.alphaClip : 0.5f);
                mat.SetFloat("_Cull", info.doubleSided ? 0f : 2f);
                mat.SetFloat("_TwoSided", info.doubleSided && !info.volumeNormals ? 1f : 0f);
                if (created) AssetDatabase.CreateAsset(mat, matPath);
                else EditorUtility.SetDirty(mat);
                materials[info.role] = mat;
            }

            var model = AssetDatabase.LoadAssetAtPath<GameObject>(fbxPath);
            Avatar avatar = AssetDatabase.LoadAllAssetsAtPath(fbxPath).OfType<Avatar>().FirstOrDefault();
            if (avatar == null || !avatar.isValid || !avatar.isHuman)
                Debug.LogError($"PS2CC: {fbxPath} has no valid Humanoid avatar. Missing bones: {string.Join(", ", MissingHumanBones(sidecar))}");
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(model);
            try
            {
                foreach (SkinnedMeshRenderer r in instance.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                {
                    MeshInfo info = sidecar.MeshNamed(r.name);
                    if (info != null && materials.TryGetValue(info.role, out Material m)) r.sharedMaterials = new[] { m };
                    else Debug.LogError($"PS2CC: no material for mesh {r.name}");
                }
                Animator animator = instance.GetComponent<Animator>();
                if (animator == null) animator = instance.AddComponent<Animator>();
                animator.avatar = avatar;
                animator.applyRootMotion = false;
                PS2CharacterInfo ci = instance.GetComponent<PS2CharacterInfo>();
                if (ci == null) ci = instance.AddComponent<PS2CharacterInfo>();
                ci.appVersion = sidecar.app;
                ci.triangles = sidecar.budget?.triangles ?? 0;
                ci.triangleBudget = sidecar.budget?.target ?? 0;
                ci.hardMax = sidecar.budget?.hardMax ?? 0;
                ci.exportedInTPose = sidecar.tPose;
                ci.bodyMesh = sidecar.source?.bodyMesh;
                ci.skin = sidecar.source?.skin;
                ci.hair = sidecar.source?.hair;
                ci.garments = sidecar.source?.garments;
                ci.blendshapes = sidecar.blendshapes;
                ci.sidecarJson = sidecar.json;
                if (sidecar.blendshapes != null && sidecar.blendshapes.Length > 0 && instance.GetComponent<PS2Expressions>() == null)
                    instance.AddComponent<PS2Expressions>();
                return PrefabUtility.SaveAsPrefabAsset(instance, $"{dir}/{sidecar.name}.prefab");
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }
        }

        public static IEnumerable<string> MissingHumanBones(Sidecar sidecar)
        {
            var names = new HashSet<string>(sidecar.skeleton.Select(b => b.name));
            foreach (KeyValuePair<string, string> kv in HumanoidMap.Bones)
                if (!names.Contains(kv.Value)) yield return $"{kv.Key} ({kv.Value})";
        }
    }
}
