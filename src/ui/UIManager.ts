import {
  ACHIEVEMENT_CATALOG,
  AVIATOR_CATALOG,
  PILOT_AVATARS,
  STAGE_CATALOG,
  TRAIL_CATALOG,
  UPGRADE_CATALOG,
  WING_CATALOG,
  getMaxHearts,
  getPilotRankInfo,
  getStageSpec,
  getWingSpec
} from '../data/catalog';
import { storage } from '../data/storage';
import type { SoundEngine } from '../audio/SoundEngine';
import type { SkyGlideEngine } from '../gameplay/SkyGlideEngine';
import type {
  Difficulty,
  FxEventKind,
  GameMode,
  GameState,
  GraphicsQuality,
  HudSnapshot,
  PerfSnapshot,
  RunSummary,
  StageId,
  WingId
} from '../types/game';
import { getTodayDateKey } from '../utils/prng';

function formatInt(n: number): string {
  return Math.trunc(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

type ActiveModal =
  | 'none'
  | 'hangar'
  | 'bounties'
  | 'leaderboard'
  | 'settings'
  | 'pause'
  | 'gameover';
type HangarTab = 'upgrades' | 'wings' | 'trails' | 'aviator';
type BoardTab = 'leaderboard' | 'profiles';
type BountyTab = 'bounties' | 'medals';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export class UIManager {
  private readonly hudLayer: HTMLElement;
  private readonly fxOverlay: HTMLElement;
  private readonly overlaysLayer: HTMLElement;
  private readonly rotateOverlay: HTMLElement;
  private readonly engine: SkyGlideEngine;
  private readonly sound: SoundEngine;

  private activeModal: ActiveModal = 'none';
  private hangarTab: HangarTab = 'upgrades';
  private boardTab: BoardTab = 'leaderboard';
  private bountyTab: BountyTab = 'bounties';

  private selectedMode: GameMode;
  private selectedStage: StageId;
  private selectedDifficulty: Difficulty;

  private lastSummary: RunSummary | null = null;
  private newPilotAvatar: string = PILOT_AVATARS[0];
  private rotateDismissed = false;

  // Cached HUD DOM refs
  private hudStarsEl: HTMLElement | null = null;
  private hudHeartPips: HTMLElement[] = [];
  private hudShieldBadge: HTMLElement | null = null;
  private hudFrenzyBadge: HTMLElement | null = null;
  private hudSectorBox: HTMLElement | null = null;
  private hudSectorLabel: HTMLElement | null = null;
  private hudSectorVal: HTMLElement | null = null;
  private hudSectorFill: HTMLElement | null = null;
  private hudRivalChip: HTMLElement | null = null;
  private hudComboWrap: HTMLElement | null = null;
  private hudComboLabel: HTMLElement | null = null;
  private hudComboFill: HTMLElement | null = null;
  private hudScoreEl: HTMLElement | null = null;
  private hudDistEl: HTMLElement | null = null;
  private hudTurboFill: HTMLElement | null = null;
  private hudFeverWrap: HTMLElement | null = null;
  private hudFeverLabel: HTMLElement | null = null;
  private hudFeverFill: HTMLElement | null = null;
  private hudSkillPill: HTMLElement | null = null;
  private hudSkillName: HTMLElement | null = null;
  private hudSkillStatus: HTMLElement | null = null;
  private hudSkillFill: HTMLElement | null = null;
  private hudMuteBtn: HTMLButtonElement | null = null;
  private hudMachEl: HTMLElement | null = null;
  private hudGForceEl: HTMLElement | null = null;
  private hudAltEl: HTMLElement | null = null;
  private hudFlightBadgeEl: HTMLElement | null = null;
  private hudCalloutEl: HTMLElement | null = null;
  private readonly fpsBadgeEl: HTMLElement;

  // Dirty-check HUD caches
  private lastStars = -1;
  private lastScore = -1;
  private lastDist = -1;
  private lastHearts = -1;
  private lastShield = false;
  private lastFrenzy = false;
  private lastBossActive = false;
  private lastSectorLabel = '';
  private lastSectorVal = '';
  private lastSectorRatio = -1;
  private lastRivalAhead: boolean | null = null;
  private lastRivalText = '';
  private lastCombo = -1;
  private lastComboRatio = -1;
  private lastTurboRatio = -1;
  private lastFeverActive: boolean | null = null;
  private lastFeverRatio = -1;
  private lastSkillReady: boolean | null = null;
  private lastSkillStatus = '';
  private lastSkillName = '';
  private lastSkillRatio = -1;
  private lastMachText = '';
  private lastSonic: boolean | null = null;
  private lastGForceText = '';
  private lastAltText = '';
  private lastBadgeText = '';

  private calloutTimer: number | null = null;
  private fxTimer: number | null = null;
  private fxRafId = 0;

  constructor(
    hudLayer: HTMLElement,
    fxOverlay: HTMLElement,
    overlaysLayer: HTMLElement,
    rotateOverlay: HTMLElement,
    engine: SkyGlideEngine,
    sound: SoundEngine
  ) {
    this.hudLayer = hudLayer;
    this.fxOverlay = fxOverlay;
    this.overlaysLayer = overlaysLayer;
    this.rotateOverlay = rotateOverlay;
    this.engine = engine;
    this.sound = sound;

    const settings = storage.getSettings();
    this.selectedMode = settings.preferredMode;
    this.selectedStage = settings.preferredStage;
    this.selectedDifficulty = settings.preferredDifficulty;

    const dismissBtn = document.getElementById('dismiss-rotate-btn');
    dismissBtn?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      this.rotateDismissed = true;
      this.updateRotateGuard();
    });

    window.addEventListener('resize', () => this.updateRotateGuard());
    window.addEventListener('keydown', (e) => {
      if (this.engine.getState() !== 'title' || this.activeModal !== 'none') return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.cycleMount(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.cycleMount(1);
      }
    });
    this.fpsBadgeEl = document.createElement('div');
    this.fpsBadgeEl.id = 'fps-badge';
    this.fpsBadgeEl.className = 'fps-badge hidden';
    (document.getElementById('app') ?? document.body).appendChild(this.fpsBadgeEl);
    this.syncPerfVisibility();
    this.updateRotateGuard();
    this.renderOverlays();
  }

  updatePerf(perf: PerfSnapshot): void {
    if (!storage.getSettings().showFps) return;
    this.fpsBadgeEl.classList.remove('hidden', 'perf-good', 'perf-warn', 'perf-low');
    this.fpsBadgeEl.classList.add(
      perf.fps >= 55 ? 'perf-good' : perf.fps >= 40 ? 'perf-warn' : 'perf-low'
    );
    const qLabel = perf.effectiveQuality.toUpperCase() + (perf.autoScaled ? '*' : '');
    this.fpsBadgeEl.textContent = `${perf.fps} FPS · ${perf.frameMs.toFixed(1)}ms (p95 ${perf.p95Ms.toFixed(1)}) · ${qLabel} · ${perf.drawCalls} DC`;
  }

  private syncPerfVisibility(): void {
    const show = storage.getSettings().showFps;
    this.fpsBadgeEl.classList.toggle('hidden', !show);
    if (show && !this.fpsBadgeEl.textContent) {
      this.fpsBadgeEl.textContent = '-- FPS';
    }
  }

  onStateChange(state: GameState): void {
    const showHud = state === 'playing' || state === 'paused';
    this.hudLayer.classList.toggle('hidden', !showHud);
    if (!showHud) {
      this.fxOverlay.className = 'layer';
    }

    if (state === 'playing') {
      this.activeModal = 'none';
      this.buildHudDom();
    } else if (state === 'paused') {
      this.activeModal = 'pause';
    } else if (state === 'gameover') {
      this.activeModal = 'gameover';
    } else if (state === 'hangar') {
      this.activeModal = 'hangar';
    } else if (state === 'title') {
      if (
        this.activeModal === 'pause' ||
        this.activeModal === 'gameover' ||
        this.activeModal === 'hangar'
      ) {
        this.activeModal = 'none';
      }
    }

    this.renderOverlays();
  }

  onGameOver(summary: RunSummary): void {
    this.lastSummary = summary;
    this.activeModal = 'gameover';
    this.renderOverlays();
  }

  triggerFx(kind: FxEventKind): void {
    if (this.engine.getState() !== 'playing') return;
    if (kind === 'fever') {
      this.fxOverlay.classList.add('fx-fever');
      return;
    }
    const cls =
      kind === 'hit'
        ? 'fx-hit'
        : kind === 'bullseye'
          ? 'fx-bullseye'
          : kind === 'boss_warning'
            ? 'fx-boss'
            : kind === 'sonic_boom'
              ? 'fx-sonic'
              : 'fx-graze';
    this.fxOverlay.classList.remove('fx-hit', 'fx-bullseye', 'fx-graze', 'fx-boss', 'fx-sonic');
    if (this.fxRafId) cancelAnimationFrame(this.fxRafId);
    this.fxRafId = requestAnimationFrame(() => {
      this.fxRafId = 0;
      if (this.engine.getState() === 'playing') {
        this.fxOverlay.classList.add(cls);
      }
    });
    if (this.fxTimer !== null) window.clearTimeout(this.fxTimer);
    this.fxTimer = window.setTimeout(() => {
      this.fxOverlay.classList.remove('fx-hit', 'fx-bullseye', 'fx-graze', 'fx-boss', 'fx-sonic');
    }, 900);
  }

  showCallout(text: string, variant: 'gold' | 'cyan' | 'magenta' | 'emerald' = 'cyan'): void {
    if (this.engine.getState() !== 'playing') return;
    if (!this.hudCalloutEl) this.buildHudDom();
    const pill = this.hudCalloutEl;
    if (!pill) return;

    pill.className = `hud-callout ${variant}`;
    pill.textContent = text;
    for (const anim of pill.getAnimations()) {
      anim.currentTime = 0;
      anim.play();
    }
    if (this.calloutTimer !== null) window.clearTimeout(this.calloutTimer);
    this.calloutTimer = window.setTimeout(() => {
      pill.classList.add('hidden');
    }, 950);
  }

  updateHud(snap: HudSnapshot): void {
    if (!this.hudStarsEl) this.buildHudDom();

    if (this.lastFeverActive !== snap.feverActive) {
      this.fxOverlay.classList.toggle('fx-fever', snap.feverActive);
    }

    if (this.hudStarsEl && this.lastStars !== snap.starsRun) {
      this.lastStars = snap.starsRun;
      this.hudStarsEl.textContent = formatInt(snap.starsRun);
    }
    if (this.hudScoreEl && this.lastScore !== snap.score) {
      this.lastScore = snap.score;
      this.hudScoreEl.textContent = formatInt(snap.score);
    }
    if (this.hudDistEl && this.lastDist !== snap.distance) {
      this.lastDist = snap.distance;
      this.hudDistEl.textContent = `${formatInt(snap.distance)}m`;
    }

    if (this.lastHearts !== snap.hearts) {
      this.lastHearts = snap.hearts;
      for (let i = 0; i < this.hudHeartPips.length; i++) {
        this.hudHeartPips[i].classList.toggle('lost', i >= snap.hearts);
      }
    }

    if (this.hudShieldBadge && this.lastShield !== snap.shieldActive) {
      this.lastShield = snap.shieldActive;
      this.hudShieldBadge.classList.toggle('hidden', !snap.shieldActive);
    }
    const frenzyOn = snap.starFrenzyRatio > 0;
    if (this.hudFrenzyBadge && this.lastFrenzy !== frenzyOn) {
      this.lastFrenzy = frenzyOn;
      this.hudFrenzyBadge.classList.toggle('hidden', !frenzyOn);
    }

    if (this.hudSectorBox && this.hudSectorLabel && this.hudSectorVal && this.hudSectorFill) {
      if (this.lastBossActive !== snap.bossActive) {
        this.lastBossActive = snap.bossActive;
        this.hudSectorBox.classList.toggle('boss-mode', snap.bossActive);
      }
      const nextLabel = snap.bossActive
        ? `⚠️ ${snap.bossName}${snap.bossPhase2 ? ' [P2]' : ''}`
        : `${snap.biomeName}${snap.difficulty === 'overclocked' ? ' [OC]' : ''}`;
      if (this.lastSectorLabel !== nextLabel) {
        this.lastSectorLabel = nextLabel;
        this.hudSectorLabel.textContent = nextLabel;
      }
      const sectorRatio = snap.bossActive ? snap.bossHpRatio : snap.stageProgress;
      const pct = snap.bossActive
        ? `${Math.ceil(sectorRatio * 100)}%`
        : `${Math.round(sectorRatio * 100)}%`;
      if (this.lastSectorVal !== pct) {
        this.lastSectorVal = pct;
        this.hudSectorVal.textContent = pct;
      }
      const roundedSector = Math.round(sectorRatio * 200) / 200;
      if (this.lastSectorRatio !== roundedSector) {
        this.lastSectorRatio = roundedSector;
        this.hudSectorFill.style.transform = `scaleX(${roundedSector})`;
      }
    }

    if (this.hudRivalChip) {
      const ahead = snap.rivalDelta >= 0;
      if (this.lastRivalAhead !== ahead) {
        this.lastRivalAhead = ahead;
        this.hudRivalChip.classList.toggle('ahead', ahead);
      }
      const rivalText = ahead
        ? `🏆 +${formatInt(snap.rivalDelta)} AHEAD OF ${snap.rivalLabel}`
        : `🏁 ${formatInt(Math.abs(snap.rivalDelta))} TO BEAT ${snap.rivalLabel}`;
      if (this.lastRivalText !== rivalText) {
        this.lastRivalText = rivalText;
        this.hudRivalChip.textContent = rivalText;
      }
    }

    if (this.hudComboWrap && this.hudComboLabel && this.hudComboFill) {
      if (this.lastCombo !== snap.combo) {
        this.lastCombo = snap.combo;
        this.hudComboWrap.classList.toggle('hidden', snap.combo <= 1);
        this.hudComboLabel.textContent = `x${snap.combo} CHAIN`;
      }
      const comboRatio = Math.round(snap.comboTimerRatio * 200) / 200;
      if (this.lastComboRatio !== comboRatio) {
        this.lastComboRatio = comboRatio;
        this.hudComboFill.style.transform = `scaleX(${comboRatio})`;
      }
    }

    if (this.hudTurboFill) {
      const turboRatio = Math.round(snap.boostEnergy * 200) / 200;
      if (this.lastTurboRatio !== turboRatio) {
        this.lastTurboRatio = turboRatio;
        this.hudTurboFill.style.transform = `scaleX(${turboRatio})`;
      }
    }

    if (this.hudFeverWrap && this.hudFeverLabel && this.hudFeverFill) {
      if (this.lastFeverActive !== snap.feverActive) {
        this.lastFeverActive = snap.feverActive;
        this.hudFeverWrap.classList.toggle('active', snap.feverActive);
        this.hudFeverLabel.textContent = snap.feverActive ? '⚡ OVERDRIVE 2X' : '⚡ FEVER';
      }
      const fillRatio =
        Math.round((snap.feverActive ? snap.feverTimeRatio : snap.feverGauge) * 200) / 200;
      if (this.lastFeverRatio !== fillRatio) {
        this.lastFeverRatio = fillRatio;
        this.hudFeverFill.style.transform = `scaleX(${fillRatio})`;
      }
    }

    if (this.hudSkillPill && this.hudSkillName && this.hudSkillStatus && this.hudSkillFill) {
      const ready = snap.skillReadyRatio >= 0.999;
      if (this.lastSkillReady !== ready) {
        this.lastSkillReady = ready;
        this.hudSkillPill.classList.toggle('cooling', !ready);
      }
      const skillName = `${snap.skillIcon} ${snap.skillName}`;
      if (this.lastSkillName !== skillName) {
        this.lastSkillName = skillName;
        this.hudSkillName.textContent = skillName;
      }
      const statusText = ready ? '[Q] READY' : `${snap.skillCooldownLeft.toFixed(1)}s`;
      if (this.lastSkillStatus !== statusText) {
        this.lastSkillStatus = statusText;
        this.hudSkillStatus.textContent = statusText;
      }
      const skillRatio = Math.round(snap.skillReadyRatio * 200) / 200;
      if (this.lastSkillRatio !== skillRatio) {
        this.lastSkillRatio = skillRatio;
        this.hudSkillFill.style.transform = `scaleX(${skillRatio})`;
      }
    }

    if (this.hudMachEl && this.hudGForceEl && this.hudAltEl && this.hudFlightBadgeEl) {
      const machText = `MACH ${snap.mach.toFixed(2)}`;
      if (this.lastMachText !== machText) {
        this.lastMachText = machText;
        this.hudMachEl.textContent = machText;
      }
      if (this.lastSonic !== snap.sonicBoom) {
        this.lastSonic = snap.sonicBoom;
        this.hudMachEl.classList.toggle('sonic', snap.sonicBoom);
      }
      const gText = `${snap.gForce.toFixed(1)}G`;
      if (this.lastGForceText !== gText) {
        this.lastGForceText = gText;
        this.hudGForceEl.textContent = gText;
      }
      const altText = `${snap.altitude}m`;
      if (this.lastAltText !== altText) {
        this.lastAltText = altText;
        this.hudAltEl.textContent = altText;
      }

      const badge = snap.sonicBoom
        ? '⚡ SONIC'
        : snap.inSlipstream
          ? '💨 SLIPSTREAM'
          : snap.inUpdraft
            ? '🌀 UPDRAFT'
            : snap.lockOnActive
              ? '🎯 LOCK'
              : '';
      if (this.lastBadgeText !== badge) {
        this.lastBadgeText = badge;
        this.hudFlightBadgeEl.textContent = badge;
        this.hudFlightBadgeEl.classList.toggle('hidden', badge.length === 0);
      }
    }
  }

  private buildHudDom(): void {
    const settings = storage.getSettings();
    const profile = storage.getActiveProfile();
    const maxHearts = getMaxHearts(profile.upgrades.shield, profile.equipped.wing);
    const wing = getWingSpec(profile.equipped.wing);

    this.hudLayer.innerHTML = `
      <div class="hud-top">
        <div class="hud-left">
          <div class="glass-pill hud-stat">
            <span>⭐</span>
            <span id="hud-stars">0</span>
          </div>
          <div class="glass-pill hud-hearts" id="hud-hearts">
            ${Array.from({ length: maxHearts }).map(() => `<span class="heart-pip">💠</span>`).join('')}
          </div>
          <div class="glass-pill hud-shield-badge hidden" id="hud-shield">🛡️ SHIELD</div>
          <div class="glass-pill hud-frenzy-badge hidden" id="hud-frenzy">✨ 2X STARS</div>
        </div>

        <div class="hud-center-bar">
          <div class="glass-pill sector-progress-box" id="hud-sector-box">
            <div class="sector-progress-head">
              <span id="hud-sector-label">SECTOR 01</span>
              <span id="hud-sector-val">0%</span>
            </div>
            <div class="sector-track">
              <div class="sector-fill" id="hud-sector-fill" style="transform:scaleX(0)"></div>
            </div>
          </div>
          <div class="hud-rival-chip" id="hud-rival-chip">🏁 TARGETING RIVAL</div>
        </div>

        <div class="hud-right">
          <div class="glass-pill hud-combo hidden" id="hud-combo">
            <span class="hud-combo-label" id="hud-combo-label">x2 CHAIN</span>
            <div class="hud-combo-bar"><div class="hud-combo-fill" id="hud-combo-fill" style="transform:scaleX(1)"></div></div>
          </div>
          <div class="glass-pill hud-score-box">
            <span class="hud-score-val" id="hud-score">0</span>
            <span class="hud-dist-val" id="hud-dist">0m</span>
          </div>
          <button class="btn btn-icon btn-icon-sm" id="hud-mute-btn" type="button" aria-label="Toggle Mute">
            ${settings.muted ? '🔇' : '🔊'}
          </button>
          <button class="btn btn-icon btn-icon-sm" id="hud-pause-btn" type="button" aria-label="Pause Game">
            ⏸️
          </button>
        </div>
      </div>

      <div class="hud-callout hidden" id="hud-callout"></div>

      <div class="hud-bottom">
        <div class="glass-pill hud-telemetry-strip">
          <span class="telem-item" id="hud-mach">MACH 0.65</span>
          <span class="telem-sep">·</span>
          <span class="telem-item" id="hud-gforce">1.0G</span>
          <span class="telem-sep">·</span>
          <span class="telem-item" id="hud-alt">459m</span>
          <span class="telem-badge hidden" id="hud-flight-badge"></span>
        </div>
        <div class="hud-bars-row">
          <div class="glass-pill turbo-wrap">
            <div class="turbo-header">
              <span>🔥 TURBO</span>
              <span>SPACE</span>
            </div>
            <div class="turbo-track">
              <div class="turbo-fill" id="hud-turbo-fill" style="transform:scaleX(1)"></div>
            </div>
          </div>

          <div class="glass-pill fever-wrap" id="hud-fever-wrap">
            <div class="turbo-header">
              <span id="hud-fever-label">⚡ FEVER</span>
              <span>2X SCORE</span>
            </div>
            <div class="turbo-track">
              <div class="fever-fill" id="hud-fever-fill" style="transform:scaleX(0)"></div>
            </div>
          </div>

          <div class="glass-pill skill-hud-pill" id="hud-skill-pill">
            <div class="turbo-header">
              <span id="hud-skill-name">${wing.skillIcon} ${wing.skillName}</span>
              <span id="hud-skill-status">[Q] READY</span>
            </div>
            <div class="turbo-track">
              <div class="turbo-fill" id="hud-skill-fill" style="transform:scaleX(1)"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.hudStarsEl = document.getElementById('hud-stars');
    const heartsWrap = document.getElementById('hud-hearts');
    this.hudHeartPips = heartsWrap ? Array.from(heartsWrap.querySelectorAll<HTMLElement>('.heart-pip')) : [];
    this.hudShieldBadge = document.getElementById('hud-shield');
    this.hudFrenzyBadge = document.getElementById('hud-frenzy');
    this.hudSectorBox = document.getElementById('hud-sector-box');
    this.hudSectorLabel = document.getElementById('hud-sector-label');
    this.hudSectorVal = document.getElementById('hud-sector-val');
    this.hudSectorFill = document.getElementById('hud-sector-fill');
    this.hudRivalChip = document.getElementById('hud-rival-chip');
    this.hudComboWrap = document.getElementById('hud-combo');
    this.hudComboLabel = document.getElementById('hud-combo-label');
    this.hudComboFill = document.getElementById('hud-combo-fill');
    this.hudScoreEl = document.getElementById('hud-score');
    this.hudDistEl = document.getElementById('hud-dist');
    this.hudTurboFill = document.getElementById('hud-turbo-fill');
    this.hudFeverWrap = document.getElementById('hud-fever-wrap');
    this.hudFeverLabel = document.getElementById('hud-fever-label');
    this.hudFeverFill = document.getElementById('hud-fever-fill');
    this.hudSkillPill = document.getElementById('hud-skill-pill');
    this.hudSkillName = document.getElementById('hud-skill-name');
    this.hudSkillStatus = document.getElementById('hud-skill-status');
    this.hudSkillFill = document.getElementById('hud-skill-fill');
    this.hudMuteBtn = document.getElementById('hud-mute-btn') as HTMLButtonElement | null;
    this.hudMachEl = document.getElementById('hud-mach');
    this.hudGForceEl = document.getElementById('hud-gforce');
    this.hudAltEl = document.getElementById('hud-alt');
    this.hudFlightBadgeEl = document.getElementById('hud-flight-badge');
    this.hudCalloutEl = document.getElementById('hud-callout');

    // Reset dirty-check cache for fresh DOM
    this.lastStars = -1;
    this.lastScore = -1;
    this.lastDist = -1;
    this.lastHearts = -1;
    this.lastShield = false;
    this.lastFrenzy = false;
    this.lastBossActive = false;
    this.lastSectorLabel = '';
    this.lastSectorVal = '';
    this.lastSectorRatio = -1;
    this.lastRivalAhead = null;
    this.lastRivalText = '';
    this.lastCombo = -1;
    this.lastComboRatio = -1;
    this.lastTurboRatio = -1;
    this.lastFeverActive = null;
    this.lastFeverRatio = -1;
    this.lastSkillReady = null;
    this.lastSkillStatus = '';
    this.lastSkillName = '';
    this.lastSkillRatio = -1;
    this.lastMachText = '';
    this.lastSonic = null;
    this.lastGForceText = '';
    this.lastAltText = '';
    this.lastBadgeText = '';

    this.hudMuteBtn?.addEventListener('click', () => this.toggleMute());
    document.getElementById('hud-pause-btn')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      this.engine.pauseRun();
    });
  }

  private renderOverlays(): void {
    const state = this.engine.getState();
    this.overlaysLayer.innerHTML = '';

    if (state === 'title' && this.activeModal === 'none') {
      this.renderTitleScreen();
      return;
    }

    if (this.activeModal === 'hangar') {
      this.renderHangarModal();
    } else if (this.activeModal === 'bounties') {
      this.renderBountiesModal();
    } else if (this.activeModal === 'leaderboard') {
      this.renderLeaderboardModal();
    } else if (this.activeModal === 'settings') {
      this.renderSettingsModal();
    } else if (this.activeModal === 'pause') {
      this.renderPauseModal();
    } else if (this.activeModal === 'gameover') {
      this.renderGameOverModal();
    }
  }

  private renderTitleScreen(): void {
    const profile = storage.getActiveProfile();
    const settings = storage.getSettings();
    const rankInfo = getPilotRankInfo(profile.xp);
    const canFullscreen = Boolean(document.documentElement.requestFullscreen);
    const canUpgrade = storage.hasAffordableHangarAction(profile);
    const todayKey = getTodayDateKey();
    const dailyBest =
      profile.dailyRecord?.dateKey === todayKey ? profile.dailyRecord.bestScore : 0;

    // Ensure selected stage is unlocked
    if (this.selectedStage > profile.unlockedStage) {
      this.selectedStage = profile.unlockedStage;
    }
    const currentStageRec = profile.stageRecords[this.selectedStage];
    const overclockUnlocked =
      currentStageRec.clearedNormal || currentStageRec.clearedOverclocked;
    if (this.selectedMode === 'stage' && !overclockUnlocked) {
      this.selectedDifficulty = 'normal';
    }

    let modeBodyHtml = '';
    if (this.selectedMode === 'stage') {
      modeBodyHtml = `
        <div class="stage-strip">
          ${STAGE_CATALOG.map((st) => {
            const locked = st.id > profile.unlockedStage;
            const rec = profile.stageRecords[st.id];
            const active = this.selectedStage === st.id;
            return `
              <button type="button" class="stage-card ${active ? 'active' : ''} ${locked ? 'locked' : ''}"
                style="--stage-accent:${st.accentHex}" data-stage="${st.id}" ${locked ? 'disabled' : ''}>
                <span class="stage-card-num">SECTOR 0${st.id} ${locked ? '🔒' : ''}</span>
                <span class="stage-card-name">${st.name}</span>
                <span class="stage-card-meta">
                  <span>${st.lengthMeters}m · BOSS</span>
                  ${rec.bestRank !== 'NONE' ? `<span class="grade-badge">${rec.bestRank}</span>` : ''}
                </span>
              </button>
            `;
          }).join('')}
        </div>
        <div class="diff-row">
          <button type="button" class="pill-opt ${this.selectedDifficulty === 'normal' ? 'active' : ''}" data-diff="normal">
            NORMAL
          </button>
          <button type="button" class="pill-opt ${this.selectedDifficulty === 'overclocked' ? 'active' : ''}"
            data-diff="overclocked" ${overclockUnlocked ? '' : 'disabled'}>
            ${overclockUnlocked ? '💀 OVERCLOCKED (HARD)' : '🔒 CLEAR NORMAL TO UNLOCK HARD'}
          </button>
        </div>
      `;
    } else if (this.selectedMode === 'daily') {
      modeBodyHtml = `
        <div class="daily-card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="color:var(--gold);font-size:0.9rem;">📅 DAILY SEED // ${todayKey}</strong>
            <span style="font-size:0.78rem;color:var(--cyan);font-weight:800;">BEST: ${dailyBest.toLocaleString()}</span>
          </div>
          <span style="font-size:0.78rem;color:#cbd5e1;">
            Identical deterministic obstacle layout &amp; Boss run for every pilot today. Compete for #1!
          </span>
        </div>
      `;
    } else {
      modeBodyHtml = `
        <div class="daily-card" style="border-color:rgba(0,240,255,0.45);">
          <strong style="color:var(--cyan);font-size:0.9rem;">♾️ ENDLESS OVERDRIVE</strong>
          <span style="font-size:0.78rem;color:#cbd5e1;">
            Seamless sector cycling every 1,400m with escalating speed &amp; Wave Bosses. How long can you survive?
          </span>
        </div>
      `;
    }

    const activeMount = getWingSpec(profile.equipped.wing);
    const activeMountIdx = Math.max(
      0,
      WING_CATALOG.findIndex((w) => w.id === activeMount.id)
    );

    const screen = document.createElement('div');
    screen.className = 'title-screen';
    screen.innerHTML = `
      <div class="title-topbar">
        <button class="glass-pill pilot-chip" id="btn-pilot-chip" type="button">
          <span class="pilot-avatar">${escapeHtml(profile.avatar)}</span>
          <span class="pilot-meta">
            <span class="pilot-name">
              ${escapeHtml(profile.name)}
              <span class="rank-tag">${rankInfo.current.badge} ${rankInfo.current.title}</span>
            </span>
            <span class="pilot-stars">⭐ ${profile.stars.toLocaleString()} · BEST ${profile.bestScore.toLocaleString()}</span>
          </span>
        </button>
        <div class="title-actions-top">
          <button class="btn btn-icon" id="btn-bounties" type="button" title="Bounties & Medals">🎯</button>
          <button class="btn btn-icon" id="btn-leaderboard" type="button" title="Leaderboard & Pilots">🏆</button>
          <button class="btn btn-icon" id="btn-settings" type="button" title="Settings">⚙️</button>
          <button class="btn btn-icon" id="btn-mute" type="button" title="Sound">${settings.muted ? '🔇' : '🔊'}</button>
          ${canFullscreen ? `<button class="btn btn-icon" id="btn-fullscreen" type="button" title="Fullscreen">⛶</button>` : ''}
        </div>
      </div>

      <div class="title-main-row">
        <div class="title-center">
          <div class="glass-pill game-logo-badge">⚡ 3D NEON AERIAL ARCADE</div>
          <h1 class="game-title">SKY GLIDE // OVERDRIVE</h1>
          <p class="game-subtitle">
            Thread rings dead-center for Bullseye Fever, razor-graze lasers, deflect Boss plasma, and fly Nusantara mounts!
          </p>

          <div class="mode-toggle" role="tablist" aria-label="Game Mode">
            <button class="mode-pill ${this.selectedMode === 'stage' ? 'active' : ''}" data-mode="stage" type="button">
              ⚔️ Campaign
            </button>
            <button class="mode-pill ${this.selectedMode === 'endless' ? 'active' : ''}" data-mode="endless" type="button">
              ♾️ Endless
            </button>
            <button class="mode-pill ${this.selectedMode === 'daily' ? 'active' : ''}" data-mode="daily" type="button">
              📅 Daily Run
            </button>
          </div>

          ${modeBodyHtml}

          <div class="title-cta-row">
            <button class="btn btn-primary" id="btn-play" type="button">🚀 LAUNCH FLIGHT</button>
            <button class="btn ${canUpgrade ? 'btn-gold' : 'btn-secondary'}" id="btn-hangar" type="button">
              🛠️ HANGAR ${canUpgrade ? '• UPGRADE!' : ''}
            </button>
          </div>
        </div>

        <div class="glass-panel mount-switcher-dock" aria-label="Pilih Tunggangan Nusantara">
          <div class="mount-dock-top">
            <span class="mount-origin-badge">✨ ${escapeHtml(activeMount.origin)}</span>
            <span class="mount-index-tag">${activeMountIdx + 1}/${WING_CATALOG.length} · GRATIS</span>
          </div>

          <div class="mount-selector-row">
            <button class="btn btn-icon mount-nav-btn" id="btn-mount-prev" type="button" aria-label="Tunggangan Sebelumnya">◀</button>
            <div class="mount-info-center">
              <div class="mount-title-line">
                <span class="mount-emoji">${activeMount.icon}</span>
                <span class="mount-name">${escapeHtml(activeMount.name)}</span>
              </div>
              <p class="mount-desc">${escapeHtml(activeMount.description)}</p>
            </div>
            <button class="btn btn-icon mount-nav-btn" id="btn-mount-next" type="button" aria-label="Tunggangan Berikutnya">▶</button>
          </div>

          <div class="mount-skill-line">
            <span>${activeMount.skillIcon} <strong>${escapeHtml(activeMount.skillName)}</strong></span>
            <span style="color:var(--gold);">${escapeHtml(activeMount.passiveLabel)}</span>
          </div>

          <div class="mount-quick-strip">
            ${WING_CATALOG.map(
              (w) => `
              <button type="button" class="mount-quick-btn ${w.id === activeMount.id ? 'active' : ''}"
                data-quick-mount="${w.id}" title="${escapeHtml(w.name)}" style="--mount-swatch:${w.swatch}">
                <span>${w.icon}</span>
              </button>
            `
            ).join('')}
          </div>
        </div>
      </div>

      <div class="title-bottom">
        <div class="bounty-mini-strip" id="bounty-strip" title="Open Bounties">
          ${profile.bounties
            .map(
              (b) => `
              <div class="glass-pill bounty-mini-chip">
                <span>🎯</span>
                <span>${escapeHtml(b.title)}</span>
                <span style="color:var(--cyan);">${b.progress}/${b.target}</span>
              </div>
            `
            )
            .join('')}
        </div>
        <div class="glass-pill controls-tip">
          PC: WASD/Arrows · X / Click Fire · SPACE Boost · SHIFT Roll · Q Skill &nbsp;|&nbsp; ◀/▶ Ganti Tunggangan
        </div>
      </div>
    `;

    this.overlaysLayer.appendChild(screen);

    screen.querySelectorAll<HTMLButtonElement>('.mode-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.unlock();
        this.sound.playUiClick();
        const mode = btn.dataset.mode as GameMode;
        this.selectedMode = mode;
        storage.saveSettings({ preferredMode: mode });
        this.renderOverlays();
      });
    });

    screen.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.unlock();
        this.sound.playUiClick();
        const sid = Number(btn.dataset.stage) as StageId;
        this.selectedStage = sid;
        storage.saveSettings({ preferredStage: sid });
        this.engine.setTitlePreviewBiome(sid);
        this.renderOverlays();
      });
    });

    screen.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.unlock();
        this.sound.playUiClick();
        const diff = btn.dataset.diff as Difficulty;
        this.selectedDifficulty = diff;
        storage.saveSettings({ preferredDifficulty: diff });
        this.renderOverlays();
      });
    });

    document.getElementById('btn-play')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      this.launchCurrentSelection();
    });

    document.getElementById('btn-hangar')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      this.engine.openHangar();
    });

    document.getElementById('btn-bounties')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      this.activeModal = 'bounties';
      this.renderOverlays();
    });

    document.getElementById('bounty-strip')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      this.activeModal = 'bounties';
      this.renderOverlays();
    });

    document.getElementById('btn-pilot-chip')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      this.boardTab = 'profiles';
      this.activeModal = 'leaderboard';
      this.renderOverlays();
    });

    document.getElementById('btn-leaderboard')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      this.boardTab = 'leaderboard';
      this.activeModal = 'leaderboard';
      this.renderOverlays();
    });

    document.getElementById('btn-settings')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      this.activeModal = 'settings';
      this.renderOverlays();
    });

    document.getElementById('btn-mute')?.addEventListener('click', () => this.toggleMute());
    document.getElementById('btn-fullscreen')?.addEventListener('click', () => this.toggleFullscreen());

    document.getElementById('btn-mount-prev')?.addEventListener('click', () => this.cycleMount(-1));
    document.getElementById('btn-mount-next')?.addEventListener('click', () => this.cycleMount(1));
    screen.querySelectorAll<HTMLButtonElement>('[data-quick-mount]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectMount(btn.dataset.quickMount as WingId);
      });
    });
  }

  private cycleMount(delta: -1 | 1): void {
    const profile = storage.getActiveProfile();
    const curIdx = Math.max(
      0,
      WING_CATALOG.findIndex((w) => w.id === profile.equipped.wing)
    );
    const nextIdx = (curIdx + delta + WING_CATALOG.length) % WING_CATALOG.length;
    this.selectMount(WING_CATALOG[nextIdx].id);
  }

  private selectMount(id: WingId): void {
    this.sound.unlock();
    const res = storage.purchaseOrEquipWing(id);
    if (res.ok) {
      this.sound.playUnlock();
      this.engine.syncCosmeticsFromProfile();
      this.engine.previewMountSwitchEffect();
    }
    this.renderOverlays();
  }

  private launchCurrentSelection(): void {
    const stageId: StageId = this.selectedMode === 'daily' ? 2 : this.selectedStage;
    const diff: Difficulty = this.selectedMode === 'stage' ? this.selectedDifficulty : 'normal';
    this.engine.startRun({
      mode: this.selectedMode,
      stageId,
      difficulty: diff
    });
  }

  private renderHangarModal(): void {
    const profile = storage.getActiveProfile();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop hangar-open';

    let gridHtml = '';
    if (this.hangarTab === 'upgrades') {
      gridHtml = UPGRADE_CATALOG.map((u) => {
        const level = profile.upgrades[u.id];
        const isMax = level >= u.maxLevel;
        const cost = isMax ? 0 : u.costs[level];
        const canAfford = profile.stars >= cost;
        const pips = Array.from({ length: u.maxLevel })
          .map((_, i) => `<span class="level-pip ${i < level ? 'filled' : ''}"></span>`)
          .join('');
        return `
          <div class="shop-item">
            <div>
              <div class="shop-item-head">
                <span class="shop-item-title">${u.icon} ${u.name}</span>
                <span style="font-size:0.75rem;font-weight:900;color:var(--cyan);">LV.${level}/${u.maxLevel}</span>
              </div>
              <p class="shop-item-desc">${u.description}</p>
              <p class="shop-item-desc" style="color:var(--emerald);font-weight:800;margin-top:5px;">${u.effectLabel(level)}</p>
            </div>
            <div class="level-pips">${pips}</div>
            <button class="btn ${isMax ? 'btn-secondary' : 'btn-gold'}" style="padding:9px 14px;font-size:0.8rem;"
              data-upgrade="${u.id}" ${isMax || !canAfford ? 'disabled' : ''}>
              ${isMax ? 'MAXED' : `UPGRADE ⭐ ${cost}`}
            </button>
          </div>
        `;
      }).join('');
    } else if (this.hangarTab === 'wings') {
      gridHtml = WING_CATALOG.map((w) => {
        const equipped = profile.equipped.wing === w.id;
        return `
          <div class="shop-item ${equipped ? 'equipped' : ''}">
            <div>
              <div class="shop-item-head">
                <span class="shop-item-title">${w.icon} ${w.name}</span>
                <span class="swatch-dot" style="background:${w.swatch}"></span>
              </div>
              <div style="font-size:0.7rem;font-weight:800;color:var(--gold);margin-top:2px;">✨ ${escapeHtml(w.origin)}</div>
              <p class="shop-item-desc">${w.description}</p>
              <div class="skill-box">
                <strong style="color:var(--cyan);">${w.skillIcon} ${w.skillName} (${w.skillCooldown}s)</strong><br/>
                <span style="color:#cbd5e1;">${w.skillDesc}</span><br/>
                <span style="color:var(--gold);font-weight:800;">Pasif: ${w.passiveLabel}</span>
              </div>
            </div>
            <button class="btn ${equipped ? 'btn-secondary' : 'btn-sky'}"
              style="padding:9px 14px;font-size:0.8rem;" data-wing="${w.id}"
              ${equipped ? 'disabled' : ''}>
              ${equipped ? '✓ DIPAKAI' : 'PILIH'}
            </button>
          </div>
        `;
      }).join('');
    } else if (this.hangarTab === 'trails') {
      gridHtml = TRAIL_CATALOG.map((t) => {
        const owned = profile.unlockedTrails.includes(t.id);
        const equipped = profile.equipped.trail === t.id;
        const canAfford = profile.stars >= t.cost;
        return `
          <div class="shop-item ${equipped ? 'equipped' : ''}">
            <div>
              <div class="shop-item-head">
                <span class="shop-item-title">${t.icon} ${t.name}</span>
                <span class="swatch-dot" style="background:${t.swatch}"></span>
              </div>
              <p class="shop-item-desc">${t.description}</p>
            </div>
            <button class="btn ${equipped ? 'btn-secondary' : owned ? 'btn-sky' : 'btn-gold'}"
              style="padding:9px 14px;font-size:0.8rem;" data-trail="${t.id}"
              ${equipped || (!owned && !canAfford) ? 'disabled' : ''}>
              ${equipped ? '✓ EQUIPPED' : owned ? 'EQUIP TRAIL' : `UNLOCK ⭐ ${t.cost}`}
            </button>
          </div>
        `;
      }).join('');
    } else {
      gridHtml = AVIATOR_CATALOG.map((a) => {
        const owned = profile.unlockedAviators.includes(a.id);
        const equipped = profile.equipped.aviator === a.id;
        const canAfford = profile.stars >= a.cost;
        return `
          <div class="shop-item ${equipped ? 'equipped' : ''}">
            <div>
              <div class="shop-item-head">
                <span class="shop-item-title">${a.icon} ${a.name}</span>
                <span class="swatch-dot" style="background:${a.swatch}"></span>
              </div>
              <p class="shop-item-desc">${a.description}</p>
            </div>
            <button class="btn ${equipped ? 'btn-secondary' : owned ? 'btn-sky' : 'btn-gold'}"
              style="padding:9px 14px;font-size:0.8rem;" data-aviator="${a.id}"
              ${equipped || (!owned && !canAfford) ? 'disabled' : ''}>
              ${equipped ? '✓ EQUIPPED' : owned ? 'APPLY SKIN' : `UNLOCK ⭐ ${a.cost}`}
            </button>
          </div>
        `;
      }).join('');
    }

    backdrop.innerHTML = `
      <div class="glass-panel modal-card hangar-card">
        <div class="modal-header">
          <h2 class="modal-title">🛠️ CYBER HANGAR</h2>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-weight:900;color:var(--gold);background:rgba(255,208,0,0.14);border:1px solid rgba(255,208,0,0.4);padding:5px 11px;border-radius:999px;">
              ⭐ ${profile.stars.toLocaleString()}
            </span>
            <button class="btn btn-secondary" style="padding:7px 12px;" id="hangar-close-btn" type="button">✕</button>
          </div>
        </div>
        <div class="modal-body">
          <div class="tabs-row">
            <button class="tab-btn ${this.hangarTab === 'upgrades' ? 'active' : ''}" data-htab="upgrades" type="button">Upgrades</button>
            <button class="tab-btn ${this.hangarTab === 'wings' ? 'active' : ''}" data-htab="wings" type="button">Tunggangan</button>
            <button class="tab-btn ${this.hangarTab === 'trails' ? 'active' : ''}" data-htab="trails" type="button">Trails</button>
            <button class="tab-btn ${this.hangarTab === 'aviator' ? 'active' : ''}" data-htab="aviator" type="button">Kostum</button>
          </div>
          <div class="shop-grid">${gridHtml}</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="hangar-back-btn" type="button">Back</button>
          <button class="btn btn-primary" style="padding:11px 22px;font-size:0.9rem;" id="hangar-fly-btn" type="button">🚀 LAUNCH</button>
        </div>
      </div>
    `;

    this.overlaysLayer.appendChild(backdrop);

    backdrop.querySelectorAll<HTMLButtonElement>('[data-htab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playUiClick();
        this.hangarTab = btn.dataset.htab as HangarTab;
        this.renderOverlays();
      });
    });

    backdrop.querySelectorAll<HTMLButtonElement>('[data-upgrade]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const res = storage.purchaseUpgrade(btn.dataset.upgrade as 'magnet' | 'turbo' | 'shield' | 'combo');
        if (res.ok) this.sound.playUnlock();
        this.renderOverlays();
      });
    });

    backdrop.querySelectorAll<HTMLButtonElement>('[data-wing]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const res = storage.purchaseOrEquipWing(btn.dataset.wing as WingId);
        if (res.ok) {
          this.sound.playUnlock();
          this.engine.syncCosmeticsFromProfile();
          this.engine.previewMountSwitchEffect();
        }
        this.renderOverlays();
      });
    });

    backdrop.querySelectorAll<HTMLButtonElement>('[data-trail]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const res = storage.purchaseOrEquipTrail(btn.dataset.trail as 'golden_dust' | 'rainbow_ribbon' | 'bubble_pop' | 'comet_flame');
        if (res.ok) {
          this.sound.playUnlock();
          this.engine.syncCosmeticsFromProfile();
        }
        this.renderOverlays();
      });
    });

    backdrop.querySelectorAll<HTMLButtonElement>('[data-aviator]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const res = storage.purchaseOrEquipAviator(btn.dataset.aviator as 'classic_pilot' | 'mint_explorer' | 'sunny_bee' | 'cosmic_captain');
        if (res.ok) {
          this.sound.playUnlock();
          this.engine.syncCosmeticsFromProfile();
        }
        this.renderOverlays();
      });
    });

    const closeHangar = () => {
      this.sound.playUiClick();
      this.engine.returnToTitle();
    };
    document.getElementById('hangar-close-btn')?.addEventListener('click', closeHangar);
    document.getElementById('hangar-back-btn')?.addEventListener('click', closeHangar);
    document.getElementById('hangar-fly-btn')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.launchCurrentSelection();
    });
  }

  private renderBountiesModal(): void {
    const profile = storage.getActiveProfile();
    const rankInfo = getPilotRankInfo(profile.xp);

    const bodyHtml =
      this.bountyTab === 'bounties'
        ? `
          <div style="display:flex;flex-direction:column;gap:9px;">
            ${profile.bounties
              .map(
                (b) => `
                <div class="bounty-row">
                  <div style="flex:1;">
                    <div style="font-weight:900;font-size:0.9rem;">🎯 ${escapeHtml(b.title)}</div>
                    <div class="progress-bar-slim">
                      <div style="width:${Math.min(100, Math.round((b.progress / b.target) * 100))}%"></div>
                    </div>
                  </div>
                  <div style="text-align:right;font-size:0.78rem;font-weight:900;">
                    <div style="color:var(--cyan);">${b.progress}/${b.target}</div>
                    <div style="color:var(--gold);">+⭐${b.rewardStars} · +${b.rewardXp}XP</div>
                  </div>
                </div>
              `
              )
              .join('')}
          </div>
          <div class="pwa-tip">
            Bounties auto-complete at the end of each flight and immediately roll a fresh contract!
          </div>
        `
        : `
          <div class="bounty-row" style="flex-direction:column;align-items:stretch;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong>${rankInfo.current.badge} PILOT RANK: ${rankInfo.current.title} (LV.${rankInfo.current.level})</strong>
              <span style="color:var(--cyan);font-size:0.82rem;font-weight:800;">
                ${profile.xp.toLocaleString()} XP ${rankInfo.next ? `/ ${rankInfo.next.minXp.toLocaleString()}` : '(MAX)'}
              </span>
            </div>
            <div class="progress-bar-slim"><div style="width:${Math.round(rankInfo.progressRatio * 100)}%"></div></div>
          </div>
          <div class="shop-grid">
            ${ACHIEVEMENT_CATALOG.map((ach) => {
              const unlocked = profile.achievements.includes(ach.id);
              return `
                <div class="medal-card ${unlocked ? 'unlocked' : ''}">
                  <span style="font-size:1.6rem;">${ach.icon}</span>
                  <div>
                    <div style="font-weight:900;font-size:0.86rem;">${ach.name} ${unlocked ? '✓' : ''}</div>
                    <div style="font-size:0.74rem;color:var(--ink-muted);">${ach.description}</div>
                    <div style="font-size:0.72rem;color:var(--gold);font-weight:800;margin-top:2px;">Reward: ⭐ ${ach.rewardStars}</div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="glass-panel modal-card">
        <div class="modal-header">
          <h2 class="modal-title">🎯 BOUNTIES &amp; PILOT RANK</h2>
          <button class="btn btn-secondary" style="padding:7px 12px;" id="bounty-close-btn" type="button">✕</button>
        </div>
        <div class="modal-body">
          <div class="tabs-row">
            <button class="tab-btn ${this.bountyTab === 'bounties' ? 'active' : ''}" data-bt="bounties" type="button">🎯 Active Bounties (3)</button>
            <button class="tab-btn ${this.bountyTab === 'medals' ? 'active' : ''}" data-bt="medals" type="button">🏅 Rank &amp; Medals (${profile.achievements.length}/${ACHIEVEMENT_CATALOG.length})</button>
          </div>
          ${bodyHtml}
        </div>
      </div>
    `;
    this.overlaysLayer.appendChild(backdrop);

    backdrop.querySelectorAll<HTMLButtonElement>('[data-bt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playUiClick();
        this.bountyTab = btn.dataset.bt as BountyTab;
        this.renderOverlays();
      });
    });

    document.getElementById('bounty-close-btn')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.activeModal = 'none';
      this.renderOverlays();
    });
  }

  private renderLeaderboardModal(): void {
    const profiles = storage.getProfiles();
    const active = storage.getActiveProfile();
    const entries = storage.getLeaderboard();

    const bodyHtml =
      this.boardTab === 'leaderboard'
        ? entries.length === 0
          ? `<div class="pwa-tip" style="text-align:center;">No sorties logged yet. Launch an interceptor to set the first benchmark!</div>`
          : `<div style="display:flex;flex-direction:column;gap:8px;">
              ${entries
                .slice(0, 14)
                .map(
                  (e, i) => `
                  <div class="lb-row">
                    <div style="display:flex;align-items:center;gap:10px;">
                      <strong style="width:26px;color:var(--cyan);">#${i + 1}</strong>
                      <span style="font-size:1.2rem;">${escapeHtml(e.avatar)}</span>
                      <div>
                        <div style="font-weight:900;font-size:0.88rem;">
                          ${escapeHtml(e.pilotName)}
                          ${e.rank ? `<span class="grade-badge">${e.rank}</span>` : ''}
                        </div>
                        <div style="font-size:0.72rem;color:var(--ink-muted);">
                          ${e.distance}m · x${e.maxCombo} · ${e.mode.toUpperCase()}${e.stageId ? ` S${e.stageId}` : ''}
                        </div>
                      </div>
                    </div>
                    <strong style="font-size:1rem;color:var(--gold);">${e.score.toLocaleString()}</strong>
                  </div>
                `
                )
                .join('')}
            </div>`
        : `
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${profiles
              .map((p) => {
                const rInfo = getPilotRankInfo(p.xp);
                return `
                <div class="profile-row ${p.id === active.id ? 'active' : ''}">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:1.35rem;">${escapeHtml(p.avatar)}</span>
                    <div>
                      <div style="font-weight:900;font-size:0.9rem;">
                        ${escapeHtml(p.name)}
                        <span class="rank-tag">${rInfo.current.title}</span>
                      </div>
                      <div style="font-size:0.74rem;color:var(--ink-muted);">
                        ⭐ ${p.stars.toLocaleString()} · Best ${p.bestScore.toLocaleString()} · ${p.totalFlights} sorties
                      </div>
                    </div>
                  </div>
                  <div style="display:flex;gap:6px;">
                    ${p.id !== active.id ? `<button class="btn btn-sky" style="padding:7px 12px;font-size:0.76rem;" data-select-profile="${p.id}">Select</button>` : ''}
                    ${profiles.length > 1 ? `<button class="btn btn-danger" style="padding:7px 10px;font-size:0.76rem;" data-del-profile="${p.id}">✕</button>` : ''}
                  </div>
                </div>
              `;
              })
              .join('')}
          </div>
          <div class="bounty-row" style="flex-direction:column;align-items:stretch;gap:8px;">
            <strong style="font-size:0.84rem;">CREATE NEW PILOT CALLSIGN</strong>
            <div class="avatar-picker">
              ${PILOT_AVATARS.map(
                (av) => `<button type="button" class="avatar-opt ${this.newPilotAvatar === av ? 'selected' : ''}" data-pick-avatar="${av}">${av}</button>`
              ).join('')}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <input id="new-pilot-name" class="text-input" type="text" maxlength="16" placeholder="Callsign (e.g., NOVA)" />
              <button id="create-pilot-btn" class="btn btn-primary" style="padding:9px 18px;font-size:0.84rem;" type="button">Create</button>
            </div>
          </div>
        `;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="glass-panel modal-card">
        <div class="modal-header">
          <h2 class="modal-title">🏆 HIGH SCORES &amp; PILOTS</h2>
          <button class="btn btn-secondary" style="padding:7px 12px;" id="modal-close-btn" type="button">✕</button>
        </div>
        <div class="modal-body">
          <div class="tabs-row">
            <button class="tab-btn ${this.boardTab === 'leaderboard' ? 'active' : ''}" data-btab="leaderboard" type="button">🏆 High Scores</button>
            <button class="tab-btn ${this.boardTab === 'profiles' ? 'active' : ''}" data-btab="profiles" type="button">👨‍✈️ Pilots (${profiles.length})</button>
          </div>
          ${bodyHtml}
        </div>
      </div>
    `;
    this.overlaysLayer.appendChild(backdrop);

    backdrop.querySelectorAll<HTMLButtonElement>('[data-btab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playUiClick();
        this.boardTab = btn.dataset.btab as BoardTab;
        this.renderOverlays();
      });
    });

    backdrop.querySelectorAll<HTMLButtonElement>('[data-select-profile]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playUiClick();
        storage.setActiveProfile(btn.dataset.selectProfile!);
        this.engine.syncCosmeticsFromProfile();
        this.renderOverlays();
      });
    });

    backdrop.querySelectorAll<HTMLButtonElement>('[data-del-profile]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playUiClick();
        storage.deleteProfile(btn.dataset.delProfile!);
        this.engine.syncCosmeticsFromProfile();
        this.renderOverlays();
      });
    });

    backdrop.querySelectorAll<HTMLButtonElement>('[data-pick-avatar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playUiClick();
        this.newPilotAvatar = btn.dataset.pickAvatar || PILOT_AVATARS[0];
        this.renderOverlays();
      });
    });

    document.getElementById('create-pilot-btn')?.addEventListener('click', () => {
      const input = document.getElementById('new-pilot-name') as HTMLInputElement | null;
      const name = input?.value.trim() || 'Nova Ace';
      storage.createProfile(name, this.newPilotAvatar);
      this.sound.playUnlock();
      this.engine.syncCosmeticsFromProfile();
      this.renderOverlays();
    });

    document.getElementById('modal-close-btn')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.activeModal = 'none';
      this.renderOverlays();
    });
  }

  private renderSettingsModal(): void {
    const settings = storage.getSettings();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="glass-panel modal-card compact">
        <div class="modal-header">
          <h2 class="modal-title">⚙️ SYSTEM SETTINGS</h2>
          <button class="btn btn-secondary" style="padding:7px 12px;" id="settings-close-btn" type="button">✕</button>
        </div>
        <div class="modal-body">
          <div class="setting-row">
            <strong>🎵 Synth Music</strong>
            <input id="set-music" type="range" min="0" max="100" value="${Math.round(settings.musicVolume * 100)}" />
          </div>
          <div class="setting-row">
            <strong>🔊 Arcade SFX</strong>
            <input id="set-sfx" type="range" min="0" max="100" value="${Math.round(settings.sfxVolume * 100)}" />
          </div>
          <div class="setting-row">
            <strong>↕️ Invert Pitch</strong>
            <button id="set-invert" class="pill-opt ${settings.invertY ? 'active' : ''}" type="button">
              ${settings.invertY ? 'ON (FLIGHT SIM)' : 'OFF (ARCADE)'}
            </button>
          </div>
          <div class="setting-row">
            <strong>✨ Graphics</strong>
            <div class="pill-select">
              ${(['high', 'balanced', 'saver'] as GraphicsQuality[])
                .map(
                  (q) =>
                    `<button class="pill-opt ${settings.quality === q ? 'active' : ''}" data-quality="${q}" type="button">${q.toUpperCase()}</button>`
                )
                .join('')}
            </div>
          </div>
          <div class="setting-row">
            <strong>⚡ Auto-Quality</strong>
            <button id="set-auto-quality" class="pill-opt ${settings.autoQuality ? 'active' : ''}" type="button">
              ${settings.autoQuality ? 'ON (ADAPTIVE)' : 'OFF (MANUAL)'}
            </button>
          </div>
          <div class="setting-row">
            <strong>📊 FPS Counter</strong>
            <button id="set-show-fps" class="pill-opt ${settings.showFps ? 'active' : ''}" type="button">
              ${settings.showFps ? 'ON' : 'OFF'}
            </button>
          </div>
          <div class="pwa-tip">
            📱 <strong>iPhone/iPad Fullscreen:</strong> Tap Safari <strong>Share → Add to Home Screen</strong> for fullscreen offline play!
          </div>
        </div>
      </div>
    `;
    this.overlaysLayer.appendChild(backdrop);

    const musicSlider = document.getElementById('set-music') as HTMLInputElement | null;
    const sfxSlider = document.getElementById('set-sfx') as HTMLInputElement | null;

    musicSlider?.addEventListener('input', () => {
      const val = Number(musicSlider.value) / 100;
      const next = storage.saveSettings({ musicVolume: val, muted: false });
      this.sound.setVolumes(next.musicVolume, next.sfxVolume, next.muted);
    });
    sfxSlider?.addEventListener('input', () => {
      const val = Number(sfxSlider.value) / 100;
      const next = storage.saveSettings({ sfxVolume: val, muted: false });
      this.sound.setVolumes(next.musicVolume, next.sfxVolume, next.muted);
    });
    document.getElementById('set-invert')?.addEventListener('click', () => {
      this.sound.playUiClick();
      storage.saveSettings({ invertY: !storage.getSettings().invertY });
      this.renderOverlays();
    });
    backdrop.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playUiClick();
        const q = btn.dataset.quality as GraphicsQuality;
        storage.saveSettings({ quality: q });
        this.engine.applyQualitySettings(q);
        this.renderOverlays();
      });
    });
    document.getElementById('set-auto-quality')?.addEventListener('click', () => {
      this.sound.playUiClick();
      const next = !storage.getSettings().autoQuality;
      storage.saveSettings({ autoQuality: next });
      this.engine.setAutoQuality(next);
      this.renderOverlays();
    });
    document.getElementById('set-show-fps')?.addEventListener('click', () => {
      this.sound.playUiClick();
      const next = !storage.getSettings().showFps;
      storage.saveSettings({ showFps: next });
      this.engine.setShowFps(next);
      this.syncPerfVisibility();
      this.renderOverlays();
    });
    document.getElementById('settings-close-btn')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.activeModal = 'none';
      this.renderOverlays();
    });
  }

  private renderPauseModal(): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="glass-panel modal-card compact">
        <div class="modal-header">
          <h2 class="modal-title">⏸️ SORTIE PAUSED</h2>
        </div>
        <div class="modal-body" style="gap:10px;">
          <button class="btn btn-primary" id="pause-resume-btn" type="button">▶ Resume Flight</button>
          <button class="btn btn-sky" id="pause-restart-btn" type="button">↻ Restart Sortie</button>
          <button class="btn btn-secondary" id="pause-finish-btn" type="button">⭐ Bank Stars &amp; End</button>
          <button class="btn btn-secondary" id="pause-title-btn" type="button">🏠 Main Menu</button>
        </div>
      </div>
    `;
    this.overlaysLayer.appendChild(backdrop);

    document.getElementById('pause-resume-btn')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.engine.resumeRun();
    });
    document.getElementById('pause-restart-btn')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.launchCurrentSelection();
    });
    document.getElementById('pause-finish-btn')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.engine.endCurrentRun();
    });
    document.getElementById('pause-title-btn')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.engine.returnToTitle();
    });
  }

  private renderGameOverModal(): void {
    const s = this.lastSummary;
    const profile = storage.getActiveProfile();
    if (!s) return;

    const rankInfo = getPilotRankInfo(profile.xp);
    const stageSpec = getStageSpec(s.stageId);
    const canUpgrade = storage.hasAffordableHangarAction(profile);
    const hasNextStage =
      s.mode === 'stage' && s.victory && s.stageId < 4;

    const headline = s.victory
      ? `🏆 SECTOR ${s.stageId} CLEARED!`
      : s.mode === 'endless'
        ? '⚡ ENDLESS RUN COMPLETE'
        : '💥 SIGNAL LOST';

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="glass-panel modal-card compact">
        <div class="modal-header">
          <h2 class="modal-title">${headline}</h2>
          <span style="font-weight:900;color:var(--gold);">⭐ ${profile.stars.toLocaleString()}</span>
        </div>
        <div class="modal-body">
          ${s.isNewBest ? `<div class="new-best-banner">🏆 NEW PERSONAL RECORD!</div>` : ''}

          <div class="grade-hero">
            <div>
              <div style="font-size:0.74rem;color:var(--cyan);font-weight:800;">
                ${s.mode === 'stage' ? `${stageSpec.name} · ${s.difficulty.toUpperCase()}` : s.mode.toUpperCase()}
              </div>
              <div style="font-size:1.55rem;font-weight:900;">${s.score.toLocaleString()} <span style="font-size:0.8rem;color:var(--ink-muted);">PTS</span></div>
              <div style="font-size:0.76rem;color:var(--emerald);font-weight:800;">
                +${s.xpGained} XP · ${rankInfo.current.badge} ${rankInfo.current.title}
                ${s.rankUpCount > 0 ? `<span style="color:var(--gold);"> (RANK UP +⭐${s.rankUpCount * 75}!)</span>` : ''}
              </div>
            </div>
            ${s.grade !== 'NONE' ? `<div class="grade-stamp ${s.grade}">${s.grade}</div>` : ''}
          </div>

          <div class="stats-grid">
            <div class="stat-tile">
              <div class="stat-tile-label">Stars Banked</div>
              <div class="stat-tile-value" style="color:var(--gold);">+⭐ ${(s.starsCollected + s.bonusStarsEarned).toLocaleString()}</div>
            </div>
            <div class="stat-tile">
              <div class="stat-tile-label">Distance / Chain</div>
              <div class="stat-tile-value">${s.distance}m · x${s.maxCombo}</div>
            </div>
            <div class="stat-tile">
              <div class="stat-tile-label">Bullseyes / Grazes</div>
              <div class="stat-tile-value" style="color:var(--cyan);">🎯 ${s.bullseyes} · ⚡ ${s.grazes}</div>
            </div>
            <div class="stat-tile">
              <div class="stat-tile-label">Deflects / Fever</div>
              <div class="stat-tile-value" style="color:var(--magenta);">🛡️ ${s.deflects} · 🔥 ${s.feverCount}</div>
            </div>
          </div>

          ${
            s.bountiesCompleted.length > 0
              ? `<div class="new-best-banner" style="border-color:var(--emerald);color:var(--emerald);">
                  🎯 BOUNTY COMPLETE: ${s.bountiesCompleted.map((b) => escapeHtml(b.title)).join(' · ')}
                </div>`
              : ''
          }

          ${
            s.newAchievements.length > 0
              ? `<div class="new-best-banner">
                  🏅 MEDAL UNLOCKED: ${s.newAchievements
                    .map((id) => ACHIEVEMENT_CATALOG.find((a) => a.id === id)?.name ?? id)
                    .join(', ')}
                </div>`
              : ''
          }

          ${s.nudgeText ? `<div class="nudge-banner">💡 ${escapeHtml(s.nudgeText)}</div>` : ''}
        </div>

        <div class="modal-footer" style="justify-content:center;">
          ${
            hasNextStage
              ? `<button class="btn btn-primary" id="go-next-btn" type="button">➡ SECTOR ${s.stageId + 1}</button>`
              : `<button class="btn btn-primary" id="go-retry-btn" type="button">🚀 FLY AGAIN</button>`
          }
          <button class="btn ${canUpgrade ? 'btn-gold' : 'btn-sky'}" id="go-hangar-btn" type="button">
            🛠️ HANGAR ${canUpgrade ? '!' : ''}
          </button>
          ${hasNextStage ? `<button class="btn btn-secondary" id="go-retry-btn" type="button">↻ Replay</button>` : ''}
          <button class="btn btn-secondary" id="go-title-btn" type="button">🏠 Menu</button>
        </div>
      </div>
    `;

    this.overlaysLayer.appendChild(backdrop);

    document.getElementById('go-next-btn')?.addEventListener('click', () => {
      this.sound.playUiClick();
      const nextId = Math.min(4, s.stageId + 1) as StageId;
      this.selectedStage = nextId;
      this.selectedDifficulty = 'normal';
      storage.saveSettings({ preferredStage: nextId, preferredDifficulty: 'normal' });
      this.launchCurrentSelection();
    });

    document.getElementById('go-retry-btn')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.launchCurrentSelection();
    });

    document.getElementById('go-hangar-btn')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.engine.openHangar();
    });

    document.getElementById('go-title-btn')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.engine.returnToTitle();
    });
  }

  private toggleMute(): void {
    this.sound.unlock();
    const cur = storage.getSettings();
    const next = storage.saveSettings({ muted: !cur.muted });
    this.sound.setVolumes(next.musicVolume, next.sfxVolume, next.muted);
    if (!next.muted) this.sound.playUiClick();
    if (this.hudMuteBtn) {
      this.hudMuteBtn.textContent = next.muted ? '🔇' : '🔊';
    }
    if (this.engine.getState() === 'title') {
      this.renderOverlays();
    }
  }

  private toggleFullscreen(): void {
    this.sound.unlock();
    this.sound.playUiClick();
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  }

  private updateRotateGuard(): void {
    const isNarrowPortrait = window.innerHeight > window.innerWidth && window.innerWidth < 700;
    this.rotateOverlay.classList.toggle('hidden', !isNarrowPortrait || this.rotateDismissed);
  }
}
