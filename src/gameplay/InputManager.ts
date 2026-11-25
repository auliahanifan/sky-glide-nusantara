import type { SoundEngine } from '../audio/SoundEngine';

export interface FlightInputState {
  steerX: number; // -1 (left) to +1 (right)
  steerY: number; // -1 (down) to +1 (up)
  boostHeld: boolean;
  spinRequested: boolean;
  hasTouchUsed: boolean;
}

export class InputManager {
  private readonly touchRoot: HTMLElement;
  private readonly sound: SoundEngine;

  private joystickBase: HTMLDivElement | null = null;
  private joystickKnob: HTMLDivElement | null = null;
  private boostBtn: HTMLButtonElement | null = null;
  private spinBtn: HTMLButtonElement | null = null;

  private joyPointerId: number | null = null;
  private joyOriginX = 0;
  private joyOriginY = 0;
  private joyVecX = 0;
  private joyVecY = 0;
  private readonly joyRadius = 46;

  private boostPointerId: number | null = null;
  private spinPointerId: number | null = null;

  private readonly keys = new Set<string>();
  private spinQueued = false;
  private invertY = false;
  private enabled = false;
  private touchUsed = false;

  onPauseToggle: (() => void) | null = null;

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

  resetAllInputs(): void {
    this.keys.clear();
    this.joyPointerId = null;
    this.joyVecX = 0;
    this.joyVecY = 0;
    this.boostPointerId = null;
    this.spinPointerId = null;
    this.spinQueued = false;

    if (this.joystickBase) this.joystickBase.classList.add('hidden');
    if (this.joystickKnob) this.joystickKnob.style.transform = 'translate(0px, 0px)';
    this.boostBtn?.classList.remove('active');
    this.spinBtn?.classList.remove('active');
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

    const boostHeld =
      this.boostPointerId !== null ||
      this.keys.has('Space');

    const spinRequested = this.spinQueued;
    this.spinQueued = false;

    return {
      steerX: rawX,
      steerY: rawY,
      boostHeld,
      spinRequested,
      hasTouchUsed: this.touchUsed
    };
  }

  private buildTouchDom(): void {
    this.touchRoot.innerHTML = '';

    const zone = document.createElement('div');
    zone.className = 'joystick-zone';

    const hint = document.createElement('div');
    hint.className = 'joystick-hint';
    hint.textContent = 'Drag left side to steer';

    const base = document.createElement('div');
    base.className = 'joystick-base hidden';
    const knob = document.createElement('div');
    knob.className = 'joystick-knob';
    base.appendChild(knob);

    zone.append(hint, base);

    const actionPad = document.createElement('div');
    actionPad.className = 'action-pad';

    const spinBtn = document.createElement('button');
    spinBtn.type = 'button';
    spinBtn.id = 'btn-spin';
    spinBtn.className = 'touch-btn touch-btn-spin';
    spinBtn.innerHTML = '<span class="touch-btn-icon">🌀</span><span>SPIN</span>';

    const boostBtn = document.createElement('button');
    boostBtn.type = 'button';
    boostBtn.id = 'btn-boost';
    boostBtn.className = 'touch-btn touch-btn-boost';
    boostBtn.innerHTML = '<span class="touch-btn-icon">🔥</span><span>BOOST</span>';

    actionPad.append(spinBtn, boostBtn);
    this.touchRoot.append(zone, actionPad);

    this.joystickBase = base;
    this.joystickKnob = knob;
    this.boostBtn = boostBtn;
    this.spinBtn = spinBtn;

    // Left-half dynamic floating joystick
    zone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.joyPointerId !== null) return;
      this.sound.unlock();
      this.touchUsed = true;
      hint.style.opacity = '0';

      this.joyPointerId = e.pointerId;
      zone.setPointerCapture(e.pointerId);

      const rect = zone.getBoundingClientRect();
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
      const rect = zone.getBoundingClientRect();
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
        // Screen up (negative dy) = climb (+1 steerY)
        this.joyVecY = -Math.sin(angle) * norm;
      }
    });

    const releaseJoy = (e: PointerEvent) => {
      if (e.pointerId !== this.joyPointerId) return;
      this.joyPointerId = null;
      this.joyVecX = 0;
      this.joyVecY = 0;
      base.classList.add('hidden');
      knob.style.transform = 'translate(0px, 0px)';
    };
    zone.addEventListener('pointerup', releaseJoy);
    zone.addEventListener('pointercancel', releaseJoy);

    // Boost button (press & hold)
    boostBtn.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.sound.unlock();
      this.touchUsed = true;
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

    // Spin (Barrel Roll) button
    spinBtn.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.sound.unlock();
      this.touchUsed = true;
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
  }

  private bindKeyboard(): void {
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
