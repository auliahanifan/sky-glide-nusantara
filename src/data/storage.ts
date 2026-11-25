import {
  ACHIEVEMENT_CATALOG,
  ALL_WING_IDS,
  AVIATOR_CATALOG,
  PILOT_AVATARS,
  TRAIL_CATALOG,
  UPGRADE_CATALOG,
  WING_CATALOG,
  getPilotRankInfo,
  getStageSpec,
  rollNewBounty
} from './catalog';
import type {
  ActiveBounty,
  AviatorId,
  GameMode,
  GameSettings,
  LeaderboardEntry,
  PlayerProfile,
  RunStatsInput,
  RunSummary,
  StageId,
  StageRank,
  StageRecord,
  TrailId,
  UpgradeId,
  WingId
} from '../types/game';
import { getTodayDateKey } from '../utils/prng';

const STORAGE_KEY = 'sky_glide_overdrive_v2';
const LEGACY_STORAGE_KEY = 'sky_glide_save_v1';

const RANK_ORDER: Record<StageRank, number> = {
  NONE: 0,
  C: 1,
  B: 2,
  A: 3,
  S: 4
};

interface SaveStore {
  activeProfileId: string;
  profiles: PlayerProfile[];
  leaderboard: LeaderboardEntry[];
  settings: GameSettings;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function createEmptyStageRecords(): Record<StageId, StageRecord> {
  return {
    1: { bestScore: 0, bestRank: 'NONE', clearedNormal: false, clearedOverclocked: false },
    2: { bestScore: 0, bestRank: 'NONE', clearedNormal: false, clearedOverclocked: false },
    3: { bestScore: 0, bestRank: 'NONE', clearedNormal: false, clearedOverclocked: false },
    4: { bestScore: 0, bestRank: 'NONE', clearedNormal: false, clearedOverclocked: false }
  };
}

function ensureBounties(existing?: ActiveBounty[]): ActiveBounty[] {
  const list = Array.isArray(existing) ? existing.filter((b) => !b.completed).slice(0, 3) : [];
  while (list.length < 3) {
    const exclude = list.map((b) => b.metric);
    list.push(rollNewBounty(exclude, 0));
  }
  return list;
}

const LEGACY_WING_MAP: Record<string, WingId> = {
  classic_wood: 'garuda_nusantara',
  sky_dragon: 'naga_barong',
  starlight_prism: 'unicorn_sembrani',
  royal_cruiser: 'phinisi_bugis'
};

function resolveWingId(rawWing?: string): WingId {
  if (rawWing && (ALL_WING_IDS as string[]).includes(rawWing)) {
    return rawWing as WingId;
  }
  if (rawWing && LEGACY_WING_MAP[rawWing]) {
    return LEGACY_WING_MAP[rawWing];
  }
  return 'garuda_nusantara';
}

function createDefaultProfile(name = 'Viper Ace', avatar: string = PILOT_AVATARS[0]): PlayerProfile {
  return {
    id: createId('pilot'),
    name,
    avatar,
    stars: 0,
    xp: 0,
    bestScore: 0,
    bestDistance: 0,
    maxCombo: 0,
    totalFlights: 0,
    totalBossKills: 0,
    totalBullseyes: 0,
    totalGrazes: 0,
    unlockedStage: 1,
    stageRecords: createEmptyStageRecords(),
    bounties: ensureBounties(),
    achievements: [],
    dailyRecord: null,
    upgrades: {
      magnet: 0,
      turbo: 0,
      shield: 0,
      combo: 0
    },
    unlockedWings: [...ALL_WING_IDS],
    unlockedTrails: ['golden_dust'],
    unlockedAviators: ['classic_pilot'],
    equipped: {
      wing: 'garuda_nusantara',
      trail: 'golden_dust',
      aviator: 'classic_pilot'
    },
    createdAt: Date.now()
  };
}

function createDefaultSettings(): GameSettings {
  const isMobileLikely =
    typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 820;
  return {
    musicVolume: 0.55,
    sfxVolume: 0.85,
    muted: false,
    invertY: false,
    quality: isMobileLikely ? 'balanced' : 'high',
    autoQuality: true,
    showFps: false,
    preferredMode: 'stage',
    preferredStage: 1,
    preferredDifficulty: 'normal'
  };
}

function createDefaultStore(): SaveStore {
  const starter = createDefaultProfile();
  return {
    activeProfileId: starter.id,
    profiles: [starter],
    leaderboard: [],
    settings: createDefaultSettings()
  };
}

function migrateProfile(raw: Partial<PlayerProfile>): PlayerProfile {
  const base = createDefaultProfile(raw.name || 'Viper Ace', raw.avatar || PILOT_AVATARS[0]);
  const records = createEmptyStageRecords();
  if (raw.stageRecords) {
    for (const sid of [1, 2, 3, 4] as StageId[]) {
      if (raw.stageRecords[sid]) {
        records[sid] = { ...records[sid], ...raw.stageRecords[sid] };
      }
    }
  }
  return {
    ...base,
    ...raw,
    xp: raw.xp ?? 0,
    unlockedStage: raw.unlockedStage ?? 1,
    stageRecords: records,
    bounties: ensureBounties(raw.bounties),
    achievements: Array.isArray(raw.achievements) ? raw.achievements : [],
    dailyRecord: raw.dailyRecord ?? null,
    totalBossKills: raw.totalBossKills ?? 0,
    totalBullseyes: raw.totalBullseyes ?? 0,
    totalGrazes: raw.totalGrazes ?? 0,
    upgrades: {
      magnet: raw.upgrades?.magnet ?? 0,
      turbo: raw.upgrades?.turbo ?? 0,
      shield: raw.upgrades?.shield ?? 0,
      combo: raw.upgrades?.combo ?? 0
    },
    unlockedWings: [...ALL_WING_IDS],
    unlockedTrails: raw.unlockedTrails?.length ? raw.unlockedTrails : (['golden_dust'] as TrailId[]),
    unlockedAviators: raw.unlockedAviators?.length
      ? raw.unlockedAviators
      : (['classic_pilot'] as AviatorId[]),
    equipped: {
      wing: resolveWingId(raw.equipped?.wing),
      trail: raw.equipped?.trail ?? 'golden_dust',
      aviator: raw.equipped?.aviator ?? 'classic_pilot'
    }
  };
}

function loadStore(): SaveStore {
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY);
    const rawV1 = !rawV2 ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    const raw = rawV2 ?? rawV1;
    if (!raw) return createDefaultStore();

