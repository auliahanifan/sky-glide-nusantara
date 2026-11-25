import * as THREE from 'three';
import type { WorldBuilder } from '../graphics/WorldBuilder';
import type { GameMode } from '../types/game';

export interface RingEntity {
  mesh: THREE.Group;
  position: THREE.Vector3;
  collected: boolean;
}

export interface StarEntity {
  mesh: THREE.Group;
  position: THREE.Vector3;
  collected: boolean;
}

export interface PickupEntity {
  kind: 'heart' | 'shield';
  mesh: THREE.Group;
  position: THREE.Vector3;
  collected: boolean;
}

export interface HazardEntity {
  mesh: THREE.Group;
  position: THREE.Vector3;
  radius: number;
  baseX: number;
  driftAmp: number;
  driftFreq: number;
  phase: number;
  hit: boolean;
  closeCallAwarded: boolean;
}

export interface IslandEntity {
  mesh: THREE.Group;
  position: THREE.Vector3;
  radius: number;
  windmillBlades: THREE.Object3D[];
  closeCallAwarded: boolean;
}

export interface DecorEntity {
  mesh: THREE.Group;
  baseY: number;
  bobSpeed: number;
  phase: number;
}

export class TrackSpawner {
  private readonly scene: THREE.Scene;
  private readonly builder: WorldBuilder;

  readonly rings: RingEntity[] = [];
  readonly stars: StarEntity[] = [];
  readonly pickups: PickupEntity[] = [];
  readonly hazards: HazardEntity[] = [];
  readonly islands: IslandEntity[] = [];
  readonly decors: DecorEntity[] = [];

  private nextSpawnZ = -34;
  private chunkIndex = 0;
  private mode: GameMode = 'arcade';
  private shieldBonusChance = 0;

  constructor(scene: THREE.Scene, builder: WorldBuilder) {
    this.scene = scene;
    this.builder = builder;
  }

  reset(mode: GameMode, shieldLevel: number): void {
    this.mode = mode;
    this.shieldBonusChance = shieldLevel * 0.045;
    this.clearAll();
    this.nextSpawnZ = -30;
    this.chunkIndex = 0;

    // Seed initial horizon vista immediately
    this.update(0, 0, true);
  }

  update(playerZ: number, dt: number, forceSeed = false): void {
    const horizonZ = playerZ - 210;
    while (this.nextSpawnZ > horizonZ) {
      this.spawnChunk(forceSeed && this.chunkIndex === 0);
    }

    const time = performance.now() * 0.001;

    // Animate collectibles & world props
    for (const ring of this.rings) {
      if (!ring.collected) {
        ring.mesh.rotation.z += dt * 0.85;
      }
    }
    for (const star of this.stars) {
      if (!star.collected) {
        star.mesh.rotation.y += dt * 2.8;
      }
    }
    for (const p of this.pickups) {
      if (!p.collected) {
        p.mesh.rotation.y += dt * 2.1;
        p.mesh.position.y = p.position.y + Math.sin(time * 3 + p.position.z) * 0.28;
      }
    }
    for (const h of this.hazards) {
      if (h.driftAmp > 0) {
        h.position.x = h.baseX + Math.sin(time * h.driftFreq + h.phase) * h.driftAmp;
        h.mesh.position.x = h.position.x;
      }
    }
    for (const isl of this.islands) {
      for (const blades of isl.windmillBlades) {
        blades.rotation.z += dt * 1.45;
      }
    }
    for (const dec of this.decors) {
      dec.mesh.position.y = dec.baseY + Math.sin(time * dec.bobSpeed + dec.phase) * 0.45;
    }

    // Recycle objects safely behind camera
    const cullZ = playerZ + 44;
    this.cullList(this.rings, cullZ);
    this.cullList(this.stars, cullZ);
    this.cullList(this.pickups, cullZ);
    this.cullList(this.hazards, cullZ);
    this.cullList(this.islands, cullZ);
    this.cullList(this.decors, cullZ);
  }

  clearAll(): void {
    for (const list of [
      this.rings,
      this.stars,
      this.pickups,
      this.hazards,
      this.islands,
      this.decors
    ]) {
      for (const item of list) {
        this.scene.remove(item.mesh);
      }
      list.length = 0;
    }
  }

