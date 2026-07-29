// ─── AGENTS ROOM — MAIN ORCHESTRATOR ───
// This is the entry point that wires everything together.
import { scene, camera, renderer, labelRenderer, controls, ambientParticles } from './agents-room-scene.js';
import { S } from './agents-room-state.js';
import { refreshAgents, repositionAllAgents } from './agents-room-update.js';
import { fetchProjectData } from './agents-room-scene-manager.js';
import { focusAgent, unfocusAgent, hideProjectInfo, showProjectInfo } from './agents-room-panels.js';
import { animate } from './agents-room-animate.js';

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
const offlineToggle = document.getElementById('offline-toggle');

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

offlineToggle.addEventListener('change', () => {
  S.calibState.showOfflineAgents = offlineToggle.checked;
  refreshAgents(true);
});

calibReset.addEventListener('click', () => {
  polarSlider.value = S.CALIB_DEFAULTS.polarRadius;
  orbitSlider.value = S.CALIB_DEFAULTS.orbitRadius;
  ghostToggle.checked = S.CALIB_DEFAULTS.showGhosts;
  offlineToggle.checked = S.CALIB_DEFAULTS.showOfflineAgents;
  S.calibState.showGhosts = S.CALIB_DEFAULTS.showGhosts;
  S.calibState.showOfflineAgents = S.CALIB_DEFAULTS.showOfflineAgents;
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
      showProjectInfo(ped.projId);
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
    if (S.isProjectMode) { hideProjectInfo(); return; }
    if (S.isFocusMode) { unfocusAgent(); return; }
  }
});

// ─── CLOSE BUTTONS ───
document.getElementById('fi-close-btn').addEventListener('click', unfocusAgent);
document.getElementById('pi-close-btn').addEventListener('click', hideProjectInfo);

// ─── GO! ───
connectWebSocket();
refreshAgents();
fetchProjectData();
animate();
