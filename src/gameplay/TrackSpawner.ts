import * as THREE from 'three';
import type { WorldBuilder } from '../graphics/WorldBuilder';
import type { Difficulty, GameMode, StageId } from '../types/game';
import { createSeededRng } from '../utils/prng';

export interface RingEntity {
  kind: 'normal' | 'warp';
  poolKey: string;
  mesh: THREE.Group;
  position: THREE.Vector3;
  collected: boolean;
}

export interface StarEntity {
  poolKey: string;
  mesh: THREE.Group;
  position: THREE.Vector3;
  collected: boolean;
}

export interface PickupEntity {
  kind: 'heart' | 'shield' | 'frenzy' | 'overcharge';
  poolKey: string;
  mesh: THREE.Group;
  position: THREE.Vector3;
  collected: boolean;
}

export interface HazardEntity {
  poolKey: string;
  mesh: THREE.Group;
  position: THREE.Vector3;
  radius: number;
  baseX: number;
  driftAmp: number;
  driftFreq: number;
  phase: number;
  hit: boolean;
  grazeAwarded: boolean;
}

export interface LaserGateEntity {
  poolKey: string;
  mesh: THREE.Group;
  orientation: 'horizontal' | 'vertical';
  gapCenter: number;
  gapHalf: number;
  z: number;
  hit: boolean;
  grazeAwarded: boolean;
}

export interface PylonEntity {
  poolKey: string;
  mesh: THREE.Group;
  position: THREE.Vector3;
  radius: number;
  grazeAwarded: boolean;
}

export interface ThermalEntity {
  poolKey: string;
  mesh: THREE.Group;
  position: THREE.Vector3;
  radius: number;
  triggered: boolean;
}

export interface SlipstreamEntity {
  poolKey: string;
  mesh: THREE.Group;
  position: THREE.Vector3;
  length: number;
  radius: number;
  entered: boolean;
}

export interface ScoutDroneEntity {
  poolKey: string;
  mesh: THREE.Group;
  position: THREE.Vector3;
  baseX: number;
  baseY: number;
  driftAmp: number;
  driftFreq: number;
  phase: number;
  radius: number;
  hp: number;
  destroyed: boolean;
  grazeAwarded: boolean;
}

export interface CargoPodEntity {
  poolKey: string;
  mesh: THREE.Group;
  position: THREE.Vector3;
  radius: number;
  destroyed: boolean;
}

export interface GravityWellEntity {
  poolKey: string;
  mesh: THREE.Group;
  position: THREE.Vector3;
  radius: number;
  strength: number;
  slingshotAwarded: boolean;
  enteredInfluence: boolean;
}

export class TrackSpawner {
  private readonly scene: THREE.Scene;
  private readonly builder: WorldBuilder;
  private readonly meshPools = new Map<string, THREE.Group[]>();

  readonly rings: RingEntity[] = [];
  readonly stars: StarEntity[] = [];
  readonly pickups: PickupEntity[] = [];
  readonly hazards: HazardEntity[] = [];
  readonly laserGates: LaserGateEntity[] = [];
  readonly pylons: PylonEntity[] = [];
  readonly thermals: ThermalEntity[] = [];
  readonly slipstreams: SlipstreamEntity[] = [];
  readonly drones: ScoutDroneEntity[] = [];
  readonly cargoPods: CargoPodEntity[] = [];
  readonly gravityWells: GravityWellEntity[] = [];

  private nextSpawnZ = -34;
  private chunkIndex = 0;
  private biomeId: StageId = 1;
  private difficulty: Difficulty = 'normal';
  private shieldBonusChance = 0;
  private bossArenaActive = false;
  private rng: () => number = Math.random;
  private elapsed = 0;

  constructor(scene: THREE.Scene, builder: WorldBuilder) {
    this.scene = scene;
    this.builder = builder;
    this.prewarmPools();
  }

