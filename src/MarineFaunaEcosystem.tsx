import { useFrame, useLoader } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Suspense, useMemo, useRef, useState, useEffect } from 'react'
import * as THREE from 'three'

// ============================================================================
// OFFICIAL-EwE/OCEANVIZ PRODUCTION 3D FAUNA & SEABED ECOSYSTEM ENGINE
// Utilizes authentic PBR-textured GLB models from the European Union Horizon /
// NECCTON Copernicus Marine "OceanViz" repository (Ecopath International).
// Features: Whale Shark, Great White Shark, Shortfin Mako, Giant Oceanic Manta,
// Loggerhead Turtle, Bottlenose Dolphins, Gorgonian Reefs, Kelp, Soft God Rays,
// Marine Snow Particulates, and Submarine Acoustic Sonar Scan.
// ============================================================================

// --- Audio Synthesizer for Multibeam Sonar Ping ---
export function playSonarPingAudio() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    // Crisp submarine multibeam ping chirp: 1180 Hz dipping to 860 Hz
    osc.frequency.setValueAtTime(1180, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(860, ctx.currentTime + 0.38)

    gain.gain.setValueAtTime(0.09, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.4)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 1.45)
  } catch {
    // AudioContext blocked or not supported
  }
}

// 1. MANTA RAY (Mobula birostris) with PBR Textures & Undulating Flight
export function MantaRay({
  basePos = new THREE.Vector3(-14, -13, 14),
  radius = 24,
  speed = 0.28,
  phase = 0.0,
  scale = 1.8,
}: {
  basePos?: THREE.Vector3
  radius?: number
  speed?: number
  phase?: number
  scale?: number
}) {
  const meshRef = useRef<THREE.Group>(null)
  const gltf = useGLTF('/models/oceanviz/manta_ray.glb')

  const [colorMap, normalMap, roughnessMap] = useLoader(THREE.TextureLoader, [
    '/models/oceanviz/manta_base_color.png',
    '/models/oceanviz/manta_normal.png',
    '/models/oceanviz/manta_roughness.png',
  ])

  const clonedScene = useMemo(() => {
    const clone = gltf.scene.clone(true)
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh
        m.material = new THREE.MeshStandardMaterial({
          map: colorMap,
          normalMap: normalMap,
          roughnessMap: roughnessMap,
          roughness: 0.35,
          metalness: 0.2,
          side: THREE.DoubleSide,
        })
        m.castShadow = true
      }
    })
    return clone
  }, [gltf.scene, colorMap, normalMap, roughnessMap])

  useFrame(({ clock }) => {
    if (!meshRef.current) return
    const t = clock.getElapsedTime()
    const angle = t * speed + phase
    let x = basePos.x + Math.cos(angle) * radius
    let z = basePos.z + Math.sin(angle) * (radius * 0.88)
    let y = Math.min(-3.2, basePos.y + Math.sin(t * 0.45 + phase) * 1.8)

    let forwardX = -Math.sin(angle) * radius
    let forwardZ = Math.cos(angle) * (radius * 0.88)

    // Strict coastline land deflection: prevent marine megafauna from swimming into continental land
    if (x > -3.0) {
      x = -3.0 - (x - -3.0) * 0.6
      forwardX = -Math.abs(forwardX)
    }

    const heading = Math.atan2(forwardX, forwardZ)

    // Graceful roll banking into turns + gentle pitch heave
    const bankRoll = -Math.sin(angle) * 0.22
    const pitch = Math.cos(t * 0.45 + phase) * 0.08
    const flapSway = Math.sin(t * 1.8 + phase) * 0.05

    meshRef.current.position.set(x, y, z)
    meshRef.current.rotation.set(pitch, heading, bankRoll + flapSway, 'YXZ')
  })

  return (
    <group ref={meshRef} scale={scale}>
      <primitive object={clonedScene} />
    </group>
  )
}

