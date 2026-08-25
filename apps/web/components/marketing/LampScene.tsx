'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';

/**
 * The lamp.
 *
 * One extruded four-point mark turning in a dark volume, and one full-screen
 * plane carrying the falloff. That is the entire scene — no drei, no loaders, no
 * environment map, no post-processing. The brief asked for 3D; the subject asked
 * for a light, and a light is mostly a gradient with an object inside it.
 *
 * Everything reads one number: `progress`, the page's single scroll value. The
 * light starts WIDE — the headline is legible on first paint, always — and
 * contracts as the argument is made.
 */

/** Hermite ease between two edges — one curve, used for every entrance here. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The display cut of the mark as a 2D shape to extrude, in a centred -1..1
 * space. Same waist ratios as public/brand/mark-display.svg (.04/.64 and
 * .22/.93 of the arm), so the object and the flat mark are the same drawing.
 */
function markShape(): THREE.Shape {
  const s = new THREE.Shape();
  const [k1p, k1a] = [0.04, 0.64];
  const [k2p, k2a] = [0.22, 0.93];
  s.moveTo(0, 1);
  s.bezierCurveTo(k1p, 1 - k1a, k2p, 1 - k2a, 1, 0);
  s.bezierCurveTo(1 - k1a, -k1p, 1 - k2a, -k2p, 0, -1);
  s.bezierCurveTo(-k1p, -1 + k1a, -k2p, -1 + k2a, -1, 0);
  s.bezierCurveTo(-1 + k1a, k1p, -1 + k2a, k2p, 0, 1);
  return s;
}

function Mark({ progress }: { progress: MutableRefObject<number> }) {
  const mesh = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(markShape(), {
      depth: 0.18,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.04,
      bevelSegments: 3,
      curveSegments: 48,
    });
    g.center();
    return g;
  }, []);

  useFrame((state) => {
    if (!mesh.current) return;
    const p = progress.current;
    const t = state.clock.elapsedTime;

    /**
     * The mark is ABSENT from the hero, and that is the whole composition.
     *
     * Rendered at full size behind the headline it swallowed the type — a giant
     * amber blob with words on top of it. The hero's subject is the sentence;
     * the mark's moment is the seal at the end. So it rises into the light as
     * you scroll, which is also what "3D animated on scroll" should mean:
     * something arrives, rather than something is already there wobbling.
     */
    const enter = smoothstep(0.12, 0.5, p); // out of nothing, into the pool
    const seal = smoothstep(0.72, 1, p); // and then compressed into the seal

    mesh.current.visible = enter > 0.001;

    /**
     * Parked against the viewport edge, not at a fixed world x.
     *
     * A constant offset put it through the middle of the composer on a laptop
     * and clean off the canvas on a phone, because the visible width at this
     * depth is entirely aspect-dependent. Measuring the frustum each frame
     * keeps the same composition at every size — and on a narrow screen it
     * sits behind the text rather than beside it, which is the honest
     * fallback when there is no room to be beside anything.
     */
    const halfWidth = state.viewport.width / 2;
    const parked = halfWidth * 0.66;
    const narrow = state.viewport.aspect < 0.9;

    mesh.current.scale.setScalar(enter * (narrow ? 0.34 : 0.42) * (1 - seal * 0.4));
    mesh.current.position.set(
      // Drawn back to centre for the seal: the light closing into one point.
      parked * (1 - seal),
      (narrow ? 0.2 : -0.15) + enter * 0.15,
      -0.4 - seal * 0.5,
    );

    // Held OFF-AXIS. Face-on, a four-point star is indistinguishable from a
    // flat SVG no matter how good the material is — the depth only reads when
    // one arm is nearer than the others. Slow, because a fast idle spin reads
    // as a loading state rather than a light.
    mesh.current.rotation.y = -0.5 + Math.sin(t * 0.16) * 0.35 + p * 0.8;
    mesh.current.rotation.x = 0.38 + Math.sin(t * 0.21) * 0.09;
    mesh.current.rotation.z = t * 0.05;
  });

  return (
    <mesh ref={mesh} geometry={geometry}>
      {/* Physical, so the bevel catches the key light and the mark reads as an
          object rather than a sticker. Emissive keeps it lit from within: it is
          the lamp, not a thing the lamp shines on. */}
      <meshPhysicalMaterial
        color="#b45309"
        emissive="#f59e0b"
        emissiveIntensity={0.34}
        roughness={0.28}
        metalness={0.1}
        clearcoat={0.6}
        clearcoatRoughness={0.35}
      />
    </mesh>
  );
}

