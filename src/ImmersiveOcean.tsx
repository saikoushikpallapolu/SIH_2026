import { PointerLockControls, Stars } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mockValue, variableMeta } from './mockOceanData'
import type { OceanVariable, Selection } from './types'

interface DiveTelemetry { depth: number; temperature: number }
interface Props { variable: OceanVariable; selection: Selection; timeIndex: number; onTelemetry: (telemetry: DiveTelemetry) => void }

const worldLimit = 120

function terrainHeight(x: number, z: number) {
  return Math.sin(x * .052) * 5 + Math.cos(z * .045) * 4 + Math.sin((x + z) * .1) * 2.4 + Math.cos(Math.sqrt(x * x + z * z) * .12) * 3
}

function Terrain({ variable }: { variable: OceanVariable }) {
  const geometry = useMemo(() => {
    const size = 260
    const segments = 132
    const count = (segments + 1) ** 2
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const indices: number[] = []
    const color = new THREE.Color()
    for (let z = 0; z <= segments; z += 1) {
      for (let x = 0; x <= segments; x += 1) {
        const index = z * (segments + 1) + x
        const px = (x / segments - .5) * size
        const pz = (z / segments - .5) * size
        const y = terrainHeight(px, pz) - 23
        positions.set([px, y, pz], index * 3)
        const normalized = THREE.MathUtils.clamp((y + 34) / 18, 0, 1)
        if (variable === 'temperature') color.setHSL(.61 - normalized * .56, .78, .12 + normalized * .27)
        else if (variable === 'salinity') color.setHSL(.64 - normalized * .07, .42, .13 + normalized * .14)
        else if (variable === 'chlorophyll') color.setHSL(.36 - normalized * .08, .56, .10 + normalized * .12)
        else color.setHSL(.55, .45, .12 + normalized * .15)
        colors.set([color.r, color.g, color.b], index * 3)
      }
    }
    for (let z = 0; z < segments; z += 1) for (let x = 0; x < segments; x += 1) {
      const a = z * (segments + 1) + x
      indices.push(a, a + segments + 1, a + 1, a + 1, a + segments + 1, a + segments + 2)
    }
    const result = new THREE.BufferGeometry()
    result.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    result.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    result.setIndex(indices)
    result.computeVertexNormals()
    return result
  }, [variable])
  return <mesh geometry={geometry} receiveShadow castShadow><meshStandardMaterial vertexColors roughness={.96} metalness={0} flatShading /></mesh>
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

function SeafloorMarkers() {
  return <group>{[[12, -16, -20], [-38, -20, 18], [48, -15, 44]].map((position, index) => <group key={index} position={position as [number, number, number]}><mesh><coneGeometry args={[.9, 5.5, 6]} /><meshStandardMaterial color="#1e6270" roughness={.85} /></mesh><pointLight color="#6beaff" intensity={1.1} distance={9} /></group>)}</group>
}

function Diver({ selection, timeIndex, onTelemetry }: { selection: Selection; timeIndex: number; onTelemetry: (telemetry: DiveTelemetry) => void }) {
  const { camera } = useThree()
  const keys = useRef<Record<string, boolean>>({})
  const lastTelemetry = useRef(0)
  useEffect(() => {
    const update = (event: KeyboardEvent, state: boolean) => { keys.current[event.key.toLowerCase()] = state }
    const down = (event: KeyboardEvent) => update(event, true)
    const up = (event: KeyboardEvent) => update(event, false)
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])
  useFrame((state, delta) => {
    const speed = keys.current.shift ? 16 : 8
    const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.y = 0; forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize()
    if (keys.current.w) camera.position.addScaledVector(forward, speed * delta)
    if (keys.current.s) camera.position.addScaledVector(forward, -speed * delta)
    if (keys.current.a) camera.position.addScaledVector(right, -speed * delta)
    if (keys.current.d) camera.position.addScaledVector(right, speed * delta)
    if (keys.current.arrowup) camera.position.y += speed * delta
    if (keys.current.arrowdown) camera.position.y -= speed * delta
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -worldLimit, worldLimit)
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -worldLimit, worldLimit)
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, -17, 7.5)
    if (state.clock.elapsedTime - lastTelemetry.current > .18) {
      lastTelemetry.current = state.clock.elapsedTime
      const depth = Math.round(Math.max(0, 8 - camera.position.y) * 92)
      onTelemetry({ depth, temperature: mockValue('temperature', selection.latitude, selection.longitude, depth, timeIndex) })
    }
  })
  return null
}

function DiveWorld({ variable, selection, timeIndex, onTelemetry }: Props) {
  return <>
    <color attach="background" args={['#021525']} />
    <fog attach="fog" args={['#05324c', 18, 145]} />
    <ambientLight intensity={1.5} color="#2f98b8" />
    <directionalLight position={[0, 17, 20]} intensity={4.5} color="#b9fbff" castShadow />
    <pointLight position={[0, -4, 2]} intensity={2.2} color="#19799c" distance={65} />
    <OceanSurface /><Terrain variable={variable} /><WaterParticles /><SeafloorMarkers />
    <Stars radius={180} depth={80} count={1000} factor={1} saturation={0} fade speed={.2} />
    <Diver selection={selection} timeIndex={timeIndex} onTelemetry={onTelemetry} />
    <PointerLockControls />
  </>
}

export default function ImmersiveOcean(props: Props) {
  return <Canvas shadows camera={{ position: [0, 3, 55], fov: 64, near: .1, far: 400 }} dpr={[1, 2]} gl={{ antialias: true }}>
    <DiveWorld {...props} />
  </Canvas>
}
