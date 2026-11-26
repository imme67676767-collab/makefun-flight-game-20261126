// The aeroplane: a Sukhoi Su-26M-style aerobatic prop plane built from
// lathe and lofted geometry, and the flight model that moves it.
//
// The model is all procedural: a lathe-turned fuselage with painted
// cheatlines, an airfoil-lofted wing, a three-blade prop with a spinner,
// fixed spatted gear, and a proper cockpit — panel with live needles, a
// stick that follows the pilot's hand, canopy framing — for first-person
// flight. Everything in the flight model is smoothed: throttle, pitch and
// roll ease toward what the pilot asks for, a released stick drifts back
// to level, and the turn comes from the bank. Nothing snaps.

import { COLORS, FLIGHT, WORLD } from './config.js';

const THREE = window.THREE;

/** A canvas texture drawn by a callback: cheatlines, gauge faces, signs. */
function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function std(color, roughness = 0.55, metalness = 0.12) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** */
function airfoilPoints(chord, thick) {
  const pts = [];
  const n = 14; // 28 outline points: smooth enough to read as a real section
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const yt = 5 * thick * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t * t * t - 0.1015 * t * t * t * t);
    pts.push([t * chord, yt * chord]);
  }
  for (let i = n - 1; i >= 1; i--) {
    const t = i / n;
    const yt = 5 * thick * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t * t * t - 0.1015 * t * t * t * t);
    pts.push([t * chord, -yt * chord]);
  }
  return pts;
}

