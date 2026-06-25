// ─── AGENTS ROOM — MAIN ORCHESTRATOR ───
// This is the entry point that wires everything together.
import { scene, camera, renderer, labelRenderer, controls, ambientParticles } from './scene.js';
import { S } from './state.js';
import { refreshAgents, repositionAllAgents } from './update.js';
import { fetchProjectData } from './scene-manager.js';
import { focusAgent, unfocusAgent, hideProjectInfo, showProjectInfo, hidePedestalView } from './panels.js';
import { animate } from './animate.js';

// ─── INIT ───
// initGeometryPool() runs automatically in agents-room-state.js at module eval time

// ─── RESIZE ───
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── START ───
const loadingEl = document.getElementById('loading');
if (loadingEl) loadingEl.textContent = '\u2726 CONJURING \u2726';

// Expose refresh globally (called by BroadcastChannel/WebSocket messages)
window.refreshAgents = refreshAgents;

// ─── CALIBRATION UI ───
const calibBtn = document.getElementById('calib-btn');
const calibPanel = document.getElementById('calib-panel');
const polarSlider = document.getElementById('polar-radius-slider');
const polarVal = document.getElementById('polar-radius-val');
const orbitSlider = document.getElementById('orbit-radius-slider');
const orbitVal = document.getElementById('orbit-radius-val');
const calibReset = document.getElementById('calib-reset');
const ghostToggle = document.getElementById('ghost-toggle');

calibBtn.addEventListener('click', () => {
  S.setCalibPanelOpen(!S.calibPanelOpen);
  calibPanel.classList.toggle('open', S.calibPanelOpen);
  calibBtn.classList.toggle('active', S.calibPanelOpen);
});

function applyCalibration() {
  S.calibState.polarRadius = parseInt(polarSlider.value);
  S.calibState.orbitRadius = parseInt(orbitSlider.value);
  polarVal.textContent = S.calibState.polarRadius;
  orbitVal.textContent = S.calibState.orbitRadius;

  if (S.agentMap.size > 0) {
    // Dynamic import to avoid circular dep at module level
    repositionAllAgents(S.agents);
  }
}

polarSlider.addEventListener('input', applyCalibration);
orbitSlider.addEventListener('input', applyCalibration);

ghostToggle.addEventListener('change', () => {
  S.calibState.showGhosts = ghostToggle.checked;
  refreshAgents(true);
});

calibReset.addEventListener('click', () => {
  polarSlider.value = S.CALIB_DEFAULTS.polarRadius;
  orbitSlider.value = S.CALIB_DEFAULTS.orbitRadius;
  ghostToggle.checked = S.CALIB_DEFAULTS.showGhosts;
  S.calibState.showGhosts = S.CALIB_DEFAULTS.showGhosts;
  applyCalibration();
  refreshAgents(true);
});

// ─── CLOSE CALIB PANEL ON OUTSIDE CLICK ───
document.addEventListener('click', (e) => {
  if (S.calibPanelOpen &&
      !calibPanel.contains(e.target) &&
      e.target !== calibBtn &&
      !calibBtn.contains(e.target)) {
    S.setCalibPanelOpen(false);
    calibPanel.classList.remove('open');
    calibBtn.classList.remove('active');
  }
});

// ─── ENTER PEDESTAL ORBIT MODE ───
function enterPedestalOrbit(projKey, pedNodeGroup) {
  if (S.isFocusMode) unfocusAgent();
  if (S.isProjectMode) hideProjectInfo();

  // Find the actual position from the floor group
  let pedestalCenter = new THREE.Vector3(0, 5, 0);
  S.floorGroup.children.forEach(child => {
    if (child.userData && child.userData._projKey === projKey) {
      pedestalCenter = child.position.clone();
      pedestalCenter.y = 5;
    }
  });

  S.isPedestalMode = true;
  S.pedestalState = {
    projKey,
    nodeGroup: pedNodeGroup,
    pedestalCenter,
    initialCamPos: S.camera.position.clone(),
    initialTarget: S.controls.target.clone(),
    targetPos: new THREE.Vector3(
      pedestalCenter.x + 120,
      pedestalCenter.y + 40,
      pedestalCenter.z
    ),
    animating: true,
    animT: 0,
    currentAngle: 0,
  };

  S.controls.autoRotate = false;
  S.controls.enableRotate = false;
  S.controls.enablePan = false;

  document.getElementById('pedestal-view-hint').classList.add('open');
  document.getElementById('data-panel').classList.add('focus-hidden');
}

