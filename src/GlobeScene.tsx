import { Line, OrbitControls, Stars } from '@react-three/drei'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Suspense, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Instrument, OceanVariable, Selection, ViewMode } from './types'

const RADIUS = 1.55
const EARTH_DAY_MAP = 'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg'
const EARTH_WATER_MASK = 'https://threejs.org/examples/textures/planets/earth_specular_2048.jpg'

function latLngToVector3(latitude: number, longitude: number, radius = RADIUS) {
  const lat = THREE.MathUtils.degToRad(latitude)
  const lng = THREE.MathUtils.degToRad(longitude)
  return new THREE.Vector3(radius * Math.cos(lat) * Math.cos(lng), radius * Math.sin(lat), radius * Math.cos(lat) * Math.sin(lng))
}

function OceanShader({ variable, depth, timeIndex, overlayStrength }: { variable: OceanVariable; depth: number; timeIndex: number; overlayStrength: number }) {
  const [earthMap, waterMask] = useLoader(THREE.TextureLoader, [EARTH_DAY_MAP, EARTH_WATER_MASK])
  earthMap.colorSpace = THREE.SRGBColorSpace
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: { value: 0 }, uDepth: { value: depth }, uVariable: { value: ['temperature', 'salinity', 'chlorophyll', 'currents'].indexOf(variable) }, uOverlayStrength: { value: overlayStrength }, uEarthMap: { value: earthMap }, uWaterMask: { value: waterMask } },
    vertexShader: `varying vec2 vUv; varying vec3 vNormal; varying vec3 vPosition; void main(){ vUv = uv; vNormal = normalize(normalMatrix * normal); vPosition = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; uniform float uDepth; uniform float uVariable; uniform float uOverlayStrength; uniform sampler2D uEarthMap; uniform sampler2D uWaterMask; varying vec2 vUv; varying vec3 vNormal; varying vec3 vPosition;
      float wave(vec3 p){ return sin(p.x*3.0 + uTime)*0.3 + sin(p.y*5.0 - uTime*0.6)*0.3 + sin(p.z*4.0 + uTime*.8)*.4; }
      vec3 palette(float v){
        if(uVariable < .5) return mix(vec3(.025,.09,.46), vec3(1.0,.66,.16), v);
        if(uVariable < 1.5) return mix(vec3(.08,.03,.33), vec3(.22,.95,.79), v);
        if(uVariable < 2.5) return mix(vec3(.005,.06,.14), vec3(.54,1.0,.25), v);
        return mix(vec3(.01,.27,.52), vec3(.64,.96,1.0), v);
      }
      void main(){
        vec3 earth = texture2D(uEarthMap, vUv).rgb;
        float water = smoothstep(.18, .52, texture2D(uWaterMask, vUv).r);
        float latitudeFromEquator = abs(vUv.y - .5) * 2.0;
        float tropicality = pow(max(0.0, cos(latitudeFromEquator * 1.5708)), 1.35);
        float eddy = wave(normalize(vPosition)*4.0) * .5 + .5;
        float thermocline = 1.0 - exp(-uDepth / (190.0 + tropicality * 145.0));
        float value;
        if (uVariable < .5) value = clamp(.08 + tropicality * .92 - thermocline * .78 + (eddy - .5) * .08, 0.0, 1.0);
        else if (uVariable < 1.5) { float gyre = sin(latitudeFromEquator * 3.1416); value = clamp(.25 + gyre * .56 + thermocline * .1 + (eddy-.5)*.12, 0.0, 1.0); }
        else if (uVariable < 2.5) value = clamp(.16 + (1.0-tropicality)*.48 + (1.0-thermocline)*.32 + (eddy-.5)*.18, 0.0, 1.0);
        else value = clamp(.15 + exp(-pow(latitudeFromEquator/.22, 2.0))*.58 + (eddy-.5)*.28 + (1.0-thermocline)*.1, 0.0, 1.0);
        vec3 field = palette(value);
        float light = max(dot(vNormal, normalize(vec3(1.0, .8, 1.2))), .0);
        vec3 ocean = mix(earth, field * (.48 + light*.72), uOverlayStrength);
        gl_FragColor = vec4(mix(earth * (.48 + light*.56), ocean, water), 1.0);
      }`
  }), [variable, earthMap, waterMask, overlayStrength])
  material.uniforms.uTime.value = timeIndex * .75
  material.uniforms.uDepth.value = depth
  return <mesh material={material}><sphereGeometry args={[RADIUS, 128, 128]} /></mesh>
}

function Atmosphere() {
  return <mesh scale={1.035}>
    <sphereGeometry args={[RADIUS, 96, 96]} />
    <meshBasicMaterial color="#58ddff" transparent opacity={0.12} side={THREE.BackSide} blending={THREE.AdditiveBlending} />
  </mesh>
}

