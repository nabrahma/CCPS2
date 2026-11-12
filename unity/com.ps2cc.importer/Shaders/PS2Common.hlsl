// PS2CC shared shader code (PRD 6.4; Part 2 F14, F22). The same lighting model
// as the app's viewport (packages/viewport/src/materials.ts), so what you see
// in PS2CC is what Unity shows:
//
// - Per vertex (Classic): hemisphere ambient, key, fill, flashlight and a
//   fresnel rim, Lambert, summed at the vertices.
// - Per pixel (_PS2_PER_PIXEL; Enhanced, Hero): the same per fragment, wrap
//   diffuse on skin with a warm terminator, a small Blinn-Phong highlight from
//   the material's gloss (Kajiya-Kay strand highlight on hair), key-light
//   shadows from URP's main light shadow map.
//
// Lights come from a PS2Look component in the scene (global _PS2* values, a
// .ps2look file, identical numbers to the app). Without one, the key is URP's
// main light and the ambient its spherical harmonics, as before.
#ifndef PS2CC_COMMON_INCLUDED
#define PS2CC_COMMON_INCLUDED

#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

TEXTURE2D(_BaseMap);
SAMPLER(sampler_BaseMap);
TEXTURE2D(_DirtMask);
SAMPLER(sampler_DirtMask);

CBUFFER_START(UnityPerMaterial)
    float4 _BaseMap_ST;
    half4 _BaseColor;
    half _Cutoff;
    // The app's SOFT_ALPHA_MIN (viewport.ts): softer texels are not drawn at all.
    #define PS2_SOFT_ALPHA_MIN 0.04h
    half _AmbientStrength;
    half4 _RimColor;
    half _RimStrength;
    half _ColorDepth;
    half _TwoSided;
    half4 _DirtColor;
    half _DirtStrength;
    half _Wrap;
    half _Gloss;
    half _Shininess;
    half _Aniso;
    half4 _ScatterColor;
    half _ReceiveShadows;
CBUFFER_END

// Set by PS2Look (Runtime/PS2Look.cs). Directions point towards the light, in world space.
float _PS2LookActive;
float3 _PS2Sky;
float3 _PS2Ground;
float3 _PS2KeyDir;
float3 _PS2KeyColor;
float _PS2UseKey;
float3 _PS2FillDir;
float3 _PS2FillColor;
float3 _PS2SpotPos;
float3 _PS2SpotDir;
float3 _PS2SpotColor;
float4 _PS2SpotParams; // cos outer, cos inner, range, on
float4 _PS2Rim; // colour, strength
float3 _PS2FogColor;
float2 _PS2FogRange; // near, far; far <= near: no fog

struct PS2Attributes
{
    float4 positionOS : POSITION;
    float3 normalOS : NORMAL;
    float2 uv : TEXCOORD0;
    UNITY_VERTEX_INPUT_INSTANCE_ID
};

struct PS2Varyings
{
    float4 positionCS : SV_POSITION;
    float2 uv : TEXCOORD0;
    half3 base : TEXCOORD1;
    half3 key : TEXCOORD2;
    half3 spot : TEXCOORD3;
    float3 positionWS : TEXCOORD4;
    half3 normalWS : TEXCOORD5;
    half fogFactor : TEXCOORD6;
    UNITY_VERTEX_INPUT_INSTANCE_ID
    UNITY_VERTEX_OUTPUT_STEREO
};

half PS2Facing(half3 n, half3 l)
{
    half d = dot(n, l);
    return _TwoSided > 0.5 ? abs(d) : d;
}

// Kept for older custom shaders that include this file.
half PS2Lambert(half3 n, half3 l) { return max(PS2Facing(n, l), 0.0h); }

half3 PS2Diffuse(half3 n, half3 l, half wrap)
{
    half d = PS2Facing(n, l);
    half lam = max(d, 0.0h);
    if (wrap <= 0.0h) return lam.xxx;
    half w = max((d + wrap) / (1.0h + wrap), 0.0h);
    return lam.xxx + _ScatterColor.rgb * max(w - lam, 0.0h);
}

half3 PS2KeyDirection()
{
    return _PS2LookActive > 0.5 ? normalize((half3)_PS2KeyDir) : GetMainLight().direction;
}

half3 PS2KeyColor()
{
    if (_PS2LookActive > 0.5) return _PS2KeyColor * _PS2UseKey;
    Light m = GetMainLight();
    return m.color * m.distanceAttenuation;
}

half3 PS2Hemisphere(half3 n)
{
    if (_PS2LookActive > 0.5) return lerp(_PS2Ground, _PS2Sky, saturate(n.y * 0.5h + 0.5h));
    return SampleSH(n) * _AmbientStrength;
}