// ─── EXIT PEDESTAL ORBIT MODE ───
function exitPedestalOrbit() {
  if (!S.isPedestalMode) return;
  S.isPedestalMode = false;
  S.pedestalState = null;
  S.controls.autoRotate = true;
  S.controls.enableRotate = true;
  S.controls.enablePan = true;
  document.getElementById('pedestal-view-hint').classList.remove('open');
  document.getElementById('data-panel').classList.remove('focus-hidden');
}

// ─── BROADCAST CHANNEL & WEBSOCKET ───
const bc = new BroadcastChannel('jp-agents-room');
bc.onmessage = (event) => {
  if (event.data && (event.data.type === 'agents-updated' || event.data.type === 'state-updated')) {
    refreshAgents();
    fetchProjectData();
  }
};
window.addEventListener('beforeunload', () => bc.close());

function connectWebSocket() {
  try {
    const ws = new WebSocket(`ws://localhost:4699/ws/hermes`);
    ws.onopen = () => {
      console.log('[AGENTS-ROOM] Conectado a WebSocket Server de Sincronizaci\u00F3n.');
      refreshAgents();
      fetchProjectData();
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'sync:stateUpdated' ||
            data.event === 'hermes:status' ||
            data.event === 'hermes:agent:started' ||
            data.event === 'hermes:agent:completed' ||
            data.event === 'hermes:agent:stopped') {
          console.log(`[AGENTS-ROOM] Sincronizaci\u00F3n recibida v\u00EDa WebSocket (${data.event}). Refrescando...`);
          refreshAgents();
          fetchProjectData();
        }
      } catch (e) {}
    };
    ws.onclose = () => {
      console.log('[AGENTS-ROOM] Conexi\u00F3n WebSocket cerrada. Reintentando en 5s...');
      setTimeout(connectWebSocket, 5000);
    };
    ws.onerror = () => {};
  } catch (e) {
    console.error('[AGENTS-ROOM] Error conectando WebSocket:', e);
  }
}

// ─── CLICK RAYCASTER ───
renderer.domElement.addEventListener('click', (event) => {
  // If in pedestal mode, clicking anywhere exits
  if (S.isPedestalMode) { exitPedestalOrbit(); return; }
  // If in focus mode, clicking exits
  if (S.isFocusMode) { unfocusAgent(); return; }

  const rect = renderer.domElement.getBoundingClientRect();
  S.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  S.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  S.raycaster.setFromCamera(S.pointer, camera);

  // Check pedestal clicks first
  const pedestalMeshes = S.pedestalClickables.map(c => c.mesh);
  const pedIntersects = S.raycaster.intersectObjects(pedestalMeshes);
  if (pedIntersects.length > 0) {
    const hitMesh = pedIntersects[0].object;
    const ped = S.pedestalClickables.find(c => c.mesh === hitMesh);
    if (ped) {
      // Show project info AND enter orbit mode
      showProjectInfo(ped.projId);
      enterPedestalOrbit(ped.projId, ped.group);
      return;
    }
  }

  // Then check agent clicks
  const meshes = S.clickables.map(c => c.mesh);
  const intersects = S.raycaster.intersectObjects(meshes);

  if (intersects.length > 0) {
    const hitMesh = intersects[0].object;
    const clickable = S.clickables.find(c => c.mesh === hitMesh);
    if (clickable) focusAgent(clickable.agentIndex);
  }
});

// ─── ESC KEY ───
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (S.isPedestalMode) { exitPedestalOrbit(); return; }
    if (S.isProjectMode) { hideProjectInfo(); return; }
    if (S.isFocusMode) { unfocusAgent(); return; }
  }
});

// ─── CLOSE BUTTONS ───
document.getElementById('fi-close-btn').addEventListener('click', unfocusAgent);
document.getElementById('pi-close-btn').addEventListener('click', () => {
  if (S.isPedestalMode) exitPedestalOrbit();
  hideProjectInfo();
});

// ─── CUSTOM EVENT: RESET COLORS ───
window.addEventListener('agentsroom:reset-colors', () => {
  refreshAgents(true);
});

// ─── GO! ───
connectWebSocket();
refreshAgents();
fetchProjectData();
animate();
