import * as THREE from 'three';
import { getMaxHearts } from '../data/catalog';
import { storage } from '../data/storage';
import { ParticleSystem } from '../graphics/ParticleSystem';
import { PlayerGlider } from '../graphics/PlayerGlider';
import { createProceduralTextures } from '../graphics/ProceduralTextures';
import { SkyDome } from '../graphics/SkyDome';
import { WorldBuilder } from '../graphics/WorldBuilder';
import type { SoundEngine } from '../audio/SoundEngine';
import type { GameMode, GameState, GraphicsQuality, HudSnapshot, RunSummary } from '../types/game';
import { InputManager } from './InputManager';
import { TrackSpawner } from './TrackSpawner';

export interface EngineCallbacks {
  onHudUpdate: (hud: HudSnapshot) => void;
  onCallout: (text: string) => void;
  onStateChange: (state: GameState) => void;
  onGameOver: (summary: RunSummary) => void;
}

export class SkyGlideEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sky: SkyDome;
  private readonly glider: PlayerGlider;
  private readonly particles: ParticleSystem;
  private readonly builder: WorldBuilder;
  private readonly spawner: TrackSpawner;
  private readonly input: InputManager;
  private readonly sound: SoundEngine;
  private readonly callbacks: EngineCallbacks;

  private state: GameState = 'title';
  private mode: GameMode = 'arcade';
  private quality: GraphicsQuality = 'balanced';

  // Player flight physics
  private readonly playerPos = new THREE.Vector3(0, 1.5, 0);
  private velX = 0;
  private velY = 0;
  private forwardSpeed = 29;
  private cameraShake = 0;
  private showcaseAngle = 0;

  // Run stats
  private score = 0;
  private distance = 0;
  private starsRun = 0;
  private ringsPassed = 0;
  private combo = 1;
  private maxCombo = 1;
  private comboTimer = 0;
  private comboWindow = 4.5;
  private hearts = 3;
  private maxHearts = 3;
  private shieldActive = false;
  private invincibleTimer = 0;
  private boostEnergy = 100;
  private boostCapacity = 100;
  private isBoosting = false;
  private wasBoosting = false;
  private magnetRadius = 3.5;
  private closeCallCooldown = 0;

  // Scratch vectors to avoid per-frame allocations
  private readonly thrusterL = new THREE.Vector3();
  private readonly thrusterR = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();

  private rafId = 0;
  private lastFrameMs = 0;
  private hudThrottle = 0;

  constructor(
    canvas: HTMLCanvasElement,
    input: InputManager,
    sound: SoundEngine,
    callbacks: EngineCallbacks
  ) {
    this.input = input;
    this.sound = sound;
    this.callbacks = callbacks;

    const settings = storage.getSettings();
    this.quality = settings.quality;
    this.mode = settings.preferredMode;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.quality !== 'saver',
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.applyQualitySettings(this.quality);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.2, 650);

    const textures = createProceduralTextures();
    this.sky = new SkyDome(this.scene, this.quality !== 'saver');
    this.glider = new PlayerGlider(textures);
    this.scene.add(this.glider.root);

    this.particles = new ParticleSystem(this.scene, textures);
    this.builder = new WorldBuilder(textures);
    this.spawner = new TrackSpawner(this.scene, this.builder);

    this.syncCosmeticsFromProfile();
    this.spawner.reset('chill', 0);

    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.handleResize();
  }

  startLoop(): void {
    this.lastFrameMs = performance.now();
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      const rawDt = (now - this.lastFrameMs) / 1000;
      this.lastFrameMs = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
      this.step(dt);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.renderer.dispose();
  }

  getState(): GameState {
    return this.state;
  }

  applyQualitySettings(quality: GraphicsQuality): void {
    this.quality = quality;
    const dprCap = quality === 'high' ? 2.0 : quality === 'balanced' ? 1.5 : 1.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.renderer.shadowMap.enabled = quality !== 'saver';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sky?.setShadowEnabled(quality !== 'saver');
  }

  syncCosmeticsFromProfile(): void {
    const profile = storage.getActiveProfile();
    this.glider.applyCosmetics(profile.equipped.wing, profile.equipped.aviator);
  }

  openHangar(): void {
    this.syncCosmeticsFromProfile();
    this.state = 'hangar';
    this.input.setEnabled(false);
    this.showcaseAngle = 0.5;
    this.callbacks.onStateChange('hangar');
  }

  returnToTitle(): void {
    this.syncCosmeticsFromProfile();
    this.state = 'title';
    this.input.setEnabled(false);
    this.playerPos.set(0, 1.5, 0);
    this.spawner.reset('chill', 0);
    this.sound.setFlightState(false, 0, false, this.sky.getDayWarmth());
    this.callbacks.onStateChange('title');
  }

  startRun(mode: GameMode): void {
    const profile = storage.getActiveProfile();
    this.mode = mode;
    this.syncCosmeticsFromProfile();

    this.playerPos.set(0, 1.5, 0);
    this.glider.root.position.copy(this.playerPos);
    this.velX = 0;
    this.velY = 0;
    this.forwardSpeed = 29;
    this.cameraShake = 0;

    this.score = 0;
    this.distance = 0;
    this.starsRun = 0;
    this.ringsPassed = 0;
    this.combo = 1;
    this.maxCombo = 1;
    this.comboTimer = 0;
    this.comboWindow = 4.5 + profile.upgrades.combo * 0.7;
    this.magnetRadius = 3.5 + profile.upgrades.magnet * 1.4;

    this.maxHearts = getMaxHearts(profile.upgrades.shield);
    this.hearts = this.maxHearts;
    this.shieldActive = false;
    this.invincibleTimer = 0;

    this.boostCapacity = 100 + profile.upgrades.turbo * 18;
    this.boostEnergy = this.boostCapacity;
    this.isBoosting = false;
    this.wasBoosting = false;
    this.closeCallCooldown = 0;

    this.spawner.reset(mode, profile.upgrades.shield);
    this.state = 'playing';
    this.input.setInvertY(storage.getSettings().invertY);
    this.input.setEnabled(true);
    this.callbacks.onStateChange('playing');
    this.emitHud(true);
  }

  pauseRun(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.setEnabled(false);
    this.sound.setFlightState(false, 0, false, this.sky.getDayWarmth());
    this.callbacks.onStateChange('paused');
  }

  resumeRun(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.setEnabled(true);
    this.callbacks.onStateChange('playing');
  }

  endCurrentRun(): void {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    this.finishRun();
  }

  private step(dt: number): void {
    this.builder.animateSharedTextures(dt);

    if (this.state === 'paused' || this.state === 'gameover') {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.state === 'title' || this.state === 'hangar') {
      this.stepShowcase(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.stepGameplay(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private stepShowcase(dt: number): void {
    const t = performance.now() * 0.001;
    const speed = 18;
    this.playerPos.z -= speed * dt;
    this.playerPos.x = Math.sin(t * 0.55) * 4.5;
    this.playerPos.y = 2.0 + Math.cos(t * 0.8) * 1.1;

    this.glider.root.position.copy(this.playerPos);
    const bankHint = Math.cos(t * 0.55) * 0.45;
    const pitchHint = -Math.sin(t * 0.8) * 0.25;
    this.glider.update(dt, bankHint, pitchHint, false, 0, false);

    this.sky.update(dt * 0.5, this.playerPos);
    this.spawner.update(this.playerPos.z, dt);

    const profile = storage.getActiveProfile();
    this.glider.getThrusterWorldPositions(this.thrusterL, this.thrusterR);
    this.particles.emitTrail(dt, this.thrusterL, this.thrusterR, profile.equipped.trail, false);
    this.particles.update(dt);

    if (this.state === 'hangar') {
      this.showcaseAngle += dt * 0.35;
      const offsetX = Math.sin(this.showcaseAngle) * 4.2 - 1.35;
      const offsetZ = Math.cos(this.showcaseAngle) * 4.2;
      this.camTarget.set(this.playerPos.x + offsetX, this.playerPos.y + 1.35, this.playerPos.z + offsetZ);
      this.camera.position.lerp(this.camTarget, Math.min(1, dt * 5));
      this.lookTarget.set(this.playerPos.x + 1.85, this.playerPos.y + 0.15, this.playerPos.z);
      this.camera.lookAt(this.lookTarget);
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 50, Math.min(1, dt * 6));
      this.camera.updateProjectionMatrix();
    } else {
      this.camTarget.set(this.playerPos.x * 0.72, this.playerPos.y + 2.35, this.playerPos.z + 6.9);
      this.camera.position.lerp(this.camTarget, Math.min(1, dt * 4.5));
      this.lookTarget.set(this.playerPos.x, this.playerPos.y + 0.4, this.playerPos.z - 14);
      this.camera.lookAt(this.lookTarget);
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 60, Math.min(1, dt * 5));
      this.camera.updateProjectionMatrix();
    }
  }

  private stepGameplay(dt: number): void {
    const profile = storage.getActiveProfile();
    const ctrl = this.input.sample();

    if (ctrl.spinRequested && this.glider.triggerBarrelRoll()) {
      this.sound.playBarrelRoll();
      this.particles.emitBurst(this.playerPos, 0x7dd3fc, 16, 6.0);
    }

    // Turbo boost handling
    const canBoost = ctrl.boostHeld && this.boostEnergy > 1;
    this.isBoosting = canBoost;
    if (this.isBoosting && !this.wasBoosting) {
      this.sound.playBoostStart();
    }
    this.wasBoosting = this.isBoosting;

    if (this.isBoosting) {
      this.boostEnergy = Math.max(0, this.boostEnergy - dt * 36);
    } else {
      const passiveRegen = 6 + profile.upgrades.turbo * 1.6;
      this.boostEnergy = Math.min(this.boostCapacity, this.boostEnergy + dt * passiveRegen);
    }

    // Progressive speed curve (29 -> 52 u/s)
    const baseSpeed = Math.min(52, 29 + this.distance * 0.0085);
    const targetForward = this.isBoosting ? baseSpeed * 1.56 : baseSpeed;
    this.forwardSpeed = THREE.MathUtils.lerp(this.forwardSpeed, targetForward, Math.min(1, dt * 6));

    // Responsive steering with smooth damping
    const maxLatSpeed = 24;
    const maxVertSpeed = 17;
    this.velX = THREE.MathUtils.lerp(this.velX, ctrl.steerX * maxLatSpeed, Math.min(1, dt * 8.5));
    this.velY = THREE.MathUtils.lerp(this.velY, ctrl.steerY * maxVertSpeed, Math.min(1, dt * 8.5));

    this.playerPos.x += this.velX * dt;
    this.playerPos.y += this.velY * dt;
    this.playerPos.z -= this.forwardSpeed * dt;

    // Gentle flight corridor soft limits
    if (this.playerPos.x < -19) {
      this.playerPos.x = -19;
      this.velX = Math.max(0, this.velX);
    } else if (this.playerPos.x > 19) {
      this.playerPos.x = 19;
      this.velX = Math.min(0, this.velX);
    }

    if (this.playerPos.y < -8) {
      this.playerPos.y = -8;
      this.velY = Math.max(0, this.velY);
    } else if (this.playerPos.y > 12) {
      this.playerPos.y = 12;
      this.velY = Math.min(0, this.velY);
    }

    this.distance = Math.floor(-this.playerPos.z);
    this.score += Math.floor(dt * 12 * this.combo * (this.isBoosting ? 1.5 : 1));

    // Combo decay timer
    if (this.combo > 1) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1;
        this.comboTimer = 0;
      }
    }

    if (this.invincibleTimer > 0) this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
    if (this.closeCallCooldown > 0) this.closeCallCooldown = Math.max(0, this.closeCallCooldown - dt);
    if (this.cameraShake > 0) this.cameraShake = Math.max(0, this.cameraShake - dt * 3.5);

    this.glider.root.position.copy(this.playerPos);
    this.glider.update(
      dt,
      ctrl.steerX,
      ctrl.steerY,
      this.isBoosting,
      this.invincibleTimer,
      this.shieldActive
    );

    this.sky.update(dt, this.playerPos);
    this.spawner.update(this.playerPos.z, dt);
    this.checkInteractions(dt);

    // Trail & Particles
    this.glider.getThrusterWorldPositions(this.thrusterL, this.thrusterR);
    this.particles.emitTrail(dt, this.thrusterL, this.thrusterR, profile.equipped.trail, this.isBoosting);
    this.particles.update(dt);

    // Dynamic chase camera + boost FOV kick
    const shakeX = this.cameraShake > 0 ? (Math.random() - 0.5) * this.cameraShake * 0.7 : 0;
    const shakeY = this.cameraShake > 0 ? (Math.random() - 0.5) * this.cameraShake * 0.7 : 0;
    this.camTarget.set(
      this.playerPos.x * 0.78 + shakeX,
      this.playerPos.y + 2.45 + shakeY,
      this.playerPos.z + (this.isBoosting ? 7.6 : 6.7)
    );
    this.camera.position.lerp(this.camTarget, Math.min(1, dt * 8));
    this.lookTarget.set(this.playerPos.x * 0.92, this.playerPos.y + 0.35, this.playerPos.z - 16);
    this.camera.lookAt(this.lookTarget);

    const targetFov = this.isBoosting ? 73 : 60 + Math.min(5, (this.forwardSpeed - 29) * 0.18);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 7));
      this.camera.updateProjectionMatrix();
    }

    const speedRatio = THREE.MathUtils.clamp((this.forwardSpeed - 29) / 40, 0, 1);
    this.sound.setFlightState(true, speedRatio, this.isBoosting, this.sky.getDayWarmth());

    this.hudThrottle += dt;
    if (this.hudThrottle >= 0.06) {
      this.hudThrottle = 0;
      this.emitHud(false);
    }
  }

  private checkInteractions(dt: number): void {
    const rolling = this.glider.isBarrelRolling();
    const pullRadius = rolling ? this.magnetRadius * 1.9 : this.magnetRadius;

    // 1. Golden Rings
    for (const ring of this.spawner.rings) {
      if (ring.collected) continue;
      const dz = Math.abs(ring.position.z - this.playerPos.z);
      if (dz < 2.2) {
        const dxy = Math.hypot(ring.position.x - this.playerPos.x, ring.position.y - this.playerPos.y);
        if (dxy < 3.45) {
          ring.collected = true;
          ring.mesh.visible = false;
          this.ringsPassed += 1;
          this.combo = Math.min(10, this.combo + 1);
          if (this.combo > this.maxCombo) this.maxCombo = this.combo;
          this.comboTimer = this.comboWindow;
          this.boostEnergy = Math.min(this.boostCapacity, this.boostEnergy + this.boostCapacity * 0.18);

          const pts = Math.round(100 * this.combo * (this.isBoosting ? 1.5 : 1));
          this.score += pts;
          this.sound.playRing(this.combo);
          this.particles.emitBurst(ring.position, 0xfde047, 26, 8.5);
          if (this.combo >= 4 && this.combo % 2 === 0) {
            this.callbacks.onCallout(`x${this.combo} RING CHAIN!`);
          }
          this.emitHud(true);
        }
      }
    }

    // 2. Stars (with smooth magnet pull)
    for (const star of this.spawner.stars) {
      if (star.collected) continue;
      const dist = star.position.distanceTo(this.playerPos);
      if (dist < pullRadius) {
        star.position.lerp(this.playerPos, Math.min(1, dt * 13));
        star.mesh.position.copy(star.position);
      }
      if (dist < 1.85) {
        star.collected = true;
        star.mesh.visible = false;
        this.starsRun += 1;
        this.score += 25 * this.combo;
        this.sound.playStar();
        this.particles.emitBurst(star.position, 0xfef08a, 10, 4.5);
        this.emitHud(false);
      }
    }

    // 3. Hearts & Shield Pickups
    for (const p of this.spawner.pickups) {
      if (p.collected) continue;
      if (p.position.distanceTo(this.playerPos) < 2.4) {
        p.collected = true;
        p.mesh.visible = false;
        this.sound.playPowerup();
        if (p.kind === 'shield') {
          this.shieldActive = true;
          this.particles.emitBurst(p.position, 0x38bdf8, 22, 6.5);
          this.callbacks.onCallout('BUBBLE SHIELD!');
        } else {
          if (this.hearts < this.maxHearts) {
            this.hearts += 1;
            this.callbacks.onCallout('+1 HEART!');
          } else {
            this.score += 200;
            this.callbacks.onCallout('+200 BONUS!');
          }
          this.particles.emitBurst(p.position, 0xfb7185, 22, 6.5);
        }
        this.emitHud(true);
      }
    }

    if (this.mode !== 'arcade') return;

    // 4. Thunderclouds & Close Calls
    for (const h of this.spawner.hazards) {
      if (h.hit) continue;
      const dist = h.position.distanceTo(this.playerPos);
      if (dist < h.radius + 0.95) {
        h.hit = true;
        if (rolling) {
          h.mesh.visible = false;
          this.score += 200;
          this.sound.playCloseCall();
          this.particles.emitBurst(h.position, 0x67e8f9, 24, 9);
          this.callbacks.onCallout('+200 SPIN DEFLECT!');
          this.emitHud(true);
        } else {
          this.handleHazardBounce(h.position);
        }
      } else if (!h.closeCallAwarded && dist < h.radius + 3.2 && this.closeCallCooldown <= 0) {
        h.closeCallAwarded = true;
        this.closeCallCooldown = 1.4;
        this.score += 150;
        this.sound.playCloseCall();
        this.callbacks.onCallout('+150 CLOSE CALL!');
        this.emitHud(true);
      }
    }

    // 5. Floating Island Edges (gentle bounce + close call)
    for (const isl of this.spawner.islands) {
      const dx = this.playerPos.x - isl.position.x;
      const dy = this.playerPos.y - (isl.position.y - 1.5);
      const dz = this.playerPos.z - isl.position.z;
      const dist = Math.hypot(dx, dy * 1.15, dz);
      if (dist < isl.radius + 0.85) {
        this.handleHazardBounce(isl.position);
      } else if (!isl.closeCallAwarded && dist < isl.radius + 3.6 && this.closeCallCooldown <= 0) {
        isl.closeCallAwarded = true;
        this.closeCallCooldown = 1.6;
        this.score += 150;
        this.sound.playCloseCall();
        this.callbacks.onCallout('+150 ISLAND SKIM!');
        this.emitHud(true);
      }
    }
  }

  private handleHazardBounce(sourcePos: THREE.Vector3): void {
    if (this.invincibleTimer > 0) return;

    // Friendly bounce impulse away from obstacle
    const pushX = this.playerPos.x >= sourcePos.x ? 14 : -14;
    const pushY = this.playerPos.y >= sourcePos.y ? 9 : -7;
    this.velX = pushX;
    this.velY = pushY;
    this.cameraShake = 0.9;
    this.sound.playBounce();
    this.particles.emitBurst(this.playerPos, 0xffffff, 18, 6);

    if (this.shieldActive) {
      this.shieldActive = false;
      this.invincibleTimer = 1.6;
      this.callbacks.onCallout('SHIELD SAVED YOU!');
      this.emitHud(true);
      return;
    }

    this.hearts = Math.max(0, this.hearts - 1);
    this.combo = 1;
    this.comboTimer = 0;
    this.invincibleTimer = 2.2;
    this.emitHud(true);

    if (this.hearts <= 0) {
      this.finishRun();
    }
  }

  private finishRun(): void {
    this.state = 'gameover';
    this.input.setEnabled(false);
    this.sound.setFlightState(false, 0, false, this.sky.getDayWarmth());

    const summary = storage.saveRunResult({
      score: this.score,
      distance: this.distance,
      starsCollected: this.starsRun,
      ringsPassed: this.ringsPassed,
      maxCombo: this.maxCombo,
      mode: this.mode
    });

    this.sound.playGameOver(summary.isNewBest);
    this.callbacks.onStateChange('gameover');
    this.callbacks.onGameOver(summary);
  }

  private emitHud(immediate: boolean): void {
    if (!immediate && this.state !== 'playing') return;
    this.callbacks.onHudUpdate({
      score: this.score,
      distance: this.distance,
      starsRun: this.starsRun,
      combo: this.combo,
      comboTimerRatio: this.combo > 1 ? Math.max(0, this.comboTimer / this.comboWindow) : 0,
      hearts: this.hearts,
      maxHearts: this.maxHearts,
      shieldActive: this.shieldActive,
      boostEnergy: this.boostEnergy / this.boostCapacity,
      isBoosting: this.isBoosting,
      speedRatio: THREE.MathUtils.clamp((this.forwardSpeed - 29) / 40, 0, 1),
      mode: this.mode
    });
  }

  private readonly handleResize = (): void => {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.input.resetAllInputs();
      this.sound.suspend();
      if (this.state === 'playing') {
        this.pauseRun();
      }
    } else {
      this.sound.resume();
    }
  };
}
