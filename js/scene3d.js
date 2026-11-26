// The animated 3D village, built from the village's real map (roads, canals, fields, built-up areas
// and buildings from OpenStreetMap, see osm.js). Houses rise out of the ground from the centre
// outwards and every place and business appears on its real spot while the camera slowly circles.
// Original low-poly art. three.js is loaded lazily from a pinned CDN URL. If WebGL fails, the
// CSS background stays. Respects reduced motion.
import { synthHouses, syntheticMap } from './osm.js';
import { makeModel, MODEL_CLEAR } from './models3d.js';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
const U = 10;      // metres per scene unit
const VEX = 1.7;   // building heights are exaggerated a little so the village reads from above
const LANDMARK_SCALE = 1.8; // landmarks are drawn larger than life so they stand out

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const easeOutBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };
const clamp01 = x => Math.max(0, Math.min(1, x));
const hashStr = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const hex = n => '#' + n.toString(16).padStart(6, '0');

/**
 * @param container element to fill (position: relative/absolute; the canvas covers it)
 * @param opts { center:{lat,lng}, map (village map from osm.js, optional), points:[{lat,lng,icon,label,kind,id}],
 *               mode:'full'|'hero', seed, onPick(point), onReady() }
 * @returns destroy()
 */
export async function mountScene(container, opts) {
  let THREE;
  try { THREE = await import(THREE_URL); } catch (e) { console.warn('3D map unavailable', e); return () => {}; }
  if (!container.isConnected) return () => {};
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || (navigator.hardwareConcurrency || 4) <= 2;
  const hero = opts.mode === 'hero';
  const map = opts.map?.rd ? opts.map : syntheticMap(opts.center, opts.seed ?? 7);
  const R = rng(opts.seed ?? hashStr(map.lat.toFixed(4) + map.lng.toFixed(4)));

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }); }
  catch (e) { console.warn('WebGL unavailable', e); return () => {}; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'scene-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.prepend(renderer.domElement);

  /* ---------- palette ---------- */
  const P = dark ? {
    sky: 0x0d1630, hemiSky: 0x5466a8, hemiGround: 0x1b2412, hemi: 0.85, sun: 0x9fb4ff, sunI: 1.2,
    fields: ['#1f3d22', '#274a25', '#2f5228', '#34542a', '#3d5328', '#223a2c', '#2a4423'], earth: '#3a3228', plot: '#463b2e',
    water: '#1d3f6e', bank: '#183021', road: '#5a5040', roadEdge: '#2c271f', asphalt: '#3c3f47', orchard: '#173320', green: '#22452a',
    cemetery: '#3d3a35', industry: '#34363c', houses: [0x6b4f3f, 0x7a5e48, 0x5d4a3e, 0x8a7a66, 0x6e6458, 0x5f5a55], palm: 0x1f4a2a, trunk: 0x4a3626,
  } : {
    sky: 0xf4d9b0, hemiSky: 0xfff1d6, hemiGround: 0x6b7a3a, hemi: 1.0, sun: 0xffc38a, sunI: 2.0,
    fields: ['#6f9e45', '#88b04b', '#5e8f3a', '#a9b85a', '#c9b66a', '#7fa65a', '#4f8a3c', '#96ad52'], earth: '#cdb48a', plot: '#d9c39b',
    water: '#3f8fb5', bank: '#4d7d38', road: '#e6d4ae', roadEdge: '#a8916a', asphalt: '#8d8a86', orchard: '#3f7a33', green: '#5d9a45',
    cemetery: '#c8bba0', industry: '#b9b3a8', houses: [0xb5654a, 0xc98a62, 0xe0c9a6, 0xd9a77c, 0xa65e46, 0xefe3cf, 0xb9b2a6], palm: 0x3f7a33, trunk: 0x8a6a46,
  };

  const disposables = [];
  const track = o => { disposables.push(o); return o; };
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(P.sky);
  scene.add(new THREE.HemisphereLight(P.hemiSky, P.hemiGround, P.hemi));
  const sun = new THREE.DirectionalLight(P.sun, P.sunI);
  sun.position.set(-120, 70, 60);
  scene.add(sun);

  /* ---------- houses: real buildings + houses filling the real built-up areas ---------- */
  const kx = 111320 * Math.cos(map.lat * Math.PI / 180), ky = 110540;
  const toM = (lat, lng) => [(lng - map.lng) * kx, (lat - map.lat) * ky];
  // landmarks with a 3D model (mosque, school, playground…) replace the houses on their spot
  const modelSpots = (opts.points || []).filter(p => p.model && MODEL_CLEAR[p.model] && p.lat != null).map(p => [...toM(p.lat, p.lng), MODEL_CLEAR[p.model] * LANDMARK_SCALE]);
  const centroid = b => { let x = 0, y = 0; const n = (b.length - 1) / 2; for (let i = 1; i < b.length; i += 2) { x += b[i]; y += b[i + 1]; } return [x / n, y / n]; };
  const footprints = [...(map.b || []), ...synthHouses(map)].filter(b => {
    if (!modelSpots.length) return true;
    const [x, y] = centroid(b);
    return !modelSpots.some(([mx, my, r]) => Math.hypot(x - mx, y - my) < r);
  });
  // focus on the houses of this village (neighbouring villages inside the map stay in the background)
  // and the camera circles the middle of those houses, not the search pin
  const nearB = footprints.filter(b => Math.hypot(b[1], b[2]) < map.r * 0.7);
  const focusB = nearB.length >= 30 ? nearB : footprints;
  const FX = focusB.length ? focusB.reduce((s, b) => s + b[1], 0) / focusB.length / U : 0;
  const FZ = focusB.length ? -focusB.reduce((s, b) => s + b[2], 0) / focusB.length / U : 0;
  const dists = focusB.map(b => Math.hypot(b[1] / U - FX, -b[2] / U - FZ)).sort((a, b) => a - b);
  const F = Math.max(22, Math.min(90, dists[Math.floor(dists.length * 0.8)] || 35)); // focus radius in units
  const rg = map.rg || map.r * 1.6;

  /* ---------- ground: one painted texture with fields, land use, water and roads ---------- */
  {
    const S = Math.min(2048, renderer.capabilities.maxTextureSize || 2048, (navigator.hardwareConcurrency || 4) <= 4 ? 1536 : 2048);
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const k = S / (2 * rg);
    const X = x => (x + rg) * k, Y = y => (rg - y) * k;
    const path = (a, start, close) => {
      g.beginPath(); g.moveTo(X(a[start]), Y(a[start + 1]));
      for (let i = start + 2; i < a.length; i += 2) g.lineTo(X(a[i]), Y(a[i + 1]));
      if (close) g.closePath();
    };
    // patchwork of long, narrow Delta fields
    g.fillStyle = P.fields[0]; g.fillRect(0, 0, S, S);
    const base = R() * Math.PI;
    for (let by = -rg; by < rg; by += 170) for (let bx = -rg; bx < rg; bx += 170) {
      g.save(); g.translate(X(bx + 85), Y(by + 85)); g.rotate(base + (R() - 0.5) * 0.5);
      let off = -130;
      while (off < 130) {
        const w = (10 + R() * 30) * k;
        g.fillStyle = P.fields[Math.floor(R() * P.fields.length)];
        g.fillRect(off * k, -125 * k, w + 0.6, 250 * k);
        off += w / k;
      }
      g.restore();
    }
    const LCOL = { f: null, o: P.orchard, g: P.green, c: P.cemetery, i: P.industry, r: P.earth };
    for (const t of ['f', 'o', 'g', 'i', 'c', 'r']) for (const a of map.l || []) {
      if (a[0] !== t) continue;
      path(a, 1, true);
      if (t === 'f') { g.globalAlpha = 0.55; g.fillStyle = P.fields[Math.floor(R() * P.fields.length)]; g.fill(); g.globalAlpha = 1; }
      else { g.fillStyle = LCOL[t]; g.fill(); }
    }
    // bare earth around every house so the village reads as one built-up area
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = P.earth; g.fillStyle = P.earth; g.lineWidth = Math.max(1, 9 * k);
    for (const b of footprints) { path(b, 1, true); g.stroke(); }
    g.fillStyle = P.plot; g.strokeStyle = P.plot; g.lineWidth = Math.max(1, 3 * k);
    for (const b of footprints) { path(b, 1, true); g.fill(); g.stroke(); }
    // water
    g.fillStyle = P.water;
    for (const a of map.wa || []) { path(a, 0, true); g.fill(); }
    for (const pass of ['bank', 'water']) for (const a of map.wl || []) {
      path(a, 1, false); g.strokeStyle = pass === 'bank' ? P.bank : P.water;
      g.lineWidth = Math.max(1.5, (a[0] + (pass === 'bank' ? 7 : 0)) * k); g.stroke();
    }
    // roads (edges first, then the surface)
    const rd = [...(map.rd || [])].sort((a, b) => a[0] - b[0]);
    for (const pass of ['edge', 'top']) for (const a of rd) {
      path(a, 1, false);
      g.strokeStyle = pass === 'edge' ? P.roadEdge : a[0] >= 8 ? P.asphalt : P.road;
      g.lineWidth = Math.max(pass === 'edge' ? 1.6 : 1, (a[0] + (pass === 'edge' ? 1.6 : 0)) * k);
      g.stroke();
    }
    const tex = track(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(2 * rg / U, 2 * rg / U)), track(new THREE.MeshLambertMaterial({ map: tex })));
    ground.rotation.x = -Math.PI / 2;
    const outer = new THREE.Mesh(track(new THREE.PlaneGeometry(6000, 6000)), track(new THREE.MeshLambertMaterial({ color: new THREE.Color(P.fields[0]) })));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.08;
    scene.add(outer, ground);
    const camR = F * (hero ? 2.0 : 2.6);
    scene.fog = new THREE.Fog(P.sky, camR * 1.0, Math.max(camR * 2.2, Math.min(rg / U, camR * 3)));
  }

  /* ---------- buildings: one merged mesh; a tiny shader makes each house rise on its own delay ---------- */
  const uT = { value: still ? 1e4 : 0 };
  const windowPos = [];
  {
    const pos = [], nor = [], col = [], del = [];
    const push = (x, y, z, nx, ny, nz, c, d) => { pos.push(x, y, z); nor.push(nx, ny, nz); col.push(c.r, c.g, c.b); del.push(d); };
    const wall = new THREE.Color(), roof = new THREE.Color();
    for (const b of footprints) {
      let pts = [];
      for (let i = 1; i < b.length; i += 2) pts.push([b[i], b[i + 1]]);
      if (pts.length < 3) continue;
      let area = 0;
      for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; area += x1 * y2 - x2 * y1; }
      if (Math.abs(area) < 4) continue;
      if (area < 0) pts.reverse();
      const hm = b[0] ? b[0] / 10 : 3.1 * (1 + Math.floor(R() * R() * 4));
      const H = Math.max(2.4, hm) * VEX / U;
      const d = Math.hypot(pts[0][0] / U - FX, -pts[0][1] / U - FZ);
      const delay = 0.3 + Math.min(d / F, 2.2) * 1.5 + R() * 0.25;
      wall.setHex(P.houses[Math.floor(R() * P.houses.length)]);
      roof.copy(wall).offsetHSL(0, -0.05, dark ? 0.04 : 0.07);
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, nx = dy / len, nz = dx / len;
        const A = [ax / U, -ay / U], B = [bx / U, -by / U];
        push(A[0], 0, A[1], nx, 0, nz, wall, delay); push(B[0], 0, B[1], nx, 0, nz, wall, delay); push(B[0], H, B[1], nx, 0, nz, wall, delay);
        push(A[0], 0, A[1], nx, 0, nz, wall, delay); push(B[0], H, B[1], nx, 0, nz, wall, delay); push(A[0], H, A[1], nx, 0, nz, wall, delay);
        if (dark && len > 4 && R() < 0.35) windowPos.push((ax + dx / 2) / U + nx * 0.06, H * (0.3 + R() * 0.5), -(ay + dy / 2) / U + nz * 0.06);
      }
      const faces = THREE.ShapeUtils.triangulateShape(pts.map(([x, y]) => new THREE.Vector2(x, y)), []);
      for (const f of faces) {
        const [p, q, s] = f.map(i => pts[i]);
        const cw = (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]) < 0;
        for (const v of cw ? [p, s, q] : [p, q, s]) push(v[0] / U, H, -v[1] / U, 0, 1, 0, roof, delay);
      }
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aDelay', new THREE.Float32BufferAttribute(del, 1));
    const mat = track(new THREE.MeshLambertMaterial({ vertexColors: true }));
    mat.onBeforeCompile = sh => {
      sh.uniforms.uT = uT;
      sh.vertexShader = 'attribute float aDelay;\nuniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float kk = clamp((uT - aDelay) / 0.9, 0.0, 1.0) - 1.0;
        transformed.y *= max(0.001, 1.0 + 2.70158 * kk * kk * kk + 1.70158 * kk * kk);`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  let windows = null;
  if (windowPos.length) {
    const g = track(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(windowPos, 3));
    windows = new THREE.Points(g, track(new THREE.PointsMaterial({ color: 0xffd27a, size: 0.6, transparent: true, opacity: 0, depthWrite: false })));
    scene.add(windows);
  }

  /* ---------- palm trees along the canals and in the fields ---------- */
  {
    const palms = [], core = F * U * 0.9;
    for (const a of map.wl || []) for (let i = 3; i < a.length && palms.length < 360; i += 2) {
      const ax = a[i - 2], ay = a[i - 1], bx = a[i], by = a[i + 1], len = Math.hypot(bx - ax, by - ay) || 1;
      for (let t = 0; t < len; t += 22) {
        if (R() > 0.45) continue;
        const side = R() < 0.5 ? -1 : 1, off = a[0] / 2 + 5 + R() * 5;
        const x = ax + (bx - ax) * t / len + side * -(by - ay) / len * off, y = ay + (by - ay) * t / len + side * (bx - ax) / len * off;
        if (Math.hypot(x, y) < rg * 0.95 && Math.hypot(x, y) > core * 0.7) palms.push({ x: x / U, z: -y / U, h: 5 + R() * 4 });
      }
    }
    for (let i = 0; i < 140; i++) {
      const a = R() * Math.PI * 2, d = core * 1.15 + R() * (rg * 0.9 - core * 1.15);
      if (d > 0) palms.push({ x: Math.cos(a) * d / U, z: Math.sin(a) * d / U, h: 5 + R() * 4 });
    }
    const trunk = new THREE.InstancedMesh(track(new THREE.CylinderGeometry(0.18, 0.28, 1, 5)), track(new THREE.MeshLambertMaterial({ color: P.trunk })), palms.length);
    const crown = new THREE.InstancedMesh(track(new THREE.IcosahedronGeometry(1, 0)), track(new THREE.MeshLambertMaterial({ color: P.palm, flatShading: true })), palms.length);
    palms.forEach((p, i) => {
      const s = 0.55;
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(p.x, p.h * s / 2, p.z); dummy.scale.set(s, p.h * s, s); dummy.updateMatrix(); trunk.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, p.h * s, p.z); dummy.scale.set(1.9 * s, 0.7 * s, 1.9 * s); dummy.rotation.set(0, R() * 3, 0); dummy.updateMatrix(); crown.setMatrixAt(i, dummy.matrix);
    });
    scene.add(trunk, crown);
  }

  /* ---------- markers for real places & businesses ---------- */
  const toXZ = (lat, lng) => ({ x: (lng - map.lng) * kx / U, z: -(lat - map.lat) * ky / U });
  const ms = Math.max(0.6, Math.min(1.6, F / 46)); // marker scale follows the village size
  const iconTex = (emoji, ring) => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.beginPath(); x.arc(64, 64, 58, 0, Math.PI * 2); x.fillStyle = dark ? '#1c2233' : '#fffaf0'; x.fill();
    x.lineWidth = 8; x.strokeStyle = ring; x.stroke();
    x.font = '64px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(emoji || '•', 64, 70);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return track(tx);
  };
  const labelTex = text => {
    const c = document.createElement('canvas'), x = c.getContext('2d');
    const font = '600 34px system-ui,"Segoe UI",Tahoma,sans-serif';
    x.font = font; const w = Math.min(560, Math.ceil(x.measureText(text).width) + 36);
    c.width = w; c.height = 56;
    x.font = font; x.fillStyle = dark ? 'rgba(10,14,26,.78)' : 'rgba(255,250,240,.88)';
    x.beginPath(); x.roundRect(0, 0, w, 56, 28); x.fill();
    x.fillStyle = dark ? '#f2ead8' : '#3b2a1e'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
    x.fillText(text, w / 2, 30, w - 20);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return { tex: track(tx), aspect: w / 56 };
  };
  const markers = [];
  const postGeo = track(new THREE.CylinderGeometry(0.22, 0.22, 1, 6));
  const ringGeo = track(new THREE.RingGeometry(1.2, 1.7, 28));
  const pts = (opts.points || []).filter(p => p.lat != null && p.lng != null).slice(0, 80);
  pts.forEach((p, i) => {
    const { x, z } = toXZ(p.lat, p.lng);
    if (Math.hypot(x, z) > rg / U) return;
    const col = p.kind === 'place' ? (dark ? 0xf2c14e : 0xc8901c) : (dark ? 0xff8a65 : 0xc2502e);
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const model = p.model ? makeModel(THREE, p.model, { dark, track }) : null;
    let height = (5 + (i % 4) * 1.2) * ms, post;
    if (model) {
      model.group.rotation.y = (hashStr(p.id || p.label || i) % 4) * Math.PI / 2;
      model.group.scale.setScalar(LANDMARK_SCALE * ms);
      g.add(model.group);
      height = model.top * LANDMARK_SCALE * ms + 1.2 * ms;
      post = new THREE.Group();
    } else {
      post = new THREE.Mesh(postGeo, track(new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: dark ? 0.5 : 0.15 })));
      post.scale.set(ms, height, ms); post.position.y = height / 2;
    }
    const ring = new THREE.Mesh(ringGeo, track(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.2; ring.userData.s = ms;
    const icon = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: iconTex(p.icon, hex(col)), depthWrite: false })));
    const iconSize = (hero ? 6 : 4.6) * ms * (model ? 0.5 : 1);
    icon.scale.setScalar(iconSize); icon.position.y = height + iconSize * 0.4;
    g.add(post, ring, icon);
    let label = null;
    if (p.label && (!hero || p.kind === 'place')) {
      const { tex, aspect } = labelTex(p.label);
      label = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 })));
      const ls = (hero ? 2.6 : 1.9) * ms; label.scale.set(ls * aspect, ls, 1); label.position.y = height + iconSize * 0.9 + ls * 0.4;
      g.add(label);
    }
    icon.userData.point = p;
    scene.add(g);
    markers.push({ g, ring, label, icon, delay: 1.4 + i * 0.07, phase: R() * 6 });
  });

  /* ---------- camera, sizing, loop ---------- */
  const camera = new THREE.PerspectiveCamera(hero ? 42 : 46, 1, 1, Math.max(1500, rg / U * 4));
  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(container);

  const startAngle = R() * Math.PI * 2;
  const frame = t => {
    const intro = clamp01(t / 5), ease = 1 - (1 - intro) ** 3;
    const ang = startAngle + t * 0.045;
    const rad = hero ? F * (2.17 - 0.26 * intro) : F * (3.26 - 0.98 * ease);
    const hgt = hero ? F * (1.35 - 0.17 * intro) : F * (2.4 - 1.1 * ease);
    camera.position.set(FX + Math.cos(ang) * rad, hgt + Math.sin(t * 0.2) * 2, FZ + Math.sin(ang) * rad);
    camera.lookAt(FX, hero ? 2 : 4, FZ);
    uT.value = still ? 1e4 : t;
    if (windows) windows.material.opacity = clamp01((t - 2) / 2) * 0.95;
    for (const m of markers) {
      const k = still ? 1 : clamp01((t - m.delay) / 1.1);
      m.g.position.y = -14 * ms * (1 - easeOutBack(k));
      m.g.visible = k > 0;
      const pulse = (Math.sin(t * 2.2 + m.phase) + 1) / 2;
      m.ring.scale.setScalar((1 + pulse * 0.6) * m.ring.userData.s); m.ring.material.opacity = 0.8 - pulse * 0.6;
      if (m.label) {
        const d = camera.position.distanceTo(m.g.position);
        m.label.material.opacity = (still ? 1 : clamp01((t - m.delay - 0.8) / 0.8)) * clamp01(1.6 - d / (F * (hero ? 2.7 : 2.8)));
      }
    }
    renderer.render(scene, camera);
  };

  let raf = 0, t0 = performance.now(), paused = false, visible = true, alive = true;
  const loop = now => {
    if (!alive) return;
    frame((now - t0) / 1000);
    raf = requestAnimationFrame(loop);
  };
  const setRunning = () => {
    const run = alive && !still && !paused && visible;
    if (run && !raf) { raf = requestAnimationFrame(loop); }
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  if (still) frame(30); else setRunning();
  const onVis = () => { paused = document.hidden; setRunning(); };
  document.addEventListener('visibilitychange', onVis);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; setRunning(); });
  io.observe(container);
  opts.onReady?.({ houses: footprints.length, real: map.b?.length || 0 });

  // tap a marker to open it
  let down = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const onDown = e => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = e => {
    if (!opts.onPick || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(markers.map(m => m.icon), false)[0];
    if (hit) opts.onPick(hit.object.userData.point);
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  return function destroy() {
    alive = false; if (raf) cancelAnimationFrame(raf);
    ro.disconnect(); io.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    disposables.forEach(d => d.dispose?.());
    renderer.dispose(); renderer.forceContextLoss?.();
    renderer.domElement.remove();
  };
}
