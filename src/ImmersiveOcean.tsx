import { PointerLockControls, Stars } from '@react-three/drei'
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { querySubgridTelemetry } from './oceanDataEngine'
import type { OceanVariable, Selection } from './types'

interface DiveTelemetry {
  depth: number
  temperature: number
  salinity: number
  chlorophyll: number
  currentSpeed: number
  currentU: number
  currentV: number
  temperatureProfile: number[]
}
interface Props { variable: OceanVariable; selection: Selection; timeIndex: number; onTelemetry: (telemetry: DiveTelemetry) => void }

const worldLimit = 120


const BATHYMETRY_BOUNDS = {
  lat_min: -44.99166666666667,
  lat_max: 32.008333333333326,
  lon_min: 20.008333333333326,
  lon_max: 125.00833333333333,
}
// Local patch size (degrees) sampled around the dive location. This is a
// gameplay-scale choice, not literal geographic scale: the real ETOPO
// relief SHAPE is sampled faithfully, but compressed into the dive's
// existing playable vertical range (see normalization below) since literal
// real-world depths (trenches to -7000m+) would sit far below where the
// diver can actually reach (camera clamps to -17..7.5).
const PATCH_DEGREES = 1.6

function Terrain({ selection }: { selection: Selection }) {
  const [bathymetry, setBathymetry] = useState<{
    data: Uint8ClampedArray
    width: number
    height: number
  } | null>(null)

  useEffect(() => {
    const image = new Image()

    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height

      const ctx = canvas.getContext('2d')

      if (!ctx) {
        console.warn('Bathymetry: could not create canvas context')
        return
      }

      try {
        ctx.drawImage(image, 0, 0)

        const imageData = ctx.getImageData(
          0,
          0,
          image.width,
          image.height,
        )

        setBathymetry({
          data: imageData.data,
          width: image.width,
          height: image.height,
        })

        console.info(
          `Bathymetry loaded: ${image.width}x${image.height}`,
        )
      } catch (error) {
        console.error(
          'Bathymetry pixel read failed:',
          error,
        )
      }
    }

    image.onerror = () => {
      console.error(
        'Bathymetry image failed to load:',
        '/data/bathymetry_relief.png',
      )
    }

    image.src = '/data/bathymetry_relief.png'
  }, [])

  const geometry = useMemo(() => {
    const size = 260
    const segments = 96

    const positions = new Float32Array(
      (segments + 1) * (segments + 1) * 3,
    )

    const indices: number[] = []

    const rawDepths = new Float32Array(
      (segments + 1) * (segments + 1),
    )

    let minDepth = Infinity
    let maxDepth = -Infinity

    const sampleDepth = (lat: number, lon: number) => {
      if (!bathymetry) return 0

      const u =
        (lon - BATHYMETRY_BOUNDS.lon_min) /
        (BATHYMETRY_BOUNDS.lon_max - BATHYMETRY_BOUNDS.lon_min)

      const v =
        (BATHYMETRY_BOUNDS.lat_max - lat) /
        (BATHYMETRY_BOUNDS.lat_max - BATHYMETRY_BOUNDS.lat_min)

      const px = THREE.MathUtils.clamp(
        Math.round(u * (bathymetry.width - 1)),
        0,
        bathymetry.width - 1,
      )

      const py = THREE.MathUtils.clamp(
        Math.round(v * (bathymetry.height - 1)),
        0,
        bathymetry.height - 1,
      )

      const index =
        (py * bathymetry.width + px) * 4

      return (bathymetry.data[index] / 255) * 7500
    }

    for (let z = 0; z <= segments; z += 1) {
      for (let x = 0; x <= segments; x += 1) {
        const i =
          z * (segments + 1) + x

        const fx =
          x / segments - 0.5

        const fz =
          z / segments - 0.5

        const lat =
          selection.latitude -
          fz * PATCH_DEGREES

        const lon =
          selection.longitude +
          fx * PATCH_DEGREES

        const depth =
          sampleDepth(lat, lon)

        rawDepths[i] = depth

        if (bathymetry) {
          minDepth = Math.min(
            minDepth,
            depth,
          )

          maxDepth = Math.max(
            maxDepth,
            depth,
          )
        }
      }
    }

    // Safe flat fallback until bathymetry loads.
    if (!bathymetry) {
      minDepth = 0
      maxDepth = 1
    }

    const range =
      Math.max(1, maxDepth - minDepth)

    for (let z = 0; z <= segments; z += 1) {
      for (let x = 0; x <= segments; x += 1) {
        const i =
          z * (segments + 1) + x

        const px =
          (x / segments - 0.5) * size

        const pz =
          (z / segments - 0.5) * size

        const normalized =
          bathymetry
            ? (rawDepths[i] - minDepth) / range
            : 0

        const y =
          -18 - normalized * 14

        positions[i * 3] = px
        positions[i * 3 + 1] = y
        positions[i * 3 + 2] = pz
      }
    }

    for (let z = 0; z < segments; z += 1) {
      for (let x = 0; x < segments; x += 1) {
        const a =
          z * (segments + 1) + x

        const b = a + 1
        const c = a + segments + 1
        const d = c + 1

        indices.push(a, c, b)
        indices.push(b, c, d)
      }
    }

    const result =
      new THREE.BufferGeometry()

    result.setAttribute(
      'position',
      new THREE.BufferAttribute(
        positions,
        3,
      ),
    )

    result.setIndex(indices)
    result.computeVertexNormals()

    return result
  }, [
    bathymetry,
    selection.latitude,
    selection.longitude,
  ])

  return (
    <mesh
      geometry={geometry}
      receiveShadow
      position={[0, 0, 0]}
    >
      <meshStandardMaterial
        color="#38413f"
        roughness={0.96}
        metalness={0}
      />
    </mesh>
  )
}

