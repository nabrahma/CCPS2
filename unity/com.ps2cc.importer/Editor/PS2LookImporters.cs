using System.Globalization;
using System.IO;
using UnityEditor.AssetImporters;
using UnityEngine;

namespace PS2CC.Editor
{
    /// <summary>.ps2look files (looks saved by PS2CC, PRD Part 2 F14) import as text, for the PS2Look component.</summary>
    [ScriptedImporter(1, "ps2look")]
    public sealed class PS2LookImporter : ScriptedImporter
    {
        public override void OnImportAsset(AssetImportContext ctx)
        {
            var text = new TextAsset(File.ReadAllText(ctx.assetPath));
            ctx.AddObjectToAsset("look", text);
            ctx.SetMainObject(text);
        }
    }

    /// <summary>.cube 3D LUTs (the looks' colour grades) import as a Texture3D for PS2/Grade.</summary>
    [ScriptedImporter(1, "cube")]
    public sealed class CubeLutImporter : ScriptedImporter
    {
        public override void OnImportAsset(AssetImportContext ctx)
        {
            Texture3D tex = Read(File.ReadAllText(ctx.assetPath), out string error);
            if (tex == null)
            {
                ctx.LogImportError($"PS2CC: {ctx.assetPath}: {error}");
                return;
            }
            tex.name = Path.GetFileNameWithoutExtension(ctx.assetPath);
            ctx.AddObjectToAsset("lut", tex);
            ctx.SetMainObject(tex);
        }

        /// <summary>Parse a .cube (LUT_3D_SIZE, domain 0..1, red fastest) into an RGBA half-float Texture3D.</summary>
        public static Texture3D Read(string text, out string error)
        {
            error = null;
            int size = 0;
            var values = new System.Collections.Generic.List<Color>();
            foreach (string raw in text.Split('\n'))
            {
                string line = raw.Trim();
                if (line.Length == 0 || line[0] == '#' || line.StartsWith("TITLE") || line.StartsWith("DOMAIN_")) continue;
                if (line.StartsWith("LUT_3D_SIZE"))
                {
                    size = int.Parse(line.Substring(11).Trim(), CultureInfo.InvariantCulture);
                    continue;
                }
                if (line.StartsWith("LUT_1D_SIZE"))
                {
                    error = "1D LUTs are not supported";
                    return null;
                }
                string[] p = line.Split((char[])null, System.StringSplitOptions.RemoveEmptyEntries);
                if (p.Length != 3) continue;
                values.Add(new Color(
                    float.Parse(p[0], CultureInfo.InvariantCulture),
                    float.Parse(p[1], CultureInfo.InvariantCulture),
                    float.Parse(p[2], CultureInfo.InvariantCulture), 1));
            }
            if (size < 2 || values.Count != size * size * size)
            {
                error = $"expected {size}^3 entries, found {values.Count}";
                return null;
            }
            var tex = new Texture3D(size, size, size, TextureFormat.RGBAHalf, false)
            {
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
            };
            // Texture3D pixel order is x fastest, then y, then z: the same as .cube's r, g, b.
            tex.SetPixels(values.ToArray());
            tex.Apply(false, true);
            return tex;
        }
    }
}
