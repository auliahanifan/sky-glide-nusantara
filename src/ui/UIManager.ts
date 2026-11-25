import {
  AVIATOR_CATALOG,
  PILOT_AVATARS,
  TRAIL_CATALOG,
  UPGRADE_CATALOG,
  WING_CATALOG
} from '../data/catalog';
import { storage } from '../data/storage';
import type { SoundEngine } from '../audio/SoundEngine';
import type { SkyGlideEngine } from '../gameplay/SkyGlideEngine';
import type {
  GameMode,
  GameState,
  GraphicsQuality,
  HudSnapshot,
  RunSummary
} from '../types/game';

type ActiveModal = 'none' | 'hangar' | 'leaderboard' | 'settings' | 'pause' | 'gameover';
type HangarTab = 'upgrades' | 'wings' | 'trails' | 'aviator';
type BoardTab = 'leaderboard' | 'profiles';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export class UIManager {
  private readonly hudLayer: HTMLElement;
  private readonly overlaysLayer: HTMLElement;
  private readonly rotateOverlay: HTMLElement;
  private readonly engine: SkyGlideEngine;
  private readonly sound: SoundEngine;

  private activeModal: ActiveModal = 'none';
  private hangarTab: HangarTab = 'upgrades';
  private boardTab: BoardTab = 'leaderboard';
  private selectedMode: GameMode;
  private lastSummary: RunSummary | null = null;
  private newPilotAvatar: string = PILOT_AVATARS[0];
  private rotateDismissed = false;

  // Cached HUD DOM refs for 60fps updates without re-rendering full HUD
  private hudStarsEl: HTMLElement | null = null;
  private hudHeartsWrap: HTMLElement | null = null;
  private hudShieldBadge: HTMLElement | null = null;
  private hudComboWrap: HTMLElement | null = null;
  private hudComboLabel: HTMLElement | null = null;
  private hudComboFill: HTMLElement | null = null;
  private hudScoreEl: HTMLElement | null = null;
  private hudDistEl: HTMLElement | null = null;
  private hudTurboWrap: HTMLElement | null = null;
  private hudTurboFill: HTMLElement | null = null;
  private hudMuteBtn: HTMLButtonElement | null = null;
  private calloutTimer: number | null = null;

  constructor(
    hudLayer: HTMLElement,
    overlaysLayer: HTMLElement,
    rotateOverlay: HTMLElement,
    engine: SkyGlideEngine,
    sound: SoundEngine
  ) {
    this.hudLayer = hudLayer;
    this.overlaysLayer = overlaysLayer;
    this.rotateOverlay = rotateOverlay;
    this.engine = engine;
    this.sound = sound;
    this.selectedMode = storage.getSettings().preferredMode;

    const dismissBtn = document.getElementById('dismiss-rotate-btn');
    dismissBtn?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      this.rotateDismissed = true;
      this.updateRotateGuard();
    });

    window.addEventListener('resize', () => this.updateRotateGuard());
    this.updateRotateGuard();
    this.renderOverlays();
  }

  onStateChange(state: GameState): void {
    const showHud = state === 'playing' || state === 'paused';
    this.hudLayer.classList.toggle('hidden', !showHud);

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
      if (this.activeModal === 'pause' || this.activeModal === 'gameover' || this.activeModal === 'hangar') {
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

  showCallout(text: string): void {
    if (this.engine.getState() !== 'playing') return;
    const existing = this.hudLayer.querySelector('.hud-callout');
    existing?.remove();

    const pill = document.createElement('div');
    pill.className = 'hud-callout';
    pill.textContent = text;
    this.hudLayer.appendChild(pill);

    if (this.calloutTimer !== null) window.clearTimeout(this.calloutTimer);
    this.calloutTimer = window.setTimeout(() => {
      pill.remove();
    }, 950);
  }

  updateHud(snap: HudSnapshot): void {
    if (!this.hudStarsEl) this.buildHudDom();

    if (this.hudStarsEl) {
      this.hudStarsEl.textContent = snap.starsRun.toLocaleString();
    }
    if (this.hudScoreEl) {
      this.hudScoreEl.textContent = snap.score.toLocaleString();
    }
    if (this.hudDistEl) {
      this.hudDistEl.textContent = `${snap.distance.toLocaleString()}m`;
    }

    if (this.hudHeartsWrap && snap.mode === 'arcade') {
      const pips = this.hudHeartsWrap.querySelectorAll('.heart-pip');
      pips.forEach((pip, idx) => {
        pip.classList.toggle('lost', idx >= snap.hearts);
      });
    }

    if (this.hudShieldBadge) {
      this.hudShieldBadge.classList.toggle('hidden', !snap.shieldActive);
    }

    if (this.hudComboWrap && this.hudComboLabel && this.hudComboFill) {
      this.hudComboWrap.classList.toggle('hidden', snap.combo <= 1);
      this.hudComboLabel.textContent = `x${snap.combo} COMBO`;
      this.hudComboFill.style.width = `${Math.round(snap.comboTimerRatio * 100)}%`;
    }

    if (this.hudTurboWrap && this.hudTurboFill) {
      this.hudTurboFill.style.width = `${Math.round(snap.boostEnergy * 100)}%`;
      this.hudTurboWrap.classList.toggle('boosting', snap.isBoosting);
    }
  }

  private buildHudDom(): void {
    const settings = storage.getSettings();
    const maxHearts = 3 + (storage.getActiveProfile().upgrades.shield >= 3 ? 1 : 0) + (storage.getActiveProfile().upgrades.shield >= 5 ? 1 : 0);

    const heartsHtml =
      this.selectedMode === 'chill'
        ? `<div class="glass-pill hud-chill-badge">☁️ CHILL FLIGHT</div>`
        : `<div class="glass-pill hud-hearts" id="hud-hearts">${Array.from({ length: maxHearts })
            .map(() => `<span class="heart-pip">❤️</span>`)
            .join('')}</div>`;

    this.hudLayer.innerHTML = `
      <div class="hud-top">
        <div class="hud-left">
          <div class="glass-pill hud-stat">
            <span class="hud-star-icon">⭐</span>
            <span id="hud-stars">0</span>
          </div>
          ${heartsHtml}
          <div class="glass-pill hud-shield-badge hidden" id="hud-shield">🫧 SHIELD</div>
        </div>
        <div class="hud-right">
          <div class="glass-pill hud-combo hidden" id="hud-combo">
            <span class="hud-combo-label" id="hud-combo-label">x2 COMBO</span>
            <div class="hud-combo-bar"><div class="hud-combo-fill" id="hud-combo-fill" style="width:100%"></div></div>
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
      <div class="hud-bottom">
        <div class="glass-pill turbo-wrap" id="hud-turbo-wrap">
          <div class="turbo-header">
            <span>🔥 TURBO</span>
            <span>SPACE / HOLD</span>
          </div>
          <div class="turbo-track">
            <div class="turbo-fill" id="hud-turbo-fill" style="width:100%"></div>
          </div>
        </div>
      </div>
    `;

    this.hudStarsEl = document.getElementById('hud-stars');
    this.hudHeartsWrap = document.getElementById('hud-hearts');
    this.hudShieldBadge = document.getElementById('hud-shield');
    this.hudComboWrap = document.getElementById('hud-combo');
    this.hudComboLabel = document.getElementById('hud-combo-label');
    this.hudComboFill = document.getElementById('hud-combo-fill');
    this.hudScoreEl = document.getElementById('hud-score');
    this.hudDistEl = document.getElementById('hud-dist');
    this.hudTurboWrap = document.getElementById('hud-turbo-wrap');
    this.hudTurboFill = document.getElementById('hud-turbo-fill');
    this.hudMuteBtn = document.getElementById('hud-mute-btn') as HTMLButtonElement | null;

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
    const canFullscreen = Boolean(document.documentElement.requestFullscreen);

    const screen = document.createElement('div');
    screen.className = 'title-screen';
    screen.innerHTML = `
      <div class="title-topbar">
        <button class="glass-pill pilot-chip" id="btn-pilot-chip" type="button">
          <span class="pilot-avatar">${escapeHtml(profile.avatar)}</span>
          <span class="pilot-meta">
            <span class="pilot-name">${escapeHtml(profile.name)}</span>
            <span class="pilot-stars">⭐ ${profile.stars.toLocaleString()} · Best ${profile.bestScore.toLocaleString()}</span>
          </span>
        </button>
        <div class="title-actions-top">
          <button class="btn btn-icon" id="btn-leaderboard" type="button" title="Leaderboard & Pilots">🏆</button>
          <button class="btn btn-icon" id="btn-settings" type="button" title="Settings">⚙️</button>
          <button class="btn btn-icon" id="btn-mute" type="button" title="Sound">${settings.muted ? '🔇' : '🔊'}</button>
          ${canFullscreen ? `<button class="btn btn-icon" id="btn-fullscreen" type="button" title="Fullscreen">⛶</button>` : ''}
        </div>
      </div>

      <div class="title-center">
        <div class="glass-pill game-logo-badge">✈️ 3D Endless Sky Arcade</div>
        <h1 class="game-title">SKY GLIDE</h1>
        <p class="game-subtitle">
          Soar past sunlit floating islands, chain golden boost rings, and customize your toy jetpack glider!
        </p>

        <div class="mode-toggle" role="tablist" aria-label="Game Mode">
          <button class="mode-pill ${this.selectedMode === 'arcade' ? 'active' : ''}" data-mode="arcade" type="button">
            ⚡ Arcade Mode
          </button>
          <button class="mode-pill ${this.selectedMode === 'chill' ? 'active' : ''}" data-mode="chill" type="button">
            ☁️ Chill Free-Fly
          </button>
        </div>

        <div class="title-cta-row">
          <button class="btn btn-primary" id="btn-play" type="button">🚀 FLY NOW</button>
          <button class="btn btn-secondary" id="btn-hangar" type="button">🛠️ Hangar & Upgrades</button>
        </div>
      </div>

      <div class="title-bottom">
        <div class="glass-pill controls-tip">
          📱 Touch: Left thumb steer · Right Boost & Spin &nbsp;|&nbsp; 💻 PC: WASD / Arrows · Space Boost · Shift Spin
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

    document.getElementById('btn-play')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      this.engine.startRun(this.selectedMode);
    });

    document.getElementById('btn-hangar')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      this.engine.openHangar();
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
                <span style="font-size:0.78rem;font-weight:800;color:#0284c7;">Lv.${level}/${u.maxLevel}</span>
              </div>
              <p class="shop-item-desc">${u.description}</p>
              <p class="shop-item-desc" style="color:#0f2942;font-weight:800;margin-top:4px;">${u.effectLabel(level)}</p>
            </div>
            <div class="level-pips">${pips}</div>
            <button class="btn ${isMax ? 'btn-secondary' : 'btn-primary'}" style="padding:9px 14px;font-size:0.86rem;"
              data-upgrade="${u.id}" ${isMax || !canAfford ? 'disabled' : ''}>
              ${isMax ? 'MAXED OUT' : `Upgrade ⭐ ${cost}`}
            </button>
          </div>
        `;
      }).join('');
    } else if (this.hangarTab === 'wings') {
      gridHtml = WING_CATALOG.map((w) => {
        const owned = profile.unlockedWings.includes(w.id);
        const equipped = profile.equipped.wing === w.id;
        const canAfford = profile.stars >= w.cost;
        return `
          <div class="shop-item ${equipped ? 'equipped' : ''}">
            <div>
              <div class="shop-item-head">
                <span class="shop-item-title">${w.icon} ${w.name}</span>
                <span class="swatch-dot" style="background:${w.swatch}"></span>
              </div>
              <p class="shop-item-desc">${w.description}</p>
            </div>
            <button class="btn ${equipped ? 'btn-secondary' : owned ? 'btn-sky' : 'btn-primary'}"
              style="padding:9px 14px;font-size:0.86rem;" data-wing="${w.id}"
              ${equipped || (!owned && !canAfford) ? 'disabled' : ''}>
              ${equipped ? '✓ Equipped' : owned ? 'Equip Wings' : `Unlock ⭐ ${w.cost}`}
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
            <button class="btn ${equipped ? 'btn-secondary' : owned ? 'btn-sky' : 'btn-primary'}"
              style="padding:9px 14px;font-size:0.86rem;" data-trail="${t.id}"
              ${equipped || (!owned && !canAfford) ? 'disabled' : ''}>
              ${equipped ? '✓ Equipped' : owned ? 'Equip Trail' : `Unlock ⭐ ${t.cost}`}
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
            <button class="btn ${equipped ? 'btn-secondary' : owned ? 'btn-sky' : 'btn-primary'}"
              style="padding:9px 14px;font-size:0.86rem;" data-aviator="${a.id}"
              ${equipped || (!owned && !canAfford) ? 'disabled' : ''}>
              ${equipped ? '✓ Equipped' : owned ? 'Wear Outfit' : `Unlock ⭐ ${a.cost}`}
            </button>
          </div>
        `;
      }).join('');
    }

    backdrop.innerHTML = `
      <div class="glass-panel modal-card hangar-card">
        <div class="modal-header">
          <h2 class="modal-title">🛠️ Glider Hangar</h2>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-weight:900;color:#b45309;background:#fef3c7;padding:6px 12px;border-radius:999px;">
              ⭐ ${profile.stars.toLocaleString()}
            </span>
            <button class="btn btn-secondary" style="padding:8px 14px;" id="hangar-close-btn" type="button">✕</button>
          </div>
        </div>
        <div class="modal-body">
          <div class="tabs-row">
            <button class="tab-btn ${this.hangarTab === 'upgrades' ? 'active' : ''}" data-htab="upgrades" type="button">Upgrades</button>
            <button class="tab-btn ${this.hangarTab === 'wings' ? 'active' : ''}" data-htab="wings" type="button">Wings</button>
            <button class="tab-btn ${this.hangarTab === 'trails' ? 'active' : ''}" data-htab="trails" type="button">Trails</button>
            <button class="tab-btn ${this.hangarTab === 'aviator' ? 'active' : ''}" data-htab="aviator" type="button">Aviator</button>
          </div>
          <div class="shop-grid">${gridHtml}</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="hangar-back-btn" type="button">Back to Title</button>
          <button class="btn btn-primary" style="padding:11px 22px;font-size:0.95rem;" id="hangar-fly-btn" type="button">🚀 FLY NOW</button>
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
        const res = storage.purchaseOrEquipWing(btn.dataset.wing as 'classic_wood' | 'sky_dragon' | 'starlight_prism' | 'royal_cruiser');
        if (res.ok) {
          this.sound.playUnlock();
          this.engine.syncCosmeticsFromProfile();
        }
        this.renderOverlays();
      });
    });

    backdrop.querySelectorAll<HTMLButtonElement>('[data-trail]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const res = storage.purchaseOrEquipTrail(btn.dataset.trail as 'golden_dust' | 'rainbow_ribbon' | 'bubble_pop' | 'comet_flame');
        if (res.ok) this.sound.playUnlock();
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
      this.engine.startRun(this.selectedMode);
    });
  }

  private renderLeaderboardModal(): void {
    const profiles = storage.getProfiles();
    const active = storage.getActiveProfile();
    const entries = storage.getLeaderboard();

    const bodyHtml =
      this.boardTab === 'leaderboard'
        ? entries.length === 0
          ? `<div class="pwa-tip" style="text-align:center;">No flights recorded yet! Tap <strong>FLY NOW</strong> to set the first high score.</div>`
          : `<div class="leaderboard-list">
              ${entries
                .slice(0, 12)
                .map(
                  (e, i) => `
                  <div class="lb-row">
                    <div style="display:flex;align-items:center;gap:10px;">
                      <strong style="width:24px;color:#0284c7;">#${i + 1}</strong>
                      <span style="font-size:1.25rem;">${escapeHtml(e.avatar)}</span>
                      <div>
                        <div style="font-weight:900;font-size:0.92rem;">${escapeHtml(e.pilotName)}</div>
                        <div style="font-size:0.75rem;color:#47647f;">${e.distance}m · x${e.maxCombo} combo · ${e.mode === 'chill' ? 'Chill' : 'Arcade'}</div>
                      </div>
                    </div>
                    <strong style="font-size:1.02rem;color:#0f2942;">${e.score.toLocaleString()}</strong>
                  </div>
                `
                )
                .join('')}
            </div>`
        : `
          <div class="profile-list">
            ${profiles
              .map(
                (p) => `
              <div class="profile-row ${p.id === active.id ? 'active' : ''}">
                <div style="display:flex;align-items:center;gap:10px;">
                  <span style="font-size:1.4rem;">${escapeHtml(p.avatar)}</span>
                  <div>
                    <div style="font-weight:900;">${escapeHtml(p.name)} ${p.id === active.id ? '<span style="color:#0284c7;font-size:0.78rem;">(Active)</span>' : ''}</div>
                    <div style="font-size:0.76rem;color:#47647f;">⭐ ${p.stars.toLocaleString()} · Best ${p.bestScore.toLocaleString()} · ${p.totalFlights} flights</div>
                  </div>
                </div>
                <div style="display:flex;gap:6px;">
                  ${
                    p.id !== active.id
                      ? `<button class="btn btn-sky" style="padding:7px 12px;font-size:0.8rem;" data-select-profile="${p.id}">Select</button>`
                      : ''
                  }
                  ${
                    profiles.length > 1
                      ? `<button class="btn btn-danger" style="padding:7px 10px;font-size:0.78rem;" data-del-profile="${p.id}">✕</button>`
                      : ''
                  }
                </div>
              </div>
            `
              )
              .join('')}
          </div>
          <div style="background:#ffffff;border:1.5px solid rgba(14,165,233,0.2);border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:8px;">
            <strong style="font-size:0.88rem;">Add New Pilot (Great for sharing on iPad!)</strong>
            <div class="avatar-picker">
              ${PILOT_AVATARS.map(
                (av) => `<button type="button" class="avatar-opt ${this.newPilotAvatar === av ? 'selected' : ''}" data-pick-avatar="${av}">${av}</button>`
              ).join('')}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <input id="new-pilot-name" class="text-input" type="text" maxlength="16" placeholder="Pilot name (e.g., Maya)" />
              <button id="create-pilot-btn" class="btn btn-primary" style="padding:9px 18px;font-size:0.88rem;" type="button">Create</button>
            </div>
          </div>
        `;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="glass-panel modal-card">
        <div class="modal-header">
          <h2 class="modal-title">🏆 Pilots & High Scores</h2>
          <button class="btn btn-secondary" style="padding:8px 14px;" id="modal-close-btn" type="button">✕</button>
        </div>
        <div class="modal-body">
          <div class="tabs-row">
            <button class="tab-btn ${this.boardTab === 'leaderboard' ? 'active' : ''}" data-btab="leaderboard" type="button">🏆 High Scores</button>
            <button class="tab-btn ${this.boardTab === 'profiles' ? 'active' : ''}" data-btab="profiles" type="button">👨‍✈️ Pilot Profiles (${profiles.length})</button>
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
      const name = input?.value.trim() || 'Sky Ace';
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
          <h2 class="modal-title">⚙️ Settings</h2>
          <button class="btn btn-secondary" style="padding:8px 14px;" id="settings-close-btn" type="button">✕</button>
        </div>
        <div class="modal-body">
          <div class="setting-row">
            <strong>🎵 Music Volume</strong>
            <input id="set-music" type="range" min="0" max="100" value="${Math.round(settings.musicVolume * 100)}" />
          </div>
          <div class="setting-row">
            <strong>🔊 Sound Effects</strong>
            <input id="set-sfx" type="range" min="0" max="100" value="${Math.round(settings.sfxVolume * 100)}" />
          </div>
          <div class="setting-row">
            <strong>↕️ Invert Up/Down</strong>
            <button id="set-invert" class="pill-opt ${settings.invertY ? 'active' : ''}" type="button">
              ${settings.invertY ? 'ON (Flight Sim)' : 'OFF (Arcade)'}
            </button>
          </div>
          <div class="setting-row">
            <strong>✨ Graphics</strong>
            <div class="pill-select">
              ${(['high', 'balanced', 'saver'] as GraphicsQuality[])
                .map(
                  (q) =>
                    `<button class="pill-opt ${settings.quality === q ? 'active' : ''}" data-quality="${q}" type="button">${
                      q === 'high' ? 'High' : q === 'balanced' ? 'Balanced' : 'Saver'
                    }</button>`
                )
                .join('')}
            </div>
          </div>
          <div class="pwa-tip">
            📱 <strong>iPhone & iPad Fullscreen Tip:</strong> Open in Safari, tap <strong>Share → Add to Home Screen</strong> to launch Sky Glide fullscreen offline without browser bars!
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
      const cur = storage.getSettings().invertY;
      storage.saveSettings({ invertY: !cur });
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
          <h2 class="modal-title">⏸️ Flight Paused</h2>
        </div>
        <div class="modal-body" style="gap:10px;">
          <button class="btn btn-primary" id="pause-resume-btn" type="button">▶ Resume Flight</button>
          <button class="btn btn-sky" id="pause-restart-btn" type="button">↻ Restart Flight</button>
          <button class="btn btn-secondary" id="pause-finish-btn" type="button">⭐ Save Stars & End Flight</button>
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
      this.engine.startRun(this.selectedMode);
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

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="glass-panel modal-card compact">
        <div class="modal-header">
          <h2 class="modal-title">${s.mode === 'chill' ? '☁️ Flight Complete!' : '✨ Great Flight!'}</h2>
          <span style="font-weight:900;color:#b45309;">⭐ ${profile.stars.toLocaleString()}</span>
        </div>
        <div class="modal-body">
          ${s.isNewBest ? `<div class="new-best-banner">🏆 NEW HIGH SCORE!</div>` : ''}
          <div class="stats-grid">
            <div class="stat-tile">
              <div class="stat-tile-label">Score</div>
              <div class="stat-tile-value">${s.score.toLocaleString()}</div>
            </div>
            <div class="stat-tile">
              <div class="stat-tile-label">Best Score</div>
              <div class="stat-tile-value">${profile.bestScore.toLocaleString()}</div>
            </div>
            <div class="stat-tile">
              <div class="stat-tile-label">Stars Earned</div>
              <div class="stat-tile-value">+⭐ ${s.starsCollected.toLocaleString()}</div>
            </div>
            <div class="stat-tile">
              <div class="stat-tile-label">Distance / Combo</div>
              <div class="stat-tile-value">${s.distance}m · x${s.maxCombo}</div>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:center;">
          <button class="btn btn-primary" id="go-retry-btn" type="button">🚀 Fly Again</button>
          <button class="btn btn-sky" id="go-hangar-btn" type="button">🛠️ Hangar</button>
          <button class="btn btn-secondary" id="go-title-btn" type="button">🏠 Menu</button>
        </div>
      </div>
    `;

    this.overlaysLayer.appendChild(backdrop);

    document.getElementById('go-retry-btn')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.engine.startRun(this.selectedMode);
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
