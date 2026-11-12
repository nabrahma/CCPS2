using System;
using UnityEngine;

namespace PS2CC
{
    /// <summary>
    /// A PS2CC look in the scene (PRD Part 2, F14 and F22): reads a .ps2look
    /// saved by the app and feeds its lights, ambient and fog to the PS2
    /// shaders as global values, the same numbers the app renders with. The
    /// flashlight follows <see cref="viewCamera"/>; the key light's direction
    /// is copied onto <see cref="keyLight"/> (URP's main light), whose shadow
    /// map the shaders sample. The grade (exposure, filmic curve, LUT,
    /// vignette, grain) goes to every PS2/Grade material, for a Full Screen
    /// Pass renderer feature.
    ///
    /// Directions in the file are in the app's character space; Unity's
    /// importer mirrors X, so they are mirrored here too.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    [AddComponentMenu("PS2CC/PS2 Look")]
    public sealed class PS2Look : MonoBehaviour
    {
        [Tooltip("A .ps2look file saved from PS2CC (Post… → Save look…).")]
        public TextAsset look;

        [Tooltip("The look's LUT (.cube, imported by PS2CC as a 3D texture). Empty: no LUT.")]
        public Texture3D lut;

        [Tooltip("The camera the flashlight is held at. Empty: Camera.main.")]
        public Camera viewCamera;

        [Tooltip("Where the flashlight aims, metres in front of the camera (the app aims at its orbit target).")]
        public float flashlightAim = 2.5f;

        [Tooltip("URP's main directional light. Its rotation follows the look's key light so its shadow map matches.")]
        public Light keyLight;

        [Tooltip("Turn grain off (parity renders compare images without noise).")]
        public bool noGrain;

        [NonSerialized] LookData data;
        [NonSerialized] string parsedFrom;

        [Serializable] public sealed class LightDir { public float[] direction; public float[] color; }
        [Serializable] public sealed class SpotData { public float[] color; public float cosOuter; public float cosInner; public float range; public float[] offset; }
        [Serializable] public sealed class RimData { public float[] color; public float strength; }
        [Serializable] public sealed class LightsData { public float[] sky; public float[] ground; public LightDir key; public LightDir fill; public SpotData spot; public RimData rim; }
        [Serializable] public sealed class FogData { public float[] color; public float near; public float far; }
        [Serializable] public sealed class BloomData { public float strength; public float threshold; public float radius; }
        [Serializable] public sealed class GradeData { public float exposure; public string tonemap; public string lut; public float lutStrength = 1; public BloomData bloom; public float grain; public float vignette; public float chromatic; }
        [Serializable] public sealed class LookData { public string format; public string id; public string label; public LightsData lights; public FogData fog; public GradeData grade; public float[] background; }

        /// <summary>The parsed look (null without a file).</summary>
        public LookData Data
        {
            get
            {
                if (look == null) return null;
                if (data == null || !ReferenceEquals(parsedFrom, look.text))
                {
                    data = JsonUtility.FromJson<LookData>(look.text);
                    parsedFrom = look.text;
                    if (data == null || data.format != "ps2cc.look/1") Debug.LogError($"PS2CC: {look.name} is not a PS2CC look");
                }
                return data;
            }
        }

        static bool Has(float[] a) => a != null && a.Length >= 3;
        static Vector4 Rgb(float[] a) => Has(a) ? new Vector4(a[0], a[1], a[2], 0) : Vector4.zero;
        /// <summary>App character space to Unity: X mirrored.</summary>
        public static Vector3 ToUnity(float[] a) => Has(a) ? new Vector3(-a[0], a[1], a[2]) : Vector3.zero;

        void OnEnable() => Apply();
        void LateUpdate() => Apply();

        void OnDisable()
        {
            Shader.SetGlobalFloat("_PS2LookActive", 0);
            Shader.SetGlobalFloat("_PS2GradeOn", 0);
        }

