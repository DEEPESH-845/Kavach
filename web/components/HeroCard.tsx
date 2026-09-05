'use client';

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useStill } from '@/lib/motion';

/* THE INSTRUMENT.
 *
 * The hero argues about authority over a payment; the right column shows the thing the
 * authority is over. A card turns on its own axis inside a ring of the page's own split
 * cells — the same primitive as the ambient field, at a scale you can grab.
 *
 * Two motions, both clockwise, and each says something:
 *   · the card turns about Y (clockwise seen from above) — the instrument, always live
 *   · the cell ring turns about Z (clockwise on screen)  — the field watching it
 *
 * Colour follows the page's one rule: steel = provable, amber = learned/advisory,
 * bone = decided. The chip is amber because a mandate is a claim, not a proof.
 *
 * Everything is loaded on demand. three.js never enters the bundle a phone downloads:
 * the import only runs once the layout is wide enough and the pointer is a real one,
 * because a single-finger drag on a touch screen is the page's scroll, not ours.
 */

const CARD = { w: 3.36, h: 2.12, d: 0.13, r: 0.2 };
const RING_R = 2.16;          // the cell ring, outside the card's swept corners (1.99)
const FIT_R = 2.4;           // what the camera must always contain
const TILT = -0.17;           // a shade from above, so the card reads as an object

const C = {
  body: 0x1b2429, chip: 0xe0a340, steel: 0x7fa8c9,
  bone: 0xe9e6de, seam: 0x3f4c53, dark: 0x090b0c,
} as const;

/** the page's rounded rectangle, as a 2D shape to extrude */
function roundedRect(S: typeof import('three').Shape, w: number, h: number, r: number) {
  const s = new S(), x = -w / 2, y = -h / 2;
  s.moveTo(x, y + r);
  s.lineTo(x, y + h - r);
  s.quadraticCurveTo(x, y + h, x + r, y + h);
  s.lineTo(x + w - r, y + h);
  s.quadraticCurveTo(x + w, y + h, x + w, y + h - r);
  s.lineTo(x + w, y + r);
  s.quadraticCurveTo(x + w, y, x + w - r, y);
  s.lineTo(x + r, y);
  s.quadraticCurveTo(x, y, x, y + r);
  return s;
}

