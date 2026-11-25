export type GameState = 'title' | 'playing' | 'paused' | 'gameover' | 'hangar';

export type GameMode = 'arcade' | 'chill';

export type GraphicsQuality = 'high' | 'balanced' | 'saver';

export type UpgradeId = 'magnet' | 'turbo' | 'shield' | 'combo';

export type WingId = 'classic_wood' | 'sky_dragon' | 'starlight_prism' | 'royal_cruiser';

export type TrailId = 'golden_dust' | 'rainbow_ribbon' | 'bubble_pop' | 'comet_flame';

export type AviatorId = 'classic_pilot' | 'mint_explorer' | 'sunny_bee' | 'cosmic_captain';

export interface UpgradeLevels {
  magnet: number;
  turbo: number;
  shield: number;
  combo: number;
}

export interface EquippedCosmetics {
  wing: WingId;
  trail: TrailId;
  aviator: AviatorId;
}

export interface PlayerProfile {
  id: string;
  name: string;
  avatar: string;
  stars: number;
  bestScore: number;
  bestDistance: number;
  maxCombo: number;
  totalFlights: number;
  upgrades: UpgradeLevels;
  unlockedWings: WingId[];
  unlockedTrails: TrailId[];
  unlockedAviators: AviatorId[];
  equipped: EquippedCosmetics;
  createdAt: number;
}

export interface LeaderboardEntry {
  id: string;
  profileId: string;
  pilotName: string;
  avatar: string;
  score: number;
  distance: number;
  maxCombo: number;
  starsCollected: number;
  mode: GameMode;
  playedAt: number;
}

export interface GameSettings {
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  invertY: boolean;
  quality: GraphicsQuality;
  preferredMode: GameMode;
}

export interface RunSummary {
  score: number;
  distance: number;
  starsCollected: number;
  ringsPassed: number;
  maxCombo: number;
  mode: GameMode;
  isNewBest: boolean;
}

export interface HudSnapshot {
  score: number;
  distance: number;
  starsRun: number;
  combo: number;
  comboTimerRatio: number;
  hearts: number;
  maxHearts: number;
  shieldActive: boolean;
  boostEnergy: number;
  isBoosting: boolean;
  speedRatio: number;
  mode: GameMode;
}
