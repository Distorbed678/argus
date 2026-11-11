void main() {
  vec2 uv = v_textureCoordinates;
  vec2 px = 1.0 / vec2(textureSize(colorTexture, 0));
  float tl = luma(texture(colorTexture, uv + px * vec2(-1, 1)).rgb);
  float t  = luma(texture(colorTexture, uv + px * vec2(0, 1)).rgb);
  float tr = luma(texture(colorTexture, uv + px * vec2(1, 1)).rgb);
  float l  = luma(texture(colorTexture, uv + px * vec2(-1, 0)).rgb);
  float r  = luma(texture(colorTexture, uv + px * vec2(1, 0)).rgb);
  float bl = luma(texture(colorTexture, uv + px * vec2(-1, -1)).rgb);
  float b  = luma(texture(colorTexture, uv + px * vec2(0, -1)).rgb);
  float br = luma(texture(colorTexture, uv + px * vec2(1, -1)).rgb);
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -bl - 2.0 * b - br + tl + 2.0 * t + tr;
  float e = clamp(length(vec2(gx, gy)) * 2.2, 0.0, 1.0);
  vec3 base = texture(colorTexture, uv).rgb;
  vec3 col = vec3(luma(base)) * vec3(0.05, 0.12, 0.22) + vec3(0.25, 0.8, 1.0) * e;
  out_FragColor = vec4(col, 1.0);
}
