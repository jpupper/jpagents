// ─── AGENTS ROOM — 3D BUILDERS ───
// Mesh/mage/pedestal/label construction functions.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { CSS2DObject } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/renderers/CSS2DRenderer.js';
import { GEO } from './agents-room-state.js';
import { getCharTexture, createFlame, updateFlameScale } from './agents-room-effects.js';

// ─── PROJECT NODE (PEDESTAL) ───
export function createProjectNode(projectName, projectId, hue) {
  const group = new THREE.Group();
  const color = new THREE.Color(`hsl(${hue}, 45%, 18%)`);
  const colorLight = new THREE.Color(`hsl(${hue}, 55%, 35%)`);

  const baseMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 });
  const base = new THREE.Mesh(GEO.cy18x22x6, baseMat);
  base.position.y = 3;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const topMat = new THREE.MeshStandardMaterial({
    color: colorLight, roughness: 0.4, metalness: 0.5,
    emissive: colorLight, emissiveIntensity: 0.05,
  });
  const top = new THREE.Mesh(GEO.cy16x16x1, topMat);
  top.position.y = 7;
  group.add(top);

  const ringMat = new THREE.MeshBasicMaterial({
    color: colorLight, transparent: true, opacity: 0.2, side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(GEO.torus20x1, ringMat);
  ring.position.y = 7.5;
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const glowFloorMat = new THREE.MeshBasicMaterial({
    color: colorLight, transparent: true, opacity: 0.08,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glowFloor = new THREE.Mesh(GEO.circle24, glowFloorMat);
  glowFloor.rotation.x = -Math.PI / 2;
  glowFloor.position.y = -1.5;
  group.add(glowFloor);

  const pillarMat = new THREE.MeshBasicMaterial({
    color: colorLight, transparent: true, opacity: 0.03, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pillar = new THREE.Mesh(GEO.cy4x12x60, pillarMat);
  pillar.position.y = 35;
  group.add(pillar);

  group.userData.projectName = projectName || 'Default';
  group.userData.hue = hue;

  const orbitRingMat = new THREE.MeshBasicMaterial({
    color: colorLight, transparent: true, opacity: 0.06, side: THREE.DoubleSide,
  });
  const orbitRing = new THREE.Mesh(GEO.ring36, orbitRingMat);
  orbitRing.rotation.x = -Math.PI / 2;
  orbitRing.position.y = -1;
  group.add(orbitRing);

  const runeChars = ['✦', '◇', '⬡', '△'];
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.random() * 0.3;
    const r = 28;
    const runeMat = new THREE.SpriteMaterial({
      map: getCharTexture(runeChars[i % runeChars.length]),
      transparent: true, opacity: 0.06,
      blending: THREE.AdditiveBlending, depthWrite: false,
      color: new THREE.Color(`hsl(${hue}, 60%, 60%)`),
    });
    const rune = new THREE.Sprite(runeMat);
    rune.position.set(Math.cos(angle) * r, 3 + Math.random() * 6, Math.sin(angle) * r);
    rune.scale.set(8, 8, 1);
    rune.userData = { angle, radius: r, yBase: 3, speed: 0.15 + Math.random() * 0.2, phase: Math.random() * Math.PI * 2 };
    group.add(rune);
  }

  const pointLight = new THREE.PointLight(colorLight, 0.4, 100);
  pointLight.position.set(0, 30, 0);
  group.add(pointLight);

  const flame = createFlame(hue, projectId);
  flame.position.y = 7;
  group.add(flame);
  group.userData.flame = flame;

  base.userData._pedestalProjId = projectId;
  top.userData._pedestalProjId = projectId;
  ring.userData._pedestalProjId = projectId;

  return { group, base, top, ring };
}

// ─── BUILD MAGE ───
export function buildMage(agent, index, total, isGhost = false) {
  const group = new THREE.Group();

  const hue = (index * 47 + 264) % 360;
  const ghostHue = 187;
  const mHue = isGhost ? ghostHue : hue;
  const isOff = agent.status === 'off';
  const statusHue = isGhost ? 187 :
    isOff ? 0 :
    agent.status === 'thinking' ? 187 :
    agent.status === 'running' ? 280 :
    agent.status === 'error' ? 0 : 264;
  const glowColor = new THREE.Color(`hsl(${statusHue}, ${isOff ? 0 : 80}%, ${isOff ? 20 : 60}%)`);
  const bodyOpacity = isGhost ? 0.45 : 1;
  const emissiveIntensity = isGhost ? 0.15 : (isOff ? 0 : 0.1);
  const satFactor = isOff ? 0.15 : 1;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${mHue}, ${60 * satFactor}%, ${isGhost ? 40 : isOff ? 18 : 25}%)`),
    roughness: 0.7, metalness: 0.1, transparent: isGhost, opacity: bodyOpacity,
  });
  const body = new THREE.Mesh(GEO.cy10x14x30, bodyMat);
  body.position.y = 15; body.castShadow = true;
  group.add(body);

  const trimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${mHue}, ${70 * satFactor}%, ${isGhost ? 50 : isOff ? 22 : 35}%)`),
    roughness: 0.5, transparent: isGhost, opacity: bodyOpacity,
  });
  const trim = new THREE.Mesh(GEO.torus12x1, trimMat);
  trim.position.y = 2; trim.rotation.x = Math.PI / 2;
  group.add(trim);

  const headMat = new THREE.MeshStandardMaterial({
    color: isGhost ? 0x88ccff : (isOff ? 0x888888 : 0xf0d0b0),
    roughness: 0.6, transparent: isGhost, opacity: Math.min(bodyOpacity + 0.1, 1),
  });
  const head = new THREE.Mesh(GEO.sphere6, headMat);
  head.position.y = 32; head.castShadow = true;
  group.add(head);

  const hatMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${mHue}, ${80 * satFactor}%, ${isGhost ? 35 : isOff ? 12 : 15}%)`),
    roughness: 0.8, transparent: isGhost, opacity: bodyOpacity,
  });
  const brim = new THREE.Mesh(GEO.cy14x14x1, hatMat);
  brim.position.y = 38.5; group.add(brim);
  const cone = new THREE.Mesh(GEO.cy10x22, hatMat);
  cone.position.y = 50; cone.castShadow = true;
  group.add(cone);

  const tipMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${mHue}, ${isOff ? 0 : 90}%, ${isOff ? 15 : 25}%)`),
    emissive: isOff ? new THREE.Color(0x222222) : glowColor,
    emissiveIntensity: emissiveIntensity,
    transparent: isGhost, opacity: bodyOpacity + 0.2,
  });
  const tip = new THREE.Mesh(GEO.sphere25, tipMat);
  tip.position.y = 61;
  group.add(tip);

  let errorCross = null;
  if (agent.status === 'error' && !isGhost) {
    const crossMat = new THREE.MeshStandardMaterial({
      color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 0.8,
      roughness: 0.3, metalness: 0.1,
    });
    const arm1 = new THREE.Mesh(GEO.crossArm, crossMat);
    arm1.rotation.z = Math.PI / 4;
    arm1.position.y = 68;
    const arm2 = new THREE.Mesh(GEO.crossArm, crossMat);
    arm2.rotation.z = -Math.PI / 4;
    arm2.position.y = 68;
    errorCross = new THREE.Group();
    errorCross.add(arm1);
    errorCross.add(arm2);
    group.add(errorCross);
  }

  let ghostAura = null;
  if (isGhost && agent.status !== 'idle') {
    const gAuraMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff, transparent: true, opacity: 0.2,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    ghostAura = new THREE.Mesh(GEO.sphere24, gAuraMat);
    ghostAura.position.y = 20;
    group.add(ghostAura);
  }

  const eyeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${statusHue}, ${isOff ? 0 : 90}%, ${isOff ? 25 : 70}%)`),
    emissive: isOff ? new THREE.Color(0x111111) : new THREE.Color(`hsl(${statusHue}, 90%, 60%)`),
    emissiveIntensity: isOff ? 0 : 0.3,
  });
  const eye1 = new THREE.Mesh(GEO.sphere18, eyeMat);
  eye1.position.set(-2.5, 32.5, 5.5); group.add(eye1);
  const eye2 = new THREE.Mesh(GEO.sphere18, eyeMat);
  eye2.position.set(2.5, 32.5, 5.5); group.add(eye2);

  const beardMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${mHue}, ${40 * satFactor}%, ${isOff ? 30 : 50}%)`),
    roughness: 0.9, transparent: isGhost, opacity: bodyOpacity,
  });
  const beard = new THREE.Mesh(GEO.cone5x8, beardMat);
  beard.position.set(0, 28, 4); beard.rotation.x = 0.2;
  group.add(beard);

  const armMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${mHue}, ${55 * satFactor}%, ${isOff ? 16 : 28}%)`),
    roughness: 0.7, transparent: isGhost, opacity: bodyOpacity,
  });
  const armL = new THREE.Mesh(GEO.cy1x2x14, armMat);
  armL.position.set(-13, 18, 0); armL.rotation.z = 0.3;
  armL.name = 'armL';
  group.add(armL);
  const armR = new THREE.Mesh(GEO.cy1x2x14, armMat);
  armR.position.set(13, 18, 0); armR.rotation.z = -0.3;
  armR.name = 'armR';
  group.add(armR);

  const handMat = new THREE.MeshStandardMaterial({
    color: isGhost ? 0x88ccff : (isOff ? 0x777777 : 0xf0d0b0),
    roughness: 0.6, transparent: isGhost, opacity: Math.min(bodyOpacity + 0.15, 1),
  });
  const handL = new THREE.Mesh(GEO.sphere22h, handMat);
  handL.position.set(-2, -7, 0); armL.add(handL);
  const handR = new THREE.Mesh(GEO.sphere22h, handMat);
  handR.position.set(2, -7, 0); armR.add(handR);

  if (!isGhost) {
    const bookGroup = new THREE.Group();
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(`hsl(${mHue}, ${40 * satFactor}%, ${isOff ? 12 : 15}%)`),
      roughness: 0.8, metalness: isOff ? 0 : 0.3,
    });
    const pedBase = new THREE.Mesh(GEO.cy7x9x3, pedestalMat);
    pedBase.position.y = 0; bookGroup.add(pedBase);
    const pedColumn = new THREE.Mesh(GEO.cy4x5x10, pedestalMat);
    pedColumn.position.y = 6.5; bookGroup.add(pedColumn);
    const pedTop = new THREE.Mesh(GEO.cy8x8x1, pedestalMat);
    pedTop.position.y = 12; bookGroup.add(pedTop);
    const pedGlowMat = new THREE.MeshStandardMaterial({
      color: isOff ? new THREE.Color(0x222222) : glowColor,
      emissive: isOff ? new THREE.Color(0x000000) : glowColor,
      emissiveIntensity: isOff ? 0 : 0.15,
      transparent: true, opacity: isOff ? 0.05 : 0.3,
    });
    const pedRing = new THREE.Mesh(GEO.torus6x1, pedGlowMat);
    pedRing.position.y = 12.5; pedRing.rotation.x = Math.PI / 2;
    bookGroup.add(pedRing);

    const bookMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.9 });
    const bookCover = new THREE.Mesh(GEO.box14x2x10, bookMat);
    bookCover.position.y = 14.5; bookGroup.add(bookCover);
    const pageMat = new THREE.MeshStandardMaterial({ color: 0xfff8e0, roughness: 0.5 });
    const pages = new THREE.Mesh(GEO.box12x1x8, pageMat);
    pages.position.y = 16; bookGroup.add(pages);
    const runeGlowMat = new THREE.MeshStandardMaterial({
      color: isOff ? new THREE.Color(0x333333) : glowColor,
      emissive: isOff ? new THREE.Color(0x111111) : glowColor,
      emissiveIntensity: isOff ? 0 : 0.2,
      transparent: true, opacity: isOff ? 0.1 : 0.6,
    });
    const runePlate = new THREE.Mesh(GEO.box8x0x5, runeGlowMat);
    runePlate.position.y = 16.8; bookGroup.add(runePlate);

    bookGroup.position.set(0, 2, 16);
    bookGroup.userData = { baseY: 2, phase: Math.random() * Math.PI * 2 };
    group.add(bookGroup);
    group.userData.bookGroupRef = bookGroup;

    const auraMat = new THREE.MeshBasicMaterial({
      color: isOff ? new THREE.Color(0x222222) : glowColor,
      transparent: true, opacity: isOff ? 0 : 0.06,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const aura = new THREE.Mesh(GEO.sphere22, auraMat);
    aura.position.y = 20; group.add(aura);

    const glowLight = new THREE.PointLight(glowColor, isOff ? 0 : 0.4, 60);
    glowLight.position.y = 20; group.add(glowLight);

    const outerAuraMat = new THREE.MeshBasicMaterial({
      color: glowColor, transparent: true, opacity: 0.0,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const outerAura = new THREE.Mesh(GEO.sphere35, outerAuraMat);
    outerAura.position.y = 20; outerAura.visible = false;
    group.add(outerAura);

    const innerGlowMat = new THREE.MeshBasicMaterial({
      color: glowColor, transparent: true, opacity: 0.0,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const innerGlow = new THREE.Mesh(GEO.sphere20, innerGlowMat);
    innerGlow.position.y = 20; innerGlow.visible = false;
    group.add(innerGlow);

    const coreGlowMat = new THREE.MeshBasicMaterial({
      color: glowColor, transparent: true, opacity: 0.0,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const coreGlow = new THREE.Mesh(GEO.sphere12g, coreGlowMat);
    coreGlow.position.y = 20; coreGlow.visible = false;
    group.add(coreGlow);

    const groundRingMat = new THREE.MeshBasicMaterial({
      color: glowColor, transparent: true, opacity: 0.0,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const groundRing = new THREE.Mesh(GEO.ring8, groundRingMat);
    groundRing.rotation.x = -Math.PI / 2; groundRing.position.y = -1; groundRing.visible = false;
    group.add(groundRing);

    const energyRings = [];
    for (let ri = 0; ri < 6; ri++) {
      const rMat = new THREE.MeshBasicMaterial({
        color: glowColor, transparent: true, opacity: 0.0,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(GEO.ring2x8, rMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = -0.5; ring.visible = false;
      ring.userData = { phaseOffset: ri * 0.2 };
      group.add(ring); energyRings.push(ring);
    }

    const beamMat = new THREE.MeshBasicMaterial({
      color: glowColor, transparent: true, opacity: 0.0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(GEO.cy1x8x80, beamMat);
    beam.position.y = 85; beam.visible = false;
    group.add(beam);

    const runeCircleMat = new THREE.MeshBasicMaterial({
      color: glowColor, transparent: true, opacity: 0.0,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const runeCircle = new THREE.Mesh(GEO.ring12, runeCircleMat);
    runeCircle.rotation.x = -Math.PI / 2; runeCircle.position.y = -0.8; runeCircle.visible = false;
    group.add(runeCircle);

    const orbitOrbs = [];
    for (let oi = 0; oi < 6; oi++) {
      const oMat = new THREE.SpriteMaterial({
        map: getCharTexture('✦'), transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const orb = new THREE.Sprite(oMat);
      orb.scale.set(5, 5, 1); orb.visible = false;
      orb.userData = { angle: (oi / 6) * Math.PI * 2, radius: 18 + oi * 3, speed: 0.4 + oi * 0.1 };
      group.add(orb); orbitOrbs.push(orb);
    }

    Object.assign(group.userData, {
      aura, glowLight, outerAura, innerGlow, coreGlow, groundRing, energyRings, beam, runeCircle, orbitOrbs,
    });
  }

  group.userData = {
    ...group.userData,
    agentStatus: agent.status,
    isGhost,
    isOff,
    ghostAura,
    bobPhase: Math.random() * Math.PI * 2,
    glowColor,
    statusHue,
    tip,
    eyeMat,
    ringWavePhase: 0,
    glowBeatPhase: Math.random() * Math.PI * 2,
    targetPos: new THREE.Vector3(0, 0, 0),
    animEnter: 0,
    animExit: 0,
    agentId: agent.id || agent.pid,
    armL,
    armR,
    armBaseRotL: armL.rotation.z,
    armBaseRotR: armR.rotation.z,
    errorCross,
    _arcaneTimer: Math.random() * 1.5,
  };

  group.scale.set(1, 1, 1);
  return group;
}

// ─── BUILD LABEL ───
export function buildLabel(agent) {
  const div = document.createElement('div');
  div.style.cssText = `
    text-align: center;
    font-family: 'SF Mono', 'Consolas', monospace;
    pointer-events: none;
    transition: opacity 0.3s;
  `;

  const isGhost = agent.isExternal;
  const nameColor = isGhost ? 'rgba(0,229,255,0.6)' : 'rgba(255,255,255,0.8)';

  const nameEl = document.createElement('div');
  nameEl.style.cssText = `color: ${nameColor}; font-size: 13px; font-weight: 600; letter-spacing: 1px; text-shadow: 0 0 20px rgba(124,77,255,0.3);`;
  const displayName = agent.sessionTitle || agent.name || agent.agentName || (agent.id ? agent.id.slice(0, 10) : '?');
  nameEl.textContent = displayName;
  div.appendChild(nameEl);

  if (agent.toolName && agent.status === 'thinking') {
    const toolEl = document.createElement('div');
    toolEl.style.cssText = `color: rgba(0,229,255,0.5); font-size: 10px; letter-spacing: 0.5px; margin-top: 1px;`;
    toolEl.textContent = `⚡ ${agent.toolName}`;
    div.appendChild(toolEl);
  }

  const statusEl = document.createElement('div');
  const isOff = agent.status === 'off';
  const statusColor = agent.isExternal ? '#00e5ff' :
    isOff ? '#666' :
    agent.status === 'thinking' ? '#00e5ff' : agent.status === 'running' ? '#a855f7' : agent.status === 'error' ? '#ff4444' : '#7c4dff';
  const ghostSuffix = agent.sessionTitle ? '' : `(PID ${agent.pid || ''}) `;
  const statusText = agent.isExternal ?
    (isOff ? '⏻ apagado' :
     agent.status === 'thinking' ? `⟳ ${ghostSuffix}pensando` :
     agent.status === 'running' ? `⚡ ${ghostSuffix}trabajando` :
     agent.status === 'error' ? `✕ ${ghostSuffix}error` : `◉ ${ghostSuffix}idle`)
    : (isOff ? '⏻ apagado' :
    agent.status === 'thinking' ? '⟳ pensando' : agent.status === 'running' ? '⚡ trabajando' : agent.status === 'error' ? '✕ error' : '◉ idle');
  statusEl.style.cssText = `color: ${statusColor}; font-size: 9.5px; letter-spacing: 0.5px; opacity: 0.8; margin-top: 2px;`;
  statusEl.textContent = statusText;
  div.appendChild(statusEl);

  if (agent.isExternal && agent.lastMessage && agent.lastMessage.content && !agent.lastMessage.content.includes('Hermes externo')) {
    const previewEl = document.createElement('div');
    previewEl.style.cssText = `font-size: 8px; color: rgba(255,255,255,0.25); letter-spacing: 0.3px; margin-top: 1px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
    previewEl.textContent = agent.lastMessage.content.slice(0, 80) + (agent.lastMessage.content.length > 80 ? '…' : '');
    div.appendChild(previewEl);
  }

  const projectEl = document.createElement('div');
  projectEl.style.cssText = `font-size: 9px; color: rgba(255,255,255,0.2); letter-spacing: 1px; margin-top: 1px;`;
  projectEl.textContent = agent.projectName || '';
  div.appendChild(projectEl);

  const tagEl = document.createElement('div');
  const tagColor = isGhost ? 'rgba(0,229,255,0.4)' : (isOff ? 'rgba(100,100,100,0.4)' : 'rgba(124,77,255,0.5)');
  tagEl.style.cssText = `font-size: 9px; color: ${tagColor}; letter-spacing: 2px; margin-top: 1px;`;
  tagEl.textContent = isGhost ? '👻 HERMES GHOST' : (isOff ? '⏻ HERMES OFF' : (agent.isHermes ? '⚡ HERMES' : '✦ AGENT'));
  div.appendChild(tagEl);

  return new CSS2DObject(div);
}
