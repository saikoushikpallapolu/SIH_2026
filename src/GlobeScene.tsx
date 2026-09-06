import { Line, OrbitControls, Stars } from '@react-three/drei'
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { GLOBE_RADIUS, latLngToVector3, vector3ToLatLng } from './oceanDataEngine'
import type { Instrument, OceanVariable, Selection, ViewMode } from './types'

const RADIUS = GLOBE_RADIUS
const EARTH_DAY_MAP = 'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg'
const EARTH_WATER_MASK = 'https://threejs.org/examples/textures/planets/earth_specular_2048.jpg'

function OceanShader({
  variable,
  depth,
  timeIndex,
  overlayStrength,
}: {
  variable: OceanVariable
  depth: number
  timeIndex: number
  overlayStrength: number
}) {
  const [earthMap, waterMask] = useLoader(THREE.TextureLoader, [EARTH_DAY_MAP, EARTH_WATER_MASK])
  earthMap.colorSpace = THREE.SRGBColorSpace

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        uniforms: {
          uTime: { value: 0 },
          uDepth: { value: depth },
          uVariable: {
            value: ['temperature', 'salinity', 'chlorophyll', 'currents'].indexOf(variable),
          },
          uOverlayStrength: { value: overlayStrength },
          uEarthMap: { value: earthMap },
          uWaterMask: { value: waterMask },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vPosition;
          void main() {
            vUv = uv;
            vNormal = normalize(normalMatrix * normal);
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uDepth;
          uniform float uVariable;
          uniform float uOverlayStrength;
          uniform sampler2D uEarthMap;
          uniform sampler2D uWaterMask;
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vPosition;

          // Perceptually uniform palettes based on cmocean standards
          vec3 paletteThermal(float t) {
            vec3 c0 = vec3(0.015, 0.137, 0.227);
            vec3 c1 = vec3(0.063, 0.306, 0.545);
            vec3 c2 = vec3(0.0, 0.6, 0.8);
            vec3 c3 = vec3(0.18, 0.72, 0.45);
            vec3 c4 = vec3(0.95, 0.63, 0.38);
            vec3 c5 = vec3(0.91, 0.43, 0.32);
            vec3 c6 = vec3(0.84, 0.16, 0.16);
            vec3 c7 = vec3(1.0, 0.82, 0.4);
            if (t < 0.15) return mix(c0, c1, t / 0.15);
            if (t < 0.30) return mix(c1, c2, (t - 0.15) / 0.15);
            if (t < 0.45) return mix(c2, c3, (t - 0.30) / 0.15);
            if (t < 0.60) return mix(c3, c4, (t - 0.45) / 0.15);
            if (t < 0.75) return mix(c4, c5, (t - 0.60) / 0.15);
            if (t < 0.90) return mix(c5, c6, (t - 0.75) / 0.15);
            return mix(c6, c7, (t - 0.90) / 0.10);
          }

          vec3 paletteHaline(float t) {
            vec3 c0 = vec3(0.13, 0.0, 0.2);
            vec3 c1 = vec3(0.28, 0.1, 0.42);
            vec3 c2 = vec3(0.24, 0.32, 0.71);
            vec3 c3 = vec3(0.0, 0.67, 0.75);
            vec3 c4 = vec3(0.5, 0.8, 0.77);
            vec3 c5 = vec3(0.83, 0.88, 0.34);
            vec3 c6 = vec3(1.0, 0.96, 0.61);
            if (t < 0.17) return mix(c0, c1, t / 0.17);
            if (t < 0.34) return mix(c1, c2, (t - 0.17) / 0.17);
            if (t < 0.50) return mix(c2, c3, (t - 0.34) / 0.16);
            if (t < 0.67) return mix(c3, c4, (t - 0.50) / 0.17);
            if (t < 0.84) return mix(c4, c5, (t - 0.67) / 0.17);
            return mix(c5, c6, (t - 0.84) / 0.16);
          }

          vec3 paletteAlga(float t) {
            vec3 c0 = vec3(0.01, 0.08, 0.04);
            vec3 c1 = vec3(0.04, 0.23, 0.13);
            vec3 c2 = vec3(0.1, 0.42, 0.24);
            vec3 c3 = vec3(0.23, 0.65, 0.33);
            vec3 c4 = vec3(0.48, 0.83, 0.38);
            vec3 c5 = vec3(0.78, 0.94, 0.48);
            vec3 c6 = vec3(0.97, 0.97, 0.44);
            if (t < 0.2) return mix(c0, c1, t / 0.2);
            if (t < 0.4) return mix(c1, c2, (t - 0.2) / 0.2);
            if (t < 0.6) return mix(c2, c3, (t - 0.4) / 0.2);
            if (t < 0.8) return mix(c3, c4, (t - 0.6) / 0.2);
            return mix(c4, c6, (t - 0.8) / 0.2);
          }

          vec3 paletteSpeed(float t) {
            vec3 c0 = vec3(0.04, 0.11, 0.22);
            vec3 c1 = vec3(0.1, 0.23, 0.42);
            vec3 c2 = vec3(0.11, 0.43, 0.62);
            vec3 c3 = vec3(0.21, 0.66, 0.69);
            vec3 c4 = vec3(0.39, 0.83, 0.61);
            vec3 c5 = vec3(0.71, 0.94, 0.42);
            vec3 c6 = vec3(1.0, 0.94, 0.35);
            if (t < 0.17) return mix(c0, c1, t / 0.17);
            if (t < 0.34) return mix(c1, c2, (t - 0.17) / 0.17);
            if (t < 0.50) return mix(c2, c3, (t - 0.34) / 0.16);
            if (t < 0.67) return mix(c3, c4, (t - 0.50) / 0.17);
            if (t < 0.84) return mix(c4, c5, (t - 0.67) / 0.17);
            return mix(c5, c6, (t - 0.84) / 0.16);
          }

          float wave(vec3 p) {
            return sin(p.x * 3.5 + uTime) * 0.3 + sin(p.y * 5.0 - uTime * 0.6) * 0.3 + sin(p.z * 4.0 + uTime * 0.8) * 0.4;
          }

          void main() {
            vec3 earth = texture2D(uEarthMap, vUv).rgb;
            float water = smoothstep(0.18, 0.45, texture2D(uWaterMask, vUv).r);

            // Geographic coordinate metrics
            float latFromEquator = abs(vUv.y - 0.5) * 2.0;
            float tropicality = pow(max(0.0, cos(latFromEquator * 1.5708)), 1.3);
            float eddy = wave(normalize(vPosition) * 4.0) * 0.5 + 0.5;

            // Physical thermocline dropoff
            float thermocline = 1.0 - exp(-uDepth / (210.0 + tropicality * 130.0));

            float normValue;
            vec3 fieldColor;

            if (uVariable < 0.5) {
              // Temperature: warm near equator, cooler at depth
              normValue = clamp(0.1 + tropicality * 0.88 - thermocline * 0.74 + (eddy - 0.5) * 0.08, 0.0, 1.0);
              fieldColor = paletteThermal(normValue);
            } else if (uVariable < 1.5) {
              // Salinity: high in sub-tropics/Arabian, lower in Bay of Bengal/equator
              float gyre = sin(latFromEquator * 3.1416);
              normValue = clamp(0.28 + gyre * 0.52 + thermocline * 0.12 + (eddy - 0.5) * 0.08, 0.0, 1.0);
              fieldColor = paletteHaline(normValue);
            } else if (uVariable < 2.5) {
              // Chlorophyll: coastal upwelling & sub-Antarctic fronts
              normValue = clamp(0.15 + (1.0 - tropicality) * 0.5 + (1.0 - thermocline) * 0.3 + (eddy - 0.5) * 0.15, 0.0, 1.0);
              fieldColor = paletteAlga(normValue);
            } else {
              // Current speed: intense near equator and Somali jet
              normValue = clamp(0.18 + exp(-pow(latFromEquator / 0.24, 2.0)) * 0.55 + (eddy - 0.5) * 0.25 + (1.0 - thermocline) * 0.12, 0.0, 1.0);
              fieldColor = paletteSpeed(normValue);
            }

            float light = max(dot(vNormal, normalize(vec3(1.0, 0.8, 1.2))), 0.0);
            vec3 litOcean = mix(earth, fieldColor * (0.52 + light * 0.72), uOverlayStrength);

            // Blend: crisp land boundaries without bleeding
            gl_FragColor = vec4(mix(earth * (0.45 + light * 0.55), litOcean, water), 1.0);
          }
        `,
      }),
    [variable, earthMap, waterMask, overlayStrength]
  )

  material.uniforms.uTime.value = timeIndex * 0.75
  material.uniforms.uDepth.value = depth
  material.uniforms.uVariable.value = ['temperature', 'salinity', 'chlorophyll', 'currents'].indexOf(variable)
  material.uniforms.uOverlayStrength.value = overlayStrength

  return (
    <mesh material={material}>
      <sphereGeometry args={[RADIUS, 128, 128]} />
    </mesh>
  )
}

function Atmosphere() {
  return (
    <mesh scale={1.035}>
      <sphereGeometry args={[RADIUS, 96, 96]} />
      <meshBasicMaterial
        color="#58ddff"
        transparent
        opacity={0.12}
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}

function CurrentParticles({ active }: { active: boolean }) {
  const points = useRef<THREE.Points>(null)
  const positions = useMemo(() => {
    const result = new Float32Array(900 * 3)
    for (let i = 0; i < 900; i += 1) {
      const lat = -28 + ((i * 31) % 64)
      const lng = 42 + ((i * 53) % 77)
      const v = latLngToVector3(lat, lng, RADIUS + 0.018)
      result.set([v.x, v.y, v.z], i * 3)
    }
    return result
  }, [])

  useFrame(({ clock }) => {
    if (points.current && active) points.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.15) * 0.08
  })

  if (!active) return null
  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#d6fbff"
        size={0.013}
        sizeAttenuation
        transparent
        opacity={0.82}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

function Marker({
  instrument,
  onSelect,
}: {
  instrument: Instrument
  onSelect: (instrument: Instrument) => void
}) {
  const point = latLngToVector3(instrument.latitude, instrument.longitude, RADIUS + 0.045)
  const color = instrument.kind === 'Glider' ? '#ffcf66' : instrument.kind === 'BGC-Argo' ? '#9b83ff' : '#72e8ff'

  return (
    <group
      position={point}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(instrument)
      }}
    >
      <mesh>
        <sphereGeometry args={[0.035, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh scale={1.8}>
        <sphereGeometry args={[0.035, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} />
      </mesh>
    </group>
  )
}

/**
 * Animated Sonar Ripple & Beacon that pulses on the ocean surface.
 */
function HolographicBeacon({ selection }: { selection: Selection }) {
  const localPos = useMemo(
    () => latLngToVector3(selection.latitude, selection.longitude, RADIUS + 0.005),
    [selection.latitude, selection.longitude]
  )
  const ring1Ref = useRef<THREE.Mesh>(null)
  const ring2Ref = useRef<THREE.Mesh>(null)

  const normal = useMemo(() => localPos.clone().normalize(), [localPos])
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
    return q
  }, [normal])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 1.6
    if (ring1Ref.current) {
      const p1 = t % 1
      ring1Ref.current.scale.setScalar(0.2 + p1 * 1.4)
      const mat = ring1Ref.current.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, (1 - p1) * 0.85)
    }
    if (ring2Ref.current) {
      const p2 = (t + 0.5) % 1
      ring2Ref.current.scale.setScalar(0.2 + p2 * 1.4)
      const mat = ring2Ref.current.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, (1 - p2) * 0.85)
    }
  })

  return (
    <group position={localPos} quaternion={quaternion}>
      {/* Central pin marker */}
      <mesh>
        <circleGeometry args={[0.024, 32]} />
        <meshBasicMaterial color="#00f2fe" transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
      {/* Inner expanding ripple */}
      <mesh ref={ring1Ref}>
        <ringGeometry args={[0.035, 0.05, 32]} />
        <meshBasicMaterial color="#4facfe" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      {/* Outer expanding ripple */}
      <mesh ref={ring2Ref}>
        <ringGeometry args={[0.035, 0.05, 32]} />
        <meshBasicMaterial color="#00f2fe" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      {/* Light needle pointing outward */}
      <mesh position={[0, 0, 0.07]}>
        <cylinderGeometry args={[0.0018, 0.0018, 0.14, 8]} />
        <meshBasicMaterial color="#70e2ff" transparent opacity={0.75} />
      </mesh>
      {/* Glowing tip */}
      <mesh position={[0, 0, 0.14]}>
        <sphereGeometry args={[0.012, 16, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  )
}

/**
 * Click-to-Teleport and Smooth Camera Lerp Controller.
 */
function CameraDirector({
  targetPoint,
  teleportNonce,
  globeGroupRef,
  mode,
  depth,
}: {
  targetPoint: Selection
  teleportNonce?: number
  globeGroupRef: React.RefObject<THREE.Group | null>
  mode: ViewMode
  depth: number
}) {
  const { camera } = useThree()
  const isTeleporting = useRef(false)
  const targetCamPos = useRef<THREE.Vector3 | null>(null)
  const lastNonce = useRef(teleportNonce)

  useEffect(() => {
    if (teleportNonce !== undefined && teleportNonce !== lastNonce.current && globeGroupRef.current) {
      lastNonce.current = teleportNonce
      // Vector in local globe space
      const localVec = latLngToVector3(targetPoint.latitude, targetPoint.longitude, RADIUS)
      // Transform to world space
      const worldVec = localVec.clone().applyMatrix4(globeGroupRef.current.matrixWorld)
      // Camera hovers at altitude 2.65 looking straight at Earth center
      targetCamPos.current = worldVec.clone().normalize().multiplyScalar(2.65)
      isTeleporting.current = true
    }
  }, [teleportNonce, targetPoint, globeGroupRef])

  useFrame((_, delta) => {
    if (mode === 'dive') {
      const target = new THREE.Vector3(2.02 - Math.min(depth, 1800) / 3100, 0.45, 2.42 - Math.min(depth, 1800) / 4000)
      camera.position.lerp(target, 0.03)
      camera.lookAt(new THREE.Vector3(0.15, 0.08, 0.2))
      return
    }

    if (isTeleporting.current && targetCamPos.current) {
      const factor = Math.min(1, delta * 4.0)
      camera.position.lerp(targetCamPos.current, factor)
      camera.lookAt(0, 0, 0)
      if (camera.position.distanceTo(targetCamPos.current) < 0.02) {
        isTeleporting.current = false
      }
    }
  })

  return null
}

export interface GlobeSceneProps {
  variable: OceanVariable
  depth: number
  timeIndex: number
  mode: ViewMode
  overlayStrength: number
  instruments: Instrument[]
  selection: Selection
  teleportNonce?: number
  onInstrument: (instrument: Instrument) => void
  onSelectPoint: (selection: Selection) => void
}

function Scene({
  variable,
  depth,
  timeIndex,
  mode,
  overlayStrength,
  instruments,
  selection,
  teleportNonce,
  onInstrument,
  onSelectPoint,
}: GlobeSceneProps) {
  const groupRef = useRef<THREE.Group>(null)

  const handleGlobeClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (!groupRef.current) return
    // Invert the group world transform to extract TRUE sphere coordinate
    const localPoint = groupRef.current.worldToLocal(event.point.clone())
    const coord = vector3ToLatLng(localPoint)
    onSelectPoint(coord)
  }

  return (
    <>
      <color attach="background" args={['#020712']} />
      <fog attach="fog" args={['#020712', 8, 18]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 4, 5]} intensity={2.3} color="#a5d8ff" />
      <pointLight position={[-5, -1, -3]} intensity={1.2} color="#1f70ff" />
      <Stars radius={90} depth={45} count={3200} factor={3} saturation={0} fade speed={0.25} />

      <group
        ref={groupRef}
        rotation={[THREE.MathUtils.degToRad(-6), THREE.MathUtils.degToRad(-62), THREE.MathUtils.degToRad(11)]}
      >
        <OceanShader variable={variable} depth={depth} timeIndex={timeIndex} overlayStrength={overlayStrength} />

        {/* Invisible raycast sphere */}
        <mesh onClick={handleGlobeClick}>
          <sphereGeometry args={[RADIUS + 0.008, 96, 96]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>

        {/* Latitude circles */}
        {[-30, 0, 30].map((lat) => (
          <Line
            key={lat}
            points={Array.from({ length: 73 }, (_, i) => latLngToVector3(lat, -180 + i * 5, RADIUS + 0.012))}
            color="#c1eaff"
            lineWidth={0.28}
            transparent
            opacity={0.14}
          />
        ))}

        <CurrentParticles active={variable === 'currents' || mode === 'dive'} />
        {instruments.map((instrument) => (
          <Marker key={instrument.id} instrument={instrument} onSelect={onInstrument} />
        ))}

        {/* Holographic Sonar Beacon at user's selected point */}
        <HolographicBeacon selection={selection} />
      </group>

      <Atmosphere />

      <CameraDirector
        targetPoint={selection}
        teleportNonce={teleportNonce}
        globeGroupRef={groupRef}
        mode={mode}
        depth={depth}
      />

      <OrbitControls
        enablePan={false}
        minDistance={2.2}
        maxDistance={8}
        enableDamping
        dampingFactor={0.06}
        autoRotate={mode === 'explore' && !teleportNonce}
        autoRotateSpeed={0.2}
      />
    </>
  )
}

export default function GlobeScene(props: GlobeSceneProps) {
  return (
    <Canvas camera={{ position: [4.1, 2.3, 4.8], fov: 38 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <Suspense fallback={null}>
        <Scene {...props} />
      </Suspense>
    </Canvas>
  )
}