function OceanSurface() {
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    uniforms: { time: { value: 0 } },
    vertexShader: `uniform float time; varying vec2 vUv; void main(){ vUv=uv; vec3 p=position; p.z += sin(p.x*.08+time*.8)*.35; p.y += sin(p.x*.06+p.z*.08+time)*.22; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.); }`,
    fragmentShader: `varying vec2 vUv; void main(){ float lines=sin(vUv.x*170.)*.5+.5; vec3 c=mix(vec3(.01,.15,.22),vec3(.08,.54,.68),vUv.y)*(.7+lines*.12); gl_FragColor=vec4(c,.48); }`,
  }), [])
  useFrame(({ clock }) => { material.uniforms.time.value = clock.getElapsedTime() })
  return <mesh position={[0, 8, 0]} rotation={[-Math.PI / 2, 0, 0]} material={material}><planeGeometry args={[330, 330, 90, 90]} /></mesh>
}

function WaterParticles() {
  const ref = useRef<THREE.Points>(null)
  const positions = useMemo(() => {
    const data = new Float32Array(1800 * 3)
    for (let i = 0; i < 1800; i += 1) {
      data[i * 3] = ((i * 37) % 240) - 120
      data[i * 3 + 1] = ((i * 73) % 47) - 36
      data[i * 3 + 2] = ((i * 97) % 240) - 120
    }
    return data
  }, [])
  useFrame(({ clock }) => { if (ref.current) ref.current.position.y = Math.sin(clock.getElapsedTime() * .13) * .7 })
  return <points ref={ref}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><pointsMaterial color="#9beeff" size={.09} sizeAttenuation transparent opacity={.42} depthWrite={false} /></points>
}

