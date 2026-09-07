import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  generateOceanStreamlines,
  latLngToVector3,
  GLOBE_RADIUS,
  type StreamlineCurve,
  onCurrentsGridUpdate,
} from './oceanDataEngine'

interface OceanCurrentFlowProps {
  active: boolean
  depth: number
  timeIndex: number
  showStreamlines?: boolean
  showParticles?: boolean
  flowIntensity?: number
  flowSpeed?: number
}

// Custom GLSL Shader for smooth continuous fluid flow along streamlines
const StreamlineShaderMaterial = {
  vertexShader: `
    attribute float aSpeed;
    attribute float aProgress;
    attribute float aCurveId;

    varying float vSpeed;
    varying float vProgress;
    varying float vCurveId;

    void main() {
      vSpeed = aSpeed;
      vProgress = aProgress;
      vCurveId = aCurveId;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform float uFlowSpeed;
    uniform float uIntensity;

    varying float vSpeed;
    varying float vProgress;
    varying float vCurveId;

    // Scientific cmocean speed continuous color ramp
    vec3 getSpeedColor(float normSpeed) {
      vec3 deepNavy = vec3(0.02, 0.32, 0.78);     // Slow ambient drift (< 0.25 m/s)
      vec3 marineCyan = vec3(0.0, 0.82, 0.98);    // Moderate drift (0.25 - 0.6 m/s)
      vec3 turquoise = vec3(0.05, 0.98, 0.80);    // Strong current (0.6 - 1.1 m/s)
      vec3 goldenAmber = vec3(1.0, 0.86, 0.22);   // Fast boundary jet (> 1.1 m/s)

      if (normSpeed < 0.28) {
        return mix(deepNavy, marineCyan, normSpeed / 0.28);
      } else if (normSpeed < 0.68) {
        return mix(marineCyan, turquoise, (normSpeed - 0.28) / 0.4);
      } else {
        return mix(turquoise, goldenAmber, (normSpeed - 0.68) / 0.32);
      }
    }

    void main() {
      float normSpeed = clamp(vSpeed / 1.3, 0.0, 1.0);
      vec3 flowColor = getSpeedColor(normSpeed);

      // Continuous fluid traveling wave phase along streamline coordinate
      // Dual frequencies create a silky, organic fluid ribbon flow
      float speedFactor = (0.75 + normSpeed * 1.95) * uFlowSpeed;
      float wave1 = pow(sin(vProgress * 7.5 - uTime * speedFactor + vCurveId * 0.45) * 0.5 + 0.5, 2.2);
      float wave2 = pow(sin(vProgress * 15.0 - uTime * (speedFactor * 1.25) + vCurveId * 0.95) * 0.5 + 0.5, 3.2);
      float wave = wave1 * 0.65 + wave2 * 0.35;

      // Smooth geometric fade at streamline head and tail to eliminate abrupt cuts
      float edgeFade = smoothstep(0.0, 0.08, vProgress) * (1.0 - smoothstep(0.92, 1.0, vProgress));

      // Fast currents are brighter, more luminous, and thicker
      float baseAlpha = mix(0.30, 0.88, normSpeed);
      float alpha = baseAlpha * (0.35 + wave * 0.65) * edgeFade * uIntensity;

      // Glow amplification for energetic boundary jets (Somali, Agulhas, SEC, Wyrtki)
      vec3 finalColor = flowColor * (1.0 + normSpeed * 0.45 + wave * 0.25);

      gl_FragColor = vec4(finalColor, alpha);
    }
  `,
}

// Generate an in-memory smooth circular radial glow texture for luminous particles
function createGlowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)')
    grad.addColorStop(0.22, 'rgba(112, 226, 255, 0.92)')
    grad.addColorStop(0.55, 'rgba(0, 195, 255, 0.35)')
    grad.addColorStop(0.85, 'rgba(0, 90, 230, 0.08)')
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 64, 64)
  }
  const tex = new THREE.CanvasTexture(canvas)
  return tex
}

interface ParticleState {
  curveIdx: number
  progress: number
  speedMult: number
}

