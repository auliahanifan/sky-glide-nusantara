import * as THREE from 'three';
import { getStageSpec } from '../data/catalog';
import type { ParticleSystem } from '../graphics/ParticleSystem';
import type { WorldBuilder } from '../graphics/WorldBuilder';
import type { Difficulty, StageId } from '../types/game';
import type { DebrisSystem } from './DebrisSystem';

export interface BossProjectile {
  mesh: THREE.Group;
  coreMesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  deflected: boolean;
  grazeAwarded: boolean;
  alive: boolean;
}

export interface BossChargeRing {
  mesh: THREE.Group;
  position: THREE.Vector3;
  collected: boolean;
  active: boolean;
}

export interface PlayerBolt {
  mesh: THREE.Group;
  position: THREE.Vector3;
  damage: number;
  alive: boolean;
}

export interface BossBeam {
  mesh: THREE.Group;
  coreMat: THREE.MeshBasicMaterial;
  sheathMat: THREE.MeshBasicMaterial;
  yPos: number;
  timer: number;
  active: boolean;
  hitPlayer: boolean;
  grazeAwarded: boolean;
  alive: boolean;
}

export interface BossStepCallbacks {
  onBossHit: (damage: number, defeated: boolean) => void;
  onPlayerHit: (sourcePos: THREE.Vector3) => void;
  onGraze: (pos: THREE.Vector3) => void;
  onDeflect: (pos: THREE.Vector3) => void;
  onChargeRing: (isBullseye: boolean) => void;
}

interface BossRigEntry {
  root: THREE.Group;
  coreMesh: THREE.Mesh;
  coreMat: THREE.MeshStandardMaterial;
  spinnerA: THREE.Object3D;
  spinnerB: THREE.Object3D;
}

export class BossController {
  private readonly scene: THREE.Scene;
  private readonly builder: WorldBuilder;
  private readonly particles: ParticleSystem;
  private readonly debris: DebrisSystem;

  private readonly bossRigs = new Map<StageId, BossRigEntry>();
  private currentRig: BossRigEntry | null = null;

  readonly position = new THREE.Vector3();
  private active = false;
  private stageId: StageId = 1;
  private difficulty: Difficulty = 'normal';
  private name = '';
  private hp = 6;
  private maxHp = 6;
  private hitFlash = 0;
  private elapsed = 0;
  private orbTimer = 1.4;
  private chargeRingTimer = 1.8;
  private beamTimer = 4.2;

  private readonly projectiles: BossProjectile[] = [];
  private readonly chargeRings: BossChargeRing[] = [];
  private readonly playerBolts: PlayerBolt[] = [];
  private readonly beams: BossBeam[] = [];

  // Shared projectile & beam geometries/materials
  private readonly projCoreGeo = new THREE.OctahedronGeometry(0.85, 1);
  private readonly projNormalMat = new THREE.MeshBasicMaterial({ color: 0xff2a85 });
  private readonly projDeflectedMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
  private readonly projGlowMat: THREE.SpriteMaterial;
  private readonly beamCoreGeo = new THREE.BoxGeometry(44, 0.55, 0.55);
  private readonly beamSheathGeo = new THREE.BoxGeometry(44, 1.45, 1.45);
  private readonly sharedArmorMat: THREE.MeshStandardMaterial;

