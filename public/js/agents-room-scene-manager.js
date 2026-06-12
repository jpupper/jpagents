// ─── AGENTS ROOM — SCENE LIFECYCLE MANAGER ───
// Scene rebuild/cleanup, project node sync, arcane bubbles, project data fetch.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { CSS2DObject } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/renderers/CSS2DRenderer.js';
import { scene, createGroundFloor } from './agents-room-scene.js';
import { S } from './agents-room-state.js';
import { createProjectNode, buildMage, buildLabel } from './agents-room-builders.js';
import { updateFlameScale, ARCANE_TOOL_WORDS, ARCANE_RUNES, ARCANE_SYMBOLS } from './agents-room-effects.js';
import { updatePanel, updateFocusPanel, unfocusAgent, hideProjectInfo } from './agents-room-panels.js';

// ─── SPARK ARCANE BUBBLE ───
export function spawnArcaneBubble(mage, agentData) {
  const div = document.createElement('div');
  const isThinking = agentData.status === 'thinking';
  const isRunning = agentData.status === 'running';
  const toolName = agentData.toolName || '';

  const variant = ['default', 'rune', 'cyan'][Math.floor(Math.random() * 3)];
  div.className = `arcane-bubble ${variant}`;

  let text = '';
  const randRunes = () => ARCANE_RUNES[Math.floor(Math.random() * ARCANE_RUNES.length)]
    + ARCANE_RUNES[Math.floor(Math.random() * ARCANE_RUNES.length)]
    + ARCANE_RUNES[Math.floor(Math.random() * ARCANE_RUNES.length)];

  if (toolName && ARCANE_TOOL_WORDS[toolName]) {
    const sym = ARCANE_SYMBOLS[Math.floor(Math.random() * ARCANE_SYMBOLS.length)];
    text = sym + ' ' + ARCANE_TOOL_WORDS[toolName] + ' ' + sym;
  } else if (isThinking && agentData.lastMessage?.content) {
    const msg = agentData.lastMessage.content.slice(0, 30).replace(/[^a-zA-Z0-9\s]/g, '').trim();
    if (msg.length > 3) {
      const words = msg.split(/\s+/).slice(0, 4);
      text = randRunes() + ' ' + words.join(' ').toUpperCase() + ' ' + randRunes();
    } else {
      text = randRunes() + ' ⧡ ' + (isRunning ? 'CASTING' : 'MEDITATING') + ' ⧡ ' + randRunes();
    }
  } else {
    const sym = ARCANE_SYMBOLS[Math.floor(Math.random() * ARCANE_SYMBOLS.length)];
    if (isRunning) {
      text = randRunes() + ' ' + sym + ' EXECUTING ' + sym + ' ' + randRunes();
    } else {
      text = randRunes() + ' ' + sym + ' PONDERING ' + sym + ' ' + randRunes();
    }
  }

  div.textContent = text;

  const label = new CSS2DObject(div);
  const mageWorldPos = new THREE.Vector3();
  mage.getWorldPosition(mageWorldPos);
  label.position.set(mageWorldPos.x, mageWorldPos.y + 65, mageWorldPos.z);

  scene.add(label);

  S.addArcaneBubble({
    el: label,
    born: performance.now() / 1000,
    life: 2.5 + Math.random() * 2.0,
    mageRef: mage,
    baseY: mageWorldPos.y + 65,
  });
}

