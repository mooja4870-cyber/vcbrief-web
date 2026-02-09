import { registerPlugin } from '@capacitor/core';

export interface BriefBackgroundCache {
  json: string;
  cachedAtMs: number;
  lastError: string;
}

export interface BriefBackgroundPlugin {
  configure(options: { apiBase: string; enabled?: boolean }): Promise<{ ok: boolean }>;
  getCache(): Promise<BriefBackgroundCache>;
}

const BriefBackground = registerPlugin<BriefBackgroundPlugin>('BriefBackground');

export default BriefBackground;