function CurrentParticles({ active }: { active: boolean }) {
  const points = useRef<THREE.Points>(null)
  const positions = useMemo(() => {
    const result = new Float32Array(900 * 3)
    for (let i = 0; i < 900; i += 1) {
      const lat = -28 + ((i * 31) % 64)
      const lng = 42 + ((i * 53) % 77)
      const v = latLngToVector3(lat, lng, RADIUS + .018)
      result.set([v.x, v.y, v.z], i * 3)
    }
    return result
  }, [])
  useFrame(({ clock }) => { if (points.current && active) points.current.rotation.y = Math.sin(clock.getElapsedTime() * .15) * .08 })
  if (!active) return null
  return <points ref={points}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
    <pointsMaterial color="#d6fbff" size={0.013} sizeAttenuation transparent opacity={0.82} blending={THREE.AdditiveBlending} />
  </points>
}

function Marker({ instrument, onSelect }: { instrument: Instrument; onSelect: (instrument: Instrument) => void }) {
  const point = latLngToVector3(instrument.latitude, instrument.longitude, RADIUS + .055)
  const color = instrument.kind === 'Glider' ? '#ffcf66' : instrument.kind === 'BGC-Argo' ? '#9b83ff' : '#72e8ff'
  return <group position={point} onClick={(event) => { event.stopPropagation(); onSelect(instrument) }}>
    <mesh><sphereGeometry args={[.035, 16, 16]} /><meshBasicMaterial color={color} /></mesh>
    <mesh scale={1.9}><sphereGeometry args={[.035, 16, 16]} /><meshBasicMaterial color={color} transparent opacity={.18} /></mesh>
  </group>
}

function CameraDirector({ mode, depth }: { mode: ViewMode; depth: number }) {
  const { camera } = useThree()
  useFrame(() => {
    if (mode !== 'dive') return
    const target = new THREE.Vector3(2.02 - Math.min(depth, 1800) / 3100, .45, 2.42 - Math.min(depth, 1800) / 4000)
    camera.position.lerp(target, .027)
    camera.lookAt(new THREE.Vector3(.15, .08, .2))
  })
  return null
}

function Scene({ variable, depth, timeIndex, mode, overlayStrength, instruments, onInstrument, onSelectPoint }: {
  variable: OceanVariable; depth: number; timeIndex: number; mode: ViewMode; overlayStrength: number; instruments: Instrument[]; onInstrument: (instrument: Instrument) => void; onSelectPoint: (selection: Selection) => void
}) {
  const handleGlobeClick = (event: THREE.Event & { point: THREE.Vector3 }) => {
    const p = event.point.normalize()
    onSelectPoint({ latitude: THREE.MathUtils.radToDeg(Math.asin(p.y)), longitude: THREE.MathUtils.radToDeg(Math.atan2(p.z, p.x)) })
  }
  return <>
    <color attach="background" args={['#020712']} />
    <fog attach="fog" args={['#020712', 8, 17]} />
    <ambientLight intensity={.8} />
    <directionalLight position={[5, 4, 5]} intensity={2.3} color="#a5d8ff" />
    <pointLight position={[-5, -1, -3]} intensity={1.2} color="#1f70ff" />
    <Stars radius={90} depth={45} count={3200} factor={3} saturation={0} fade speed={.25} />
    <group rotation={[THREE.MathUtils.degToRad(-6), THREE.MathUtils.degToRad(-62), THREE.MathUtils.degToRad(11)]}>
      <OceanShader variable={variable} depth={depth} timeIndex={timeIndex} overlayStrength={overlayStrength} />
      <mesh onClick={handleGlobeClick}><sphereGeometry args={[RADIUS + .006, 96, 96]} /><meshBasicMaterial transparent opacity={0} /></mesh>
      {[-30, 0, 30].map((latitude) => <Line key={latitude} points={Array.from({ length: 73 }, (_, i) => latLngToVector3(latitude, -180 + i * 5, RADIUS + .012))} color="#c1eaff" lineWidth={.28} transparent opacity={.13} />)}
      <CurrentParticles active={variable === 'currents' || mode === 'dive'} />
      {instruments.map((instrument) => <Marker key={instrument.id} instrument={instrument} onSelect={onInstrument} />)}
    </group>
    <Atmosphere />
    <CameraDirector mode={mode} depth={depth} />
    <OrbitControls enablePan={false} minDistance={2.2} maxDistance={8} enableDamping dampingFactor={.06} autoRotate={mode === 'explore'} autoRotateSpeed={.24} />
  </>
}

export default function GlobeScene(props: React.ComponentProps<typeof Scene>) {
  return <Canvas camera={{ position: [4.1, 2.3, 4.8], fov: 39 }} dpr={[1, 2]} gl={{ antialias: true }}>
    <Suspense fallback={null}><Scene {...props} /></Suspense>
  </Canvas>
}