    const parsed = JSON.parse(raw) as Partial<SaveStore>;
    if (!Array.isArray(parsed.profiles) || parsed.profiles.length === 0) {
      return createDefaultStore();
    }

    const defaults = createDefaultSettings();
    const profiles = parsed.profiles.map((p) => migrateProfile(p));
    const activeExists = profiles.some((p) => p.id === parsed.activeProfileId);

    // Map legacy 'arcade'/'chill' preferredMode cleanly
    const rawSettings = (parsed.settings ?? {}) as Partial<GameSettings> & { preferredMode?: string };
    const safeMode: GameMode =
      rawSettings.preferredMode === 'endless' ||
      rawSettings.preferredMode === 'daily' ||
      rawSettings.preferredMode === 'stage'
        ? rawSettings.preferredMode
        : rawSettings.preferredMode === 'chill'
          ? 'endless'
          : 'stage';

    const leaderboard = Array.isArray(parsed.leaderboard)
      ? parsed.leaderboard.slice(0, 30).map((e) => ({
          ...e,
          mode:
            (e.mode as string) === 'arcade'
              ? ('stage' as GameMode)
              : (e.mode as string) === 'chill'
                ? ('endless' as GameMode)
                : e.mode
        }))
      : [];

    return {
      activeProfileId: activeExists ? (parsed.activeProfileId as string) : profiles[0].id,
      profiles,
      leaderboard,
      settings: {
        ...defaults,
        ...rawSettings,
        autoQuality: rawSettings.autoQuality ?? true,
        showFps: rawSettings.showFps ?? false,
        preferredMode: safeMode
      }
    };
  } catch {
    return createDefaultStore();
  }
}