export function HeroCard() {
  const host = useRef<HTMLDivElement>(null);
  const still = useStill();

  /* The preference is not knowable during the first client render, so nothing is built
     until one tick after mount — otherwise a reduced-motion reader pays for a WebGL
     context that is torn down and rebuilt a frame later. Same reasoning as useScene. */
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    const el = host.current;
    if (!ready || !el) return;
    // desktop-width, fine-pointer only: below this the column does not exist, and a
    // coarse pointer dragging the canvas would be a reader trying to scroll the page
    if (!matchMedia('(min-width: 1180px) and (pointer: fine)').matches) return;

    let dead = false;
    let stop = () => {};

    (async () => {
      const [THREE, { OrbitControls }] = await Promise.all([
        import('three'),
        import('three/examples/jsm/controls/OrbitControls.js'),
      ]);
      if (dead || !host.current) return;

      let renderer: import('three').WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      } catch {
        return;   // no WebGL: the column stays empty, the argument is unaffected
      }
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.98;
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

      /* Image-based lighting is what separates "a shape" from "an object" — but the stock
         RoomEnvironment is a white room with emissive panels an order of magnitude
         brighter than anything on this page, and a glossy flat card square to the camera
         mirrors that ceiling straight back: for one frame of every revolution the object
         stopped being a card and became a white slab. So the environment is three panels
         of known radiance instead, in the page's own colours and at the page's own level.
         Nothing here is brighter than it needs to be to put an edge on a bevel. */
      const envScene = new THREE.Scene();
      const panel = (color: number, gain: number, size: number, x: number, y: number, z: number) => {
        const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
        mat.color.multiplyScalar(gain);   // radiance, not a colour: PMREM reads it linearly
        const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
        m.position.set(x, y, z);
        m.lookAt(0, 0, 0);
        envScene.add(m);
      };
      panel(0xdcecfa, 5.4, 9, 5.5, 6.5, 4.5);    // key: high and well off the view axis
      panel(C.steel, 2.6, 9, -8, 1.5, 3);        // fill: provable, on the left cheek
      panel(C.chip, 3.0, 7, -3, -5, -6);         // rim: advisory, behind and below
      // and a wide, weak one from the reader's own side, which is the only thing that
      // lifts a face square to the camera off black without becoming a highlight
      panel(0xb9cddc, 0.5, 18, 0, 1, 9);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = pmrem.fromScene(envScene, 0.22);
      envScene.traverse((o) => {
        const m = o as import('three').Mesh;
        m.geometry?.dispose?.();
        (m.material as import('three').Material)?.dispose?.();
      });
      scene.environment = env.texture;

      // one directional, only to give the embossing a shadow side the env cannot
      const key = new THREE.DirectionalLight(0xdcecfa, 1.7); key.position.set(4.0, 4.4, 1.2);
      scene.add(key);

      /* pivot: tilt + parallax + intro · spinner: the endless turn.
         Two groups, because the turn must survive anything the reader does to the tilt. */
      const pivot = new THREE.Group();
      const spinner = new THREE.Group();
      const ring = new THREE.Group();
      pivot.rotation.x = TILT;
      pivot.add(spinner, ring);
      scene.add(pivot);

      // ── the card ──────────────────────────────────────────────────────────────
      const body = new THREE.ExtrudeGeometry(roundedRect(THREE.Shape, CARD.w, CARD.h, CARD.r), {
        depth: CARD.d, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.022,
        bevelSegments: 4, curveSegments: 20, steps: 1,
      });
      body.center();
      const face = (CARD.d + 0.044) / 2;    // the front plane, bevel included

      // lacquered plastic, not chrome: a dark base the clearcoat puts a sheen on
      const cardMat = new THREE.MeshPhysicalMaterial({
        color: C.body, metalness: 0.24, roughness: 0.29,
        clearcoat: 1, clearcoatRoughness: 0.11, envMapIntensity: 1,
      });
      const card = new THREE.Mesh(body, cardMat);
      spinner.add(card);

      const metal = (color: number, rough: number, metal: number) =>
        new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: metal, clearcoat: 0.6, envMapIntensity: 1 });
      const mChip = metal(C.chip, 0.22, 0.95);
      const mBone = metal(C.bone, 0.34, 0.35);
      const mSteel = metal(C.steel, 0.28, 0.8);
      const mDark = metal(C.dark, 0.72, 0.2);

      const unit = new THREE.BoxGeometry(1, 1, 1);
      const box = (mat: import('three').Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
        const m = new THREE.Mesh(unit, mat);
        m.scale.set(w, h, d);
        m.position.set(x, y, z);
        card.add(m);
        return m;
      };

      // chip — amber, because a mandate is a claim and not yet a proof
      const chip = new THREE.Mesh(
        new THREE.ExtrudeGeometry(roundedRect(THREE.Shape, 0.44, 0.35, 0.06), {
          depth: 0.014, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006,
          bevelSegments: 2, curveSegments: 8,
        }),
        mChip,
      );
      chip.position.set(-1.0, 0.16, face);
      card.add(chip);
      for (const y of [0.1, -0.02, -0.14]) box(mDark, 0.44, 0.012, 0.03, -1.0, 0.16 + y, face + 0.012);
      box(mDark, 0.012, 0.35, 0.03, -1.06, 0.16, face + 0.012);

      // the number, as embossed blocks: four groups of four, no font to download
      for (let g = 0; g < 4; g++) {
        for (let i = 0; i < 4; i++) {
          box(mBone, 0.082, 0.108, 0.016, -1.1 + g * 0.585 + i * 0.118, -0.32, face + 0.006);
        }
      }
      // expiry, quieter and shorter
      for (let i = 0; i < 5; i++) box(mBone, 0.05, 0.062, 0.012, -1.1 + i * 0.072, -0.66, face + 0.004);

      // the split cell itself, bottom right: rail state | obligation state
      box(mSteel, 0.3, 0.05, 0.014, 0.86, -0.66, face + 0.006);
      box(mChip, 0.3, 0.05, 0.014, 1.2, -0.66, face + 0.006);
      box(mDark, 0.012, 0.09, 0.02, 1.03, -0.66, face + 0.01);

      // the mark, top right: a square with one half filled — the page's logo, in relief
      box(mBone, 0.075, 0.15, 0.018, 1.13, 0.72, face + 0.006);
      const markEdge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.155, 0.155)),
        new THREE.LineBasicMaterial({ color: C.bone, transparent: true, opacity: 0.5 }),
      );
      markEdge.position.set(1.17, 0.72, face + 0.006);
      card.add(markEdge);

      /* The reverse. A turntable shows it for half of every revolution, so it gets the
         same treatment as the front: stripe, panel, CVV, fine print. */
      const mPanel = metal(0x9aa1a4, 0.94, 0.05);
      const mFine = metal(0x59636a, 0.8, 0.15);
      box(mDark, CARD.w - 0.12, 0.46, 0.012, 0, 0.52, -face);
      box(mPanel, 1.62, 0.24, 0.01, -0.4, -0.2, -face);
      box(mChip, 0.3, 0.24, 0.012, 0.6, -0.2, -face - 0.002);
      for (let i = 0; i < 3; i++) box(mFine, 1.28 - i * 0.36, 0.026, 0.008, -0.72 + i * 0.18, -0.6 - i * 0.11, -face);

      // ── the field: the ambient grid's cell, orbiting, plus the ring it rides ──
      const cellEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.1, 0.15, 0.1));
      const mQuiet = new THREE.LineBasicMaterial({ color: C.seam, transparent: true, opacity: 0.85 });
      const mLoud = new THREE.LineBasicMaterial({ color: C.chip, transparent: true, opacity: 0.9 });
      const N = 18;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const c = new THREE.LineSegments(cellEdges, i % 7 === 2 ? mLoud : mQuiet);   // one in seven diverged
        c.position.set(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0);
        c.rotation.z = a;
        ring.add(c);
      }
      const hoop = new THREE.Mesh(
        new THREE.TorusGeometry(RING_R, 0.0045, 6, 160),
        new THREE.MeshBasicMaterial({ color: C.steel, transparent: true, opacity: 0.26 }),
      );
      ring.add(hoop);

      // ── camera, sized to the column rather than assumed ───────────────────────
      const fit = () => {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        const vFov = (camera.fov * Math.PI) / 180;
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
        camera.position.z = FIT_R / Math.tan(Math.min(vFov, hFov) / 2);
        camera.updateProjectionMatrix();
      };
      camera.position.y = 0.24;
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0, 0);
      controls.enableZoom = false;     // the wheel belongs to the page
      controls.enablePan = false;
      controls.enableDamping = !still; // damping needs a loop; reduced motion has none
      controls.dampingFactor = 0.075;
      controls.rotateSpeed = 0.62;
      controls.minPolarAngle = Math.PI * 0.22;   // never over the top, never underneath
      controls.maxPolarAngle = Math.PI * 0.78;

      const draw = () => renderer.render(scene, camera);

      if (still) {
        // every state the object has, none of the theatre
        controls.addEventListener('change', draw);
        controls.update();
        draw();
        stop = () => { controls.removeEventListener('change', draw); ro.disconnect(); dispose(); };
      } else {
        /* One clock for the page: Lenis and every scrubbed timeline already run on the
           GSAP ticker, so the render does too rather than opening a second rAF. */
        const tick = (_t: number, dt: number) => {
          const d = Math.min(dt, 50) / 1000;        // a backgrounded tab must not lurch
          spinner.rotation.y -= d * 0.44;           // clockwise, seen from above
          ring.rotation.z -= d * 0.1;               // clockwise, seen from the front
          controls.update();
          draw();
        };
        // only while it is on screen; the hero leaves and the GPU goes quiet
        let running = false;
        const io = new IntersectionObserver(([e]) => {
          if (e.isIntersecting === running) return;
          running = e.isIntersecting;
          running ? gsap.ticker.add(tick) : gsap.ticker.remove(tick);
        });
        io.observe(el);

        /* The card arrives the way the rest of the hero arrives — after the headline,
           on the same slow settle — and then never stops moving. */
        const intro = gsap.timeline({ delay: 0.62 })
          .fromTo(el, { opacity: 0 }, { opacity: 1, duration: 1.1, ease: 'power2.out' }, 0)
          .fromTo(pivot.rotation, { x: TILT - 0.62, z: 0.2 }, { x: TILT, z: 0, duration: 1.7, ease: 'expo.out' }, 0)
          .fromTo(pivot.scale, { x: 0.74, y: 0.74, z: 0.74 }, { x: 1, y: 1, z: 1, duration: 1.6, ease: 'expo.out' }, 0)
          .fromTo(ring.scale, { x: 1.28, y: 1.28, z: 1.28 }, { x: 1, y: 1, z: 1, duration: 2, ease: 'expo.out' }, 0.1)
          .to(spinner.position, { y: 0.09, duration: 3.4, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 1.4);

        /* Parallax the tilt, not the camera: the camera is the reader's now, and two
           authorities on one transform is the bug this page keeps not having. */
        const tiltX = gsap.quickTo(pivot.rotation, 'x', { duration: 0.9, ease: 'power3' });
        const tiltZ = gsap.quickTo(pivot.rotation, 'z', { duration: 0.9, ease: 'power3' });
        const move = (e: PointerEvent) => {
          if (intro.isActive()) return;             // let the entrance finish uninterrupted
          const r = el.getBoundingClientRect();
          tiltX(TILT + ((e.clientY - r.top - r.height / 2) / innerHeight) * 0.34);
          tiltZ(((e.clientX - r.left - r.width / 2) / innerWidth) * -0.24);
        };
        addEventListener('pointermove', move, { passive: true });

        stop = () => {
          removeEventListener('pointermove', move);
          intro.kill();
          gsap.ticker.remove(tick);
          io.disconnect();
          ro.disconnect();
          dispose();
        };
      }

      function dispose() {
        controls.dispose();
        env.texture.dispose();
        pmrem.dispose();
        scene.traverse((o) => {
          const m = o as import('three').Mesh;
          m.geometry?.dispose?.();
          const mat = m.material;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose?.();
        });
        renderer.dispose();
        renderer.domElement.remove();
      }
    })();

    return () => { dead = true; stop(); };
  }, [ready, still]);

  // decoration: everything it states is stated in text beside it, and a drag-to-orbit
  // toy is not something to strand a keyboard reader inside
  return <div className="hero__gl" ref={host} aria-hidden />;
}
