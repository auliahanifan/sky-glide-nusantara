import {
  AVIATOR_CATALOG,
  PILOT_AVATARS,
  TRAIL_CATALOG,
  UPGRADE_CATALOG,
  WING_CATALOG
} from './catalog';
import type {
  AviatorId,
  GameSettings,
  LeaderboardEntry,
  PlayerProfile,
  RunSummary,
  TrailId,
  UpgradeId,
  WingId
} from '../types/game';

const STORAGE_KEY = 'sky_glide_save_v1';

interface SaveStore {
  activeProfileId: string;
  profiles: PlayerProfile[];
  leaderboard: LeaderboardEntry[];
  settings: GameSettings;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function createDefaultProfile(name = 'Sky Pilot', avatar: string = PILOT_AVATARS[0]): PlayerProfile {
  return {
    id: createId('pilot'),
    name,
    avatar,
    stars: 0,
    bestScore: 0,
    bestDistance: 0,
    maxCombo: 0,
    totalFlights: 0,
    upgrades: {
      magnet: 0,
      turbo: 0,
      shield: 0,
      combo: 0
    },
    unlockedWings: ['classic_wood'],
    unlockedTrails: ['golden_dust'],
    unlockedAviators: ['classic_pilot'],
    equipped: {
      wing: 'classic_wood',
      trail: 'golden_dust',
      aviator: 'classic_pilot'
    },
    createdAt: Date.now()
  };
}

function createDefaultSettings(): GameSettings {
  const isMobileLikely = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 820;
  return {
    musicVolume: 0.55,
    sfxVolume: 0.8,
    muted: false,
    invertY: false,
    quality: isMobileLikely ? 'balanced' : 'high',
    preferredMode: 'arcade'
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

function loadStore(): SaveStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultStore();
    const parsed = JSON.parse(raw) as Partial<SaveStore>;
    if (!Array.isArray(parsed.profiles) || parsed.profiles.length === 0) {
      return createDefaultStore();
    }
    const defaults = createDefaultSettings();
    const profiles = parsed.profiles.map((p) => ({
      ...createDefaultProfile(p.name || 'Sky Pilot', p.avatar || PILOT_AVATARS[0]),
      ...p,
      upgrades: {
        magnet: p.upgrades?.magnet ?? 0,
        turbo: p.upgrades?.turbo ?? 0,
        shield: p.upgrades?.shield ?? 0,
        combo: p.upgrades?.combo ?? 0
      },
      unlockedWings: p.unlockedWings?.length ? p.unlockedWings : (['classic_wood'] as WingId[]),
      unlockedTrails: p.unlockedTrails?.length ? p.unlockedTrails : (['golden_dust'] as TrailId[]),
      unlockedAviators: p.unlockedAviators?.length ? p.unlockedAviators : (['classic_pilot'] as AviatorId[]),
      equipped: {
        wing: p.equipped?.wing ?? 'classic_wood',
        trail: p.equipped?.trail ?? 'golden_dust',
        aviator: p.equipped?.aviator ?? 'classic_pilot'
      }
    }));

    const activeExists = profiles.some((p) => p.id === parsed.activeProfileId);
    return {
      activeProfileId: activeExists ? (parsed.activeProfileId as string) : profiles[0].id,
      profiles,
      leaderboard: Array.isArray(parsed.leaderboard) ? parsed.leaderboard.slice(0, 20) : [],
      settings: {
        ...defaults,
        ...(parsed.settings ?? {})
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
    // Ignore storage quota errors cleanly on restricted browsers
  }
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
      equipped: { ...p.equipped }
    }));
  }

  getActiveProfile(): PlayerProfile {
    const found =
      this.store.profiles.find((p) => p.id === this.store.activeProfileId) ??
      this.store.profiles[0];
    return {
      ...found,
      upgrades: { ...found.upgrades },
      equipped: { ...found.equipped }
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
    const cleanName = name.trim().slice(0, 18) || 'Sky Pilot';
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

  saveRunResult(summary: Omit<RunSummary, 'isNewBest'>): RunSummary {
    const profile =
      this.store.profiles.find((p) => p.id === this.store.activeProfileId) ??
      this.store.profiles[0];

    const isNewBest = summary.score > profile.bestScore && summary.score > 0;
    profile.stars += summary.starsCollected;
    profile.totalFlights += 1;
    if (summary.score > profile.bestScore) profile.bestScore = summary.score;
    if (summary.distance > profile.bestDistance) profile.bestDistance = summary.distance;
    if (summary.maxCombo > profile.maxCombo) profile.maxCombo = summary.maxCombo;

    if (summary.score > 0) {
      const entry: LeaderboardEntry = {
        id: createId('run'),
        profileId: profile.id,
        pilotName: profile.name,
        avatar: profile.avatar,
        score: summary.score,
        distance: summary.distance,
        maxCombo: summary.maxCombo,
        starsCollected: summary.starsCollected,
        mode: summary.mode,
        playedAt: Date.now()
      };
      this.store.leaderboard.push(entry);
      this.store.leaderboard.sort((a, b) => b.score - a.score);
      this.store.leaderboard = this.store.leaderboard.slice(0, 20);
    }

    persistStore(this.store);
    return { ...summary, isNewBest };
  }

  getLeaderboard(): LeaderboardEntry[] {
    return [...this.store.leaderboard];
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
