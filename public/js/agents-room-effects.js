// ─── AGENTS ROOM — VISUAL EFFECTS & CONSTANTS ───
// Reusable visual primitives: flame, char particles, arcane runes.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';


// ─── CHAR TEXTURE ───
export function getCharTexture(char) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.font = '48px "SF Mono", "Segoe UI", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(char, 32, 34);
  return new THREE.CanvasTexture(c);
}

// ─── FLAME ───
export function createFlame(hue, _projKey) {
  const flameGroup = new THREE.Group();
  flameGroup.name = 'flame';

  const flameColor = new THREE.Color(`hsl(${hue + 20}, 80%, 65%)`);
  const coreGeo = new THREE.ConeGeometry(5, 30, 8);
  const coreMat = new THREE.MeshBasicMaterial({
    color: flameColor, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.y = 18;
  core.name = 'flameCore';
  flameGroup.add(core);

  const glowColor = new THREE.Color(`hsl(${hue + 15}, 90%, 55%)`);
  const glowGeo = new THREE.SphereGeometry(6, 8, 8);
  const glowMat = new THREE.MeshBasicMaterial({
    color: glowColor, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.y = 8;
  glow.name = 'flameGlow';
  flameGroup.add(glow);

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const pGeo = new THREE.SphereGeometry(2, 4, 4);
    const pMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(`hsl(${hue + 10 + i * 5}, 90%, 70%)`),
      transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const particle = new THREE.Mesh(pGeo, pMat);
    particle.position.set(Math.cos(angle) * 6, 8 + Math.random() * 15, Math.sin(angle) * 6);
    particle.userData = { baseAngle: angle, baseRadius: 6, height: particle.position.y, speed: 0.8 + Math.random() * 1.5, phase: Math.random() * Math.PI * 2 };
    particle.name = 'flameParticle';
    flameGroup.add(particle);
  }

  flameGroup.userData._projKey = _projKey;
  flameGroup.userData.hue = hue;
  flameGroup.visible = false;
  return flameGroup;
}

export function updateFlameScale(flameGroup, activeAgentCount) {
  if (!flameGroup) return;
  const count = Math.max(0, activeAgentCount);
  if (count === 0) { flameGroup.visible = false; return; }

  flameGroup.visible = true;
  const targetScale = 0.8 + count * 0.4;
  const s = Math.min(targetScale, 3.5);

  const core = flameGroup.getObjectByName('flameCore');
  if (core) {
    core.userData._baseScale = s;
    core.scale.set(s, s, s);
    core.material.opacity = Math.min(0.5 + count * 0.15, 0.85);
  }

  const glowObj = flameGroup.getObjectByName('flameGlow');
  if (glowObj) {
    glowObj.scale.set(s * 0.8, s * 0.6, s * 0.8);
    glowObj.material.opacity = Math.min(0.3 + count * 0.12, 0.7);
  }

  flameGroup.children.forEach(child => {
    if (child.name === 'flameParticle') {
      child.scale.setScalar(0.7 + count * 0.2);
      child.material.opacity = Math.min(0.3 + count * 0.1, 0.7);
    }
  });
}

// ─── SPAWN CHAR PARTICLE ───
export function spawnCharParticle(magePos) {
  if (!window.__charParticleTexture) {
    const chars = ['✦', '◇', '⤡', '△', '✧', '⧡'];
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    const char = chars[Math.floor(Math.random() * chars.length)];
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px "SF Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(char, 16, 17);
    window.__charParticleTexture = new THREE.CanvasTexture(c);
  }

  const mat = new THREE.SpriteMaterial({
    map: window.__charParticleTexture, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
    color: new THREE.Color(`hsl(${Math.random() * 360}, 80%, 60%)`),
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.copy(magePos);
  const startScale = 3 + Math.random() * 6;
  sprite.scale.set(startScale, startScale, 1);

  return {
    sprite,
    vel: new THREE.Vector3(),
    life: 0,
    maxLife: 0.5 + Math.random() * 1.0,
    startScale,
  };
}

// ─── ARCANE BUBBLE CONSTANTS ───
const ARCANE_RUNES = ['ᚠ','ᚢ','ᚦ','ᚨ','ᚱ','ᚲ','ᚷ','ᚹ','ᚺ','ᚻ','ᚼ','ᚽ','ᚾ','ᚿ','ᛇ','ᛈ','ᛉ','ᛊ','ᛋ','ᛌ','ᛍ','ᛎ','ᛏ','ᛐ','ᛑ','ᛒ','ᛓ','ᛔ','ᛕ','ᛖ','ᛗ','ᛘ','ᛙ','ᛚ','ᛛ','ᛜ','ᛝ','ᛞ','ᛟ','ᛠ','ᛡ','ᛢ','ᛣ','ᛤ','ᛥ','ᛦ','ᛧ','ᛨ','ᛩ','ᛪ','᛫','᛬','᛭','ᛮ','ᛯ','ᛰ'];
const ARCANE_SYMBOLS = ['✦','◆','◇','▸','◈','○','⦿','⫷','⫸','⟐','⟑','⧡','⊛','⊚','⤡','⤢','⤣'];

const ARCANE_TOOL_WORDS = {
  'read_file': 'SCRYING',
  'write_file': 'INSCRIBE',
  'patch': 'TRANSFIGURE',
  'terminal': 'CHANNEL',
  'execute_code': 'WEAVE',
  'web_search': 'DIVINE',
  'search_files': 'SEEK',
  'memory': 'REMEMBER',
  'delegate_task': 'SUMMON',
  'browser_navigate': 'TRAVEL',
  'vision_analyze': 'PERCEIVE',
  'text_to_speech': 'SPEAK',
  'cronjob': 'ORDAIN',
  'process': 'ATTEND',
};

export { ARCANE_RUNES, ARCANE_SYMBOLS, ARCANE_TOOL_WORDS };
