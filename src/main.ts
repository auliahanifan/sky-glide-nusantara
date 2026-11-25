import './styles/main.css';
import { SoundEngine } from './audio/SoundEngine';
import { storage } from './data/storage';
import { InputManager } from './gameplay/InputManager';
import { SkyGlideEngine } from './gameplay/SkyGlideEngine';
import { UIManager } from './ui/UIManager';

function bootstrap(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const hudLayer = document.getElementById('hud-layer');
  const touchLayer = document.getElementById('touch-controls');
  const overlaysLayer = document.getElementById('ui-overlays');
  const rotateOverlay = document.getElementById('rotate-overlay');

  if (!canvas || !hudLayer || !touchLayer || !overlaysLayer || !rotateOverlay) {
    throw new Error('Required Sky Glide DOM containers are missing');
  }

  const sound = new SoundEngine();
  const settings = storage.getSettings();
  sound.setVolumes(settings.musicVolume, settings.sfxVolume, settings.muted);

  const input = new InputManager(touchLayer, sound);

  let ui: UIManager | null = null;
  const engine = new SkyGlideEngine(canvas, input, sound, {
    onHudUpdate: (snap) => ui?.updateHud(snap),
    onCallout: (text) => ui?.showCallout(text),
    onStateChange: (state) => ui?.onStateChange(state),
    onGameOver: (summary) => ui?.onGameOver(summary)
  });

  ui = new UIManager(hudLayer, overlaysLayer, rotateOverlay, engine, sound);

  input.onPauseToggle = () => {
    if (engine.getState() === 'playing') {
      engine.pauseRun();
    } else if (engine.getState() === 'paused') {
      engine.resumeRun();
    }
  };

  engine.startLoop();

  if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }
}

bootstrap();
