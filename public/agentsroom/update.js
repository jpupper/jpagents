// ─── AGENTS ROOM — SCENE UPDATE ───
// Agent refresh/addition/removal logic.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { scene } from './scene.js';
import { S } from './state.js';
import { buildMage, buildLabel } from './builders.js';
import { syncProjectNodes, cleanupExitedAgents, rebuildScene, fetchProjectData } from './scene-manager.js';
import { updatePanel, updateFocusPanel, applyCustomColors } from './panels.js';

// ─── GET AGENT ORBIT POSITION ───
function getAgentOrbitPosition(projKey, agentIdx, agentsInGroup) {
  const floorChildren = S.floorGroup.children;
  let px = 0, pz = 0;
  for (const child of floorChildren) {
    if (child.userData && child.userData._projKey === projKey) {
      px = child.position.x;
      pz = child.position.z;
      break;
    }
  }
  const orbitRadius = S.calibState.orbitRadius;
  const orbitAngle = (agentIdx / agentsInGroup) * Math.PI * 2;
  return {
    x: px + Math.cos(orbitAngle) * orbitRadius,
    z: pz + Math.sin(orbitAngle) * orbitRadius,
    orbitCenter: new THREE.Vector3(px, 0, pz),
    orbitAngle,
    orbitRadius,
  };
}

// ─── INCREMENTAL UPDATE ───
export function incrementalUpdate(newAgents) {
  const prevIds = new Set(S.agentMap.keys());
  const newIds = new Set(newAgents.map(a => a.id || a.pid));

  const toRemove = [...prevIds].filter(id => !newIds.has(id));
  const toAdd = [];
  for (const agent of newAgents) {
    const id = agent.id || agent.pid;
    if (!prevIds.has(id)) toAdd.push(agent);
  }

  for (const id of toRemove) {
    const entry = S.agentMap.get(id);
    if (entry) {
      entry.exiting = true;
      entry.mage.userData.animExit = 1;
    }
  }

  if (toRemove.length > 0 || toAdd.length > 0) {
    syncProjectNodes(newAgents);
    repositionAllAgents(newAgents);
  }

  for (const agent of toAdd) {
    addAgentToScene(agent, newAgents);
  }

  S.setAgents([...newAgents]);
  S.setAllAgentsWithData([...newAgents]);

  cleanupExitedAgents();

  while (S.mageParticles.length < newAgents.length) {
    S.mageParticles.push({ particles: [] });
  }
  if (S.mageParticles.length > newAgents.length) {
    for (let i = newAgents.length; i < S.mageParticles.length; i++) {
      for (const p of (S.mageParticles[i]?.particles || [])) {
        scene.remove(p.sprite);
        if (p.sprite.material) p.sprite.material.dispose();
      }
    }
    S.mageParticles.length = newAgents.length;
  }

  updatePanel();
}

// ─── REPOSITION ALL AGENTS ───
export function repositionAllAgents(newAgents) {
  const projectGroups = {};
  for (const agent of newAgents) {
    const projKey = agent.projectId || '__default__';
    if (!projectGroups[projKey]) projectGroups[projKey] = { name: agent.projectName || 'Default', agents: [] };
    projectGroups[projKey].agents.push(agent);
  }

  const projKeys = Object.keys(projectGroups);
  const polarRadius = S.calibState.polarRadius;

  const floorChildren = S.floorGroup.children;
  let nodeIdx = 0;
  for (const child of floorChildren) {
    if (child.userData && child.userData._projKey) {
      const polarAngle = (nodeIdx / projKeys.length) * Math.PI * 2 - Math.PI / 2;
      child.position.x = Math.cos(polarAngle) * polarRadius;
      child.position.z = Math.sin(polarAngle) * polarRadius;
      nodeIdx++;
    }
  }

  const labelsToUpdate = [];
  scene.children.forEach(c => {
    if (c.isCSS2DObject && c.userData && c.userData._isProjLabel) {
      labelsToUpdate.push(c);
    }
  });

  nodeIdx = 0;
  for (const projKey of projKeys) {
    const polarAngle = (nodeIdx / projKeys.length) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(polarAngle) * polarRadius;
    const pz = Math.sin(polarAngle) * polarRadius;

    if (labelsToUpdate[nodeIdx]) {
      labelsToUpdate[nodeIdx].position.set(px, 60, pz);
    }

    const agentsInGroup = projectGroups[projKey].agents;
    agentsInGroup.forEach((agent, aIdx) => {
      const id = agent.id || agent.pid;
      const entry = S.agentMap.get(id);
      if (!entry || entry.exiting) return;

      const orbitRadius = S.calibState.orbitRadius;
      const orbitAngle = (aIdx / agentsInGroup.length) * Math.PI * 2;
      const gx = px + Math.cos(orbitAngle) * orbitRadius;
      const gz = pz + Math.sin(orbitAngle) * orbitRadius;

      const mage = entry.mage;
      mage.userData.targetPos.set(gx, 0, gz);
      mage.userData.orbitCenter = new THREE.Vector3(px, 0, pz);
      mage.userData.orbitAngle = orbitAngle;
      mage.userData.orbitRadius = orbitRadius;
      mage.userData.orbitSpeed = 0.12 + (aIdx % 5) * 0.02;

      mage.position.x = gx;
      mage.position.z = gz;
      mage.lookAt(px, mage.position.y, pz);

      if (entry.label) {
        entry.label.position.x = gx;
        entry.label.position.z = gz;
      }

      const originalIndex = newAgents.indexOf(agent);
      S.setClickables(S.clickables.filter(c => c.mage !== mage));
      mage.traverse(child => {
        if (child.isMesh) {
          S.clickables.push({ mesh: child, agentIndex: originalIndex, mage });
        }
      });
    });

    nodeIdx++;
  }
}