  private acquireMesh(key: string, factory: () => THREE.Group): THREE.Group {
    const pool = this.meshPools.get(key);
    if (pool && pool.length > 0) {
      const mesh = pool.pop()!;
      mesh.visible = true;
      mesh.rotation.set(0, 0, 0);
      mesh.scale.setScalar(1);
      return mesh;
    }
    const mesh = factory();
    this.scene.add(mesh);
    return mesh;
  }

  private releaseMesh(key: string, mesh: THREE.Group): void {
    mesh.visible = false;
    mesh.position.set(0, -9999, 9999);
    let pool = this.meshPools.get(key);
    if (!pool) {
      pool = [];
      this.meshPools.set(key, pool);
    }
    pool.push(mesh);
  }

  private prewarm(key: string, count: number, factory: () => THREE.Group): void {
    let pool = this.meshPools.get(key);
    if (!pool) {
      pool = [];
      this.meshPools.set(key, pool);
    }
    for (let i = 0; i < count; i++) {
      const mesh = factory();
      mesh.visible = false;
      mesh.position.set(0, -9999, 9999);
      this.scene.add(mesh);
      pool.push(mesh);
    }
  }

  private prewarmPools(): void {
    this.prewarm('ring_normal', 26, () => this.builder.createCyberRing('normal'));
    this.prewarm('ring_warp', 5, () => this.builder.createCyberRing('warp'));
    this.prewarm('star', 44, () => this.builder.createStar());
    this.prewarm('mine_1', 10, () => this.builder.createPlasmaMine(1));
    this.prewarm('drone_1', 5, () => this.builder.createScoutDrone(1));
    this.prewarm('cargo', 4, () => this.builder.createCargoPod());
    this.prewarm('thermal', 2, () => this.builder.createThermalUpdraft());
    this.prewarm('slipstream', 2, () => this.builder.createSlipstreamTube());
    this.prewarm('gravity', 2, () => this.builder.createGravityWell());
    this.prewarm('laser', 4, () => this.builder.createLaserGate('horizontal', 0, 4.6));
    this.prewarm('pickup_shield', 2, () => this.builder.createPickup('shield'));
    this.prewarm('pickup_heart', 2, () => this.builder.createPickup('heart'));
    this.prewarm('pickup_frenzy', 2, () => this.builder.createPickup('frenzy'));
    this.prewarm('pickup_overcharge', 2, () => this.builder.createPickup('overcharge'));
    for (let v = 0; v < 3; v++) {
      this.prewarm(`pylon_1_${v}`, 4, () => this.builder.createCyberPylon(1, v, 1).group);
    }
  }

  reset(
    _mode: GameMode,
    biomeId: StageId,
    difficulty: Difficulty,
    shieldLevel: number,
    seed?: number
  ): void {
    this.biomeId = biomeId;
    this.difficulty = difficulty;
    this.shieldBonusChance = shieldLevel * 0.045;
    this.bossArenaActive = false;
    this.rng = seed !== undefined ? createSeededRng(seed) : Math.random;
    this.elapsed = 0;

    this.clearAll();
    this.nextSpawnZ = -32;
    this.chunkIndex = 0;
    this.update(0, 0, true);
  }

  setBiome(biomeId: StageId): void {
    this.biomeId = biomeId;
  }

  setBossArenaMode(active: boolean): void {
    this.bossArenaActive = active;
    if (active) {
      this.releaseAllInList(this.hazards);
      this.releaseAllInList(this.laserGates);
      this.releaseAllInList(this.drones);
      this.releaseAllInList(this.gravityWells);
    }
  }

  spawnBonusStar(pos: THREE.Vector3): void {
    const poolKey = 'star';
    const starMesh = this.acquireMesh(poolKey, () => this.builder.createStar());
    starMesh.position.copy(pos);
    this.stars.push({ poolKey, mesh: starMesh, position: pos.clone(), collected: false });
  }