        /// <summary>Push the look into the shader globals (called every frame; call after moving the camera).</summary>
        public void Apply()
        {
            LookData d = Data;
            if (d == null || d.lights == null)
            {
                OnDisable();
                return;
            }
            LightsData l = d.lights;
            Shader.SetGlobalFloat("_PS2LookActive", 1);
            Shader.SetGlobalVector("_PS2Sky", Rgb(l.sky));
            Shader.SetGlobalVector("_PS2Ground", Has(l.ground) ? Rgb(l.ground) : Rgb(l.sky));
            bool key = l.key != null && Has(l.key.direction);
            Vector3 keyDir = key ? ToUnity(l.key.direction).normalized : Vector3.up;
            Shader.SetGlobalVector("_PS2KeyDir", keyDir);
            Shader.SetGlobalVector("_PS2KeyColor", key ? Rgb(l.key.color) : Vector4.zero);
            Shader.SetGlobalFloat("_PS2UseKey", key ? 1 : 0);
            bool fill = l.fill != null && Has(l.fill.direction);
            Shader.SetGlobalVector("_PS2FillDir", fill ? ToUnity(l.fill.direction).normalized : Vector3.up);
            Shader.SetGlobalVector("_PS2FillColor", fill ? Rgb(l.fill.color) : Vector4.zero);
            if (keyLight != null && key) keyLight.transform.rotation = Quaternion.LookRotation(-keyDir, Mathf.Abs(keyDir.y) > 0.99f ? Vector3.forward : Vector3.up);

            Camera cam = viewCamera != null ? viewCamera : Camera.main;
            bool spot = l.spot != null && Has(l.spot.color) && cam != null;
            if (spot)
            {
                Transform t = cam.transform;
                float[] o = Has(l.spot.offset) ? l.spot.offset : new float[] { 0, 0, 0 };
                // Camera space offset: +x right, +y up, +z back (the app's convention; a camera's right is not mirrored).
                Vector3 pos = t.position + t.right * o[0] + t.up * o[1] - t.forward * o[2];
                Vector3 aim = t.position + t.forward * flashlightAim;
                Shader.SetGlobalVector("_PS2SpotPos", pos);
                Shader.SetGlobalVector("_PS2SpotDir", (aim - pos).normalized);
                Shader.SetGlobalVector("_PS2SpotColor", Rgb(l.spot.color));
                Shader.SetGlobalVector("_PS2SpotParams", new Vector4(l.spot.cosOuter, l.spot.cosInner, Mathf.Max(0.01f, l.spot.range), 1));
            }
            else
            {
                Shader.SetGlobalVector("_PS2SpotParams", new Vector4(0.9f, 0.95f, 10, 0));
                Shader.SetGlobalVector("_PS2SpotColor", Vector4.zero);
            }
            Vector4 rim = l.rim != null ? Rgb(l.rim.color) : Vector4.zero;
            rim.w = l.rim != null ? l.rim.strength : 0;
            Shader.SetGlobalVector("_PS2Rim", rim);
            bool fog = d.fog != null && Has(d.fog.color) && d.fog.far > d.fog.near;
            Shader.SetGlobalVector("_PS2FogColor", fog ? Rgb(d.fog.color) : Vector4.zero);
            Shader.SetGlobalVector("_PS2FogRange", fog ? new Vector4(d.fog.near, d.fog.far, 0, 0) : Vector4.zero);

            GradeData g = d.grade ?? new GradeData();
            Shader.SetGlobalFloat("_PS2GradeOn", 1);
            Shader.SetGlobalFloat("_PS2GradeExposure", g.exposure);
            Shader.SetGlobalFloat("_PS2GradeTonemap", g.tonemap == "filmic" ? 1 : 0);
            bool hasLut = lut != null && !string.IsNullOrEmpty(g.lut);
            Shader.SetGlobalFloat("_PS2GradeHasLut", hasLut ? 1 : 0);
            if (hasLut)
            {
                Shader.SetGlobalTexture("_PS2GradeLut", lut);
                Shader.SetGlobalFloat("_PS2GradeLutSize", lut.width);
            }
            Shader.SetGlobalFloat("_PS2GradeLutStrength", g.lutStrength);
            Shader.SetGlobalFloat("_PS2GradeVignette", g.vignette);
            Shader.SetGlobalFloat("_PS2GradeGrain", noGrain ? 0 : g.grain);
            Shader.SetGlobalFloat("_PS2GradeChromatic", g.chromatic);
        }

        /// <summary>The look's background colour (linear), for a camera's clear colour.</summary>
        public Color Background
        {
            get
            {
                LookData d = Data;
                return d != null && Has(d.background) ? new Color(d.background[0], d.background[1], d.background[2], 1) : Color.black;
            }
        }
    }
}