function loftWing(sections) {
  const outlines = sections.map((s) => airfoilPoints(s.chord, s.thick));
  const ringSize = outlines[0].length;
  const positions = [];
  const indices = [];
  sections.forEach((s, si) => {
    for (const [cx, cy] of outlines[si]) positions.push(s.x, s.y + cy, s.z + cx);
  });
  // Sections must run toward +X so the winding faces outward.
  for (let si = 0; si < sections.length - 1; si++) {
    for (let i = 0; i < ringSize; i++) {
      const a = si * ringSize + i;
      const b = si * ringSize + ((i + 1) % ringSize);
      const c = a + ringSize;
      const d = b + ringSize;
      indices.push(a, b, c, b, d, c);
    }
  }
  // Cap both ends with fans.
  const first = sections[0];
  const firstCentre = positions.length / 3;
  positions.push(first.x, first.y, first.z + first.chord / 2);
  for (let i = 0; i < ringSize; i++) indices.push(((i + 1) % ringSize), i, firstCentre);
  const tipStart = (sections.length - 1) * ringSize;
  const tip = sections[sections.length - 1];
  const tipCentre = positions.length / 3;
  positions.push(tip.x, tip.y, tip.z + tip.chord / 2);
  for (let i = 0; i < ringSize; i++) indices.push(tipStart + i, tipStart + ((i + 1) % ringSize), tipCentre);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Fuselage paint: white, blue cheatlines with a red pinstripe, panel lines, roundels, registration. */
function fuselageTexture(colors = { body: '#f4f6f8', trim: '#2456c8', accent: '#e8452c' }) {
  return canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = colors.body;
    ctx.fillRect(0, 0, w, h);
    // u wraps around the body: sides sit near u=0.25 and u=0.75.
    for (const u of [0.25, 0.75]) {
      const x = u * w;
      ctx.fillStyle = colors.trim;
      ctx.fillRect(x - 26, 0, 52, h);
      ctx.fillStyle = colors.accent;
      ctx.fillRect(x - 34, 0, 8, h);
      ctx.fillRect(x + 26, 0, 8, h);
      // Roundel on the rear fuselage.
      ctx.beginPath();
      ctx.arc(x, h * 0.78, 34, 0, Math.PI * 2);
      ctx.fillStyle = colors.trim;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, h * 0.78, 20, 0, Math.PI * 2);
      ctx.fillStyle = colors.body;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, h * 0.78, 10, 0, Math.PI * 2);
      ctx.fillStyle = colors.accent;
      ctx.fill();
      // Registration letters ahead of the tail, reading nose-to-tail.
      ctx.save();
      ctx.translate(x, h * 0.6);
      ctx.rotate(Math.PI / 2);
      ctx.font = 'bold 30px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = colors.trim;
      ctx.fillText('SRR-26', 0, 10);
      ctx.restore();
    }
    // Panel lines running around the body at a few stations, with a
    // rivet row dotted along each seam.
    ctx.fillStyle = 'rgba(40,50,66,0.35)';
    for (const v of [0.18, 0.38, 0.55, 0.7, 0.86]) ctx.fillRect(0, v * h, w, 3);
    ctx.fillStyle = 'rgba(40,50,66,0.3)';
    for (const v of [0.18, 0.38, 0.55, 0.7, 0.86]) {
      for (let x = 6; x < w; x += 16) ctx.fillRect(x, v * h + 6, 2.4, 2.4);
    }
    // Longitudinal seams with rivets along the spine and belly.
    for (const u of [0.0, 0.5]) {
      const x = u * w;
      ctx.fillStyle = 'rgba(40,50,66,0.22)';
      ctx.fillRect(x - 1, 0, 2, h);
      ctx.fillStyle = 'rgba(40,50,66,0.28)';
      for (let y = 8; y < h; y += 18) ctx.fillRect(x + 4, y, 2.2, 2.2);
    }
    // Oil and exhaust streaks streaming back from the cowling (canvas top
    // is the nose), plus a faint soot wash low on the rear fuselage.
    for (const u of [0.25, 0.75]) {
      const x = u * w;
      for (let i = 0; i < 7; i++) {
        const sx = x + (i - 3) * 13 + (i % 3) * 4;
        const len = 60 + (i % 4) * 26;
        const g = ctx.createLinearGradient(0, h * 0.02, 0, h * 0.02 + len);
        g.addColorStop(0, 'rgba(30,28,26,0.34)');
        g.addColorStop(1, 'rgba(30,28,26,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx, h * 0.02, 5, len);
      }
    }
    // Light wear: sparse speckle so the paint never reads factory-fresh.
    for (let i = 0; i < 700; i++) {
      const a = Math.random() * 0.07;
      ctx.fillStyle = Math.random() < 0.5 ? `rgba(60,64,70,${a})` : `rgba(255,255,255,${a})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // Cowling band near the nose.
    ctx.fillStyle = colors.trim;
    ctx.fillRect(0, h * 0.045, w, 20);
  });
}

/** The instrument panel face: altimeter, speed, tachometer, fuel, tell-tales. */
function panelTexture() {
  return canvasTexture(1024, 300, (ctx, w, h) => {
    ctx.fillStyle = '#1b2129';
    ctx.fillRect(0, 0, w, h);
    const gauges = [
      { x: 110, label: 'ALT', sub: 'm' },
      { x: 300, label: 'KM/H', sub: '' },
      { x: 690, label: 'RPM', sub: 'x100' },
      { x: 880, label: 'FUEL', sub: '' },
    ];
    for (const g of gauges) {
      ctx.beginPath();
      ctx.arc(g.x, 118, 82, 0, Math.PI * 2);
      ctx.fillStyle = '#0d1117';
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#8fa5bd';
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(g.x + Math.sin(a) * 64, 118 - Math.cos(a) * 64);
        ctx.lineTo(g.x + Math.sin(a) * 74, 118 - Math.cos(a) * 74);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#dfe9f2';
        ctx.stroke();
      }
      if (g.label === 'RPM' || g.label === 'FUEL') {
        ctx.beginPath();
        ctx.arc(g.x, 118, 69, Math.PI * 0.75, Math.PI * 1.05);
        ctx.lineWidth = 7;
        ctx.strokeStyle = g.label === 'RPM' ? '#e8452c' : '#ffb84d';
        ctx.stroke();
      }
      ctx.fillStyle = '#9fc6ee';
      ctx.font = 'bold 21px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(g.label, g.x, 168);
      if (g.sub) {
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillText(g.sub, g.x, 188);
      }
    }
    // Bezel ring where the 3D artificial-horizon ball sits.
    ctx.beginPath();
    ctx.arc(495, 118, 84, 0, Math.PI * 2);
    ctx.fillStyle = '#0d1117';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#8fa5bd';
    ctx.stroke();
    ctx.fillStyle = '#9fc6ee';
    ctx.font = 'bold 21px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HORIZON', 495, 232);
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(380 + i * 52, 262, 9, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? '#ffb84d' : '#52e07a';
      ctx.fill();
    }
    ctx.fillStyle = '#5a6b80';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('SKY RING RUNNER', 880, 262);
  });
}

/** Compass card face: cardinal letters and degree ticks on a dark disc. */
function compassTexture() {
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#141a21';
    ctx.beginPath();
    ctx.arc(128, 128, 126, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8fa5bd';
    ctx.lineWidth = 4;
    ctx.stroke();
    const cards = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 15) {
      const a = (d * Math.PI) / 180;
      const long = d % 45 === 0;
      ctx.beginPath();
      ctx.moveTo(128 + Math.sin(a) * (long ? 96 : 106), 128 - Math.cos(a) * (long ? 96 : 106));
      ctx.lineTo(128 + Math.sin(a) * 118, 128 - Math.cos(a) * 118);
      ctx.lineWidth = long ? 4 : 2;
      ctx.strokeStyle = '#dfe9f2';
      ctx.stroke();
    }
    for (const [letter, deg] of cards) {
      const a = (deg * Math.PI) / 180;
      ctx.fillStyle = letter === 'N' ? '#ffd97a' : '#dfe9f2';
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.fillText(letter, 128 + Math.sin(a) * 74, 128 - Math.cos(a) * 74);
    }
  });
}

/** Artificial-horizon ball skin: sky over ground with a white horizon line. */
function horizonTexture() {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#3a7bd5';
    ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = '#7a5a38';
    ctx.fillRect(0, h / 2, w, h / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, h / 2 - 2, w, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const f of [0.32, 0.68]) ctx.fillRect(0, h * f, w, 2);
  });
}

/** Watch face: dark dial, minute ticks, hands at ten past ten. */
function watchTexture() {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#10151c';
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(64 + Math.sin(a) * 48, 64 - Math.cos(a) * 48);
      ctx.lineTo(64 + Math.sin(a) * 56, 64 - Math.cos(a) * 56);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#dfe9f2';
      ctx.stroke();
    }
    const hand = (angle, len, width) => {
      ctx.beginPath();
      ctx.moveTo(64, 64);
      ctx.lineTo(64 + Math.sin(angle) * len, 64 - Math.cos(angle) * len);
      ctx.lineWidth = width;
      ctx.strokeStyle = '#f4f6f8';
      ctx.stroke();
    };
    hand(-0.9, 32, 6); // hour
    hand(1.05, 46, 4); // minute
    ctx.beginPath();
    ctx.arc(64, 64, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd97a';
    ctx.fill();
  });
}

/** Leather watch strap: dark brown with cream stitching along both edges. */
function strapTexture() {
  return canvasTexture(128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#3a2417';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2e1c11';
    for (let i = 0; i < 300; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    ctx.strokeStyle = '#d9c8a8';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.lineTo(w, 7);
    ctx.moveTo(0, h - 7);
    ctx.lineTo(w, h - 7);
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

/** A needle pivoted at its tail, so rotation.z reads as a gauge sweep. */
function makeNeedle(color) {
  const geo = new THREE.BoxGeometry(0.028, 0.26, 0.012);
  geo.translate(0, 0.1, 0);
  const needle = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
  return needle;
}

/** Skin: fair, slight sheen for a hint of subsurface warmth. */
function skinMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xf3cdaa, roughness: 0.52, sheen: 0.5,
    sheenColor: new THREE.Color(0xffd9c0), sheenRoughness: 0.6,
  });
}

/** */
function buildFinger(skin, lengths, radii, curls) {
  const root = new THREE.Group();
  let parent = root;
  lengths.forEach((len, i) => {
    const joint = new THREE.Group();
    if (i > 0) joint.position.y = -lengths[i - 1];
    joint.rotation.x = curls[i];
    const seg = new THREE.Mesh(new THREE.CapsuleGeometry(radii[i], len, 3, 8), skin);
    seg.position.y = -len / 2;
    seg.castShadow = true;
    joint.add(seg);
    if (i === lengths.length - 1) {
      const nail = new THREE.Mesh(
        new THREE.SphereGeometry(radii[i] * 0.92, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xf6d9cf, roughness: 0.35 }),
      );
      nail.scale.set(0.85, 0.32, 1.15);
      nail.position.set(0, -len * 0.82, -radii[i] * 0.72);
      joint.add(nail);
    }
    parent.add(joint);
    parent = joint;
  });
  return root;
}

/** */
function buildHand() {
  const hand = new THREE.Group();
  const skin = skinMaterial();

  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), skin);
  palm.scale.set(0.082, 0.027, 0.075);
  palm.position.set(0, 0.052, 0.055);
  palm.rotation.x = 0.45;
  palm.castShadow = true;
  hand.add(palm);
  // Thenar (thumb mound) bulge on the thumb side.
  const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skin);
  mound.scale.set(0.034, 0.026, 0.055);
  mound.position.set(0.052, 0.032, 0.02);
  mound.rotation.x = 0.5;
  hand.add(mound);

  // Four fingers from pinky (-X) to index (+X), middle longest.
  const fingers = [
    { x: -0.047, lens: [0.034, 0.024, 0.02], curls: [0.35, 0.85, 0.6] },
    { x: -0.016, lens: [0.043, 0.031, 0.024], curls: [0.4, 0.85, 0.6] },
    { x: 0.016, lens: [0.046, 0.033, 0.026], curls: [0.4, 0.8, 0.55] },
    { x: 0.047, lens: [0.042, 0.03, 0.024], curls: [0.35, 0.8, 0.55] },
  ];
  for (const f of fingers) {
    const finger = buildFinger(skin, f.lens, [0.012, 0.011, 0.0098], f.curls);
    finger.position.set(f.x, 0.075, -0.038);
    finger.rotation.x = 0.15;
    hand.add(finger);
  }
  // Thumb wraps the +X face of the grip.
  const thumb = buildFinger(skin, [0.04, 0.032], [0.0115, 0.0105], [0.35, 0.55]);
  thumb.position.set(0.058, 0.035, -0.005);
  thumb.rotation.set(0.15, -0.55, -0.35);
  hand.add(thumb);

  // Wrist and forearm running back-down toward the pilot's lap.
  const arm = new THREE.Group();
  arm.position.set(0, 0.045, 0.1);
  arm.rotation.x = 1.95;
  const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.029, 0.09, 4, 10), skin);
  wrist.position.y = 0.05;
  wrist.castShadow = true;
  arm.add(wrist);
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.04, 0.22, 10), skin);
  forearm.position.y = 0.2;
  arm.add(forearm);
  // Black jacket sleeve with a cuff edge.
  const sleeveMat = std(0x14161a, 0.9);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.056, 0.34, 12), sleeveMat);
  sleeve.position.y = 0.42;
  arm.add(sleeve);
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 8, 16), sleeveMat);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.y = 0.26;
  arm.add(cuff);
  // The watch: stitched leather strap, dark case, metal buckle.
  const strap = new THREE.Mesh(
    new THREE.TorusGeometry(0.034, 0.0085, 8, 20),
    new THREE.MeshStandardMaterial({ map: strapTexture(), roughness: 0.75 }),
  );
  strap.rotation.x = Math.PI / 2;
  strap.scale.set(1, 1, 1.5);
  strap.position.y = 0.085;
  arm.add(strap);
  const caseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.009, 18), std(0x1c1f24, 0.35, 0.7));
  caseMesh.rotation.x = Math.PI / 2;
  caseMesh.position.set(0, 0.085, -0.036);
  arm.add(caseMesh);
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.0185, 18),
    new THREE.MeshBasicMaterial({ map: watchTexture() }),
  );
  face.position.set(0, 0.085, -0.0415);
  face.rotation.y = Math.PI;
  arm.add(face);
  const buckle = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0035, 6, 12), std(0xb9c2cc, 0.3, 0.8));
  buckle.position.set(0.036, 0.085, 0);
  buckle.rotation.y = Math.PI / 2;
  arm.add(buckle);
  hand.add(arm);

  return hand;
}

/** A simpler right hand resting on the throttle knob (no watch, fewer parts). */
function buildThrottleHand() {
  const hand = new THREE.Group();
  const skin = skinMaterial();
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skin);
  palm.scale.set(0.078, 0.032, 0.09);
  palm.position.set(0, 0.03, 0.03);
  palm.rotation.x = 0.45;
  palm.castShadow = true;
  hand.add(palm);
  const fingerXs = [-0.045, -0.015, 0.015, 0.045];
  const fingerLens = [0.03, 0.04, 0.043, 0.039];
  fingerXs.forEach((x, i) => {
    const finger = buildFinger(skin, [fingerLens[i], fingerLens[i] * 0.72], [0.0105, 0.0095], [0.7, 0.8]);
    finger.position.set(x, 0.028, -0.032);
    finger.rotation.x = 0.3;
    hand.add(finger);
  });
  const thumb = buildFinger(skin, [0.038, 0.03], [0.0115, 0.0105], [0.4, 0.5]);
  thumb.position.set(-0.055, 0.02, 0);
  thumb.rotation.set(0.1, 0.5, 0.35);
  hand.add(thumb);
  const arm = new THREE.Group();
  arm.position.set(0, 0.02, 0.09);
  arm.rotation.x = 2.05;
  const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.029, 0.09, 4, 10), skin);
  wrist.position.y = 0.05;
  arm.add(wrist);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.056, 0.36, 12), std(0x14161a, 0.9));
  sleeve.position.y = 0.3;
  arm.add(sleeve);
  hand.add(arm);
  return hand;
}

/** */
function buildCockpit() {
  const group = new THREE.Group();

  const panelMat = new THREE.MeshStandardMaterial({
    map: panelTexture(), roughness: 0.85,
    // A whisper of self-light + sky reflection so the panel never reads
    // dead black in shadow; the gauge faces stay legible either way.
    emissive: 0x11151c, emissiveIntensity: 1,
  });
  panelMat.userData.envI = 0.6;
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.58, 0.09),
    panelMat,
  );
  panel.position.set(0, 0.64, -1.48);
  panel.rotation.x = -0.28;
  group.add(panel);

  // Glareshield hood over the panel: a slim brow hugging the panel top,
  // narrow and shallow so it never bands across the forward view.
  const shield = mesh(new THREE.BoxGeometry(1.3, 0.04, 0.14), std(0x2e3540, 0.9), 0, 0.93, -1.47);
  // Soft cockpit fill: a short-range warm light so the panel, stick and
  // hands keep modelling when the sun is behind the plane.
  const fill = new THREE.PointLight(0xffe6c0, 0.55, 3.4, 1.6);
  fill.position.set(0, 1.05, -1.05);
  group.add(fill);
  shield.rotation.x = -0.28;
  group.add(shield);

  const needles = {};
  const gaugeX = { alt: -0.609, speed: -0.321, rpm: 0.269, fuel: 0.557 };
  for (const [name, x] of Object.entries(gaugeX)) {
    const needle = makeNeedle(name === 'speed' ? 0xffd97a : 0xffffff);
    needle.scale.setScalar(0.55);
    needle.position.set(x, 0.70, -1.415);
    needle.rotation.x = -0.28;
    group.add(needle);
    needles[name] = needle;
  }

  // Artificial horizon: a gyro ball that stays level with the real horizon,
  // with a fixed aircraft symbol in front of it.
  const horizonBall = new THREE.Mesh(
    new THREE.SphereGeometry(0.105, 24, 16),
    new THREE.MeshStandardMaterial({ map: horizonTexture(), roughness: 0.6 }),
  );
  horizonBall.position.set(-0.026, 0.70, -1.43);
  group.add(horizonBall);
  const symbolMat = new THREE.MeshBasicMaterial({ color: 0xffd97a });
  const symbolBar = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.014, 0.006), symbolMat);
  symbolBar.position.set(-0.026, 0.70, -1.318);
  const symbolDot = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), symbolMat);
  symbolDot.position.set(-0.026, 0.70, -1.318);
  group.add(symbolBar, symbolDot);

  // Compass card on the glareshield, rotating under a fixed lubber line.
  const compassBase = new THREE.Group();
  compassBase.position.set(0, 0.98, -1.48);
  compassBase.rotation.x = -0.5;
  const compassCard = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 0.024, 24),
    [std(0x2b2f36, 0.6), new THREE.MeshStandardMaterial({ map: compassTexture(), roughness: 0.7 }), std(0x2b2f36, 0.6)],
  );
  compassBase.add(compassCard);
  const lubber = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0xffd97a }));
  lubber.position.set(0, 0.02, -0.075);
  compassBase.add(lubber);
  group.add(compassBase);

  // Rear-view mirror on the top frame.
  const mirrorFrame = mesh(new THREE.BoxGeometry(0.36, 0.14, 0.02), std(0x2b2f36, 0.5, 0.3), 0, 1.24, -1.52);
  mirrorFrame.rotation.x = 0.25;
  group.add(mirrorFrame);
  const mirrorFace = new THREE.Mesh(
    new THREE.PlaneGeometry(0.32, 0.11),
    new THREE.MeshBasicMaterial({ map: horizonTexture() }),
  );
  mirrorFace.position.set(0, 1.242, -1.508);
  mirrorFace.rotation.x = 0.25;
  group.add(mirrorFace);

  // Headrest wings at the edges of the view.
  for (const side of [-1, 1]) {
    const wing = mesh(new THREE.BoxGeometry(0.17, 0.24, 0.07), std(0x3a3f47, 0.9), side * 0.42, 0.96, -0.16);
    wing.rotation.y = -side * 0.35;
    group.add(wing);
  }

  // Stick with Bruce's hand on it.
  const stickPivot = new THREE.Group();
  stickPivot.position.set(0, 0.5, -1.02);
  const stickShaft = mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.34, 8), std(0x2b2f36, 0.6), 0, 0.17, 0);
  const grip = mesh(new THREE.BoxGeometry(0.09, 0.18, 0.13), std(0x1d2126, 0.7), 0, 0.38, 0);
  stickPivot.add(stickShaft, grip);
  const hand = buildHand();
  hand.position.set(0, 0.40, 0);
  hand.rotation.set(0.22, -0.45, 0);
  stickPivot.add(hand);
  group.add(stickPivot);

  // Throttle console on the right, lever moving with the throttle, and a
  // simpler right hand resting on the knob.
  const console_ = mesh(new THREE.BoxGeometry(0.17, 0.32, 0.55), std(0x2e3540, 0.85), 0.56, 0.42, -1.02);
  group.add(console_);
  const throttlePivot = new THREE.Group();
  throttlePivot.position.set(0.56, 0.60, -1.02);
  const leverArm = mesh(new THREE.BoxGeometry(0.032, 0.24, 0.032), std(0x39424e, 0.5, 0.3), 0, 0.11, 0);
  const knob = mesh(new THREE.SphereGeometry(0.047, 12, 10), std(0x1d2126, 0.6), 0, 0.25, 0);
  throttlePivot.add(leverArm, knob);
  const throttleHand = buildThrottleHand();
  throttleHand.position.set(0, 0.26, 0);
  throttleHand.rotation.y = 0.6;
  throttlePivot.add(throttleHand);
  group.add(throttlePivot);

  // Canopy framing: two side rails and a front arch, at the view's edges.
  const frameMat = std(0x39424e, 0.5, 0.3);
  for (const side of [-1, 1]) {
    const rail = mesh(new THREE.BoxGeometry(0.05, 0.05, 1.9), frameMat, side * 0.6, 0.82, -0.7);
    rail.rotation.x = 0.1;
    group.add(rail);
  }
  const arch = mesh(new THREE.TorusGeometry(0.58, 0.04, 8, 20, Math.PI), frameMat, 0, 0.68, -1.98);
  group.add(arch);
  const spine = mesh(new THREE.BoxGeometry(0.05, 0.05, 1.7), frameMat, 0, 1.2, -0.65);
  group.add(spine);

  group.visible = false;
  return { group, needles, stickPivot, hand, horizonBall, compassCard, throttlePivot };
}

/** The Su-26M-style aerobatic plane: lathe fuselage, lofted wings, spatted gear. */
/** */
export function buildPlaneModel(planeDef = null) {
  const def = planeDef || {
    colors: { body: COLORS.planeBody, trim: COLORS.planeTrim, accent: COLORS.planeAccent },
    wing: 'mid',
  };
  const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
  const plane = new THREE.Group();
  // Clearcoat paint: glossy lacquer over the colour coat, full-strength
  // sky reflections (userData.envI keeps applyQuality from dimming them).
  const paint = (opts) => {
    const m = new THREE.MeshPhysicalMaterial({
      clearcoat: 0.65, clearcoatRoughness: 0.28, roughness: 0.38, metalness: 0.08, ...opts,
    });
    m.userData.envI = 1.0;
    return m;
  };
  const white = paint({
    map: fuselageTexture({ body: hex(def.colors.body), trim: hex(def.colors.trim), accent: hex(def.colors.accent) }),
  });
  const blue = paint({ color: def.colors.trim });
  const red = paint({ color: def.colors.accent });
  const dark = std(0x2b2f36, 0.6, 0.2);
  const wingY = def.wing === 'low' ? -0.58 : def.wing === 'high' ? 1.15 : 0.02;

  // Fuselage: lathe profile from tail (y=0) to nose, turned onto -Z.
  // Racer: longer and slimmer. Trainer: shorter and fuller.
  const baseProfile = [
    [0.05, 0], [0.2, 0.7], [0.32, 1.7], [0.46, 2.9], [0.6, 4.1],
    [0.72, 5.1], [0.8, 5.9], [0.83, 6.5], [0.78, 7.05], [0.56, 7.32], [0.3, 7.42],
  ];
  const rScale = def.wing === 'low' ? 0.9 : def.wing === 'high' ? 1.1 : 1.0;
  const lScale = def.wing === 'low' ? 1.1 : def.wing === 'high' ? 0.94 : 1.0;
  const profile = baseProfile.map(([r, y]) => new THREE.Vector2(r * rScale, y * lScale));
  // Elliptical section (taller than wide) with a slightly flattened belly,
  // like a real light-aircraft fuselage instead of a round tube. Lathe
  // space: Y is the body axis, X/Z the section; after the -90-degree X
  // rotation Z becomes height, so Z<0 is the belly.
  const shapeSection = (geo) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setX(i, p.getX(i) * 0.95);
      const z = p.getZ(i);
      p.setZ(i, z * (z < 0 ? 0.98 : 1.05));
    }
    geo.computeVertexNormals();
    return geo;
  };
  const fuselage = mesh(shapeSection(new THREE.LatheGeometry(profile, 28)), white);
  fuselage.rotation.x = -Math.PI / 2;
  fuselage.position.z = 3.72 * lScale;
  plane.add(fuselage);

  // Engine cowling: its own shell over the nose stations, in the trim
  // material, so the engine bay reads as a separate panel from the body.
  const cowlProfile = [[0.84, 6.45], [0.79, 7.05], [0.57, 7.32], [0.31, 7.42]]
    .map(([r, y]) => new THREE.Vector2(r * rScale * 1.015, y * lScale));
  const cowling = mesh(shapeSection(new THREE.LatheGeometry(cowlProfile, 28)), blue);
  cowling.rotation.x = -Math.PI / 2;
  cowling.position.z = 3.72 * lScale;
  plane.add(cowling);

  // Cowling intakes and exhaust.
  for (const side of [-1, 1]) {
    const intake = mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 10), dark, side * 0.42, -0.28, -3.62);
    intake.rotation.x = Math.PI / 2;
    plane.add(intake);
  }
  const exhaust = mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.55, 8), std(0x6e6259, 0.5, 0.5), 0.62, -0.55, -2.9);
  exhaust.rotation.set(0.9, 0, 0.5);
  plane.add(exhaust);

  // Canopy: blue glass over a seat and headrest. Racer sits low and sleek,
  // the trainer upright under its high wing.
  const seat = mesh(new THREE.BoxGeometry(0.55, 0.7, 0.5), std(0x3a3f47, 0.9), 0, 0.28, -0.35);
  const headrest = mesh(new THREE.BoxGeometry(0.34, 0.3, 0.16), std(0x2b2f36, 0.9), 0, 0.72, -0.08);
  plane.add(seat, headrest);
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0x3a7bd5, transparent: true, opacity: 0.55, roughness: 0.08, metalness: 0.25, side: THREE.FrontSide,
  });
  canopyMat.userData.envI = 1.4; // glass catches the sky hardest
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 24, 16),
    canopyMat,
  );
  if (def.wing === 'low') {
    canopy.scale.set(0.74, 0.56, 1.42);
    canopy.position.set(0, 0.56, -0.55);
  } else if (def.wing === 'high') {
    canopy.scale.set(0.9, 0.7, 1.4);
    canopy.position.set(0, 0.55, -0.62);
    // Cabane pylon carrying the high wing above the cabin.
    const pylon = mesh(new THREE.BoxGeometry(0.5, 0.42, 1.5), white, 0, 0.95, -1.35);
    plane.add(pylon);
  } else {
    canopy.scale.set(0.82, 0.66, 1.55);
    canopy.position.set(0, 0.66, -0.62);
  }
  canopy.castShadow = true;
  plane.add(canopy);

  // Main wing: airfoil loft, root to tip, slight dihedral, accent tips.
  // Sections always run toward +X so the loft winding faces outward.
  const ailerons = [];
  const flaps = [];
  for (const side of [-1, 1]) {
    const root = { x: side * 0.5, y: wingY, z: -1.45, chord: 1.95, thick: 0.13 };
    const mid = { x: side * 3.0, y: wingY + 0.1, z: -1.35, chord: 1.72, thick: 0.12 };
    const tip = { x: side * 5.45, y: wingY + 0.22, z: -1.22, chord: 1.38, thick: 0.1 };
    const wing = mesh(loftWing(side > 0 ? [root, mid, tip] : [tip, mid, root]), white);
    plane.add(wing);
    const tipCap = mesh(new THREE.BoxGeometry(0.34, 0.14, 1.34), red, side * 5.5, wingY + 0.22, -0.55);
    plane.add(tipCap);
    // Aileron: a real hinged surface on the trailing edge, driven by the
    // roll stick (opposite deflections, like the real linkage).
    const pivot = new THREE.Group();
    pivot.position.set(side * 3.9, wingY + 0.17, 0.02);
    const surface = mesh(new THREE.BoxGeometry(2.6, 0.045, 0.42), blue, 0, 0, 0.21);
    pivot.add(surface);
    plane.add(pivot);
    ailerons.push({ pivot, side });
    // Flap: inboard trailing-edge surface that droops at low speed
    // (purely visual; driven from airspeed in syncPlaneModel).
    const flapPivot = new THREE.Group();
    flapPivot.position.set(side * 1.55, wingY + 0.05, 0.06);
    const flapSurface = mesh(new THREE.BoxGeometry(1.8, 0.045, 0.4), blue, 0, 0, 0.2);
    flapPivot.add(flapSurface);
    plane.add(flapPivot);
    flaps.push(flapPivot);
    // Racer only: streamlined tip tanks in the accent colour.
    if (def.wing === 'low') {
      const tank = mesh(new THREE.CapsuleGeometry(0.17, 0.85, 4, 10), red, side * 5.5, wingY + 0.2, -0.55);
      tank.rotation.x = Math.PI / 2;
      plane.add(tank);
    }
    // High-wing trainer: lift struts from the lower fuselage to the wing.
    if (def.wing === 'high') {
      const strut = mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.1, 6), blue, side * 1.55, 0.35, -1.3);
      strut.rotation.z = side * 0.62;
      plane.add(strut);
    }
  }

  // Tail: stabilizer loft + fin with rudder.
  const stab = mesh(loftWing([
    { x: -1.85, y: 0.32, z: 2.62, chord: 1.05, thick: 0.09 },
    { x: 0, y: 0.32, z: 2.55, chord: 1.2, thick: 0.1 },
    { x: 1.85, y: 0.32, z: 2.62, chord: 1.05, thick: 0.09 },
  ]), blue);
  plane.add(stab);
  // Elevator: hinged surface behind the stabilizer, driven by pitch stick.
  const elevatorPivot = new THREE.Group();
  elevatorPivot.position.set(0, 0.32, 3.42);
  const elevator = mesh(new THREE.BoxGeometry(3.3, 0.045, 0.38), blue, 0, 0, 0.19);
  elevatorPivot.add(elevator);
  plane.add(elevatorPivot);
  // The fin is the same loft stood on end: span becomes height.
  const fin = mesh(loftWing([
    { x: 0, y: 0, z: 2.55, chord: 1.3, thick: 0.09 },
    { x: 0.85, y: 0, z: 2.72, chord: 1.08, thick: 0.08 },
    { x: 1.5, y: 0, z: 2.95, chord: 0.78, thick: 0.07 },
  ]), red);
  fin.rotation.z = Math.PI / 2; // +X span -> +Y height, thickness -> X
  fin.position.set(0, 0.28, 0);
  plane.add(fin);
  // Rudder: hinged surface on the fin trailing edge. The flight model has
  // no yaw input, so it follows the roll stick like a coordinated-turn
  // rudder (visual only).
  const rudderPivot = new THREE.Group();
  rudderPivot.position.set(0, 0.95, 3.42);
  const rudder = mesh(new THREE.BoxGeometry(0.05, 1.5, 0.5), red, 0, 0, 0.25);
  rudderPivot.add(rudder);
  plane.add(rudderPivot);

  // Wing-root fairings blend the wing into the fuselage sides.
  for (const side of [-1, 1]) {
    const fairing = mesh(new THREE.SphereGeometry(1, 12, 8), white, side * 0.62, wingY, -0.75);
    fairing.scale.set(0.55, 0.16, 1.05);
    plane.add(fairing);
  }
  // Pitot tube under the left wing; landing light in its leading edge.
  const pitot = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), dark, -2.2, wingY - 0.12, -1.7);
  pitot.rotation.x = Math.PI / 2;
  plane.add(pitot);
  const landingLight = new THREE.Mesh(
    new THREE.CircleGeometry(0.14, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff2c4 }),
  );
  landingLight.position.set(-1.6, wingY + 0.03, -1.43);
  landingLight.rotation.y = Math.PI; // face forward (-Z)
  plane.add(landingLight);
  // Wing surface detail: spar + hinge panel lines (thin half-sunk strips
  // following the dihedral), fuel caps, and per-type extras — walkway
  // strips on the tourers, stall fences on the racer.
  const lineMat = std(0x3a4048, 0.8);
  for (const side of [-1, 1]) {
    const segs = [
      { cx: side * 1.75, len: 2.5, y: wingY + 0.16, slope: 0.028 },
      { cx: side * 4.22, len: 2.45, y: wingY + 0.24, slope: 0.037 },
    ];
    for (const seg of segs) {
      for (const [lz, dy] of [[-0.84, 0], [-0.13, -0.035]]) {
        const line = mesh(new THREE.BoxGeometry(seg.len, 0.014, 0.035), lineMat, seg.cx, seg.y + dy, lz);
        line.rotation.z = side * seg.slope;
        plane.add(line);
      }
    }
    const cap = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.025, 10), dark, side * 1.5, wingY + 0.16, -0.75);
    plane.add(cap);
    if (def.wing === 'low') {
      const fence = mesh(new THREE.BoxGeometry(0.02, 0.17, 1.1), red, side * 3.1, wingY + 0.27, -0.75);
      plane.add(fence);
    } else {
      const walk = mesh(new THREE.BoxGeometry(1.6, 0.012, 0.5), lineMat, side * 1.15, wingY + 0.145, -0.35);
      plane.add(walk);
    }
  }
  // Belly blade antenna under the rear fuselage.
  const bellyAnt = mesh(new THREE.BoxGeometry(0.03, 0.2, 0.28), dark, 0, -0.44, 1.6);
  bellyAnt.rotation.x = 0.3;
  plane.add(bellyAnt);
  // Aerial mast behind the canopy with a wire back to the fin.
  const mast = mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.42, 6), dark, 0, 1.02, 0.55);
  plane.add(mast);
  const wireGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 1.23, 0.55), new THREE.Vector3(0, 1.7, 2.95),
  ]);
  plane.add(new THREE.Line(wireGeo, new THREE.LineBasicMaterial({ color: 0x22262c })));

  // Fixed gear. The high-wing trainer sits on a tricycle gear (nose
  // wheel, mains just aft of the CG); the others are taildraggers with
  // wheel spats and a tailwheel. Wheel bottoms share the y=-2.03 line.
  if (def.wing === 'high') {
    const noseLeg = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8), dark, 0, -1.12, -2.55);
    plane.add(noseLeg);
    const noseTire = mesh(new THREE.TorusGeometry(0.2, 0.09, 8, 14), std(0x1c1f24, 0.9), 0, -1.74, -2.55);
    noseTire.rotation.y = Math.PI / 2;
    plane.add(noseTire);
    const noseHub = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.09, 10), std(0xb9c2cc, 0.35, 0.6), 0, -1.74, -2.55);
    noseHub.rotation.z = Math.PI / 2;
    plane.add(noseHub);
    for (const side of [-1, 1]) {
      const leg = mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.15, 8), dark, side * 0.8, -1.0, -0.3);
      leg.rotation.z = side * 0.35;
      plane.add(leg);
      const fairing = mesh(new THREE.BoxGeometry(0.09, 0.95, 0.3), blue, side * 0.8, -1.0, -0.3);
      fairing.rotation.z = side * 0.35;
      plane.add(fairing);
      const tire = mesh(new THREE.TorusGeometry(0.3, 0.11, 8, 16), std(0x1c1f24, 0.9), side * 1.05, -1.62, -0.3);
      tire.rotation.y = Math.PI / 2;
      plane.add(tire);
      const hub = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 10), std(0xb9c2cc, 0.35, 0.6), side * 1.05, -1.62, -0.3);
      hub.rotation.z = Math.PI / 2;
      plane.add(hub);
    }
  } else {
  for (const side of [-1, 1]) {
    const leg = mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.25, 8), dark, side * 0.85, -1.05, -1.05);
    leg.rotation.z = side * 0.42;
    plane.add(leg);
    const fairing = mesh(new THREE.BoxGeometry(0.1, 1.05, 0.34), blue, side * 0.85, -1.05, -1.05);
    fairing.rotation.z = side * 0.42;
    plane.add(fairing);
    const spat = mesh(new THREE.SphereGeometry(0.42, 12, 8), blue, side * 1.18, -1.52, -1.02);
    spat.scale.set(0.42, 0.95, 1.5);
    plane.add(spat);
    const tire = mesh(new THREE.TorusGeometry(0.3, 0.11, 8, 16), std(0x1c1f24, 0.9), side * 1.18, -1.62, -1.02);
    tire.rotation.y = Math.PI / 2;
    plane.add(tire);
    const hub = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 10), std(0xb9c2cc, 0.35, 0.6), side * 1.18, -1.62, -1.02);
    hub.rotation.z = Math.PI / 2;
    plane.add(hub);
  }
  const tailLeg = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), dark, 0, -0.42, 3.35);
  tailLeg.rotation.x = 0.4;
  plane.add(tailLeg);
  const tailWheel = mesh(new THREE.TorusGeometry(0.16, 0.07, 8, 12), std(0x1c1f24, 0.9), 0, -0.62, 3.45);
  tailWheel.rotation.y = Math.PI / 2;
  plane.add(tailWheel);
  }

  // Propeller: three twisted blades, spinner, blur disc.
  const prop = new THREE.Group();
  prop.position.set(0, 0, -3.8);
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.09, 0.12);
  bladeShape.quadraticCurveTo(-0.16, 0.8, -0.11, 1.5);
  bladeShape.quadraticCurveTo(-0.04, 1.62, 0.05, 1.58);
  bladeShape.quadraticCurveTo(0.13, 0.8, 0.09, 0.12);
  bladeShape.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.045, bevelEnabled: false });
  const bladeMat = std(0x23272e, 0.45, 0.25);
  bladeMat.transparent = true; // fades out as the blur disc fades in
  const tipMat = std(0xffd23c, 0.5);
  tipMat.transparent = true;
  for (let i = 0; i < 3; i++) {
    const holder = new THREE.Group();
    holder.rotation.z = (i / 3) * Math.PI * 2;
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.rotation.y = 0.5; // pitch twist
    blade.castShadow = true;
    holder.add(blade);
    const tipMark = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.06), tipMat);
    tipMark.position.set(0, 1.44, 0.02);
    tipMark.rotation.y = 0.5;
    holder.add(tipMark);
    prop.add(holder);
  }
  const spinnerProfile = [
    [0.02, 0.62], [0.2, 0.42], [0.34, 0.16], [0.38, 0],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const spinner = mesh(new THREE.LatheGeometry(spinnerProfile, 18), white);
  spinner.rotation.x = -Math.PI / 2; // lathe +Y (the tip) onto -Z, pointing forward
  spinner.position.z = -0.05;
  prop.add(spinner);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.66, 32),
    new THREE.MeshBasicMaterial({ color: 0xdfe9f2, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }),
  );
  prop.add(disc);
  plane.add(prop);

  // Navigation lights: red left, green right, white tail strobe.
  const navLights = [];
  const navSpots = [
    { x: -5.62, y: wingY + 0.24, z: -0.55, color: 0xff3b30 },
    { x: 5.62, y: wingY + 0.24, z: -0.55, color: 0x35e065 },
    { x: 0, y: 0.4, z: 3.78, color: 0xffffff },
  ];
  for (const spot of navSpots) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: spot.color }));
    bulb.position.set(spot.x, spot.y, spot.z);
    plane.add(bulb);
    navLights.push(bulb);
  }
  // Anti-collision beacon on the fin top, blinking out of phase with the
  // tail strobe (driven in syncPlaneModel).
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2a1e }),
  );
  beacon.position.set(0, 1.82, 2.92);
  plane.add(beacon);

  const cockpit = buildCockpit();
  plane.add(cockpit.group);

  // Shield bubble, hidden until the pickup is active.
  const shieldBubble = new THREE.Mesh(
    new THREE.SphereGeometry(4.6, 24, 16),
    new THREE.MeshBasicMaterial({
      color: COLORS.pickupShield, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  shieldBubble.scale.set(1.25, 0.62, 1);
  shieldBubble.visible = false;
  plane.add(shieldBubble);

  return {
    group: plane,
    prop,
    propDisc: disc,
    bladeMat,
    tipMat,
    navLights,
    beacon,
    ailerons,
    flaps,
    rudderPivot,
    elevatorPivot,
    cockpit: cockpit.group,
    needles: cockpit.needles,
    stickPivot: cockpit.stickPivot,
    shieldBubble,
    /** Swing the gauge needles, horizon ball, compass card and throttle lever. */
    setGauges(altM, speedKmh, headingDeg, extra = {}) {
      const sweep = (frac) => THREE.MathUtils.lerp(2.25, -2.25, Math.min(1, Math.max(0, frac)));
      cockpit.needles.alt.rotation.z = sweep(altM / 600);
      cockpit.needles.speed.rotation.z = sweep(speedKmh / 340);
      cockpit.needles.rpm.rotation.z = sweep(extra.rpm01 ?? 0);
      cockpit.needles.fuel.rotation.z = sweep(extra.fuel01 ?? 1);
      cockpit.horizonBall.rotation.set(-(extra.pitch ?? 0), 0, -(extra.roll ?? 0));
      cockpit.compassCard.rotation.y = -headingDeg * Math.PI / 180;
      cockpit.throttlePivot.rotation.x = THREE.MathUtils.lerp(0.55, -0.55, extra.throttle01 ?? 0);
    },
    /** Tilt the stick (and the hand on it) the way the pilot is pushing. */
    setStick(pitch, roll, shake01 = 0) {
      cockpit.stickPivot.rotation.x = -pitch * 0.32;
      cockpit.stickPivot.rotation.z = -roll * 0.32;
      const t = performance.now() * 0.001;
      const amp = shake01 * 0.0035;
      cockpit.hand.position.set(
        Math.sin(t * 37) * amp,
        0.40 + Math.sin(t * 43 + 1) * amp,
        Math.sin(t * 29 + 2) * amp,
      );
    },
  };
}

/** Fresh flight state parked on the start runway, nose pointing north. */
export function createFlightState(startPad) {
  return {
    pos: new THREE.Vector3(startPad.x, startPad.h + 1.9, startPad.z + WORLD.runwayLength / 2 - 26),
    vel: new THREE.Vector3(), // air-relative velocity; the physics integrates this
    yaw: 0,
    pitch: 0,
    roll: 0,
    pitchRate: 0,
    rollRate: 0,
    speed: 0,
    throttle: 0,
    airborne: false,
    stalled: false,
    grounded: true,
    sinkRate: 0,
    buffet: 0, // 0..1 stall shake amount, for the visual shudder
    stickPitch: 0, // last stick asks, for control-surface deflection
    stickRoll: 0,
    accelSm: 0, // smoothed longitudinal acceleration, for the nose-up cue
    propAngle: 0,
    lastImpact: null,
  };
}

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _forward = new THREE.Vector3();

/** Unit vector the nose points along, from the state's yaw and pitch. */
export function forwardOf(state, out = new THREE.Vector3()) {
  _euler.set(state.pitch, state.yaw, 0);
  return out.set(0, 0, -1).applyEuler(_euler);
}

/** Compass heading in degrees: 0 north, 90 east. */
export function headingOf(state) {
  forwardOf(state, _forward);
  const deg = Math.atan2(_forward.x, -_forward.z) * 180 / Math.PI;
  return (deg + 360) % 360;
}

/** */
const AERO = {
  gravity: 9.81,
  kLift: 0.0132,
  cl0: 0.28,
  clAlpha: 4.2, // lift slope per radian of angle of attack
  stallAlpha: 0.26, // rad; beyond this the wing lets go
  kDrag0: 0.00072,
  kDragI: 0.00135,
  thrust0: 10.2, // m/s^2 at standstill, full throttle
  thrustSlope: 0.042, // prop thrust fades with airspeed
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Lift coefficient with a sharp stall break past the critical alpha. */
function liftCoeff(alpha, P = AERO) {
  if (alpha <= P.stallAlpha) return P.cl0 + P.clAlpha * alpha;
  const peak = P.cl0 + P.clAlpha * P.stallAlpha;
  return peak * Math.max(0.3, 1 - (alpha - P.stallAlpha) * 3.2);
}

/** Second-order spring-damper: attitude chases the stick with real lag. */
function springStep(current, rate, target, omega, zeta, dt) {
  const accel = (target - current) * omega * omega - 2 * zeta * omega * rate;
  rate += accel * dt;
  current += rate * dt;
  return [current, rate];
}

const _up = new THREE.Vector3();
const _accel = new THREE.Vector3();
const _vhat = new THREE.Vector3();

/** */
export function stepFlight(state, input, env, dt) {
  // Per-plane aero numbers (env.plane from PLANES) over the shared defaults.
  const P = { ...AERO, maxRoll: FLIGHT.maxRoll, takeoffSpeed: FLIGHT.takeoffSpeed, pitchOmega: 3.4, rollOmega: 4.2, ...(env.plane || {}) };
  state.stickPitch = input.pitch || 0;
  state.stickRoll = input.roll || 0;
  // Throttle lever.
  if (input.throttleSet !== undefined) state.throttle = input.throttleSet;
  else state.throttle += (input.throttleDelta || 0) * FLIGHT.throttleRate * dt;
  state.throttle = Math.min(1, Math.max(0, state.throttle));

  const lagScale = env.lagScale || 1;
  const prevSpeed = state.vel.length();

  if (!state.airborne) {
    // ---- Ground roll: scalar speed along the heading, nose held down
    // until rotation speed, then the wing is allowed to lift her off.
    const speed = state.speed;
    const thrust = state.throttle * Math.max(0, P.thrust0 - P.thrustSlope * speed);
    const drag = P.kDrag0 * speed * speed + (speed > 0.1 ? 0.35 : 0);
    state.speed = Math.max(0, speed + (thrust - drag) * dt);
    const canRotate = state.speed > P.takeoffSpeed * 0.75;
    const pitchAsk = clamp((input.pitch || 0) * FLIGHT.maxPitch, -0.02, canRotate ? 0.3 : 0.03);
    [state.pitch, state.pitchRate] = springStep(state.pitch, state.pitchRate, pitchAsk, 3.2 / lagScale, 0.9, dt);
    [state.roll, state.rollRate] = springStep(state.roll, state.rollRate, 0, 3.4 / lagScale, 0.9, dt);
    forwardOf(state, _forward);
    _forward.y = 0;
    _forward.normalize();
    state.vel.copy(_forward).multiplyScalar(state.speed);
    state.pos.x += (state.vel.x + (env.windX || 0)) * dt;
    state.pos.z += (state.vel.z + (env.windZ || 0)) * dt;
    state.pos.y = env.heightAt(state.pos.x, state.pos.z) + 1.9;
    state.sinkRate = 0;
    state.stalled = false;
    state.buffet = Math.max(0, state.buffet - dt * 3);
    const liftNow = P.kLift * state.speed * state.speed * liftCoeff(state.pitch, P);
    if (state.speed > P.takeoffSpeed * 0.9 && liftNow > P.gravity * 1.0 && (input.pitch || 0) > 0.15) {
      state.airborne = true;
      state.grounded = false;
      forwardOf(state, _forward);
      state.vel.copy(_forward).multiplyScalar(state.speed);
      return 'takeoff';
    }
    if (state.speed > P.takeoffSpeed * 1.45 && liftNow > P.gravity * 1.05) {
      state.airborne = true;
      state.grounded = false;
      forwardOf(state, _forward);
      state.vel.copy(_forward).multiplyScalar(state.speed);
      return 'takeoff';
    }
    return null;
  }

  // ---- Airborne: attitude first (spring-damper toward the stick ask).
  const pitchAsk = state.stalled ? -0.28 : (input.pitch || 0) * FLIGHT.maxPitch;
  const rollAsk = -(input.roll || 0) * P.maxRoll;
  [state.pitch, state.pitchRate] = springStep(state.pitch, state.pitchRate, pitchAsk, P.pitchOmega / lagScale, 0.85, dt);
  [state.roll, state.rollRate] = springStep(state.roll, state.rollRate, rollAsk, P.rollOmega / lagScale, 0.85, dt);
  state.pitch = clamp(state.pitch, -1.15, 1.15);
  state.roll = clamp(state.roll, -1.3, 1.3);

  // Body axes from the full attitude (yaw, pitch, roll). The up vector must
  // be read before forwardOf() resets the shared euler to roll = 0.
  _euler.set(state.pitch, state.yaw, state.roll);
  _up.set(0, 1, 0).applyEuler(_euler);
  forwardOf(state, _forward);

  const v = Math.max(0.01, state.vel.length());
  _vhat.copy(state.vel).divideScalar(v);
  // Angle of attack: velocity against the wing plane, robust in a bank.
  const alpha = Math.atan2(-_vhat.dot(_up), _vhat.dot(_forward));
  const cl = liftCoeff(alpha, P);
  state.stalled = alpha > P.stallAlpha;
  const buffetTarget = state.stalled ? 1 : (alpha > P.stallAlpha - 0.05 ? 0.45 : 0);
  state.buffet += (buffetTarget - state.buffet) * Math.min(1, dt * 6);

  const lift = P.kLift * v * v * cl;
  const drag = (P.kDrag0 * (state.stalled ? 2.2 : 1) + P.kDragI * cl * cl) * v * v;
  const thrust = state.throttle * Math.max(0, P.thrust0 - P.thrustSlope * v) * (env.speedFactor || 1);

  _accel.set(0, -P.gravity, 0)
    .addScaledVector(_up, lift)
    .addScaledVector(_forward, thrust)
    .addScaledVector(_vhat, -drag);
  state.vel.addScaledVector(_accel, dt);

  // Heading follows the horizontal velocity with a lag (sideslip on entry).
  // Note the sign: compass heading = -yaw in this airframe's convention.
  const hSpeed = Math.hypot(state.vel.x, state.vel.z);
  if (hSpeed > 3) {
    const yawTarget = -Math.atan2(state.vel.x, -state.vel.z);
    state.yaw += wrapAngle(yawTarget - state.yaw) * Math.min(1, dt * 2.4);
  }

  // Numerical safety: never let a non-finite velocity reach the renderer.
  if (!Number.isFinite(state.vel.x + state.vel.y + state.vel.z)) {
    forwardOf(state, _forward);
    state.vel.copy(_forward).multiplyScalar(30);
  }

  state.pos.x += (state.vel.x + (env.windX || 0) + (env.pullX || 0)) * dt;
  state.pos.y += state.vel.y * dt;
  state.pos.z += (state.vel.z + (env.windZ || 0) + (env.pullZ || 0)) * dt;

  const newSpeed = state.vel.length();
  state.accelSm += (((newSpeed - prevSpeed) / Math.max(dt, 1e-4)) - state.accelSm) * Math.min(1, dt * 3);
  state.speed = newSpeed;
  state.sinkRate = -state.vel.y;

  if (state.pos.y > WORLD.ceiling) {
    state.pos.y = WORLD.ceiling;
    if (state.vel.y > 0) state.vel.y = 0;
    state.pitch = Math.min(state.pitch, 0);
  }

  const groundY = env.heightAt(state.pos.x, state.pos.z) + 1.9;
  if (state.pos.y <= groundY) {
    state.pos.y = groundY;
    const onStrip = env.onRunway(state.pos.x, state.pos.z);
    const gentle = state.speed <= FLIGHT.landMaxSpeed
      && state.sinkRate <= FLIGHT.landMaxSink
      && Math.abs(state.roll) < 0.35;
    state.lastImpact = { speed: state.speed, sink: state.sinkRate, onRunway: onStrip, gentle };
    // Whatever the outcome, she is on the ground now: keep the horizontal
    // speed as the rolling speed so the ground branch can take over.
    state.speed = Math.hypot(state.vel.x, state.vel.z);
    if (gentle && onStrip) {
      state.airborne = false;
      state.grounded = true;
      state.pitch = 0;
      state.roll = 0;
      state.pitchRate = 0;
      state.rollRate = 0;
      return 'landed';
    }
    if (gentle) {
      // A field landing: bumpy but survivable, and she can roll out of it.
      state.airborne = false;
      state.grounded = true;
      state.pitch = 0;
      state.roll = 0;
      state.pitchRate = 0;
      state.rollRate = 0;
      return 'rough';
    }
    return 'impact';
  }
  return null;
}

/** Park the state back on a runway (after a crash or a reset), engine idling. */
export function resetToRunway(state, pad, headingNorth = true) {
  state.pos.set(pad.x, pad.h + 1.9, pad.z + (headingNorth ? WORLD.runwayLength / 2 - 26 : -WORLD.runwayLength / 2 + 26));
  state.vel.set(0, 0, 0);
  state.yaw = headingNorth ? 0 : Math.PI;
  state.pitch = 0;
  state.roll = 0;
  state.pitchRate = 0;
  state.rollRate = 0;
  state.speed = 0;
  state.throttle = 0;
  state.airborne = false;
  state.grounded = true;
  state.stalled = false;
  state.buffet = 0;
  state.accelSm = 0;
}

/** Put the state in the air at a point, already flying (respawns, screenshot staging). */
export function placeInAir(state, pos, yaw, speed, throttle) {
  state.pos.copy(pos);
  state.yaw = yaw;
  state.pitch = 0;
  state.roll = 0;
  state.pitchRate = 0;
  state.rollRate = 0;
  state.speed = speed;
  state.throttle = throttle;
  state.airborne = true;
  state.grounded = false;
  state.stalled = false;
  state.buffet = 0;
  state.accelSm = 0;
  forwardOf(state, _forward);
  state.vel.copy(_forward).multiplyScalar(speed);
}

/** */
export function syncPlaneModel(model, state, dt, time) {
  model.group.position.copy(state.pos);
  const air = state.airborne ? 1 : 0.25;
  const turbPitch = (Math.sin(time * 1.7) + Math.sin(time * 2.9 + 1.3)) * 0.007 * air;
  const turbRoll = (Math.sin(time * 1.3 + 0.7) + Math.sin(time * 2.3 + 2.1)) * 0.009 * air;
  const buffetPitch = Math.sin(time * 31) * 0.02 * state.buffet;
  const buffetRoll = Math.sin(time * 27 + 1.1) * 0.016 * state.buffet;
  const accelPitch = clamp(state.accelSm, -3, 5) * 0.006;
  _euler.set(
    state.pitch + turbPitch + buffetPitch + accelPitch,
    state.yaw,
    state.roll + turbRoll + buffetRoll,
  );
  model.group.quaternion.setFromEuler(_euler);
  state.propAngle += dt * (6 + state.throttle * 46 + state.speed * 0.35);
  model.prop.rotation.z = state.propAngle;
  // Control surfaces follow the stick: ailerons opposite, elevator with pitch.
  const rollIn = state.stickRoll || 0;
  for (const a of model.ailerons) a.pivot.rotation.x = -a.side * rollIn * 0.5;
  model.elevatorPivot.rotation.x = -(state.stickPitch || 0) * 0.45;
  // Rudder follows the roll stick (coordinated-turn approximation; the
  // flight model itself has no yaw channel to feed).
  if (model.rudderPivot) model.rudderPivot.rotation.y = rollIn * 0.4;
  // Flaps droop as airspeed falls toward the stall (visual only).
  if (model.flaps) {
    const flapAmt = clamp((46 - state.speed) / 16, 0, 1);
    for (const f of model.flaps) f.rotation.x = flapAmt * 0.55;
  }
  // Propeller blur crossfade: at low rpm the blades read clearly, at high
  // rpm they fade into the translucent disc.
  if (model.propDisc) {
    const rpm01 = clamp((state.throttle * 46 + state.speed * 0.35) / 52, 0, 1);
    model.propDisc.material.opacity = 0.04 + rpm01 * 0.15;
    model.bladeMat.opacity = 1 - rpm01 * 0.72;
    model.tipMat.opacity = 1 - rpm01 * 0.72;
  }
  const strobe = (time % 1) < 0.09;
  model.navLights[2].visible = strobe;
  if (model.beacon) model.beacon.visible = (time % 1.4) < 0.14;
}

/** World positions of the two wingtips, for the vapour trails. */
export function wingtipPositions(model, outLeft, outRight) {
  outLeft.set(-5.5, 0.26, -0.55);
  outRight.set(5.5, 0.26, -0.55);
  model.group.localToWorld(outLeft);
  model.group.localToWorld(outRight);
}