// 2. APEX SHORTFIN MAKO / BLUE SHARK (Isurus oxyrinchus) with PBR Textures
export function ApexShark({
  center = new THREE.Vector3(12, -9, 8),
  rx = 22,
  rz = 17,
  speed = 0.42,
  phase = 0.0,
  scale = 2.4,
}: {
  center?: THREE.Vector3
  rx?: number
  rz?: number
  speed?: number
  phase?: number
  scale?: number
}) {
  const meshRef = useRef<THREE.Group>(null)
  const gltf = useGLTF('/models/oceanviz/shark.glb')

  const [colorMap, normalMap] = useLoader(THREE.TextureLoader, [
    '/models/oceanviz/shark_base_color.png',
    '/models/oceanviz/shark_normal.png',
  ])

  const clonedScene = useMemo(() => {
    const clone = gltf.scene.clone(true)
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh
        m.material = new THREE.MeshStandardMaterial({
          map: colorMap,
          normalMap: normalMap,
          roughness: 0.26,
          metalness: 0.55,
          side: THREE.DoubleSide,
        })
      }
    })
    return clone
  }, [gltf.scene, colorMap, normalMap])

  useFrame(({ clock }) => {
    if (!meshRef.current) return
    const t = clock.getElapsedTime()
    const angle = t * speed + phase
    let x = center.x + Math.cos(angle) * rx
    let z = center.z + Math.sin(angle) * rz
    let y = Math.min(-3.2, center.y + Math.sin(t * 0.5 + phase) * 1.5)

    let forwardX = -Math.sin(angle) * rx
    let forwardZ = Math.cos(angle) * rz

    // Strict coastline land deflection: prevent shark from swimming onto land
    if (x > -3.0) {
      x = -3.0 - (x - -3.0) * 0.6
      forwardX = -Math.abs(forwardX)
    }

    const heading = Math.atan2(forwardX, forwardZ)

    // Fluid caudal tail waggle & banking roll
    const tailWag = Math.sin(t * 3.8 + phase) * 0.12
    const roll = -Math.sin(angle) * 0.15

    meshRef.current.position.set(x, y, z)
    meshRef.current.rotation.set(0, heading + tailWag, roll, 'YXZ')
  })

  return (
    <group ref={meshRef} scale={scale}>
      <primitive object={clonedScene} />
    </group>
  )
}

// 3. GREAT WHITE SHARK (Carcharodon carcharias) - 6.5m Apex Cruiser
export function GreatWhiteShark({
  center = new THREE.Vector3(-18, -5.8, 6),
  rx = 16,
  rz = 14,
  speed = 0.30,
  phase = 1.4,
  scale = 2.5,
}: {
  center?: THREE.Vector3
  rx?: number
  rz?: number
  speed?: number
  phase?: number
  scale?: number
}) {
  const meshRef = useRef<THREE.Group>(null)
  const gltf = useGLTF('/models/oceanviz/great_white.glb')

  const [colorMap, normalMap] = useLoader(THREE.TextureLoader, [
    '/models/oceanviz/great_white_base_color.png',
    '/models/oceanviz/great_white_normal.png',
  ])

  const clonedScene = useMemo(() => {
    const clone = gltf.scene.clone(true)
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh
        m.material = new THREE.MeshStandardMaterial({
          map: colorMap,
          normalMap: normalMap,
          roughness: 0.32,
          metalness: 0.45,
          side: THREE.DoubleSide,
        })
      }
    })
    return clone
  }, [gltf.scene, colorMap, normalMap])

  useFrame(({ clock }) => {
    if (!meshRef.current) return
    const t = clock.getElapsedTime()
    const angle = t * speed + phase
    let x = center.x + Math.cos(angle) * rx
    let z = center.z + Math.sin(angle) * rz
    let y = Math.min(-3.8, center.y + Math.sin(t * 0.38 + phase) * 1.8)

    let forwardX = -Math.sin(angle) * rx
    let forwardZ = Math.cos(angle) * rz

    // Strict coastline land deflection: prevent shark from swimming onto land
    if (x > -3.0) {
      x = -3.0 - (x - -3.0) * 0.6
      forwardX = -Math.abs(forwardX)
    }

    const heading = Math.atan2(forwardX, forwardZ)

    const tailWag = Math.sin(t * 2.6 + phase) * 0.09
    const roll = -Math.sin(angle) * 0.12

    meshRef.current.position.set(x, y, z)
    meshRef.current.rotation.set(0, heading + tailWag, roll, 'YXZ')
  })

  return (
    <group ref={meshRef} scale={scale}>
      <primitive object={clonedScene} />
    </group>
  )
}

