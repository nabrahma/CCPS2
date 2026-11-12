// PS2 Grade (PRD Part 2, F14 and F22): the app's grade after the scene,
// driven by a PS2Look component: exposure, filmic tone mapping (ACES fit,
// the same curve as the app), the look's 3D LUT in display space, chromatic
// aberration, vignette and grain. Use it with URP's "Full Screen Pass
// Renderer Feature" (injection point: before post-processing, or after it
// with URP's own tonemapping off). Bloom is left to URP's Bloom override.
Shader "PS2/Grade"
{
    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" }
        ZWrite Off
        ZTest Always
        Cull Off
        Pass
        {
            Name "PS2Grade"
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.core/Runtime/Utilities/Blit.hlsl"

            float _PS2GradeOn;
            float _PS2GradeExposure;
            float _PS2GradeTonemap;
            float _PS2GradeHasLut;
            float _PS2GradeLutSize;
            float _PS2GradeLutStrength;
            float _PS2GradeVignette;
            float _PS2GradeGrain;
            float _PS2GradeChromatic;
            TEXTURE3D(_PS2GradeLut);
            SAMPLER(sampler_PS2GradeLut);

            float3 Filmic(float3 x)
            {
                return saturate((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
            }

            float Hash(float2 p)
            {
                return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
            }

            half4 Frag(Varyings input) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
                float2 uv = input.texcoord;
                float4 src = SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv);
                if (_PS2GradeOn < 0.5) return src;
                float3 c = src.rgb;
                if (_PS2GradeChromatic > 0)
                {
                    float2 off = (uv - 0.5) * _PS2GradeChromatic / 1080.0 * 2.0;
                    c.r = SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv + off).r;
                    c.b = SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv - off).b;
                }
                c *= exp2(_PS2GradeExposure);
                if (_PS2GradeTonemap > 0.5) c = Filmic(c);
                float3 s = LinearToSRGB(saturate(c));
                if (_PS2GradeHasLut > 0.5)
                {
                    float3 at = s * ((_PS2GradeLutSize - 1.0) / _PS2GradeLutSize) + 0.5 / _PS2GradeLutSize;
                    s = lerp(s, SAMPLE_TEXTURE3D(_PS2GradeLut, sampler_PS2GradeLut, at).rgb, _PS2GradeLutStrength);
                }
                if (_PS2GradeVignette > 0)
                {
                    float d = length((uv - 0.5) * float2(1.0, 0.85)) * 1.4;
                    s *= 1.0 - _PS2GradeVignette * smoothstep(0.35, 1.0, d);
                }
                if (_PS2GradeGrain > 0)
                {
                    float2 px = uv * _ScreenParams.xy;
                    s += (Hash(px + frac(_Time.y) * 91.7) - 0.5) * 0.14 * _PS2GradeGrain;
                }
                return half4(SRGBToLinear(saturate(s)), src.a);
            }
            ENDHLSL
        }
    }
}
