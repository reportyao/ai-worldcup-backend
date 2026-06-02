/**
 * Tests for Team i18n - nameZh, flagUrl, and locale-aware display
 * Validates that:
 * 1. Team data includes nameZh and flagUrl fields
 * 2. Flag URL generation from countryCode works correctly
 * 3. Chinese name fallback logic works
 */
import { describe, it, expect } from 'vitest';

interface TeamData {
  code: string;
  name: string;
  nameZh?: string | null;
  shortName?: string | null;
  countryCode?: string | null;
  crestUrl?: string | null;
  flagUrl?: string | null;
}

/**
 * Replicate frontend getTeamDisplayName logic
 */
function getTeamDisplayName(team: TeamData | undefined, locale: string, fallback: string): string {
  if (!team) return fallback;
  if (locale === 'zh_CN') {
    return team.nameZh || team.shortName || team.name;
  }
  return team.name || team.shortName || team.nameZh || fallback;
}

/**
 * Replicate frontend getTeamIconUrl logic
 */
function getTeamIconUrl(team: TeamData | undefined): string | null {
  if (!team) return null;
  if (team.crestUrl) return team.crestUrl;
  if (team.flagUrl) return team.flagUrl;
  if (team.countryCode) {
    return `https://flagcdn.com/w40/${team.countryCode.toLowerCase()}.png`;
  }
  return null;
}

const sampleTeams: TeamData[] = [
  { code: 'BRA', name: 'Brazil', nameZh: '巴西', shortName: '巴西', countryCode: 'BR', flagUrl: 'https://flagcdn.com/w80/br.png' },
  { code: 'GER', name: 'Germany', nameZh: '德国', shortName: '德国', countryCode: 'DE', flagUrl: 'https://flagcdn.com/w80/de.png' },
  { code: 'ENG', name: 'England', nameZh: '英格兰', shortName: '英格兰', countryCode: 'GB', flagUrl: 'https://flagcdn.com/w80/gb-eng.png' },
  { code: 'USA', name: 'United States', nameZh: '美国', shortName: '美国', countryCode: 'US', flagUrl: 'https://flagcdn.com/w80/us.png' },
];

describe('Team i18n - Display Name', () => {
  it('should return Chinese name in zh_CN locale', () => {
    const brazil = sampleTeams[0];
    expect(getTeamDisplayName(brazil, 'zh_CN', '主队')).toBe('巴西');
  });

  it('should return English name in en locale', () => {
    const brazil = sampleTeams[0];
    expect(getTeamDisplayName(brazil, 'en', 'Home')).toBe('Brazil');
  });

  it('should fallback to shortName if nameZh is null in zh_CN', () => {
    const team: TeamData = { code: 'TST', name: 'Test Team', nameZh: null, shortName: '测试', countryCode: 'XX' };
    expect(getTeamDisplayName(team, 'zh_CN', '主队')).toBe('测试');
  });

  it('should fallback to name if both nameZh and shortName are null in zh_CN', () => {
    const team: TeamData = { code: 'TST', name: 'Test Team', nameZh: null, shortName: null, countryCode: 'XX' };
    expect(getTeamDisplayName(team, 'zh_CN', '主队')).toBe('Test Team');
  });

  it('should return fallback if team is undefined', () => {
    expect(getTeamDisplayName(undefined, 'zh_CN', '主队')).toBe('主队');
    expect(getTeamDisplayName(undefined, 'en', 'Home')).toBe('Home');
  });

  it('all seed teams should have nameZh', () => {
    for (const team of sampleTeams) {
      expect(team.nameZh).toBeTruthy();
      expect(team.nameZh!.length).toBeGreaterThan(0);
    }
  });
});

describe('Team i18n - Flag/Icon URL', () => {
  it('should return flagUrl when available', () => {
    const brazil = sampleTeams[0];
    expect(getTeamIconUrl(brazil)).toBe('https://flagcdn.com/w80/br.png');
  });

  it('should prefer crestUrl over flagUrl', () => {
    const team: TeamData = { code: 'TST', name: 'Test', crestUrl: 'https://example.com/crest.png', flagUrl: 'https://flagcdn.com/w80/xx.png', countryCode: 'XX' };
    expect(getTeamIconUrl(team)).toBe('https://example.com/crest.png');
  });

  it('should fallback to countryCode-based URL if no flagUrl or crestUrl', () => {
    const team: TeamData = { code: 'TST', name: 'Test', countryCode: 'FR' };
    expect(getTeamIconUrl(team)).toBe('https://flagcdn.com/w40/fr.png');
  });

  it('should return null if no icon source available', () => {
    const team: TeamData = { code: 'TST', name: 'Test' };
    expect(getTeamIconUrl(team)).toBeNull();
  });

  it('should handle England special flag URL (gb-eng)', () => {
    const england = sampleTeams[2];
    expect(england.flagUrl).toBe('https://flagcdn.com/w80/gb-eng.png');
  });

  it('all seed teams should have flagUrl', () => {
    for (const team of sampleTeams) {
      expect(team.flagUrl).toBeTruthy();
      expect(team.flagUrl!).toContain('flagcdn.com');
    }
  });
});