// 4. WHALE SHARK (Rhincodon typus) - 16m Spotted Indian Ocean Gentle Giant
export function WhaleShark({
  center = new THREE.Vector3(-24, -6.8, -6),
  rx = 20,
  rz = 17,
  speed = 0.16,
  scale = 3.3,
}: {
  center?: THREE.Vector3
  rx?: number
  rz?: number
  speed?: number
  scale?: number
}) {
  const meshRef = useRef<THREE.Group>(null)
  const gltf = useGLTF('/models/oceanviz/whale_shark.glb')

  const [colorMap, normalMap] = useLoader(THREE.TextureLoader, [
    '/models/oceanviz/whale_shark_base_color.png',
    '/models/oceanviz/whale_shark_normal.png',
  ])

  const clonedScene = useMemo(() => {
    const clone = gltf.scene.clone(true)
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh
        m.material = new THREE.MeshStandardMaterial({
          map: colorMap,
          normalMap: normalMap,
          roughness: 0.38,
          metalness: 0.25,
          side: THREE.DoubleSide,
        })
      }
    })
    return clone
  }, [gltf.scene, colorMap, normalMap])

  useFrame(({ clock }) => {
    if (!meshRef.current) return
    const t = clock.getElapsedTime()
    const angle = t * speed
    let x = center.x + Math.cos(angle) * rx
    let z = center.z + Math.sin(angle) * rz
    let y = Math.min(-4.5, center.y + Math.sin(t * 0.22) * 1.8)

    let forwardX = -Math.sin(angle) * rx
    let forwardZ = Math.cos(angle) * rz

    // Strict coastline land deflection: prevent whale shark from swimming onto land
    if (x > -3.0) {
      x = -3.0 - (x - -3.0) * 0.6
      forwardX = -Math.abs(forwardX)
    }

    const heading = Math.atan2(forwardX, forwardZ)
    const tailWag = Math.sin(t * 1.6) * 0.07

    meshRef.current.position.set(x, y, z)
    meshRef.current.rotation.set(0, heading + tailWag, 0, 'YXZ')
  })

  return (
    <group ref={meshRef} scale={scale}>
      <primitive object={clonedScene} />
    </group>
  )
}