  update(playerZ: number, dt: number, forceSeed = false): void {
    this.elapsed += dt;
    const horizonZ = playerZ - 230;
    while (this.nextSpawnZ > horizonZ) {
      this.spawnChunk(forceSeed && this.chunkIndex === 0);
    }

    const time = this.elapsed;

    for (const ring of this.rings) {
      if (!ring.collected) {
        ring.mesh.rotation.z += dt * (ring.kind === 'warp' ? 1.8 : 0.9);
      }
    }
    for (const star of this.stars) {
      if (!star.collected) {
        star.mesh.rotation.y += dt * 3.2;
      }
    }
    for (const p of this.pickups) {
      if (!p.collected) {
        p.mesh.rotation.y += dt * 2.4;
        p.mesh.position.y = p.position.y + Math.sin(time * 3.5 + p.position.z) * 0.28;
      }
    }
    for (const h of this.hazards) {
      h.mesh.rotation.y += dt * 1.8;
      h.mesh.rotation.x += dt * 1.1;
      if (h.driftAmp > 0) {
        h.position.x = h.baseX + Math.sin(time * h.driftFreq + h.phase) * h.driftAmp;
        h.mesh.position.x = h.position.x;
      }
    }
    for (const d of this.drones) {
      if (d.destroyed) continue;
      d.position.x = d.baseX + Math.sin(time * d.driftFreq + d.phase) * d.driftAmp;
      d.position.y = d.baseY + Math.cos(time * d.driftFreq * 1.3 + d.phase) * 1.25;
      d.mesh.position.copy(d.position);
      d.mesh.rotation.z = -Math.cos(time * d.driftFreq + d.phase) * 0.38;
    }
    for (const pod of this.cargoPods) {
      if (pod.destroyed) continue;
      pod.mesh.rotation.y += dt * 1.6;
      pod.mesh.rotation.x += dt * 0.7;
    }
    for (const th of this.thermals) {
      th.mesh.rotation.y += dt * 2.6;
    }
    for (const gw of this.gravityWells) {
      gw.mesh.rotation.z += dt * 2.2;
      gw.mesh.rotation.y += dt * 1.1;
    }

    const cullZ = playerZ + 46;
    this.cullList(this.rings, cullZ);
    this.cullList(this.stars, cullZ);
    this.cullList(this.pickups, cullZ);
    this.cullList(this.hazards, cullZ);
    this.cullList(this.laserGates, cullZ);
    this.cullList(this.pylons, cullZ);
    this.cullList(this.thermals, cullZ);
    this.cullList(this.slipstreams, cullZ + 22);
    this.cullList(this.drones, cullZ);
    this.cullList(this.cargoPods, cullZ);
    this.cullList(this.gravityWells, cullZ);
  }

  clearAll(): void {
    this.releaseAllInList(this.rings);
    this.releaseAllInList(this.stars);
    this.releaseAllInList(this.pickups);
    this.releaseAllInList(this.hazards);
    this.releaseAllInList(this.laserGates);
    this.releaseAllInList(this.pylons);
    this.releaseAllInList(this.thermals);
    this.releaseAllInList(this.slipstreams);
    this.releaseAllInList(this.drones);
    this.releaseAllInList(this.cargoPods);
    this.releaseAllInList(this.gravityWells);
  }

  private releaseAllInList<T extends { poolKey: string; mesh: THREE.Group }>(list: T[]): void {
    for (const item of list) {
      this.releaseMesh(item.poolKey, item.mesh);
    }
    list.length = 0;
  }

