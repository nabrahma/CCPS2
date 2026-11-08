// PS2/Cutout (PRD 6.4): PS2/Skin lighting with an alpha clip, double-sided. Hair cards, eyes, brows and lashes.
Shader "PS2/Cutout"
{
    Properties
    {
        [MainTexture] _BaseMap ("Texture", 2D) = "white" {}
        [MainColor] _BaseColor ("Colour", Color) = (1, 1, 1, 1)
        _Cutoff ("Alpha cutoff", Range(0, 1)) = 0.5
        _AmbientStrength ("Ambient strength", Range(0, 2)) = 1
        _RimColor ("Rim colour", Color) = (1, 1, 1, 1)
        _RimStrength ("Rim strength", Range(0, 1)) = 0
        _ColorDepth ("Colour depth levels (0 = off, 32 = 15-bit)", Float) = 0
        [Toggle] _TwoSided ("Two-sided lighting", Float) = 1
        [Enum(UnityEngine.Rendering.CullMode)] _Cull ("Cull", Float) = 0
    }
    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "TransparentCutout" "Queue" = "AlphaTest" }
        Cull [_Cull]

        HLSLINCLUDE
        #define PS2_CUTOUT 1
        #include "PS2Common.hlsl"
        ENDHLSL

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex PS2Vert
            #pragma fragment PS2Frag
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            ENDHLSL
        }

        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }
            ZWrite On
            ZTest LEqual
            ColorMask 0
            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex PS2ShadowVert
            #pragma fragment PS2DepthFrag
            #pragma multi_compile_instancing
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }
            ZWrite On
            ColorMask R
            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex PS2DepthVert
            #pragma fragment PS2DepthFrag
            #pragma multi_compile_instancing
            ENDHLSL
        }

        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode" = "DepthNormals" }
            ZWrite On
            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex PS2DepthVert
            #pragma fragment PS2DepthNormalsFrag
            #pragma multi_compile_instancing
            ENDHLSL
        }
    }
    FallBack Off
}