// ─── SYNC PROJECT NODES ───
export function syncProjectNodes(newAgents) {
  const projectGroups = {};
  for (const agent of newAgents) {
    const projKey = agent.projectId || '__default__';
    if (!projectGroups[projKey]) {
      projectGroups[projKey] = { name: agent.projectName || 'Default', agents: [] };
    }
    projectGroups[projKey].agents.push(agent);
  }
  const newProjKeys = new Set(Object.keys(projectGroups));

  const existingNodes = new Map();
  const toRemove = [];
  for (const child of S.floorGroup.children) {
    if (child.userData && child.userData._projKey) {
      const key = child.userData._projKey;
      if (newProjKeys.has(key)) {
        existingNodes.set(key, child);
      } else {
        toRemove.push(child);
      }
    }
  }

  for (const node of toRemove) {
    S.floorGroup.remove(node);
    if (node.traverse) {
      node.traverse(c => {
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
    }
  }

  const labelsToRemove = [];
  scene.children.forEach(c => {
    if (c.isCSS2DObject && c.userData && c.userData._isProjLabel) {
      if (!newProjKeys.has(c.userData._projKey)) {
        labelsToRemove.push(c);
      }
    }
  });
  labelsToRemove.forEach(c => scene.remove(c));

  const polarRadius = S.calibState.polarRadius;
  let needsReposition = toRemove.length > 0;

  for (const projKey of newProjKeys) {
    if (existingNodes.has(projKey)) continue;

    const group = projectGroups[projKey];
    if (!S.projectColors[projKey]) {
      let hash = 0;
      for (let i = 0; i < projKey.length; i++) hash = ((hash << 5) - hash) + projKey.charCodeAt(i);
      S.projectColors[projKey] = Math.abs(hash % 360);
    }
    const hue = S.projectColors[projKey];

    const { group: node, base, top, ring } = createProjectNode(group.name, projKey, hue);
    node.position.set(0, 0, 0);
    node.userData._projKey = projKey;
    S.floorGroup.add(node);

    base.userData._pedestalProjId = projKey;
    top.userData._pedestalProjId = projKey;
    ring.userData._pedestalProjId = projKey;
    S.pedestalClickables.push({ mesh: base, projId: projKey, group: node });
    S.pedestalClickables.push({ mesh: top, projId: projKey, group: node });
    S.pedestalClickables.push({ mesh: ring, projId: projKey, group: node });

    const projNameDiv = document.createElement('div');
    projNameDiv.style.cssText = `
      color: rgba(255,255,255,0.35);
      font-family: 'SF Mono', 'Consolas', monospace;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 3px;
      text-transform: uppercase;
      text-shadow: 0 0 20px rgba(124,77,255,0.15);
      background: rgba(0,0,0,0.3);
      padding: 4px 12px;
      border-radius: 4px;
      backdrop-filter: blur(4px);
      transition: none;
    `;
    projNameDiv.textContent = group.name;
    const projLabel = new CSS2DObject(projNameDiv);
    projLabel.position.set(0, 60, 0);
    projLabel.userData = { _isProjLabel: true, _projKey: projKey };
    scene.add(projLabel);

    needsReposition = true;
  }

  S.setProjectCount(newProjKeys.size);
  return needsReposition;
}

// ─── CLEANUP EXITED AGENTS ───
export function cleanupExitedAgents() {
  const toDelete = [];
  for (const [id, entry] of S.agentMap) {
    if (entry.exiting && entry.mage.userData.animExit <= 0) {
      toDelete.push(id);
    }
  }
  for (const id of toDelete) {
    const entry = S.agentMap.get(id);
    if (!entry) continue;

    S.setClickables(S.clickables.filter(c => c.mage !== entry.mage));

    if (entry.label) {
      scene.remove(entry.label);
    }

    S.mageGroup.remove(entry.mage);
    S.agentMap.delete(id);
  }
}

// ─── CHAR PARTICLES ───
export function cleanupCharParticles() {
  for (const entry of S.mageParticles) {
    for (const p of entry.particles) {
      scene.remove(p.sprite);
      if (p.sprite.material) p.sprite.material.dispose();
    }
  }
  S.setMageParticles([]);
}

// ─── CLEANUP SCENE ───
export function cleanupScene() {
  while (S.mageGroup.children.length) {
    const child = S.mageGroup.children[0];
    S.mageGroup.remove(child);
    if (child.traverse) {
      child.traverse(c => {
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
    }
  }
  scene.remove(S.mageGroup);
  S.setMageGroup(new THREE.Group());

  while (S.floorGroup.children.length) {
    const child = S.floorGroup.children[0];
    S.floorGroup.remove(child);
    if (child.traverse) {
      child.traverse(c => {
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
    }
  }
  scene.remove(S.floorGroup);
  S.setFloorGroup(new THREE.Group());

  const toRemove = [];
  scene.children.forEach(c => {
    if (c.isCSS2DObject) toRemove.push(c);
  });
  toRemove.forEach(c => scene.remove(c));

  cleanupCharParticles();
  S.clearClickables();
  S.clearPedestalClickables();
  if (S.isFocusMode) unfocusAgent();
  if (S.isProjectMode) hideProjectInfo();
}

// ─── FULL SCENE REBUILD ───
export function rebuildScene() {
  for (const [, entry] of S.agentMap) {
    if (entry.label) scene.remove(entry.label);
  }
  S.agentMap.clear();

  for (const bubble of S.arcaneBubbles) {
    scene.remove(bubble.el);
  }
  S.setArcaneBubbles([]);

  cleanupScene();

  const visibleAgents = S.calibState.showGhosts ? S.agents : S.agents.filter(a => !a.isExternal);
  S.setAllAgentsWithData([...visibleAgents]);

  if (visibleAgents.length === 0) {
    scene.add(S.mageGroup);
    S.setMageParticles([]);
    updatePanel();
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'none';
    return;
  }

  scene.add(S.floorGroup);
  const groundFloor = createGroundFloor();
  S.floorGroup.add(groundFloor);

  const projectGroups = {};
  for (const agent of visibleAgents) {
    const projKey = agent.projectId || '__default__';
    if (!projectGroups[projKey]) projectGroups[projKey] = { name: agent.projectName || 'Default', agents: [] };
    projectGroups[projKey].agents.push(agent);
  }

  const projKeys = Object.keys(projectGroups);
  S.setProjectCount(projKeys.length);

  const polarRadius = S.calibState.polarRadius;

  projKeys.forEach((projKey, pIdx) => {
    const group = projectGroups[projKey];
    if (!S.projectColors[projKey]) {
      S.projectColors[projKey] = (pIdx * 60 + 264) % 360;
    }
    const hue = S.projectColors[projKey];

    const polarAngle = (pIdx / projKeys.length) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(polarAngle) * polarRadius;
    const pz = Math.sin(polarAngle) * polarRadius;

    const { group: node, base, top, ring } = createProjectNode(group.name, projKey, hue);
    node.position.set(px, 0, pz);
    node.userData._projKey = projKey;
    S.floorGroup.add(node);

    base.userData._pedestalProjId = projKey;
    top.userData._pedestalProjId = projKey;
    ring.userData._pedestalProjId = projKey;
    S.pedestalClickables.push({ mesh: base, projId: projKey, group: node });
    S.pedestalClickables.push({ mesh: top, projId: projKey, group: node });
    S.pedestalClickables.push({ mesh: ring, projId: projKey, group: node });

    const projNameDiv = document.createElement('div');
    projNameDiv.style.cssText = `
      color: rgba(255,255,255,0.35);
      font-family: 'SF Mono', 'Consolas', monospace;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 3px;
      text-transform: uppercase;
      text-shadow: 0 0 20px rgba(124,77,255,0.15);
      background: rgba(0,0,0,0.3);
      padding: 4px 12px;
      border-radius: 4px;
      backdrop-filter: blur(4px);
      transition: none;
    `;
    projNameDiv.textContent = group.name;
    const projLabel = new CSS2DObject(projNameDiv);
    projLabel.position.set(px, 60, pz);
    projLabel.userData = { _isProjLabel: true, _projKey: projKey };
    scene.add(projLabel);

    const agentsInGroup = group.agents;
    const orbitRadius = S.calibState.orbitRadius;

    agentsInGroup.forEach((agent, aIdx) => {
      const gh = !!agent.isExternal;
      const mage = buildMage(agent, aIdx, agentsInGroup.length, gh);

      const orbitAngle = (aIdx / agentsInGroup.length) * Math.PI * 2;
      const gx = px + Math.cos(orbitAngle) * orbitRadius;
      const gz = pz + Math.sin(orbitAngle) * orbitRadius;

      mage.position.set(gx, 0, gz);
      mage.lookAt(px, 0, pz);
      mage.userData.targetPos = mage.position.clone();
      mage.userData.orbitCenter = new THREE.Vector3(px, 0, pz);
      mage.userData.orbitAngle = orbitAngle;
      mage.userData.orbitRadius = orbitRadius;
      mage.userData.orbitSpeed = 0.12 + Math.random() * 0.08;
      mage.userData.agentId = agent.id || agent.pid;

      const originalIndex = S.agents.indexOf(agent);
      mage.traverse(child => {
        if (child.isMesh) {
          S.clickables.push({ mesh: child, agentIndex: originalIndex, mage });
        }
      });

      S.mageGroup.add(mage);

      const label = buildLabel(agent);
      label.position.set(gx, 70, gz);
      label.element.style.opacity = '1';
      scene.add(label);
      mage.userData.label = label;

      const id = agent.id || agent.pid;
      S.agentMap.set(id, { mage, label, agentData: agent, exiting: false, animatingIn: true });

      mage.userData.animEnter = 0.01;
    });
  });

  scene.add(S.mageGroup);
  S.setMageParticles(visibleAgents.map(() => ({ particles: [] })));
  updatePanel();

  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.style.display = 'none';
}

// ─── PROJECT DATA FETCH ───
export async function fetchProjectData() {
  try {
    const res = await fetch(`${S.API}/admin/projects`);
    const data = await res.json();
    const projects = data.projects || [];
    const map = {};
    for (const p of projects) {
      map[p.id] = p;
    }
    S.setProjectDataMap(map);
    updateAllFlames();
  } catch (e) {
    console.error('[AGENTS-ROOM] Fetch projects error:', e.message);
  }
}

// ─── UPDATE ALL FLAMES ───
function updateAllFlames() {
  S.floorGroup.children.forEach(child => {
    if (child.userData && child.userData._projKey) {
      const projId = child.userData._projKey;
      const projData = S.projectDataMap[projId];
      const activeCount = projData ? projData.activeAgents : 0;
      const flame = child.userData.flame;
      if (flame) {
        updateFlameScale(flame, activeCount);
      }
    }
  });
}
