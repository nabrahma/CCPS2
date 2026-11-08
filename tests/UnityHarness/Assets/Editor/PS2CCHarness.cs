using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using PS2CC.Editor;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace PS2CC.Tests
{
    /// <summary>
    /// PRD 6.4 Unity harness, run in batchmode:
    ///   Unity -batchmode -projectPath tests/UnityHarness -executeMethod PS2CC.Tests.Harness.ImportAll -quit
    /// (scripts/unity-harness.mjs does this after writing the test exports into Assets/PS2CC).
    /// Fails on an invalid avatar, a missing material or texture, a triangle count above budget,
    /// a missing blendshape, a shader with errors, a wrong facing/scale, or a retargeted pose that
    /// tears the mesh. Writes Reports/report.json and pose screenshots to Reports/.
    /// </summary>
    public static class Harness
    {
        const string Root = "Assets/PS2CC";
        static readonly string[] Shaders = { "PS2/Skin", "PS2/Cutout", "PS2/Cloth", "PS2/LookFullscreen" };

        [Serializable]
        class CharacterReport
        {
            public string name;
            public bool avatarValid;
            public bool avatarHuman;
            public int renderers;
            public int triangles;
            public int budget;
            public float height;
            public float feetY;
            public bool facesPlusZ;
            public float maxPoseStretch;
            public float restSkinningError;
            public int blendshapes;
            public List<string> expressionsInfo = new List<string>();
            public List<string> renderersInfo = new List<string>();
            public List<string> errors = new List<string>();
        }

        [Serializable]
        class Report
        {
            public string unity;
            public string pipeline;
            public List<string> shaderErrors = new List<string>();
            public List<CharacterReport> characters = new List<CharacterReport>();
            public int failures;
        }

        public static void ImportAll()
        {
            var report = new Report { unity = Application.unityVersion };
            try
            {
                Run(report);
            }
            catch (Exception e)
            {
                report.shaderErrors.Add("harness exception: " + e);
                report.failures++;
            }
            Directory.CreateDirectory("Reports");
            File.WriteAllText("Reports/report.json", JsonUtility.ToJson(report, true));
            Debug.Log($"PS2CC harness: {report.characters.Count} characters, {report.failures} failures");
            EditorApplication.Exit(report.failures == 0 ? 0 : 1);
        }

        static void Run(Report report)
        {
            EnsureUrp();
            // Compile shaders before drawing: with async compilation the first render shows placeholders.
            ShaderUtil.allowAsyncCompilation = false;
            report.pipeline = GraphicsSettings.defaultRenderPipeline != null ? GraphicsSettings.defaultRenderPipeline.GetType().Name : "none";
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

            foreach (string name in Shaders)
            {
                Shader s = Shader.Find(name);
                if (s == null) report.shaderErrors.Add($"{name}: not found");
                else if (ShaderUtil.ShaderHasError(s))
                {
                    var msgs = ShaderUtil.GetShaderMessages(s).Where(m => m.severity == UnityEditor.Rendering.ShaderCompilerMessageSeverity.Error);
                    report.shaderErrors.Add($"{name}: " + string.Join(" | ", msgs.Select(m => $"{m.message} ({m.file}:{m.line})")));
                }
            }
            report.failures += report.shaderErrors.Count;

            if (!AssetDatabase.IsValidFolder(Root)) throw new Exception($"{Root} is missing: run scripts/unity-harness.mjs");
            var sidecars = Directory.GetFiles(Root, "*" + Sidecar.Suffix, SearchOption.AllDirectories).OrderBy(p => p).ToList();
            if (sidecars.Count == 0) throw new Exception("no PS2CC exports found");
            foreach (string sidecarPath in sidecars)
            {
                CharacterReport c;
                try
                {
                    c = Check(sidecarPath.Replace('\\', '/'));
                }
                catch (Exception e)
                {
                    c = new CharacterReport { name = Path.GetFileName(sidecarPath) };
                    c.errors.Add("exception: " + e.Message);
                }
                report.characters.Add(c);
                if (c.errors.Count > 0) report.failures++;
            }
        }

        static CharacterReport Check(string sidecarPath)
        {
            Sidecar sidecar = Sidecar.Load(sidecarPath);
            var c = new CharacterReport { name = sidecar.name, budget = sidecar.budget.target };
            string dir = Path.GetDirectoryName(sidecarPath).Replace('\\', '/');
            string fbx = $"{dir}/{sidecar.name}.fbx";
            var importer = AssetImporter.GetAtPath(fbx) as ModelImporter;
            if (importer == null)
            {
                c.errors.Add("FBX not imported");
                return c;
            }
            if (importer.animationType != ModelImporterAnimationType.Human) c.errors.Add("animation type is not Humanoid");
            Avatar avatar = AssetDatabase.LoadAllAssetsAtPath(fbx).OfType<Avatar>().FirstOrDefault();
            c.avatarValid = avatar != null && avatar.isValid;
            c.avatarHuman = avatar != null && avatar.isHuman;
            if (!c.avatarValid || !c.avatarHuman) c.errors.Add("avatar invalid: missing " + string.Join(", ", PS2CCPostprocessor.MissingHumanBones(sidecar)));

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>($"{dir}/{sidecar.name}.prefab");
            if (prefab == null)
            {
                c.errors.Add("prefab missing");
                return c;
            }
            var renderers = prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            c.renderers = renderers.Length;
            if (renderers.Length > 5) c.errors.Add($"{renderers.Length} renderers (more than 5 draw calls)");
            if (renderers.Length != sidecar.meshes.Length) c.errors.Add($"{renderers.Length} renderers, sidecar lists {sidecar.meshes.Length} meshes");
            foreach (var r in renderers)
            {
                MeshInfo info = sidecar.MeshNamed(r.name);
                if (info == null)
                {
                    c.errors.Add($"renderer {r.name} not in the sidecar");
                    continue;
                }
                MaterialInfo mi = sidecar.MaterialForRole(info.role);
                Material m = r.sharedMaterial;
                if (m == null || mi == null) c.errors.Add($"{r.name}: material missing");
                else
                {
                    if (m.shader == null || m.shader.name != mi.shader) c.errors.Add($"{r.name}: shader {m.shader?.name}, want {mi.shader}");
                    if (m.GetTexture("_BaseMap") == null) c.errors.Add($"{r.name}: texture missing");
                }
                Mesh mesh = r.sharedMesh;
                if (mesh == null)
                {
                    c.errors.Add($"{r.name}: mesh missing");
                    continue;
                }
                c.triangles += mesh.triangles.Length / 3;
                foreach (string bs in info.blendshapes ?? Array.Empty<string>())
                    if (mesh.GetBlendShapeIndex(bs) < 0) c.errors.Add($"{r.name}: blendshape {bs} missing");
                if (r.bones.Length == 0 || r.bones.Any(b => b == null)) c.errors.Add($"{r.name}: bones not bound");
            }
            if (c.triangles != sidecar.budget.triangles) c.errors.Add($"{c.triangles} triangles in Unity, sidecar says {sidecar.budget.triangles}");
            if (c.triangles > sidecar.budget.target) c.errors.Add($"{c.triangles} triangles is above the budget {sidecar.budget.target}");

            // Scale, feet and facing on an instance.
            var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            try
            {
                var bounds = new Bounds();
                bool first = true;
                foreach (var r in go.GetComponentsInChildren<SkinnedMeshRenderer>())
                {
                    var baked = new Mesh();
                    r.BakeMesh(baked, true);
                    foreach (var v in baked.vertices)
                    {
                        Vector3 w = r.transform.TransformPoint(v);
                        if (first)
                        {
                            bounds = new Bounds(w, Vector3.zero);
                            first = false;
                        }
                        else bounds.Encapsulate(w);
                    }
                    UnityEngine.Object.DestroyImmediate(baked);
                }
                c.height = bounds.size.y;
                c.feetY = bounds.min.y;
                // Units check (metres, not centimetres); extreme sliders make characters from about 1.2 to 2.3 m.
                if (c.height < 1.0f || c.height > 2.6f) c.errors.Add($"height {c.height:F3} m (expect metres)");
                // Rest-pose skinning must reproduce the imported mesh (bind poses and weights are right).
                foreach (var r in go.GetComponentsInChildren<SkinnedMeshRenderer>())
                {
                    var baked = new Mesh();
                    r.BakeMesh(baked, true);
                    var src = r.sharedMesh.vertices;
                    var dst = baked.vertices;
                    float err = 0;
                    var b = new Bounds(dst[0], Vector3.zero);
                    for (int k = 0; k < src.Length; k++)
                    {
                        err = Mathf.Max(err, (src[k] - dst[k]).magnitude);
                        b.Encapsulate(dst[k]);
                    }
                    c.restSkinningError = Mathf.Max(c.restSkinningError, err);
                    c.renderersInfo.Add($"{r.name}: y {b.min.y:F3}..{b.max.y:F3}, rest skinning error {err * 1000:F2} mm");
                    UnityEngine.Object.DestroyImmediate(baked);
                }
                if (c.restSkinningError > 0.001f) c.errors.Add($"rest-pose skinning moves vertices by {c.restSkinningError * 1000:F1} mm (bind poses or weights wrong)");
                if (Mathf.Abs(c.feetY) > 0.01f) c.errors.Add($"feet at y = {c.feetY:F3} (expect 0)");
                var animator = go.GetComponent<Animator>();
                if (animator == null || animator.avatar == null || !animator.avatar.isHuman) return c;
                Transform head = animator.GetBoneTransform(HumanBodyBones.Head);
                Transform hips = animator.GetBoneTransform(HumanBodyBones.Hips);
                Transform leftHand = animator.GetBoneTransform(HumanBodyBones.LeftHand);
                var headRenderer = go.GetComponentsInChildren<SkinnedMeshRenderer>().FirstOrDefault(r => sidecar.MeshNamed(r.name)?.role == "head");
                if (head != null && headRenderer != null)
                {
                    var baked = new Mesh();
                    headRenderer.BakeMesh(baked, true);
                    float front = baked.vertices.Select(v => headRenderer.transform.TransformPoint(v).z).Max() - head.position.z;
                    float back = head.position.z - baked.vertices.Select(v => headRenderer.transform.TransformPoint(v).z).Min();
                    c.facesPlusZ = front > back;
                    UnityEngine.Object.DestroyImmediate(baked);
                }
                if (!c.facesPlusZ) c.errors.Add("the character does not face +Z");
                // Left is left: Unity's LeftHand should be on the character's left (-X when facing +Z).
                if (leftHand != null && hips != null && leftHand.position.x > hips.position.x) c.errors.Add("left and right are swapped");

                ExpressionCheck(go, sidecar, c);
                c.maxPoseStretch = RetargetCheck(go, sidecar.name);
                // Gross failures only: deformation in a stride legitimately stretches crotch and armpit triangles.
                if (float.IsInfinity(c.maxPoseStretch) || c.maxPoseStretch > 50f) c.errors.Add($"retargeted pose stretches a triangle {c.maxPoseStretch:F1}x (broken limb)");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(go);
            }
            return c;
        }

        /// <summary>
        /// Retargeting (PRD M7): Humanoid animation clips are sampled on the character through
        /// Mecanim, the same path a Mixamo clip takes. The harness builds a walk cycle clip from
        /// muscle curves and also samples every clip in Assets/Animations (drop Mixamo or Unity
        /// sample clips there). Each sample is rendered and the worst triangle stretch is measured.
        /// </summary>
        static float RetargetCheck(GameObject go, string name)
        {
            var animator = go.GetComponent<Animator>();
            if (animator == null || animator.avatar == null || !animator.avatar.isHuman) return float.PositiveInfinity;
            var renderers = go.GetComponentsInChildren<SkinnedMeshRenderer>();
            var rest = renderers.Select(r => { var m = new Mesh(); r.BakeMesh(m, true); return m; }).ToArray();
            // Unity's zero-muscle pose, for reference.
            var handler = new HumanPoseHandler(animator.avatar, go.transform);
            var pose = new HumanPose();
            handler.GetHumanPose(ref pose);
            for (int i = 0; i < pose.muscles.Length; i++) pose.muscles[i] = 0;
            pose.bodyRotation = Quaternion.identity;
            handler.SetHumanPose(ref pose);
            Screenshot(go, $"Reports/{name}_muscles_zero.png");
            Vector3 standing = pose.bodyPosition;

            float worst = 0;
            var clips = new List<AnimationClip> { WalkClip() };
            if (AssetDatabase.IsValidFolder("Assets/Animations"))
                foreach (string guid in AssetDatabase.FindAssets("t:AnimationClip", new[] { "Assets/Animations" }))
                    clips.AddRange(AssetDatabase.LoadAllAssetsAtPath(AssetDatabase.GUIDToAssetPath(guid)).OfType<AnimationClip>().Where(c => c.isHumanMotion && !c.name.StartsWith("__preview")));
            string[] muscleNames = HumanTrait.MuscleName;
            foreach (AnimationClip clip in clips)
            {
                // The clip's muscle curves (Humanoid clips, including Mixamo's, are stored in muscle space).
                var curves = new Dictionary<int, AnimationCurve>();
                foreach (EditorCurveBinding b in AnimationUtility.GetCurveBindings(clip))
                {
                    int m = Array.IndexOf(muscleNames, b.propertyName);
                    if (m >= 0) curves[m] = AnimationUtility.GetEditorCurve(clip, b);
                }
                foreach (float f in new[] { 0.15f, 0.4f, 0.65f, 0.9f })
                {
                    float t = clip.length * f;
                    for (int i = 0; i < pose.muscles.Length; i++) pose.muscles[i] = curves.TryGetValue(i, out var c) ? c.Evaluate(t) : 0f;
                    pose.bodyPosition = standing;
                    pose.bodyRotation = Quaternion.identity;
                    handler.SetHumanPose(ref pose);
                    for (int k = 0; k < renderers.Length; k++)
                    {
                        var posed = new Mesh();
                        renderers[k].BakeMesh(posed, true);
                        worst = Mathf.Max(worst, MaxStretch(rest[k], posed));
                        UnityEngine.Object.DestroyImmediate(posed);
                    }
                    if (f == 0.15f)
                    {
                        Screenshot(go, $"Reports/{name}_{clip.name}.png");
                    }
                }
            }
            handler.Dispose();
            foreach (var m in rest) UnityEngine.Object.DestroyImmediate(m);
            return worst;
        }

        /// <summary>The PRD F8 default blendshape set.</summary>
        static readonly string[] DefaultBlendshapes =
            { "blink_L", "blink_R", "jawOpen", "smile", "frown", "browsUp", "browsDown", "squint", "AA", "EE", "IH", "OH", "OU", "FV", "MBP" };

        /// <summary>
        /// Expressions (PRD M8): the default blendshapes are on the head and on every mesh the
        /// sidecar says they move; applied through Unity, blink moves the eyelids and the lashes,
        /// and jawOpen opens the mouth. Face close-ups of the main shapes go to Reports/.
        /// </summary>
        static void ExpressionCheck(GameObject go, Sidecar sidecar, CharacterReport c)
        {
            var renderers = go.GetComponentsInChildren<SkinnedMeshRenderer>();
            string[] names = sidecar.blendshapes ?? Array.Empty<string>();
            c.blendshapes = names.Length;
            foreach (string n in DefaultBlendshapes)
                if (!names.Contains(n)) c.errors.Add($"default blendshape {n} not exported");
            SkinnedMeshRenderer head = renderers.FirstOrDefault(r => sidecar.MeshNamed(r.name)?.role == "head");
            SkinnedMeshRenderer eyes = renderers.FirstOrDefault(r => sidecar.MeshNamed(r.name)?.role == "eyes");
            if (head == null) return;
            foreach (string n in names)
                if (head.sharedMesh.GetBlendShapeIndex(n) < 0) c.errors.Add($"head: blendshape {n} missing");

            var face = go.GetComponent<PS2CC.PS2Expressions>();
            if (face == null) c.errors.Add("prefab has no PS2Expressions component");
            else face.Refresh();
            // Displacement of a renderer's baked mesh with one blendshape at 100 against neutral.
            float Moved(SkinnedMeshRenderer r, string shape)
            {
                if (r == null || r.sharedMesh.GetBlendShapeIndex(shape) < 0) return 0f;
                var rest = new Mesh();
                r.BakeMesh(rest, true);
                face?.Set(shape, 1f);
                var posed = new Mesh();
                r.BakeMesh(posed, true);
                face?.ResetAll();
                float m = 0;
                var a = rest.vertices;
                var b = posed.vertices;
                for (int i = 0; i < a.Length; i++) m = Mathf.Max(m, (a[i] - b[i]).magnitude);
                UnityEngine.Object.DestroyImmediate(rest);
                UnityEngine.Object.DestroyImmediate(posed);
                return m;
            }
            foreach (var (shape, mesh, min) in new[] { ("blink_L", head, 0.004f), ("blink_R", head, 0.004f), ("jawOpen", head, 0.01f), ("blink_L", eyes, 0.002f), ("jawOpen", eyes, 0.0f) })
            {
                if (mesh == null) continue;
                float m = Moved(mesh, shape);
                c.expressionsInfo.Add($"{mesh.name}/{shape}: moves up to {m * 1000:F1} mm");
                if (m < min) c.errors.Add($"{mesh.name}: {shape} moves only {m * 1000:F2} mm in Unity");
            }

            // Face close-ups (the blink screenshot check of PRD M8).
            var hb = new Mesh();
            head.BakeMesh(hb, true);
            Bounds bounds = hb.bounds;
            UnityEngine.Object.DestroyImmediate(hb);
            Vector3 centre = head.transform.TransformPoint(bounds.center) + new Vector3(0, 0.02f, 0);
            var shots = new (string label, string[] shapes)[]
            {
                ("neutral", new string[0]),
                ("blink", new[] { "blink_L", "blink_R" }),
                ("jawOpen", new[] { "jawOpen" }),
                ("smile", new[] { "smile" }),
                ("browsUp", new[] { "browsUp" }),
                ("OU", new[] { "OU" }),
            };
            foreach (var (label, shapes) in shots)
            {
                foreach (string sh in shapes) face?.Set(sh, 1f);
                Screenshot(go, $"Reports/{sidecar.name}_face_{label}.png", centre + new Vector3(0.12f, 0.03f, 0.55f), centre, 26f, 512, 512);
                face?.ResetAll();
            }
            // Eye close-up (closed and open) for the lashes, without the hair in front.
            if (eyes == null) return;
            var eb = new Mesh();
            eyes.BakeMesh(eb, true);
            // The eyes atlas holds eyeballs, brows and lashes: aim a little below its centre, at the front.
            Vector3 eyesCentre = eyes.transform.TransformPoint(eb.bounds.center);
            float front = eyes.transform.TransformPoint(eb.bounds.max).z;
            UnityEngine.Object.DestroyImmediate(eb);
            Vector3 eye = new Vector3(eyesCentre.x - 0.032f, eyesCentre.y - 0.008f, front - 0.012f);
            Vector3 from = eye + new Vector3(-0.07f, 0.01f, 0.2f);
            bool NoHair(SkinnedMeshRenderer r) => sidecar.MeshNamed(r.name)?.role != "hair";
            foreach (string sh in new[] { "blink_L", "blink_R" }) face?.Set(sh, 1f);
            Screenshot(go, $"Reports/{sidecar.name}_eye_closed.png", from, eye, 20f, 512, 384, NoHair);
            face?.ResetAll();
            Screenshot(go, $"Reports/{sidecar.name}_eye_open.png", from, eye, 20f, 512, 384, NoHair);
        }

        static AnimationClip walk;

        /// <summary>A Humanoid walk cycle in muscle space (legs stride, knees bend, arms swing).</summary>
        static AnimationClip WalkClip()
        {
            if (walk != null) return walk;
            var clip = new AnimationClip { name = "PS2CC_Walk", frameRate = 30 };
            void Curve(string muscle, params float[] tv)
            {
                var keys = new Keyframe[tv.Length / 2];
                for (int i = 0; i < keys.Length; i++) keys[i] = new Keyframe(tv[i * 2], tv[i * 2 + 1]);
                AnimationUtility.SetEditorCurve(clip, EditorCurveBinding.FloatCurve("", typeof(Animator), muscle), new AnimationCurve(keys));
            }
            Curve("Left Upper Leg Front-Back", 0, 0.5f, 0.5f, -0.35f, 1, 0.5f);
            Curve("Right Upper Leg Front-Back", 0, -0.35f, 0.5f, 0.5f, 1, -0.35f);
            Curve("Left Lower Leg Stretch", 0, 0.9f, 0.25f, 0.3f, 0.5f, 0.9f, 1, 0.9f);
            Curve("Right Lower Leg Stretch", 0, 0.9f, 0.5f, 0.9f, 0.75f, 0.3f, 1, 0.9f);
            Curve("Left Arm Down-Up", 0, -0.7f, 1, -0.7f);
            Curve("Right Arm Down-Up", 0, -0.7f, 1, -0.7f);
            Curve("Left Arm Front-Back", 0, -0.25f, 0.5f, 0.25f, 1, -0.25f);
            Curve("Right Arm Front-Back", 0, 0.25f, 0.5f, -0.25f, 1, 0.25f);
            Curve("Left Forearm Stretch", 0, 0.8f, 1, 0.8f);
            Curve("Right Forearm Stretch", 0, 0.8f, 1, 0.8f);
            Curve("Spine Twist Left-Right", 0, 0.1f, 0.5f, -0.1f, 1, 0.1f);
            Curve("Head Turn Left-Right", 0, -0.2f, 1, -0.2f);
            const string dir = "Assets/HarnessSettings";
            if (!AssetDatabase.IsValidFolder(dir)) AssetDatabase.CreateFolder("Assets", "HarnessSettings");
            AssetDatabase.CreateAsset(clip, dir + "/PS2CC_Walk.anim");
            walk = clip;
            return clip;
        }

        /// <summary>Largest ratio of a triangle edge's posed length to its rest length (ignoring tiny edges).</summary>
        static float MaxStretch(Mesh rest, Mesh posed)
        {
            var a = rest.vertices;
            var b = posed.vertices;
            var t = rest.triangles;
            float worst = 1;
            for (int i = 0; i < t.Length; i += 3)
            {
                for (int e = 0; e < 3; e++)
                {
                    int p = t[i + e], q = t[i + (e + 1) % 3];
                    float r = (a[p] - a[q]).magnitude;
                    if (r < 0.002f) continue;
                    worst = Mathf.Max(worst, (b[p] - b[q]).magnitude / r);
                }
            }
            return worst;
        }

        static bool warmedUp;

        static void Screenshot(GameObject go, string path) =>
            Screenshot(go, path, new Vector3(1.2f, 1.1f, 4.6f), new Vector3(0, 0.95f, 0), 30f, 768, 1024);

        static void Screenshot(GameObject go, string path, Vector3 eye, Vector3 target, float fov, int width, int height, Func<SkinnedMeshRenderer, bool> include = null)
        {
            var camGo = new GameObject("HarnessCamera");
            var lightGo = new GameObject("HarnessLight");
            // Skinned meshes are not re-skinned for a manual render in the editor, so render baked
            // copies of the current pose instead (the same BakeMesh the stretch check measures).
            var snapshot = new GameObject("HarnessSnapshot");
            var hidden = new List<SkinnedMeshRenderer>();
            foreach (var r in go.GetComponentsInChildren<SkinnedMeshRenderer>())
            {
                if (include != null && !include(r))
                {
                    if (r.enabled)
                    {
                        r.enabled = false;
                        hidden.Add(r);
                    }
                    continue;
                }
                var baked = new Mesh();
                r.BakeMesh(baked, true);
                var part = new GameObject(r.name);
                part.transform.SetParent(snapshot.transform, false);
                part.transform.SetPositionAndRotation(r.transform.position, r.transform.rotation);
                part.AddComponent<MeshFilter>().sharedMesh = baked;
                part.AddComponent<MeshRenderer>().sharedMaterials = r.sharedMaterials;
                if (r.enabled)
                {
                    r.enabled = false;
                    hidden.Add(r);
                }
            }
            try
            {
                var cam = camGo.AddComponent<Camera>();
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0.25f, 0.25f, 0.28f);
                cam.fieldOfView = fov;
                cam.nearClipPlane = 0.02f;
                // The character faces +Z; the camera stands in front of it.
                cam.transform.position = eye;
                cam.transform.LookAt(target);
                var light = lightGo.AddComponent<Light>();
                light.type = LightType.Directional;
                light.transform.rotation = Quaternion.Euler(40, 200, 0);
                RenderSettings.ambientLight = new Color(0.45f, 0.45f, 0.5f);
                var rt = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
                cam.targetTexture = rt;
                cam.Render();
                if (!warmedUp)
                {
                    // The very first render of the run can come out before the materials are ready.
                    cam.Render();
                    warmedUp = true;
                }
                RenderTexture.active = rt;
                var tex = new Texture2D(rt.width, rt.height, TextureFormat.RGB24, false);
                tex.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
                tex.Apply();
                RenderTexture.active = null;
                File.WriteAllBytes(path, tex.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(tex);
                cam.targetTexture = null;
                rt.Release();
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(camGo);
                UnityEngine.Object.DestroyImmediate(lightGo);
                foreach (var f in snapshot.GetComponentsInChildren<MeshFilter>()) UnityEngine.Object.DestroyImmediate(f.sharedMesh);
                UnityEngine.Object.DestroyImmediate(snapshot);
                foreach (var r in hidden) r.enabled = true;
            }
        }

        /// <summary>The harness project uses URP (PRD target); create the pipeline asset if the project has none.</summary>
        static void EnsureUrp()
        {
            if (GraphicsSettings.defaultRenderPipeline is UniversalRenderPipelineAsset) return;
            const string dir = "Assets/HarnessSettings";
            if (!AssetDatabase.IsValidFolder(dir)) AssetDatabase.CreateFolder("Assets", "HarnessSettings");
            var rendererData = ScriptableObject.CreateInstance<UniversalRendererData>();
            AssetDatabase.CreateAsset(rendererData, dir + "/HarnessRenderer.asset");
            var asset = UniversalRenderPipelineAsset.Create(rendererData);
            AssetDatabase.CreateAsset(asset, dir + "/HarnessURP.asset");
            GraphicsSettings.defaultRenderPipeline = asset;
            QualitySettings.renderPipeline = asset;
            AssetDatabase.SaveAssets();
        }
    }
}
