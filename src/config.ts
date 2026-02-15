import { readFileSync, existsSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { PotConfig } from './types.js';

const DEFAULT_CONFIG: PotConfig = {
  models: {
    generator1: 'grok-beta',
    generator2: 'moonshot-v1-8k',
    generator3: 'claude-sonnet-4-20250514',
    critic: 'claude-sonnet-4-20250514',
    synthesizer: 'claude-sonnet-4-20250514',
  },
  apiKeys: {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    xai: process.env.XAI_API_KEY,
    moonshot: process.env.MOONSHOT_API_KEY,
  },
  blockStoragePath: './blocks',
  language: 'de',
};

export function loadConfig(): PotConfig {
  const configPaths = [
    join(process.cwd(), '.potrc.json'),
    join(homedir(), '.potrc.json'),
  ];

  for (const path of configPaths) {
    if (existsSync(path)) {
      try {
        const fileConfig = JSON.parse(readFileSync(path, 'utf-8'));
        return { ...DEFAULT_CONFIG, ...fileConfig };
      } catch (error) {
        console.error(`Failed to parse config at ${path}`);
      }
    }
  }

  return DEFAULT_CONFIG;
}

export function saveConfig(config: PotConfig): void {
  const configPath = join(homedir(), '.potrc.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function getConfig(): PotConfig {
  return loadConfig();
}
