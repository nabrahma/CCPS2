// PS2CC shared shader code (PRD 6.4): vertex-lit Lambert from the URP main light,
// ambient from spherical harmonics, an optional rim term and optional
// colour-depth reduction. The same lighting model as the app's viewport
// (packages/viewport/src/materials.ts), so what you see in PS2CC is what Unity shows.
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
    half _AmbientStrength;
    half4 _RimColor;
    half _RimStrength;
    half _ColorDepth;
    half _TwoSided;
    half4 _DirtColor;
    half _DirtStrength;
CBUFFER_END

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
    half3 light : TEXCOORD1;
    half fogFactor : TEXCOORD2;
    UNITY_VERTEX_INPUT_INSTANCE_ID
    UNITY_VERTEX_OUTPUT_STEREO
};

half PS2Lambert(half3 n, half3 l)
{
    half d = dot(n, l);
    return _TwoSided > 0.5 ? abs(d) : saturate(d);
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
    Light mainLight = GetMainLight();
    half3 light = mainLight.color * (PS2Lambert(n, mainLight.direction) * mainLight.distanceAttenuation);
    light += SampleSH(n) * _AmbientStrength;
    half3 viewDir = normalize(GetWorldSpaceViewDir(pos.positionWS));
    half rim = pow(1.0h - saturate(abs(dot(n, viewDir))), 3.0h);
    light += _RimColor.rgb * (_RimStrength * rim);
    o.light = light;
    o.positionCS = pos.positionCS;
    o.uv = TRANSFORM_TEX(v.uv, _BaseMap);
    o.fogFactor = ComputeFogFactor(pos.positionCS.z);
    return o;
}

half4 PS2Frag(PS2Varyings i) : SV_Target
{
    UNITY_SETUP_INSTANCE_ID(i);
    UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
    half4 tex = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv) * _BaseColor;
    #if defined(PS2_CUTOUT)
        clip(tex.a - _Cutoff);
    #endif
    half3 albedo = tex.rgb;
    #if defined(PS2_DIRT)
        half dirt = SAMPLE_TEXTURE2D(_DirtMask, sampler_DirtMask, i.uv).r * _DirtStrength;
        albedo *= lerp(half3(1, 1, 1), _DirtColor.rgb, dirt);
    #endif
    half3 c = albedo * i.light;
    if (_ColorDepth > 1.0h)
    {
        // Colour-depth reduction in display space (e.g. 32 levels = 15-bit colour).
        half3 s = LinearToSRGB(c);
        s = floor(s * _ColorDepth + 0.5h) / _ColorDepth;
        c = SRGBToLinear(s);
    }
    c = MixFog(c, i.fogFactor);
    return half4(c, 1.0h);
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
