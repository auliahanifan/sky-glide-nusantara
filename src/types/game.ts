export type GameState = 'title' | 'playing' | 'paused' | 'gameover' | 'hangar';

export type GameMode = 'stage' | 'endless' | 'daily';

export type Difficulty = 'normal' | 'overclocked';

export type StageId = 1 | 2 | 3 | 4;

export type StageRank = 'S' | 'A' | 'B' | 'C' | 'NONE';

export type UpgradeId = 'magnet' | 'turbo' | 'shield' | 'combo';

export type WingId =
  | 'garuda_nusantara'
  | 'naga_barong'
  | 'unicorn_sembrani'
  | 'phinisi_bugis'
  | 'cenderawasih_papua'
  | 'enggang_dayak';

export type TrailId = 'golden_dust' | 'rainbow_ribbon' | 'bubble_pop' | 'comet_flame';

export type AviatorId = 'classic_pilot' | 'mint_explorer' | 'sunny_bee' | 'cosmic_captain';

export type ActiveSkillId =
  | 'pulse_nova'
  | 'phase_dash'
  | 'overdrive_surge'
  | 'aegis_matrix'
  | 'paradise_dance'
  | 'hornbill_gale';

export type BountyMetric =
  | 'bullseyes'
  | 'grazes'
  | 'deflects'
  | 'max_combo'
  | 'fever_triggers'
  | 'boss_kills'
  | 'stars'
  | 'distance'
  | 'skill_uses';

export type FxEventKind =
  | 'bullseye'
  | 'graze'
  | 'hit'
  | 'fever'
  | 'boss_warning'
  | 'deflect'
  | 'sonic_boom'
  | 'takedown';

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

export interface ActiveBounty {
  id: string;
  metric: BountyMetric;
  title: string;
  target: number;
  progress: number;
  rewardStars: number;
  rewardXp: number;
  completed: boolean;
}

export interface StageRecord {
  bestScore: number;
  bestRank: StageRank;
  clearedNormal: boolean;
  clearedOverclocked: boolean;
}

export interface DailyRecord {
  dateKey: string;
  bestScore: number;
  cleared: boolean;
}

export interface PlayerProfile {
  id: string;
  name: string;
  avatar: string;
  stars: number;
  xp: number;
  bestScore: number;
  bestDistance: number;
  maxCombo: number;
  totalFlights: number;
  totalBossKills: number;
  totalBullseyes: number;
  totalGrazes: number;
  unlockedStage: StageId;
  stageRecords: Record<StageId, StageRecord>;
  bounties: ActiveBounty[];
  achievements: string[];
  dailyRecord: DailyRecord | null;
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
  stageId?: StageId;
  difficulty?: Difficulty;
  rank?: StageRank;
  dateKey?: string;
  playedAt: number;
}

export interface GameSettings {
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  invertY: boolean;
  quality: 'high' | 'balanced' | 'saver';
  autoQuality: boolean;
  showFps: boolean;
  preferredMode: GameMode;
  preferredStage: StageId;
  preferredDifficulty: Difficulty;
}

export type GraphicsQuality = GameSettings['quality'];

export interface PerfSnapshot {
  fps: number;
  frameMs: number;
  p95Ms: number;
  effectiveQuality: GraphicsQuality;
  autoScaled: boolean;
  drawCalls: number;
}

export interface RunConfig {
  mode: GameMode;
  stageId: StageId;
  difficulty: Difficulty;
}

export interface RunStatsInput {
  score: number;
  distance: number;
  starsCollected: number;
  ringsPassed: number;
  ringsTotal: number;
  bullseyes: number;
  grazes: number;
  deflects: number;
  feverCount: number;
  skillUses: number;
  hitsTaken: number;
  maxCombo: number;
  mode: GameMode;
  stageId: StageId;
  difficulty: Difficulty;
  victory: boolean;
  bossDefeated: boolean;
  bossNoHit: boolean;
  bossKillsThisRun: number;
}

export interface RunSummary extends RunStatsInput {
  isNewBest: boolean;
  grade: StageRank;
  xpGained: number;
  rankUpCount: number;
  newRankName: string;
  bountiesCompleted: ActiveBounty[];
  newAchievements: string[];
  unlockedNextStage: StageId | null;
  unlockedOverclocked: boolean;
  bonusStarsEarned: number;
  nudgeText: string;
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
  stageId: StageId;
  biomeName: string;
  difficulty: Difficulty;
  stageProgress: number;
  feverGauge: number;
  feverActive: boolean;
  feverTimeRatio: number;
  skillName: string;
  skillIcon: string;
  skillReadyRatio: number;
  skillCooldownLeft: number;
  bossActive: boolean;
  bossName: string;
  bossHpRatio: number;
  bossPhase2: boolean;
  rivalLabel: string;
  rivalDelta: number;
  starFrenzyRatio: number;
  mach: number;
  gForce: number;
  altitude: number;
  sonicBoom: boolean;
  inSlipstream: boolean;
  inUpdraft: boolean;
  lockOnActive: boolean;
}