// 5. LOGGERHEAD SEA TURTLE (Caretta caretta) with PBR Textures
export function SeaTurtle({
  start = new THREE.Vector3(-16, -4.5, 8),
  radius = 13,
  speed = 0.20,
  phase = 0.8,
  scale = 2.8,
}: {
  start?: THREE.Vector3
  radius?: number
  speed?: number
  phase?: number
  scale?: number
}) {
  const meshRef = useRef<THREE.Group>(null)
  const gltf = useGLTF('/models/oceanviz/sea_turtle.glb')

  const [colorMap, normalMap, roughnessMap] = useLoader(THREE.TextureLoader, [
    '/models/oceanviz/turtle_base_color.png',
    '/models/oceanviz/turtle_normal.png',
    '/models/oceanviz/turtle_roughness.png',
  ])

  const clonedScene = useMemo(() => {
    const clone = gltf.scene.clone(true)
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh
        m.material = new THREE.MeshStandardMaterial({
          map: colorMap,
          normalMap: normalMap,
          roughnessMap: roughnessMap,
          roughness: 0.55,
          metalness: 0.15,
          side: THREE.DoubleSide,
        })
      }
    })
    return clone
  }, [gltf.scene, colorMap, normalMap, roughnessMap])

  useFrame(({ clock }) => {
    if (!meshRef.current) return
    const t = clock.getElapsedTime()
    const angle = t * speed + phase
    let x = start.x + Math.cos(angle) * radius
    let z = start.z + Math.sin(angle) * radius
    let y = Math.min(-2.5, start.y + Math.sin(t * 0.35 + phase) * 1.5)

    let forwardX = -Math.sin(angle) * radius
    let forwardZ = Math.cos(angle) * radius

    // Strict coastline land deflection: prevent turtle from swimming into continental land
    if (x > -3.0) {
      x = -3.0 - (x - -3.0) * 0.6
      forwardX = -Math.abs(forwardX)
    }

    const heading = Math.atan2(forwardX, forwardZ)
    const pitch = Math.cos(t * 0.35 + phase) * 0.12

    meshRef.current.position.set(x, y, z)
    meshRef.current.rotation.set(pitch, heading, Math.sin(t * 1.2 + phase) * 0.08, 'YXZ')
  })

  return (
    <group ref={meshRef} scale={scale}>
      <primitive object={clonedScene} />
    </group>
  )
}

// 6. BOTTLENOSE DOLPHINS (Tursiops truncatus) Tandem Pod
export function BottlenoseDolphins({ count = 2 }: { count?: number }) {
  const groupRef = useRef<THREE.Group>(null)
  const gltf = useGLTF('/models/oceanviz/dolphin.glb')

  const [colorMap, normalMap] = useLoader(THREE.TextureLoader, [
    '/models/oceanviz/dolphin_base_color.png',
    '/models/oceanviz/dolphin_normal.png',
  ])

  const dolphinModel = useMemo(() => {
    const clone = gltf.scene.clone(true)
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh
        m.material = new THREE.MeshStandardMaterial({
          map: colorMap,
          normalMap: normalMap,
          roughness: 0.22,
          metalness: 0.6,
          side: THREE.DoubleSide,
        })
      }
    })
    return clone
  }, [gltf.scene, colorMap, normalMap])

  useFrame(({ clock }) => {
    if (!groupRef.current) return
    const t = clock.getElapsedTime()

    groupRef.current.children.forEach((child, i) => {
      const speed = 0.36
      const phase = i * 0.85
      const angle = t * speed + phase
      const radius = 26 + i * 3.0

      let x = -15 + Math.cos(angle) * radius
      let z = 18 + Math.sin(angle) * (radius * 0.85)
      // Classic dolphin undulating porpoising wave motion
      let y = Math.min(-1.2, -2.8 + Math.sin(t * 2.8 + phase) * 1.4)

      let forwardX = -Math.sin(angle) * radius
      let forwardZ = Math.cos(angle) * (radius * 0.85)

      // Strict coastline land deflection: prevent dolphins from swimming onto land
      if (x > -3.0) {
        x = -3.0 - (x - -3.0) * 0.6
        forwardX = -Math.abs(forwardX)
      }

      const heading = Math.atan2(forwardX, forwardZ)
      const pitch = -Math.cos(t * 2.8 + phase) * 0.22
      const roll = -Math.sin(angle) * 0.2

      child.position.set(x, y, z)
      child.rotation.set(pitch, heading, roll, 'YXZ')
    })
  })

  return (
    <group ref={groupRef}>
      {Array.from({ length: count }).map((_, i) => (
        <group key={i} scale={2.0}>
          <primitive object={dolphinModel.clone()} />
        </group>
      ))}
    </group>
  )
}

