// ─── AGENTS ROOM — ANIMATION LOOP ───
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { scene, camera, renderer, labelRenderer, controls, ambientParticles, ambientSpeeds, particleCount } from './agents-room-scene.js';
import { S } from './agents-room-state.js';
import { spawnCharParticle } from './agents-room-effects.js';
import { cleanupExitedAgents, spawnArcaneBubble } from './agents-room-scene-manager.js';

const clock = new THREE.Clock();

export function animate() {
  requestAnimationFrame(animate);

  const t = clock.getElapsedTime();
  const dt = Math.min(clock.getDelta(), 0.05);

  // Focus camera transition
  if (S.focusState && S.focusState.animating) {
    S.focusState.animT += dt * 0.8;
    const p = Math.min(S.focusState.animT, 1);
    const ease = 1 - Math.pow(1 - p, 3);

    const camTarget = new THREE.Vector3();
    S.focusState.mage.getWorldPosition(camTarget);
    camTarget.y += 20;

    const targetPos = new THREE.Vector3(
      camTarget.x + 70, camTarget.y + 25, camTarget.z + 70
    );

    if (p < 1) {
      camera.position.lerpVectors(S.focusState.initialCamPos, targetPos, ease);
      controls.target.lerpVectors(S.focusState.initialTarget, camTarget, ease);
    } else {
      camera.position.copy(targetPos);
      controls.target.copy(camTarget);
      S.focusState.animating = false;
    }
  }

  if (S.focusState && !S.focusState.animating) {
    const camTarget = new THREE.Vector3();
    S.focusState.mage.getWorldPosition(camTarget);
    camTarget.y += 20;
    controls.target.lerp(camTarget, 0.05);
  }

  // ─── ENTER/EXIT ANIMATIONS ───
  S.mageGroup.children.forEach((mage) => {
    if (!mage.userData) return;
    const ud = mage.userData;

    if (ud.animEnter > 0 && ud.animEnter < 1) {
      ud.animEnter = Math.min(ud.animEnter + dt * 3.0, 1);
      mage.scale.set(1, 1, 1);
      if (ud.aura) {
        ud.aura.material.opacity = ud.animEnter * 0.06;
      }
    }
    if (!ud.animExit && ud.animEnter >= 1) {
      mage.scale.set(1, 1, 1);
      if (ud.label) {
        ud.label.element.style.opacity = 1;
      }
    }

    if (ud.animExit > 0) {
      ud.animExit = Math.max(ud.animExit - dt * 2.0, 0);
      const s = 1 - Math.pow(1 - ud.animExit, 3);
      mage.scale.set(s, s, s);
      if (ud.label) {
        ud.label.element.style.opacity = ud.animExit;
      }
    }
  });

  // ─── Orbit agents ───
  S.mageGroup.children.forEach((mage) => {
    if (!mage.userData || !mage.userData.orbitCenter) return;
    if (mage.userData.animExit > 0 && mage.userData.animExit < 1) return;
    if (mage.userData.animEnter > 0 && mage.userData.animEnter < 1) return;

    const ud = mage.userData;
    ud.orbitAngle += dt * ud.orbitSpeed;
    const newX = ud.orbitCenter.x + Math.cos(ud.orbitAngle) * ud.orbitRadius;
    const newZ = ud.orbitCenter.z + Math.sin(ud.orbitAngle) * ud.orbitRadius;
    mage.position.x = newX;
    mage.position.z = newZ;
    mage.lookAt(ud.orbitCenter.x, mage.position.y, ud.orbitCenter.z);
    ud.targetPos.x = newX;
    ud.targetPos.z = newZ;
    if (ud.label) {
      ud.label.position.x = newX;
      ud.label.position.z = newZ;
    }
  });

  // ─── Mage animation ───
  S.mageGroup.children.forEach((mage, i) => {
    if (!mage.userData) return;
    const ud = mage.userData;
    const isGhost = ud.isGhost;

    if (ud.agentId && S.agentMap.has(ud.agentId)) {
      const entry = S.agentMap.get(ud.agentId);
      if (entry && entry.agentData && !entry.exiting) {
        ud.agentStatus = entry.agentData.status;
        ud.isOff = entry.agentData.status === 'off';
        ud._agentData = entry.agentData;
      }
    }

    const isOff = ud.isOff;
    const isActive = !isGhost && !isOff && (ud.agentStatus === 'running' || ud.agentStatus === 'thinking');

    // Bob
    const bobScale = isGhost ? 1.5 : (isOff ? 0.3 : 2);
    const bob = Math.sin(t * 0.6 + ud.bobPhase) * bobScale;
    mage.position.y = (mage.userData.targetPos?.y || 0) + bob;

    if (isGhost) {
      if (ud.ghostAura && ud.ghostAura.material) {
        ud.ghostAura.material.opacity = 0.06 + Math.sin(t * 0.8 + i) * 0.04;
        ud.ghostAura.scale.setScalar(1 + Math.sin(t * 0.5 + i * 0.7) * 0.1);
      }
      if (ud.tip) {
        ud.tip.material.emissiveIntensity = 0.1 + Math.sin(t * 1.5 + i * 1.3) * 0.1;
      }
      const ghostActive = ud.agentStatus === 'running' || ud.agentStatus === 'thinking';
      if (ghostActive && ud.armL && ud.armR) {
        const wave = Math.sin(t * 4.0 + i * 1.5);
        ud.armL.position.y = 18 + wave * 6;
        ud.armR.position.y = 18 - wave * 6;
        ud.armL.rotation.z = ud.armBaseRotL + wave * 0.5;
        ud.armR.rotation.z = ud.armBaseRotR - wave * 0.5;
      }
      return;
    }

    // Error cross
    if (ud.errorCross && ud.agentStatus === 'error') {
      ud.errorCross.visible = true;
      const pulse = 1 + Math.sin(t * 3.0) * 0.25;
      ud.errorCross.scale.setScalar(pulse);
      ud.errorCross.rotation.y += dt * 0.5;
      ud.errorCross.children.forEach(child => {
        if (child.material && child.material.emissiveIntensity !== undefined) {
          child.material.emissiveIntensity = 0.6 + Math.sin(t * 3.0) * 0.4;
        }
      });
    } else if (ud.errorCross) {
      ud.errorCross.visible = false;
    }

    // Book
    const bg = ud.bookGroupRef;
    if (bg) {
      bg.position.y = (bg.userData?.baseY || 2) + Math.sin(t * 0.8 + (bg.userData?.phase || 0)) * 2;
      bg.rotation.x = Math.sin(t * 0.4 + i) * 0.1;
      bg.rotation.z = Math.sin(t * 0.3 + i * 0.5) * 0.05;
    }

    // Aura
    const aura = ud.aura;
    if (aura) {
      if (isActive) {
        aura.material.opacity = 0.08 + Math.sin(t * 0.7 + i) * 0.06;
        aura.scale.setScalar(1 + Math.sin(t * 0.5 + i * 1.3) * 0.12);
      } else if (isOff) {
        aura.material.opacity = 0;
        aura.scale.setScalar(1);
      } else {
        aura.material.opacity = 0.04 + Math.sin(t * 0.5 + i) * 0.02;
        aura.scale.setScalar(1 + Math.sin(t * 0.3 + i) * 0.05);
      }
    }

    // Glow light
    const gl = ud.glowLight;
    if (gl) {
      if (isActive) gl.intensity = 1.2 + Math.sin(t * 0.9 + i * 1.5) * 0.6;
      else if (isOff) gl.intensity = 0;
      else gl.intensity = 0.3 + Math.sin(t * 0.7 + i * 1.2) * 0.15;
    }

    // Outer aura
    const oa = ud.outerAura;
    if (oa) {
      oa.visible = isActive;
      if (isActive) { oa.material.opacity = 0.08 + Math.sin(t * 0.4 + i) * 0.05; oa.scale.setScalar(1 + Math.sin(t * 0.3 + i * 0.7) * 0.12); }
    }

    // Inner glow
    const ig = ud.innerGlow;
    if (ig) {
      ig.visible = isActive;
      if (isActive) { const beat = Math.pow(Math.abs(Math.sin(t * 3.0 + ud.glowBeatPhase)), 4); ig.material.opacity = 0.15 + beat * 0.35; ig.scale.setScalar(1 + beat * 0.3); }
    }

    // Core glow
    const cg = ud.coreGlow;
    if (cg) {
      cg.visible = isActive;
      if (isActive) { const beat = Math.pow(Math.abs(Math.sin(t * 3.0 + ud.glowBeatPhase + 0.3)), 6); cg.material.opacity = 0.1 + beat * 0.5; cg.scale.setScalar(1 + beat * 0.5); }
    }

    // Orbit orbs
    const orbs = ud.orbitOrbs;
    if (orbs) {
      orbs.forEach(orb => {
        orb.visible = isActive;
        if (isActive) {
          const angle = orb.userData.angle + t * orb.userData.speed;
          const r = orb.userData.radius;
          orb.position.set(Math.cos(angle) * r, 20 + Math.sin(t * 0.7 + angle) * 8, Math.sin(angle) * r);
          orb.material.opacity = 0.4 + Math.sin(t * 2 + angle) * 0.3;
          const s = 5 + Math.sin(t * 1.5 + angle) * 2;
          orb.scale.set(s, s, 1);
        }
      });
    }

    // Ground ring
    const gr = ud.groundRing;
    if (gr) { gr.visible = isActive; if (isActive) { gr.material.opacity = 0.08 + Math.sin(t * 0.6 + i * 0.5) * 0.05; gr.scale.setScalar(1 + Math.sin(t * 0.4 + i) * 0.15); } }

    // Energy rings
    const rings = ud.energyRings;
    if (rings) {
      if (isActive) {
        ud.ringWavePhase = (ud.ringWavePhase || 0) + dt * 0.8;
        rings.forEach((ring, ri) => {
          const phase = (ud.ringWavePhase + ring.userData.phaseOffset) % 1;
          ring.visible = true;
          ring.scale.setScalar(1 + phase * 14);
          ring.material.opacity = (1 - phase) * 0.18;
        });
      } else rings.forEach(r => { r.visible = false; });
    }

    // Beam
    const bm = ud.beam;
    if (bm) { bm.visible = isActive; if (isActive) { bm.material.opacity = 0.05 + Math.sin(t * 0.5 + i * 0.7) * 0.035; bm.scale.x = 1 + Math.sin(t * 0.8 + i) * 0.4; bm.scale.z = 1 + Math.sin(t * 0.8 + i) * 0.4; } }

    // Rune circle
    const rc = ud.runeCircle;
    if (rc) { rc.visible = isActive; if (isActive) { rc.material.opacity = 0.07 + Math.sin(t * 0.5 + i * 0.5) * 0.045; rc.rotation.z = t * 0.15 + i * 1.5; } }

    // Arm animation
    if (isActive && ud.armL && ud.armR) {
      const armWave = Math.sin(t * 4.0 + i * 1.5);
      ud.armL.position.y = 18 + armWave * 8;
      ud.armR.position.y = 18 - armWave * 8;
      ud.armL.rotation.z = ud.armBaseRotL + armWave * 0.6;
      ud.armR.rotation.z = ud.armBaseRotR - armWave * 0.6;
    }

    // Character particles from top
    if (isActive && S.mageParticles[i] && Math.random() < 0.7) {
      const worldPos = new THREE.Vector3();
      mage.getWorldPosition(worldPos);
      worldPos.y += 56;
      worldPos.x += (Math.random() - 0.5) * 4;
      worldPos.z += (Math.random() - 0.5) * 4;
      const p = spawnCharParticle(worldPos);
      const spreadAngle = Math.random() * Math.PI * 1.2 - Math.PI * 0.6;
      const speed = 1.5 + Math.random() * 3.0;
      p.vel.set(Math.cos(spreadAngle) * speed * 0.5, 2.0 + Math.random() * 4.0, Math.sin(spreadAngle) * speed * 0.5);
      p.sprite.scale.setScalar(p.startScale * 1.3);
      p.sprite.material.rotation = Math.random() * Math.PI;
      scene.add(p.sprite);
      if (S.mageParticles[i]) S.mageParticles[i].particles.push(p);
    }

    // Character particles from hands
    if (isActive && S.mageParticles[i] && Math.random() < 0.3) {
      const handPos = new THREE.Vector3();
      mage.getWorldPosition(handPos);
      handPos.set(handPos.x + (Math.random() > 0.5 ? 16 : -16), handPos.y + 14, handPos.z);
      const p = spawnCharParticle(handPos);
      p.vel.set((Math.random() - 0.5) * 4, 0.5 + Math.random() * 1.5, (Math.random() - 0.5) * 4);
      p.sprite.scale.setScalar(p.startScale * 0.8);
      scene.add(p.sprite);
      if (S.mageParticles[i]) S.mageParticles[i].particles.push(p);
    }

    // Arcane bubble spawning
    if (isActive && !isGhost) {
      ud._arcaneTimer -= dt;
      if (ud._arcaneTimer <= 0) {
        ud._arcaneTimer = 1.5 + Math.random() * 2.0;
        const agentData = ud._agentData || {};
        if (S.arcaneBubbles.length < 30) {
          spawnArcaneBubble(mage, agentData);
        }
      }
    }
  });

  // Update particles
  for (let i = 0; i < S.mageParticles.length; i++) {
    const entry = S.mageParticles[i];
    if (!entry) continue;
    for (let pIdx = entry.particles.length - 1; pIdx >= 0; pIdx--) {
      const p = entry.particles[pIdx];
      p.life += dt;
      p.sprite.position.x += p.vel.x * dt * 36;
      p.sprite.position.y += p.vel.y * dt * 36;
      p.sprite.position.z += p.vel.z * dt * 36;
      p.vel.y -= 0.6 * dt;
      const lifeRatio = p.life / p.maxLife;
      p.sprite.material.opacity = lifeRatio > 0.6 ? (1 - lifeRatio) * 2.5 : 1 - lifeRatio;
      p.sprite.scale.setScalar(p.startScale * (1 - lifeRatio * 0.6));
      if (p.sprite.material.rotation !== undefined) p.sprite.material.rotation += dt * 3;
      if (lifeRatio >= 1) {
        scene.remove(p.sprite);
        if (p.sprite.material) p.sprite.material.dispose();
        entry.particles.splice(pIdx, 1);
      }
    }
    while (entry.particles.length > 200) {
      const p = entry.particles.shift();
      scene.remove(p.sprite);
      if (p.sprite.material) p.sprite.material.dispose();
    }
  }

  // Ambient particles
  const positions = ambientParticles.geometry.attributes.position.array;
  for (let i = 0; i < particleCount; i++) {
    positions[i*3+1] += Math.sin(t * ambientSpeeds[i] + i * 0.1) * 0.05;
    if (positions[i*3+1] > 180) positions[i*3+1] = 10;
    if (positions[i*3+1] < 5) positions[i*3+1] = 150;
  }
  ambientParticles.geometry.attributes.position.needsUpdate = true;

  // Floor runes animation
  S.floorGroup.children.forEach(floor => {
    floor.children.forEach(child => {
      if (child.isSprite && child.userData) {
        const ud = child.userData;
        child.position.y = ud.yBase + Math.sin(t * ud.speed + ud.phase) * 3;
        child.material.rotation = t * 0.1;
      }
      if (child.name === 'flameParticle' && child.userData) {
        const fd = child.userData;
        const wobble = Math.sin(t * fd.speed + fd.phase) * 3;
        child.position.y = fd.height + wobble;
        const angle = fd.baseAngle + t * 0.5;
        child.position.x = Math.cos(angle) * (fd.baseRadius + Math.sin(t * 1.2) * 2);
        child.position.z = Math.sin(angle) * (fd.baseRadius + Math.cos(t * 0.9) * 2);
      }
    });
    const flame = floor.userData && floor.userData.flame;
    if (flame && flame.visible) {
      const core = flame.getObjectByName('flameCore');
      if (core) {
        core.rotation.y += dt * 0.5;
        const baseScale = core.userData._baseScale || core.scale.y;
        const coreWobble = 1 + Math.sin(t * 2.5) * 0.08;
        core.scale.setX(baseScale * coreWobble);
        core.scale.setY(baseScale);
        core.scale.setZ(baseScale * coreWobble);
      }
      const glowObj = flame.getObjectByName('flameGlow');
      if (glowObj) {
        glowObj.material.opacity = glowObj.material.opacity * 0.95 + (0.3 + Math.sin(t * 1.8) * 0.1) * 0.05;
      }
    }
  });

  // Arcane bubble animation
  const now = performance.now() / 1000;
  for (let b = S.arcaneBubbles.length - 1; b >= 0; b--) {
    const bubble = S.arcaneBubbles[b];
    const age = now - bubble.born;
    const lifeRatio = age / bubble.life;

    if (lifeRatio >= 1) {
      scene.remove(bubble.el);
      if (bubble.el.element) bubble.el.element.remove();
      S.removeArcaneBubble(b);
      continue;
    }

    if (bubble.mageRef) {
      const magePos = new THREE.Vector3();
      bubble.mageRef.getWorldPosition(magePos);
      bubble.el.position.x = magePos.x;
      bubble.el.position.z = magePos.z;
      const floatY = bubble.baseY + lifeRatio * 70;
      bubble.el.position.y = floatY;
    }

    let opacity;
    if (lifeRatio < 0.15) {
      opacity = lifeRatio / 0.15;
    } else if (lifeRatio > 0.65) {
      opacity = 1 - (lifeRatio - 0.65) / 0.35;
    } else {
      opacity = 1;
    }
    bubble.el.element.style.opacity = opacity;
    const scale = lifeRatio < 0.2 ? 0.5 + lifeRatio * 2.5 : 1 - (lifeRatio - 0.2) * 0.3;
    bubble.el.element.style.transform = `translate(-50%, 0) scale(${Math.max(0.5, Math.min(1.1, scale))})`;
  }

  controls.update();

  // Periodic cleanup
  S.incCleanupFrameCounter();
  if (S.cleanupFrameCounter > 60) {
    S.setCleanupFrameCounter(0);
    cleanupExitedAgents();
  }

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
