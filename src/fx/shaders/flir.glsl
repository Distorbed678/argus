vec3 ironbow(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.0, 0.0, 0.05);
  vec3 b = vec3(0.35, 0.0, 0.55);
  vec3 c = vec3(0.9, 0.15, 0.25);
  vec3 d = vec3(1.0, 0.65, 0.0);
  vec3 e = vec3(1.0, 1.0, 0.85);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.5) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.5) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 px = 1.0 / vec2(textureSize(colorTexture, 0));
  // slight blur = thermal sensor softness
  vec3 s = texture(colorTexture, uv).rgb * 0.4
    + texture(colorTexture, uv + vec2(px.x, 0)).rgb * 0.15 + texture(colorTexture, uv - vec2(px.x, 0)).rgb * 0.15
    + texture(colorTexture, uv + vec2(0, px.y)).rgb * 0.15 + texture(colorTexture, uv - vec2(0, px.y)).rgb * 0.15;
  float l = luma(s);
  // warm-ish surfaces (reds, bright) read hotter than blues
  float heat = clamp(l * 1.3 + (s.r - s.b) * 0.35, 0.0, 1.0);
  out_FragColor = vec4(ironbow(heat) * (0.75 + 0.25 * vignette(uv)), 1.0);
}