// 7. BENTHIC REEF HABITAT: Gorgonian Corals, Red Corals & Current-Swaying Kelp
export function BenthicReefGarden({
  currents = { u: 0.3, v: 0.2, speed: 0.4 },
}: {
  currents?: { u: number; v: number; speed: number }
}) {
  const gorgonianGLTF = useGLTF('/models/oceanviz/gorgonian_coral.glb')
  const redCoralGLTF = useGLTF('/models/oceanviz/red_coral.glb')
  const kelpGLTF = useGLTF('/models/oceanviz/kelp.glb')

  const [gorgonianColor, gorgonianNormal] = useLoader(THREE.TextureLoader, [
    '/models/oceanviz/coral_base_color.png',
    '/models/oceanviz/coral_normal.png',
  ])
  const [redColor, redNormal] = useLoader(THREE.TextureLoader, [
    '/models/oceanviz/red_coral_base_color.png',
    '/models/oceanviz/red_coral_normal.png',
  ])
  const [kelpColor, kelpNormal] = useLoader(THREE.TextureLoader, [
    '/models/oceanviz/kelp_base_color.png',
    '/models/oceanviz/kelp_normal.png',
  ])

  // PBR Gorgonian Sea Fan model
  const gorgonianModel = useMemo(() => {
    const c = gorgonianGLTF.scene.clone(true)
    c.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh
        m.material = new THREE.MeshStandardMaterial({
          map: gorgonianColor,
          normalMap: gorgonianNormal,
          roughness: 0.58,
          metalness: 0.08,
          transparent: true,
          alphaTest: 0.35,
          side: THREE.DoubleSide,
        })
      }
    })
    return c
  }, [gorgonianGLTF.scene, gorgonianColor, gorgonianNormal])

  // PBR Red Branching Coral model
  const redCoralModel = useMemo(() => {
    const c = redCoralGLTF.scene.clone(true)
    c.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh
        m.material = new THREE.MeshStandardMaterial({
          map: redColor,
          normalMap: redNormal,
          roughness: 0.5,
          metalness: 0.05,
          transparent: true,
          alphaTest: 0.35,
          side: THREE.DoubleSide,
        })
      }
    })
    return c
  }, [redCoralGLTF.scene, redColor, redNormal])

  // PBR Swaying Kelp Fronds model (properly scaled to stay submerged!)
  const kelpModel = useMemo(() => {
    const k = kelpGLTF.scene.clone(true)
    k.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh
        m.material = new THREE.MeshStandardMaterial({
          map: kelpColor,
          normalMap: kelpNormal,
          roughness: 0.55,
          metalness: 0.08,
          side: THREE.DoubleSide,
        })
      }
    })
    return k
  }, [kelpGLTF.scene, kelpColor, kelpNormal])

  const groupRef = useRef<THREE.Group>(null)

  // 24 Benthic organisms distributed naturally across the continental shelf bathymetry
  const reefLocations = useMemo(() => {
    const list = []
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2 + (i % 3) * 0.2
      const dist = 10 + (i % 5) * 4.5
      // Center the benthic reef cluster comfortably offshore in the continental shelf waters
      let x = -20 + Math.cos(angle) * dist
      let z = 6 + Math.sin(angle) * dist
      // Ensure all corals remain strictly in ocean waters west of the shoreline (x <= -4.0)
      if (x > -4.0) {
        x = -4.0 - Math.abs(x - -4.0)
      }
      // Anchor onto continental shelf bedrock at y = -8.6 to -8.85
      const y = -8.7 + Math.sin(x * 0.14) * 0.25

      const type = i % 3 === 0 ? 'kelp' : i % 3 === 1 ? 'gorgonian' : 'red_coral'
      // Scaled so tops remain well submerged below diver eye level
      const scale =
        type === 'kelp'
          ? 0.14 + (i % 3) * 0.03
          : type === 'gorgonian'
          ? 1.4 + (i % 3) * 0.3
          : 2.8 + (i % 3) * 0.5

      list.push({
        pos: [x, y, z] as [number, number, number],
        type,
        scale,
        phase: i * 0.65,
        rotY: (i * 1.37) % (Math.PI * 2),
      })
    }
    return list
  }, [])

  useFrame(({ clock }) => {
    if (!groupRef.current) return
    const t = clock.getElapsedTime()
    const heading = Math.atan2(currents.u, currents.v)
    const swayAmp = 0.14 + Math.min(0.25, currents.speed * 0.22)

    groupRef.current.children.forEach((child, i) => {
      const item = reefLocations[i]
      if (!item) return
      // Kelp and gorgonians flex and sway harmonically in the ocean current
      const sway = Math.sin(t * 1.6 + item.phase) * swayAmp
      child.rotation.z = Math.sin(heading) * sway
      child.rotation.x = Math.cos(heading) * sway
    })
  })

  return (
    <group ref={groupRef}>
      {reefLocations.map((item, i) => (
        <group key={i} position={item.pos} rotation={[0, item.rotY, 0]} scale={item.scale}>
          <primitive
            object={
              item.type === 'kelp'
                ? kelpModel.clone()
                : item.type === 'gorgonian'
                ? gorgonianModel.clone()
                : redCoralModel.clone()
            }
          />
        </group>
      ))}
    </group>
  )
}