function persistStore(store: SaveStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota errors
  }
}

function computeStageGrade(input: RunStatsInput): StageRank {
  if (!input.bossDefeated) {
    return input.distance > 400 ? 'C' : 'C';
  }
  const spec = getStageSpec(input.stageId);
  const mult = input.difficulty === 'overclocked' ? 1.2 : 1.0;
  const ringAcc = input.ringsTotal > 0 ? input.ringsPassed / input.ringsTotal : 1;

  if (input.score >= spec.sRankScore * mult && (ringAcc >= 0.7 || input.hitsTaken <= 1)) {
    return 'S';
  }
  if (input.score >= spec.aRankScore * mult) {
    return 'A';
  }
  if (input.score >= spec.bRankScore * mult) {
    return 'B';
  }
  return 'C';
}

class StorageService {
  private store: SaveStore = loadStore();

  getSettings(): GameSettings {
    return { ...this.store.settings };
  }

  saveSettings(partial: Partial<GameSettings>): GameSettings {
    this.store.settings = { ...this.store.settings, ...partial };
    persistStore(this.store);
    return this.getSettings();
  }

  getProfiles(): PlayerProfile[] {
    return this.store.profiles.map((p) => ({
      ...p,
      upgrades: { ...p.upgrades },
      equipped: { ...p.equipped },
      bounties: p.bounties.map((b) => ({ ...b })),
      stageRecords: { ...p.stageRecords }
    }));
  }

  getActiveProfile(): PlayerProfile {
    const found =
      this.store.profiles.find((p) => p.id === this.store.activeProfileId) ??
      this.store.profiles[0];
    return {
      ...found,
      upgrades: { ...found.upgrades },
      equipped: { ...found.equipped },
      bounties: found.bounties.map((b) => ({ ...b })),
      stageRecords: { ...found.stageRecords }
    };
  }

  setActiveProfile(id: string): PlayerProfile {
    if (this.store.profiles.some((p) => p.id === id)) {
      this.store.activeProfileId = id;
      persistStore(this.store);
    }
    return this.getActiveProfile();
  }

  createProfile(name: string, avatar: string): PlayerProfile {
    const cleanName = name.trim().slice(0, 18) || 'Viper Ace';
    const profile = createDefaultProfile(cleanName, avatar || PILOT_AVATARS[0]);
    this.store.profiles.push(profile);
    this.store.activeProfileId = profile.id;
    persistStore(this.store);
    return this.getActiveProfile();
  }

  deleteProfile(id: string): PlayerProfile {
    if (this.store.profiles.length <= 1) return this.getActiveProfile();
    this.store.profiles = this.store.profiles.filter((p) => p.id !== id);
    if (this.store.activeProfileId === id) {
      this.store.activeProfileId = this.store.profiles[0].id;
    }
    persistStore(this.store);
    return this.getActiveProfile();
  }

  getRivalTarget(mode: GameMode, stageId: StageId): { label: string; score: number } {
    const active = this.getActiveProfile();
    const relevant = this.store.leaderboard.filter((e) => {
      if (mode === 'daily') return e.mode === 'daily' && e.dateKey === getTodayDateKey();
      if (mode === 'stage') return e.mode === 'stage' && e.stageId === stageId;
      return e.mode === 'endless';
    });

    // Highest score by another pilot, or personal best if solo
    const higherOther = relevant
      .filter((e) => e.profileId !== active.id)
      .sort((a, b) => b.score - a.score)[0];

    const personalBest =
      mode === 'stage'
        ? active.stageRecords[stageId].bestScore
        : mode === 'daily'
          ? active.dailyRecord?.dateKey === getTodayDateKey()
            ? active.dailyRecord.bestScore
            : 0
          : active.bestScore;

    if (higherOther && higherOther.score > personalBest) {
      return { label: higherOther.pilotName.toUpperCase(), score: higherOther.score };
    }
    if (personalBest > 0) {
      return { label: 'YOUR BEST', score: personalBest };
    }
    if (mode === 'stage') {
      return { label: 'S-RANK', score: getStageSpec(stageId).sRankScore };
    }
    return { label: 'ACE BENCHMARK', score: 85000 };
  }

