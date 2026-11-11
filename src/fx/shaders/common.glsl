uniform sampler2D colorTexture;
uniform float u_time;
in vec2 v_textureCoordinates;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float vignette(vec2 uv) { vec2 d = uv - 0.5; return clamp(1.0 - dot(d, d) * 1.6, 0.0, 1.0); }