// 8. VOLUMETRIC SUNLIGHT CAUSTIC GOD RAYS (Custom Smooth Shader)
// Zero hard polygons: uses smoothstep alpha falloff and animated caustic waves
export function SunlightGodRays({ depth = 0 }: { depth: number }) {
  const raysRef = useRef<THREE.Group>(null)

  // Attenuate with depth: god rays fade below 50m
  const rayOpacity = useMemo(() => {
    if (depth > 55) return 0.0
    return Math.max(0.0, 0.22 * Math.exp(-depth / 26.0))
  }, [depth])

  // Custom Shader with vertical falloff and caustic wave shimmer
  const rayMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color('#99f6e4') }, // Luminous sunlit cyan
        uOpacity: { value: rayOpacity },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          // Smooth vertical fade: 0 at top surface, peak brightness at 25%, fades at bottom
          float vertFade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
          // Smooth edge falloff across the shaft width
          float edgeDist = abs(vUv.x - 0.5) * 2.0;
          float edgeFade = smoothstep(1.0, 0.0, edgeDist);
          // Animated caustic shimmering modulation
          float shimmer = 0.85 + 0.15 * sin(vWorldPos.x * 0.35 + vWorldPos.z * 0.25 + uTime * 2.2);
          float alpha = uOpacity * vertFade * edgeFade * shimmer;
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    })
  }, [rayOpacity])

  useFrame(({ clock }) => {
    if (!raysRef.current || rayOpacity === 0) return
    rayMaterial.uniforms.uTime.value = clock.getElapsedTime()
    rayMaterial.uniforms.uOpacity.value = rayOpacity
  })

  if (rayOpacity <= 0.005) return null

  // 6 Soft Sunlight Shafts radiating down through the photic zone into open ocean waters
  const shafts = [
    { pos: [-18, -4.5, 8] as [number, number, number], rot: [0.18, 0, -0.22] as [number, number, number], rTop: 0.8, rBot: 5.5, h: 12 },
    { pos: [-26, -4.8, -4] as [number, number, number], rot: [0.12, 0, -0.16] as [number, number, number], rTop: 1.1, rBot: 6.8, h: 13 },
    { pos: [-12, -4.2, 10] as [number, number, number], rot: [0.22, 0, -0.28] as [number, number, number], rTop: 0.9, rBot: 6.2, h: 12 },
    { pos: [-22, -5.0, -12] as [number, number, number], rot: [0.14, 0, -0.19] as [number, number, number], rTop: 1.2, rBot: 7.5, h: 14 },
    { pos: [-15, -4.0, 16] as [number, number, number], rot: [0.2, 0, -0.24] as [number, number, number], rTop: 0.8, rBot: 5.2, h: 11 },
    { pos: [-28, -5.2, -16] as [number, number, number], rot: [0.15, 0, -0.18] as [number, number, number], rTop: 1.0, rBot: 6.4, h: 13 },
  ]

  return (
    <group ref={raysRef}>
      {shafts.map((s, i) => (
        <mesh key={i} position={s.pos} rotation={s.rot} material={rayMaterial}>
          <cylinderGeometry args={[s.rTop, s.rBot, s.h, 24, 8, true]} />
        </mesh>
      ))}
    </group>
  )
}