export default function OceanCurrentFlow({
  active,
  depth,
  timeIndex,
  showStreamlines = true,
  showParticles = true,
  flowIntensity = 1.0,
  flowSpeed = 1.0,
}: OceanCurrentFlowProps) {
  const [gridVersion, setGridVersion] = useState(0)

  useEffect(() => {
    return onCurrentsGridUpdate(() => setGridVersion((v) => v + 1))
  }, [])

  // 1. Generate smooth, curved streamlines via 4th-order Runge-Kutta on the sphere
  const curves = useMemo<StreamlineCurve[]>(() => {
    return generateOceanStreamlines(depth, timeIndex)
  }, [depth, timeIndex, gridVersion])

  // 2. Build merged BufferGeometry for all streamlines (Layer 2)
  const { streamlineGeom, material } = useMemo(() => {
    let totalSegments = 0
    curves.forEach((c) => {
      if (c.points.length >= 2) {
        totalSegments += c.points.length - 1
      }
    })

    const positions = new Float32Array(totalSegments * 2 * 3)
    const speeds = new Float32Array(totalSegments * 2)
    const progresses = new Float32Array(totalSegments * 2)
    const curveIds = new Float32Array(totalSegments * 2)

    let vIdx = 0
    curves.forEach((c) => {
      const pts = c.points
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i]
        const p1 = pts[i + 1]

        // Vertex 0
        positions[vIdx * 3] = p0.x
        positions[vIdx * 3 + 1] = p0.y
        positions[vIdx * 3 + 2] = p0.z
        speeds[vIdx] = p0.speed
        progresses[vIdx] = p0.s
        curveIds[vIdx] = c.id
        vIdx++

        // Vertex 1
        positions[vIdx * 3] = p1.x
        positions[vIdx * 3 + 1] = p1.y
        positions[vIdx * 3 + 2] = p1.z
        speeds[vIdx] = p1.speed
        progresses[vIdx] = p1.s
        curveIds[vIdx] = c.id
        vIdx++
      }
    })

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))
    geom.setAttribute('aProgress', new THREE.BufferAttribute(progresses, 1))
    geom.setAttribute('aCurveId', new THREE.BufferAttribute(curveIds, 1))

    const mat = new THREE.ShaderMaterial({
      vertexShader: StreamlineShaderMaterial.vertexShader,
      fragmentShader: StreamlineShaderMaterial.fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uFlowSpeed: { value: flowSpeed },
        uIntensity: { value: flowIntensity },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    return { streamlineGeom: geom, material: mat }
  }, [curves, flowSpeed, flowIntensity])

  // 3. Layer 3: Motion — Luminous advected particles with curved glowing comet wakes
  const particleCount = useMemo(() => Math.min(650, Math.max(300, curves.length * 4)), [curves.length])

  const particles = useMemo<ParticleState[]>(() => {
    const list: ParticleState[] = []
    if (curves.length === 0) return list

    for (let i = 0; i < particleCount; i++) {
      const curveIdx = i % curves.length
      list.push({
        curveIdx,
        progress: (i / particleCount + Math.random() * 0.15) % 1.0,
        speedMult: 0.85 + Math.random() * 0.35,
      })
    }
    return list
  }, [particleCount, curves])

  // Head, Body, and Tail positions and colors (smooth curved 3-stage comet wake)
  const headPos = useMemo(() => new Float32Array(particleCount * 3), [particleCount])
  const headColors = useMemo(() => new Float32Array(particleCount * 3), [particleCount])

  const bodyPos = useMemo(() => new Float32Array(particleCount * 3), [particleCount])
  const bodyColors = useMemo(() => new Float32Array(particleCount * 3), [particleCount])

  const tailPos = useMemo(() => new Float32Array(particleCount * 3), [particleCount])
  const tailColors = useMemo(() => new Float32Array(particleCount * 3), [particleCount])

  const geomHeadRef = useRef<THREE.BufferGeometry>(null)
  const geomBodyRef = useRef<THREE.BufferGeometry>(null)
  const geomTailRef = useRef<THREE.BufferGeometry>(null)

  // Helper to sample position along a streamline curve at progress s in [0, 1]
  const sampleCurve = (curve: StreamlineCurve, s: number, radius = GLOBE_RADIUS + 0.015) => {
    const clamped = Math.max(0, Math.min(1, s))
    const n = curve.points.length
    const indexFloat = clamped * (n - 1)
    const idx0 = Math.floor(indexFloat)
    const idx1 = Math.min(n - 1, idx0 + 1)
    const frac = indexFloat - idx0

    const p0 = curve.points[idx0]
    const p1 = curve.points[idx1]

    const lat = THREE.MathUtils.lerp(p0.lat, p1.lat, frac)
    const lon = THREE.MathUtils.lerp(p0.lon, p1.lon, frac)
    const speed = THREE.MathUtils.lerp(p0.speed, p1.speed, frac)

    const vec = latLngToVector3(lat, lon, radius)
    return { vec, speed }
  }

  // Animation frame loop: updates shader uTime and advects particles along curves
  useFrame(({ clock }, delta) => {
    if (!active) return

    const dt = Math.min(delta, 0.05)
    material.uniforms.uTime.value = clock.getElapsedTime()
    material.uniforms.uFlowSpeed.value = flowSpeed
    material.uniforms.uIntensity.value = flowIntensity

    if (!showParticles || curves.length === 0) return

    for (let i = 0; i < particleCount; i++) {
      const p = particles[i]
      const curve = curves[p.curveIdx]
      if (!curve || curve.points.length < 2) continue

      // Advect along curve proportional to local velocity speed
      const curSample = sampleCurve(curve, p.progress)
      const advanceSpeed = Math.max(0.18, curSample.speed)
      const step = (advanceSpeed * dt * 0.42 * p.speedMult * flowSpeed) / Math.max(1, curve.points.length * 0.06)

      p.progress += step

      // Respawn upstream when reaching end of trajectory (continuous conveyor-belt fluid flow)
      if (p.progress >= 1.0) {
        p.progress = 0.0
        if (Math.random() < 0.3) {
          p.curveIdx = Math.floor(Math.random() * curves.length)
        }
      }

      // Sample leading head position, slightly lagging body, and trailing tail along the smooth curve
      const head = sampleCurve(curve, p.progress, GLOBE_RADIUS + 0.016)
      const bodyProgress = Math.max(0, p.progress - 0.016)
      const body = sampleCurve(curve, bodyProgress, GLOBE_RADIUS + 0.015)
      const tailProgress = Math.max(0, p.progress - 0.032)
      const tail = sampleCurve(curve, tailProgress, GLOBE_RADIUS + 0.014)

      // Update head point
      headPos[i * 3] = head.vec.x
      headPos[i * 3 + 1] = head.vec.y
      headPos[i * 3 + 2] = head.vec.z

      // Update body point
      bodyPos[i * 3] = body.vec.x
      bodyPos[i * 3 + 1] = body.vec.y
      bodyPos[i * 3 + 2] = body.vec.z

      // Update tail point
      tailPos[i * 3] = tail.vec.x
      tailPos[i * 3 + 1] = tail.vec.y
      tailPos[i * 3 + 2] = tail.vec.z

      // Luminescence: speed magnitude and organic life fade
      const speedNorm = Math.min(1.0, head.speed / 1.35)
      const edgeFade = Math.sin(p.progress * Math.PI) // Fades in upstream, fades out downstream
      const alpha = edgeFade * flowIntensity

      // Scientific color palette for particles
      let r = 0.12, g = 0.85, b = 1.0 // Marine cyan
      if (speedNorm > 0.68) {
        r = 1.0; g = 0.94; b = 0.28 // Fast boundary jet: luminous gold
      } else if (speedNorm > 0.35) {
        r = 0.05; g = 0.95; b = 0.85 // Turquoise
      }

      // Head: brilliant core
      headColors[i * 3] = r * alpha
      headColors[i * 3 + 1] = g * alpha
      headColors[i * 3 + 2] = b * alpha

      // Body: soft trailing glow
      const bodyAlpha = alpha * 0.52
      bodyColors[i * 3] = r * bodyAlpha
      bodyColors[i * 3 + 1] = g * bodyAlpha
      bodyColors[i * 3 + 2] = b * bodyAlpha

      // Tail: subtle fading wake
      const tailAlpha = alpha * 0.22
      tailColors[i * 3] = r * tailAlpha
      tailColors[i * 3 + 1] = g * tailAlpha
      tailColors[i * 3 + 2] = b * tailAlpha
    }

    if (geomHeadRef.current) {
      geomHeadRef.current.attributes.position.needsUpdate = true
      geomHeadRef.current.attributes.color.needsUpdate = true
    }
    if (geomBodyRef.current) {
      geomBodyRef.current.attributes.position.needsUpdate = true
      geomBodyRef.current.attributes.color.needsUpdate = true
    }
    if (geomTailRef.current) {
      geomTailRef.current.attributes.position.needsUpdate = true
      geomTailRef.current.attributes.color.needsUpdate = true
    }
  })

  const glowTexture = useMemo(() => createGlowTexture(), [])

  if (!active) return null

  return (
    <group>
      {/* Layer 2: Smooth Continuous Curved Streamlines */}
      {showStreamlines && (
        <lineSegments
          geometry={streamlineGeom}
          material={material}
        />
      )}

      {/* Layer 3: Motion — Luminous Advected Particles with Curved Glowing Comet Wakes */}
      {showParticles && (
        <>
          {/* Leading Heads: brilliant luminous core */}
          <points>
            <bufferGeometry ref={geomHeadRef}>
              <bufferAttribute attach="attributes-position" args={[headPos, 3]} />
              <bufferAttribute attach="attributes-color" args={[headColors, 3]} />
            </bufferGeometry>
            <pointsMaterial
              map={glowTexture}
              vertexColors
              size={0.038}
              sizeAttenuation
              transparent
              opacity={0.95}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </points>

          {/* Mid Wake: soft trailing glow curving seamlessly along the streamline */}
          <points>
            <bufferGeometry ref={geomBodyRef}>
              <bufferAttribute attach="attributes-position" args={[bodyPos, 3]} />
              <bufferAttribute attach="attributes-color" args={[bodyColors, 3]} />
            </bufferGeometry>
            <pointsMaterial
              map={glowTexture}
              vertexColors
              size={0.026}
              sizeAttenuation
              transparent
              opacity={0.70}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </points>

          {/* Tail Wake: delicate ghost mote completing the fluid comet teardrop */}
          <points>
            <bufferGeometry ref={geomTailRef}>
              <bufferAttribute attach="attributes-position" args={[tailPos, 3]} />
              <bufferAttribute attach="attributes-color" args={[tailColors, 3]} />
            </bufferGeometry>
            <pointsMaterial
              map={glowTexture}
              vertexColors
              size={0.016}
              sizeAttenuation
              transparent
              opacity={0.45}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </points>
        </>
      )}
    </group>
  )
}
