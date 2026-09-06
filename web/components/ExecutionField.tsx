'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useStill } from '@/lib/motion';

gsap.registerPlugin(ScrollTrigger);

/* THE BOUNDARY, IN DEPTH.
 *
 * A second reader of the same scroll region Execution.tsx already drives — not a second
 * authority on top of it. Every property here is set directly from `self.progress` each
 * tick, never tweened on its own, so scrubbing back up un-happens exactly as cleanly as it
 * happened. The beat windows below are copied from Execution.tsx's own timeline positions
 * rather than re-derived, so the DOM diagram and this layer stay on one score.
 *
 * ALIGNMENT IS MEASURED, NOT GUESSED. `.xb__bound` and `.xb__wire` are the DOM's own
 * ground truth for where the hairline and the lanes actually render — `fit()` reads their
 * real boxes on every resize and casts them through the camera's actual matrices (see
 * `onZPlane`) to get world coordinates, so the glass fin sits exactly on the hairline and
 * the packet's crossing point is exactly the wire's centre at every viewport width, not at
 * whatever numbers looked right in one screenshot.
 *
 * No render loop. Nothing here moves between scroll ticks, so a frame is only ever drawn
 * from a scroll event or a resize — the GPU is idle the instant the wheel stops. Reduced
 * motion skips the whole thing, same as useScene: a static frame of a boundary with
 * nothing crossing it is not worth a WebGL context.
 */

const C = { steel: 0x7fa8c9, amber: 0xe0a340 } as const;
const OUT = [0.30, 0.41] as const;
const IN = [0.50, 0.62] as const;
const WINDOW = [0.78, 1.0] as const;
const VIEW_H = 3.4;   // world units of vertical extent the ortho camera always frames

const localT = (p: number, [a, b]: readonly [number, number]) =>
  Math.min(1, Math.max(0, (p - a) / (b - a)));

/** a faint schematic — two hairlines and a row of ticks — read as engineered structure
 *  rather than a flat slab; painted white-on-black so `material.emissive` supplies the tint */
