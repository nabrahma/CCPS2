// PS2 Look (PRD 6.4, optional): low internal resolution, 16-bit ordered dither,
// grain and VHS chroma bleed, matching the app's preview toggles. Use it with
// URP's built-in "Full Screen Pass Renderer Feature" (add the feature to your
// URP renderer, set its material to one using this shader).
Shader "PS2/LookFullscreen"
{
    Properties
    {
        _LowRes ("Low resolution height (0 = off)", Float) = 448
        [Toggle] _Dither ("16-bit colour with dither", Float) = 1
        _Grain ("Grain", Range(0, 1)) = 0.05
        _Vhs ("VHS chroma bleed", Range(0, 1)) = 0.15
    }
    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" }
        ZWrite Off
        ZTest Always
        Cull Off
        Pass
        {
            Name "PS2Look"
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.core/Runtime/Utilities/Blit.hlsl"

            float _LowRes;
            float _Dither;
            float _Grain;
            float _Vhs;

            float Bayer4(float2 p)
            {
                float2 c = fmod(floor(p), 4.0);
                float i = c.x + c.y * 4.0;
                float m = fmod(i, 2.0) * 8.0 + fmod(floor(i / 2.0), 2.0) * 4.0 + fmod(floor(i / 4.0), 2.0) * 2.0 + floor(i / 8.0);
                return (m + 0.5) / 16.0;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
                float2 uv = input.texcoord;
                float2 res = _ScreenParams.xy;
                if (_LowRes > 0)
                {
                    res = float2(_LowRes * _ScreenParams.x / _ScreenParams.y, _LowRes);
                    uv = (floor(uv * res) + 0.5) / res;
                }
                half3 c = SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_PointClamp, uv).rgb;
                if (_Vhs > 0)
                {
                    float shift = _Vhs * 2.0 / res.x;
                    c.r = SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv + float2(shift, 0)).r;
                    c.b = SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv - float2(shift, 0)).b;
                }
                half3 s = LinearToSRGB(saturate(c));
                if (_Grain > 0)
                {
                    float n = frac(sin(dot(floor(uv * res) + _Time.y, float2(12.9898, 78.233))) * 43758.5453);
                    s += (n - 0.5) * _Grain * 0.2;
                }
                if (_Dither > 0.5)
                {
                    float levels = 31.0;
                    s = floor(saturate(s) * levels + Bayer4(uv * res)) / levels;
                }
                return half4(SRGBToLinear(saturate(s)), 1.0);
            }
            ENDHLSL
        }
    }
}