function Diver({
  selection,
  timeIndex,
  onTelemetry,
}: {
  selection: Selection
  timeIndex: number
  onTelemetry: (telemetry: DiveTelemetry) => void
}) {
  const { camera } = useThree()

  const keys = useRef<Record<string, boolean>>({})
  const lastTelemetry = useRef(0)

  const lastDepth = useRef<number | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const update = (
      event: KeyboardEvent,
      state: boolean
    ) => {
      keys.current[event.key.toLowerCase()] = state
    }

    const down = (event: KeyboardEvent) =>
      update(event, true)

    const up = (event: KeyboardEvent) =>
      update(event, false)

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)

    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useFrame((state, delta) => {
    const speed = keys.current.shift ? 16 : 8

    const forward = new THREE.Vector3()

    camera.getWorldDirection(forward)

    forward.y = 0
    forward.normalize()

    const right = new THREE.Vector3()
      .crossVectors(forward, camera.up)
      .normalize()

    if (keys.current.w) {
      camera.position.addScaledVector(
        forward,
        speed * delta
      )
    }

    if (keys.current.s) {
      camera.position.addScaledVector(
        forward,
        -speed * delta
      )
    }

    if (keys.current.a) {
      camera.position.addScaledVector(
        right,
        -speed * delta
      )
    }

    if (keys.current.d) {
      camera.position.addScaledVector(
        right,
        speed * delta
      )
    }

    if (keys.current.arrowup) {
      camera.position.y += speed * delta
    }

    if (keys.current.arrowdown) {
      camera.position.y -= speed * delta
    }

    camera.position.x = THREE.MathUtils.clamp(
      camera.position.x,
      -worldLimit,
      worldLimit
    )

    camera.position.z = THREE.MathUtils.clamp(
      camera.position.z,
      -worldLimit,
      worldLimit
    )

    camera.position.y = THREE.MathUtils.clamp(
      camera.position.y,
      -17,
      7.5
    )

    /*
     * Convert our world-space camera height into
     * an oceanographic depth.
     */
    const depth = Math.round(
      Math.max(0, 8 - camera.position.y) * 92
    )

    /*
     * Only request new scientific telemetry when
     * the diver has moved meaningfully in depth.
     */
    const depthChanged =
      lastDepth.current === null ||
      Math.abs(depth - lastDepth.current) >= 3

    const timeChanged =
      state.clock.elapsedTime -
        lastTelemetry.current >
      0.8

    if (depthChanged && timeChanged) {
      lastTelemetry.current =
        state.clock.elapsedTime

      lastDepth.current = depth

      const currentRequest =
        ++requestId.current

      querySubgridTelemetry(
        selection.latitude,
        selection.longitude,
        depth,
        timeIndex
      ).then((data) => {
        /*
         * Ignore an older request if the diver
         * has already moved again.
         */
        if (
          currentRequest !== requestId.current
        ) {
          return
        }

        onTelemetry({
          depth,
          temperature: data.temperature_c,
          salinity: data.salinity_psu,
          chlorophyll:
            data.chlorophyll_mg_m3,
          currentSpeed:
            data.current_speed_m_s,
          currentU:
            data.current_vector.u,
          currentV:
            data.current_vector.v,
          temperatureProfile:
            data.ctd_profile.temperatures,
        })
      })
    }
  })

  return null
}

function TemperatureField({
  temperature,
  currentDepth,
  temperatureProfile,
}: {
  temperature: number
  currentDepth: number
  temperatureProfile: number[]
}) {
  if (!temperatureProfile.length) {
    return null
  }

  return (
    <ThermalField
      temperature={temperature}
      currentDepth={currentDepth}
      temperatureProfile={temperatureProfile}
    />
  )
}

const PROFILE_DEPTHS = [
  0,
  10,
  25,
  50,
  75,
  100,
  150,
  200,
  300,
  500,
  750,
  1000,
  1500,
  2000,
  3000,
  5000,
]
function interpolateProfile(
  depths: number[],
  temperatures: number[],
  depth: number
) {
  if (!temperatures.length) return 0

  if (depth <= depths[0]) {
    return temperatures[0]
  }

  const last = temperatures.length - 1

  if (depth >= depths[last]) {
    return temperatures[last]
  }

  for (let i = 0; i < last; i += 1) {
    if (
      depth >= depths[i] &&
      depth <= depths[i + 1]
    ) {
      const t =
        (depth - depths[i]) /
        (depths[i + 1] - depths[i])

      return THREE.MathUtils.lerp(
        temperatures[i],
        temperatures[i + 1],
        t
      )
    }
  }

  return temperatures[last]
}