  // Scratch vectors
  private readonly tmpVecA = new THREE.Vector3();
  private readonly tmpVecB = new THREE.Vector3();
  private readonly tmpVecC = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    builder: WorldBuilder,
    particles: ParticleSystem,
    debris: DebrisSystem
  ) {
    this.scene = scene;
    this.builder = builder;
    this.particles = particles;
    this.debris = debris;

    const textures = builder.getTextures();
    this.projGlowMat = new THREE.SpriteMaterial({
      map: textures.softGlow,
      color: 0xff2a85,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.sharedArmorMat = new THREE.MeshStandardMaterial({
      map: textures.hullPBR.map,
      normalMap: textures.hullPBR.normalMap,
      roughnessMap: textures.hullPBR.roughnessMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: 0x263449,
      roughness: 0.28,
      metalness: 0.85
    });

    this.prewarmPools();
  }

  private prewarmPools(): void {
    for (const sid of [1, 2, 3, 4] as StageId[]) {
      this.getOrBuildRig(sid);
    }
    for (let i = 0; i < 10; i++) {
      this.projectiles.push(this.createProjectileEntry());
    }
    for (let i = 0; i < 6; i++) {
      const mesh = this.builder.createCyberRing('charge');
      mesh.visible = false;
      this.scene.add(mesh);
      this.chargeRings.push({
        mesh,
        position: new THREE.Vector3(),
        collected: false,
        active: false
      });
    }
    for (let i = 0; i < 8; i++) {
      const mesh = this.builder.createPlasmaBolt(0x00f0ff);
      mesh.visible = false;
      this.scene.add(mesh);
      this.playerBolts.push({
        mesh,
        position: new THREE.Vector3(),
        damage: 1,
        alive: false
      });
    }
    for (let i = 0; i < 3; i++) {
      this.beams.push(this.createBeamEntry());
    }
  }

  private createProjectileEntry(): BossProjectile {
    const grp = new THREE.Group();
    const core = new THREE.Mesh(this.projCoreGeo, this.projNormalMat);
    const glow = new THREE.Sprite(this.projGlowMat);
    glow.scale.setScalar(3.4);
    grp.add(core, glow);
    grp.visible = false;
    this.scene.add(grp);
    return {
      mesh: grp,
      coreMesh: core,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      deflected: false,
      grazeAwarded: false,
      alive: false
    };
  }

  private createBeamEntry(): BossBeam {
    const grp = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffd000,
      transparent: true,
      opacity: 0.45
    });
    const sheathMat = new THREE.MeshBasicMaterial({
      color: 0xff0055,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const core = new THREE.Mesh(this.beamCoreGeo, coreMat);
    const sheath = new THREE.Mesh(this.beamSheathGeo, sheathMat);
    grp.add(core, sheath);
    grp.visible = false;
    this.scene.add(grp);
    return {
      mesh: grp,
      coreMat,
      sheathMat,
      yPos: 0,
      timer: 0,
      active: false,
      hitPlayer: false,
      grazeAwarded: false,
      alive: false
    };
  }

  isActive(): boolean {
    return this.active;
  }

  getName(): string {
    return this.name;
  }

  getHpRatio(): number {
    return this.maxHp > 0 ? Math.max(0, this.hp / this.maxHp) : 0;
  }

  isPhase2(): boolean {
    return this.active && this.hp <= this.maxHp * 0.5;
  }

  clear(): void {
    this.active = false;
    if (this.currentRig) {
      this.currentRig.root.visible = false;
      this.currentRig = null;
    }
    for (const p of this.projectiles) {
      p.alive = false;
      p.mesh.visible = false;
    }
    for (const r of this.chargeRings) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const b of this.playerBolts) {
      b.alive = false;
      b.mesh.visible = false;
    }
    for (const bm of this.beams) {
      bm.alive = false;
      bm.mesh.visible = false;
    }
  }

  spawn(stageId: StageId, difficulty: Difficulty, playerZ: number, endlessWave = 0): void {
    this.clear();
    this.active = true;
    this.stageId = stageId;
    this.difficulty = difficulty;
    const spec = getStageSpec(stageId);
    this.name = endlessWave > 0 ? `${spec.bossName} MK.${endlessWave + 1}` : spec.bossName;
    const diffExtra = difficulty === 'overclocked' ? 3 : 0;
    this.maxHp = spec.bossHp + diffExtra + endlessWave * 2;
    this.hp = this.maxHp;
    this.hitFlash = 0;
    this.elapsed = 0;
    this.orbTimer = 1.5;
    this.chargeRingTimer = 1.1;
    this.beamTimer = 3.8;

    this.position.set(0, 2.5, playerZ - 42);
    const rig = this.getOrBuildRig(stageId);
    rig.root.position.copy(this.position);
    rig.root.visible = true;
    this.currentRig = rig;
  }

  firePlayerBolt(origin: THREE.Vector3, damage = 1, colorHex = 0x00f0ff): void {
    if (!this.active) return;
    let slot = this.playerBolts.find((b) => !b.alive);
    if (!slot) {
      const mesh = this.builder.createPlasmaBolt(colorHex);
      this.scene.add(mesh);
      slot = { mesh, position: new THREE.Vector3(), damage, alive: true };
      this.playerBolts.push(slot);
    }
    this.builder.setPlasmaBoltColor(slot.mesh, colorHex);
    slot.position.copy(origin);
    slot.mesh.position.copy(origin);
    slot.damage = damage;
    slot.alive = true;
    slot.mesh.visible = true;
  }

  applyDirectDamage(damage: number, cb: BossStepCallbacks): void {
    if (!this.active) return;
    this.damageBoss(damage, cb);
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    forwardSpeed: number,
    isRolling: boolean,
    isInvulnerableSmash: boolean,
    bullseyeRadius: number,
    grazeRadius: number,
    cb: BossStepCallbacks
  ): void {
    if (!this.active || !this.currentRig) return;
    this.elapsed += dt;
    const phase2 = this.isPhase2();
    const overclockMult = this.difficulty === 'overclocked' ? 1.25 : 1.0;
    const rig = this.currentRig;

    // 1. Boss weaves 36 units ahead of player
    const targetZ = playerPos.z - 36;
    const targetX = Math.sin(this.elapsed * (phase2 ? 1.5 : 1.0)) * 10.5;
    const targetY = 2.0 + Math.cos(this.elapsed * (phase2 ? 1.9 : 1.3)) * 4.2;
    const weaveAlpha = 1 - Math.exp(-dt * 3.5);
    this.position.x = THREE.MathUtils.lerp(this.position.x, targetX, weaveAlpha);
    this.position.y = THREE.MathUtils.lerp(this.position.y, targetY, weaveAlpha);
    this.position.z = targetZ;

    rig.root.position.copy(this.position);
    rig.spinnerA.rotation.z += dt * (phase2 ? 3.2 : 1.6);
    rig.spinnerB.rotation.z -= dt * (phase2 ? 2.4 : 1.1);
    const pulse = 1 + Math.sin(this.elapsed * 7) * 0.06;
    rig.coreMesh.scale.setScalar(pulse);

    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      rig.coreMat.emissive.setHex(0xffffff);
      rig.coreMat.emissiveIntensity = 3.2;
    } else {
      rig.coreMat.emissive.setHex(phase2 ? 0xff0044 : getStageSpec(this.stageId).primaryColor);
      rig.coreMat.emissiveIntensity = 2.0;
    }

    // 2. Spawn Boss Plasma Orbs
    this.orbTimer -= dt * overclockMult;
    if (this.orbTimer <= 0) {
      this.orbTimer = phase2 ? 1.15 : 1.65;
      const count = phase2 && this.stageId >= 2 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        this.spawnProjectile(
          playerPos,
          forwardSpeed,
          i === 1 ? (Math.random() > 0.5 ? 5.5 : -5.5) : 0
        );
      }
    }

    // 3. Spawn Charge Rings
    this.chargeRingTimer -= dt;
    if (this.chargeRingTimer <= 0) {
      this.chargeRingTimer = phase2 ? 1.9 : 2.35;
      let slot = this.chargeRings.find((r) => !r.active);
      if (!slot) {
        const mesh = this.builder.createCyberRing('charge');
        this.scene.add(mesh);
        slot = { mesh, position: new THREE.Vector3(), collected: false, active: true };
        this.chargeRings.push(slot);
      }
      slot.position.set(
        THREE.MathUtils.clamp((Math.random() - 0.5) * 22, -13, 13),
        THREE.MathUtils.clamp(-2 + Math.random() * 9, -4.5, 8.5),
        playerPos.z - 68
      );
      slot.mesh.position.copy(slot.position);
      slot.mesh.rotation.set(0, 0, 0);
      slot.collected = false;
      slot.active = true;
      slot.mesh.visible = true;
    }

    // 4. Periodic Sweeping Laser Beam
    if (this.stageId >= 2 || phase2) {
      this.beamTimer -= dt * overclockMult;
      if (this.beamTimer <= 0) {
        this.beamTimer = phase2 ? 4.2 : 5.6;
        this.spawnBeam(playerPos);
      }
    }

    // 5. Update Charge Rings
    for (const r of this.chargeRings) {
      if (!r.active) continue;
      r.mesh.rotation.z += dt * 1.4;
      if (!r.collected) {
        const dz = Math.abs(r.position.z - playerPos.z);
        if (dz < 2.4) {
          const dxy = Math.hypot(r.position.x - playerPos.x, r.position.y - playerPos.y);
          if (dxy < 3.6) {
            r.collected = true;
            r.mesh.visible = false;
            const bullseye = dxy < bullseyeRadius;
            this.particles.emitBurst(r.position, bullseye ? 0xffd000 : 0x00f0ff, 22, 8.5);
            this.firePlayerBolt(playerPos, bullseye ? 2 : 1, bullseye ? 0xffd000 : 0x00f0ff);
            cb.onChargeRing(bullseye);
          }
        }
      }
      if (r.position.z > playerPos.z + 20) {
        r.active = false;
        r.mesh.visible = false;
      }
    }

    // 6. Update Boss Projectiles
    for (const p of this.projectiles) {
      if (!p.alive) continue;

      if (p.deflected) {
        this.tmpVecA
          .copy(this.position)
          .sub(p.position)
          .normalize()
          .multiplyScalar(forwardSpeed * 2.4 + 48);
        p.position.addScaledVector(this.tmpVecA, dt);
        p.mesh.position.copy(p.position);
        if (p.position.distanceTo(this.position) < 4.5) {
          p.alive = false;
          p.mesh.visible = false;
          this.particles.emitBurst(this.position, 0x00f0ff, 28, 10);
          this.damageBoss(2, cb);
          if (!this.active) return;
        }
      } else {
        p.position.addScaledVector(p.velocity, dt);
        p.mesh.position.copy(p.position);
        p.mesh.rotation.x += dt * 5;
        p.mesh.rotation.y += dt * 4;

        const dist = p.position.distanceTo(playerPos);
        if (dist < 2.35 && (isRolling || isInvulnerableSmash)) {
          p.deflected = true;
          p.coreMesh.material = this.projDeflectedMat;
          this.particles.emitBurst(p.position, 0x00f0ff, 20, 8);
          cb.onDeflect(p.position);
        } else if (dist < 1.65) {
          p.alive = false;
          p.mesh.visible = false;
          cb.onPlayerHit(p.position);
        } else if (!p.grazeAwarded && dist < grazeRadius && p.position.z > playerPos.z - 2) {
          p.grazeAwarded = true;
          cb.onGraze(p.position);
        } else if (p.position.z > playerPos.z + 25) {
          p.alive = false;
          p.mesh.visible = false;
        }
      }
    }

    // 7. Update Homing Player Plasma Bolts
    for (const b of this.playerBolts) {
      if (!b.alive) continue;
      this.tmpVecA.copy(this.position).sub(b.position).normalize();
      b.position.addScaledVector(this.tmpVecA, (forwardSpeed + 65) * dt);
      b.mesh.position.copy(b.position);
      b.mesh.lookAt(this.position);

      if (b.position.distanceTo(this.position) < 4.6) {
        b.alive = false;
        b.mesh.visible = false;
        this.particles.emitBurst(this.position, 0xffd000, 26, 9);
        this.damageBoss(b.damage, cb);
        if (!this.active) return;
      }
    }

    // 8. Update Sweeping Laser Beams
    for (const bm of this.beams) {
      if (!bm.alive) continue;
      bm.timer += dt;
      bm.mesh.position.z = playerPos.z - 14;

      if (bm.timer < 0.85) {
        bm.active = false;
        bm.coreMat.color.setHex(0xffd000);
        bm.coreMat.opacity = 0.35 + Math.sin(bm.timer * 28) * 0.25;
        bm.sheathMat.opacity = 0.15;
        bm.mesh.scale.set(1, 0.18, 0.18);
      } else if (bm.timer < 1.65) {
        bm.active = true;
        bm.coreMat.color.setHex(0xffffff);
        bm.coreMat.opacity = 0.96;
        bm.sheathMat.color.setHex(0xff0055);
        bm.sheathMat.opacity = 0.52;
        bm.mesh.scale.set(1, 1.0, 1.0);
        bm.mesh.position.z = playerPos.z;

        const dy = Math.abs(playerPos.y - bm.yPos);
        if (!bm.hitPlayer && dy < 1.35) {
          bm.hitPlayer = true;
          if (!isInvulnerableSmash) {
            this.tmpVecA.set(playerPos.x, bm.yPos, playerPos.z);
            cb.onPlayerHit(this.tmpVecA);
          }
        } else if (!bm.grazeAwarded && !bm.hitPlayer && dy < 2.8) {
          bm.grazeAwarded = true;
          cb.onGraze(playerPos);
        }
      } else {
        bm.alive = false;
        bm.mesh.visible = false;
      }
    }
  }

  private damageBoss(dmg: number, cb: BossStepCallbacks): void {
    if (!this.active) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.hitFlash = 0.14;
    const defeated = this.hp <= 0;
    const spec = getStageSpec(this.stageId);
    this.tmpVecC.set(0, 0, -25);
    this.debris.spawnExplosion(
      this.position,
      this.tmpVecC,
      spec.primaryColor,
      0x1e293b,
      defeated ? 34 : 8,
      defeated ? 22 : 12
    );
    cb.onBossHit(dmg, defeated);

    if (defeated) {
      this.particles.emitBurst(this.position, 0xffd000, 72, 17);
      this.particles.emitBurst(this.position, 0xff2a85, 56, 15);
      this.clear();
    }
  }

  private spawnProjectile(playerPos: THREE.Vector3, forwardSpeed: number, offsetX: number): void {
    let slot = this.projectiles.find((p) => !p.alive);
    if (!slot) {
      slot = this.createProjectileEntry();
      this.projectiles.push(slot);
    }

    this.tmpVecA.copy(this.position);
    this.tmpVecA.x += offsetX;
    this.tmpVecA.z += 2.2;

    this.tmpVecB.set(playerPos.x * 0.72 + offsetX * 0.6, playerPos.y, playerPos.z - 6);
    this.tmpVecB.sub(this.tmpVecA).normalize();
    const speed = Math.max(16, forwardSpeed * 0.48);

    slot.position.copy(this.tmpVecA);
    slot.mesh.position.copy(this.tmpVecA);
    slot.mesh.rotation.set(0, 0, 0);
    slot.velocity.set(this.tmpVecB.x * speed, this.tmpVecB.y * speed, 18);
    slot.coreMesh.material = this.projNormalMat;
    slot.deflected = false;
    slot.grazeAwarded = false;
    slot.alive = true;
    slot.mesh.visible = true;
  }

  private spawnBeam(playerPos: THREE.Vector3): void {
    let slot = this.beams.find((bm) => !bm.alive);
    if (!slot) {
      slot = this.createBeamEntry();
      this.beams.push(slot);
    }

    const yPos = THREE.MathUtils.clamp(playerPos.y, -4.5, 8.5);
    slot.yPos = yPos;
    slot.timer = 0;
    slot.active = false;
    slot.hitPlayer = false;
    slot.grazeAwarded = false;
    slot.alive = true;
    slot.mesh.position.set(0, yPos, playerPos.z - 14);
    slot.mesh.scale.set(1, 0.18, 0.18);
    slot.mesh.visible = true;
  }

  private getOrBuildRig(stageId: StageId): BossRigEntry {
    const existing = this.bossRigs.get(stageId);
    if (existing) return existing;

    const spec = getStageSpec(stageId);
    const primaryHex = spec.primaryColor;
    const secondaryHex = spec.secondaryColor;
    const textures = this.builder.getTextures();

    const grp = new THREE.Group();
    grp.visible = false;

    const coreMat = new THREE.MeshStandardMaterial({
      color: primaryHex,
      emissive: primaryHex,
      emissiveIntensity: 2.0,
      roughness: 0.14,
      metalness: 0.35
    });
    const secMat = new THREE.MeshStandardMaterial({
      color: secondaryHex,
      emissive: secondaryHex,
      emissiveIntensity: 1.65,
      roughness: 0.2,
      metalness: 0.55
    });

    const coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(2.2, 1), coreMat);
    const coreGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: textures.softGlow,
        color: primaryHex,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    coreGlow.scale.setScalar(9.5);
    grp.add(coreMesh, coreGlow);

    const spinA = new THREE.Group();
    const spinB = new THREE.Group();

    if (stageId === 1) {
      const ringA = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.48, 12, 28), this.sharedArmorMat);
      ringA.castShadow = true;
      spinA.add(ringA);
      for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.2, 0.85), this.sharedArmorMat);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.9, 0.92), secMat);
        fin.add(strip);
        const a = (i * Math.PI) / 2;
        fin.position.set(Math.cos(a) * 5.2, Math.sin(a) * 5.2, 0);
        fin.rotation.z = a;
        fin.castShadow = true;
        spinA.add(fin);
      }
    } else if (stageId === 2) {
      const ringA = new THREE.Mesh(new THREE.TorusGeometry(4.8, 0.52, 10, 20), secMat);
      spinA.add(ringA);
      for (let i = 0; i < 6; i++) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 1.4), this.sharedArmorMat);
        const a = (i / 6) * Math.PI * 2;
        plate.position.set(Math.cos(a) * 5.6, Math.sin(a) * 5.6, 0);
        plate.rotation.z = a;
        plate.castShadow = true;
        spinB.add(plate);
      }
    } else if (stageId === 3) {
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(6.8, 1.5, 2.2), this.sharedArmorMat);
        wing.position.set(side * 4.8, 0, 0);
        wing.rotation.z = side * 0.25;
        wing.castShadow = true;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(1.0, 3.2, 8), secMat);
        tip.rotation.z = (-side * Math.PI) / 2;
        tip.position.set(side * 8.4, 0.8, 0);
        grp.add(wing, tip);
      }
      spinA.add(new THREE.Mesh(new THREE.TorusGeometry(3.8, 0.35, 10, 24), coreMat));
    } else {
      const frameA = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.42, 8, 4), secMat);
      const frameB = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.36, 8, 6), this.sharedArmorMat);
      frameB.castShadow = true;
      spinA.add(frameA);
      spinB.add(frameB);
    }

    grp.add(spinA, spinB);
    this.scene.add(grp);

    const entry: BossRigEntry = {
      root: grp,
      coreMesh,
      coreMat,
      spinnerA: spinA,
      spinnerB: spinB
    };
    this.bossRigs.set(stageId, entry);
    return entry;
  }
}
