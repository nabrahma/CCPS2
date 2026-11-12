using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using PS2CC.Editor;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace PS2CC.Tests
{
    /// <summary>
    /// The benchmark board, Unity half (PRD Part 2 section 4, F22), run in batchmode:
    ///   Unity -batchmode -projectPath tests/UnityHarness -executeMethod PS2CC.Tests.Bench.Run -quit
    /// with PS2CC_BENCH_DIR set (scripts/bench.mjs does this). For every view the
    /// app rendered (views.json) it renders the exported character with the
    /// same camera, the same look (PS2Look, no grain) and PS2/Grade, into
    /// &lt;run&gt;/unity/&lt;view&gt;.png, which the bench compares with the app's parity render.
    /// </summary>
    public static class Bench
    {
        const string Root = "Assets/PS2CC/Bench";

        [Serializable]
        class View
        {
            public string name;
            public string character;
            public string profile;
            public string look;
            public string camera;
            public int size;
            public float[] position;
            public float[] target;
            public float fov;
            public float near;
            public float far;
        }

        [Serializable]
        class Views
        {
            public int size;
            public View[] views;
        }

        [Serializable]
        class BenchReport
        {
            public string unity;
            public List<string> rendered = new List<string>();
            public List<string> errors = new List<string>();
        }

        public static void Run()
        {
            var report = new BenchReport { unity = Application.unityVersion };
            string run = Environment.GetEnvironmentVariable("PS2CC_BENCH_DIR");
            try
            {
                if (string.IsNullOrEmpty(run)) throw new Exception("PS2CC_BENCH_DIR is not set");
                Render(run, report);
            }
            catch (Exception e)
            {
                report.errors.Add("bench exception: " + e);
            }
            if (!string.IsNullOrEmpty(run)) File.WriteAllText(Path.Combine(run, "unity_report.json"), JsonUtility.ToJson(report, true));
            Debug.Log($"PS2CC bench: {report.rendered.Count} views, {report.errors.Count} errors");
            EditorApplication.Exit(report.errors.Count == 0 ? 0 : 1);
        }

        static Vector3 ToUnity(float[] p) => new Vector3(-p[0], p[1], p[2]);

        static void Render(string run, BenchReport report)
        {
            Harness.EnsureUrp();
            // PS2CC's shaders light in linear space, as URP does; a Gamma project would skip sRGB decoding.
            if (PlayerSettings.colorSpace != ColorSpace.Linear) PlayerSettings.colorSpace = ColorSpace.Linear;
            // Per-texture anisotropy (PS2CC textures import at level 1, as the app samples them); the Ultra
            // quality level would force it on and show card hair sharper than the app does.
            QualitySettings.anisotropicFiltering = AnisotropicFiltering.Enable;
            ShaderUtil.allowAsyncCompilation = false;
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            if (GraphicsSettings.defaultRenderPipeline is UniversalRenderPipelineAsset urp)
            {
                urp.supportsHDR = true;
                urp.shadowDistance = 12f;
                urp.mainLightShadowmapResolution = 2048;
            }
            Views views = JsonUtility.FromJson<Views>(File.ReadAllText(Path.Combine(run, "views.json")));
            string outDir = Path.Combine(run, "unity");
            Directory.CreateDirectory(outDir);
            var grade = new Material(Shader.Find("PS2/Grade"));
            foreach (IGrouping<string, View> group in views.views.GroupBy(v => $"{v.character}_{v.profile}"))
            {
                string prefabPath = $"{Root}/{group.Key}/{group.Key}.prefab";
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                if (prefab == null)
                {
                    report.errors.Add($"no prefab {prefabPath}");
                    continue;
                }
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = Vector3.zero;
                try
                {
                    foreach (View v in group) RenderView(instance, v, outDir, grade, report);
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(instance);
                }
            }
            UnityEngine.Object.DestroyImmediate(grade);
        }

        static void RenderView(GameObject character, View v, string outDir, Material grade, BenchReport report)
        {
            var lookAsset = AssetDatabase.LoadAssetAtPath<TextAsset>($"{Root}/Looks/{v.look}.ps2look");
            if (lookAsset == null)
            {
                report.errors.Add($"{v.name}: no look {v.look}");
                return;
            }
            var rig = new GameObject("BenchRig");
            var snapshot = new GameObject("BenchSnapshot");
            var hidden = new List<SkinnedMeshRenderer>();
            try
            {
                // Skinned meshes are not re-skinned for a manual render in the editor: render baked copies.
                foreach (SkinnedMeshRenderer r in character.GetComponentsInChildren<SkinnedMeshRenderer>())
                {
                    var baked = new Mesh();
                    r.BakeMesh(baked, true);
                    var part = new GameObject(r.name);
                    part.transform.SetParent(snapshot.transform, false);
                    part.transform.SetPositionAndRotation(r.transform.position, r.transform.rotation);
                    part.AddComponent<MeshFilter>().sharedMesh = baked;
                    var mr = part.AddComponent<MeshRenderer>();
                    mr.sharedMaterials = r.sharedMaterials;
                    mr.shadowCastingMode = r.shadowCastingMode;
                    mr.receiveShadows = r.receiveShadows;
                    if (r.enabled)
                    {
                        r.enabled = false;
                        hidden.Add(r);
                    }
                }
                var camGo = new GameObject("BenchCamera");
                camGo.transform.SetParent(rig.transform, false);
                var cam = camGo.AddComponent<Camera>();
                cam.fieldOfView = v.fov;
                cam.nearClipPlane = v.near > 0 ? v.near : 0.02f;
                cam.farClipPlane = v.far > 0 ? v.far : 60f;
                cam.aspect = 1;
                cam.allowHDR = true;
                cam.transform.position = ToUnity(v.position);
                cam.transform.LookAt(ToUnity(v.target));
                var camData = camGo.GetComponent<UniversalAdditionalCameraData>() ?? camGo.AddComponent<UniversalAdditionalCameraData>();
                camData.renderPostProcessing = false;
                camData.renderShadows = v.profile != "classic";
                var lightGo = new GameObject("BenchKeyLight");
                lightGo.transform.SetParent(rig.transform, false);
                var key = lightGo.AddComponent<Light>();
                key.type = LightType.Directional;
                key.shadows = v.profile == "classic" ? LightShadows.None : LightShadows.Soft;
                key.intensity = 1;
                var look = rig.AddComponent<PS2Look>();
                look.look = lookAsset;
                look.lut = AssetDatabase.LoadAssetAtPath<Texture3D>($"{Root}/Looks/{LutFile(lookAsset.text)}");
                look.viewCamera = cam;
                look.flashlightAim = Vector3.Distance(ToUnity(v.position), ToUnity(v.target));
                look.keyLight = key;
                look.noGrain = true;
                look.Apply();
                cam.clearFlags = CameraClearFlags.SolidColor;
                // Camera colours are given in gamma space and converted to linear (Linear colour space).
                cam.backgroundColor = look.Background.gamma;

                int size = v.size > 0 ? v.size : 640;
                var scene = new RenderTexture(size, size, 24, RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear);
                // The grade returns linear colour (for URP's sRGB back buffer); read it as float and encode here.
                var output = new RenderTexture(size, size, 0, RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear);
                cam.targetTexture = scene;
                cam.Render();
                cam.Render(); // the first render of a run can come out before materials and shadows are ready
                var cmd = new CommandBuffer { name = "PS2 Grade" };
                cmd.SetRenderTarget(output);
                cmd.SetGlobalTexture("_BlitTexture", scene);
                cmd.SetGlobalVector("_BlitScaleBias", new Vector4(1, 1, 0, 0));
                cmd.DrawProcedural(Matrix4x4.identity, grade, 0, MeshTopology.Triangles, 3);
                Graphics.ExecuteCommandBuffer(cmd);
                cmd.Release();
                RenderTexture.active = output;
                var lin = new Texture2D(size, size, TextureFormat.RGBAFloat, false, true);
                lin.ReadPixels(new Rect(0, 0, size, size), 0, 0);
                lin.Apply();
                RenderTexture.active = null;
                Color[] pixels = lin.GetPixels();
                var bytes = new Color32[pixels.Length];
                for (int i = 0; i < pixels.Length; i++)
                    bytes[i] = new Color32(Srgb8(pixels[i].r), Srgb8(pixels[i].g), Srgb8(pixels[i].b), 255);
                var tex = new Texture2D(size, size, TextureFormat.RGBA32, false);
                tex.SetPixels32(bytes);
                tex.Apply();
                File.WriteAllBytes(Path.Combine(outDir, v.name + ".png"), tex.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(tex);
                UnityEngine.Object.DestroyImmediate(lin);
                cam.targetTexture = null;
                scene.Release();
                output.Release();
                report.rendered.Add(v.name);
            }
            finally
            {
                Shader.SetGlobalFloat("_PS2LookActive", 0);
                Shader.SetGlobalFloat("_PS2GradeOn", 0);
                UnityEngine.Object.DestroyImmediate(rig);
                foreach (MeshFilter f in snapshot.GetComponentsInChildren<MeshFilter>()) UnityEngine.Object.DestroyImmediate(f.sharedMesh);
                UnityEngine.Object.DestroyImmediate(snapshot);
                foreach (SkinnedMeshRenderer r in hidden) r.enabled = true;
            }
        }

        /// <summary>
        /// Diagnostics for parity: the camera's cleared background as stored in the scene buffer, and a
        /// known linear colour through PS2/Grade with each step on and off. Writes &lt;run&gt;/grade_probe.json.
        /// </summary>
        public static void GradeProbe()
        {
            string run = Environment.GetEnvironmentVariable("PS2CC_BENCH_DIR");
            var lines = new List<string>();
            try
            {
                Harness.EnsureUrp();
                ShaderUtil.allowAsyncCompilation = false;
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                var lookAsset = AssetDatabase.LoadAssetAtPath<TextAsset>($"{Root}/Looks/villageOvercast.ps2look");
                var rig = new GameObject("Probe");
                var cam = rig.AddComponent<Camera>();
                cam.allowHDR = true;
                cam.transform.position = new Vector3(0, 100, 0);
                var look = rig.AddComponent<PS2Look>();
                look.look = lookAsset;
                look.lut = AssetDatabase.LoadAssetAtPath<Texture3D>($"{Root}/Looks/village_overcast.cube");
                look.viewCamera = cam;
                look.noGrain = true;
                look.Apply();
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = look.Background.gamma;
                var scene = new RenderTexture(64, 64, 24, RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear);
                cam.targetTexture = scene;
                cam.Render();
                lines.Add("lut " + (look.lut != null ? look.lut.width + "^3 " + look.lut.format : "missing"));
                lines.Add("clear (linear, want 0.4 0.41 0.36): " + Read(scene, true));
                var grade = new Material(Shader.Find("PS2/Grade"));
                var src = new Texture2D(64, 64, TextureFormat.RGBAHalf, false, true);
                var px = new Color[64 * 64];
                for (int i = 0; i < px.Length; i++) px[i] = new Color(0.4f, 0.41f, 0.36f, 1);
                src.SetPixels(px);
                src.Apply();
                var input = new RenderTexture(64, 64, 0, RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear);
                Graphics.Blit(src, input);
                lines.Add("input (linear): " + Read(input, true));
                void Probe(string label)
                {
                    var output = new RenderTexture(64, 64, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
                    var cmd = new CommandBuffer();
                    cmd.SetRenderTarget(output);
                    cmd.SetGlobalTexture("_BlitTexture", input);
                    cmd.SetGlobalVector("_BlitScaleBias", new Vector4(1, 1, 0, 0));
                    cmd.DrawProcedural(Matrix4x4.identity, grade, 0, MeshTopology.Triangles, 3);
                    Graphics.ExecuteCommandBuffer(cmd);
                    cmd.Release();
                    lines.Add(label + ": " + Read(output, false));
                    output.Release();
                }
                Probe("full grade (app gives 200 206 175)");
                Shader.SetGlobalFloat("_PS2GradeVignette", 0);
                Probe("no vignette");
                Shader.SetGlobalFloat("_PS2GradeHasLut", 0);
                Probe("no LUT (app gives 201 203 192)");
                Shader.SetGlobalFloat("_PS2GradeTonemap", 0);
                Shader.SetGlobalFloat("_PS2GradeExposure", 0);
                Probe("no tonemap, no exposure (app gives 170 172 162)");
                Shader.SetGlobalFloat("_PS2GradeOn", 0);
                Probe("grade off (sRGB of the input, 170 172 162)");
                UnityEngine.Object.DestroyImmediate(rig);
            }
            catch (Exception e)
            {
                lines.Add("exception: " + e);
            }
            File.WriteAllLines(Path.Combine(run ?? ".", "grade_probe.txt"), lines);
            EditorApplication.Exit(0);
        }

        /// <summary>Exact sRGB encoding of a linear value to 8 bits (the app's post pass does the same).</summary>
        static byte Srgb8(float c)
        {
            c = Mathf.Clamp01(c);
            float s = c <= 0.0031308f ? c * 12.92f : 1.055f * Mathf.Pow(c, 1f / 2.4f) - 0.055f;
            return (byte)Mathf.RoundToInt(s * 255f);
        }

        static string Read(RenderTexture rt, bool linearFloat)
        {
            RenderTexture.active = rt;
            var tex = linearFloat ? new Texture2D(rt.width, rt.height, TextureFormat.RGBAFloat, false, true) : new Texture2D(rt.width, rt.height, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
            tex.Apply();
            RenderTexture.active = null;
            Color c = tex.GetPixel(32, 32);
            UnityEngine.Object.DestroyImmediate(tex);
            return linearFloat ? $"{c.r:F4} {c.g:F4} {c.b:F4}" : $"{Mathf.RoundToInt(c.r * 255)} {Mathf.RoundToInt(c.g * 255)} {Mathf.RoundToInt(c.b * 255)}";
        }

        /// <summary>The LUT file a look names ("looks/x.cube" → "x.cube"), or "".</summary>
        static string LutFile(string lookJson)
        {
            var data = JsonUtility.FromJson<PS2Look.LookData>(lookJson);
            string lut = data?.grade?.lut;
            return string.IsNullOrEmpty(lut) ? "" : Path.GetFileName(lut);
        }
    }
}