function getProfileTemperature(
  depth: number,
  profile: number[]
) {
  if (!profile.length) return 0

  if (depth <= PROFILE_DEPTHS[0]) {
    return profile[0]
  }

  const last = Math.min(
    profile.length - 1,
    PROFILE_DEPTHS.length - 1
  )

  if (depth >= PROFILE_DEPTHS[last]) {
    return profile[last]
  }

  for (let i = 0; i < last; i += 1) {
    const d0 = PROFILE_DEPTHS[i]
    const d1 = PROFILE_DEPTHS[i + 1]

    if (depth >= d0 && depth <= d1) {
      const t =
        (depth - d0) /
        (d1 - d0)

      return THREE.MathUtils.lerp(
        profile[i],
        profile[i + 1],
        t
      )
    }
  }

  return profile[last]
}

function getTemperatureColor(
  temperature: number
) {
  const normalized =
    THREE.MathUtils.clamp(
      (temperature - 2) / 28,
      0,
      1
    )

  const color = new THREE.Color()

  if (normalized < 0.35) {
    color.set('#1268a8')
    color.lerp(
      new THREE.Color('#21c7dc'),
      normalized / 0.35
    )
  } else if (normalized < 0.65) {
    color.set('#21c7dc')
    color.lerp(
      new THREE.Color('#f4df58'),
      (normalized - 0.35) / 0.30
    )
  } else {
    color.set('#f4df58')
    color.lerp(
      new THREE.Color('#ef5b2b'),
      (normalized - 0.65) / 0.35
    )
  }

  return color
}

