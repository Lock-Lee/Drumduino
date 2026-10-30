import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { engine } from '../audio/engine';
import type { Kit } from '../types';
import type { PadId } from './types';
import { DrumKitView } from './DrumKitView';
import { createSticking } from './sticking';
import type { Hand, HandPad } from './sticking';

/**
 * A 3-D acoustic drum kit for the practice page, seen from just behind the drummer's seat.
 * Every hit the engine reports swings a stick onto that drum or cymbal (with real sticking from
 * ./sticking), dips the cymbal, or kicks the bass-drum beater. Drag to look around, click a drum to hit it.
 * Units are metres; +z points at the drummer, +x is the drummer's right.
 * Falls back to the flat SVG kit when WebGL is not available.
 */

const STICK_LEN = 0.41;
const CAM_POS = new THREE.Vector3(0.05, 1.95, 2.55);
const CAM_TARGET = new THREE.Vector3(0.05, 0.72, -0.1);
const HAND_BASE: Record<Hand, THREE.Vector3> = { L: new THREE.Vector3(-0.17, 0.95, 0.5), R: new THREE.Vector3(0.17, 0.95, 0.5) };
const IDLE: Record<Hand, HandPad> = { L: 'snare', R: 'hihat' };

// ---------- procedural textures ----------
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function sparkleTex() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const v = 180 + Math.random() * 75;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 1.2, 1.2);
    }
  });
}
/** cymbal lathing: fine concentric grooves (runs along the lathe profile = texture v) */
function lathingTex() {
  const t = canvasTex(8, 1024, (g) => {
    for (let y = 0; y < 1024; y++) {
      const v = 120 + 70 * Math.sin(y * 1.9) * Math.sin(y * 0.13) + Math.random() * 40;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, y, 8, 1);
    }
  }, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function headTex(logo: boolean) {
  return canvasTex(512, 512, (g) => {
    const grd = g.createRadialGradient(256, 256, 30, 256, 256, 256);
    if (logo) {
      grd.addColorStop(0, '#202024');
      grd.addColorStop(1, '#0d0d10');
    } else {
      grd.addColorStop(0, '#f1ede4');
      grd.addColorStop(0.85, '#e7e2d6');
      grd.addColorStop(1, '#cfc8b8');
    }
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 512);
    // coated texture
    for (let i = 0; i < 9000; i++) {
      const a = logo ? 40 : 205 + Math.random() * 40;
      g.fillStyle = `rgba(${a},${a},${a - 6},0.25)`;
      g.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
    }
    if (logo) {
      g.strokeStyle = '#c9ccd3';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(256, 256, 236, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#ece8de';
      g.font = 'bold 64px "Bai Jamjuree", system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('DrumDuino', 256, 220);
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(330, 360, 52, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#8b8e95';
      g.lineWidth = 5;
      g.stroke();
    } else {
      // stick wear in the middle
      const w = g.createRadialGradient(256, 290, 4, 256, 290, 90);
      w.addColorStop(0, 'rgba(150,140,120,0.35)');
      w.addColorStop(1, 'rgba(150,140,120,0)');
      g.fillStyle = w;
      g.fillRect(0, 0, 512, 512);
    }
  });
}

interface PadVis {
  id: PadId;
  root: THREE.Object3D; // moves for cymbal wobble
  baseRot: THREE.Euler;
  flashMat?: THREE.MeshStandardMaterial;
  strike: THREE.Vector3; // world-space contact point
  t0: number;
  v: number;
  cym: boolean;
}

export function DrumKit3D({ kit }: { kit: Kit }) {
  const host = useRef<HTMLDivElement>(null);
  const kitRef = useRef(kit);
  kitRef.current = kit;
  const [noGL, setNoGL] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      setNoGL(true);
      return;
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'kv3-canvas';
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', 'ชุดกลองสามมิติ ไม้กลองจะตีตามโน้ตที่เล่น คลิกที่กลองเพื่อตี ลากเพื่อหมุนมุมมอง');
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.55;

    const camera = new THREE.PerspectiveCamera(30, 3, 0.05, 20);
    camera.position.copy(CAM_POS);

    // ---------- lights ----------
    scene.add(new THREE.HemisphereLight(0xfff1dc, 0x1a1410, 0.5));
    const key = new THREE.DirectionalLight(0xfff0d8, 2.2);
    key.position.set(1.4, 3.2, 1.8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -1.6;
    key.shadow.camera.right = key.shadow.camera.top = 1.6;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.SpotLight(0xffb45c, 18, 6, 0.6, 0.6);
    rim.position.set(-1.6, 2.4, -1.8);
    rim.target.position.set(0, 0.6, 0);
    scene.add(rim, rim.target);

    // ---------- materials ----------
    const sparkle = sparkleTex();
    const lathe = lathingTex();
    const mats: THREE.Material[] = [];
    const M = <T extends THREE.Material>(m: T) => (mats.push(m), m);
    const chrome = M(new THREE.MeshStandardMaterial({ color: 0xe6e9ee, metalness: 1, roughness: 0.16 }));
    const darkMetal = M(new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.7, roughness: 0.45 }));
    const rubber = M(new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 }));
    const shellRed = M(new THREE.MeshPhysicalMaterial({ color: 0x9a1f1c, map: sparkle, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 }));
    const shellSnare = M(new THREE.MeshStandardMaterial({ color: 0xcfd3da, metalness: 1, roughness: 0.22 }));
    const bronze = M(new THREE.MeshPhysicalMaterial({ color: 0xc89b45, metalness: 1, roughness: 0.3, roughnessMap: lathe, bumpMap: lathe, bumpScale: 0.4, side: THREE.DoubleSide, clearcoat: 0.3 }));
    const wood = M(new THREE.MeshStandardMaterial({ color: 0xd8b585, roughness: 0.55 }));
    const coated = headTex(false);
    const logo = headTex(true);
    const accent = new THREE.Color(0xf2a93b);
    const headMat = (logoHead = false) => M(new THREE.MeshStandardMaterial({ map: logoHead ? logo : coated, roughness: 0.85, emissive: accent, emissiveIntensity: 0 }));

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const tube = (parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r = 0.011, mat = chrome) => {
      const d = b.clone().sub(a);
      const m = add(parent, new THREE.CylinderGeometry(r, r, d.length(), 14), mat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      return m;
    };
    const tripod = (x: number, z: number, top: number, spread = 0.22) => {
      const g = new THREE.Group();
      scene.add(g);
      const hub = new THREE.Vector3(x, 0.28, z);
      tube(g, new THREE.Vector3(x, 0.02, z).setY(0.2), new THREE.Vector3(x, top, z), 0.012);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const foot = new THREE.Vector3(x + Math.cos(a) * spread, 0.012, z + Math.sin(a) * spread);
        tube(g, hub, foot, 0.009);
        const f = add(g, new THREE.SphereGeometry(0.018, 12, 8), rubber);
        f.position.copy(foot);
        f.scale.y = 0.6;
      }
      return g;
    };

    const pads = new Map<PadId, PadVis>();
    const clickables: THREE.Object3D[] = [];

    // ---------- drums ----------
    const drum = (id: PadId, r: number, depth: number, shell: THREE.Material, pos: THREE.Vector3, rot: THREE.Euler, strikeLocal: THREE.Vector3, logoFront = false) => {
      const g = new THREE.Group();
      g.position.copy(pos);
      g.rotation.copy(rot);
      scene.add(g);
      add(g, new THREE.CylinderGeometry(r, r, depth, 72, 1, true), shell);
      const hm = headMat();
      const top = add(g, new THREE.CircleGeometry(r * 0.99, 72), hm, false);
      top.rotation.x = -Math.PI / 2;
      top.position.y = depth / 2 + 0.002;
      const bottom = add(g, new THREE.CircleGeometry(r * 0.99, 72), logoFront ? headMat(true) : hm, false);
      bottom.rotation.x = Math.PI / 2;
      bottom.position.y = -depth / 2 - 0.002;
      for (const y of [depth / 2 + 0.006, -depth / 2 - 0.006]) {
        const hoop = add(g, new THREE.TorusGeometry(r + 0.004, 0.0075, 10, 96), chrome);
        hoop.rotation.x = Math.PI / 2;
        hoop.position.y = y;
      }
      const n = r > 0.2 ? 10 : 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const lug = add(g, new THREE.CapsuleGeometry(0.008, Math.min(0.06, depth * 0.3), 4, 8), chrome);
        lug.position.set(Math.cos(a) * (r + 0.009), 0, Math.sin(a) * (r + 0.009));
        for (const s of [1, -1]) {
          const rod = add(g, new THREE.CylinderGeometry(0.003, 0.003, depth * 0.5 - 0.02, 6), chrome);
          rod.position.set(Math.cos(a) * (r + 0.006), s * (depth * 0.25 + 0.01), Math.sin(a) * (r + 0.006));
        }
      }
      g.traverse((o) => (o.userData.pad = id));
      clickables.push(g);
      g.updateMatrixWorld(true);
      pads.set(id, { id, root: g, baseRot: g.rotation.clone(), flashMat: hm, strike: g.localToWorld(strikeLocal.clone()), t0: -1, v: 0, cym: false });
      return g;
    };

    // kick (on its side, batter head toward the drummer)
    const kick = drum('kick', 0.28, 0.42, shellRed, new THREE.Vector3(0, 0.3, -0.2), new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(0, 0.21, 0), true);
    for (const s of [-1, 1]) tube(scene, new THREE.Vector3(s * 0.25, 0.22, -0.3), new THREE.Vector3(s * 0.42, 0.01, -0.22), 0.009);
    void kick;
    // pedal + beater
    const pedal = new THREE.Group();
    scene.add(pedal);
    const board = add(pedal, new THREE.BoxGeometry(0.085, 0.015, 0.26), darkMetal);
    board.position.set(0, 0.05, 0.2);
    board.rotation.x = 0.2;
    add(pedal, new THREE.BoxGeometry(0.16, 0.012, 0.09), darkMetal).position.set(0, 0.01, 0.06);
    tube(pedal, new THREE.Vector3(-0.07, 0.01, 0.06), new THREE.Vector3(-0.07, 0.17, 0.06), 0.008, darkMetal);
    tube(pedal, new THREE.Vector3(0.07, 0.01, 0.06), new THREE.Vector3(0.07, 0.17, 0.06), 0.008, darkMetal);
    const beater = new THREE.Group();
    beater.position.set(0, 0.16, 0.07);
    pedal.add(beater);
    tube(beater, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.21, 0), 0.004, chrome);
    const felt = add(beater, new THREE.CylinderGeometry(0.028, 0.028, 0.045, 18), M(new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 1 })));
    felt.position.y = 0.21;
    felt.rotation.z = Math.PI / 2;
    const BEATER_REST = 0.42, BEATER_HIT = -0.12;
    beater.rotation.x = BEATER_REST;

    // snare (metal shell) on its stand
    drum('snare', 0.178, 0.14, shellSnare, new THREE.Vector3(-0.29, 0.63, 0.12), new THREE.Euler(0.14, 0, 0.04), new THREE.Vector3(0.01, 0.075, 0.05));
    tripod(-0.29, 0.12, 0.55);

    // rack toms on the kick
    drum('tom1', 0.152, 0.2, shellRed, new THREE.Vector3(-0.15, 0.86, -0.17), new THREE.Euler(0.5, 0, -0.14), new THREE.Vector3(0, 0.105, 0.04));
    drum('tom2', 0.165, 0.22, shellRed, new THREE.Vector3(0.19, 0.87, -0.17), new THREE.Euler(0.5, 0, 0.14), new THREE.Vector3(0, 0.115, 0.04));
    tube(scene, new THREE.Vector3(0, 0.58, -0.2), new THREE.Vector3(-0.12, 0.76, -0.2), 0.011);
    tube(scene, new THREE.Vector3(0, 0.58, -0.2), new THREE.Vector3(0.16, 0.77, -0.2), 0.011);
    add(scene, new THREE.CylinderGeometry(0.03, 0.03, 0.04, 16), chrome).position.set(0, 0.585, -0.2);

    // floor tom on legs
    const fl = drum('floor', 0.203, 0.4, shellRed, new THREE.Vector3(0.48, 0.47, 0.12), new THREE.Euler(0.06, 0, 0.06), new THREE.Vector3(-0.02, 0.205, 0.05));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      const p = new THREE.Vector3(Math.cos(a) * 0.225, 0.08, Math.sin(a) * 0.225);
      const top = fl.localToWorld(p.clone());
      tube(scene, top, new THREE.Vector3(top.x + Math.cos(a) * 0.05, 0.015, top.z + Math.sin(a) * 0.05), 0.008);
    }

    // ---------- cymbals ----------
    const cymGeo = (R: number) => {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 40; i++) {
        const r = (i / 40) * R;
        const bell = 0.058;
        const y = r < bell ? 0.03 * Math.cos((r / bell) * Math.PI * 0.5) ** 0.6 + 0.004 : 0.004 - ((r - bell) / (R - bell)) ** 1.15 * 0.02;
        pts.push(new THREE.Vector2(Math.max(r, 0.0001), y));
      }
      return new THREE.LatheGeometry(pts, 96);
    };
    const cymbal = (id: PadId, R: number, stand: THREE.Vector3, rot: THREE.Euler, strikeLocal: THREE.Vector3) => {
      tripod(stand.x, stand.z, stand.y - 0.03);
      const pivot = new THREE.Group();
      pivot.position.copy(stand);
      pivot.rotation.copy(rot);
      scene.add(pivot);
      const mesh = add(pivot, cymGeo(R), bronze);
      void mesh;
      add(pivot, new THREE.CylinderGeometry(0.016, 0.016, 0.02, 16), rubber).position.y = 0.04;
      pivot.traverse((o) => (o.userData.pad = id));
      clickables.push(pivot);
      pivot.updateMatrixWorld(true);
      const flashMat = undefined;
      pads.set(id, { id, root: pivot, baseRot: pivot.rotation.clone(), flashMat, strike: pivot.localToWorld(strikeLocal.clone()), t0: -1, v: 0, cym: true });
      return pivot;
    };
    cymbal('crash', 0.229, new THREE.Vector3(-0.55, 1.2, -0.42), new THREE.Euler(0.38, 0, -0.18), new THREE.Vector3(0.05, 0.0, 0.19));
    cymbal('ride', 0.26, new THREE.Vector3(0.74, 1.03, -0.2), new THREE.Euler(0.26, 0, 0.22), new THREE.Vector3(-0.12, 0.004, 0.1));

    // hi-hat: two cymbals on a stand with a pedal
    const hhX = -0.62, hhZ = 0.03;
    tripod(hhX, hhZ, 0.92, 0.2);
    const hhBottom = add(scene, cymGeo(0.178), bronze);
    hhBottom.position.set(hhX, 0.875, hhZ);
    hhBottom.rotation.x = Math.PI;
    const hhTop = new THREE.Group();
    hhTop.position.set(hhX, 0.89, hhZ);
    scene.add(hhTop);
    add(hhTop, cymGeo(0.178), bronze);
    add(hhTop, new THREE.CylinderGeometry(0.014, 0.014, 0.03, 12), darkMetal).position.y = 0.04;
    hhTop.traverse((o) => (o.userData.pad = 'hihat'));
    hhBottom.userData.pad = 'hihat';
    clickables.push(hhTop, hhBottom);
    hhTop.updateMatrixWorld(true);
    pads.set('hihat', { id: 'hihat', root: hhTop, baseRot: hhTop.rotation.clone(), strike: hhTop.localToWorld(new THREE.Vector3(0.11, 0.0, 0.1)), t0: -1, v: 0, cym: true });
    const hhPedal = new THREE.Group();
    hhPedal.position.set(hhX + 0.03, 0.03, hhZ + 0.08);
    scene.add(hhPedal);
    add(hhPedal, new THREE.BoxGeometry(0.085, 0.015, 0.25), darkMetal).position.set(0, 0.02, 0.12);
    hhPedal.rotation.x = -0.12;
    let hhPedalT = -1;

    // floor rug
    const rug = add(scene, new THREE.CircleGeometry(1.7, 64), M(new THREE.MeshStandardMaterial({ color: 0x3a2b22, roughness: 1 })), false);
    rug.rotation.x = -Math.PI / 2;
    rug.position.z = 0.1;

    // ---------- sticks ----------
    const stickGeo = (() => {
      const L = STICK_LEN;
      const prof = [
        [0, -0.011], [0.0055, -0.009], [0.007, -0.004], [0.0056, 0.004], [0.004, 0.012], [0.0046, 0.03],
        [0.0088, 0.11], [0.009, L - 0.006], [0.0075, L], [0, L]
      ].map(([x, y]) => new THREE.Vector2(x, y));
      return new THREE.LatheGeometry(prof, 18);
    })();
    const sticks: Record<Hand, { mesh: THREE.Mesh; target: THREE.Vector3; hand: THREE.Vector3; t0: number; up: number }> = {
      L: { mesh: add(scene, stickGeo, wood), target: pads.get(IDLE.L)!.strike.clone(), hand: HAND_BASE.L.clone(), t0: -10, up: 0.12 },
      R: { mesh: add(scene, stickGeo, wood), target: pads.get(IDLE.R)!.strike.clone(), hand: HAND_BASE.R.clone(), t0: -10, up: 0.12 }
    };
    const Y = new THREE.Vector3(0, 1, 0);
    const tmp = new THREE.Vector3();
    const tip = new THREE.Vector3();
    const handFor = (h: Hand, target: THREE.Vector3) => {
      // the hand stays near the drummer but leans toward the drum it plays
      const base = HAND_BASE[h];
      const dir = base.clone().sub(target).normalize();
      return target.clone().addScaledVector(dir, STICK_LEN * 0.92);
    };
    for (const h of ['L', 'R'] as Hand[]) sticks[h].hand = handFor(h, sticks[h].target);
    const poseStick = (h: Hand, now: number) => {
      const s = sticks[h];
      const k = reduce ? 1 : Math.min(1, (now - s.t0) / 0.17);
      const lift = s.up * (1 - (1 - k) ** 3); // ease-out: contact → raised
      const back = tmp.copy(s.hand).sub(s.target).normalize();
      tip.copy(s.target).addScaledVector(Y, lift).addScaledVector(back, lift * 0.25);
      s.mesh.position.copy(tip);
      s.mesh.quaternion.setFromUnitVectors(Y, tmp.copy(s.hand).sub(tip).normalize());
    };

    // ---------- reacting to hits ----------
    let busyUntil = 0;
    const wake = (sec = 1.4) => (busyUntil = Math.max(busyUntil, performance.now() / 1000 + sec));
    const sticking = createSticking((hand, id, v) => {
      const p = pads.get(id);
      if (!p) return;
      const s = sticks[hand];
      s.target = p.strike.clone();
      s.hand = handFor(hand, s.target);
      s.t0 = performance.now() / 1000;
      s.up = 0.07 + 0.11 * (v / 127);
      wake();
    });
    let kickT = -1;
    const off = engine.onHit((padId, v, zone) => {
      const id = padId as PadId;
      const now = performance.now() / 1000;
      const p = pads.get(id);
      if (id === 'hihat' && zone === 'pedal') {
        hhPedalT = now;
        wake();
        return;
      }
      if (p) {
        p.t0 = now;
        p.v = v;
      }
      if (id === 'kick') {
        kickT = now;
        wake();
        return;
      }
      if (p) sticking.push(id as HandPad, v);
      wake();
    });

    // ---------- click to hit, drag to look around ----------
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(CAM_TARGET);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 1.3;
    controls.maxDistance = 4;
    controls.minPolarAngle = 0.5;
    controls.maxPolarAngle = 1.45;
    controls.minAzimuthAngle = -1.1;
    controls.maxAzimuthAngle = 1.1;
    controls.addEventListener('change', () => wake(0.3));
    controls.update();
    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(clickables, true)[0];
      const id = hit?.object.userData.pad as PadId | undefined;
      const pad = id && kitRef.current.pads.find((x) => x.id === id);
      if (pad) engine.play(pad, 100, 'ui');
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    // ---------- size ----------
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w < 10 || h < 10) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      wake(0.2);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // ---------- loop (renders only while something moves) ----------
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now() / 1000;
      controls.update();
      if (now > busyUntil) return;
      for (const p of pads.values()) {
        const dt = now - p.t0;
        if (p.t0 < 0 || dt > 2.5) {
          if (p.flashMat) p.flashMat.emissiveIntensity = 0;
          if (p.cym) p.root.rotation.copy(p.baseRot);
          continue;
        }
        const k = p.v / 127;
        if (p.flashMat) p.flashMat.emissiveIntensity = reduce ? 0 : 0.28 * k * Math.exp(-dt * 9);
        if (p.cym && !reduce) {
          const a = 0.07 * k * Math.exp(-dt * 3.2) * Math.cos(dt * 24);
          p.root.rotation.set(p.baseRot.x + a, p.baseRot.y, p.baseRot.z + a * 0.4);
        }
      }
      // kick beater: at the head on the hit, then swings back
      const kd = now - kickT;
      beater.rotation.x = kickT < 0 || reduce ? BEATER_REST : BEATER_HIT + (BEATER_REST - BEATER_HIT) * (1 - Math.exp(-kd * 16));
      // hi-hat pedal: cymbals clap together, then open again
      const hd = now - hhPedalT;
      const close = hhPedalT < 0 ? 0 : Math.exp(-hd * 7);
      hhTop.position.y = 0.89 - 0.012 * close;
      hhPedal.rotation.x = -0.12 + 0.12 * close;
      poseStick('L', now);
      poseStick('R', now);
      renderer.render(scene, camera);
    };
    wake(0.5);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      off();
      sticking.dispose();
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      scene.traverse((o) => {
        if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
      });
      mats.forEach((m) => m.dispose());
      [sparkle, lathe, coated, logo, envTex].forEach((t) => t.dispose());
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  if (noGL) return <DrumKitView kit={kit} />;
  return <div ref={host} className="kv3" />;
}
