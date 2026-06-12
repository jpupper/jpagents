// ─── agents-room-panels.js ───
// Panel UI functions for the Agents Room.
import { S } from './agents-room-state.js';

// ─── LOCAL STATE ───
let currentProjectKey = null;

// ─── FOCUS / UNFOCUS ───

function focusAgent(agentIndex) {
  if (S.isFocusMode) return;
  const agentData = S.allAgentsWithData[agentIndex];
  if (!agentData) return;

  let targetMage = null;
  for (const c of S.clickables) {
    if (c.agentIndex === agentIndex) {
      targetMage = c.mage;
      break;
    }
  }
  if (!targetMage) return;

  S.isFocusMode = true;
  S.focusState = {
    agentIndex, mage: targetMage,
    initialCamPos: S.camera.position.clone(),
    initialTarget: S.controls.target.clone(),
    animating: true, animT: 0,
  };

  S.controls.autoRotate = false;
  S.controls.enableRotate = false;
  S.controls.enablePan = false;

  document.getElementById('focus-info-panel').classList.add('open');
  document.getElementById('focus-backdrop').classList.add('open');
  document.getElementById('unfocus-hint').classList.add('open');
  document.getElementById('data-panel').classList.add('focus-hidden');

  updateFocusPanel(agentData);
}

function unfocusAgent() {
  if (!S.isFocusMode) return;
  S.isFocusMode = false;
  S.controls.autoRotate = true;
  S.controls.enableRotate = true;
  S.controls.enablePan = true;

  document.getElementById('focus-info-panel').classList.remove('open');
  document.getElementById('focus-backdrop').classList.remove('open');
  document.getElementById('unfocus-hint').classList.remove('open');
  document.getElementById('data-panel').classList.remove('focus-hidden');

  S.focusState = null;
}

function updateFocusPanel(agent) {
  const name = document.getElementById('fi-name');
  const label = document.getElementById('fi-label');
  const statusEl = document.getElementById('fi-status-text');
  const statusDot = document.querySelector('#fi-status .s-dot');
  const modelEl = document.getElementById('fi-model');
  const msgsEl = document.getElementById('fi-messages');
  const projectEl = document.getElementById('fi-project');
  const idEl = document.getElementById('fi-id');
  const lastMsgEl = document.getElementById('fi-last-msg');
  const tagsEl = document.getElementById('fi-tags');

  const isGhost = agent.isExternal;
  const isOff = agent.status === 'off';
  name.textContent = agent.sessionTitle || agent.name || agent.agentName || agent.id.slice(0, 10);
  label.textContent = isOff ? '⏻ HERMES APAGADO' : (isGhost ? '👻 HERMES EXTERNO' : (agent.isHermes ? '⚡ HERMES AGENT' : '✦ AI AGENT'));
  const s = agent.status || 'idle';
  statusEl.textContent = isGhost ? (agent.sessionTitle ? agent.sessionTitle : 'externo') : (isOff ? 'apagado' : s);
  statusDot.className = 's-dot ' + (isGhost ? 'idle' : (isOff ? 'off' : s));
  modelEl.textContent = agent.model || 'default';
  msgsEl.textContent = agent.messageCount || 0;
  projectEl.textContent = agent.projectName || '—';
  idEl.textContent = agent.id ? agent.id.slice(0, 12) + '…' : '—';

  if (agent.lastMessage && agent.lastMessage.content) {
    lastMsgEl.textContent = agent.lastMessage.content.slice(0, 300);
  } else {
    lastMsgEl.textContent = 'Sin mensajes';
  }

  tagsEl.innerHTML = '';
  const typeTag = document.createElement('span');
  typeTag.className = 'fi-tag' + (isGhost ? ' ghost' : '');
  typeTag.textContent = isOff ? '⏻ OFF' : (isGhost ? '👻 GHOST' : (agent.isHermes ? '⚡ HERMES' : '✦ AI'));
  tagsEl.appendChild(typeTag);
  if (agent.sessionId) {
    const sidTag = document.createElement('span');
    sidTag.className = 'fi-tag';
    sidTag.textContent = '#' + agent.sessionId.slice(-8);
    tagsEl.appendChild(sidTag);
  }
  if (agent.toolName) {
    const toolTag = document.createElement('span');
    toolTag.className = 'fi-tag';
    toolTag.textContent = '🔧 ' + agent.toolName.slice(0, 20);
    tagsEl.appendChild(toolTag);
  }
  if (agent.model) {
    const modelTag = document.createElement('span');
    modelTag.className = 'fi-tag';
    modelTag.textContent = agent.model.slice(0, 15);
    tagsEl.appendChild(modelTag);
  }

  // ─── Token counter display ───
  const totalTokens = agent.cumulativeTokens || 0;
  const inputTokens = agent.cumulativeInputTokens || 0;
  const outputTokens = agent.cumulativeOutputTokens || 0;
  const cost = agent.cumulativeCost || 0;
  const apiCalls = agent.cumulativeApiCalls || 0;

  const tokensEl = document.getElementById('fi-tokens');
  const tokensIOEl = document.getElementById('fi-tokens-io');
  const costEl = document.getElementById('fi-cost');
  const apiCallsEl = document.getElementById('fi-api-calls');

  if (totalTokens > 0) {
    tokensEl.textContent = '🔢 ' + totalTokens.toLocaleString() + ' tokens';
    tokensIOEl.textContent = '📥 ' + inputTokens.toLocaleString() + ' / 📤 ' + outputTokens.toLocaleString();
    costEl.textContent = '≈ $' + cost.toFixed(6) + ' USD';
    apiCallsEl.textContent = apiCalls.toLocaleString() + ' llamadas';
  } else {
    tokensEl.textContent = 'Sin datos aún';
    tokensIOEl.textContent = '—';
    costEl.textContent = '—';
    apiCallsEl.textContent = '—';
  }
  if (agent.projectName) {
    const projTag = document.createElement('span');
    projTag.className = 'fi-tag';
    projTag.textContent = agent.projectName.slice(0, 20);
    tagsEl.appendChild(projTag);
  }
}