  saveRunResult(input: RunStatsInput): RunSummary {
    const profile =
      this.store.profiles.find((p) => p.id === this.store.activeProfileId) ??
      this.store.profiles[0];

    const isNewBest = input.score > profile.bestScore && input.score > 0;
    const grade: StageRank = input.mode === 'stage' ? computeStageGrade(input) : 'NONE';

    profile.stars += input.starsCollected;
    profile.totalFlights += 1;
    profile.totalBossKills += input.bossKillsThisRun;
    profile.totalBullseyes += input.bullseyes;
    profile.totalGrazes += input.grazes;

    if (input.score > profile.bestScore) profile.bestScore = input.score;
    if (input.distance > profile.bestDistance) profile.bestDistance = input.distance;
    if (input.maxCombo > profile.maxCombo) profile.maxCombo = input.maxCombo;

    let bonusStarsEarned = 0;
    let xpGained = Math.round(
      input.distance / 18 +
        input.score / 55 +
        input.bullseyes * 14 +
        input.grazes * 10 +
        input.deflects * 22 +
        (input.bossDefeated ? 220 : 0) +
        (grade === 'S' ? 160 : grade === 'A' ? 80 : 0)
    );
    if (input.difficulty === 'overclocked') {
      xpGained = Math.round(xpGained * 1.25);
    }

    // Stage progression & rank records
    let unlockedNextStage: StageId | null = null;
    let unlockedOverclocked = false;
    if (input.mode === 'stage') {
      const rec = profile.stageRecords[input.stageId];
      if (input.score > rec.bestScore) rec.bestScore = input.score;
      if (RANK_ORDER[grade] > RANK_ORDER[rec.bestRank]) rec.bestRank = grade;

      if (input.victory) {
        if (input.difficulty === 'normal') {
          if (!rec.clearedNormal) unlockedOverclocked = true;
          rec.clearedNormal = true;
        } else {
          rec.clearedOverclocked = true;
        }
        if (input.stageId < 4 && profile.unlockedStage <= input.stageId) {
          profile.unlockedStage = (input.stageId + 1) as StageId;
          unlockedNextStage = profile.unlockedStage;
        }
      }
    }

    // Daily record
    const todayKey = getTodayDateKey();
    if (input.mode === 'daily') {
      const prev =
        profile.dailyRecord && profile.dailyRecord.dateKey === todayKey
          ? profile.dailyRecord
          : { dateKey: todayKey, bestScore: 0, cleared: false };
      profile.dailyRecord = {
        dateKey: todayKey,
        bestScore: Math.max(prev.bestScore, input.score),
        cleared: prev.cleared || input.victory
      };
    }

    // Advance 3 Active Bounties
    const bountiesCompleted: ActiveBounty[] = [];
    const rankLevelBefore = getPilotRankInfo(profile.xp).current.level;
    const nextTierHint = rankLevelBefore >= 4 ? 1 : 0;

    for (let i = 0; i < profile.bounties.length; i++) {
      const b = profile.bounties[i];
      if (b.metric === 'max_combo') {
        b.progress = Math.max(b.progress, input.maxCombo);
      } else {
        const delta =
          b.metric === 'bullseyes'
            ? input.bullseyes
            : b.metric === 'grazes'
              ? input.grazes
              : b.metric === 'deflects'
                ? input.deflects
                : b.metric === 'fever_triggers'
                  ? input.feverCount
                  : b.metric === 'boss_kills'
                    ? input.bossKillsThisRun
                    : b.metric === 'stars'
                      ? input.starsCollected
                      : b.metric === 'distance'
                        ? input.distance
                        : input.skillUses;
        b.progress += delta;
      }

      if (b.progress >= b.target) {
        b.completed = true;
        b.progress = b.target;
        bountiesCompleted.push({ ...b });
        profile.stars += b.rewardStars;
        bonusStarsEarned += b.rewardStars;
        xpGained += b.rewardXp;
      }
    }

    // Replace completed bounties cleanly without metric duplicates
    if (bountiesCompleted.length > 0) {
      const remaining = profile.bounties.filter((b) => !b.completed);
      while (remaining.length < 3) {
        const exclude = remaining.map((b) => b.metric);
        remaining.push(rollNewBounty(exclude, nextTierHint));
      }
      profile.bounties = remaining;
    }

    // Evaluate Achievements
    const newAchievements: string[] = [];
    const checkAch = (id: string, condition: boolean) => {
      if (condition && !profile.achievements.includes(id)) {
        const spec = ACHIEVEMENT_CATALOG.find((a) => a.id === id);
        profile.achievements.push(id);
        newAchievements.push(id);
        if (spec) {
          profile.stars += spec.rewardStars;
          bonusStarsEarned += spec.rewardStars;
        }
      }
    };

    checkAch('first_boss', profile.totalBossKills >= 1);
    checkAch(
      'campaign_clear',
      ([1, 2, 3, 4] as StageId[]).every(
        (s) => profile.stageRecords[s].clearedNormal || profile.stageRecords[s].clearedOverclocked
      )
    );
    checkAch('s_rank_ace', grade === 'S');
    checkAch('overclocked_clear', input.victory && input.difficulty === 'overclocked');
    checkAch('untouchable_boss', input.bossDefeated && input.bossNoHit);
    checkAch('bullseye_25', profile.totalBullseyes >= 25);
    checkAch('graze_30', profile.totalGrazes >= 30);
    checkAch('combo_x10', input.maxCombo >= 10);

    // Apply XP & Rank-Up bonus
    profile.xp += xpGained;
    const rankAfter = getPilotRankInfo(profile.xp);
    const rankUpCount = Math.max(0, rankAfter.current.level - rankLevelBefore);
    if (rankUpCount > 0) {
      const rankReward = rankUpCount * 75;
      profile.stars += rankReward;
      bonusStarsEarned += rankReward;
    }

    // Save Leaderboard
    if (input.score > 0) {
      const entry: LeaderboardEntry = {
        id: createId('run'),
        profileId: profile.id,
        pilotName: profile.name,
        avatar: profile.avatar,
        score: input.score,
        distance: input.distance,
        maxCombo: input.maxCombo,
        starsCollected: input.starsCollected,
        mode: input.mode,
        stageId: input.mode === 'stage' ? input.stageId : undefined,
        difficulty: input.difficulty,
        rank: grade !== 'NONE' ? grade : undefined,
        dateKey: input.mode === 'daily' ? todayKey : undefined,
        playedAt: Date.now()
      };
      this.store.leaderboard.push(entry);
      this.store.leaderboard.sort((a, b) => b.score - a.score);
      this.store.leaderboard = this.store.leaderboard.slice(0, 30);
    }

    // Smart "One More Run" Nudge
    let nudgeText = '';
    if (unlockedNextStage) {
      const nextSpec = getStageSpec(unlockedNextStage);
      nudgeText = `SECTOR ${unlockedNextStage} UNLOCKED: ${nextSpec.name}!`;
    } else if (input.mode === 'stage' && !input.bossDefeated) {
      const spec = getStageSpec(input.stageId);
      const rem = Math.max(0, spec.lengthMeters - input.distance);
      nudgeText =
        rem > 0
          ? `${rem}m short of ${spec.bossName}! Upgrade Thrusters or Hull Plating.`
          : `So close to breaking ${spec.bossName}! Barrel Roll orbs back at it!`;
    } else if (input.mode === 'stage' && grade !== 'S') {
      const spec = getStageSpec(input.stageId);
      const gap = Math.max(0, Math.round(spec.sRankScore - input.score));
      nudgeText =
        gap > 0
          ? `Only ${gap.toLocaleString()} pts away from S-RANK!`
          : `Hit 70%+ rings or take ≤1 hit for S-RANK!`;
    } else {
      const closest = [...profile.bounties].sort(
        (a, b) => b.progress / b.target - a.progress / a.target
      )[0];
      if (closest) {
        nudgeText = `Bounty Alert: ${closest.title} (${closest.progress}/${closest.target}) → +⭐${closest.rewardStars}`;
      }
    }

    persistStore(this.store);

    return {
      ...input,
      isNewBest,
      grade,
      xpGained,
      rankUpCount,
      newRankName: rankAfter.current.title,
      bountiesCompleted,
      newAchievements,
      unlockedNextStage,
      unlockedOverclocked,
      bonusStarsEarned,
      nudgeText
    };
  }

