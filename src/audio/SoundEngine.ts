import type { StageId } from '../types/game';

/**
 * Procedural Web Audio API Driving Synthwave & Cyber-Arcade Sound Engine.
 * Zero external audio files, 132 BPM reactive 16th-note pulse, clean iOS Safari touch unlock.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private musicTimer: number | null = null;
  private stepIndex = 0;

  private musicVolume = 0.55;
  private sfxVolume = 0.85;
  private muted = false;
  private isPlaying = false;
  private isBoosting = false;
  private isFever = false;
  private isBoss = false;
  private biomeId: StageId = 1;
  private lastWindUpdateSec = -1;
  private lastWindGain = -1;
  private lastWindCutoff = -1;

  // Driving minor-synthwave arp & bass progressions
  private readonly arpPattern = [
    220.0, 261.63, 329.63, 440.0,
    329.63, 261.63, 392.0, 329.63,
    174.61, 220.0, 261.63, 349.23,
    196.0, 246.94, 293.66, 392.0
  ];
  private readonly bassRoots = [55.0, 55.0, 43.65, 49.0]; // A1, A1, F1, G1
  private readonly bossBassRoots = [55.0, 58.27, 51.91, 49.0]; // Urgent Phrygian tension
  private readonly ringScale = [
    523.25, 587.33, 659.25, 783.99, 880.0,
    1046.5, 1174.66, 1318.51, 1567.98, 1760.0
  ];

  unlock(): void {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();

      this.musicGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
      this.initWindBed();
      this.syncGains();
      this.startMusicLoop();
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined);
    }
  }

  setVolumes(musicVolume: number, sfxVolume: number, muted: boolean): void {
    this.musicVolume = Math.max(0, Math.min(1, musicVolume));
    this.sfxVolume = Math.max(0, Math.min(1, sfxVolume));
    this.muted = muted;
    this.syncGains();
  }

  setFlightState(
    playing: boolean,
    speedRatio: number,
    boosting: boolean,
    feverActive = false,
    bossActive = false,
    biomeId: StageId = 1
  ): void {
    const stateChanged =
      this.isPlaying !== playing ||
      this.isBoosting !== boosting ||
      this.isFever !== feverActive;
    this.isPlaying = playing;
    this.isBoosting = boosting;
    this.isFever = feverActive;
    this.isBoss = bossActive;
    this.biomeId = biomeId;

    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const now = this.ctx.currentTime;
    if (!stateChanged && now - this.lastWindUpdateSec < 0.08) return;

    const targetWindGain =
      playing && !this.muted
        ? 0.03 + speedRatio * 0.055 + (boosting || feverActive ? 0.055 : 0)
        : 0.008;
    const targetCutoff = 340 + speedRatio * 760 + (boosting || feverActive ? 750 : 0);

    if (
      !stateChanged &&
      Math.abs(targetWindGain - this.lastWindGain) < 0.002 &&
      Math.abs(targetCutoff - this.lastWindCutoff) < 12
    ) {
      return;
    }

    this.lastWindUpdateSec = now;
    this.lastWindGain = targetWindGain;
    this.lastWindCutoff = targetCutoff;
    this.windGain.gain.setTargetAtTime(targetWindGain, now, 0.1);
    this.windFilter.frequency.setTargetAtTime(targetCutoff, now, 0.1);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend().catch(() => undefined);
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended' && !this.muted) {
      void this.ctx.resume().catch(() => undefined);
    }
  }

  playRing(combo: number, isBullseye = false): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const idx = Math.max(0, Math.min(this.ringScale.length - 1, combo - 1));
    const freq = this.ringScale[idx];

    this.triggerTone(freq, 'triangle', now, 0.22, 0.2, this.sfxGain);
    this.triggerTone(freq * 1.5, 'sine', now + 0.025, 0.2, 0.14, this.sfxGain);
    if (isBullseye) {
      this.triggerTone(freq * 2.0, 'sine', now + 0.05, 0.26, 0.18, this.sfxGain);
    }
  }

  playStar(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerTone(1318.51, 'sine', now, 0.09, 0.11, this.sfxGain);
    this.triggerTone(1760.0, 'sine', now + 0.04, 0.12, 0.09, this.sfxGain);
  }

  playBoostStart(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    this.triggerSweep(160, 520, 'sawtooth', 0.28, 0.15, 1100);
  }

  playBarrelRoll(): void {
    if (!this.ctx || !this.sfxGain || this.muted || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 3.6;
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(1900, now + 0.15);
    filter.frequency.exponentialRampToValueAtTime(520, now + 0.34);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.36);
  }

  playGraze(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerTone(1480, 'sawtooth', now, 0.08, 0.12, this.sfxGain);
    this.triggerTone(2217, 'sine', now + 0.03, 0.12, 0.14, this.sfxGain);
  }

  playDeflect(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    this.triggerSweep(240, 1180, 'sawtooth', 0.24, 0.22, 2400);
    const now = this.ctx.currentTime;
    this.triggerTone(880, 'square', now + 0.04, 0.22, 0.14, this.sfxGain);
  }

  playSkill(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    this.triggerSweep(220, 980, 'sawtooth', 0.36, 0.2, 2200);
    const now = this.ctx.currentTime;
    this.triggerTone(523.25, 'triangle', now + 0.04, 0.24, 0.18, this.sfxGain);
    this.triggerTone(1046.5, 'sine', now + 0.1, 0.3, 0.18, this.sfxGain);
  }

  playFeverStart(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    [440, 554.37, 659.25, 880, 1108.73].forEach((f, i) => {
      this.triggerTone(f, 'sawtooth', now + i * 0.055, 0.28, 0.16, this.sfxGain!);
    });
  }

  playBossWarning(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.28;
      this.triggerTone(220, 'sawtooth', t, 0.16, 0.22, this.sfxGain);
      this.triggerTone(311.13, 'sawtooth', t + 0.09, 0.15, 0.2, this.sfxGain);
    }
  }

  playBossHit(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    this.triggerSweep(320, 95, 'square', 0.22, 0.24, 1400);
  }

  playBossDefeat(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerSweep(420, 65, 'sawtooth', 0.55, 0.26, 1800);
    [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => {
      this.triggerTone(f, 'triangle', now + 0.12 + i * 0.075, 0.35, 0.2, this.sfxGain!);
    });
  }

  playBounce(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.22);

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  playPowerup(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerTone(587.33, 'triangle', now, 0.14, 0.18, this.sfxGain);
    this.triggerTone(783.99, 'triangle', now + 0.06, 0.14, 0.18, this.sfxGain);
    this.triggerTone(1174.66, 'sine', now + 0.12, 0.25, 0.22, this.sfxGain);
  }

  playUiClick(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    this.triggerTone(880, 'triangle', this.ctx.currentTime, 0.06, 0.1, this.sfxGain);
  }

  playUnlock(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      this.triggerTone(freq, 'triangle', now + i * 0.055, 0.22, 0.18, this.sfxGain!);
    });
  }

  playGameOver(victory: boolean): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = victory
      ? [523.25, 659.25, 783.99, 1046.5]
      : [392.0, 349.23, 293.66, 220.0];
    notes.forEach((freq, i) => {
      this.triggerTone(freq, 'sawtooth', now + i * 0.1, 0.26, 0.16, this.sfxGain!);
    });
  }

  playLaserFire(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    this.triggerSweep(1040, 290, 'sawtooth', 0.085, 0.095, 2800);
  }

  playSonicBoom(): void {
    if (!this.ctx || !this.sfxGain || this.muted || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    // Deep sub-bass pressure thump
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.42);
    oscGain.gain.setValueAtTime(0.36, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(oscGain);
    oscGain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.46);

    // Filtered pressure shockwave crack
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(220, now + 0.38);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.3, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.42);
  }

  playExplosion(heavy = false): void {
    if (!this.ctx || !this.sfxGain || this.muted || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const dur = heavy ? 0.5 : 0.28;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(heavy ? 1800 : 1400, now);
    filter.frequency.exponentialRampToValueAtTime(140, now + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(heavy ? 0.34 : 0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + dur + 0.02);

    this.triggerSweep(heavy ? 180 : 230, 48, 'triangle', dur * 0.85, heavy ? 0.26 : 0.16, 600);
  }

  playUpdraft(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    this.triggerSweep(260, 740, 'sine', 0.28, 0.14, 1800);
  }

  playSlingshot(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerSweep(280, 1280, 'triangle', 0.32, 0.18, 2600);
    this.triggerTone(987.77, 'sine', now + 0.08, 0.24, 0.15, this.sfxGain);
  }

  private syncGains(): void {
    if (!this.ctx || !this.masterGain || !this.musicGain || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 1, now, 0.04);
    this.musicGain.gain.setTargetAtTime(this.musicVolume * 0.36, now, 0.06);
    this.sfxGain.gain.setTargetAtTime(this.sfxVolume * 0.85, now, 0.04);
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.04 * white) / 1.04;
      data[i] = lastOut * 2.5;
    }
    return buffer;
  }

  private initWindBed(): void {
    if (!this.ctx || !this.noiseBuffer || !this.sfxGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 380;
    filter.Q.value = 0.85;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.01;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start();

    this.windFilter = filter;
    this.windGain = gain;
  }

  private startMusicLoop(): void {
    if (this.musicTimer !== null) return;
    // 132 BPM 16th-note grid (~113ms)
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.musicGain || this.muted || this.ctx.state !== 'running') return;
      if (typeof document !== 'undefined' && document.hidden) return;

      const now = this.ctx.currentTime;
      const step = this.stepIndex % 16;
      const bar = Math.floor(this.stepIndex / 16) % 4;
      const biomeMult = this.biomeId === 2 ? 1.122 : this.biomeId === 3 ? 1.189 : this.biomeId === 4 ? 1.26 : 1.0;

      // 1. Driving Synthwave Rolling Bass on every 16th/8th
      const bassPool = this.isBoss ? this.bossBassRoots : this.bassRoots;
      const bassFreq = bassPool[bar] * biomeMult;
      if (this.isPlaying || step % 2 === 0) {
        this.triggerFilteredTone(
          bassFreq,
          'sawtooth',
          now,
          0.11,
          this.isPlaying ? 0.22 : 0.12,
          this.isBoosting || this.isFever ? 950 : 520,
          this.musicGain
        );
      }

      // 2. Electronic Drums (Active during flight)
      if (this.isPlaying) {
        if (step % 4 === 0) {
          this.triggerKick(now, this.musicGain);
        }
        if (step === 4 || step === 12) {
          this.triggerSnare(now, this.musicGain);
        } else if (step % 2 === 1 && (this.isBoosting || this.isFever || this.isBoss)) {
          this.triggerHat(now, this.musicGain);
        }
      }

      // 3. Lead Synth Arp
      if (step % 2 === 0 || this.isFever || this.isBoss) {
        const arpFreq = this.arpPattern[step] * biomeMult * (this.isFever ? 2 : 1);
        const arpVol = this.isPlaying ? (this.isFever ? 0.13 : 0.095) : 0.065;
        this.triggerFilteredTone(
          arpFreq,
          this.isBoss ? 'square' : 'triangle',
          now,
          0.13,
          arpVol,
          this.isBoosting || this.isFever ? 2800 : 1600,
          this.musicGain
        );
      }

      this.stepIndex++;
    }, 113);
  }

  private triggerKick(startTime: number, dest: AudioNode): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, startTime);
    osc.frequency.exponentialRampToValueAtTime(42, startTime + 0.09);

    gain.gain.setValueAtTime(0.32, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.11);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.12);
  }

  private triggerSnare(startTime: number, dest: AudioNode): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1100;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.14, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(startTime);
    src.stop(startTime + 0.11);
  }

  private triggerHat(startTime: number, dest: AudioNode): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 5200;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.055, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.045);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(startTime);
    src.stop(startTime + 0.05);
  }

  private triggerSweep(
    f0: number,
    f1: number,
    type: OscillatorType,
    duration: number,
    peakGain: number,
    cutoff: number
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(f1, now + duration);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private triggerFilteredTone(
    freq: number,
    type: OscillatorType,
    startTime: number,
    duration: number,
    peakGain: number,
    cutoff: number,
    dest: AudioNode
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.015);
  }

  private triggerTone(
    freq: number,
    type: OscillatorType,
    startTime: number,
    duration: number,
    peakGain: number,
    dest: AudioNode
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }
}
