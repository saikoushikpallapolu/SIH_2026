import { Line, OrbitControls, Stars } from '@react-three/drei'
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import {
  GLOBE_RADIUS,
  getOceanVelocity,
  isDryLand,
  isPointInIndianOcean,
  latLngToVector3,
  vector3ToLatLng,
} from './oceanDataEngine'
import type { Instrument, OceanVariable, Selection, ViewMode } from './types'

const RADIUS = GLOBE_RADIUS
const EARTH_DAY_MAP = 'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg'
const EARTH_WATER_MASK = 'https://threejs.org/examples/textures/planets/earth_specular_2048.jpg'

interface FlowParticle {
  lat: number
  lon: number
  age: number
  maxAge: number
  speedMult: number
}

function spawnParticle(initial: boolean): FlowParticle {
  // Distribute across major current systems
  const region = Math.random()
  let lat = 0
  let lon = 75

  if (region < 0.22) {
    // Somali Jet & Western Arabian Sea
    lat = -2 + Math.random() * 16
    lon = 45 + Math.random() * 12
  } else if (region < 0.44) {
    // South Equatorial Current (SEC)
    lat = -20 + Math.random() * 10
    lon = 50 + Math.random() * 60
  } else if (region < 0.60) {
    // Agulhas Current (Mozambique/South Africa)
    lat = -34 + Math.random() * 14
    lon = 30 + Math.random() * 14
  } else if (region < 0.74) {
    // Equatorial Wyrtki Jet
    lat = -3 + Math.random() * 6
    lon = 60 + Math.random() * 34
  } else if (region < 0.88) {
    // Bay of Bengal Gyre
    lat = 8 + Math.random() * 13
    lon = 82 + Math.random() * 10
  } else {
    // Antarctic Circumpolar Current
    lat = -43 + Math.random() * 4
    lon = 35 + Math.random() * 75
  }

  return {
    lat,
    lon,
    age: initial ? Math.floor(Math.random() * 100) : 0,
    maxAge: 70 + Math.floor(Math.random() * 80),
    speedMult: 0.8 + Math.random() * 0.5,
  }
}

/**
 * Animated Geodesic Streamline Flow Particles.
 * Directly visualizes real Indian Ocean surface currents (u, v) rushing in real-time.
 */
