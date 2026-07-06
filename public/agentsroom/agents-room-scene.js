// ─── agents-room-scene.js ───
// Scene setup: camera, renderers, controls, lights, starfield, nebula, ground floor.
import { S } from './agents-room-state.js';

const THREE = S.THREE;

// ─── SCENE ───
S.scene = new THREE.Scene();
S.scene.background = new THREE.Color(0x0e0e28);

S.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
S.camera.position.set(0, 300, 500);
S.camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
document.body.prepend(renderer.domElement);
S.renderer = renderer;

const labelRenderer = new S.CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
labelRenderer.domElement.style.zIndex = '100';
document.body.prepend(labelRenderer.domElement);
S.labelRenderer = labelRenderer;

const controls = new S.OrbitControls(S.camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.3;
controls.maxPolarAngle = Math.PI / 2.2;
controls.minDistance = 200;
controls.maxDistance = 900;
controls.target.set(0, 5, 0);
S.controls = controls;

// ─── LIGHTS ───
const ambient = new THREE.AmbientLight(0x1a1035, 0.6);
S.scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xbbb8ff, 2.5);
keyLight.position.set(100, 300, 200);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 600;
keyLight.shadow.camera.left = -300;
keyLight.shadow.camera.right = 300;
keyLight.shadow.camera.top = 300;
keyLight.shadow.camera.bottom = -300;
S.scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x7c4dff, 1.0);
fillLight.position.set(-200, 100, -100);
S.scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xff88cc, 0.6);
rimLight.position.set(0, -50, -300);
S.scene.add(rimLight);

// ─── STARFIELD BACKGROUND ───
function createStarfield() {
  if (S.starfieldGeo && S.starfieldMat) {
    const stars = new THREE.Points(S.starfieldGeo, S.starfieldMat);
    S.scene.add(stars);
    return stars;
  }
  const starsGeo = new THREE.BufferGeometry();
  const starCount = 3000;
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  const colors = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 500 + Math.random() * 800;
    positions[i*3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i*3+1] = Math.abs(r * Math.cos(phi)) * 0.4;
    positions[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
    sizes[i] = 0.5 + Math.random() * 2;
    const tint = Math.random();
    colors[i*3] = 0.6 + tint * 0.3;
    colors[i*3+1] = 0.5 + (1-tint) * 0.4;
    colors[i*3+2] = 0.8 + Math.random() * 0.2;
  }
  starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starsGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  starsGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  S.starfieldGeo = starsGeo;

  S.starfieldMat = new THREE.PointsMaterial({
    size: 1.5, transparent: true, opacity: 0.6,
    vertexColors: true, blending: THREE.AdditiveBlending,
    depthWrite: false, sizeAttenuation: true,
  });
  const stars = new THREE.Points(S.starfieldGeo, S.starfieldMat);
  S.scene.add(stars);
  return stars;
}
createStarfield();

function createNebula() {
  const nebulaMat = new THREE.MeshBasicMaterial({
    color: 0x1a1040, transparent: true, opacity: 0.08, side: THREE.BackSide,
  });
  const nebula = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 32), nebulaMat);
  S.scene.add(nebula);

  const nebulaMat2 = new THREE.MeshBasicMaterial({
    color: 0x0a2040, transparent: true, opacity: 0.05, side: THREE.BackSide,
  });
  const nebula2 = new THREE.Mesh(new THREE.SphereGeometry(550, 32, 32), nebulaMat2);
  nebula2.position.set(-100, 50, -100);
  S.scene.add(nebula2);
}
createNebula();

// ─── GROUND FLOOR (shared by all projects) ───
function createGroundFloor() {
  if (S.groundFloorCache) return S.groundFloorCache;
  const group = new THREE.Group();
  const yPos = -2;

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a18, roughness: 0.9, metalness: 0.1,
  });
  const floor = new THREE.Mesh(S.GEO.circle450, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = yPos;
  floor.receiveShadow = true;
  group.add(floor);

  const borderMat = new THREE.MeshBasicMaterial({
    color: 0x7c4dff, transparent: true, opacity: 0.06, side: THREE.DoubleSide,
  });
  const border = new THREE.Mesh(S.GEO.ring448, borderMat);
  border.rotation.x = -Math.PI / 2;
  border.position.y = yPos + 0.5;
  group.add(border);

  const gridHelper = new THREE.GridHelper(900, 36, 0x3a2a6a, 0x2a1a4a);
  gridHelper.position.y = yPos + 0.5;
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.05;
  group.add(gridHelper);

  S.groundFloorCache = group;
  return group;
}

S.scene.add(createGroundFloor());

// ─── AMBIENT PARTICLES (created once, animated in animate) ───
{
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(S.particleCount * 3);
  for (let i = 0; i < S.particleCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const r = 40 + Math.random() * 350;
    positions[i*3] = Math.cos(theta) * r;
    positions[i*3+1] = 10 + Math.random() * 150;
    positions[i*3+2] = Math.sin(theta) * r;
    S.ambientSpeeds[i] = 0.3 + Math.random() * 0.5;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x7c4dff, size: 1.2, transparent: true, opacity: 0.15,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  S.ambientParticles = new THREE.Points(geo, mat);
  S.scene.add(S.ambientParticles);
}

// ─── EXPORTS ───
export const scene = S.scene;
export const camera = S.camera;
export { renderer, labelRenderer, controls, createGroundFloor };
export const ambientParticles = S.ambientParticles;
export const ambientSpeeds = S.ambientSpeeds;
export const particleCount = S.particleCount;
