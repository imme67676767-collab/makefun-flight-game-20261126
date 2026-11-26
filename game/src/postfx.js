// Hand-rolled post-processing: the vendored three.min.js is the core build
// only (no EffectComposer/UnrealBloomPass), so the chain is built from raw
// render targets and fullscreen-triangle shader passes:
//
//   scene -> HDR target (HalfFloat + depth)
//         -> bright pass (quarter res) -> separable blur x2 (bloom)
//         -> composite: bloom add + depth-based AO-lite + ACES + vignette
//
// Rendering into a target skips three's built-in tone mapping / colour
// conversion, so the composite does ACES and the sRGB encode itself. When
// disabled (low tier, or no float targets) it falls back to a direct
// renderer.render() so the game still looks right.

import { QUALITY } from './config.js';

const THREE = window.THREE;

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BRIGHT_FRAG = /* glsl */`
  uniform sampler2D tSrc;
  uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float k = smoothstep(uThreshold, uThreshold + 0.5, l);
    gl_FragColor = vec4(c * k, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main() {
    vec3 sum = texture2D(tSrc, vUv).rgb * 0.227027;
    sum += texture2D(tSrc, vUv + uDir * 1.3846).rgb * 0.3162162;
    sum += texture2D(tSrc, vUv - uDir * 1.3846).rgb * 0.3162162;
    sum += texture2D(tSrc, vUv + uDir * 3.2308).rgb * 0.0702703;
    sum += texture2D(tSrc, vUv - uDir * 3.2308).rgb * 0.0702703;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */`
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform sampler2D tDepth;
  uniform float uBloomStrength;
  uniform float uAoStrength;
  uniform float uExposure;
  uniform float uNear;
  uniform float uFar;
  uniform vec2 uTexel;
  varying vec2 vUv;

  float viewZ(float depth) {
    // Perspective depth -> view-space Z (negative forward).
    return (uNear * uFar) / ((uFar - uNear) * depth - uFar);
  }

  float aoLite(vec2 uv, float centreZ) {
    // Cheap depth-based occlusion: neighbours closer to the camera than the
    // centre pixel darken it. Radius grows with distance so near geometry
    // keeps detail and far geometry does not shimmer.
    float radius = clamp(-centreZ * 0.012, 1.5, 7.5);
    float occ = 0.0;
    float total = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853981;
      vec2 off = vec2(cos(a), sin(a)) * radius * uTexel;
      float z = viewZ(texture2D(tDepth, uv + off).x);
      float dz = z - centreZ; // >0 when the neighbour is nearer the camera
      float w = 1.0;
      occ += w * clamp(dz * 0.08, 0.0, 1.0) * exp(-abs(dz) * 0.02);
      total += w;
    }
    return clamp(1.0 - (occ / total) * uAoStrength, 0.45, 1.0);
  }

  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  vec3 toSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  void main() {
    vec3 col = texture2D(tScene, vUv).rgb;
    col += texture2D(tBloom, vUv).rgb * uBloomStrength;
    if (uAoStrength > 0.001) {
      float z = viewZ(texture2D(tDepth, vUv).x);
      // Sky (far plane) gets no AO.
      if (z > -uFar * 0.98) col *= aoLite(vUv, z);
    }
    col *= uExposure;
    col = aces(col);
    // Gentle vignette.
    vec2 d = vUv - 0.5;
    float vig = 1.0 - dot(d, d) * 0.42;
    col *= vig;
    gl_FragColor = vec4(toSrgb(col), 1.0);
  }
