import * as THREE from 'three';
import type { GraphicsQuality, TrailId } from '../types/game';
import type { ProceduralTexturePack } from './ProceduralTextures';

const MAX_PARTICLES = 760;
const STREAK_COUNT = 84;

export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly shaderMat: THREE.ShaderMaterial;
  private readonly streaks: THREE.LineSegments;
  private readonly streakPositions: Float32Array;
  private readonly streakMat: THREE.LineBasicMaterial;

  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly colors = new Float32Array(MAX_PARTICLES * 3);
  private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
  private readonly ages = new Float32Array(MAX_PARTICLES);
  private readonly lifetimes = new Float32Array(MAX_PARTICLES);
  private readonly sizes = new Float32Array(MAX_PARTICLES);
  private readonly baseSizes = new Float32Array(MAX_PARTICLES);
  private readonly alphas = new Float32Array(MAX_PARTICLES);

  private cursor = 0;
  private activeCount = 0;
  private colorDirty = false;
  private trailTimer = 0;
  private vaporTimer = 0;
  private rainbowPhase = 0;
  private trailIntervalScale = 1.0;
  private readonly tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, textures: ProceduralTexturePack) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));

    this.shaderMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: textures.sparkleParticle },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * uPixelRatio * (210.0 / max(1.0, -mvPos.z)), 1.5, 64.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float alpha = tex.a * vAlpha * 0.72;
          if (alpha < 0.01) discard;
          vec3 col = vColor * (0.88 + tex.r * 0.3);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.ages[i] = 999;
      this.lifetimes[i] = 1;
      this.positions[i * 3 + 1] = -9999;
      this.sizes[i] = 0;
      this.alphas[i] = 0;
    }

    this.points = new THREE.Points(geo, this.shaderMat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // 3D Aerodynamic Airflow Speed-Streaks around outer corridor
    this.streakPositions = new Float32Array(STREAK_COUNT * 6);
    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute('position', new THREE.BufferAttribute(this.streakPositions, 3));
    this.streakMat = new THREE.LineBasicMaterial({
      color: 0xbfefff,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    for (let i = 0; i < STREAK_COUNT; i++) {
      this.respawnStreak(i, 0, -i * 1.4);
    }
    this.streaks = new THREE.LineSegments(streakGeo, this.streakMat);
    this.streaks.frustumCulled = false;
    scene.add(this.streaks);
  }

  setPixelRatio(dpr: number): void {
    this.shaderMat.uniforms.uPixelRatio.value = dpr;
  }

  setQuality(quality: GraphicsQuality): void {
    this.trailIntervalScale = quality === 'saver' ? 1.4 : 1.0;
  }

  emitTrail(
    dt: number,
    leftPos: THREE.Vector3,
    rightPos: THREE.Vector3,
    trailId: TrailId,
    boosting: boolean,
    fever = false
  ): void {
    this.trailTimer += dt;
    this.rainbowPhase = (this.rainbowPhase + dt * (fever ? 4.2 : 2.4)) % 1;
    const baseInterval = fever ? 0.008 : boosting ? 0.013 : 0.022;
    if (this.trailTimer < baseInterval * this.trailIntervalScale) return;
    this.trailTimer = 0;

    const life = fever ? 0.58 : boosting ? 0.44 : 0.34;
    const size = fever ? 0.92 : boosting ? 0.78 : 0.58;
    const hot = boosting || fever;

    this.pickTrailColor(trailId, hot, fever, this.tmpColor);
    this.spawnOne(
      leftPos.x + (Math.random() - 0.5) * 0.14,
      leftPos.y + (Math.random() - 0.5) * 0.14,
      leftPos.z + 0.12,
      (Math.random() - 0.5) * 0.85,
      (Math.random() - 0.3) * 0.75,
      3.2 + Math.random() * 2.8,
      life,
      this.tmpColor,
      size
    );

    this.pickTrailColor(trailId, hot, fever, this.tmpColor);
    this.spawnOne(
      rightPos.x + (Math.random() - 0.5) * 0.14,
      rightPos.y + (Math.random() - 0.5) * 0.14,
      rightPos.z + 0.12,
      (Math.random() - 0.5) * 0.85,
      (Math.random() - 0.3) * 0.75,
      3.2 + Math.random() * 2.8,
      life,
      this.tmpColor,
      size
    );
  }

  emitWingtipVapor(
    dt: number,
    leftTip: THREE.Vector3,
    rightTip: THREE.Vector3,
    intensity: number
  ): void {
    if (intensity <= 0.05) return;
    this.vaporTimer += dt;
    if (this.vaporTimer < 0.018 * this.trailIntervalScale) return;
    this.vaporTimer = 0;

    this.tmpColor.setRGB(0.78, 0.92, 1.0);
    const size = 0.55 + intensity * 0.5;
    this.spawnOne(
      leftTip.x,
      leftTip.y,
      leftTip.z,
      (Math.random() - 0.5) * 0.25,
      (Math.random() - 0.5) * 0.25,
      1.5,
      0.34,
      this.tmpColor,
      size
    );
    this.spawnOne(
      rightTip.x,
      rightTip.y,
      rightTip.z,
      (Math.random() - 0.5) * 0.25,
      (Math.random() - 0.5) * 0.25,
      1.5,
      0.34,
      this.tmpColor,
      size
    );
  }

  emitBurst(origin: THREE.Vector3, colorHex: number, count = 24, speed = 8.0): void {
    this.tmpColor.setHex(colorHex);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.45 + Math.random() * 0.85);
      this.spawnOne(
        origin.x,
        origin.y,
        origin.z,
        Math.sin(phi) * Math.cos(theta) * s,
        Math.cos(phi) * s,
        Math.sin(phi) * Math.sin(theta) * s,
        0.5 + Math.random() * 0.38,
        this.tmpColor,
        1.15 + Math.random() * 0.65
      );
    }
  }

  update(
    dt: number,
    playerPos?: THREE.Vector3,
    speedRatio = 0.2,
    boosting = false,
    fever = false
  ): void {
    const hadActive = this.activeCount > 0;
    if (hadActive) {
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const age = this.ages[i];
        const life = this.lifetimes[i];
        if (age >= life) continue;

        const nextAge = age + dt;
        this.ages[i] = nextAge;

        const idx = i * 3;
        if (nextAge >= life) {
          this.positions[idx + 1] = -9999;
          this.alphas[i] = 0;
          this.sizes[i] = 0;
          this.activeCount = Math.max(0, this.activeCount - 1);
          continue;
        }

        this.positions[idx] += this.velocities[idx] * dt;
        this.positions[idx + 1] += this.velocities[idx + 1] * dt;
        this.positions[idx + 2] += this.velocities[idx + 2] * dt;

        const fade = Math.max(0, 1 - nextAge / life);
        this.alphas[i] = fade * fade;
        this.sizes[i] = this.baseSizes[i] * (0.45 + fade * 0.65);
      }

      (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.points.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
      (this.points.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    }

    if (this.colorDirty) {
      (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      this.colorDirty = false;
    }

    // Update 3D aerodynamic slipstream speed streaks
    if (playerPos) {
      const lenZ = 2.4 + speedRatio * 5.2 + (boosting || fever ? 3.5 : 0);
      this.streakMat.opacity = Math.min(0.68, 0.1 + speedRatio * 0.32 + (boosting || fever ? 0.24 : 0));
      this.streakMat.color.setHex(fever ? 0xffd000 : boosting ? 0x38bdf8 : 0xcbeafe);

      const flowSpeed = 24 + speedRatio * 52 + (boosting || fever ? 26 : 0);
      for (let i = 0; i < STREAK_COUNT; i++) {
        const i6 = i * 6;
        this.streakPositions[i6 + 2] += flowSpeed * dt;
        this.streakPositions[i6 + 5] = this.streakPositions[i6 + 2] - lenZ;

        if (this.streakPositions[i6 + 2] > playerPos.z + 12) {
          this.respawnStreak(i, playerPos.x, playerPos.z - 85 - Math.random() * 45, playerPos.y);
        }
      }
      (this.streaks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private respawnStreak(index: number, centerX: number, z: number, centerY = 1.5): void {
    const angle = Math.random() * Math.PI * 2;
    const rad = 5.5 + Math.random() * 18;
    const x = centerX + Math.cos(angle) * rad;
    const y = centerY + Math.sin(angle) * (rad * 0.65);
    const i6 = index * 6;
    this.streakPositions[i6] = x;
    this.streakPositions[i6 + 1] = y;
    this.streakPositions[i6 + 2] = z;
    this.streakPositions[i6 + 3] = x;
    this.streakPositions[i6 + 4] = y;
    this.streakPositions[i6 + 5] = z - 3.2;
  }

  private pickTrailColor(
    trailId: TrailId,
    hot: boolean,
    fever: boolean,
    out: THREE.Color
  ): void {
    if (fever) {
      out.setHSL(this.rainbowPhase, 1.0, 0.65);
      return;
    }
    if (trailId === 'rainbow_ribbon') {
      out.setHSL(this.rainbowPhase, 0.95, 0.62);
      return;
    }
    if (trailId === 'bubble_pop') {
      out.setHex(hot ? 0xffffff : Math.random() > 0.4 ? 0x00f0ff : 0x6366f1);
      return;
    }
    if (trailId === 'comet_flame') {
      out.setHex(hot ? 0xff2a85 : Math.random() > 0.4 ? 0xff6b00 : 0xffd000);
      return;
    }
    out.setHex(hot ? 0xffffff : Math.random() > 0.35 ? 0xffd000 : 0x00f0ff);
  }

  private spawnOne(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    lifetime: number,
    color: THREE.Color,
    size = 1.0
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;

    if (this.ages[i] >= this.lifetimes[i]) {
      this.activeCount += 1;
    }

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
    this.baseSizes[i] = size;
    this.sizes[i] = size;
    this.alphas[i] = 1;
    this.colorDirty = true;
  }
}