function ThermalField({
  temperature,
  currentDepth,
  temperatureProfile,
}: {
  temperature: number
  currentDepth: number
  temperatureProfile: number[]
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const fieldRef = useRef<THREE.Mesh>(null)

  const { camera } = useThree()

    const profile = useMemo(() => {
    const values = new Array(32).fill(0)

    if (!temperatureProfile.length) {
      return values
    }

    for (let i = 0; i < values.length; i += 1) {
      const t = i / (values.length - 1)
      const depth = t * 5000

      values[i] = interpolateProfile(
        PROFILE_DEPTHS,
        temperatureProfile,
        depth
      )
    }

    return values
  }, [temperatureProfile])

  const uniforms = useMemo(() => {
    return {
      time: { value: 0 },
      temperature: { value: temperature },
      currentDepth: { value: currentDepth },

      profile: {
        value: profile,
      },
    }
  }, [temperature, currentDepth, profile])

  useFrame(({ clock }) => {
    if (!materialRef.current || !fieldRef.current) return

    // Keep the thermal field centered on the diver.
    fieldRef.current.position.copy(camera.position)

    materialRef.current.uniforms.time.value =
      clock.getElapsedTime()

    materialRef.current.uniforms.temperature.value =
      temperature

    materialRef.current.uniforms.currentDepth.value =
      currentDepth

    materialRef.current.uniforms.profile.value =
      profile
  })

  return (
    <mesh
      ref={fieldRef}
      scale={[1, 0.7, 1]}
    >
      <sphereGeometry args={[55, 56, 40]} />

      <shaderMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
        side={THREE.BackSide}
        uniforms={uniforms}

        vertexShader={`
          varying vec3 vLocalPosition;

          void main() {
            vLocalPosition = position;

            gl_Position =
              projectionMatrix *
              modelViewMatrix *
              vec4(position, 1.0);
          }
        `}

        fragmentShader={`
          uniform float time;
          uniform float temperature;
          uniform float currentDepth;
          uniform float profile[32];

          varying vec3 vLocalPosition;

          float hash(vec3 p) {
            p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
            p *= 17.0;

            return fract(
              p.x * p.y * p.z *
              (p.x + p.y + p.z)
            );
          }

          float noise(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);

            f = f * f * (3.0 - 2.0 * f);

            float a = hash(i);
            float b = hash(i + vec3(1.0, 0.0, 0.0));
            float c = hash(i + vec3(0.0, 1.0, 0.0));
            float d = hash(i + vec3(1.0, 1.0, 0.0));

            float e = hash(i + vec3(0.0, 0.0, 1.0));
            float f1 = hash(i + vec3(1.0, 0.0, 1.0));
            float g = hash(i + vec3(0.0, 1.0, 1.0));
            float h = hash(i + vec3(1.0, 1.0, 1.0));

            float x1 = mix(a, b, f.x);
            float x2 = mix(c, d, f.x);
            float x3 = mix(e, f1, f.x);
            float x4 = mix(g, h, f.x);

            return mix(
              mix(x1, x2, f.y),
              mix(x3, x4, f.y),
              f.z
            );
          }

          float fbm(vec3 p) {
            float value = 0.0;
            float amplitude = 0.5;

            for (int i = 0; i < 4; i++) {
              value += noise(p) * amplitude;
              p *= 2.0;
              amplitude *= 0.5;
            }

            return value;
          }

          vec3 temperatureColor(float t) {
            vec3 cold   = vec3(0.005, 0.12, 0.55);
            vec3 blue   = vec3(0.01, 0.35, 0.80);
            vec3 cyan   = vec3(0.02, 0.72, 0.88);
            vec3 yellow = vec3(1.00, 0.80, 0.18);
            vec3 orange = vec3(1.00, 0.25, 0.02);

            if (t < 0.25) {
              return mix(cold, blue, smoothstep(0.0, 0.25, t));
            }
            if (t < 0.55) {
              return mix(blue, cyan, smoothstep(0.25, 0.55, t));
            }
            if (t < 0.8) {
              return mix(cyan, yellow, smoothstep(0.55, 0.8, t));
            }
            return mix(yellow, orange, smoothstep(0.8, 1.0, t));
          }

          float profileTemperature(float normalizedDepth) {
            float scaled =
              clamp(normalizedDepth, 0.0, 0.999) * 31.0;

            float a = floor(scaled);
            float b = min(a + 1.0, 31.0);

            float f = scaled - a;

            return mix(
              profile[int(a)],
              profile[int(b)],
              f
            );
          }

          void main() {

            /*
            * Because the thermal volume follows the camera,
            * the camera is at local coordinate (0,0,0).
            *
            * vLocalPosition is therefore the point where
            * this viewing ray exits the sphere.
            */
            vec3 rayEnd = vLocalPosition;

            float rayLength = length(rayEnd);

            if (rayLength < 0.1) {
              discard;
            }

            vec3 rayDirection =
              normalize(rayEnd);

            /*
            * March from the diver outward through the
            * water volume.
            */
            const int STEPS = 48;

            float stepLength =
              rayLength / float(STEPS);

            vec3 accumulatedColor =
              vec3(0.0);

            float accumulatedAlpha =
              0.0;

            for (int i = 0; i < STEPS; i++) {

              float fi =
                (float(i) + 0.5) /
                float(STEPS);

              vec3 p =
                rayDirection *
                rayLength *
                fi;

              float localDepth =
                currentDepth -
                p.y * 92.0;

              localDepth =
                max(0.0, localDepth);

              float normalizedDepth =
                clamp(localDepth / 5000.0, 0.0, 1.0);

              float temp =
                profileTemperature(
                  normalizedDepth
                );

              float normalizedTemperature =
                clamp(
                  (temp - 2.0) / 26.0,
                  0.0,
                  1.0
                );

              vec3 flowPosition = vec3(
                p.x * 0.045,
                p.y * 0.12,
                p.z * 0.045
              );

              flowPosition.x += time * 0.018;
              flowPosition.z -= time * 0.012;
              flowPosition.y += sin(time * 0.35 + p.x * 2.0) * 0.025;

              float broad = fbm(flowPosition);

              vec3 q = flowPosition * 2.2;
              q.x -= time * 0.009;
              q.z += time * 0.007;
              float fine = fbm(q);

              float structure =
                broad * 0.75 +
                fine * 0.25;

              float layerNoise =
                fbm(
                  vec3(
                    p.x * 0.055,
                    p.y * 0.12,
                    p.z * 0.055
                  )
                );

              float thermalNoise =
                smoothstep(0.34, 0.72, layerNoise);

              float depthStep = 0.025;

              float tempA =
                profileTemperature(
                  clamp(normalizedDepth - depthStep, 0.0, 1.0)
                );

              float tempB =
                profileTemperature(
                  clamp(normalizedDepth + depthStep, 0.0, 1.0)
                );

              float gradient = abs(tempA - tempB);

              float thermocline =
                smoothstep(0.015, 0.10, gradient);

              /*
              * Base thermal presence everywhere.
              * Stronger temperature gradients create extra shimmer.
              */
              float thermalLayer =
                thermalNoise *
                (0.10 + thermocline * 0.95);

              thermalLayer *= thermocline;

              float shimmer =
                0.82 +
                0.18 *
                sin(
                  time * 1.4 +
                  p.x * 2.0 +
                  p.z * 1.7 +
                  structure * 6.0
                );

              // Keep the thermal shimmer localized around the diver.
              float radialDistance = length(p.xz);

              float spatialFalloff =
                1.0 - smoothstep(
                  18.0,
                  75.0,
                  radialDistance
                );

              float depthFalloff =
                1.0 - smoothstep(
                  22.0,
                  70.0,
                  abs(p.y)
                );

              float density =
                thermalLayer *
                (0.45 + thermocline * 1.25) *
                shimmer *
                spatialFalloff *
                depthFalloff;

              vec3 color =
                temperatureColor(normalizedTemperature);

              float sampleAlpha = density * 0.035;
              sampleAlpha = clamp(sampleAlpha, 0.0, 0.07);

              float remaining =
                1.0 - accumulatedAlpha;

              accumulatedColor +=
                color * sampleAlpha * remaining;

              accumulatedAlpha +=
                sampleAlpha * remaining;

              if (accumulatedAlpha > 0.9) {
                break;
              }
            }

            /*
            * A tiny minimum contribution keeps the
            * temperature field from completely vanishing
            * in visually interesting regions.
            */
            if (accumulatedAlpha < 0.004) {
              discard;
            }

            gl_FragColor =
              vec4(
                accumulatedColor,
                accumulatedAlpha
              );
          }
        `}
      />
    </mesh>
  )
}

function DiveWorld({
  variable,
  selection,
  timeIndex,
  onTelemetry,
}: Props) {
  const [telemetry, setTelemetry] =
  useState<DiveTelemetry>({
    depth: 24,
    temperature: 0,
    salinity: 0,
    chlorophyll: 0,
    currentSpeed: 0,
    currentU: 0,
    currentV: 0,
    temperatureProfile: [],
  })

  const handleTelemetry = (next: DiveTelemetry) => {
    setTelemetry(next)
    onTelemetry(next)
  }

  return (
    <>
      <color attach="background" args={['#06384d']} />

      <ambientLight
        intensity={0.9}
        color="#2f98b8"
      />

      <directionalLight
        position={[0, 17, 20]}
        intensity={2.8}
        color="#b9fbff"
        castShadow
      />

      <pointLight
        position={[0, -4, 2]}
        intensity={2.2}
        color="#19799c"
        distance={65}
      />

      <OceanSurface />

      <Terrain selection={selection} />

      <TemperatureField
        temperature={telemetry.temperature}
        currentDepth={telemetry.depth}
        temperatureProfile={telemetry.temperatureProfile}
      />

      <WaterParticles />

      <Stars
        radius={180}
        depth={80}
        count={1000}
        factor={1}
        saturation={0}
        fade
        speed={0.2}
      />

      <Diver
        selection={selection}
        timeIndex={timeIndex}
        onTelemetry={handleTelemetry}
      />

      <PointerLockControls />
    </>
  )
}

export default function ImmersiveOcean(props: Props) {
  return <Canvas shadows camera={{ position: [0, 3, 55], fov: 64, near: .1, far: 400 }} dpr={[1, 2]} gl={{ antialias: true }}>
    <Suspense
        fallback={
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: '#9beeff',
              background: '#06384d',
              fontFamily: 'sans-serif',
            }}
          >
            Loading Ocean Dive…
          </div>
        }
      >
      <DiveWorld {...props} />
    </Suspense>
  </Canvas>
}