`;

function makeTarget(w, h, withDepth) {
  const opts = {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace: THREE.LinearSRGBColorSpace,
  };
  if (withDepth) {
    opts.depthTexture = new THREE.DepthTexture(w, h);
    opts.depthTexture.type = THREE.UnsignedIntType;
  }
  return new THREE.WebGLRenderTarget(w, h, opts);
}

export function createPostFx(renderer, scene, camera) {
  const supported = renderer.capabilities.isWebGL2
    && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));

  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quadGeo = new THREE.BufferGeometry();
  quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  quadGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(quadGeo, null);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const brightMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false,
    uniforms: { tSrc: { value: null }, uThreshold: { value: 1.15 } },
  });
  const blurMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } },
  });
  const compMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
    uniforms: {
      tScene: { value: null }, tBloom: { value: null }, tDepth: { value: null },
      uBloomStrength: { value: 0.27 }, uAoStrength: { value: 0.5 },
      uExposure: { value: 1.05 }, uNear: { value: camera.near }, uFar: { value: camera.far },
      uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    },
  });

  let sceneRT = null;
  let brightRT = null;
  let blurA = null;
  let blurB = null;
  let width = 0;
  let height = 0;
  let enabled = false;
  let bloomOn = false;
  let aoOn = false;

  function disposeTargets() {
    for (const rt of [sceneRT, brightRT, blurA, blurB]) {
      if (rt) {
        if (rt.depthTexture) rt.depthTexture.dispose();
        rt.dispose();
      }
    }
    sceneRT = brightRT = blurA = blurB = null;
  }

  function alloc(w, h) {
    disposeTargets();
    width = w;
    height = h;
    sceneRT = makeTarget(w, h, true);
    const bw = Math.max(2, Math.floor(w / 4));
    const bh = Math.max(2, Math.floor(h / 4));
    brightRT = makeTarget(bw, bh, false);
    blurA = makeTarget(bw, bh, false);
    blurB = makeTarget(bw, bh, false);
    compMat.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  function pass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  return {
    get enabled() { return enabled; },

    /** Match the chain to a quality tier (high/medium/low). */
    setQuality(qualityKey) {
      const q = QUALITY[qualityKey] || QUALITY.high;
      enabled = supported && Boolean(q.post);
      bloomOn = enabled && Boolean(q.bloom);
      aoOn = enabled && Boolean(q.ao);
      compMat.uniforms.uBloomStrength.value = bloomOn ? 0.27 : 0;
      compMat.uniforms.uAoStrength.value = aoOn ? 0.5 : 0;
      if (!enabled) disposeTargets();
    },

    setSize(w, h) {
      if (!enabled) return;
      if (w === width && h === height && sceneRT) return;
      alloc(w, h);
    },

    render() {
      if (!enabled) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }
      if (!sceneRT) {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        alloc(Math.max(2, size.x), Math.max(2, size.y));
      }
      // The scene pass must stay linear: this pipeline applies ACES itself.
      const prevToneMapping = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      renderer.toneMapping = prevToneMapping;

      if (bloomOn) {
        brightMat.uniforms.tSrc.value = sceneRT.texture;
        pass(brightMat, brightRT);
        const bw = brightRT.width;
        const bh = brightRT.height;
        blurMat.uniforms.tSrc.value = brightRT.texture;
        blurMat.uniforms.uDir.value.set(1 / bw, 0);
        pass(blurMat, blurA);
        blurMat.uniforms.tSrc.value = blurA.texture;
        blurMat.uniforms.uDir.value.set(0, 1 / bh);
        pass(blurMat, blurB);
        // Second, wider blur pair for a softer halo.
        blurMat.uniforms.tSrc.value = blurB.texture;
        blurMat.uniforms.uDir.value.set(2 / bw, 0);
        pass(blurMat, blurA);
        blurMat.uniforms.tSrc.value = blurA.texture;
        blurMat.uniforms.uDir.value.set(0, 2 / bh);
        pass(blurMat, blurB);
        compMat.uniforms.tBloom.value = blurB.texture;
      } else {
        compMat.uniforms.tBloom.value = brightRT.texture;
      }

      compMat.uniforms.tScene.value = sceneRT.texture;
      compMat.uniforms.tDepth.value = sceneRT.depthTexture;
      compMat.uniforms.uNear.value = camera.near;
      compMat.uniforms.uFar.value = camera.far;
      pass(compMat, null);
    },
  };
}
