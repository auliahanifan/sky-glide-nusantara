import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { getMaxHearts, getStageSpec, getWingSpec } from '../data/catalog';
import { storage } from '../data/storage';
import { createEnvironmentMap, type EnvironmentRig } from '../graphics/EnvironmentRig';
import { ParticleSystem } from '../graphics/ParticleSystem';
import { PlayerGlider } from '../graphics/PlayerGlider';
import { applyTextureAnisotropy, createProceduralTextures } from '../graphics/ProceduralTextures';
import { SkyDome } from '../graphics/SkyDome';
import { WorldBuilder } from '../graphics/WorldBuilder';
import type { SoundEngine } from '../audio/SoundEngine';
import type {
  Difficulty,
  FxEventKind,
  GameMode,
  GameState,
  GraphicsQuality,
  HudSnapshot,
  PerfSnapshot,
  RunConfig,
  RunSummary,
  StageId,
  TrailId,
  UpgradeLevels,
  WingId
} from '../types/game';
import { getTodayDateKey, hashStringToSeed } from '../utils/prng';
import { BossController, type BossStepCallbacks } from './BossController';
import { DebrisSystem } from './DebrisSystem';
import { FlightPhysics } from './FlightPhysics';
import { InputManager } from './InputManager';
import { TrackSpawner } from './TrackSpawner';

export interface EngineCallbacks {
  onHudUpdate: (hud: HudSnapshot) => void;
  onCallout: (text: string, variant?: 'gold' | 'cyan' | 'magenta' | 'emerald') => void;
  onFxEvent: (fx: FxEventKind) => void;
  onStateChange: (state: GameState) => void;
  onGameOver: (summary: RunSummary) => void;
  onPerfUpdate?: (perf: PerfSnapshot) => void;
}

interface CannonBolt {
  mesh: THREE.Group;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  target: THREE.Vector3 | null;
  age: number;
  active: boolean;
}

