void main() {
  vec2 uv = v_textureCoordinates;
  float l = luma(texture(colorTexture, uv).rgb);
  l = pow(clamp(l * 1.9, 0.0, 1.0), 0.75);
  float n = hash(uv * 900.0 + u_time) * 0.18;
  float scan = 0.88 + 0.12 * sin(uv.y * 1400.0);
  vec3 col = vec3(0.12, 1.0, 0.35) * (l + n) * scan * vignette(uv);
  out_FragColor = vec4(col, 1.0);
}
