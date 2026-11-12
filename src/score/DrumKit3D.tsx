import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { engine } from '../audio/engine';
import type { Kit } from '../types';
import type { PadId, Score } from './types';
import { PPQ } from './types';
import type { MutableRefObject } from 'react';
import { DrumKitView } from './DrumKitView';
import { createSticking, stickingFor } from './sticking';
import { PAD_COLOR } from './padColors';
import type { Hand, HandPad } from './sticking';

import { t } from '../i18n';

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

/** 'real' = lacquered shells, coated heads, bronze; 'neon' = see-through glowing kit, one colour per drum (matches the lanes) */
export type KitLook = 'real' | 'neon';

interface StickHit { sec: number; pad: HandPad; v: number }
interface Timeline { L: StickHit[]; R: StickHit[]; kick: number[]; spt: number }

/**
 * When `follow` is on (the app is playing the score), the sticks are driven by the score itself:
 * each stick knows its next note, so it rebounds, travels over and strikes down exactly on time —
 * like real hands. Otherwise (you play) the sticks react to your hits.
 */
export function DrumKit3D({ kit, look = 'real', score, tickRef, bpm, follow = false }: {
  kit: Kit;
  look?: KitLook;
  score?: Score;
  tickRef?: MutableRefObject<number | null>;
  bpm?: number;
  follow?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const kitRef = useRef(kit);
  kitRef.current = kit;
  const followRef = useRef(follow);
  followRef.current = follow && !!tickRef;
  const tickSrc = useRef(tickRef);
  tickSrc.current = tickRef;
  // per-hand list of stick notes in seconds, with the same sticking as the lane view
  const timeline = useRef<Timeline | null>(null);
  useEffect(() => {
    if (!score || !bpm) {
      timeline.current = null;
      return;
    }
    const spt = 60 / (PPQ * bpm);
    const notes = score.notes.slice().sort((a, b) => a.tick - b.tick);
    const hands = stickingFor(notes.map((n) => ({ t: n.tick * spt, pad: n.pad, foot: n.pad === 'hihat' && n.art === 'pedal' })));
    const tl: Timeline = { L: [], R: [], kick: [], spt };
    notes.forEach((n, i) => {
      const h = hands[i];
      if (h) {
        // one stick can only hit one drum at a time (a 3-note chord gives L two notes: keep one)
        const last = tl[h][tl[h].length - 1];
        if (!last || n.tick * spt - last.sec > 0.008) tl[h].push({ sec: n.tick * spt, pad: n.pad as HandPad, v: n.vel });
      }
      else if (n.pad === 'kick') tl.kick.push(n.tick * spt);
    });
    timeline.current = tl;
  }, [score, bpm]);
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
    const neon = look === 'neon';
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = !neon;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'kv3-canvas';
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', t("ชุดกลองสามมิติ ไม้กลองจะตีตามโน้ตที่เล่น คลิกที่กลองเพื่อตี ลากเพื่อหมุนมุมมอง"));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = neon ? 0.25 : 0.55;

    const camera = new THREE.PerspectiveCamera(30, 3, 0.05, 20);
    camera.position.copy(CAM_POS);

    // ---------- lights ----------
    scene.add(new THREE.HemisphereLight(neon ? 0xb8c8ff : 0xfff1dc, neon ? 0x0a0e18 : 0x1a1410, neon ? 0.8 : 0.5));
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

    // neon look: tinted glass shells, dark heads that light up in the drum's colour, glowing rims
    const col = (id: PadId) => new THREE.Color(PAD_COLOR[id]);
    const glass = (id: PadId, opacity = 0.2) =>
      M(new THREE.MeshStandardMaterial({ color: col(id), emissive: col(id), emissiveIntensity: 0.18, transparent: true, opacity, roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    const neonHead = (id: PadId) => M(new THREE.MeshStandardMaterial({ color: 0x0c1220, emissive: col(id), emissiveIntensity: 0.06, transparent: true, opacity: 0.88, roughness: 0.6 }));
    const glow = (id: PadId) => M(new THREE.MeshBasicMaterial({ color: col(id) }));
    const neonLine = M(new THREE.MeshBasicMaterial({ color: 0x4a5a78 }));
    const BASE_GLOW = 0.06;

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const tube = (parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r = 0.011, mat: THREE.Material = neon ? neonLine : chrome) => {
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
        const f = add(g, new THREE.SphereGeometry(0.018, 12, 8), neon ? neonLine : rubber);
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
      add(g, new THREE.CylinderGeometry(r, r, depth, 72, 1, true), neon ? glass(id) : shell, !neon);
      const hm = neon ? neonHead(id) : headMat();
      const top = add(g, new THREE.CircleGeometry(r * 0.99, 72), hm, false);
      top.rotation.x = -Math.PI / 2;
      top.position.y = depth / 2 + 0.002;
      const bottom = add(g, new THREE.CircleGeometry(r * 0.99, 72), neon ? glass(id, 0.12) : logoFront ? headMat(true) : hm, false);
      bottom.rotation.x = Math.PI / 2;
      bottom.position.y = -depth / 2 - 0.002;
      for (const y of [depth / 2 + 0.006, -depth / 2 - 0.006]) {
        const hoop = add(g, new THREE.TorusGeometry(r + 0.004, neon ? 0.005 : 0.0075, 10, 96), neon ? glow(id) : chrome, !neon);
        hoop.rotation.x = Math.PI / 2;
        hoop.position.y = y;
      }
      if (neon) {
        // inner ring on the head, like a target
        const ring = add(g, new THREE.TorusGeometry(r * 0.45, 0.003, 8, 64), glow(id), false);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = depth / 2 + 0.004;
      }
      const n = neon ? 0 : r > 0.2 ? 10 : 8;
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
    const board = add(pedal, new THREE.BoxGeometry(0.085, 0.015, 0.26), neon ? glass('kick', 0.5) : darkMetal);
    board.position.set(0, 0.05, 0.2);
    board.rotation.x = 0.2;
    add(pedal, new THREE.BoxGeometry(0.16, 0.012, 0.09), darkMetal).position.set(0, 0.01, 0.06);
    tube(pedal, new THREE.Vector3(-0.07, 0.01, 0.06), new THREE.Vector3(-0.07, 0.17, 0.06), 0.008, darkMetal);
    tube(pedal, new THREE.Vector3(0.07, 0.01, 0.06), new THREE.Vector3(0.07, 0.17, 0.06), 0.008, darkMetal);
    const beater = new THREE.Group();
    beater.position.set(0, 0.16, 0.07);
    pedal.add(beater);
    tube(beater, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.21, 0), 0.004, chrome);
    const felt = add(beater, new THREE.CylinderGeometry(0.028, 0.028, 0.045, 18), neon ? glow('kick') : M(new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 1 })));
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
      const cm = neon ? glass(id, 0.42) : bronze;
      add(pivot, cymGeo(R), cm, !neon);
      if (neon) {
        const rim = add(pivot, new THREE.TorusGeometry(R, 0.004, 8, 96), glow(id), false);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = -0.016;
      }
      add(pivot, new THREE.CylinderGeometry(0.016, 0.016, 0.02, 16), neon ? neonLine : rubber).position.y = 0.04;
      pivot.traverse((o) => (o.userData.pad = id));
      clickables.push(pivot);
      pivot.updateMatrixWorld(true);
      const flashMat = neon ? (cm as THREE.MeshStandardMaterial) : undefined;
      pads.set(id, { id, root: pivot, baseRot: pivot.rotation.clone(), flashMat, strike: pivot.localToWorld(strikeLocal.clone()), t0: -1, v: 0, cym: true });
      return pivot;
    };
    cymbal('crash', 0.229, new THREE.Vector3(-0.55, 1.2, -0.42), new THREE.Euler(0.38, 0, -0.18), new THREE.Vector3(0.05, 0.0, 0.19));
    cymbal('ride', 0.26, new THREE.Vector3(0.74, 1.03, -0.2), new THREE.Euler(0.26, 0, 0.22), new THREE.Vector3(-0.12, 0.004, 0.1));

    // hi-hat: two cymbals on a stand with a pedal
    const hhX = -0.62, hhZ = 0.03;
    tripod(hhX, hhZ, 0.92, 0.2);
    const hhMat = neon ? glass('hihat', 0.42) : bronze;
    const hhBottom = add(scene, cymGeo(0.178), hhMat, !neon);
    hhBottom.position.set(hhX, 0.875, hhZ);
    hhBottom.rotation.x = Math.PI;
    const hhTop = new THREE.Group();
    hhTop.position.set(hhX, 0.89, hhZ);
    scene.add(hhTop);
    add(hhTop, cymGeo(0.178), hhMat, !neon);
    if (neon) {
      const rim = add(hhTop, new THREE.TorusGeometry(0.178, 0.004, 8, 96), glow('hihat'), false);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = -0.016;
    }
    add(hhTop, new THREE.CylinderGeometry(0.014, 0.014, 0.03, 12), neon ? neonLine : darkMetal).position.y = 0.04;
    hhTop.traverse((o) => (o.userData.pad = 'hihat'));
    hhBottom.userData.pad = 'hihat';
    clickables.push(hhTop, hhBottom);
    hhTop.updateMatrixWorld(true);
    pads.set('hihat', { id: 'hihat', root: hhTop, baseRot: hhTop.rotation.clone(), flashMat: neon ? (hhMat as THREE.MeshStandardMaterial) : undefined, strike: hhTop.localToWorld(new THREE.Vector3(0.11, 0.0, 0.1)), t0: -1, v: 0, cym: true });
    const hhPedal = new THREE.Group();
    hhPedal.position.set(hhX + 0.03, 0.03, hhZ + 0.08);
    scene.add(hhPedal);
    add(hhPedal, new THREE.BoxGeometry(0.085, 0.015, 0.25), neon ? glass('hihat', 0.5) : darkMetal).position.set(0, 0.02, 0.12);
    hhPedal.rotation.x = -0.12;
    let hhPedalT = -1;

    // floor: a rug, or a glowing grid for the neon look
    if (neon) {
      const grid = new THREE.GridHelper(3.2, 16, 0x31415f, 0x1f2a40);
      grid.position.set(0, 0.002, 0.1);
      scene.add(grid);
    } else {
      const rug = add(scene, new THREE.CircleGeometry(1.7, 64), M(new THREE.MeshStandardMaterial({ color: 0x3a2b22, roughness: 1 })), false);
      rug.rotation.x = -Math.PI / 2;
      rug.position.z = 0.1;
    }

    // ---------- sticks ----------
    const stickGeo = (() => {
      const L = STICK_LEN;
      const prof = [
        [0, -0.011], [0.0055, -0.009], [0.007, -0.004], [0.0056, 0.004], [0.004, 0.012], [0.0046, 0.03],
        [0.0088, 0.11], [0.009, L - 0.006], [0.0075, L], [0, L]
      ].map(([x, y]) => new THREE.Vector2(x, y));
      return new THREE.LatheGeometry(prof, 18);
    })();
    const stickMat = neon ? M(new THREE.MeshBasicMaterial({ color: 0xf2f4f8 })) : wood;
    const sticks: Record<Hand, { mesh: THREE.Mesh; target: THREE.Vector3; hand: THREE.Vector3; t0: number; up: number; from?: { tip: THREE.Vector3; hand: THREE.Vector3 } }> = {
      L: { mesh: add(scene, stickGeo, stickMat), target: pads.get(IDLE.L)!.strike.clone(), hand: HAND_BASE.L.clone(), t0: -10, up: 0.12 },
      R: { mesh: add(scene, stickGeo, stickMat), target: pads.get(IDLE.R)!.strike.clone(), hand: HAND_BASE.R.clone(), t0: -10, up: 0.12 }
    };
    // round labels: L / R near the butt of each stick, RF on the kick pedal, LF on the hi-hat pedal
    const badgeTex: THREE.Texture[] = [];
    const badge = (text: string, size = 0.07) => {
      const t = canvasTex(128, 128, (g) => {
        g.fillStyle = '#f3f5fa';
        g.beginPath();
        g.arc(64, 64, 58, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 6;
        g.strokeStyle = 'rgba(20,26,40,0.5)';
        g.stroke();
        g.fillStyle = '#1b2233';
        g.font = `800 ${text.length > 1 ? 50 : 66}px "Bai Jamjuree", system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, 64, 68);
      });
      badgeTex.push(t);
      const sp = new THREE.Sprite(M(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })));
      sp.scale.set(size, size, 1);
      sp.renderOrder = 10;
      scene.add(sp);
      return sp;
    };
    const showBadges = neon;
    const badges = showBadges ? { L: badge('L'), R: badge('R') } : null;
    const rf = showBadges ? badge('RF', 0.08) : null;
    rf?.position.set(0, 0.12, 0.3);
    const lf = showBadges ? badge('LF', 0.08) : null;
    lf?.position.set(-0.59, 0.12, 0.25);
    const Y = new THREE.Vector3(0, 1, 0);
    const tmp = new THREE.Vector3();
    const handFor = (h: Hand, target: THREE.Vector3) => {
      // the hand stays near the drummer but leans toward the drum it plays
      const base = HAND_BASE[h];
      const dir = base.clone().sub(target).normalize();
      return target.clone().addScaledVector(dir, STICK_LEN * 0.92);
    };
    for (const h of ['L', 'R'] as Hand[]) sticks[h].hand = handFor(h, sticks[h].target);
    const lerpV = (a: THREE.Vector3, b: THREE.Vector3, k: number) => a.clone().lerp(b, k);
    const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const restOf = (h: Hand) => pads.get(IDLE[h])!.strike;
    const place = (h: Hand, tipPos: THREE.Vector3, handPos: THREE.Vector3) => {
      const s = sticks[h];
      s.mesh.position.copy(tipPos);
      tmp.copy(handPos).sub(tipPos).normalize();
      s.mesh.quaternion.setFromUnitVectors(Y, tmp);
      if (badges) badges[h].position.copy(tipPos).addScaledVector(tmp, STICK_LEN * 0.9);
    };
    const lastPose: Record<Hand, { tip: THREE.Vector3; hand: THREE.Vector3 }> = {
      L: { tip: restOf('L').clone(), hand: handFor('L', restOf('L')) },
      R: { tip: restOf('R').clone(), hand: handFor('R', restOf('R')) }
    };
    const up = (p: THREE.Vector3, back: THREE.Vector3, hgt: number) => p.clone().addScaledVector(Y, hgt).addScaledVector(back, hgt * 0.25);
    /** score-driven: where is this hand between its previous and next note? */
    const followPose = (h: Hand, sec: number) => {
      const list = timeline.current![h];
      let lo = 0, hi = list.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (list[m].sec <= sec) lo = m + 1;
        else hi = m;
      }
      const prev = list[lo - 1], next = list[lo];
      const A = prev ? pads.get(prev.pad)!.strike : restOf(h);
      const hA = handFor(h, A);
      // after a hit the stick rebounds and hovers above that drum
      const restH = 0.13 * (prev ? smooth((sec - prev.sec) / 0.22) : 1);
      if (!next || next.sec - sec > 1.4) {
        const back = tmp2.copy(hA).sub(A).normalize();
        return { tip: up(A, back, restH), hand: hA };
      }
      const B = pads.get(next.pad)!.strike;
      const hB = handFor(h, B);
      const t0 = prev && next.sec - prev.sec < 1.4 ? prev.sec : next.sec - 0.5;
      const dur = Math.max(0.03, next.sec - t0);
      const u = Math.min(1, Math.max(0, (sec - t0) / dur));
      // lift height grows with the time available and with how hard the next note is
      const H = Math.min(0.2, 0.025 + 0.32 * dur) * (0.55 + 0.45 * (next.v / 127));
      const fromRest = !prev || next.sec - prev.sec >= 1.4;
      // quick rebound, glide over, accelerate down onto the next note
      const hgt = fromRest ? H + (restH - H) * (1 - smooth(u)) * (1 - u ** 3) - H * u ** 3 : H * Math.sin(Math.PI * u ** 0.72);
      const travel = smooth((u - 0.08) / 0.72);
      const tipBase = lerpV(A, B, travel);
      const handPos = lerpV(hA, hB, travel);
      const back = tmp2.copy(handPos).sub(tipBase).normalize();
      return { tip: up(tipBase, back, Math.max(0, hgt)), hand: handPos };
    };
    const tmp2 = new THREE.Vector3();
    const poseStick = (h: Hand, now: number) => {
      const tr = tickSrc.current?.current;
      if (followRef.current && timeline.current && tr != null && !reduce) {
        const sec = tr * timeline.current.spt;
        const p = followPose(h, sec);
        lastPose[h] = p;
        const s = sticks[h];
        s.target = p.tip.clone();
        s.hand = p.hand.clone();
        s.up = 0;
        s.t0 = 0;
        s.from = undefined;
        place(h, p.tip, p.hand);
        return;
      }
      // live: glide to the drum in 30 ms, then rebound
      const s = sticks[h];
      const dt = now - s.t0;
      const back = tmp2.copy(s.hand).sub(s.target).normalize();
      if (!reduce && dt < 0.03 && s.from) {
        const k = smooth(dt / 0.03);
        const tipPos = lerpV(s.from.tip, s.target, k);
        const handPos = lerpV(s.from.hand, s.hand, k);
        lastPose[h] = { tip: tipPos, hand: handPos };
        place(h, tipPos, handPos);
        return;
      }
      const k = reduce ? 1 : Math.min(1, (dt - 0.03) / 0.2);
      const lift = s.up * (1 - (1 - Math.max(0, k)) ** 3);
      const tipPos = up(s.target, back, lift);
      lastPose[h] = { tip: tipPos, hand: s.hand.clone() };
      place(h, tipPos, s.hand);
    };

    // ---------- reacting to hits ----------
    let busyUntil = 0;
    const wake = (sec = 1.4) => (busyUntil = Math.max(busyUntil, performance.now() / 1000 + sec));
    const sticking = createSticking((hand, id, v) => {
      const p = pads.get(id);
      if (!p) return;
      if (followRef.current) return; // the score drives the sticks
      const s = sticks[hand];
      s.from = { tip: lastPose[hand].tip.clone(), hand: lastPose[hand].hand.clone() };
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
      if (followRef.current && tickSrc.current?.current != null) wake(0.3);
      if (now > busyUntil) return;
      for (const p of pads.values()) {
        const dt = now - p.t0;
        if (p.t0 < 0 || dt > 2.5) {
          if (p.flashMat) p.flashMat.emissiveIntensity = neon ? (p.cym ? 0.18 : BASE_GLOW) : 0;
          if (p.cym) p.root.rotation.copy(p.baseRot);
          continue;
        }
        const k = p.v / 127;
        if (p.flashMat) {
          const base = neon ? (p.cym ? 0.18 : BASE_GLOW) : 0;
          p.flashMat.emissiveIntensity = reduce ? base : base + (neon ? 1.4 : 0.28) * k * Math.exp(-dt * 9);
        }
        if (p.cym && !reduce) {
          const a = 0.07 * k * Math.exp(-dt * 3.2) * Math.cos(dt * 24);
          p.root.rotation.set(p.baseRot.x + a, p.baseRot.y, p.baseRot.z + a * 0.4);
        }
      }
      // kick beater: at the head on the hit, then swings back
      const kd = now - kickT;
      const trk = tickSrc.current?.current;
      if (followRef.current && timeline.current && trk != null && !reduce) {
        // beater swings in to land on the note, then bounces back
        const sec = trk * timeline.current.spt, ks = timeline.current.kick;
        let lo = 0, hi = ks.length;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (ks[m] <= sec) lo = m + 1;
          else hi = m;
        }
        const since = lo > 0 ? sec - ks[lo - 1] : 9, until = lo < ks.length ? ks[lo] - sec : 9;
        const back = 1 - Math.exp(-since * 16);
        const pre = until < 0.09 ? smooth(1 - until / 0.09) : 0;
        const k = Math.max(1 - back, pre);
        beater.rotation.x = BEATER_REST + (BEATER_HIT - BEATER_REST) * k;
      } else beater.rotation.x = kickT < 0 || reduce ? BEATER_REST : BEATER_HIT + (BEATER_REST - BEATER_HIT) * (1 - Math.exp(-kd * 16));
      // hi-hat pedal: cymbals clap together, then open again
      const hd = now - hhPedalT;
      const close = hhPedalT < 0 ? 0 : Math.exp(-hd * 7);
      hhTop.position.y = 0.89 - 0.012 * close;
      hhPedal.rotation.x = -0.12 + 0.12 * close;
      if (rf) rf.scale.setScalar(0.08 * (1 + 0.35 * (kickT < 0 ? 0 : Math.exp(-kd * 10))));
      if (lf) lf.scale.setScalar(0.08 * (1 + 0.35 * close));
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
      [sparkle, lathe, coated, logo, envTex, ...badgeTex].forEach((t) => t.dispose());
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [look]);

  if (noGL) return <DrumKitView kit={kit} />;
  return <div ref={host} className="kv3" />;
}
