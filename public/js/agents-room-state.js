// ─── agents-room-state.js ───
// Shared state object for the Agents Room Three.js visualization.
// All modules import { S } from './agents-room-state.js' to access shared state.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/renderers/CSS2DRenderer.js';

// ─── SHARED STATE OBJECT ───
// All mutable state lives here. Modules access via `import { S } from './agents-room-state.js'`.
const S = {};

// ─── THREE EXPORTS (for modules that need THREE types) ───
S.THREE = THREE;
S.CSS2DObject = CSS2DObject;
S.CSS2DRenderer = CSS2DRenderer;
S.OrbitControls = OrbitControls;

// ─── CONFIG ───
S.API = 'http://localhost:4699/api';
S.agents = [];
S.allAgentsWithData = [];
S.mageGroup = new THREE.Group();
S.floorGroup = new THREE.Group();
S.projectColors = {};
S.projectCount = 0;

// ─── CALIBRACIÓN ───
S.calibState = {
  polarRadius: 180,
  orbitRadius: 42,
  showGhosts: true,
};
S.calibPanelOpen = false;
S.CALIB_DEFAULTS = { polarRadius: 180, orbitRadius: 42, showGhosts: true };
S.cleanupFrameCounter = 0;

// ─── GEOMETRY POOL ───
S.GEO = {};
function initGeometryPool() {
  const G = S.GEO;
  G.cy10x14x30 = new THREE.CylinderGeometry(10, 14, 30, 10);
  G.cy1x2x14 = new THREE.CylinderGeometry(2, 2.5, 14, 6);
  G.cy14x14x1 = new THREE.CylinderGeometry(14, 14, 1.5, 12);
  G.cy10x22 = new THREE.ConeGeometry(10, 22, 10);
  G.cy18x22x6 = new THREE.CylinderGeometry(18, 22, 6, 16);
  G.cy16x16x1 = new THREE.CylinderGeometry(16, 16, 1.5, 16);
  G.cy7x9x3 = new THREE.CylinderGeometry(7, 9, 3, 8);
  G.cy4x5x10 = new THREE.CylinderGeometry(4, 5, 10, 8);
  G.cy8x8x1 = new THREE.CylinderGeometry(8, 8, 1.5, 8);
  G.cy4x12x60 = new THREE.CylinderGeometry(4, 12, 60, 12, 1, true);
  G.cy1x8x80 = new THREE.CylinderGeometry(1.5, 8, 80, 12, 1, true);
  G.sphere6 = new THREE.SphereGeometry(6, 12, 12);
  G.sphere25 = new THREE.SphereGeometry(2.5, 6, 6);
  G.sphere22h = new THREE.SphereGeometry(2.2, 6, 6);
  G.sphere18 = new THREE.SphereGeometry(1.8, 8, 8);
  G.sphere24 = new THREE.SphereGeometry(24, 16, 16);
  G.sphere22 = new THREE.SphereGeometry(22, 16, 16);
  G.sphere35 = new THREE.SphereGeometry(35, 20, 20);
  G.sphere20 = new THREE.SphereGeometry(20, 16, 16);
  G.sphere12g = new THREE.SphereGeometry(12, 12, 12);
  G.torus12x1 = new THREE.TorusGeometry(12, 1.5, 8, 16);
  G.torus20x1 = new THREE.TorusGeometry(20, 0.8, 8, 32);
  G.torus6x1 = new THREE.TorusGeometry(6, 0.8, 8, 16);
  G.cone5x8 = new THREE.ConeGeometry(5, 8, 6);
  G.box14x2x10 = new THREE.BoxGeometry(14, 2, 10);
  G.box12x1x8 = new THREE.BoxGeometry(12, 1.2, 8);
  G.box8x0x5 = new THREE.BoxGeometry(8, 0.2, 5);
  G.ring448 = new THREE.RingGeometry(448, 460, 64);
  G.ring36 = new THREE.RingGeometry(36, 38, 48);
  G.ring8 = new THREE.RingGeometry(8, 18, 32);
  G.ring2x8 = new THREE.RingGeometry(2, 8, 32);
  G.ring12 = new THREE.RingGeometry(12, 28, 48);
  G.circle450 = new THREE.CircleGeometry(450, 48);
  G.circle24 = new THREE.CircleGeometry(24, 24);
  G.crossArm = new THREE.BoxGeometry(1.2, 10, 1.2);
}
initGeometryPool();

// ─── FOCUS / RAYCASTER ───
S.focusState = null;
S.raycaster = new THREE.Raycaster();
S.pointer = new THREE.Vector2();
S.clickables = [];
S.pedestalClickables = [];
S.isFocusMode = false;
S.isProjectMode = false;

// ─── AGENT TRACKING ───
S.agentMap = new Map();
S.projectDataMap = {};

// ─── ARCANE BUBBLES ───
S.arcaneBubbles = [];

// ─── SCENE REFERENCES (set by agents-room-scene.js) ───
S.scene = null;
S.camera = null;
S.renderer = null;
S.labelRenderer = null;
S.controls = null;

// ─── STARFIELD (set by agents-room-scene.js) ───
S.starfieldGeo = null;
S.starfieldMat = null;

// ─── GROUND FLOOR CACHE (set by agents-room-scene.js) ───
S.groundFloorCache = null;

// ─── PARTICLE SYSTEM ───
S.mageParticles = [];
S.ambientParticles = null;
S.particleCount = 120;
S.ambientSpeeds = [];

// ─── ANIMATION ───
S.clock = new THREE.Clock();

// ─── AGENT DATA CACHE ───
S.lastAgentData = '';

// ─── HELPER FUNCTIONS (setters & utilities) ───
S.setAgents = (arr) => { S.agents = arr; };
S.setAllAgentsWithData = (arr) => { S.allAgentsWithData = arr; };
S.setClickables = (arr) => { S.clickables = arr; };
S.clearClickables = () => { S.clickables = []; };
S.clearPedestalClickables = () => { S.pedestalClickables = []; };
S.setLastAgentData = (data) => { S.lastAgentData = data; };
S.setMageGroup = (group) => { S.mageGroup = group; };
S.setFloorGroup = (group) => { S.floorGroup = group; };
S.setMageParticles = (arr) => { S.mageParticles = arr; };
S.setProjectCount = (n) => { S.projectCount = n; };
S.setProjectDataMap = (map) => { S.projectDataMap = map; };
S.setArcaneBubbles = (arr) => { S.arcaneBubbles = arr; };
S.addArcaneBubble = (obj) => { S.arcaneBubbles.push(obj); };
S.removeArcaneBubble = (idx) => { S.arcaneBubbles.splice(idx, 1); };
S.incCleanupFrameCounter = () => { S.cleanupFrameCounter++; };
S.setCleanupFrameCounter = (n) => { S.cleanupFrameCounter = n; };
S.setCalibPanelOpen = (v) => { S.calibPanelOpen = v; };

// ─── EXPORTS ───
export const GEO = S.GEO;
export { S };
