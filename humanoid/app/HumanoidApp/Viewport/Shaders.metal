#include <metal_stdlib>
using namespace metal;

// Matches Uniforms in Renderer.swift, field for field and in order. A mismatch
// here does not fail to build: it silently reads the wrong bytes and the model
// renders somewhere unexpected or not at all.
struct Uniforms {
    float4x4 modelViewProjection;
    float4x4 model;
    float3   cameraPosition;
    float    _pad0;
    float3   lightDirection;   // world space, pointing FROM the light
    float    _pad1;
};

struct VertexIn {
    float3 position [[attribute(0)]];
    float3 normal   [[attribute(1)]];
    float2 uv       [[attribute(2)]];
};

struct VertexOut {
    float4 clipPosition [[position]];
    float3 worldNormal;
    float3 worldPosition;
    float2 uv;
};

vertex VertexOut model_vertex(VertexIn in [[stage_in]],
                              constant Uniforms &uniforms [[buffer(1)]]) {
    VertexOut out;
    out.clipPosition = uniforms.modelViewProjection * float4(in.position, 1.0);
    // The model transform is rigid (identity, in fact), so the normal matrix is
    // just its upper 3x3. If a non-uniform scale is ever introduced this needs
    // the inverse transpose instead.
    out.worldNormal = normalize((uniforms.model * float4(in.normal, 0.0)).xyz);
    out.worldPosition = (uniforms.model * float4(in.position, 1.0)).xyz;
    out.uv = in.uv;
    return out;
}

fragment float4 model_fragment(VertexOut in [[stage_in]],
                               constant Uniforms &uniforms [[buffer(1)]],
                               texture2d<float> albedo [[texture(0)]],
                               sampler albedoSampler [[sampler(0)]]) {
    float3 base = albedo.sample(albedoSampler, in.uv).rgb;
    float3 n = normalize(in.worldNormal);
    float3 l = normalize(-uniforms.lightDirection);
    float3 v = normalize(uniforms.cameraPosition - in.worldPosition);
    float3 h = normalize(l + v);

    // Half-Lambert. Plain N.L makes everything facing away from the key light
    // pure black, which on a sculpting tool means half the model carries no
    // shape information at all — exactly the half you are about to work on.
    float wrapped = dot(n, l) * 0.5 + 0.5;
    float diffuse = wrapped * wrapped;
    float specular = pow(saturate(dot(n, h)), 48.0) * 0.25;

    // A cool rim keeps the silhouette readable against a dark background, which
    // is what tells you the shape of the thing you are pushing around.
    float rim = pow(1.0 - saturate(dot(n, v)), 3.0) * 0.35;

    float3 colour = base * (0.25 + 0.75 * diffuse)
                  + float3(1.0) * specular
                  + float3(0.30, 0.44, 0.55) * rim;
    return float4(colour, 1.0);
}
