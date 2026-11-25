import * as THREE from 'three';

interface DebrisChunk {
  isShard: boolean;
  instanceIdx: number;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  velocity: THREE.Vector3;
  angVel: THREE.Vector3;
  age: number;
  lifetime: number;
  baseScale: number;
  active: boolean;
}

const SLOTS_PER_MESH = 68;
const MAX_DEBRIS = SLOTS_PER_MESH * 2;
const GRAVITY = 9.81;

/**
 * Instanced 3D rigid-body debris pool (2 draw calls total) with inherited momentum,
 * radial blast impulse, gravity, quadratic air drag, and 3D angular tumble.
 */
export class DebrisSystem {
  private readonly plateMesh: THREE.InstancedMesh;
  private readonly shardMesh: THREE.InstancedMesh;
  private readonly chunks: DebrisChunk[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();

  private plateCursor = 0;
  private shardCursor = 0;
  private spawnToggle = 0;
  private activeCount = 0;

  constructor(scene: THREE.Scene) {
    const plateGeo = new THREE.BoxGeometry(0.46, 0.14, 0.56);
    const shardGeo = new THREE.TetrahedronGeometry(0.32, 0);

    const plateMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.35,
      metalness: 0.72
    });
    const shardMat = new THREE.MeshBasicMaterial({
      color: 0xffffff
    });