// ─── PROJECT INFO PANEL ───

function showProjectInfo(projKey) {
  if (S.isProjectMode && currentProjectKey === projKey) {
    hideProjectInfo();
    return;
  }

  currentProjectKey = projKey;
  S.isProjectMode = true;
  document.getElementById('project-info-panel').classList.add('open');
  updateProjectInfoPanel(projKey);
}

function hideProjectInfo() {
  S.isProjectMode = false;
  currentProjectKey = null;
  document.getElementById('project-info-panel').classList.remove('open');
}

function updateProjectInfoPanel(projKey) {
  const projData = S.projectDataMap[projKey];
  const agentsInProj = S.agents.filter(a => (a.projectId || '__default__') === projKey);
  const activeCount = projData ? projData.activeAgents : agentsInProj.filter(a => a.status === 'thinking' || a.status === 'running').length;
  const totalCount = projData ? projData.totalAgents : agentsInProj.length;

  // Name
  document.getElementById('pi-name').textContent = projData ? projData.name : projKey;

  // Flame status
  const flameDot = document.getElementById('pi-flame-dot');
  const flameText = document.getElementById('pi-flame-text');
  if (activeCount > 0) {
    flameDot.className = 'pi-flame-dot active';
    flameText.textContent = activeCount === 1 ? '1 agente activo' : `${activeCount} agentes activos`;
  } else {
    flameDot.className = 'pi-flame-dot off';
    flameText.textContent = 'sin agentes activos';
  }

  document.getElementById('pi-active-agents').textContent = activeCount;
  document.getElementById('pi-total-agents').textContent = totalCount;

  // Folder
  const folder = projData ? projData.folder : '';
  const folderEl = document.getElementById('pi-folder');
  const openBtn = document.getElementById('pi-open-folder-btn');
  if (folder) {
    folderEl.textContent = folder;
    openBtn.style.display = 'inline-block';
    openBtn.onclick = () => {
      // Open folder via API
      fetch(`${S.API}/utils/open-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: folder })
      }).catch(() => {});
    };
  } else {
    folderEl.textContent = '—';
    openBtn.style.display = 'none';
  }

  // GitHub
  const githubUrl = projData ? projData.github_url : '';
  const ghSection = document.getElementById('pi-github-section');
  const ghLink = document.getElementById('pi-github-link');
  if (githubUrl) {
    ghSection.style.display = '';
    ghLink.href = githubUrl;
    ghLink.textContent = githubUrl.replace('https://github.com/', '');
  } else {
    ghSection.style.display = 'none';
  }

  // Description
  const descEl = document.getElementById('pi-description');
  descEl.textContent = (projData && projData.description) ? projData.description : 'Sin descripción';

  // Recent changes
  const changesEl = document.getElementById('pi-changes');
  if (projData && projData.recentChanges && projData.recentChanges.length > 0) {
    changesEl.innerHTML = projData.recentChanges.map(c => `<div class="pi-change-item">▸ ${c}</div>`).join('');
  } else {
    changesEl.innerHTML = '<span class="pi-empty">Sin cambios recientes</span>';
  }

  // Tags
  const tagsEl = document.getElementById('pi-tags');
  tagsEl.innerHTML = '';
  const projTag = document.createElement('span');
  projTag.className = 'fi-tag';
  projTag.textContent = '◈ ' + (projData ? projData.name.slice(0, 20) : projKey.slice(0, 20));
  tagsEl.appendChild(projTag);
  if (projData && projData.model) {
    const modelTag = document.createElement('span');
    modelTag.className = 'fi-tag';
    modelTag.textContent = projData.model.slice(0, 15);
    tagsEl.appendChild(modelTag);
  }
  if (githubUrl) {
    const ghTag = document.createElement('span');
    ghTag.className = 'fi-tag';
    ghTag.textContent = '🔗 GitHub';
    tagsEl.appendChild(ghTag);
  }
}

// ─── DATA PANEL UPDATE ───
function updatePanel() {
  const panel = document.getElementById('data-panel');
  if (!panel) return;
  const agents = S.allAgentsWithData || [];
  if (agents.length === 0) {
    panel.innerHTML = '<div style="color:rgba(255,255,255,0.2);padding:4px 0;">✦ Esperando agentes...</div>';
    return;
  }
  let html = `<div style="color:rgba(124,77,255,0.4);font-size:0.65rem;letter-spacing:2px;margin-bottom:6px;">
    ✦ ${agents.length} agente${agents.length !== 1 ? 's' : ''}
  </div>`;
  for (const agent of agents) {
    const status = agent.status || 'idle';
    const name = agent.sessionTitle || agent.name || agent.agentName || (agent.id ? agent.id.slice(0, 12) : '?');
    const model = agent.model || '';
    const isGhost = agent.isExternal;
    const tagClass = isGhost ? 'a-tag ghost' : 'a-tag';
    const tagText = isGhost ? '👻' : (agent.isHermes ? '⚡' : '✦');
    html += `<div class="agent-row">
      <span class="dot ${status}"></span>
      <span class="a-name">${name.slice(0, 30)}</span>
      <span class="a-model">${model.slice(0, 15)}</span>
      <span class="${tagClass}">${tagText}</span>
    </div>`;
  }
  panel.innerHTML = html;
}

// ─── EXPORT ───
export { focusAgent, unfocusAgent, updateFocusPanel, showProjectInfo, hideProjectInfo, updateProjectInfoPanel, updatePanel };