  private cullList<T extends { mesh: THREE.Group }>(list: T[], cullZ: number): void {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].mesh.position.z > cullZ) {
        this.scene.remove(list[i].mesh);
        list.splice(i, 1);
      }
    }
  }

  private spawnChunk(isOpeningChunk: boolean): void {
    const idx = this.chunkIndex++;
    const chunkLen = 58;
    const startZ = this.nextSpawnZ;
    this.nextSpawnZ -= chunkLen;

    // 1. Curved Chain of Golden Rings + Star Trail
    const ringCount = isOpeningChunk ? 4 : 4 + (idx % 3);
    const startX = isOpeningChunk ? 0 : (Math.random() - 0.5) * 14;
    const endX = (Math.random() - 0.5) * 18;
    const startY = isOpeningChunk ? 1.5 : -2 + Math.random() * 8;
    const endY = -1.5 + Math.random() * 9;

    const curvePoints: THREE.Vector3[] = [];
    for (let i = 0; i < ringCount; i++) {
      const t = ringCount === 1 ? 0 : i / (ringCount - 1);
      const x = THREE.MathUtils.lerp(startX, endX, t) + Math.sin(t * Math.PI) * (idx % 2 === 0 ? 4 : -4);
      const y = THREE.MathUtils.lerp(startY, endY, t) + Math.sin(t * Math.PI * 1.5) * 2.2;
      const z = startZ - t * (chunkLen - 14);
      const pt = new THREE.Vector3(
        THREE.MathUtils.clamp(x, -15, 15),
        THREE.MathUtils.clamp(y, -5.5, 9.5),
        z
      );
      curvePoints.push(pt);

      const ringMesh = this.builder.createGoldenRing();
      ringMesh.position.copy(pt);
      this.scene.add(ringMesh);
      this.rings.push({ mesh: ringMesh, position: pt.clone(), collected: false });
    }

    // Weave golden stars between consecutive rings
    for (let i = 0; i < curvePoints.length - 1; i++) {
      const a = curvePoints[i];
      const b = curvePoints[i + 1];
      for (const frac of [0.35, 0.68]) {
        const starPos = new THREE.Vector3().lerpVectors(a, b, frac);
        const starMesh = this.builder.createStar();
        starMesh.position.copy(starPos);
        this.scene.add(starMesh);
        this.stars.push({ mesh: starMesh, position: starPos, collected: false });
      }
    }

    // 2. Scenic Flanking Floating Islands (left & right parallax + depth)
    for (const side of [-1, 1]) {
      if (Math.random() < 0.78 || isOpeningChunk) {
        const scale = 0.88 + Math.random() * 0.45;
        const isl = this.builder.createFloatingIsland(idx + (side > 0 ? 1 : 0), scale);
        const ix = side * (16 + Math.random() * 14);
        const iy = -8.5 + Math.random() * 11;
        const iz = startZ - Math.random() * (chunkLen * 0.75);
        isl.group.position.set(ix, iy, iz);
        isl.group.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(isl.group);
        this.islands.push({
          mesh: isl.group,
          position: new THREE.Vector3(ix, iy, iz),
          radius: isl.collisionRadius,
          windmillBlades: isl.windmillBlades,
          closeCallAwarded: false
        });
      }
    }

    // Occasional distant scenic lower island in center-underneath
    if (idx % 2 === 1) {
      const lowIsl = this.builder.createFloatingIsland(idx + 2, 1.15);
      const lz = startZ - chunkLen * 0.55;
      lowIsl.group.position.set((Math.random() - 0.5) * 8, -14.5, lz);
      this.scene.add(lowIsl.group);
      this.islands.push({
        mesh: lowIsl.group,
        position: lowIsl.group.position.clone(),
        radius: lowIsl.collisionRadius,
        windmillBlades: lowIsl.windmillBlades,
        closeCallAwarded: false
      });
    }

    // 3. Fluffy Toy Clouds & Hot Air Balloons
    const cloudCount = 4;
    for (let i = 0; i < cloudCount; i++) {
      const cloud = this.builder.createFluffyCloud(1.3 + Math.random() * 1.4);
      const cx = (Math.random() - 0.5) * 64;
      const cy = i % 2 === 0 ? -13 - Math.random() * 8 : 11 + Math.random() * 9;
      const cz = startZ - Math.random() * chunkLen;
      cloud.position.set(cx, cy, cz);
      this.scene.add(cloud);
      this.decors.push({
        mesh: cloud,
        baseY: cy,
        bobSpeed: 0.5 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2
      });
    }

    if (idx % 2 === 0) {
      const balloon = this.builder.createHotAirBalloon(idx);
      const side = idx % 4 === 0 ? -1 : 1;
      const bx = side * (18 + Math.random() * 14);
      const by = 2 + Math.random() * 8;
      const bz = startZ - chunkLen * 0.4;
      balloon.position.set(bx, by, bz);
      this.scene.add(balloon);
      this.decors.push({
        mesh: balloon,
        baseY: by,
        bobSpeed: 0.9,
        phase: idx
      });
    }

    // 4. Playful Thundercloud Hazards (Arcade mode only, placed away from ring chain!)
    if (this.mode === 'arcade' && !isOpeningChunk) {
      const difficulty = Math.min(1, idx / 18);
      const hazardCount = 1 + (Math.random() < 0.35 + difficulty * 0.45 ? 1 : 0);

      for (let h = 0; h < hazardCount; h++) {
        const hz = startZ - 14 - h * 24 - Math.random() * 10;
        const hx = (Math.random() - 0.5) * 26;
        const hy = -4 + Math.random() * 12;
        const cand = new THREE.Vector3(hx, hy, hz);

        // Keep wide safe clearance around every ring so chains are always fair
        const tooCloseToRing = curvePoints.some((rp) => rp.distanceTo(cand) < 6.4);
        if (tooCloseToRing) continue;

        const cloudHazard = this.builder.createThundercloud();
        cloudHazard.position.copy(cand);
        this.scene.add(cloudHazard);
        this.hazards.push({
          mesh: cloudHazard,
          position: cand,
          radius: 2.35,
          baseX: hx,
          driftAmp: difficulty > 0.25 && Math.random() < 0.5 ? 2.8 + difficulty * 2 : 0,
          driftFreq: 1.2 + Math.random() * 0.6,
          phase: Math.random() * Math.PI * 2,
          hit: false,
          closeCallAwarded: false
        });
      }
    }

    // 5. Heart & Shield Pickups
    if (this.mode === 'arcade' && idx > 0 && idx % 3 === 0) {
      const isShield = Math.random() < 0.45 + this.shieldBonusChance;
      const kind: 'heart' | 'shield' = isShield ? 'shield' : 'heart';
      const anchor = curvePoints[Math.floor(curvePoints.length / 2)];
      const pos = new THREE.Vector3(
        THREE.MathUtils.clamp(anchor.x + (Math.random() > 0.5 ? 4.5 : -4.5), -15, 15),
        THREE.MathUtils.clamp(anchor.y + 1.5, -5, 9),
        anchor.z - 6
      );
      const mesh =
        kind === 'shield' ? this.builder.createShieldPickup() : this.builder.createHeartPickup();
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this.pickups.push({ kind, mesh, position: pos, collected: false });
    }
  }
}