// 9. SUSPENDED MARINE SNOW PARTICULATES (Floating Ocean Motes)
export function MarineSnowParticulates({
  count = 600,
  currents = { u: 0.3, v: 0.2 },
}: {
  count?: number
  currents?: { u: number; v: number }
}) {
  const pointsRef = useRef<THREE.Points>(null)

  const [positions, phases] = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const ph = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 80
      pos[i * 3 + 1] = -Math.random() * 35
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80
      ph[i] = Math.random() * Math.PI * 2
    }
    return [pos, ph]
  }, [count])

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uCurrent: { value: new THREE.Vector2(currents.u, currents.v) },
      },
      vertexShader: `
        uniform float uTime;
        uniform vec2 uCurrent;
        attribute float aPhase;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          // Drifts gently with ocean current vector
          p.x += sin(uTime * 0.3 + aPhase) * 1.5 + uCurrent.x * uTime * 0.4;
          p.z += cos(uTime * 0.25 + aPhase) * 1.5 + uCurrent.y * uTime * 0.4;
          p.y += sin(uTime * 0.4 + aPhase) * 0.8;
          
          // Wrap within bounding box
          p.x = mod(p.x + 40.0, 80.0) - 40.0;
          p.z = mod(p.z + 40.0, 80.0) - 40.0;
          
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (1.8 + sin(uTime * 1.2 + aPhase) * 0.8) * (20.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
          vAlpha = 0.45 + 0.35 * sin(uTime * 1.5 + aPhase);
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float soft = smoothstep(0.5, 0.05, dist);
          gl_FragColor = vec4(0.7, 0.95, 1.0, soft * vAlpha * 0.6);
        }
      `,
    })
  }, [currents.u, currents.v])

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.getElapsedTime()
  })

  return (
    <points ref={pointsRef} material={material}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aPhase" args={[phases, 1]} />
      </bufferGeometry>
    </points>
  )
}

