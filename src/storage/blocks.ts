import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Block } from '../types.js';

export class BlockStorage {
  private storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.ensureStorageExists();
  }

  private ensureStorageExists(): void {
    if (!existsSync(this.storagePath)) {
      mkdirSync(this.storagePath, { recursive: true });
    }
  }

  private getNextBlockNumber(): number {
    const files = this.listBlockFiles();
    if (files.length === 0) return 1;

    const numbers = files
      .map(f => {
        const match = f.match(/PoT-(\d+)\.json/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(n => n > 0);

    return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  }

  private listBlockFiles(): string[] {
    return readdirSync(this.storagePath)
      .filter(f => f.startsWith('PoT-') && f.endsWith('.json'))
      .sort();
  }

  save(block: Block): string {
    const blockNumber = this.getNextBlockNumber();
    const blockId = `PoT-${blockNumber.toString().padStart(3, '0')}`;
    block.id = blockId;

    const filePath = join(this.storagePath, `${blockId}.json`);
    writeFileSync(filePath, JSON.stringify(block, null, 2));
    
    return blockId;
  }

  load(blockId: string): Block | null {
    const filePath = join(this.storagePath, `${blockId}.json`);
    
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Failed to load block ${blockId}:`, error);
      return null;
    }
  }

  list(): Block[] {
    const files = this.listBlockFiles();
    return files
      .map(f => {
        try {
          const content = readFileSync(join(this.storagePath, f), 'utf-8');
          return JSON.parse(content) as Block;
        } catch {
          return null;
        }
      })
      .filter((b): b is Block => b !== null);
  }

  getByNumber(num: number): Block | null {
    const blockId = `PoT-${num.toString().padStart(3, '0')}`;
    return this.load(blockId);
  }

  loadBlock(number: number): Block | null {
    return this.getByNumber(number);
  }

  loadBlocks(numbers: number[]): Block[] {
    return numbers
      .map(num => this.loadBlock(num))
      .filter((block): block is Block => block !== null);
  }

  getLastBlockNumber(): number {
    const files = this.listBlockFiles();
    if (files.length === 0) return 0;

    const numbers = files
      .map(f => {
        const match = f.match(/PoT-(\d+)\.json/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(n => n > 0);

    return numbers.length > 0 ? Math.max(...numbers) : 0;
  }
}
