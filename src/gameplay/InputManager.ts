import type { SoundEngine } from '../audio/SoundEngine';

export interface FlightInputState {
  steerX: number; // -1 (left) to +1 (right)
  steerY: number; // -1 (down) to +1 (up)
  boostHeld: boolean;
  fireHeld: boolean;
  spinRequested: boolean;
  skillRequested: boolean;
  hasTouchUsed: boolean;
}

export class InputManager {
  private readonly touchRoot: HTMLElement;
  private readonly sound: SoundEngine;

  private joystickBase: HTMLDivElement | null = null;
  private joystickKnob: HTMLDivElement | null = null;
  private boostBtn: HTMLButtonElement | null = null;
  private spinBtn: HTMLButtonElement | null = null;
  private skillBtn: HTMLButtonElement | null = null;
  private fireBtn: HTMLButtonElement | null = null;
  private skillIconEl: HTMLSpanElement | null = null;
  private skillLabelEl: HTMLSpanElement | null = null;

  private joyPointerId: number | null = null;
  private joyZoneRect: DOMRect | null = null;
  private joyOriginX = 0;
  private joyOriginY = 0;
  private joyVecX = 0;
  private joyVecY = 0;
  private readonly joyRadius = 46;

  private boostPointerId: number | null = null;
  private spinPointerId: number | null = null;
  private skillPointerId: number | null = null;
  private firePointerId: number | null = null;
  private mouseFireDown = false;

  private readonly keys = new Set<string>();
  private spinQueued = false;
  private skillQueued = false;
  private invertY = false;
  private enabled = false;
  private touchUsed = false;

  private lastSkillReady: boolean | null = null;
  private lastSkillLabel = '';
  private lastSkillIcon = '';

  private readonly sampledState: FlightInputState = {
    steerX: 0,
    steerY: 0,
    boostHeld: false,
    fireHeld: false,
    spinRequested: false,
    skillRequested: false,
    hasTouchUsed: false
  };

  onPauseToggle: (() => void) | null = null;

  private markTouchUsed(): void {
    if (!this.touchUsed) {
      this.touchUsed = true;
      this.touchRoot.classList.add('touch-active');
    }
  }

  constructor(touchRoot: HTMLElement, sound: SoundEngine) {
    this.touchRoot = touchRoot;
    this.sound = sound;
    this.buildTouchDom();
    this.bindKeyboard();
  }

  setInvertY(invert: boolean): void {
    this.invertY = invert;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.touchRoot.classList.toggle('hidden', !enabled);
    if (!enabled) {
      this.resetAllInputs();
    }
  }

  updateSkillButton(readyRatio: number, label: string, icon: string): void {
    if (!this.skillBtn || !this.skillIconEl || !this.skillLabelEl) return;
    const ready = readyRatio >= 0.999;
    const pct = ready ? 100 : Math.round(readyRatio * 100);
    if (this.lastSkillReady !== ready) {
      this.lastSkillReady = ready;
      this.skillBtn.classList.toggle('ready', ready);
      this.skillBtn.classList.toggle('cooling', !ready);
    }
    if (this.lastSkillIcon !== icon) {
      this.lastSkillIcon = icon;
      this.skillIconEl.textContent = icon;
    }
    const nextText = ready ? label : `${pct}%`;
    if (this.lastSkillLabel !== nextText) {
      this.lastSkillLabel = nextText;
      this.skillLabelEl.textContent = nextText;
    }
  }

  resetAllInputs(): void {
    this.keys.clear();
    this.joyPointerId = null;
    this.joyZoneRect = null;
    this.joyVecX = 0;
    this.joyVecY = 0;
    this.boostPointerId = null;
    this.spinPointerId = null;
    this.skillPointerId = null;
    this.firePointerId = null;
    this.mouseFireDown = false;
    this.spinQueued = false;
    this.skillQueued = false;

    if (this.joystickBase) this.joystickBase.classList.add('hidden');
    if (this.joystickKnob) this.joystickKnob.style.transform = 'translate(0px, 0px)';
    this.boostBtn?.classList.remove('active');
    this.spinBtn?.classList.remove('active');
    this.skillBtn?.classList.remove('active');
    this.fireBtn?.classList.remove('active');
  }

