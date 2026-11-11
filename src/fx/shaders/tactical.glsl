void main() {
  vec2 uv = v_textureCoordinates;
  vec3 c = texture(colorTexture, uv).rgb;
  float l = luma(c);
  vec3 blue = vec3(0.12, 0.55, 1.0) * pow(l, 0.85) * 1.35 + vec3(0.0, 0.02, 0.06);
  out_FragColor = vec4(mix(blue, c, 0.18) * (0.8 + 0.2 * vignette(uv)), 1.0);
}
