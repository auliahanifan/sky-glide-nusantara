import * as THREE from 'three';
import type { TrailId } from '../types/game';
import type { ProceduralTexturePack } from './ProceduralTextures';

const MAX_PARTICLES = 420;

export class ParticleSystem {
  readonly points: THREE.Points;

  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly colors = new Float32Array(MAX_PARTICLES * 3);
  private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
  private readonly ages = new Float32Array(MAX_PARTICLES);
  private readonly lifetimes = new Float32Array(MAX_PARTICLES);
  private readonly baseSizes = new Float32Array(MAX_PARTICLES);

  private cursor = 0;
  private trailTimer = 0;
  private rainbowPhase = 0;
  private readonly tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, textures: ProceduralTexturePack) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.95,
      map: textures.sparkleParticle,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });

    // Park unused particles out of sight
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.ages[i] = 999;
      this.lifetimes[i] = 1;
      this.positions[i * 3 + 1] = -9999;
    }

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emitTrail(
    dt: number,
    leftPos: THREE.Vector3,
    rightPos: THREE.Vector3,
    trailId: TrailId,
    boosting: boolean
  ): void {
    this.trailTimer += dt;
    this.rainbowPhase = (this.rainbowPhase + dt * 2.2) % 1;
    const interval = boosting ? 0.014 : 0.026;
    if (this.trailTimer < interval) return;
    this.trailTimer = 0;

    for (const origin of [leftPos, rightPos]) {
      this.pickTrailColor(trailId, boosting, this.tmpColor);
      this.spawnOne(
        origin.x + (Math.random() - 0.5) * 0.14,
        origin.y + (Math.random() - 0.5) * 0.14,
        origin.z + 0.1,
        (Math.random() - 0.5) * 0.7,
        (Math.random() - 0.3) * 0.6,
        2.5 + Math.random() * 2.2,
        boosting ? 0.58 : 0.45,
        this.tmpColor
      );
    }
  }

  emitBurst(origin: THREE.Vector3, colorHex: number, count = 22, speed = 7.5): void {
    this.tmpColor.setHex(colorHex);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.45 + Math.random() * 0.75);
      this.spawnOne(
        origin.x,
        origin.y,
        origin.z,
        Math.sin(phi) * Math.cos(theta) * s,
        Math.cos(phi) * s,
        Math.sin(phi) * Math.sin(theta) * s,
        0.55 + Math.random() * 0.3,
        this.tmpColor
      );
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const age = this.ages[i];
      const life = this.lifetimes[i];
      if (age >= life) continue;

      const nextAge = age + dt;
      this.ages[i] = nextAge;

      const idx = i * 3;
      if (nextAge >= life) {
        this.positions[idx + 1] = -9999;
        continue;
      }

      this.positions[idx] += this.velocities[idx] * dt;
      this.positions[idx + 1] += this.velocities[idx + 1] * dt;
      this.positions[idx + 2] += this.velocities[idx + 2] * dt;

      // Gentle fade via vertex color attenuation
      const fade = Math.max(0, 1 - nextAge / life);
      const scale = fade * this.baseSizes[i];
      this.colors[idx] *= 0.96 + scale * 0.02;
      this.colors[idx + 1] *= 0.96 + scale * 0.02;
      this.colors[idx + 2] *= 0.96 + scale * 0.02;
    }

    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  private pickTrailColor(trailId: TrailId, boosting: boolean, out: THREE.Color): void {
    if (trailId === 'rainbow_ribbon') {
      out.setHSL(this.rainbowPhase, 0.92, 0.64);
      return;
    }
    if (trailId === 'bubble_pop') {
      out.setHSL(0.52 + Math.random() * 0.14, 0.9, 0.72);
      return;
    }
    if (trailId === 'comet_flame') {
      out.setHex(boosting ? 0xfb7185 : Math.random() > 0.4 ? 0xfb923c : 0x38bdf8);
      return;
    }
    // golden_dust
    out.setHex(boosting ? 0xfef08a : Math.random() > 0.35 ? 0xfbbf24 : 0xfffbeb);
  }

  private spawnOne(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    lifetime: number,
    color: THREE.Color
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;

    const idx = i * 3;
    this.positions[idx] = x;
    this.positions[idx + 1] = y;
    this.positions[idx + 2] = z;

    this.velocities[idx] = vx;
    this.velocities[idx + 1] = vy;
    this.velocities[idx + 2] = vz;

    this.colors[idx] = color.r;
    this.colors[idx + 1] = color.g;
    this.colors[idx + 2] = color.b;

    this.ages[i] = 0;
    this.lifetimes[i] = lifetime;
    this.baseSizes[i] = 1;
  }
}