  sample(): FlightInputState {
    let keyX = 0;
    let keyY = 0;

    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) keyX -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) keyX += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) keyY += 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) keyY -= 1;

    const rawX = Math.max(-1, Math.min(1, keyX + this.joyVecX));
    let rawY = Math.max(-1, Math.min(1, keyY + this.joyVecY));
    if (this.invertY) rawY = -rawY;

    const boostHeld = this.boostPointerId !== null || this.keys.has('Space');
    const fireHeld =
      this.firePointerId !== null ||
      this.mouseFireDown ||
      this.keys.has('KeyX') ||
      this.keys.has('KeyC') ||
      this.keys.has('Enter');

    const spinRequested = this.spinQueued;
    this.spinQueued = false;

    const skillRequested = this.skillQueued;
    this.skillQueued = false;

    this.sampledState.steerX = rawX;
    this.sampledState.steerY = rawY;
    this.sampledState.boostHeld = boostHeld;
    this.sampledState.fireHeld = fireHeld;
    this.sampledState.spinRequested = spinRequested;
    this.sampledState.skillRequested = skillRequested;
    this.sampledState.hasTouchUsed = this.touchUsed;
    return this.sampledState;
  }

  private buildTouchDom(): void {
    this.touchRoot.innerHTML = '';

    const zone = document.createElement('div');
    zone.className = 'joystick-zone';

    const hint = document.createElement('div');
    hint.className = 'joystick-hint';
    hint.textContent = 'DRAG LEFT TO STEER';

    const base = document.createElement('div');
    base.className = 'joystick-base hidden';
    const knob = document.createElement('div');
    knob.className = 'joystick-knob';
    base.appendChild(knob);

    zone.append(hint, base);

    const actionPad = document.createElement('div');
    actionPad.className = 'action-pad';

    const skillBtn = document.createElement('button');
    skillBtn.type = 'button';
    skillBtn.id = 'btn-skill';
    skillBtn.className = 'touch-btn touch-btn-skill ready';
    const skillIcon = document.createElement('span');
    skillIcon.className = 'touch-btn-icon';
    skillIcon.textContent = '💥';
    const skillLabel = document.createElement('span');
    skillLabel.textContent = 'SKILL';
    skillBtn.append(skillIcon, skillLabel);

    const spinBtn = document.createElement('button');
    spinBtn.type = 'button';
    spinBtn.id = 'btn-spin';
    spinBtn.className = 'touch-btn touch-btn-spin';
    spinBtn.innerHTML = '<span class="touch-btn-icon">🌀</span><span>ROLL</span>';

    const fireBtn = document.createElement('button');
    fireBtn.type = 'button';
    fireBtn.id = 'btn-fire';
    fireBtn.className = 'touch-btn touch-btn-fire';
    fireBtn.innerHTML = '<span class="touch-btn-icon">🎯</span><span>FIRE</span>';

    const boostBtn = document.createElement('button');
    boostBtn.type = 'button';
    boostBtn.id = 'btn-boost';
    boostBtn.className = 'touch-btn touch-btn-boost';
    boostBtn.innerHTML = '<span class="touch-btn-icon">🔥</span><span>BOOST</span>';

    actionPad.append(skillBtn, spinBtn, fireBtn, boostBtn);
    this.touchRoot.append(zone, actionPad);

    this.joystickBase = base;
    this.joystickKnob = knob;
    this.boostBtn = boostBtn;
    this.spinBtn = spinBtn;
    this.skillBtn = skillBtn;
    this.fireBtn = fireBtn;
    this.skillIconEl = skillIcon;
    this.skillLabelEl = skillLabel;

    zone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.joyPointerId !== null) return;
      this.sound.unlock();
      this.markTouchUsed();
      hint.style.opacity = '0';

      this.joyPointerId = e.pointerId;
      zone.setPointerCapture(e.pointerId);

      const rect = zone.getBoundingClientRect();
      this.joyZoneRect = rect;
      this.joyOriginX = e.clientX - rect.left;
      this.joyOriginY = e.clientY - rect.top;

      base.style.left = `${this.joyOriginX}px`;
      base.style.top = `${this.joyOriginY}px`;
      base.classList.remove('hidden');
      knob.style.transform = 'translate(0px, 0px)';
      this.joyVecX = 0;
      this.joyVecY = 0;
    });

    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyPointerId) return;
      const rect = this.joyZoneRect ?? zone.getBoundingClientRect();
      this.joyZoneRect = rect;
      const dx = e.clientX - rect.left - this.joyOriginX;
      const dy = e.clientY - rect.top - this.joyOriginY;
      const dist = Math.hypot(dx, dy);
      const clampedDist = Math.min(dist, this.joyRadius);
      const angle = Math.atan2(dy, dx);
      const kx = Math.cos(angle) * clampedDist;
      const ky = Math.sin(angle) * clampedDist;

      knob.style.transform = `translate(${kx.toFixed(1)}px, ${ky.toFixed(1)}px)`;

      const norm = clampedDist / this.joyRadius;
      if (norm < 0.08) {
        this.joyVecX = 0;
        this.joyVecY = 0;
      } else {
        this.joyVecX = Math.cos(angle) * norm;
        this.joyVecY = -Math.sin(angle) * norm;
      }
    });

    const releaseJoy = (e: PointerEvent) => {
      if (e.pointerId !== this.joyPointerId) return;
      this.joyPointerId = null;
      this.joyZoneRect = null;
      this.joyVecX = 0;
      this.joyVecY = 0;
      base.classList.add('hidden');
      knob.style.transform = 'translate(0px, 0px)';
    };
    zone.addEventListener('pointerup', releaseJoy);
    zone.addEventListener('pointercancel', releaseJoy);
    window.addEventListener('resize', () => {
      this.joyZoneRect = null;
    });

    boostBtn.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.sound.unlock();
      this.markTouchUsed();
      this.boostPointerId = e.pointerId;
      boostBtn.setPointerCapture(e.pointerId);
      boostBtn.classList.add('active');
      navigator.vibrate?.(10);
    });
    const releaseBoost = (e: PointerEvent) => {
      if (e.pointerId !== this.boostPointerId) return;
      this.boostPointerId = null;
      boostBtn.classList.remove('active');
    };
    boostBtn.addEventListener('pointerup', releaseBoost);
    boostBtn.addEventListener('pointercancel', releaseBoost);

    spinBtn.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.sound.unlock();
      this.markTouchUsed();
      this.spinPointerId = e.pointerId;
      spinBtn.setPointerCapture(e.pointerId);
      spinBtn.classList.add('active');
      this.spinQueued = true;
      navigator.vibrate?.(12);
    });
    const releaseSpin = (e: PointerEvent) => {
      if (e.pointerId !== this.spinPointerId) return;
      this.spinPointerId = null;
      spinBtn.classList.remove('active');
    };
    spinBtn.addEventListener('pointerup', releaseSpin);
    spinBtn.addEventListener('pointercancel', releaseSpin);

    skillBtn.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.sound.unlock();
      this.markTouchUsed();
      this.skillPointerId = e.pointerId;
      skillBtn.setPointerCapture(e.pointerId);
      skillBtn.classList.add('active');
      this.skillQueued = true;
      navigator.vibrate?.(16);
    });
    const releaseSkill = (e: PointerEvent) => {
      if (e.pointerId !== this.skillPointerId) return;
      this.skillPointerId = null;
      skillBtn.classList.remove('active');
    };
    skillBtn.addEventListener('pointerup', releaseSkill);
    skillBtn.addEventListener('pointercancel', releaseSkill);

    fireBtn.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.sound.unlock();
      this.markTouchUsed();
      this.firePointerId = e.pointerId;
      fireBtn.setPointerCapture(e.pointerId);
      fireBtn.classList.add('active');
      navigator.vibrate?.(8);
    });
    const releaseFire = (e: PointerEvent) => {
      if (e.pointerId !== this.firePointerId) return;
      this.firePointerId = null;
      fireBtn.classList.remove('active');
    };
    fireBtn.addEventListener('pointerup', releaseFire);
    fireBtn.addEventListener('pointercancel', releaseFire);
  }

  private bindKeyboard(): void {
    window.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType !== 'mouse' || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, .joystick-zone, .hud-top, .hud-bottom, .modal-card')) return;
      this.sound.unlock();
      this.mouseFireDown = true;
    });

    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) {
        this.mouseFireDown = false;
      }
    });

    window.addEventListener('keydown', (e) => {
      this.sound.unlock();
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.enabled) {
          this.onPauseToggle?.();
        }
        return;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') {
        if (!e.repeat && this.enabled) {
          this.spinQueued = true;
        }
      }
      if (e.code === 'KeyQ' || e.code === 'KeyF') {
        if (!e.repeat && this.enabled) {
          this.skillQueued = true;
        }
      }
      this.keys.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.resetAllInputs();
    });
  }
}
