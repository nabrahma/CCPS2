using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace PS2CC.Editor
{
    /// <summary>The &lt;Name&gt;.ps2cc.json sidecar written next to every PS2CC export.</summary>
    [Serializable]
    public sealed class Sidecar
    {
        public string format;
        public string name;
        public string app;
        public string rig;
        public bool tPose;
        public MeshInfo[] meshes;
        public MaterialInfo[] materials;
        public BoneInfo[] skeleton;
        public BudgetInfo budget;
        public string[] blendshapes;
        public SourceInfo source;
        /// <summary>Quality profile (Part 2 F13): per-vertex or per-pixel light, shadows. Null in exports before 0.13.</summary>
        public QualityInfo quality;

        [NonSerialized] public string json;
        [NonSerialized] public string path;

        public const string Format = "ps2cc.sidecar/1";
        public const string Suffix = ".ps2cc.json";

        /// <summary>The sidecar for an FBX (same folder, same name), or null when the FBX is not a PS2CC export.</summary>
        public static Sidecar ForModel(string modelPath)
        {
            string dir = Path.GetDirectoryName(modelPath);
            string stem = Path.GetFileNameWithoutExtension(modelPath);
            return Load(Path.Combine(dir ?? "", stem + Suffix));
        }

        /// <summary>The sidecar of the export a texture belongs to (&lt;Name&gt;/Textures/x.png), or null.</summary>
        public static Sidecar ForTexture(string texturePath)
        {
            string texDir = Path.GetDirectoryName(texturePath);
            if (texDir == null || Path.GetFileName(texDir) != "Textures") return null;
            string dir = Path.GetDirectoryName(texDir);
            if (dir == null || !Directory.Exists(dir)) return null;
            foreach (string f in Directory.GetFiles(dir, "*" + Suffix)) return Load(f);
            return null;
        }

        public static Sidecar Load(string path)
        {
            if (!File.Exists(path)) return null;
            string json = File.ReadAllText(path);
            Sidecar s = JsonUtility.FromJson<Sidecar>(json);
            if (s == null || s.format != Format) return null;
            s.json = json;
            s.path = path.Replace('\\', '/');
            return s;
        }

        public string Folder => Path.GetDirectoryName(path)?.Replace('\\', '/');

        public MaterialInfo MaterialForRole(string role)
        {
            foreach (MaterialInfo m in materials) if (m.role == role) return m;
            return null;
        }

        public MaterialInfo MaterialForTexture(string assetPath)
        {
            string file = assetPath.Replace('\\', '/');
            foreach (MaterialInfo m in materials) if (file.EndsWith("/" + m.texture, StringComparison.OrdinalIgnoreCase)) return m;
            return null;
        }

        public MeshInfo MeshNamed(string meshName)
        {
            foreach (MeshInfo m in meshes) if (m.name == meshName) return m;
            return null;
        }
    }

    [Serializable] public sealed class MeshInfo { public string name; public string role; public int vertices; public int triangles; public string[] blendshapes; }

    [Serializable]
    public sealed class MaterialInfo
    {
        public string name;
        public string shader;
        public string role;
        public string texture;
        public float alphaClip;
        public bool doubleSided;
        /// <summary>Card hair whose normals describe the hair's volume: drawn on both sides, lit by the one normal.</summary>
        public bool volumeNormals;
        public int maxSize;
        public bool alphaIsTransparency;
        /// <summary>skin, cloth, hair or eyes: the per-pixel model's wrap, gloss and highlight (PS2Common.hlsl).</summary>
        public string surface;
    }

    [Serializable]
    public sealed class QualityInfo
    {
        public string profile;
        /// <summary>vertex or pixel.</summary>
        public string lighting;
        /// <summary>off, key or self.</summary>
        public string shadows;
        public bool bakedOcclusion;
        public bool bakedLight;
    }

    [Serializable] public sealed class Trs { public float[] position; public float[] rotation; public float[] scale; }

    [Serializable]
    public sealed class BoneInfo
    {
        public string name;
        public int parent;
        public float[] position;
        public float[] rotation;
        public float[] scale;
        public Trs tPose;
    }

    [Serializable] public sealed class BudgetInfo { public int target; public int hardMax; public int triangles; }

    [Serializable] public sealed class SourceInfo { public string characterId; public string bodyMesh; public string skin; public string hair; public string[] garments; }

    /// <summary>humanoid_map.json: Unity Humanoid bone name -> GameEngine bone name.</summary>
    public static class HumanoidMap
    {
        public const string Path = "Packages/com.ps2cc.importer/Editor/humanoid_map.json";
        static Dictionary<string, string> cache;

        public static Dictionary<string, string> Bones
        {
            get
            {
                if (cache != null) return cache;
                // Read the file from the package's folder on disk: the AssetDatabase may not have imported it
                // yet when the first model is preprocessed, and a local package can live anywhere.
                var package = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(HumanoidMap).Assembly);
                string file = package != null ? System.IO.Path.Combine(package.resolvedPath, "Editor", "humanoid_map.json") : System.IO.Path.GetFullPath(Path);
                if (!File.Exists(file)) throw new FileNotFoundException("PS2CC: humanoid map not found", file);
                string json = File.ReadAllText(file);
                // The map is flat "Human": "bone" pairs inside "bones"; JsonUtility cannot read dictionaries.
                var map = new Dictionary<string, string>();
                int start = json.IndexOf("\"bones\"", StringComparison.Ordinal);
                int open = json.IndexOf('{', start);
                int close = json.IndexOf('}', open);
                foreach (string line in json.Substring(open + 1, close - open - 1).Split(','))
                {
                    string[] kv = line.Split(':');
                    if (kv.Length != 2) continue;
                    map[kv[0].Trim().Trim('"')] = kv[1].Trim().Trim('"');
                }
                cache = map;
                return map;
            }
        }
    }
}