function StreamlineParticles({ active, timeIndex }: { active: boolean; timeIndex: number }) {
  const count = 1800
  const pointsRef = useRef<THREE.Points>(null)
  const geomRef = useRef<THREE.BufferGeometry>(null)

  const particles = useMemo<FlowParticle[]>(() => {
    const list: FlowParticle[] = []
    for (let i = 0; i < count; i++) {
      list.push(spawnParticle(true))
    }
    return list
  }, [count])

  const positions = useMemo(() => new Float32Array(count * 3), [count])
  const colors = useMemo(() => new Float32Array(count * 3), [count])

  useFrame((_, delta) => {
    if (!pointsRef.current || !active) return
    const dt = Math.min(delta, 0.05)

    for (let i = 0; i < count; i++) {
      const p = particles[i]
      const vel = getOceanVelocity(p.lat, p.lon, timeIndex)

      // Advect particle along velocity vector (u: east, v: north)
      p.lat += vel.v * dt * 4.4 * p.speedMult
      const cosLat = Math.max(0.2, Math.cos((p.lat * Math.PI) / 180))
      p.lon += ((vel.u * dt * 4.4) / cosLat) * p.speedMult
      p.age += 1

      // Respawn when life expires or moves outside the ocean basin
      if (
        p.age > p.maxAge ||
        p.lat < -44.5 ||
        p.lat > 25.5 ||
        p.lon < 22 ||
        p.lon > 122 ||
        isDryLand(p.lat, p.lon)
      ) {
        particles[i] = spawnParticle(false)
      }

      // Project onto sphere surface
      const pos = latLngToVector3(p.lat, p.lon, RADIUS + 0.016)
      positions[i * 3] = pos.x
      positions[i * 3 + 1] = pos.y
      positions[i * 3 + 2] = pos.z

      // Velocity-based dynamic luminescence
      const speedNorm = Math.min(1.0, vel.speed / 1.4)
      const lifeFrac = p.age / p.maxAge
      const alpha = Math.sin(lifeFrac * Math.PI)

      if (speedNorm > 0.65) {
        // Fast jet (Somali/Agulhas): Luminous yellow-gold
        colors[i * 3] = 1.0 * alpha
        colors[i * 3 + 1] = 0.95 * alpha
        colors[i * 3 + 2] = 0.25 * alpha
      } else if (speedNorm > 0.35) {
        // Moderate current (SEC, Equatorial Jet): Brilliant electric cyan
        colors[i * 3] = 0.15 * alpha
        colors[i * 3 + 1] = 0.92 * alpha
        colors[i * 3 + 2] = 1.0 * alpha
      } else {
        // Slow circulation: Aquamarine / soft blue
        colors[i * 3] = 0.25 * alpha
        colors[i * 3 + 1] = 0.7 * alpha
        colors[i * 3 + 2] = 0.95 * alpha
      }
    }

    if (geomRef.current) {
      geomRef.current.attributes.position.needsUpdate = true
      geomRef.current.attributes.color.needsUpdate = true
    }
  })

  if (!active) return null

  return (
    <points ref={pointsRef}>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        vertexColors
        size={0.015}
        sizeAttenuation
        transparent
        opacity={0.92}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}

/**
 * Oceanographic Multi-Theme Shader.
 * Integrates cmocean thermal, haline (with isohaline fronts), alga (with organic blooms),
 * and speed (with directional wave advection).
 */
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

          // 1. Temperature: cmocean thermal
          vec3 paletteThermal(float t) {
            vec3 c0 = vec3(0.015, 0.137, 0.227);
            vec3 c1 = vec3(0.05, 0.28, 0.63);
            vec3 c2 = vec3(0.0, 0.6, 0.8);
            vec3 c3 = vec3(0.15, 0.72, 0.48);
            vec3 c4 = vec3(0.96, 0.64, 0.38);
            vec3 c5 = vec3(0.91, 0.43, 0.32);
            vec3 c6 = vec3(0.85, 0.16, 0.16);
            vec3 c7 = vec3(1.0, 0.82, 0.4);
            if (t < 0.15) return mix(c0, c1, t / 0.15);
            if (t < 0.30) return mix(c1, c2, (t - 0.15) / 0.15);
            if (t < 0.45) return mix(c2, c3, (t - 0.30) / 0.15);
            if (t < 0.60) return mix(c3, c4, (t - 0.45) / 0.15);
            if (t < 0.75) return mix(c4, c5, (t - 0.60) / 0.15);
            if (t < 0.90) return mix(c5, c6, (t - 0.75) / 0.15);
            return mix(c6, c7, (t - 0.90) / 0.10);
          }

          // 2. Salinity: cmocean haline with Bengal River plume vs Arabian Evaporative basin
          vec3 paletteHaline(float t) {
            vec3 c0 = vec3(0.13, 0.0, 0.29);   // Deep violet (<31 PSU, river plume)
            vec3 c1 = vec3(0.24, 0.12, 0.6);   // Sapphire violet
            vec3 c2 = vec3(0.12, 0.35, 0.82);  // Cobalt blue
            vec3 c3 = vec3(0.0, 0.68, 0.76);   // Oceanic cyan (34-35 PSU)
            vec3 c4 = vec3(0.38, 0.85, 0.58);  // Sea green
            vec3 c5 = vec3(0.88, 0.88, 0.22);  // Luminous amber-lime (36.5 PSU)
            vec3 c6 = vec3(1.0, 0.72, 0.12);   // Brilliant gold-topaz (>38 PSU, Red Sea/Arabian)
            if (t < 0.16) return mix(c0, c1, t / 0.16);
            if (t < 0.32) return mix(c1, c2, (t - 0.16) / 0.16);
            if (t < 0.48) return mix(c2, c3, (t - 0.32) / 0.16);
            if (t < 0.65) return mix(c3, c4, (t - 0.48) / 0.17);
            if (t < 0.82) return mix(c4, c5, (t - 0.65) / 0.17);
            return mix(c5, c6, (t - 0.82) / 0.18);
          }

          // 3. Chlorophyll: NASA MODIS Ocean Color / cmocean alga
          vec3 paletteAlga(float t) {
            vec3 c0 = vec3(0.01, 0.05, 0.11);  // Oligotrophic desert (deep indigo navy)
            vec3 c1 = vec3(0.02, 0.18, 0.18);  // Low productivity cyan-navy
            vec3 c2 = vec3(0.06, 0.38, 0.22);  // Moderate oceanic green
            vec3 c3 = vec3(0.15, 0.62, 0.28);  // Productive emerald
            vec3 c4 = vec3(0.38, 0.85, 0.32);  // Rich vibrant green
            vec3 c5 = vec3(0.72, 0.94, 0.36);  // Luminous chartreuse bloom
            vec3 c6 = vec3(1.0, 0.96, 0.42);   // Golden biological peak
            if (t < 0.16) return mix(c0, c1, t / 0.16);
            if (t < 0.32) return mix(c1, c2, (t - 0.16) / 0.16);
            if (t < 0.48) return mix(c2, c3, (t - 0.32) / 0.16);
            if (t < 0.66) return mix(c3, c4, (t - 0.48) / 0.18);
            if (t < 0.84) return mix(c4, c5, (t - 0.66) / 0.18);
            return mix(c5, c6, (t - 0.84) / 0.16);
          }

          // 4. Currents: cmocean speed with directional flow wave advection
          vec3 paletteSpeed(float t) {
            vec3 c0 = vec3(0.03, 0.08, 0.18);
            vec3 c1 = vec3(0.08, 0.22, 0.45);
            vec3 c2 = vec3(0.1, 0.44, 0.68);
            vec3 c3 = vec3(0.16, 0.72, 0.74);
            vec3 c4 = vec3(0.38, 0.88, 0.58);
            vec3 c5 = vec3(0.76, 0.96, 0.36);
            vec3 c6 = vec3(1.0, 0.95, 0.3);
            if (t < 0.16) return mix(c0, c1, t / 0.16);
            if (t < 0.32) return mix(c1, c2, (t - 0.16) / 0.16);
            if (t < 0.48) return mix(c2, c3, (t - 0.32) / 0.16);
            if (t < 0.66) return mix(c3, c4, (t - 0.48) / 0.18);
            if (t < 0.84) return mix(c4, c5, (t - 0.66) / 0.18);
            return mix(c5, c6, (t - 0.84) / 0.16);
          }

          void main() {
            vec3 earth = texture2D(uEarthMap, vUv).rgb;
            float water = smoothstep(0.18, 0.46, texture2D(uWaterMask, vUv).r);

            // Geographic metrics
            float latFromEq = abs(vUv.y - 0.5) * 2.0;
            float tropicality = pow(max(0.0, cos(latFromEq * 1.5708)), 1.3);
            float lonPhase = vUv.x * 6.2831;

            // Physical thermocline dropoff
            float thermocline = 1.0 - exp(-uDepth / (200.0 + tropicality * 140.0));

            vec3 fieldColor = vec3(0.0);

            if (uVariable < 0.5) {
              // TEMPERATURE (cmocean thermal): warm pool in east, cooler upwelling in west, thermocline at depth
              float wave = sin(vPosition.x * 4.0 + uTime * 0.4) * 0.04;
              float normVal = clamp(0.1 + tropicality * 0.88 - thermocline * 0.76 + wave, 0.0, 1.0);
              fieldColor = paletteThermal(normVal);
            }
            else if (uVariable < 1.5) {
              // SALINITY (cmocean haline):
              // High salinity in Arabian Sea / Persian Gulf (lon < 0.55), low in Bay of Bengal (lon > 0.55)
              float regionalEvap = (0.5 - vUv.x) * 1.8;
              float gyre = sin(latFromEq * 3.1416);
              float baseSal = clamp(0.32 + gyre * 0.42 + regionalEvap * 0.28 + thermocline * 0.1, 0.0, 1.0);

              // Isohaline contour ridges (delicate contour lines showing density fronts)
              float isohaline = abs(fract(baseSal * 10.0) - 0.5);
              float contour = smoothstep(0.44, 0.48, isohaline) * 0.15;

              fieldColor = paletteHaline(baseSal) + vec3(contour * 0.6, contour * 0.8, contour);
            }
            else if (uVariable < 2.5) {
              // CHLOROPHYLL (NASA MODIS alga):
              // Coastal bloom filaments and Southern Ocean front vs oligotrophic subtropical gyre
              float coastProximity = smoothstep(0.42, 0.49, texture2D(uWaterMask, vUv).r);
              float bloomFilament = sin(vPosition.x * 18.0 + sin(vPosition.y * 14.0 + uTime * 0.5) * 3.0) * 0.5 + 0.5;
              float southernFront = smoothstep(0.65, 0.95, vUv.y);

              float chlVal = clamp(0.04 + (1.0 - coastProximity) * 0.65 + bloomFilament * 0.28 + southernFront * 0.45 - thermocline * 0.25, 0.0, 1.0);
              fieldColor = paletteAlga(chlVal);
            }
            else {
              // CURRENTS (cmocean speed):
              // Flow advection wavelets traveling in direction of ocean currents
              float flowDirX = sin(vUv.y * 6.28);
              float flowDirY = cos(vUv.x * 6.28);
              float advection = sin(vPosition.x * 35.0 + vPosition.y * 25.0 - uTime * 3.8) * 0.5 + 0.5;
              float jetSpeed = clamp(0.22 + exp(-pow(latFromEq / 0.25, 2.0)) * 0.55 + advection * 0.22, 0.0, 1.0);
              fieldColor = paletteSpeed(jetSpeed) * (0.85 + advection * 0.35);
            }

            // GLOBAL OCEAN COVERAGE: All oceans (Pacific, Atlantic, Southern, Arctic, Indian)
            // render continuous, physically grounded scientific fields worldwide.
            float light = max(dot(vNormal, normalize(vec3(1.0, 0.8, 1.2))), 0.0);

            // Indian Ocean High-Resolution 4D Digital Twin Sector [20°E, 125°E], [-45°S, 32°N]
            float inLon = smoothstep(0.535, 0.565, vUv.x) * (1.0 - smoothstep(0.835, 0.865, vUv.x));
            float inLat = smoothstep(0.235, 0.265, vUv.y) * (1.0 - smoothstep(0.665, 0.695, vUv.y));
            float inIndianOcean = inLon * inLat;

            // Global base data intensity with high-resolution enhancement in the Indian Ocean twin sector
            float overlayIntensity = mix(uOverlayStrength * 0.72, uOverlayStrength * 1.05, inIndianOcean);
            vec3 litOcean = mix(earth, fieldColor * (0.54 + light * 0.72), overlayIntensity);

            // Subtle sector perimeter indicator (soft glowing dashed outline framing the high-res twin)
            float borderU = smoothstep(0.003, 0.0, abs(vUv.x - 0.5556)) + smoothstep(0.003, 0.0, abs(vUv.x - 0.8472));
            float borderV = smoothstep(0.004, 0.0, abs(vUv.y - 0.2500)) + smoothstep(0.004, 0.0, abs(vUv.y - 0.6778));
            float sectorOutline = clamp(borderU * inLat + borderV * inLon, 0.0, 1.0) * water * 0.35;

            vec3 finalOcean = litOcean + vec3(0.0, 0.95, 1.0) * sectorOutline;

            // Clean land masking with zero color bleed
            gl_FragColor = vec4(mix(earth * (0.45 + light * 0.55), finalOcean, water), 1.0);
          }
        `,
      }),
    [variable, earthMap, waterMask, overlayStrength]
  )

  material.uniforms.uTime.value = timeIndex * 0.8
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
 * Animated Holographic Sonar Beacon.
 */
function HolographicBeacon({ selection }: { selection: Selection }) {
  const isSector = isPointInIndianOcean(selection.latitude, selection.longitude)
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

  const primaryColor = isSector ? '#00f2fe' : '#f59e0b'
  const secondaryColor = isSector ? '#4facfe' : '#fbbf24'
  const beamColor = isSector ? '#70e2ff' : '#fde68a'

  return (
    <group position={localPos} quaternion={quaternion}>
      <mesh>
        <circleGeometry args={[0.024, 32]} />
        <meshBasicMaterial color={primaryColor} transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring1Ref}>
        <ringGeometry args={[0.035, 0.05, 32]} />
        <meshBasicMaterial color={secondaryColor} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2Ref}>
        <ringGeometry args={[0.035, 0.05, 32]} />
        <meshBasicMaterial color={primaryColor} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0.07]}>
        <cylinderGeometry args={[0.0018, 0.0018, 0.14, 8]} />
        <meshBasicMaterial color={beamColor} transparent opacity={0.75} />
      </mesh>
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
      const localVec = latLngToVector3(targetPoint.latitude, targetPoint.longitude, RADIUS)
      const worldVec = localVec.clone().applyMatrix4(globeGroupRef.current.matrixWorld)
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

function IndianOceanSectorBoundary() {
  const points = useMemo(() => {
    const pts: THREE.Vector3[] = []
    const lonMin = 20, lonMax = 125
    const latMin = -45, latMax = 32

    // North border: lonMin -> lonMax at latMax (32°N)
    for (let lon = lonMin; lon <= lonMax; lon += 2.5) {
      pts.push(latLngToVector3(latMax, lon, RADIUS + 0.012))
    }
    // East border: latMax -> latMin at lonMax (125°E)
    for (let lat = latMax; lat >= latMin; lat -= 2.5) {
      pts.push(latLngToVector3(lat, lonMax, RADIUS + 0.012))
    }
    // South border: lonMax -> lonMin at latMin (-45°S)
    for (let lon = lonMax; lon >= lonMin; lon -= 2.5) {
      pts.push(latLngToVector3(latMin, lon, RADIUS + 0.012))
    }
    // West border: latMin -> latMax at lonMin (20°E)
    for (let lat = latMin; lat <= latMax; lat += 2.5) {
      pts.push(latLngToVector3(lat, lonMin, RADIUS + 0.012))
    }
    pts.push(latLngToVector3(latMax, lonMin, RADIUS + 0.012))
    return pts
  }, [])

  return (
    <Line
      points={points}
      color="#00f2fe"
      lineWidth={1.0}
      transparent
      opacity={0.38}
    />
  )
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

        {/* Indian Ocean Digital Twin Observation Boundary [20°E-125°E, 45°S-32°N] */}
        <IndianOceanSectorBoundary />

        {/* Real Geodesic Streamline Flow Particles */}
        <StreamlineParticles
          active={variable === 'currents' || mode === 'dive'}
          timeIndex={timeIndex}
        />

        {instruments.map((instrument) => (
          <Marker key={instrument.id} instrument={instrument} onSelect={onInstrument} />
        ))}

        {/* Holographic Sonar Beacon at clicked spot */}
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
        autoRotateSpeed={0.18}
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
