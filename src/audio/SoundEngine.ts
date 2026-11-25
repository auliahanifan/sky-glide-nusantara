/**
 * Procedural Web Audio API sound & dynamic music engine.
 * Works offline, zero audio asset downloads, and unlocks cleanly on iOS/iPad Safari touch.
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
  private sfxVolume = 0.8;
  private muted = false;
  private isPlaying = false;
  private isBoosting = false;
  private dayWarmth = 0; // 0 = morning bright, 1 = sunset warm

  // Cheerful C-major pentatonic frequencies across two octaves
  private readonly melodyNotes = [
    523.25, 659.25, 783.99, 659.25,
    880.0, 783.99, 659.25, 587.33,
    523.25, 587.33, 659.25, 783.99,
    1046.5, 880.0, 783.99, 659.25
  ];
  private readonly bassNotes = [
    130.81, 130.81, 196.0, 196.0,
    220.0, 220.0, 174.61, 196.0,
    130.81, 130.81, 164.81, 196.0,
    174.61, 174.61, 196.0, 130.81
  ];
  private readonly ringScale = [
    523.25, 587.33, 659.25, 783.99, 880.0,
    1046.5, 1174.66, 1318.51, 1567.98, 1760.0
  ];

  unlock(): void {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

  setFlightState(playing: boolean, speedRatio: number, boosting: boolean, dayWarmth: number): void {
    this.isPlaying = playing;
    this.isBoosting = boosting;
    this.dayWarmth = dayWarmth;

    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const now = this.ctx.currentTime;
    const targetWindGain = playing && !this.muted ? 0.035 + speedRatio * 0.055 + (boosting ? 0.05 : 0) : 0.008;
    const targetCutoff = 320 + speedRatio * 680 + (boosting ? 650 : 0);
    this.windGain.gain.setTargetAtTime(targetWindGain, now, 0.12);
    this.windFilter.frequency.setTargetAtTime(targetCutoff, now, 0.12);
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

  playRing(combo: number): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const idx = Math.max(0, Math.min(this.ringScale.length - 1, combo - 1));
    const freq = this.ringScale[idx];

    this.triggerTone(freq, 'sine', now, 0.24, 0.22, this.sfxGain);
    this.triggerTone(freq * 1.5, 'triangle', now + 0.03, 0.2, 0.12, this.sfxGain);
  }

  playStar(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerTone(1174.66, 'sine', now, 0.11, 0.13, this.sfxGain);
    this.triggerTone(1567.98, 'sine', now + 0.045, 0.13, 0.1, this.sfxGain);
  }

  playBoostStart(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.26);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.34);
  }

  playBarrelRoll(): void {
    if (!this.ctx || !this.sfxGain || this.muted || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 3.2;
    filter.frequency.setValueAtTime(380, now);
    filter.frequency.exponentialRampToValueAtTime(1600, now + 0.16);
    filter.frequency.exponentialRampToValueAtTime(460, now + 0.35);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.09);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.38);
  }

  playBounce(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(135, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.25);

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  playPowerup(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerTone(523.25, 'triangle', now, 0.14, 0.18, this.sfxGain);
    this.triggerTone(659.25, 'triangle', now + 0.07, 0.14, 0.18, this.sfxGain);
    this.triggerTone(1046.5, 'sine', now + 0.14, 0.26, 0.22, this.sfxGain);
  }

  playCloseCall(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerTone(987.77, 'sine', now, 0.12, 0.14, this.sfxGain);
    this.triggerTone(1318.51, 'sine', now + 0.06, 0.18, 0.14, this.sfxGain);
  }

  playUiClick(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerTone(740, 'sine', now, 0.07, 0.1, this.sfxGain);
  }

  playUnlock(): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      this.triggerTone(freq, 'triangle', now + i * 0.06, 0.22, 0.18, this.sfxGain!);
    });
  }

  playGameOver(isNewBest: boolean): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = isNewBest ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 440.0, 392.0];
    notes.forEach((freq, i) => {
      this.triggerTone(freq, 'triangle', now + i * 0.1, 0.26, 0.18, this.sfxGain!);
    });
  }

  private syncGains(): void {
    if (!this.ctx || !this.masterGain || !this.musicGain || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 1, now, 0.04);
    this.musicGain.gain.setTargetAtTime(this.musicVolume * 0.34, now, 0.06);
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
    filter.Q.value = 0.8;

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
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.musicGain || this.muted || this.ctx.state !== 'running') return;
      if (typeof document !== 'undefined' && document.hidden) return;

      const now = this.ctx.currentTime;
      const idx = this.stepIndex % this.melodyNotes.length;
      const melFreq = this.melodyNotes[idx];
      const bassFreq = this.bassNotes[idx];

      // Kalimba-like melody note (softer during sunset warmth)
      const melVol = this.isPlaying ? 0.16 : 0.1;
      this.triggerTone(melFreq, this.dayWarmth > 0.5 ? 'sine' : 'triangle', now, 0.24, melVol, this.musicGain);

      // Gentle bass pulse every 2 steps
      if (idx % 2 === 0) {
        this.triggerTone(bassFreq, 'sine', now, 0.42, 0.18, this.musicGain);
      }

      // Sparkling high octave arpeggio during Turbo Boost
      if (this.isPlaying && this.isBoosting && idx % 2 === 1) {
        this.triggerTone(melFreq * 2, 'sine', now + 0.05, 0.16, 0.09, this.musicGain);
      }

      this.stepIndex++;
    }, 240);
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
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }
}