    this.plateMesh = new THREE.InstancedMesh(plateGeo, plateMat, SLOTS_PER_MESH);
    this.shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, SLOTS_PER_MESH);

    this.plateMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.plateMesh.frustumCulled = false;
    this.shardMesh.frustumCulled = false;
    this.plateMesh.visible = false;
    this.shardMesh.visible = false;

    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    this.tmpColor.setHex(0xffffff);

    for (let i = 0; i < SLOTS_PER_MESH; i++) {
      this.plateMesh.setMatrixAt(i, this.dummy.matrix);
      this.plateMesh.setColorAt(i, this.tmpColor);
      this.shardMesh.setMatrixAt(i, this.dummy.matrix);
      this.shardMesh.setColorAt(i, this.tmpColor);
    }
    this.plateMesh.instanceMatrix.needsUpdate = true;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    if (this.plateMesh.instanceColor) this.plateMesh.instanceColor.needsUpdate = true;
    if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;

    scene.add(this.plateMesh, this.shardMesh);

    for (let i = 0; i < MAX_DEBRIS; i++) {
      const isShard = i >= SLOTS_PER_MESH;
      const instanceIdx = isShard ? i - SLOTS_PER_MESH : i;
      this.chunks.push({
        isShard,
        instanceIdx,
        position: new THREE.Vector3(),
        rotation: new THREE.Euler(),
        velocity: new THREE.Vector3(),
        angVel: new THREE.Vector3(),
        age: 0,
        lifetime: 1,
        baseScale: 1,
        active: false
      });
    }
  }

  spawnExplosion(
    origin: THREE.Vector3,
    inheritedVel: THREE.Vector3,
    glowHex: number,
    metalHex = 0x1e293b,
    count = 14,
    blastSpeed = 16
  ): void {
    let platesTouched = false;
    let shardsTouched = false;

    for (let i = 0; i < count; i++) {
      const useShard = (this.spawnToggle++ & 1) === 1;
      let c: DebrisChunk;
      if (useShard) {
        c = this.chunks[SLOTS_PER_MESH + this.shardCursor];
        this.shardCursor = (this.shardCursor + 1) % SLOTS_PER_MESH;
      } else {
        c = this.chunks[this.plateCursor];
        this.plateCursor = (this.plateCursor + 1) % SLOTS_PER_MESH;
      }

      if (!c.active) {
        c.active = true;
        this.activeCount += 1;
      }

      const isHotShard = useShard || i % 3 === 0;
      this.tmpColor.setHex(isHotShard ? glowHex : metalHex);
      if (useShard) {
        this.tmpColor.multiplyScalar(1.35);
      }

      c.position.set(
        origin.x + (Math.random() - 0.5) * 0.8,
        origin.y + (Math.random() - 0.5) * 0.8,
        origin.z + (Math.random() - 0.5) * 0.8
      );
      c.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const spd = blastSpeed * (0.45 + Math.random() * 0.75);
      c.velocity.set(
        inheritedVel.x * 0.4 + Math.sin(phi) * Math.cos(theta) * spd,
        inheritedVel.y * 0.4 + Math.cos(phi) * spd + 3.0,
        inheritedVel.z * 0.4 + Math.sin(phi) * Math.sin(theta) * spd
      );
      c.angVel.set(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14
      );

      c.age = 0;
      c.lifetime = 0.75 + Math.random() * 0.65;
      c.baseScale = 0.65 + Math.random() * 0.85;

      this.dummy.position.copy(c.position);
      this.dummy.rotation.copy(c.rotation);
      this.dummy.scale.setScalar(c.baseScale);
      this.dummy.updateMatrix();

      if (useShard) {
        this.shardMesh.setMatrixAt(c.instanceIdx, this.dummy.matrix);
        this.shardMesh.setColorAt(c.instanceIdx, this.tmpColor);
        shardsTouched = true;
      } else {
        this.plateMesh.setMatrixAt(c.instanceIdx, this.dummy.matrix);
        this.plateMesh.setColorAt(c.instanceIdx, this.tmpColor);
        platesTouched = true;
      }
    }

    if (platesTouched) {
      this.plateMesh.visible = true;
      this.plateMesh.instanceMatrix.needsUpdate = true;
      if (this.plateMesh.instanceColor) this.plateMesh.instanceColor.needsUpdate = true;
    }
    if (shardsTouched) {
      this.shardMesh.visible = true;
      this.shardMesh.instanceMatrix.needsUpdate = true;
      if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;
    }
  }

  clear(): void {
    if (this.activeCount === 0 && !this.plateMesh.visible && !this.shardMesh.visible) return;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (const c of this.chunks) {
      if (c.active) {
        c.active = false;
        const target = c.isShard ? this.shardMesh : this.plateMesh;
        target.setMatrixAt(c.instanceIdx, this.dummy.matrix);
      }
    }
    this.activeCount = 0;
    this.plateMesh.instanceMatrix.needsUpdate = true;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    this.plateMesh.visible = false;
    this.shardMesh.visible = false;
  }

  update(dt: number): void {
    if (this.activeCount === 0) return;

    let platesDirty = false;
    let shardsDirty = false;

    for (const c of this.chunks) {
      if (!c.active) continue;
      c.age += dt;
      if (c.age >= c.lifetime) {
        c.active = false;
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        if (c.isShard) {
          this.shardMesh.setMatrixAt(c.instanceIdx, this.dummy.matrix);
          shardsDirty = true;
        } else {
          this.plateMesh.setMatrixAt(c.instanceIdx, this.dummy.matrix);
          platesDirty = true;
        }
        continue;
      }

      // Gravity + quadratic air drag
      c.velocity.y -= GRAVITY * dt;
      const spd = c.velocity.length();
      const dragFactor = Math.max(0, 1 - 0.018 * spd * dt);
      c.velocity.multiplyScalar(dragFactor);

      c.position.addScaledVector(c.velocity, dt);
      c.rotation.x += c.angVel.x * dt;
      c.rotation.y += c.angVel.y * dt;
      c.rotation.z += c.angVel.z * dt;

      const t = c.age / c.lifetime;
      const scale = c.baseScale * (t > 0.65 ? Math.max(0.01, 1 - (t - 0.65) / 0.35) : 1);

      this.dummy.position.copy(c.position);
      this.dummy.rotation.copy(c.rotation);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();

      if (c.isShard) {
        this.shardMesh.setMatrixAt(c.instanceIdx, this.dummy.matrix);
        shardsDirty = true;
      } else {
        this.plateMesh.setMatrixAt(c.instanceIdx, this.dummy.matrix);
        platesDirty = true;
      }
    }

    if (platesDirty) this.plateMesh.instanceMatrix.needsUpdate = true;
    if (shardsDirty) this.shardMesh.instanceMatrix.needsUpdate = true;

    if (this.activeCount === 0) {
      this.plateMesh.visible = false;
      this.shardMesh.visible = false;
    }
  }
}