export class SkyGlideEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly envRig: EnvironmentRig;
  private composerRenderTarget: THREE.WebGLRenderTarget;
  private composerSamples = 0;

  private readonly sky: SkyDome;
  private readonly glider: PlayerGlider;
  private readonly particles: ParticleSystem;
  private readonly debris: DebrisSystem;
  private readonly builder: WorldBuilder;
  private readonly spawner: TrackSpawner;
  private readonly boss: BossController;
  private readonly physics = new FlightPhysics();
  private readonly input: InputManager;
  private readonly sound: SoundEngine;
  private readonly callbacks: EngineCallbacks;

  private readonly lockReticle: THREE.Group;
  private readonly cannonBolts: CannonBolt[] = [];
  private lockedTargetPos: THREE.Vector3 | null = null;
  private cannonCooldown = 0;
  private bossCannonChips = 0;

  private state: GameState = 'title';
  private mode: GameMode = 'stage';
  private stageId: StageId = 1;
  private difficulty: Difficulty = 'normal';
  private maxQuality: GraphicsQuality = 'balanced';
  private effectiveQuality: GraphicsQuality = 'balanced';
  private autoQualityEnabled = true;
  private showFps = false;
  private usePostProcessing = true;

  // Cached profile cosmetics & upgrades (never polled per frame)
  private cachedTrailId: TrailId = 'golden_dust';
  private cachedUpgrades: UpgradeLevels = { magnet: 0, turbo: 0, shield: 0, combo: 0 };

  // Flight state & camera
  private readonly playerPos = new THREE.Vector3(0, 1.5, 0);
  private forwardSpeed = 32;
  private cameraShake = 0;
  private camRoll = 0;
  private camZOffset = 6.7;
  private hitstopTimer = 0;
  private showcaseAngle = 0;

  // Run progression & mastery stats
  private score = 0;
  private distance = 0;
  private starsRun = 0;
  private ringsPassed = 0;
  private ringsTotalSeen = 0;
  private bullseyes = 0;
  private grazes = 0;
  private deflects = 0;
  private feverCount = 0;
  private skillUses = 0;
  private hitsTaken = 0;
  private bossKillsThisRun = 0;
  private bossDefeated = false;
  private bossHitsTaken = 0;
  private nextEndlessBossDist = 1400;
  private endlessWave = 0;

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
  private magnetRadius = 4.0;
  private grazeCooldown = 0;

  // Overdrive Fever & Power-up timers
  private feverGauge = 0;
  private feverActive = false;
  private feverTimer = 0;
  private readonly feverDuration = 7.5;
  private starFrenzyTimer = 0;
  private superMagnetTimer = 0;
  private phaseDashTimer = 0;

  // Active Wing Skill
  private activeWingId: WingId = 'garuda_nusantara';
  private skillCooldownMax = 11;
  private skillCooldownLeft = 0;

  // Rival target cache
  private rivalLabel = 'ACE BENCHMARK';
  private rivalScore = 12000;

  // Scratch vectors (zero GC in hot loops)
  private readonly thrusterL = new THREE.Vector3();
  private readonly thrusterR = new THREE.Vector3();
  private readonly wingtipL = new THREE.Vector3();
  private readonly wingtipR = new THREE.Vector3();
  private readonly cannonL = new THREE.Vector3();
  private readonly cannonR = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchC = new THREE.Vector3();

  // Cached Boss callback objects
  private readonly bossUpdateCallbacks: BossStepCallbacks;
  private readonly bossDirectCallbacks: BossStepCallbacks;

  // Performance & Auto-Quality telemetry
  private readonly frameMsSamples = new Float32Array(60);
  private readonly sortedScratch = new Float32Array(60);
  private frameSampleIdx = 0;
  private frameSampleCount = 0;
  private perfReportTimer = 0;
  private slowWindowSec = 0;
  private fastWindowSec = 0;
  private autoScaleCooldownSec = 0;
  private runElapsed = 0;
  private lastRenderCalls = 0;

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
    this.maxQuality = settings.quality;
    this.effectiveQuality = settings.quality;
    this.autoQualityEnabled = settings.autoQuality;
    this.showFps = settings.showFps;
    this.mode = settings.preferredMode;
    this.stageId = settings.preferredStage;
    this.difficulty = settings.preferredDifficulty;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.effectiveQuality !== 'saver',
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.2, 650);

    // Procedural HDR-like IBL Environment
    this.envRig = createEnvironmentMap(this.renderer);
    this.scene.environment = this.envRig.envMap;
    this.scene.environmentIntensity = 1.1;

    const textures = createProceduralTextures();
    applyTextureAnisotropy(
      textures,
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    );

    this.sky = new SkyDome(this.scene, this.effectiveQuality !== 'saver', textures);
    this.glider = new PlayerGlider(textures);
    this.scene.add(this.glider.root);

    this.particles = new ParticleSystem(this.scene, textures);
    this.debris = new DebrisSystem(this.scene);
    this.builder = new WorldBuilder(textures);
    this.spawner = new TrackSpawner(this.scene, this.builder);
    this.boss = new BossController(this.scene, this.builder, this.particles, this.debris);

    this.lockReticle = this.builder.createLockReticle();
    this.lockReticle.visible = false;
    this.scene.add(this.lockReticle);

    // Prewarm pooled player cannon bolts
    for (let i = 0; i < 28; i++) {
      const mesh = this.builder.createPlasmaBolt(0x00f0ff);
      mesh.visible = false;
      this.scene.add(mesh);
      this.cannonBolts.push({
        mesh,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        target: null,
        age: 0,
        active: false
      });
    }

    // Post-processing pipeline (RenderPass -> Half-Res UnrealBloomPass -> OutputPass)
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.composerSamples = this.effectiveQuality === 'high' ? 2 : 0;
    this.composerRenderTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: this.composerSamples
    });
    this.composer = new EffectComposer(this.renderer, this.composerRenderTarget);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(2, Math.floor(w * 0.5)), Math.max(2, Math.floor(h * 0.5))),
      0.28,
      0.34,
      0.94
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.bossUpdateCallbacks = {
      onBossHit: (_dmg, defeated) => {
        const mult = this.feverActive ? 2 : 1;
        this.cameraShake = 0.65;
        if (defeated) {
          this.handleBossDefeated();
        } else {
          this.sound.playBossHit();
          this.score += 350 * mult;
          this.callbacks.onCallout('DIRECT HIT!', 'cyan');
        }
        this.emitHud(true);
      },
      onPlayerHit: (sourcePos) => {
        if (this.invincibleTimer <= 0 && !this.feverActive && this.phaseDashTimer <= 0) {
          this.bossHitsTaken += 1;
          this.handleHazardBounce(sourcePos);
        }
      },
      onGraze: (pos) => this.awardGraze(pos),
      onDeflect: (_pos) => {
        const mult = this.feverActive ? 2 : 1;
        this.deflects += 1;
        this.hitstopTimer = 0.045;
        this.cameraShake = 0.7;
        this.score += 450 * this.combo * mult;
        this.addFever(18);
        this.sound.playDeflect();
        this.callbacks.onFxEvent('deflect');
        this.callbacks.onCallout('COUNTER DEFLECT!', 'cyan');
        this.emitHud(true);
      },
      onChargeRing: (isBullseye) => {
        const mult = this.feverActive ? 2 : 1;
        this.ringsPassed += 1;
        this.ringsTotalSeen += 1;
        this.combo = Math.min(10, this.combo + 1);
        if (this.combo > this.maxCombo) this.maxCombo = this.combo;
        this.comboTimer = this.comboWindow;
        this.boostEnergy = Math.min(
          this.boostCapacity,
          this.boostEnergy + this.boostCapacity * 0.22
        );
        if (isBullseye) {
          this.bullseyes += 1;
          this.score += 320 * this.combo * mult;
          this.addFever(16);
          this.callbacks.onFxEvent('bullseye');
          this.callbacks.onCallout('BULLSEYE BOLT x2 DMG!', 'gold');
        } else {
          this.score += 140 * this.combo * mult;
          this.addFever(9);
          this.callbacks.onCallout('PLASMA LOCK!', 'cyan');
        }
        this.sound.playRing(this.combo, isBullseye);
        this.emitHud(true);
      }
    };

    this.bossDirectCallbacks = {
      onBossHit: (_dmg, defeated) => {
        const mult = this.feverActive ? 2 : 1;
        this.cameraShake = 0.45;
        if (defeated) {
          this.handleBossDefeated();
        } else {
          this.sound.playBossHit();
          this.score += 250 * mult;
        }
        this.emitHud(true);
      },
      onPlayerHit: () => undefined,
      onGraze: () => undefined,
      onDeflect: () => undefined,
      onChargeRing: () => undefined
    };

    this.applyQualitySettings(this.maxQuality);
    this.syncCosmeticsFromProfile();
    this.sky.setTargetBiome(this.stageId, true);
    this.spawner.reset('stage', this.stageId, 'normal', 0);

    Object.assign(window, {
      __skyGlide: {
        renderer: this.renderer,
        scene: this.scene,
        camera: this.camera
      }
    });

    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.handleResize();

    // Pre-compile WebGL shaders at startup to avoid first-use hitches
    this.renderer.compile(this.scene, this.camera);
  }

  startLoop(): void {
    this.lastFrameMs = performance.now();
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      const rawDt = (now - this.lastFrameMs) / 1000;
      this.lastFrameMs = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
      this.recordFrameTiming(rawDt * 1000, dt);
      this.step(dt);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.composerRenderTarget.dispose();
    this.composer.dispose();
    this.envRig.dispose();
    this.renderer.dispose();
  }

  getState(): GameState {
    return this.state;
  }

  setAutoQuality(enabled: boolean): void {
    this.autoQualityEnabled = enabled;
    this.slowWindowSec = 0;
    this.fastWindowSec = 0;
    if (!enabled && this.effectiveQuality !== this.maxQuality) {
      this.applyRuntimeQuality(this.maxQuality);
    }
  }

  setShowFps(enabled: boolean): void {
    this.showFps = enabled;
  }

  applyQualitySettings(quality: GraphicsQuality): void {
    this.maxQuality = quality;
    this.slowWindowSec = 0;
    this.fastWindowSec = 0;
    this.autoScaleCooldownSec = 0;
    this.applyRuntimeQuality(quality);
  }

  private applyRuntimeQuality(quality: GraphicsQuality): void {
    this.effectiveQuality = quality;
    const dprCap = quality === 'high' ? 1.5 : quality === 'balanced' ? 1.25 : 1.0;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = quality !== 'saver';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.usePostProcessing = quality !== 'saver';

    this.scene.environmentIntensity =
      quality === 'high' ? 1.15 : quality === 'balanced' ? 1.05 : 0.9;
    this.sky.setQuality(quality);
    this.particles.setPixelRatio(dpr);
    this.particles.setQuality(quality);

    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);

    const desiredSamples = quality === 'high' ? 2 : 0;
    if (desiredSamples !== this.composerSamples) {
      this.composerSamples = desiredSamples;
      const oldRt = this.composerRenderTarget;
      this.composerRenderTarget = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        samples: desiredSamples
      });
      this.composer.reset(this.composerRenderTarget);
      oldRt.dispose();
    }

    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(Math.max(2, Math.floor(w * 0.5)), Math.max(2, Math.floor(h * 0.5)));
  }

  private recordFrameTiming(rawMs: number, clampedDt: number): void {
    if (rawMs > 0 && rawMs <= 250) {
      this.frameMsSamples[this.frameSampleIdx] = rawMs;
      this.frameSampleIdx = (this.frameSampleIdx + 1) % 60;
      if (this.frameSampleCount < 60) this.frameSampleCount++;
    }

    if (this.autoScaleCooldownSec > 0) {
      this.autoScaleCooldownSec = Math.max(0, this.autoScaleCooldownSec - clampedDt);
    }

    this.perfReportTimer += clampedDt;
    if (this.perfReportTimer < 0.25 || this.frameSampleCount < 10) return;
    this.perfReportTimer = 0;

    let sum = 0;
    for (let i = 0; i < this.frameSampleCount; i++) {
      const v = this.frameMsSamples[i];
      sum += v;
      this.sortedScratch[i] = v;
    }
    const avgMs = sum / this.frameSampleCount;
    const view = this.sortedScratch.subarray(0, this.frameSampleCount);
    view.sort();
    const p95Ms = view[Math.min(this.frameSampleCount - 1, Math.floor(this.frameSampleCount * 0.95))];
    const fps = Math.max(1, Math.round(1000 / avgMs));

    if (this.showFps) {
      this.callbacks.onPerfUpdate?.({
        fps,
        frameMs: avgMs,
        p95Ms,
        effectiveQuality: this.effectiveQuality,
        autoScaled: this.effectiveQuality !== this.maxQuality,
        drawCalls: this.lastRenderCalls
      });
    }

    if (
      this.autoQualityEnabled &&
      this.state === 'playing' &&
      this.runElapsed > 2.5 &&
      this.autoScaleCooldownSec <= 0
    ) {
      if (avgMs > 21.5) {
        this.slowWindowSec += 0.25;
        this.fastWindowSec = 0;
        if (this.slowWindowSec >= 2.0) {
          const nextDown: GraphicsQuality | null =
            this.effectiveQuality === 'high'
              ? 'balanced'
              : this.effectiveQuality === 'balanced'
                ? 'saver'
                : null;
          if (nextDown) {
            this.applyRuntimeQuality(nextDown);
            this.autoScaleCooldownSec = 3.0;
          }
          this.slowWindowSec = 0;
        }
      } else if (avgMs < 13.5 && this.effectiveQuality !== this.maxQuality) {
        this.fastWindowSec += 0.25;
        this.slowWindowSec = 0;
        if (this.fastWindowSec >= 6.0) {
          const nextUp: GraphicsQuality | null =
            this.effectiveQuality === 'saver'
              ? 'balanced'
              : this.effectiveQuality === 'balanced' && this.maxQuality === 'high'
                ? 'high'
                : null;
          if (nextUp) {
            this.applyRuntimeQuality(nextUp);
            this.autoScaleCooldownSec = 3.0;
          }
          this.fastWindowSec = 0;
        }
      } else {
        this.slowWindowSec = Math.max(0, this.slowWindowSec - 0.125);
        this.fastWindowSec = Math.max(0, this.fastWindowSec - 0.125);
      }
    }
  }

  setTitlePreviewBiome(stageId: StageId): void {
    if (this.state === 'title') {
      this.sky.setTargetBiome(stageId, false);
    }
  }

  syncCosmeticsFromProfile(): void {
    const profile = storage.getActiveProfile();
    this.activeWingId = profile.equipped.wing;
    this.cachedTrailId = profile.equipped.trail;
    this.cachedUpgrades = { ...profile.upgrades };
    this.glider.applyCosmetics(profile.equipped.wing, profile.equipped.aviator);
  }

  previewMountSwitchEffect(): void {
    this.glider.triggerSwitchPop();
    const spec = getWingSpec(this.activeWingId);
    this.particles.emitBurst(this.playerPos, spec.trimColor, 28, 7.5);
  }

  openHangar(): void {
    this.syncCosmeticsFromProfile();
    this.state = 'hangar';
    this.input.setEnabled(false);
    this.lockReticle.visible = false;
    this.showcaseAngle = 0.5;
    this.callbacks.onStateChange('hangar');
  }

  returnToTitle(): void {
    this.boss.clear();
    this.clearCannonBolts();
    this.debris.clear();
    this.lockReticle.visible = false;
    this.syncCosmeticsFromProfile();
    this.state = 'title';
    this.input.setEnabled(false);
    this.playerPos.set(0, 1.5, 0);
    this.camRoll = 0;
    this.camZOffset = 6.7;
    const settings = storage.getSettings();
    this.sky.setTargetBiome(settings.preferredStage, false);
    this.spawner.reset('stage', settings.preferredStage, 'normal', 0);
    this.sound.setFlightState(false, 0, false, false, false, settings.preferredStage);
    this.callbacks.onStateChange('title');
  }

  startRun(config: RunConfig): void {
    const profile = storage.getActiveProfile();
    this.mode = config.mode;
    this.stageId = config.mode === 'endless' ? 1 : config.stageId;
    this.difficulty = config.difficulty;
    this.activeWingId = profile.equipped.wing;
    this.cachedTrailId = profile.equipped.trail;
    this.cachedUpgrades = { ...profile.upgrades };
    this.glider.applyCosmetics(profile.equipped.wing, profile.equipped.aviator);

    this.boss.clear();
    this.clearCannonBolts();
    this.debris.clear();
    this.lockReticle.visible = false;
    this.lockedTargetPos = null;
    this.cannonCooldown = 0;
    this.bossCannonChips = 0;

    const initialSpeed = this.difficulty === 'overclocked' ? 35 : 31;
    this.physics.reset(initialSpeed);
    this.playerPos.copy(this.physics.renderPosition);
    this.glider.root.position.copy(this.playerPos);
    this.glider.setPhaseDash(false);
    this.forwardSpeed = initialSpeed;
    this.cameraShake = 0;
    this.camRoll = 0;
    this.camZOffset = 6.7;
    this.hitstopTimer = 0;
    this.runElapsed = 0;
    this.slowWindowSec = 0;
    this.fastWindowSec = 0;

    this.camera.position.set(0, 3.95, 6.7);
    this.camera.lookAt(0, 1.85, -16);

    this.score = 0;
    this.distance = 0;
    this.starsRun = 0;
    this.ringsPassed = 0;
    this.ringsTotalSeen = 0;
    this.bullseyes = 0;
    this.grazes = 0;
    this.deflects = 0;
    this.feverCount = 0;
    this.skillUses = 0;
    this.hitsTaken = 0;
    this.bossKillsThisRun = 0;
    this.bossDefeated = false;
    this.bossHitsTaken = 0;
    this.nextEndlessBossDist = 1400;
    this.endlessWave = 0;

    this.combo = 1;
    this.maxCombo = 1;
    this.comboTimer = 0;
    this.comboWindow =
      4.5 + this.cachedUpgrades.combo * 0.7 + (this.activeWingId === 'enggang_dayak' ? 1.2 : 0);
    this.magnetRadius =
      4.0 + this.cachedUpgrades.magnet * 1.4 + (this.activeWingId === 'cenderawasih_papua' ? 2.5 : 0);

    this.maxHearts = getMaxHearts(this.cachedUpgrades.shield, profile.equipped.wing);
    this.hearts = this.maxHearts;
    this.shieldActive = false;
    this.invincibleTimer = 0;

    this.boostCapacity = 100 + this.cachedUpgrades.turbo * 20;
    this.boostEnergy = this.boostCapacity;
    this.isBoosting = false;
    this.wasBoosting = false;
    this.grazeCooldown = 0;

    this.feverGauge = 0;
    this.feverActive = false;
    this.feverTimer = 0;
    this.starFrenzyTimer = 0;
    this.superMagnetTimer = 0;
    this.phaseDashTimer = 0;

    const wingSpec = getWingSpec(profile.equipped.wing);
    this.skillCooldownMax = Math.max(
      4.5,
      wingSpec.skillCooldown * (1 - this.cachedUpgrades.combo * 0.07)
    );
    this.skillCooldownLeft = 0;

    const rival = storage.getRivalTarget(this.mode, this.stageId);
    this.rivalLabel = rival.label;
    this.rivalScore = rival.score;

    const seed =
      this.mode === 'daily'
        ? hashStringToSeed(`sky_glide_daily_${getTodayDateKey()}`)
        : undefined;

    this.sky.setTargetBiome(this.stageId, true);
    this.spawner.reset(this.mode, this.stageId, this.difficulty, this.cachedUpgrades.shield, seed);

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
    this.sound.setFlightState(false, 0, false, false, false, this.stageId);
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
    this.finishRun(false);
  }

  private clearCannonBolts(): void {
    for (const b of this.cannonBolts) {
      b.active = false;
      b.mesh.visible = false;
    }
  }

  private renderFrame(): void {
    this.renderer.info.reset();
    if (this.usePostProcessing) {
      this.bloomPass.strength = this.feverActive ? 0.42 : this.isBoosting ? 0.34 : 0.26;
      this.renderer.toneMappingExposure = this.feverActive ? 1.08 : 1.02;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.lastRenderCalls = this.renderer.info.render.calls;
  }

  private step(dt: number): void {
    this.builder.animateSharedTextures(dt);

    if (this.state === 'paused' || this.state === 'gameover') {
      this.renderFrame();
      return;
    }

    if (this.state === 'title' || this.state === 'hangar') {
      this.stepShowcase(dt);
      this.renderFrame();
      return;
    }

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      this.renderFrame();
      return;
    }

    this.stepGameplay(dt);
    this.renderFrame();
  }

  private stepShowcase(dt: number): void {
    const t = performance.now() * 0.001;
    const speed = 22;
    this.playerPos.z -= speed * dt;
    const isTitle = this.state === 'title';
    this.playerPos.x = Math.sin(t * (isTitle ? 0.45 : 0.55)) * (isTitle ? 2.2 : 4.5);
    this.playerPos.y = 2.0 + Math.cos(t * (isTitle ? 0.7 : 0.8)) * (isTitle ? 0.55 : 1.1);

    this.glider.root.position.copy(this.playerPos);
    const bankHint = Math.cos(t * (isTitle ? 0.45 : 0.55)) * (isTitle ? 0.3 : 0.45);
    const pitchHint = -Math.sin(t * (isTitle ? 0.7 : 0.8)) * (isTitle ? 0.16 : 0.25);
    this.glider.update(dt, bankHint, pitchHint, false, 0, false, false, 0.72, 1.0);

    this.sky.update(dt * 0.5, this.playerPos, false);
    this.spawner.update(this.playerPos.z, dt);
    this.debris.update(dt);

    this.glider.getThrusterWorldPositions(this.thrusterL, this.thrusterR);
    this.particles.emitTrail(dt, this.thrusterL, this.thrusterR, this.cachedTrailId, false, false);
    this.particles.update(dt, this.playerPos, 0.25, false, false);

    if (this.state === 'hangar') {
      this.showcaseAngle += dt * 0.45;
      const radius = 4.4;
      const offsetX = Math.sin(this.showcaseAngle) * radius;
      const offsetZ = Math.cos(this.showcaseAngle) * radius;
      this.camTarget.set(
        this.playerPos.x + offsetX,
        this.playerPos.y + 1.35,
        this.playerPos.z + offsetZ
      );
      this.camera.position.lerp(this.camTarget, 1 - Math.exp(-dt * 5));
      // Shift lookTarget along camera's right vector so the mount stays centered on the open left half
      const rightX = Math.cos(this.showcaseAngle) * 1.55;
      const rightZ = -Math.sin(this.showcaseAngle) * 1.55;
      this.lookTarget.set(
        this.playerPos.x + rightX,
        this.playerPos.y + 0.15,
        this.playerPos.z + rightZ
      );
      this.camera.lookAt(this.lookTarget);
      if (Math.abs(this.camera.fov - 50) > 0.05) {
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 50, 1 - Math.exp(-dt * 6));
        this.camera.updateProjectionMatrix();
      }
    } else {
      const wideScreen = window.innerWidth >= 860;
      const angle = 0.72 + Math.sin(t * 0.42) * 0.3;
      const radius = wideScreen ? 4.8 : 5.4;
      this.camTarget.set(
        this.playerPos.x + Math.sin(angle) * radius,
        this.playerPos.y + 1.25,
        this.playerPos.z - Math.cos(angle) * radius
      );
      const camAlpha = 1 - Math.exp(-dt * 6);
      this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, this.camTarget.x, camAlpha);
      this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, this.camTarget.y, camAlpha);
      this.camera.position.z = this.camTarget.z;
      if (wideScreen) {
        // Shift lookTarget slightly to the camera's left so the mount sits heroically on the right half
        this.lookTarget.set(
          this.playerPos.x + Math.cos(angle) * 1.45,
          this.playerPos.y - 0.12,
          this.playerPos.z + Math.sin(angle) * 1.45
        );
      } else {
        this.lookTarget.set(this.playerPos.x, this.playerPos.y - 0.35, this.playerPos.z);
      }
      this.camera.lookAt(this.lookTarget);
      if (Math.abs(this.camera.fov - 48) > 0.05) {
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 48, 1 - Math.exp(-dt * 5));
        this.camera.updateProjectionMatrix();
      }
    }
  }

  private stepGameplay(dt: number): void {
    this.runElapsed += dt;
    const ctrl = this.input.sample();

    if (ctrl.spinRequested && this.glider.triggerBarrelRoll()) {
      this.sound.playBarrelRoll();
      this.particles.emitBurst(this.playerPos, 0x00f0ff, 16, 6.0);
    }

    if (ctrl.skillRequested && this.skillCooldownLeft <= 0) {
      this.triggerActiveWingSkill();
    }

    if (this.skillCooldownLeft > 0) {
      this.skillCooldownLeft = Math.max(0, this.skillCooldownLeft - dt);
    }

    if (this.cannonCooldown > 0) {
      this.cannonCooldown = Math.max(0, this.cannonCooldown - dt);
    }

    if (this.starFrenzyTimer > 0) this.starFrenzyTimer = Math.max(0, this.starFrenzyTimer - dt);
    if (this.superMagnetTimer > 0) this.superMagnetTimer = Math.max(0, this.superMagnetTimer - dt);
    if (this.phaseDashTimer > 0) {
      this.phaseDashTimer = Math.max(0, this.phaseDashTimer - dt);
      if (this.phaseDashTimer <= 0) {
        this.glider.setPhaseDash(false);
      }
    }

    if (this.feverActive) {
      this.feverTimer -= dt;
      if (this.feverTimer <= 0) {
        this.feverActive = false;
        this.feverTimer = 0;
        this.feverGauge = 0;
      }
    }

    const forcedTurbo = this.feverActive || this.phaseDashTimer > 0;
    const canBoost = forcedTurbo || (ctrl.boostHeld && this.boostEnergy > 1);
    this.isBoosting = canBoost;
    if (this.isBoosting && !this.wasBoosting) {
      this.sound.playBoostStart();
    }
    this.wasBoosting = this.isBoosting;

    if (!forcedTurbo) {
      if (this.isBoosting) {
        this.boostEnergy = Math.max(0, this.boostEnergy - dt * 34);
      } else {
        const garudaBonus = this.activeWingId === 'garuda_nusantara' ? 1.15 : 1.0;
        const passiveRegen = (7 + this.cachedUpgrades.turbo * 1.9) * garudaBonus;
        this.boostEnergy = Math.min(this.boostCapacity, this.boostEnergy + dt * passiveRegen);
      }
    }

    // Apply Environmental Physics Fields (Thermals, Slipstreams, Newtonian Gravity Wells)
    this.physics.inUpdraft = false;
    this.physics.inSlipstream = false;

    for (const th of this.spawner.thermals) {
      const distXZ = Math.hypot(this.playerPos.x - th.position.x, this.playerPos.z - th.position.z);
      if (distXZ < th.radius) {
        this.physics.inUpdraft = true;
        this.physics.addExternalAcceleration(0, 26.0, 0);
        this.boostEnergy = Math.min(this.boostCapacity, this.boostEnergy + dt * 28);
        if (!th.triggered) {
          th.triggered = true;
          this.sound.playUpdraft();
          this.score += 180;
          this.callbacks.onCallout('THERMAL UPDRAFT!', 'emerald');
        }
      }
    }

    for (const sl of this.spawner.slipstreams) {
      const withinZ =
        this.playerPos.z <= sl.position.z + 2 && this.playerPos.z >= sl.position.z - sl.length;
      const distXY = Math.hypot(this.playerPos.x - sl.position.x, this.playerPos.y - sl.position.y);
      if (withinZ && distXY < sl.radius) {
        this.physics.inSlipstream = true;
        this.score += Math.round(dt * 120);
        if (!sl.entered) {
          sl.entered = true;
          this.sound.playUpdraft();
          this.callbacks.onCallout('JETSTREAM SLIPSTREAM!', 'cyan');
        }
      }
    }

    for (const gw of this.spawner.gravityWells) {
      const dx = gw.position.x - this.playerPos.x;
      const dy = gw.position.y - this.playerPos.y;
      const dz = gw.position.z - this.playerPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const dist = Math.sqrt(distSq);

      if (dist < 2.2) {
        if (!this.feverActive && this.phaseDashTimer <= 0) {
          this.handleHazardBounce(gw.position);
        }
      } else if (dist < gw.radius) {
        gw.enteredInfluence = true;
        const accelMag = gw.strength / (distSq + 7.5);
        this.physics.addExternalAcceleration((dx / dist) * accelMag, (dy / dist) * accelMag, 0);
      }

      if (gw.enteredInfluence && !gw.slingshotAwarded && this.playerPos.z < gw.position.z - 4.5) {
        gw.slingshotAwarded = true;
        this.sound.playSlingshot();
        this.physics.velocity.z -= 8.5;
        this.boostEnergy = Math.min(this.boostCapacity, this.boostEnergy + 30);
        this.score += 500 * this.combo;
        this.addFever(12);
        this.callbacks.onCallout('GRAVITY SLINGSHOT +500!', 'magenta');
      }
    }

    // Step Fixed-Timestep Aerodynamic Flight Simulation (with render interpolation)
    this.physics.step(dt, {
      steerX: ctrl.steerX,
      steerY: ctrl.steerY,
      boosting: this.isBoosting,
      feverActive: this.feverActive,
      phaseDashActive: this.phaseDashTimer > 0,
      distanceMeters: this.distance,
      stageId: this.stageId,
      difficulty: this.difficulty,
      wingId: this.activeWingId
    });

    this.playerPos.copy(this.physics.renderPosition);
    this.forwardSpeed = -this.physics.velocity.z;
    this.distance = Math.floor(-this.physics.position.z);

    if (this.physics.justBrokeMach) {
      this.sound.playSonicBoom();
      this.cameraShake = Math.max(this.cameraShake, 0.45);
      this.callbacks.onFxEvent('sonic_boom');
      this.callbacks.onCallout('MACH 1.0 SONIC BOOM!', 'cyan');
    }

    const feverMult = this.feverActive ? 2 : 1;
    this.score += Math.floor(dt * 15 * this.combo * feverMult * (this.isBoosting ? 1.5 : 1));

    // Boss Trigger
    if (!this.boss.isActive()) {
      const targetLen =
        this.mode === 'daily'
          ? 1800
          : this.mode === 'stage'
            ? getStageSpec(this.stageId).lengthMeters
            : this.nextEndlessBossDist;

      if (this.distance >= targetLen) {
        this.spawnBossEncounter();
      }
    }

    // Combo decay
    if (this.combo > 1) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1;
        this.comboTimer = 0;
      }
    }

    if (this.invincibleTimer > 0) this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
    if (this.grazeCooldown > 0) this.grazeCooldown = Math.max(0, this.grazeCooldown - dt);
    if (this.cameraShake > 0) this.cameraShake = Math.max(0, this.cameraShake - dt * 3.8);

    this.glider.root.position.copy(this.playerPos);
    this.glider.update(
      dt,
      ctrl.steerX,
      ctrl.steerY,
      this.isBoosting,
      this.invincibleTimer,
      this.shieldActive,
      this.feverActive,
      this.physics.mach,
      this.physics.gForce,
      this.physics.renderBankAngle + this.physics.renderWobbleZ,
      this.physics.renderPitchAngle + this.physics.renderWobbleX
    );

    this.sky.update(dt, this.playerPos, this.feverActive);
    this.spawner.update(this.playerPos.z, dt);
    this.updateLockOnAndCannons(dt, ctrl.fireHeld);
    this.checkInteractions(dt);

    // Boss Step
    if (this.boss.isActive()) {
      const bullseyeRadius = this.activeWingId === 'unicorn_sembrani' ? 1.75 : 1.38;
      const grazeRadius = this.activeWingId === 'naga_barong' ? 4.4 : 3.4;
      const isInvulnSmash = this.feverActive || this.phaseDashTimer > 0;

      this.boss.update(
        dt,
        this.playerPos,
        this.forwardSpeed,
        this.glider.isBarrelRolling(),
        isInvulnSmash,
        bullseyeRadius,
        grazeRadius,
        this.bossUpdateCallbacks
      );
    }

    // Particles & Wingtip Condensation Vapor
    const speedRatio = THREE.MathUtils.clamp((this.forwardSpeed - 31) / 48, 0, 1);
    this.glider.getThrusterWorldPositions(this.thrusterL, this.thrusterR);
    this.particles.emitTrail(
      dt,
      this.thrusterL,
      this.thrusterR,
      this.cachedTrailId,
      this.isBoosting,
      this.feverActive
    );

    const vaporIntensity =
      Math.abs(this.physics.renderBankAngle) > 0.28 ||
      this.physics.gForce > 1.6 ||
      this.isBoosting ||
      this.feverActive ||
      this.physics.mach >= 0.96
        ? Math.min(1, Math.abs(this.physics.renderBankAngle) + (this.isBoosting ? 0.5 : 0.2))
        : 0;
    if (vaporIntensity > 0) {
      this.glider.getWingtipWorldPositions(this.wingtipL, this.wingtipR);
      this.particles.emitWingtipVapor(dt, this.wingtipL, this.wingtipR, vaporIntensity);
    }

    this.particles.update(dt, this.playerPos, speedRatio, this.isBoosting, this.feverActive);
    this.debris.update(dt);

    // Dynamic Chase Camera with Interpolated Follow, Z-Lock & Frame-Rate-Independent Damping
    const shakeX = this.cameraShake > 0 ? (Math.random() - 0.5) * this.cameraShake * 0.75 : 0;
    const shakeY = this.cameraShake > 0 ? (Math.random() - 0.5) * this.cameraShake * 0.75 : 0;
    const xyAlpha = 1 - Math.exp(-dt * 10);
    const targetZOff = this.isBoosting || this.physics.inSlipstream ? 7.8 : 6.7;
    this.camZOffset = THREE.MathUtils.lerp(this.camZOffset, targetZOff, 1 - Math.exp(-dt * 7));

    this.camera.position.x = THREE.MathUtils.lerp(
      this.camera.position.x,
      this.playerPos.x * 0.78 + shakeX,
      xyAlpha
    );
    this.camera.position.y = THREE.MathUtils.lerp(
      this.camera.position.y,
      this.playerPos.y + 2.45 + shakeY,
      xyAlpha
    );
    this.camera.position.z = this.playerPos.z + this.camZOffset;

    this.lookTarget.set(this.playerPos.x * 0.92, this.playerPos.y + 0.35, this.playerPos.z - 16);
    this.camera.lookAt(this.lookTarget);

    this.camRoll = THREE.MathUtils.lerp(
      this.camRoll,
      this.physics.renderBankAngle * 0.14,
      1 - Math.exp(-dt * 7)
    );
    this.camera.rotateZ(this.camRoll);

    const targetFov = this.feverActive
      ? 79
      : this.isBoosting || this.physics.inSlipstream
        ? 74
        : 62 + Math.min(7, (this.forwardSpeed - 31) * 0.22);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(
        this.camera.fov,
        targetFov,
        1 - Math.exp(-dt * 7)
      );
      this.camera.updateProjectionMatrix();
    }

    this.sound.setFlightState(
      true,
      speedRatio,
      this.isBoosting || this.physics.inSlipstream,
      this.feverActive,
      this.boss.isActive(),
      this.stageId
    );

    const wingSpec = getWingSpec(this.activeWingId);
    const skillReadyRatio = 1 - this.skillCooldownLeft / Math.max(1, this.skillCooldownMax);
    this.input.updateSkillButton(skillReadyRatio, wingSpec.skillName.split(' ')[0], wingSpec.skillIcon);

    this.hudThrottle += dt;
    if (this.hudThrottle >= 0.06) {
      this.hudThrottle = 0;
      this.emitHud(false);
    }
  }

  private updateLockOnAndCannons(dt: number, fireHeld: boolean): void {
    // 1. Scan forward targets for 3D Lock-On Reticle
    let bestTarget: THREE.Vector3 | null = null;
    let bestScore = Infinity;

    const consider = (pos: THREE.Vector3, weight = 1) => {
      const dz = this.playerPos.z - pos.z;
      if (dz < 4 || dz > 85) return;
      const dxy = Math.hypot(pos.x - this.playerPos.x, pos.y - this.playerPos.y);
      if (dxy > 12) return;
      const metric = (dz * 0.35 + dxy * 3.0) * weight;
      if (metric < bestScore) {
        bestScore = metric;
        bestTarget = pos;
      }
    };

    for (const d of this.spawner.drones) {
      if (!d.destroyed) consider(d.position, 0.7);
    }
    for (const pod of this.spawner.cargoPods) {
      if (!pod.destroyed) consider(pod.position, 0.78);
    }
    for (const h of this.spawner.hazards) {
      if (!h.hit) consider(h.position, 1.0);
    }
    if (this.boss.isActive()) {
      consider(this.boss.position, 0.85);
    }

    this.lockedTargetPos = bestTarget as THREE.Vector3 | null;
    if (this.lockedTargetPos !== null) {
      this.lockReticle.visible = true;
      this.lockReticle.position.copy(this.lockedTargetPos);
      this.lockReticle.lookAt(this.camera.position);
      this.lockReticle.rotation.z += dt * 3.2;
      const pulse = 1 + Math.sin(this.runElapsed * 12) * 0.1;
      this.lockReticle.scale.setScalar(pulse);
    } else {
      this.lockReticle.visible = false;
    }

    // 2. Fire twin wing-mounted plasma cannons (pooled)
    if (fireHeld && this.cannonCooldown <= 0) {
      this.cannonCooldown = this.feverActive ? 0.1 : 0.145;
      this.glider.getCannonWorldPositions(this.cannonL, this.cannonR);
      const wingColor = getWingSpec(this.activeWingId).trimColor;
      const boltSpeed = this.forwardSpeed + 86;
      const lockedTarget = this.lockedTargetPos;

      for (let side = 0; side < 2; side++) {
        const origin = side === 0 ? this.cannonL : this.cannonR;
        let slot = this.cannonBolts.find((b) => !b.active);
        if (!slot) {
          const mesh = this.builder.createPlasmaBolt(wingColor);
          this.scene.add(mesh);
          slot = {
            mesh,
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            target: null,
            age: 0,
            active: true
          };
          this.cannonBolts.push(slot);
        }

        this.builder.setPlasmaBoltColor(slot.mesh, wingColor);
        slot.position.copy(origin);
        slot.mesh.position.copy(origin);

        if (lockedTarget) {
          this.scratchA.copy(lockedTarget).sub(origin).normalize().multiplyScalar(boltSpeed);
          slot.velocity.copy(this.scratchA);
        } else {
          slot.velocity.set(
            this.physics.velocity.x * 0.25,
            this.physics.velocity.y * 0.25,
            -boltSpeed
          );
        }
        slot.target = lockedTarget;
        slot.age = 0;
        slot.active = true;
        slot.mesh.visible = true;
      }
      this.sound.playLaserFire();
    }

    // 3. Advance cannon bolts & resolve impacts
    const feverMult = this.feverActive ? 2 : 1;
    const steerAlpha = 1 - Math.exp(-dt * 8);
    for (const b of this.cannonBolts) {
      if (!b.active) continue;
      b.age += dt;
      if (b.target) {
        const spd = b.velocity.length();
        this.scratchA.copy(b.target).sub(b.position).normalize().multiplyScalar(spd);
        b.velocity.lerp(this.scratchA, steerAlpha);
      }

      b.position.addScaledVector(b.velocity, dt);
      b.mesh.position.copy(b.position);
      this.scratchB.copy(b.position).add(b.velocity);
      b.mesh.lookAt(this.scratchB);

      let consumed = b.age > 1.35;

      // Hit Scout Drones
      if (!consumed) {
        for (const d of this.spawner.drones) {
          if (d.destroyed) continue;
          if (b.position.distanceTo(d.position) < d.radius + 0.9) {
            d.destroyed = true;
            d.mesh.visible = false;
            consumed = true;
            this.destroyScoutDrone(d.position, feverMult);
            break;
          }
        }
      }

      // Hit Cargo Pods
      if (!consumed) {
        for (const pod of this.spawner.cargoPods) {
          if (pod.destroyed) continue;
          if (b.position.distanceTo(pod.position) < pod.radius + 0.9) {
            pod.destroyed = true;
            pod.mesh.visible = false;
            consumed = true;
            this.crackCargoPod(pod.position, feverMult);
            break;
          }
        }
      }

      // Hit Plasma Mines
      if (!consumed) {
        for (const h of this.spawner.hazards) {
          if (h.hit) continue;
          if (b.position.distanceTo(h.position) < h.radius + 0.75) {
            h.hit = true;
            h.mesh.visible = false;
            consumed = true;
            this.sound.playExplosion(false);
            this.scratchC.set(0, 0, -10);
            this.debris.spawnExplosion(h.position, this.scratchC, 0xff2a85, 0x1e293b, 12, 14);
            this.particles.emitBurst(h.position, 0xff2a85, 20, 8);
            this.score += 200 * feverMult;
            this.callbacks.onCallout('+200 MINE CLEARED!', 'cyan');
            break;
          }
        }
      }

      // Hit Boss (every 4 cannon impacts deals 1 Boss DMG)
      if (!consumed && this.boss.isActive()) {
        if (b.position.distanceTo(this.boss.position) < 4.5) {
          consumed = true;
          this.particles.emitBurst(b.position, 0x00f0ff, 8, 5);
          this.bossCannonChips += 1;
          if (this.bossCannonChips >= 4) {
            this.bossCannonChips = 0;
            this.boss.applyDirectDamage(1, this.bossDirectCallbacks);
          }
        }
      }

      if (consumed) {
        b.active = false;
        b.mesh.visible = false;
      }
    }
  }

  private destroyScoutDrone(pos: THREE.Vector3, feverMult: number): void {
    this.sound.playExplosion(false);
    this.scratchC.set(0, 2, -12);
    this.debris.spawnExplosion(pos, this.scratchC, 0xff2a85, 0x334155, 16, 16);
    this.particles.emitBurst(pos, 0xff2a85, 24, 9);
    this.combo = Math.min(10, this.combo + 1);
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.comboTimer = this.comboWindow;
    this.score += 400 * this.combo * feverMult;
    this.addFever(14);
    this.callbacks.onFxEvent('takedown');
    this.callbacks.onCallout(`+${400 * this.combo * feverMult} DRONE TAKEDOWN!`, 'magenta');
    this.emitHud(true);
  }

  private crackCargoPod(pos: THREE.Vector3, feverMult: number): void {
    this.sound.playExplosion(false);
    this.scratchC.set(0, 2, -10);
    this.debris.spawnExplosion(pos, this.scratchC, 0xffd000, 0x475569, 14, 14);
    this.particles.emitBurst(pos, 0xffd000, 26, 9);
    this.score += 300 * feverMult;
    this.addFever(10);

    for (let k = 0; k < 6; k++) {
      const angle = (k / 6) * Math.PI * 2;
      this.scratchA.set(
        pos.x + Math.cos(angle) * 2.2,
        pos.y + Math.sin(angle) * 1.6,
        pos.z - 6 - (k % 3) * 2.5
      );
      this.spawner.spawnBonusStar(this.scratchA);
    }
    this.callbacks.onCallout('CARGO CRACKED // +STARS!', 'gold');
    this.emitHud(true);
  }

  private spawnBossEncounter(): void {
    this.spawner.setBossArenaMode(true);
    this.bossHitsTaken = 0;
    this.boss.spawn(this.stageId, this.difficulty, this.playerPos.z, this.endlessWave);
    this.sound.playBossWarning();
    this.callbacks.onFxEvent('boss_warning');
    this.callbacks.onCallout(`WARNING // ${this.boss.getName()}`, 'magenta');
    this.emitHud(true);
  }

  private handleBossDefeated(): void {
    this.hitstopTimer = 0.07;
    this.cameraShake = 1.25;
    this.bossKillsThisRun += 1;
    this.bossDefeated = true;
    this.sound.playBossDefeat();
    this.sound.playExplosion(true);

    if (this.mode === 'stage' || this.mode === 'daily') {
      this.score += 2500 + (this.bossHitsTaken === 0 ? 1000 : 0);
      this.starsRun += 35;
      this.finishRun(true);
      return;
    }

    this.endlessWave += 1;
    this.stageId = ((this.stageId % 4) + 1) as StageId;
    this.sky.setTargetBiome(this.stageId, false);
    this.spawner.setBiome(this.stageId);
    this.spawner.setBossArenaMode(false);
    this.hearts = this.maxHearts;
    this.starsRun += 45;
    this.score += 2000;
    this.nextEndlessBossDist = this.distance + 1400;

    const nextSpec = getStageSpec(this.stageId);
    this.callbacks.onCallout(`SECTOR WARP → ${nextSpec.name}!`, 'emerald');
    this.emitHud(true);
  }

  private triggerActiveWingSkill(): void {
    const spec = getWingSpec(this.activeWingId);
    this.skillCooldownLeft = this.skillCooldownMax;
    this.skillUses += 1;
    this.sound.playSkill();

    if (spec.skillId === 'pulse_nova') {
      this.glider.triggerPulseNovaVisual();
      this.particles.emitBurst(this.playerPos, 0xffd000, 38, 12);
      this.cameraShake = 0.55;
      for (const h of this.spawner.hazards) {
        if (!h.hit && h.position.distanceTo(this.playerPos) < 24) {
          h.hit = true;
          h.mesh.visible = false;
          this.score += 220;
          this.debris.spawnExplosion(h.position, this.physics.velocity, 0xffd000, 0x1e293b, 10, 12);
          this.particles.emitBurst(h.position, 0xffd000, 16, 7);
        }
      }
      for (const d of this.spawner.drones) {
        if (!d.destroyed && d.position.distanceTo(this.playerPos) < 26) {
          d.destroyed = true;
          d.mesh.visible = false;
          this.destroyScoutDrone(d.position, this.feverActive ? 2 : 1);
        }
      }
      for (const s of this.spawner.stars) {
        if (!s.collected && s.position.distanceTo(this.playerPos) < 28) {
          s.position.copy(this.playerPos);
        }
      }
      if (this.boss.isActive()) {
        this.boss.firePlayerBolt(this.playerPos, 2, 0xffd000);
      }
      this.callbacks.onCallout(`${spec.skillName}!`, 'gold');
    } else if (spec.skillId === 'phase_dash') {
      this.phaseDashTimer = 1.8;
      this.invincibleTimer = Math.max(this.invincibleTimer, 1.9);
      this.glider.setPhaseDash(true);
      this.particles.emitBurst(this.playerPos, 0x00ff9d, 34, 11);
      if (this.boss.isActive()) {
        this.boss.firePlayerBolt(this.playerPos, 2, 0x00ff9d);
      }
      this.callbacks.onCallout(`${spec.skillName}!`, 'emerald');
    } else if (spec.skillId === 'overdrive_surge') {
      this.addFever(45);
      this.particles.emitBurst(this.playerPos, 0xff66c4, 36, 11);
      if (this.boss.isActive()) {
        for (const ox of [-1.8, 0, 1.8]) {
          this.scratchA.set(this.playerPos.x + ox, this.playerPos.y, this.playerPos.z - 1);
          this.boss.firePlayerBolt(this.scratchA, 1, 0xff66c4);
        }
      } else {
        for (const h of this.spawner.hazards) {
          if (!h.hit && h.position.z < this.playerPos.z && h.position.distanceTo(this.playerPos) < 42) {
            h.hit = true;
            h.mesh.visible = false;
            this.score += 250;
            this.debris.spawnExplosion(h.position, this.physics.velocity, 0xff66c4, 0x1e293b, 10, 12);
            this.particles.emitBurst(h.position, 0xff66c4, 18, 8);
          }
        }
      }
      this.callbacks.onCallout(`${spec.skillName}!`, 'magenta');
    } else if (spec.skillId === 'aegis_matrix') {
      this.shieldActive = true;
      this.superMagnetTimer = 3.5;
      this.particles.emitBurst(this.playerPos, 0x38bdf8, 34, 10);
      if (this.boss.isActive()) {
        this.boss.firePlayerBolt(this.playerPos, 2, 0x38bdf8);
      }
      this.callbacks.onCallout(`${spec.skillName}!`, 'cyan');
    } else if (spec.skillId === 'paradise_dance') {
      this.starFrenzyTimer = Math.max(this.starFrenzyTimer, 4.5);
      this.particles.emitBurst(this.playerPos, 0x34d399, 36, 11);
      for (const s of this.spawner.stars) {
        if (!s.collected && s.position.distanceTo(this.playerPos) < 34) {
          s.position.copy(this.playerPos);
        }
      }
      for (const h of this.spawner.hazards) {
        if (!h.hit && h.position.distanceTo(this.playerPos) < 20) {
          h.hit = true;
          h.mesh.visible = false;
          this.score += 220;
          this.debris.spawnExplosion(h.position, this.physics.velocity, 0x34d399, 0xfacc15, 10, 12);
          this.particles.emitBurst(h.position, 0x34d399, 16, 7);
        }
      }
      for (const d of this.spawner.drones) {
        if (!d.destroyed && d.position.distanceTo(this.playerPos) < 20) {
          d.destroyed = true;
          d.mesh.visible = false;
          this.destroyScoutDrone(d.position, this.feverActive ? 2 : 1);
        }
      }
      if (this.boss.isActive()) {
        this.boss.firePlayerBolt(this.playerPos, 2, 0x34d399);
      }
      this.callbacks.onCallout(`${spec.skillName}!`, 'emerald');
    } else {
      // hornbill_gale
      this.glider.triggerPulseNovaVisual();
      this.boostEnergy = Math.min(this.boostCapacity, this.boostEnergy + this.boostCapacity * 0.5);
      this.particles.emitBurst(this.playerPos, 0xff7b00, 36, 12);
      this.cameraShake = 0.5;
      for (const h of this.spawner.hazards) {
        if (!h.hit && h.position.z < this.playerPos.z && h.position.distanceTo(this.playerPos) < 44) {
          h.hit = true;
          h.mesh.visible = false;
          this.score += 240;
          this.debris.spawnExplosion(h.position, this.physics.velocity, 0xff7b00, 0x1e293b, 10, 12);
          this.particles.emitBurst(h.position, 0xff7b00, 16, 8);
        }
      }
      for (const d of this.spawner.drones) {
        if (!d.destroyed && d.position.z < this.playerPos.z && d.position.distanceTo(this.playerPos) < 44) {
          d.destroyed = true;
          d.mesh.visible = false;
          this.destroyScoutDrone(d.position, this.feverActive ? 2 : 1);
        }
      }
      if (this.boss.isActive()) {
        this.boss.firePlayerBolt(this.playerPos, 2, 0xff7b00);
      }
      this.callbacks.onCallout(`${spec.skillName}!`, 'gold');
    }

    this.emitHud(true);
  }

  private addFever(amount: number): void {
    if (this.feverActive) return;
    this.feverGauge = Math.min(100, this.feverGauge + amount);
    if (this.feverGauge >= 100) {
      this.feverActive = true;
      this.feverTimer = this.feverDuration;
      this.feverCount += 1;
      this.sound.playFeverStart();
      this.particles.emitBurst(this.playerPos, 0xffd000, 40, 12);
      this.callbacks.onFxEvent('fever');
      this.callbacks.onCallout('OVERDRIVE FEVER // 2X SCORE!', 'gold');
    }
  }

  private awardGraze(sourcePos: THREE.Vector3): void {
    if (this.grazeCooldown > 0) return;
    this.grazeCooldown = 0.65;
    this.grazes += 1;
    const isNaga = this.activeWingId === 'naga_barong';
    const feverMult = this.feverActive ? 2 : 1;
    const pts = Math.round((isNaga ? 240 : 180) * this.combo * feverMult);
    this.score += pts;
    this.boostEnergy = Math.min(this.boostCapacity, this.boostEnergy + this.boostCapacity * 0.22);
    this.skillCooldownLeft = Math.max(0, this.skillCooldownLeft - 1.5);
    this.addFever(16);
    this.sound.playGraze();
    this.particles.emitBurst(sourcePos, 0x00f0ff, 12, 5.5);
    this.callbacks.onFxEvent('graze');
    this.callbacks.onCallout(`+${pts} RAZOR GRAZE!`, 'cyan');
    this.emitHud(true);
  }

  private checkInteractions(dt: number): void {
    const rolling = this.glider.isBarrelRolling();
    const isSmashInvuln = this.feverActive || this.phaseDashTimer > 0;
    const frenzyPull = this.starFrenzyTimer > 0 || this.superMagnetTimer > 0 || this.feverActive;
    const pullRadius = frenzyPull
      ? 24
      : rolling
        ? this.magnetRadius * 1.95
        : this.magnetRadius;
    const bullseyeRadius = this.activeWingId === 'unicorn_sembrani' ? 1.75 : 1.38;
    const grazeExtra = this.activeWingId === 'naga_barong' ? 1.25 : 1.0;
    const enggangRingBonus = this.activeWingId === 'enggang_dayak' ? 1.2 : 1.0;
    const feverMult = this.feverActive ? 2 : 1;

    // 1. Cyber Rings & Bullseye Check
    for (const ring of this.spawner.rings) {
      if (ring.collected) continue;
      if (ring.position.z > this.playerPos.z + 2.5 && ring.position.z < this.playerPos.z + 6) {
        ring.collected = true;
        this.ringsTotalSeen += 1;
        continue;
      }
      const dz = Math.abs(ring.position.z - this.playerPos.z);
      if (dz < 2.25) {
        const dxy = Math.hypot(ring.position.x - this.playerPos.x, ring.position.y - this.playerPos.y);
        if (dxy < 3.55) {
          ring.collected = true;
          ring.mesh.visible = false;
          this.ringsPassed += 1;
          this.ringsTotalSeen += 1;
          this.combo = Math.min(10, this.combo + 1);
          if (this.combo > this.maxCombo) this.maxCombo = this.combo;
          this.comboTimer = this.comboWindow;
          this.boostEnergy = Math.min(
            this.boostCapacity,
            this.boostEnergy + this.boostCapacity * 0.2
          );

          const isBullseye = dxy < bullseyeRadius;
          if (isBullseye) {
            this.bullseyes += 1;
            this.addFever(16);
            this.callbacks.onFxEvent('bullseye');
          } else {
            this.addFever(8);
          }

          if (ring.kind === 'warp') {
            this.starsRun += 3;
            this.boostEnergy = this.boostCapacity;
            this.addFever(12);
          }

          const basePts = ring.kind === 'warp' ? 220 : 110;
          const bullBonus = isBullseye ? 2.0 : 1.0;
          const pts = Math.round(
            basePts * bullBonus * enggangRingBonus * this.combo * feverMult * (this.isBoosting ? 1.5 : 1)
          );
          this.score += pts;

          this.sound.playRing(this.combo, isBullseye);
          this.particles.emitBurst(ring.position, isBullseye ? 0xffd000 : 0x00f0ff, 26, 8.8);

          if (ring.kind === 'warp') {
            this.callbacks.onCallout('WARP RING +3⭐!', 'emerald');
          } else if (isBullseye) {
            this.callbacks.onCallout(`BULLSEYE x${this.combo}!`, 'gold');
          } else if (this.combo >= 4 && this.combo % 2 === 0) {
            this.callbacks.onCallout(`x${this.combo} RING CHAIN!`, 'cyan');
          }
          this.emitHud(true);
        }
      }
    }

    // 2. Data Stars with Inverse-Square Tractor Field Pull
    for (const star of this.spawner.stars) {
      if (star.collected) continue;
      const dist = star.position.distanceTo(this.playerPos);
      if (dist < pullRadius && dist > 0.05) {
        const pullStrength = Math.min(1, ((pullRadius * 28) / (dist * dist + 2.5)) * dt);
        star.position.lerp(this.playerPos, pullStrength);
        star.mesh.position.copy(star.position);
      }
      if (dist < 2.05) {
        star.collected = true;
        star.mesh.visible = false;
        const starVal = this.starFrenzyTimer > 0 ? 2 : 1;
        this.starsRun += starVal;
        this.score += 30 * this.combo * feverMult;
        this.addFever(2.2);
        this.sound.playStar();
        this.particles.emitBurst(star.position, 0xffd000, 10, 4.5);
        this.emitHud(false);
      }
    }

    // 3. Pickups
    for (const p of this.spawner.pickups) {
      if (p.collected) continue;
      if (p.position.distanceTo(this.playerPos) < 2.6) {
        p.collected = true;
        p.mesh.visible = false;
        this.sound.playPowerup();
        if (p.kind === 'shield') {
          this.shieldActive = true;
          this.particles.emitBurst(p.position, 0x00f0ff, 24, 7);
          this.callbacks.onCallout('ENERGY SHIELD!', 'cyan');
        } else if (p.kind === 'heart') {
          if (this.hearts < this.maxHearts) {
            this.hearts += 1;
            this.callbacks.onCallout('+1 ARMOR CORE!', 'emerald');
          } else {
            this.score += 300;
            this.callbacks.onCallout('+300 OVERHEAL!', 'emerald');
          }
          this.particles.emitBurst(p.position, 0x00ff9d, 24, 7);
        } else if (p.kind === 'frenzy') {
          this.starFrenzyTimer = 6.5;
          this.particles.emitBurst(p.position, 0xff2a85, 28, 8);
          this.callbacks.onCallout('2X STAR FRENZY!', 'gold');
        } else {
          this.skillCooldownLeft = 0;
          this.boostEnergy = this.boostCapacity;
          this.addFever(28);
          this.particles.emitBurst(p.position, 0xa855f7, 28, 8);
          this.callbacks.onCallout('OVERCHARGE // SKILL READY!', 'magenta');
        }
        this.emitHud(true);
      }
    }

    // 4. Cargo Pods
    for (const pod of this.spawner.cargoPods) {
      if (pod.destroyed) continue;
      if (pod.position.distanceTo(this.playerPos) < pod.radius + 1.25) {
        pod.destroyed = true;
        pod.mesh.visible = false;
        this.crackCargoPod(pod.position, feverMult);
      }
    }

    // 5. Scout Drones
    for (const d of this.spawner.drones) {
      if (d.destroyed) continue;
      const dist = d.position.distanceTo(this.playerPos);
      if (dist < d.radius + 0.95) {
        d.destroyed = true;
        d.mesh.visible = false;
        if (rolling || isSmashInvuln) {
          this.destroyScoutDrone(d.position, feverMult);
        } else {
          this.handleHazardBounce(d.position);
        }
      } else if (!d.grazeAwarded && dist < d.radius + 2.8 * grazeExtra) {
        d.grazeAwarded = true;
        this.awardGraze(d.position);
      }
    }

    // 6. Plasma Mines & Graze / Smash
    for (const h of this.spawner.hazards) {
      if (h.hit) continue;
      const dist = h.position.distanceTo(this.playerPos);
      if (dist < h.radius + 0.9) {
        h.hit = true;
        if (rolling || isSmashInvuln) {
          h.mesh.visible = false;
          this.score += 300 * feverMult;
          this.addFever(12);
          this.sound.playDeflect();
          this.sound.playExplosion(false);
          this.debris.spawnExplosion(h.position, this.physics.velocity, 0x00f0ff, 0x1e293b, 14, 16);
          this.particles.emitBurst(h.position, 0x00f0ff, 26, 9.5);
          this.callbacks.onCallout(
            isSmashInvuln ? '+300 OVERDRIVE SMASH!' : '+300 ROLL SHATTER!',
            'cyan'
          );
          this.emitHud(true);
        } else {
          this.handleHazardBounce(h.position);
        }
      } else if (!h.grazeAwarded && dist < h.radius + 2.85 * grazeExtra) {
        h.grazeAwarded = true;
        this.awardGraze(h.position);
      }
    }

    // 7. Laser Gates
    for (const gate of this.spawner.laserGates) {
      if (gate.hit) continue;
      const dz = Math.abs(gate.z - this.playerPos.z);
      if (dz < 1.15) {
        const playerCoord = gate.orientation === 'horizontal' ? this.playerPos.x : this.playerPos.y;
        const delta = Math.abs(playerCoord - gate.gapCenter);
        if (delta > gate.gapHalf - 0.55) {
          gate.hit = true;
          if (!isSmashInvuln) {
            this.scratchA.set(this.playerPos.x, this.playerPos.y, gate.z);
            this.handleHazardBounce(this.scratchA);
          } else {
            this.score += 300;
            this.callbacks.onCallout('PHASED LASER GATE!', 'emerald');
          }
        } else if (!gate.grazeAwarded && delta > gate.gapHalf - 1.6 * grazeExtra) {
          gate.grazeAwarded = true;
          this.awardGraze(this.playerPos);
        }
      }
    }

    // 8. Cyber Pylon Skims
    for (const pyl of this.spawner.pylons) {
      const dx = this.playerPos.x - pyl.position.x;
      const dz = this.playerPos.z - pyl.position.z;
      const distXZ = Math.hypot(dx, dz);
      if (this.playerPos.y < pyl.position.y + 13 && distXZ < pyl.radius + 0.9) {
        if (!isSmashInvuln) {
          this.handleHazardBounce(pyl.position);
        }
      } else if (
        !pyl.grazeAwarded &&
        this.playerPos.y < pyl.position.y + 13 &&
        distXZ < pyl.radius + 3.2 * grazeExtra
      ) {
        pyl.grazeAwarded = true;
        this.awardGraze(this.playerPos);
      }
    }
  }

  private handleHazardBounce(sourcePos: THREE.Vector3): void {
    if (this.invincibleTimer > 0) return;

    this.physics.applyCollisionImpulse(sourcePos, this.activeWingId, 0.68);
    this.cameraShake = 1.05;
    this.sound.playBounce();
    this.debris.spawnExplosion(this.playerPos, this.physics.velocity, 0xff2a85, 0x334155, 8, 12);
    this.particles.emitBurst(this.playerPos, 0xff2a85, 22, 7);
    this.callbacks.onFxEvent('hit');

    if (this.shieldActive) {
      this.shieldActive = false;
      this.invincibleTimer = 1.6;
      this.callbacks.onCallout('SHIELD ABSORBED HIT!', 'cyan');
      this.emitHud(true);
      return;
    }

    this.hitsTaken += 1;
    this.hearts = Math.max(0, this.hearts - 1);
    this.combo = 1;
    this.comboTimer = 0;
    this.invincibleTimer = 2.1;
    this.emitHud(true);

    if (this.hearts <= 0) {
      this.finishRun(false);
    }
  }

  private finishRun(victory: boolean): void {
    this.boss.clear();
    this.clearCannonBolts();
    this.lockReticle.visible = false;
    this.state = 'gameover';
    this.input.setEnabled(false);
    this.sound.setFlightState(false, 0, false, false, false, this.stageId);

    const summary = storage.saveRunResult({
      score: this.score,
      distance: this.distance,
      starsCollected: this.starsRun,
      ringsPassed: this.ringsPassed,
      ringsTotal: Math.max(this.ringsPassed, this.ringsTotalSeen),
      bullseyes: this.bullseyes,
      grazes: this.grazes,
      deflects: this.deflects,
      feverCount: this.feverCount,
      skillUses: this.skillUses,
      hitsTaken: this.hitsTaken,
      maxCombo: this.maxCombo,
      mode: this.mode,
      stageId: this.stageId,
      difficulty: this.difficulty,
      victory,
      bossDefeated: this.bossDefeated,
      bossNoHit: this.bossDefeated && this.bossHitsTaken === 0,
      bossKillsThisRun: this.bossKillsThisRun
    });

    this.sound.playGameOver(victory || summary.isNewBest);
    this.callbacks.onStateChange('gameover');
    this.callbacks.onGameOver(summary);
  }

  private emitHud(immediate: boolean): void {
    if (!immediate && this.state !== 'playing') return;
    const wingSpec = getWingSpec(this.activeWingId);
    const stageSpec = getStageSpec(this.stageId);

    const targetLen =
      this.mode === 'daily'
        ? 1800
        : this.mode === 'stage'
          ? stageSpec.lengthMeters
          : 1400;

    const endlessDistInWave = this.distance - (this.nextEndlessBossDist - 1400);
    const stageProgress =
      this.mode === 'endless'
        ? Math.max(0, Math.min(1, endlessDistInWave / 1400))
        : Math.max(0, Math.min(1, this.distance / targetLen));

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
      speedRatio: THREE.MathUtils.clamp((this.forwardSpeed - 31) / 48, 0, 1),
      mode: this.mode,
      stageId: this.stageId,
      biomeName: stageSpec.name,
      difficulty: this.difficulty,
      stageProgress,
      feverGauge: this.feverGauge / 100,
      feverActive: this.feverActive,
      feverTimeRatio: this.feverActive ? Math.max(0, this.feverTimer / this.feverDuration) : 0,
      skillName: wingSpec.skillName,
      skillIcon: wingSpec.skillIcon,
      skillReadyRatio: Math.max(
        0,
        Math.min(1, 1 - this.skillCooldownLeft / Math.max(1, this.skillCooldownMax))
      ),
      skillCooldownLeft: this.skillCooldownLeft,
      bossActive: this.boss.isActive(),
      bossName: this.boss.getName(),
      bossHpRatio: this.boss.getHpRatio(),
      bossPhase2: this.boss.isPhase2(),
      rivalLabel: this.rivalLabel,
      rivalDelta: this.score - this.rivalScore,
      starFrenzyRatio: Math.max(0, Math.min(1, this.starFrenzyTimer / 6.5)),
      mach: this.physics.mach,
      gForce: this.physics.gForce,
      altitude: this.physics.altitude,
      sonicBoom: this.physics.mach >= 1.0,
      inSlipstream: this.physics.inSlipstream,
      inUpdraft: this.physics.inUpdraft,
      lockOnActive: this.lockedTargetPos !== null
    });
  }

  private readonly handleResize = (): void => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(Math.max(2, Math.floor(w * 0.5)), Math.max(2, Math.floor(h * 0.5)));
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
