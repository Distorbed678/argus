void main() {
  vec2 uv = v_textureCoordinates;
  vec2 d = uv - 0.5;
  uv = 0.5 + d * (1.0 + dot(d, d) * 0.12); // barrel
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { out_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float off = 0.0018;
  float r = texture(colorTexture, uv + vec2(off, 0.0)).r;
  float g = texture(colorTexture, uv).g;
  float b = texture(colorTexture, uv - vec2(off, 0.0)).b;
  vec3 col = vec3(r, g, b);
  float scan = 0.78 + 0.22 * sin(uv.y * 1200.0 + u_time * 8.0);
  float mask = 0.92 + 0.08 * sin(uv.x * 2400.0);
  col = mix(col, vec3(luma(col)) * vec3(0.55, 0.85, 1.25), 0.45);
  out_FragColor = vec4(col * scan * mask * vignette(uv) * 1.15, 1.0);
}