function circuitTexture(THREE: typeof import('three')) {
  const w = 64, h = 320;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(w * 0.5, 0); ctx.lineTo(w * 0.5, h); ctx.stroke();
  ctx.globalAlpha = 0.55;
  for (let y = 10; y < h; y += 22) {
    ctx.beginPath(); ctx.moveTo(w * 0.22, y); ctx.lineTo(w * 0.78, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let y = 10; y < h; y += 44) ctx.strokeRect(w * 0.5 - 5, y - 5, 10, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** bright at the centre, transparent at the edges, constant top-to-bottom — the shape a
 *  bleed of light needs when it's fading across a thin panel's width, not its full face */
function edgeFadeTexture(THREE: typeof import('three')) {
  const w = 64, h = 8;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return new THREE.CanvasTexture(c);
}

/** a soft radial falloff for glow sprites — tinted by the sprite material's own colour */
function glowTexture(THREE: typeof import('three')) {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

export function ExecutionField({ sectionRef }: { sectionRef: RefObject<HTMLElement | null> }) {
  const host = useRef<HTMLDivElement>(null);
  const still = useStill();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    const el = host.current;
    const section = sectionRef.current;
    if (!ready || still || !el || !section) return;
    // the field only has width to cross above the axis breakpoint — see Execution.tsx
    if (!matchMedia('(min-width: 861px)').matches) return;
    // the DOM elements this layer measures itself against; if the markup ever drops
    // them, there is nothing honest to align to, so skip the layer entirely.
    // .xb__bound (not the -l hairline inside it) on purpose: the hairline is what
    // Execution.tsx's own scrubbed timeline draws in with a scaleY 0→1 tween, so at
    // mount — progress 0, before any scroll — it measures as a real element collapsed
    // to zero height. .xb__bound is the grid column around it, never touched by that
    // tween, always its true resting box.
    const boundCol = section.querySelector<HTMLElement>('.xb__bound');
    const wires = section.querySelectorAll<HTMLElement>('.xb__wire');
    if (!boundCol || wires.length < 2) return;

    let dead = false;
    let stop = () => {};

    (async () => {
      const THREE = await import('three');
      if (dead || !host.current) return;

      let renderer: import('three').WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      } catch {
        return;   // no WebGL: the DOM diagram beside it already carries the argument
      }
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
      camera.position.set(0, 1.0, 6.5);
      camera.lookAt(0, -0.3, 0);
      // never moves again after this, so its world matrix never needs recomputing —
      // unproject() below reads it directly rather than waiting for a render to set it
      camera.updateMatrixWorld(true);

      scene.add(new THREE.AmbientLight(0x1c262b, 1.3));
      const key = new THREE.DirectionalLight(0xdcecfa, 1.8);
      key.position.set(3, 4, 4);
      scene.add(key);
      const rim = new THREE.DirectionalLight(C.steel, 0.7);
      rim.position.set(-3, 1, -3);
      scene.add(rim);

      // ── the boundary — a glass fin standing exactly on .xb__bound-l's own line ──────
      const circuit = circuitTexture(THREE);
      const wallMat = new THREE.MeshPhysicalMaterial({
        color: C.steel, transparent: true, opacity: 0.5,
        emissive: C.steel, emissiveIntensity: 0.55, emissiveMap: circuit,
        roughness: 0.25, metalness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.3,
      });
      // base geometry is a unit-tall slab; fit() scales it to the hairline's real height
      // rather than rebuilding it, so its EdgesGeometry child scales for free with it
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1, 0.4), wallMat);
      scene.add(wall);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(wall.geometry),
        new THREE.LineBasicMaterial({ color: C.steel, transparent: true, opacity: 0.75 }),
      );
      wall.add(edge);
      // a wider, softer duplicate behind it for the bleed a hairline light needs to
      // read as glass rather than a stroked outline — edge-faded, not a flat card
      const edgeFade = edgeFadeTexture(THREE);
      const glowShell = new THREE.Mesh(
        wall.geometry,
        new THREE.MeshBasicMaterial({
          map: edgeFade, color: C.steel, transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      glowShell.scale.set(4.5, 1.02, 2.6);
      wall.add(glowShell);

      // ── the packet — a small faceted crystal, the only thing that ever leaves either side ──
      const pktMat = new THREE.MeshPhysicalMaterial({
        color: C.steel, emissive: C.steel, emissiveIntensity: 1.2,
        roughness: 0.15, metalness: 0.4, clearcoat: 1, transparent: true, opacity: 0,
      });
      const packet = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 1), pktMat);
      packet.visible = false;
      scene.add(packet);
      const haloTex = glowTexture(THREE);
      const haloMat = new THREE.SpriteMaterial({
        map: haloTex, color: C.steel, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(0.9, 0.9, 1);
      packet.add(halo);

      // ── the crossing flash — a ring that lights up exactly as the packet passes x=0 ──
      const ringMat = new THREE.MeshBasicMaterial({
        color: C.steel, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.29, 40), ringMat);
      scene.add(ring);

      // ── measured fit: DOM boxes → world units, recomputed on every resize ───────────
      // The camera is tilted on purpose, for depth — which means screen-Y is NOT a plain
      // linear function of world-Y (that only holds for a camera looking straight down
      // -Z). So this asks the camera itself, via its real matrices: cast the screen point
      // as a ray through the ortho frustum and intersect it with the world's Z=0 plane,
      // where every object in this scene lives. Get this wrong and the fix looks plausible
      // at one viewport width and drifts at every other.
      const _near = new THREE.Vector3(), _far = new THREE.Vector3();
      const onZPlane = (hostRect: DOMRect, screenX: number, screenY: number) => {
        const ndcX = ((screenX - hostRect.left) / hostRect.width) * 2 - 1;
        const ndcY = -(((screenY - hostRect.top) / hostRect.height) * 2 - 1);
        _near.set(ndcX, ndcY, -1).unproject(camera);
        _far.set(ndcX, ndcY, 1).unproject(camera);
        const dz = _far.z - _near.z;
        const t = dz === 0 ? 0 : -_near.z / dz;
        return { x: _near.x + (_far.x - _near.x) * t, y: _near.y + (_far.y - _near.y) * t };
      };

      let span = 2, railY = 0;
      const fit = () => {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        const aspect = w / h;
        camera.left = (-VIEW_H * aspect) / 2;
        camera.right = (VIEW_H * aspect) / 2;
        camera.top = VIEW_H / 2;
        camera.bottom = -VIEW_H / 2;
        camera.updateProjectionMatrix();

        const hostRect = el.getBoundingClientRect();
        const at = (x: number, y: number) => onZPlane(hostRect, x, y);

        // .xb__bound-l's own CSS extends it -10px above and 84px below this column —
        // mirrored here so the wall matches the hairline's true drawn extent, not just
        // the column's own box (see kavach.css, "the boundary is the frame")
        const boundRect = boundCol.getBoundingClientRect();
        const boundX = boundRect.left + boundRect.width / 2;
        const top = at(boundX, boundRect.top - 10);
        const bottom = at(boundX, boundRect.top + boundRect.height + 84);
        const wallCy = (top.y + bottom.y) / 2;
        const wallX = (top.x + bottom.x) / 2;
        const wallH = Math.max(Math.abs(top.y - bottom.y), 0.4);

        const wireRect = wires[0].getBoundingClientRect();
        const wireY = wireRect.top + wireRect.height / 2;
        const left = at(wireRect.left, wireY);
        const right = at(wireRect.left + wireRect.width, wireY);
        span = Math.abs(right.x - left.x);

        const railYs = Array.from(wires, (wr) => {
          const r = wr.getBoundingClientRect();
          return at(r.left + r.width / 2, r.top + r.height / 2).y;
        });
        railY = railYs.reduce((a, b) => a + b, 0) / railYs.length;

        wall.scale.y = wallH;
        wall.position.set(wallX, wallCy, 0);
        ring.position.set(wallX, railY, 0);

        draw();
      };

      const draw = () => renderer.render(scene, camera);

      const applyProgress = (p: number) => {
        const oT = localT(p, OUT);
        const iT = localT(p, IN);
        const wT = localT(p, WINDOW);

        const travelling = (t: number, dir: 1 | -1) => {
          // dir 1 = outbound, left (Kavach) to right (Razorpay) — the page's one
          // rightward motion; dir -1 retraces the same line back
          packet.visible = true;
          packet.position.x = dir * (span * t - span / 2);
          packet.position.y = railY + Math.sin(Math.PI * t) * 0.22;
          packet.rotation.y = t * Math.PI * 2.4;
          packet.rotation.x = t * Math.PI * 1.3;
          const fade = Math.sin(Math.PI * t) ** 0.6;
          pktMat.opacity = fade;
          haloMat.opacity = fade * 0.8;
        };

        let crossing = -1;
        if (oT > 0 && oT < 1) { travelling(oT, 1); crossing = oT; }
        else if (iT > 0 && iT < 1) { travelling(iT, -1); crossing = iT; }
        else packet.visible = false;

        // the flash: purely a function of how close the packet is to x=0 right now,
        // so pausing mid-scroll holds a coherent frame instead of a stray afterimage
        const flash = crossing < 0 ? 0 : Math.max(0, 1 - Math.abs(crossing - 0.5) * 9);
        ringMat.opacity = flash * 0.85;
        ring.scale.setScalar(0.75 + flash * 0.7);

        // the window: the boundary itself loses certainty, not just the states beside it
        wallMat.emissiveIntensity = 0.55 - wT * 0.3;
        wallMat.opacity = 0.5 - wT * 0.18;
        const hue = wT > 0.5 ? C.amber : C.steel;
        wallMat.color.setHex(hue);
        wallMat.emissive.setHex(hue);
        (edge.material as import('three').LineBasicMaterial).color.setHex(hue);
        (glowShell.material as import('three').MeshBasicMaterial).color.setHex(hue);

        draw();
      };

      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);

      const st = ScrollTrigger.create({
        trigger: section, start: 'top top', end: 'bottom bottom', scrub: true,
        onUpdate: (self) => applyProgress(self.progress),
      });
      applyProgress(0);

      stop = () => { st.kill(); ro.disconnect(); dispose(); };

      function dispose() {
        haloTex.dispose();
        circuit.dispose();
        edgeFade.dispose();
        scene.traverse((o) => {
          const m = o as import('three').Mesh;
          m.geometry?.dispose?.();
          const mat = m.material as import('three').Material | import('three').Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose?.();
        });
        renderer.dispose();
        renderer.domElement.remove();
      }
    })();

    return () => { dead = true; stop(); };
  }, [ready, still, sectionRef]);

  return <div className="xb__scene" ref={host} aria-hidden />;
}