  getLeaderboard(): LeaderboardEntry[] {
    return [...this.store.leaderboard];
  }

  hasAffordableHangarAction(profile = this.getActiveProfile()): boolean {
    const canUpgrade = UPGRADE_CATALOG.some((u) => {
      const lv = profile.upgrades[u.id];
      return lv < u.maxLevel && profile.stars >= u.costs[lv];
    });
    return canUpgrade;
  }

  purchaseUpgrade(upgradeId: UpgradeId): { ok: boolean; profile: PlayerProfile } {
    const profile =
      this.store.profiles.find((p) => p.id === this.store.activeProfileId) ??
      this.store.profiles[0];
    const spec = UPGRADE_CATALOG.find((u) => u.id === upgradeId);
    if (!spec) return { ok: false, profile: this.getActiveProfile() };

    const currentLevel = profile.upgrades[upgradeId];
    if (currentLevel >= spec.maxLevel) return { ok: false, profile: this.getActiveProfile() };

    const cost = spec.costs[currentLevel];
    if (profile.stars < cost) return { ok: false, profile: this.getActiveProfile() };

    profile.stars -= cost;
    profile.upgrades[upgradeId] = currentLevel + 1;
    persistStore(this.store);
    return { ok: true, profile: this.getActiveProfile() };
  }