half PS2SpotFalloff(float3 world, out half3 ld)
{
    float3 toLight = _PS2SpotPos - world;
    float dist = max(length(toLight), 1e-4);
    ld = (half3)(toLight / dist);
    half cone = smoothstep(_PS2SpotParams.x, _PS2SpotParams.y, dot(-ld, normalize((half3)_PS2SpotDir)));
    half att = saturate(1.0 - dist / _PS2SpotParams.z);
    return _PS2LookActive > 0.5 ? _PS2SpotParams.w * cone * att * att : 0.0h;
}

void PS2LightAt(float3 world, half3 n, half3 view, half wrap, out half3 base, out half3 key, out half3 spot)
{
    base = PS2Hemisphere(n);
    if (_PS2LookActive > 0.5) base += _PS2FillColor * PS2Diffuse(n, normalize((half3)_PS2FillDir), 0.0h);
    half rim = pow(1.0h - saturate(abs(dot(n, view))), 3.0h);
    half3 rimColor = _PS2LookActive > 0.5 ? (half3)_PS2Rim.rgb : _RimColor.rgb;
    half rimStrength = _PS2LookActive > 0.5 ? (half)_PS2Rim.a : _RimStrength;
    base += rimColor * (rimStrength * rim);
    key = PS2KeyColor() * PS2Diffuse(n, PS2KeyDirection(), wrap);
    half3 ld;
    half f = PS2SpotFalloff(world, ld);
    spot = _PS2SpotColor * PS2Diffuse(n, ld, wrap) * f;
}

PS2Varyings PS2Vert(PS2Attributes v)
{
    PS2Varyings o = (PS2Varyings)0;
    UNITY_SETUP_INSTANCE_ID(v);
    UNITY_TRANSFER_INSTANCE_ID(v, o);
    UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
    VertexPositionInputs pos = GetVertexPositionInputs(v.positionOS.xyz);
    VertexNormalInputs nrm = GetVertexNormalInputs(v.normalOS);
    half3 n = normalize(nrm.normalWS);
    o.positionWS = pos.positionWS;
    o.normalWS = n;
    #if !defined(_PS2_PER_PIXEL)
        half3 view = normalize(GetWorldSpaceViewDir(pos.positionWS));
        PS2LightAt(pos.positionWS, n, view, 0.0h, o.base, o.key, o.spot);
    #endif
    o.positionCS = pos.positionCS;
    o.uv = TRANSFORM_TEX(v.uv, _BaseMap);
    o.fogFactor = ComputeFogFactor(pos.positionCS.z);
    return o;
}

half PS2KeyShadow(float3 world)
{
    #if defined(_MAIN_LIGHT_SHADOWS) || defined(_MAIN_LIGHT_SHADOWS_CASCADE) || defined(_MAIN_LIGHT_SHADOWS_SCREEN)
        if (_ReceiveShadows > 0.5) return MainLightRealtimeShadow(TransformWorldToShadowCoord(world));
    #endif
    return 1.0h;
}