  private cullList<T extends { poolKey: string; mesh: THREE.Group }>(
    list: T[],
    cullZ: number
  ): void {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].mesh.position.z > cullZ) {
        this.releaseMesh(list[i].poolKey, list[i].mesh);
        list.splice(i, 1);
      }
    }
  }

  private spawnChunk(isOpeningChunk: boolean): void {
    const idx = this.chunkIndex++;
    const chunkLen = 58;
    const startZ = this.nextSpawnZ;
    this.nextSpawnZ -= chunkLen;
    const rand = this.rng;

    // 1. Atmospheric Flanking Skyscrapers & Industrial Pylons
    for (const side of [-1, 1]) {
      if (rand() < 0.88 || isOpeningChunk) {
        const scale = 0.85 + rand() * 0.65;
        const variant = (idx + (side > 0 ? 1 : 0)) % 3;
        const poolKey = `pylon_${this.biomeId}_${variant}`;
        const pylonGroup = this.acquireMesh(
          poolKey,
          () => this.builder.createCyberPylon(this.biomeId, variant, 1).group
        );
        const px = side * (17.5 + rand() * 14);
        const py = -12 + rand() * 9;
        const pz = startZ - rand() * (chunkLen * 0.78);
        pylonGroup.scale.setScalar(scale);
        pylonGroup.position.set(px, py, pz);
        pylonGroup.rotation.y = rand() * Math.PI * 0.5;
        this.pylons.push({
          poolKey,
          mesh: pylonGroup,
          position: new THREE.Vector3(px, py, pz),
          radius: 3.4 * scale,
          grazeAwarded: false
        });
      }
    }

    if (this.bossArenaActive) {
      if (idx % 2 === 0) {
        const kind: PickupEntity['kind'] =
          rand() < 0.45 ? 'shield' : rand() < 0.7 ? 'heart' : 'overcharge';
        const poolKey = `pickup_${kind}`;
        const pos = new THREE.Vector3((rand() - 0.5) * 18, -1 + rand() * 7, startZ - 24);
        const mesh = this.acquireMesh(poolKey, () => this.builder.createPickup(kind));
        mesh.position.copy(pos);
        this.pickups.push({ kind, poolKey, mesh, position: pos, collected: false });
      }
      return;
    }

    // 2. Curved Chain of Cyber Rings + Dive-Swoop Arcs + Data Stars
    const ringCount = isOpeningChunk ? 4 : 4 + (idx % 3);
    const isDiveArc = !isOpeningChunk && idx % 4 === 2;
    const startX = isOpeningChunk ? 0 : (rand() - 0.5) * 15;
    const endX = (rand() - 0.5) * 18;
    const startY = isOpeningChunk ? 1.5 : isDiveArc ? 8.5 : -2 + rand() * 8;
    const endY = isDiveArc ? -4.5 : -1.5 + rand() * 9;

    const curvePoints: THREE.Vector3[] = [];
    for (let i = 0; i < ringCount; i++) {
      const t = ringCount === 1 ? 0 : i / (ringCount - 1);
      const x =
        THREE.MathUtils.lerp(startX, endX, t) + Math.sin(t * Math.PI) * (idx % 2 === 0 ? 4.2 : -4.2);
      const y =
        THREE.MathUtils.lerp(startY, endY, t) +
        Math.sin(t * Math.PI * 1.5) * (isDiveArc ? -1.8 : 2.2);
      const z = startZ - t * (chunkLen - 14);
      const pt = new THREE.Vector3(
        THREE.MathUtils.clamp(x, -15, 15),
        THREE.MathUtils.clamp(y, -5.5, 9.5),
        z
      );
      curvePoints.push(pt);

      const isWarp = !isOpeningChunk && idx % 3 === 1 && i === ringCount - 1;
      const kind: RingEntity['kind'] = isWarp ? 'warp' : 'normal';
      const poolKey = isWarp ? 'ring_warp' : 'ring_normal';
      const ringMesh = this.acquireMesh(poolKey, () => this.builder.createCyberRing(kind));
      ringMesh.position.copy(pt);
      this.rings.push({ kind, poolKey, mesh: ringMesh, position: pt.clone(), collected: false });
    }

    for (let i = 0; i < curvePoints.length - 1; i++) {
      const a = curvePoints[i];
      const b = curvePoints[i + 1];
      for (const frac of [0.35, 0.68]) {
        const starPos = new THREE.Vector3().lerpVectors(a, b, frac);
        const poolKey = 'star';
        const starMesh = this.acquireMesh(poolKey, () => this.builder.createStar());
        starMesh.position.copy(starPos);
        this.stars.push({ poolKey, mesh: starMesh, position: starPos, collected: false });
      }
    }

    // 3. Laser Gate
    const gateChance =
      this.biomeId === 1 ? 0.32 : this.biomeId === 2 ? 0.45 : this.biomeId === 3 ? 0.58 : 0.68;
    const ocBoost = this.difficulty === 'overclocked' ? 0.16 : 0;

    if (!isOpeningChunk && idx >= 3 && idx % 2 === 1 && rand() < gateChance + ocBoost) {
      const midPt = curvePoints[Math.floor(curvePoints.length / 2)];
      const orientation: 'horizontal' | 'vertical' = rand() > 0.5 ? 'horizontal' : 'vertical';
      const gapCenter = orientation === 'horizontal' ? midPt.x : midPt.y;
      const gapHalf = this.difficulty === 'overclocked' ? 4.0 : 4.8;
      const poolKey = 'laser';
      const gateMesh = this.acquireMesh(poolKey, () =>
        this.builder.createLaserGate(orientation, gapCenter, gapHalf)
      );
      this.builder.configureLaserGate(gateMesh, orientation, gapCenter, gapHalf);
      const gz = midPt.z;
      gateMesh.position.set(0, 0, gz);
      this.laserGates.push({
        poolKey,
        mesh: gateMesh,
        orientation,
        gapCenter,
        gapHalf,
        z: gz,
        hit: false,
        grazeAwarded: false
      });
    }

    // 4. Plasma Mines
    if (!isOpeningChunk) {
      const baseDifficulty = (this.biomeId - 1) * 0.25 + Math.min(0.6, idx / 24);
      const ocBonus = this.difficulty === 'overclocked' ? 0.35 : 0;
      const mineCount =
        1 +
        (rand() < 0.4 + baseDifficulty + ocBonus ? 1 : 0) +
        (this.difficulty === 'overclocked' && rand() < 0.45 ? 1 : 0);

      for (let m = 0; m < mineCount; m++) {
        const mz = startZ - 12 - m * 17 - rand() * 8;
        const mx = (rand() - 0.5) * 28;
        const my = -4.5 + rand() * 13;
        const cand = new THREE.Vector3(mx, my, mz);

        const tooCloseToRing = curvePoints.some((rp) => rp.distanceTo(cand) < 6.0);
        if (tooCloseToRing) continue;

        const mineBiomeKey = this.biomeId === 3 ? 3 : 1;
        const poolKey = `mine_${mineBiomeKey}`;
        const mineMesh = this.acquireMesh(poolKey, () => this.builder.createPlasmaMine(this.biomeId));
        mineMesh.position.copy(cand);
        this.hazards.push({
          poolKey,
          mesh: mineMesh,
          position: cand,
          radius: 2.1,
          baseX: mx,
          driftAmp:
            (this.biomeId >= 2 || idx > 5) && rand() < 0.55
              ? 2.6 + baseDifficulty * 2.2
              : 0,
          driftFreq: 1.3 + rand() * 0.8,
          phase: rand() * Math.PI * 2,
          hit: false,
          grazeAwarded: false
        });
      }
    }

    // 5. Fun Physics Elements & Targets
    if (!isOpeningChunk) {
      if (idx % 4 === 1) {
        const pt = curvePoints[0];
        const pos = new THREE.Vector3(
          THREE.MathUtils.clamp(pt.x, -13, 13),
          THREE.MathUtils.clamp(pt.y, -4, 8),
          startZ - 14
        );
        const poolKey = 'slipstream';
        const mesh = this.acquireMesh(poolKey, () => this.builder.createSlipstreamTube());
        mesh.position.copy(pos);
        this.slipstreams.push({
          poolKey,
          mesh,
          position: pos,
          length: 24,
          radius: 4.4,
          entered: false
        });
      } else if (idx % 4 === 2) {
        const pos = new THREE.Vector3((rand() - 0.5) * 22, 0, startZ - 28);
        const poolKey = 'thermal';
        const mesh = this.acquireMesh(poolKey, () => this.builder.createThermalUpdraft());
        mesh.position.copy(pos);
        this.thermals.push({
          poolKey,
          mesh,
          position: pos,
          radius: 4.5,
          triggered: false
        });
      }

      if (idx >= 2 && rand() < 0.58) {
        const dx = (rand() - 0.5) * 20;
        const dy = -2 + rand() * 9;
        const dz = startZ - 20 - rand() * 20;
        const dPos = new THREE.Vector3(dx, dy, dz);
        if (!curvePoints.some((rp) => rp.distanceTo(dPos) < 5.0)) {
          const droneBiomeKey = this.biomeId === 2 ? 2 : 1;
          const poolKey = `drone_${droneBiomeKey}`;
          const mesh = this.acquireMesh(poolKey, () => this.builder.createScoutDrone(this.biomeId));
          mesh.position.copy(dPos);
          this.drones.push({
            poolKey,
            mesh,
            position: dPos,
            baseX: dx,
            baseY: dy,
            driftAmp: 3.5 + rand() * 2.5,
            driftFreq: 1.5 + rand() * 0.7,
            phase: rand() * Math.PI * 2,
            radius: 1.9,
            hp: 1,
            destroyed: false,
            grazeAwarded: false
          });
        }
      }

      if (idx % 3 === 2) {
        const cPos = new THREE.Vector3((rand() - 0.5) * 20, -1 + rand() * 8, startZ - 34);
        const poolKey = 'cargo';
        const mesh = this.acquireMesh(poolKey, () => this.builder.createCargoPod());
        mesh.position.copy(cPos);
        this.cargoPods.push({
          poolKey,
          mesh,
          position: cPos,
          radius: 2.1,
          destroyed: false
        });
      }

      if ((this.biomeId >= 2 || idx >= 6) && idx % 5 === 4) {
        const side = rand() > 0.5 ? 1 : -1;
        const gPos = new THREE.Vector3(
          side * (8 + rand() * 5),
          1.5 + (rand() - 0.5) * 6,
          startZ - 30
        );
        const poolKey = 'gravity';
        const mesh = this.acquireMesh(poolKey, () => this.builder.createGravityWell());
        mesh.position.copy(gPos);
        this.gravityWells.push({
          poolKey,
          mesh,
          position: gPos,
          radius: 15.0,
          strength: 760,
          slingshotAwarded: false,
          enteredInfluence: false
        });
      }
    }

    // 6. Power-Up Drops
    if (idx > 0 && idx % 3 === 0) {
      const roll = rand();
      const kind: PickupEntity['kind'] =
        roll < 0.32 + this.shieldBonusChance
          ? 'shield'
          : roll < 0.56
            ? 'heart'
            : roll < 0.8
              ? 'frenzy'
              : 'overcharge';
      const anchor = curvePoints[Math.floor(curvePoints.length / 2)];
      const pos = new THREE.Vector3(
        THREE.MathUtils.clamp(anchor.x + (rand() > 0.5 ? 5.0 : -5.0), -15, 15),
        THREE.MathUtils.clamp(anchor.y + 1.5, -5, 9),
        anchor.z - 6
      );
      const poolKey = `pickup_${kind}`;
      const mesh = this.acquireMesh(poolKey, () => this.builder.createPickup(kind));
      mesh.position.copy(pos);
      this.pickups.push({ kind, poolKey, mesh, position: pos, collected: false });
    }
  }
}