  purchaseOrEquipWing(id: WingId): { ok: boolean; profile: PlayerProfile } {
    const profile =
      this.store.profiles.find((p) => p.id === this.store.activeProfileId) ??
      this.store.profiles[0];
    const spec = WING_CATALOG.find((w) => w.id === id);
    if (!spec) return { ok: false, profile: this.getActiveProfile() };

    if (!profile.unlockedWings.includes(id)) {
      if (profile.stars < spec.cost) return { ok: false, profile: this.getActiveProfile() };
      profile.stars -= spec.cost;
      profile.unlockedWings.push(id);
    }
    profile.equipped.wing = id;
    persistStore(this.store);
    return { ok: true, profile: this.getActiveProfile() };
  }

  purchaseOrEquipTrail(id: TrailId): { ok: boolean; profile: PlayerProfile } {
    const profile =
      this.store.profiles.find((p) => p.id === this.store.activeProfileId) ??
      this.store.profiles[0];
    const spec = TRAIL_CATALOG.find((t) => t.id === id);
    if (!spec) return { ok: false, profile: this.getActiveProfile() };

    if (!profile.unlockedTrails.includes(id)) {
      if (profile.stars < spec.cost) return { ok: false, profile: this.getActiveProfile() };
      profile.stars -= spec.cost;
      profile.unlockedTrails.push(id);
    }
    profile.equipped.trail = id;
    persistStore(this.store);
    return { ok: true, profile: this.getActiveProfile() };
  }

  purchaseOrEquipAviator(id: AviatorId): { ok: boolean; profile: PlayerProfile } {
    const profile =
      this.store.profiles.find((p) => p.id === this.store.activeProfileId) ??
      this.store.profiles[0];
    const spec = AVIATOR_CATALOG.find((a) => a.id === id);
    if (!spec) return { ok: false, profile: this.getActiveProfile() };

    if (!profile.unlockedAviators.includes(id)) {
      if (profile.stars < spec.cost) return { ok: false, profile: this.getActiveProfile() };
      profile.stars -= spec.cost;
      profile.unlockedAviators.push(id);
    }
    profile.equipped.aviator = id;
    persistStore(this.store);
    return { ok: true, profile: this.getActiveProfile() };
  }
}

export const storage = new StorageService();