// 10. SCIENTIFIC MULTIBEAM ACOUSTIC SONAR SCAN PULSE
export function AcousticSonarPulse({
  active,
  origin,
}: {
  active: boolean
  origin?: THREE.Vector3
}) {
  const [pulseRadius, setPulseRadius] = useState(0)
  const [opacity, setOpacity] = useState(0)
  const startTimeRef = useRef<number | null>(null)
  const pulseGroupRef = useRef<THREE.Group>(null)

  useEffect(() => {
    if (active) {
      startTimeRef.current = performance.now()
      setPulseRadius(1)
      setOpacity(0.9)
      playSonarPingAudio()
    }
  }, [active])

  useFrame(() => {
    if (!startTimeRef.current) return
    const elapsed = (performance.now() - startTimeRef.current) / 1000
    const duration = 3.2
    if (elapsed > duration) {
      startTimeRef.current = null
      setPulseRadius(0)
      setOpacity(0)
      return
    }

    const progress = elapsed / duration
    // Sonar wave expands outward to 120 meters
    setPulseRadius(progress * 115)
    setOpacity(Math.max(0, (1 - progress) * 0.85))
  })

  if (opacity <= 0.01) return null

  const centerPos = origin ? [origin.x, origin.y, origin.z] : [0, -10, 0]

  return (
    <group ref={pulseGroupRef} position={centerPos as [number, number, number]}>
      {/* Primary Bathymetric Sounding Ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.max(0.1, pulseRadius - 1.8), pulseRadius, 64]} />
        <meshBasicMaterial
          color="#00f2fe"
          transparent
          opacity={opacity}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Secondary Outer Harmonic Wave Ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.max(0.1, pulseRadius * 0.72 - 1.0), pulseRadius * 0.72, 48]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={opacity * 0.55}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Downward Bathymetric Acoustic Scanning Inverted Cone */}
      <mesh position={[0, -pulseRadius * 0.35, 0]}>
        <coneGeometry args={[pulseRadius * 0.85, pulseRadius * 0.7, 32, 1, true]} />
        <meshBasicMaterial
          color="#06b6d4"
          transparent
          opacity={opacity * 0.18}
          wireframe
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

// Preload high-fidelity OceanViz production models
useGLTF.preload('/models/oceanviz/manta_ray.glb')
useGLTF.preload('/models/oceanviz/shark.glb')
useGLTF.preload('/models/oceanviz/great_white.glb')
useGLTF.preload('/models/oceanviz/whale_shark.glb')
useGLTF.preload('/models/oceanviz/dolphin.glb')
useGLTF.preload('/models/oceanviz/sea_turtle.glb')
useGLTF.preload('/models/oceanviz/gorgonian_coral.glb')
useGLTF.preload('/models/oceanviz/red_coral.glb')
useGLTF.preload('/models/oceanviz/kelp.glb')

// ============================================================================
// COMPOSITE OCEANVIZ PRODUCTION ECOSYSTEM
// ============================================================================
export function MarineFaunaEcosystem({
  depth = 0,
  currents = { u: 0.3, v: 0.2, speed: 0.4 },
  sonarActive = false,
  diverPos,
}: {
  depth: number
  currents?: { u: number; v: number; speed: number }
  sonarActive: boolean
  diverPos?: THREE.Vector3
}) {
  return (
    <Suspense fallback={null}>
      {/* 1. Volumetric Caustic Sunlight God Rays (Zero Polygons, Pure Shader Falloff) */}
      <SunlightGodRays depth={depth} />

      {/* 2. Suspended Marine Snow & Plankton Motes */}
      <MarineSnowParticulates count={420} currents={{ u: currents.u, v: currents.v }} />

      {/* 3. Photic Surface Zone (0m to -6m): Bottlenose Dolphins pod leaping near Snell's window */}
      <BottlenoseDolphins count={2} />

      {/* 4. Upper Photic (4m to 10m depth): Loggerhead Sea Turtle cruising peacefully */}
      <SeaTurtle start={new THREE.Vector3(-22, -4.8, -18)} radius={24} speed={0.16} phase={0.8} scale={2.6} />

      {/* 5. Pelagic Cruiser (18m to 32m depth): Giant Oceanic Manta Ray in wide banking flight */}
      <MantaRay basePos={new THREE.Vector3(-28, -24, 10)} radius={36} speed={0.22} phase={0.0} scale={1.9} />

      {/* 6. Pelagic Apex Patrol (16m to 28m depth): Shortfin Mako Shark in expansive patrol loop */}
      <ApexShark center={new THREE.Vector3(-18, -20, -28)} rx={28} rz={24} speed={0.34} phase={1.2} scale={2.2} />

      {/* 7. Mesopelagic Shelf Cruiser (45m to 65m depth): Great White Shark along continental drop-off */}
      <GreatWhiteShark center={new THREE.Vector3(-30, -52, 16)} rx={32} rz={26} speed={0.25} phase={2.8} scale={2.6} />

      {/* 8. Bathyal Twilight Leviathan (75m to 110m depth): 16m Whale Shark solitary deep giant */}
      <WhaleShark center={new THREE.Vector3(-36, -82, -12)} rx={42} rz={34} speed={0.14} scale={3.6} />

      {/* 9. Benthic Coral Reef Garden & Current-Swaying Submerged Kelp on Ocean Floor */}
      <BenthicReefGarden currents={currents} />

      {/* 10. Scientific Acoustic Multibeam Sonar Pulse & Synthesizer */}
      <AcousticSonarPulse active={sonarActive} origin={diverPos} />
    </Suspense>
  )
}