/** The volume the mark sits in: a warm falloff that contracts with scroll. */
function Falloff({ progress }: { progress: MutableRefObject<number> }) {
  const material = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uProgress: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCore: { value: new THREE.Color('#fbbf24') },
      uBody: { value: new THREE.Color('#b45309') },
    }),
    [],
  );

  useFrame((state) => {
    const u = material.current?.uniforms;
    if (!u) return;
    // Indexed access, so TS cannot prove the keys exist even though `uniforms`
    // above defines them; read once and guard rather than asserting per line.
    if (u.uProgress) u.uProgress.value = progress.current;
    // DRAWING BUFFER pixels, not CSS pixels. `gl_FragCoord` is in device
    // pixels, so feeding it state.size on a 1.75x display put every coordinate
    // 1.75x out of range: `d` overshot the reach everywhere and the lamp
    // computed to zero across the whole viewport. It looked exactly like a
    // scene that had failed to mount.
    if (u.uResolution) state.gl.getDrawingBufferSize(u.uResolution.value);
  });

  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    precision highp float;
    varying vec2 vUv;
    uniform float uProgress;
    uniform vec2 uResolution;
    uniform vec3 uCore;
    uniform vec3 uBody;

    void main() {
      // SCREEN space, not the plane's UV. The plane is 24x24 world units and
      // the camera only ever sees a slice of it, so a radius expressed in UV
      // meant something different at every aspect — on a portrait phone the
      // visible slice was small enough that the "pool" filled the viewport.
      // The grain below already used gl_FragCoord; this file carried both
      // conventions and only one of them was measuring real pixels.
      float aspect = uResolution.x / uResolution.y;
      vec2 p = gl_FragCoord.xy / uResolution - vec2(0.5, 0.47);
      p.x *= aspect;
      float d = length(p);

      // A POOL, not a wash. The first version ran at 0.9 alpha across a reach
      // of 0.95 and turned the whole viewport orange, which destroyed the
      // typography the page exists for. A lamp is mostly the dark around it.
      float reach = mix(0.62, 0.30, uProgress) * clamp(aspect, 0.55, 1.0);
      float glow = pow(1.0 - smoothstep(0.0, reach, d), 2.6);

      // A hotter centre, or amber at low alpha reads as a stain rather than a
      // light with a source in it.
      float core = 1.0 - smoothstep(0.0, reach * 0.30, d);
      vec3 col = mix(uBody, uCore, pow(core, 1.5));

      // Film grain, fixed to screen space so it reads as the room's texture
      // rather than noise crawling across a gradient.
      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      float alpha = glow * 0.26 + (n - 0.5) * 0.04 * glow;

      gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    }
  `;

  return (
    <mesh position={[0, 0, -3]}>
      <planeGeometry args={[24, 24]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
      />
    </mesh>
  );
}

export default function LampScene({
  progressRef,
}: {
  progressRef: MutableRefObject<number>;
}) {
  // The ref arrives already populated by the parent, so nothing here re-renders
  // on scroll — and crucially <Canvas> receives no changing prop, which is what
  // used to make r3f re-run its root render on every frame.
  return (
    <Canvas
      camera={{ position: [0, 0, 4.2], fov: 42 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      // Nothing here reacts to input; the scene is driven entirely by scroll,
      // and the text above it must stay selectable.
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <ambientLight intensity={0.35} />
      <pointLight position={[2.5, 2, 3]} intensity={9} color="#fde68a" distance={12} decay={2} />
      <pointLight position={[-3, -1.5, 1.5]} intensity={5} color="#b45309" distance={10} decay={2} />
      {/* Rim, from behind and above — the edge light that tells you the arms
          have thickness. Without it the bevel is only ever a darker amber. */}
      <pointLight position={[-1.5, 2.5, -2]} intensity={14} color="#fde68a" distance={9} decay={2} />
      <Falloff progress={progressRef} />
      <Mark progress={progressRef} />
    </Canvas>
  );
}
