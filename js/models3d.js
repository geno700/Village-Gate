// Small original low-poly 3D models for village landmarks (mosque, church, school, playground,
// health unit…). Built from three.js primitives, no model files. Units: 1 = 10 m, base at y = 0.
// makeModel(THREE, key, { dark, track }) returns { group, top } or null when the key has no model.

/** How far (metres) a model clears the houses around it. */
export const MODEL_CLEAR = {
  mosque: 18, church: 18, school: 26, kindergarten: 14, youth: 30, health: 22, clinic: 12, pharmacy_place: 8,
  government: 18, police: 14, fire: 16, post: 10, bank: 9, market: 22, bakery_place: 10, fuel_station: 16,
  transport_stop: 10, vet_place: 12, agri_coop: 22, park: 20, cemetery: 26,
};

export function makeModel(THREE, key, { dark = false, track = x => x } = {}) {
  if (!MODEL_CLEAR[key]) return null;
  const mats = new Map();
  const mat = hex => {
    if (!mats.has(hex)) mats.set(hex, track(new THREE.MeshLambertMaterial({ color: hex, flatShading: true, emissive: dark ? hex : 0x000000, emissiveIntensity: dark ? 0.12 : 0 })));
    return mats.get(hex);
  };
  const g = new THREE.Group();
  let top = 1;
  const box = (w, h, d, hex, x = 0, y = 0, z = 0, ry = 0) => {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), mat(hex));
    m.position.set(x, y + h / 2, z); m.rotation.y = ry; g.add(m); top = Math.max(top, y + h); return m;
  };
  const cyl = (rt, rb, h, hex, x = 0, y = 0, z = 0, seg = 10) => {
    const m = new THREE.Mesh(track(new THREE.CylinderGeometry(rt, rb, h, seg)), mat(hex));
    m.position.set(x, y + h / 2, z); g.add(m); top = Math.max(top, y + h); return m;
  };
  const cone = (r, h, hex, x = 0, y = 0, z = 0, seg = 10, rot = 0) => {
    const m = new THREE.Mesh(track(new THREE.ConeGeometry(r, h, seg)), mat(hex));
    m.position.set(x, y + h / 2, z); m.rotation.y = rot; g.add(m); top = Math.max(top, y + h); return m;
  };
  const dome = (r, hex, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(track(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), mat(hex));
    m.position.set(x, y, z); g.add(m); top = Math.max(top, y + r); return m;
  };
  const gable = (w, h, d, hex, x = 0, y = 0, z = 0) => { // triangular roof along x
    const s = new THREE.Shape(); s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(0, h); s.closePath();
    const geo = track(new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }));
    geo.translate(0, 0, -w / 2); geo.rotateY(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat(hex)); m.position.set(x, y, z); g.add(m); top = Math.max(top, y + h); return m;
  };
  const flag = (x, z, h = 2.2) => { // Egyptian flag on a pole
    cyl(0.03, 0.03, h, 0xdddddd, x, 0, z, 6);
    box(0.02, 0.14, 0.6, 0xc8102e, x, h - 0.14, z + 0.3);
    box(0.02, 0.14, 0.6, 0xffffff, x, h - 0.28, z + 0.3);
    box(0.02, 0.14, 0.6, 0x111111, x, h - 0.42, z + 0.3);
  };
  const cross = (hex, x, y, z, s = 1) => { box(0.5 * s, 0.06, 0.16 * s, hex, x, y, z); box(0.16 * s, 0.06, 0.5 * s, hex, x, y, z); };
  const tree = (x, z, h = 0.9) => { cyl(0.05, 0.07, h, 0x8a6a46, x, 0, z, 5); const m = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.35, 0)), mat(0x3f7a33)); m.position.set(x, h + 0.2, z); g.add(m); };
  const W = dark ? 0xd8ccb4 : 0xf1e8d6; // whitewash

  switch (key) {
    case 'mosque': {
      box(2.4, 0.9, 2.4, W);
      box(2.5, 0.08, 2.5, 0xd9c7a3, 0, 0.9, 0);
      cyl(0.95, 0.95, 0.25, W, 0, 0.98, 0, 16);
      dome(0.9, dark ? 0x4fbf8f : 0x2f8f6b, 0, 1.23, 0);
      cone(0.05, 0.35, 0xe0b040, 0, 2.1, 0, 6);
      // minaret
      cyl(0.2, 0.24, 3.4, W, 1.05, 0, -1.05, 10);
      cyl(0.34, 0.34, 0.1, 0xd9c7a3, 1.05, 2.5, -1.05, 12);
      cyl(0.16, 0.2, 0.5, W, 1.05, 3.4, -1.05, 10);
      cone(0.22, 0.6, dark ? 0x4fbf8f : 0x2f8f6b, 1.05, 3.9, -1.05, 10);
      const c = new THREE.Mesh(track(new THREE.TorusGeometry(0.12, 0.03, 6, 12, Math.PI * 1.4)), mat(0xe0b040));
      c.position.set(1.05, 4.75, -1.05); c.rotation.z = 0.7; g.add(c); top = Math.max(top, 4.9);
      break;
    }
    case 'church': {
      box(1.8, 1.1, 2.6, 0xe8dcc8);
      gable(2.6, 0.7, 1.9, 0xa65e46, 0, 1.1, 0);
      box(0.8, 2.6, 0.8, 0xe8dcc8, 0, 0, 1.6);
      cone(0.62, 0.8, 0xa65e46, 0, 2.6, 1.6, 4, Math.PI / 4);
      box(0.06, 0.6, 0.06, 0xe0b040, 0, 3.4, 1.6); box(0.34, 0.06, 0.06, 0xe0b040, 0, 3.75, 1.6);
      break;
    }
    case 'school': case 'kindergarten': {
      const big = key === 'school';
      const wall = big ? 0xe9c46a : 0xf4a6b0;
      box(big ? 3.4 : 1.6, big ? 1.3 : 0.7, 0.9, wall, 0, 0, -0.9);
      box(big ? 3.5 : 1.7, 0.08, 1.0, 0xffffff, 0, big ? 1.3 : 0.7, -0.9);
      if (big) { box(0.9, 1.3, 2.0, wall, -1.25, 0, 0.55); box(3.4, 0.06, 0.05, 0xffffff, 0, 0.62, -0.43); }
      box(big ? 2.4 : 1.4, 0.04, big ? 1.7 : 1.0, 0xd8c39a, big ? 0.5 : 0, 0, big ? 0.8 : 0.4);
      if (big) flag(1.6, 0.4);
      else { box(0.3, 0.3, 0.3, 0xe63946, -0.4, 0.04, 0.4); box(0.3, 0.3, 0.3, 0x2a9d8f, 0.1, 0.04, 0.5); box(0.3, 0.3, 0.3, 0xffb703, 0.45, 0.04, 0.3); }
      break;
    }
    case 'youth': case 'park': {
      if (key === 'youth') {
        const c = document.createElement('canvas'); c.width = 256; c.height = 170;
        const x = c.getContext('2d'); x.fillStyle = dark ? '#2f6b3a' : '#4caf50'; x.fillRect(0, 0, 256, 170);
        x.fillStyle = dark ? '#2a6034' : '#43a047'; for (let i = 0; i < 256; i += 32) x.fillRect(i, 0, 16, 170);
        x.strokeStyle = '#fff'; x.lineWidth = 3; x.strokeRect(6, 6, 244, 158); x.beginPath(); x.moveTo(128, 6); x.lineTo(128, 164); x.stroke();
        x.beginPath(); x.arc(128, 85, 22, 0, Math.PI * 2); x.stroke(); x.strokeRect(6, 50, 30, 70); x.strokeRect(220, 50, 30, 70);
        const tx = track(new THREE.CanvasTexture(c)); tx.colorSpace = THREE.SRGBColorSpace;
        const pitch = new THREE.Mesh(track(new THREE.BoxGeometry(3.8, 0.05, 2.5)), track(new THREE.MeshLambertMaterial({ map: tx })));
        pitch.position.y = 0.03; g.add(pitch);
        for (const sx of [-1, 1]) { // goals
          box(0.05, 0.3, 0.05, 0xffffff, sx * 1.86, 0.05, -0.3); box(0.05, 0.3, 0.05, 0xffffff, sx * 1.86, 0.05, 0.3); box(0.05, 0.05, 0.65, 0xffffff, sx * 1.86, 0.35, 0);
        }
        box(3.4, 0.35, 0.35, 0xb9b2a6, 0, 0, -1.5); box(3.4, 0.2, 0.25, 0xc2502e, 0, 0.35, -1.55);
        flag(-1.95, 1.3, 1.8);
      } else {
        const lawn = new THREE.Mesh(track(new THREE.CylinderGeometry(1.6, 1.6, 0.05, 20)), mat(0x5d9a45)); lawn.position.y = 0.03; g.add(lawn);
        [[-0.8, -0.5], [0.6, -0.8], [0.9, 0.5], [-0.4, 0.8], [0, 0]].forEach(([x, z]) => tree(x, z));
        box(0.6, 0.1, 0.15, 0x8a6a46, 0.3, 0.05, 0.1);
      }
      break;
    }
    case 'health': case 'clinic': case 'vet_place': {
      const big = key === 'health';
      const w = big ? 2.6 : 1.4, d = big ? 1.8 : 1.2, hgt = big ? 1.0 : 0.8;
      box(w, hgt, d, 0xf6f6f2);
      if (big) box(1.6, 0.7, 1.2, 0xf6f6f2, -0.3, hgt, 0);
      box(w + 0.02, 0.12, d + 0.02, key === 'vet_place' ? 0x6aa84f : 0x4a90c2, 0, hgt * 0.55, 0);
      cross(key === 'vet_place' ? 0x2e7d32 : 0xd62828, big ? -0.3 : 0, (big ? hgt + 0.7 : hgt) + 0.01, 0, big ? 1.4 : 1);
      if (big) box(0.8, 0.5, 0.4, 0xffffff, 1.0, 0, 1.1); // ambulance bay
      break;
    }
    case 'pharmacy_place': {
      box(1.1, 0.7, 1.0, 0xf6f6f2);
      box(0.06, 0.5, 0.06, 0xaaaaaa, 0, 0.7, 0);
      box(0.08, 0.36, 0.12, 0x2e9d4a, 0, 1.2, 0); box(0.08, 0.12, 0.36, 0x2e9d4a, 0, 1.32, 0);
      break;
    }
    case 'government': case 'police': case 'post': case 'bank': case 'fire': {
      const col = { government: 0xd9c3a0, police: 0x9fb0c8, post: 0xf2cc5b, bank: 0xb9c7d6, fire: 0xc0392b }[key];
      const [w, hgt, d] = { government: [2.4, 1.1, 1.6], police: [1.8, 0.9, 1.4], post: [1.4, 0.8, 1.2], bank: [1.2, 0.8, 1.0], fire: [2.0, 0.9, 1.4] }[key];
      box(w, hgt, d, col);
      box(w + 0.1, 0.08, d + 0.1, 0xffffff, 0, hgt, 0);
      if (key === 'government') { for (let i = 0; i < 4; i++) cyl(0.07, 0.07, hgt, 0xffffff, -0.9 + i * 0.6, 0, d / 2 + 0.2, 8); box(w, 0.1, 0.5, 0xffffff, 0, hgt - 0.1, d / 2 + 0.2); }
      if (key === 'fire') { box(0.7, 0.6, 0.02, 0x5a1d16, -0.45, 0, d / 2 + 0.01); box(0.7, 0.6, 0.02, 0x5a1d16, 0.45, 0, d / 2 + 0.01); }
      if (key === 'bank') box(0.6, 0.18, 0.02, 0x2e7d32, 0, hgt * 0.6, d / 2 + 0.01);
      if (key === 'government' || key === 'police') flag(w / 2 - 0.2, -d / 2 + 0.2, hgt + 1.3);
      break;
    }
    case 'market': {
      const cols = [0xc2502e, 0xf2c14e, 0x2a9d8f, 0x4a90c2, 0xe76f51, 0x8ab17d];
      for (let i = 0; i < 6; i++) {
        const x = (i % 3 - 1) * 0.9, z = i < 3 ? -0.5 : 0.5;
        box(0.6, 0.3, 0.45, 0xd9c39b, x, 0, z);
        const a = box(0.75, 0.04, 0.6, cols[i], x, 0.5, z); a.rotation.x = i < 3 ? -0.25 : 0.25;
        for (const sx of [-0.33, 0.33]) box(0.03, 0.5, 0.03, 0x8a6a46, x + sx, 0, z + (i < 3 ? 0.25 : -0.25));
      }
      break;
    }
    case 'bakery_place': {
      box(1.3, 0.7, 1.1, 0xd9a77c); box(1.35, 0.08, 1.15, 0xffffff, 0, 0.7, 0);
      cyl(0.1, 0.12, 0.7, 0x5a4636, 0.4, 0.7, -0.3, 8);
      break;
    }
    case 'fuel_station': {
      box(2.0, 0.1, 1.3, 0xffffff, 0, 0.9, 0); box(2.02, 0.06, 1.32, 0xd62828, 0, 0.88, 0);
      for (const [x, z] of [[-0.8, -0.45], [0.8, -0.45], [-0.8, 0.45], [0.8, 0.45]]) box(0.08, 0.9, 0.08, 0xdddddd, x, 0, z);
      box(0.2, 0.4, 0.15, 0xd62828, -0.35, 0, 0); box(0.2, 0.4, 0.15, 0xd62828, 0.35, 0, 0);
      box(0.9, 0.6, 0.7, 0xf6f6f2, 0, 0, 1.2);
      break;
    }
    case 'transport_stop': {
      box(1.4, 0.05, 0.5, 0x4a90c2, 0, 0.6, 0); box(0.05, 0.6, 0.05, 0x999999, -0.6, 0, 0); box(0.05, 0.6, 0.05, 0x999999, 0.6, 0, 0);
      box(1.0, 0.45, 0.45, 0xffffff, 0.1, 0.05, 0.7); box(1.02, 0.12, 0.47, 0x4a90c2, 0.1, 0.3, 0.7);
      break;
    }
    case 'agri_coop': {
      box(2.4, 0.9, 1.4, 0xcfc6b0); gable(2.5, 0.5, 1.5, 0x8d8a86, 0, 0.9, 0);
      cyl(0.38, 0.38, 1.7, 0xc9c9c9, 1.6, 0, 0.2, 12); dome(0.38, 0xb0b0b0, 1.6, 1.7, 0.2);
      flag(-1.3, 0.8, 1.9);
      break;
    }
    case 'cemetery': {
      box(2.8, 0.03, 2.4, 0xd8c39a);
      box(2.8, 0.25, 0.08, 0xcfc6b0, 0, 0, -1.2); box(2.8, 0.25, 0.08, 0xcfc6b0, 0, 0, 1.2);
      box(0.08, 0.25, 2.4, 0xcfc6b0, -1.4, 0, 0); box(0.08, 0.25, 2.4, 0xcfc6b0, 1.4, 0, 0);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) box(0.35, 0.18, 0.5, 0xb9b2a6, -0.9 + i * 0.6, 0, -0.6 + j * 0.6);
      break;
    }
  }
  return { group: g, top };
}