// soft: the blended second pass of Hair v2's two-pass alpha (Part 2 F14, F15), which draws the texels
// under the cutoff that the opaque pass left out, with their alpha.
half4 PS2Shade(PS2Varyings i, bool soft)
{
    UNITY_SETUP_INSTANCE_ID(i);
    UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
    half4 tex = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv) * _BaseColor;
    if (soft)
    {
        clip(tex.a - PS2_SOFT_ALPHA_MIN);
        clip(_Cutoff - tex.a - 1e-4);
    }
    #if defined(PS2_CUTOUT)
        else clip(tex.a - _Cutoff);
    #endif
    half3 albedo = tex.rgb;
    #if defined(PS2_DIRT)
        half dirt = SAMPLE_TEXTURE2D(_DirtMask, sampler_DirtMask, i.uv).r * _DirtStrength;
        albedo *= lerp(half3(1, 1, 1), _DirtColor.rgb, dirt);
    #endif
    half3 n = normalize(i.normalWS);
    half3 view = normalize(GetWorldSpaceViewDir(i.positionWS));
    half3 lBase = i.base;
    half3 lKey = i.key;
    half3 lSpot = i.spot;
    #if defined(_PS2_PER_PIXEL)
        PS2LightAt(i.positionWS, n, view, _Wrap, lBase, lKey, lSpot);
    #endif
    half sKey = PS2KeyShadow(i.positionWS);
    half3 c = albedo * (lBase + lKey * sKey + lSpot);
    #if defined(_PS2_PER_PIXEL)
        if (_Gloss > 0.0h)
        {
            half3 t = 0;
            if (_Aniso > 0.5h)
            {
                // Strand direction: where v (root to tip) runs on screen, back in world space.
                float3 dpx = ddx(i.positionWS);
                float3 dpy = ddy(i.positionWS);
                float2 duvx = ddx(i.uv);
                float2 duvy = ddy(i.uv);
                float det = duvx.x * duvy.y - duvx.y * duvy.x;
                t = normalize((dpy * duvx.x - dpx * duvy.x) * sign(det) + 1e-6);
            }
            half3 spotL;
            half spotF = PS2SpotFalloff(i.positionWS, spotL);
            half3 spec = 0;
            [unroll] for (int k = 0; k < 2; k++)
            {
                half3 l = k == 0 ? PS2KeyDirection() : spotL;
                half3 lc = k == 0 ? PS2KeyColor() * sKey : (half3)_PS2SpotColor * spotF;
                if (PS2Facing(n, l) <= 0.0h) continue;
                half3 h = normalize(l + view);
                half s;
                if (_Aniso > 0.5h)
                {
                    half th = dot(t, h);
                    s = pow(sqrt(max(0.0h, 1.0h - th * th)), _Shininess);
                }
                else
                {
                    s = pow(max(abs(dot(n, h)), 0.0h), _Shininess);
                }
                spec += lc * s;
            }
            half3 tintS = _Aniso > 0.5h ? lerp(half3(1, 1, 1), albedo / max(max(albedo.r, albedo.g), max(albedo.b, 1e-3h)), 0.7h) : half3(1, 1, 1);
            // Dark hair keeps a soft sheen: the strand highlight scales with the hair's lightness (as materials.ts).
            half hairK = _Aniso > 0.5h ? 0.25h + 0.75h * min(1.0h, dot(albedo, half3(0.2126h, 0.7152h, 0.0722h)) / 0.35h) : 1.0h;
            c += spec * _Gloss * tintS * hairK;
        }
    #endif
    if (_ColorDepth > 1.0h)
    {
        // Colour-depth reduction in display space (e.g. 32 levels = 15-bit colour).
        half3 s = LinearToSRGB(c);
        s = floor(s * _ColorDepth + 0.5h) / _ColorDepth;
        c = SRGBToLinear(s);
    }
    if (_PS2LookActive > 0.5)
    {
        if (_PS2FogRange.y > _PS2FogRange.x)
        {
            half f = saturate((distance(GetCameraPositionWS(), i.positionWS) - _PS2FogRange.x) / (_PS2FogRange.y - _PS2FogRange.x));
            c = lerp(c, _PS2FogColor, f);
        }
    }
    else
    {
        c = MixFog(c, i.fogFactor);
    }
    return half4(c, soft ? tex.a : 1.0h);
}

half4 PS2Frag(PS2Varyings i) : SV_Target
{
    return PS2Shade(i, false);
}

half4 PS2SoftFrag(PS2Varyings i) : SV_Target
{
    return PS2Shade(i, true);
}

// ---------------------------------------------------------------- shadow caster and depth passes

float3 _LightDirection;

struct PS2DepthVaryings
{
    float4 positionCS : SV_POSITION;
    float2 uv : TEXCOORD0;
    half3 normalWS : TEXCOORD1;
    UNITY_VERTEX_INPUT_INSTANCE_ID
};

PS2DepthVaryings PS2ShadowVert(PS2Attributes v)
{
    PS2DepthVaryings o = (PS2DepthVaryings)0;
    UNITY_SETUP_INSTANCE_ID(v);
    float3 positionWS = TransformObjectToWorld(v.positionOS.xyz);
    float3 normalWS = TransformObjectToWorldNormal(v.normalOS);
    float4 positionCS = TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, _LightDirection));
    #if UNITY_REVERSED_Z
        positionCS.z = min(positionCS.z, UNITY_NEAR_CLIP_VALUE);
    #else
        positionCS.z = max(positionCS.z, UNITY_NEAR_CLIP_VALUE);
    #endif
    o.positionCS = positionCS;
    o.uv = TRANSFORM_TEX(v.uv, _BaseMap);
    return o;
}

PS2DepthVaryings PS2DepthVert(PS2Attributes v)
{
    PS2DepthVaryings o = (PS2DepthVaryings)0;
    UNITY_SETUP_INSTANCE_ID(v);
    o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
    o.uv = TRANSFORM_TEX(v.uv, _BaseMap);
    o.normalWS = TransformObjectToWorldNormal(v.normalOS);
    return o;
}

void PS2Clip(float2 uv)
{
    #if defined(PS2_CUTOUT)
        clip(SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, uv).a * _BaseColor.a - _Cutoff);
    #endif
}

half4 PS2DepthFrag(PS2DepthVaryings i) : SV_Target
{
    PS2Clip(i.uv);
    return 0;
}

half4 PS2DepthNormalsFrag(PS2DepthVaryings i) : SV_Target
{
    PS2Clip(i.uv);
    return half4(NormalizeNormalPerPixel(i.normalWS), 0.0);
}

#endif