// ─── ADD AGENT TO SCENE ───
function addAgentToScene(agent, allAgents) {
  const id = agent.id || agent.pid;
  const isGhost = !!agent.isExternal;
  const agentIdx = allAgents.indexOf(agent);

  const projKey = agent.projectId || '__default__';
  const sameProj = allAgents.filter(a => (a.projectId || '__default__') === projKey);
  const idxInProj = sameProj.indexOf(agent);

  const mage = buildMage(agent, agentIdx, sameProj.length, isGhost);

  let px = 0, pz = 0;
  for (const child of S.floorGroup.children) {
    if (child.userData && child.userData._projKey === projKey) {
      px = child.position.x;
      pz = child.position.z;
      break;
    }
  }

  const orbitRadius = S.calibState.orbitRadius;
  const orbitAngle = (idxInProj / sameProj.length) * Math.PI * 2;
  const gx = px + Math.cos(orbitAngle) * orbitRadius;
  const gz = pz + Math.sin(orbitAngle) * orbitRadius;

  mage.position.set(gx, 0, gz);
  mage.lookAt(px, 0, pz);
  mage.userData.targetPos = mage.position.clone();
  mage.userData.orbitCenter = new THREE.Vector3(px, 0, pz);
  mage.userData.orbitAngle = orbitAngle;
  mage.userData.orbitRadius = orbitRadius;
  mage.userData.orbitSpeed = 0.12 + (idxInProj % 5) * 0.02;
  mage.userData.agentId = id;

  // Apply saved custom colors
  applyCustomColors(id, mage);

  mage.traverse(child => {
    if (child.isMesh) {
      S.clickables.push({ mesh: child, agentIndex: agentIdx, mage });
    }
  });

  S.mageGroup.add(mage);

  const label = buildLabel(agent);
  label.position.set(gx, 70, gz);
  label.element.style.opacity = '1';
  scene.add(label);
  mage.userData.label = label;

  mage.userData.animEnter = 0.01;

  S.agentMap.set(id, { mage, label, agentData: agent, exiting: false, animatingIn: true });

  updateProjectLabels();
}

// ─── UPDATE PROJECT LABELS ───
function updateProjectLabels() {
  let labelIdx = 0;
  scene.children.forEach(c => {
    if (c.isCSS2DObject && c.userData && c.userData._isProjLabel) {
      const floorChildren = S.floorGroup.children;
      let found = 0;
      for (const child of floorChildren) {
        if (child.userData && child.userData._projKey) {
          if (found === labelIdx) {
            c.position.set(child.position.x, 60, child.position.z);
            break;
          }
          found++;
        }
      }
      labelIdx++;
    }
  });
}

// ─── FETCH AGENTS ───
export async function refreshAgents(forceRebuild = false) {
  try {
    const res = await fetch(`${S.API}/admin/agents`);
    const data = await res.json();
    const newAgents = data.agents || [];

    S.setAgents(S.calibState.showGhosts ? newAgents : newAgents.filter(a => !a.isExternal));
    S.setAllAgentsWithData([...S.agents]);

    const dataKey = JSON.stringify(S.agents.map(a => ({ id: a.id, pid: a.pid, status: a.status, name: a.name, sessionTitle: a.sessionTitle, isExternal: a.isExternal, projectId: a.projectId })));
    if (dataKey === S.lastAgentData && S.agentMap.size > 0 && !forceRebuild) {
      for (const agent of S.agents) {
        const id = agent.id || agent.pid;
        const entry = S.agentMap.get(id);
        if (entry && !entry.exiting) {
          entry.agentData = agent;
        }
      }
      updatePanel();
      if (S.isFocusMode && S.focusState) {
        const agentData = S.allAgentsWithData[S.focusState.agentIndex];
        if (agentData) updateFocusPanel(agentData);
      }
      return;
    }

    S.setLastAgentData(dataKey);

    const prevProjKeys = new Set();
    for (const entry of S.agentMap.values()) {
      if (entry.agentData && !entry.exiting) {
        prevProjKeys.add(entry.agentData.projectId || '__default__');
      }
    }

    const currentIds = new Set(S.agentMap.keys());
    const newIds = new Set(S.agents.map(a => a.id || a.pid));
    const diffCount = [...currentIds].filter(id => !newIds.has(id)).length +
                      [...newIds].filter(id => !currentIds.has(id)).length;

    const newProjKeys = new Set(S.agents.map(a => a.projectId || '__default__'));
    let projChanged = prevProjKeys.size !== newProjKeys.size;
    if (!projChanged) {
      for (const pk of newProjKeys) {
        if (!prevProjKeys.has(pk)) {
          projChanged = true;
          break;
        }
      }
    }

    const needsFullRebuild = forceRebuild || S.agentMap.size === 0 || diffCount > Math.max(3, currentIds.size * 0.5) || projChanged;

    if (needsFullRebuild) {
      rebuildScene();
      fetchProjectData();
      if (S.isFocusMode && S.focusState) {
        const agentData = S.allAgentsWithData[S.focusState.agentIndex];
        if (agentData) {
          updateFocusPanel(agentData);
          for (const c of S.clickables) {
            if (c.agentIndex === S.focusState.agentIndex) {
              S.focusState.mage = c.mage;
              break;
            }
          }
        }
      }
    } else {
      incrementalUpdate(S.agents);
    }
  } catch(e) {
    console.error('[AGENTS-ROOM] Fetch error:', e.message);
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
      loadingEl.textContent = '✦ ERROR: ' + e.message.slice(0, 30) + '... ✦';
      loadingEl.style.color = 'rgba(255,68,68,0.6)';
    }
  }
}
