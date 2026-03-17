/**
 * Judge Calibration Tracker — local SQLite storage
 * Tracks per-model, per-role, per-domain critic behavior over time.
 * Enables Rasch-style calibration: who is lenient, who is strict, in which domain?
 *
 * DB: ~/.pot/calibration.db (or custom path via POT_CALIBRATION_DB env var)
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface CalibrationEntry {
  blockId: string;
  model: string;
  role: 'critic' | 'synthesizer' | 'generator';
  domain: string;
  scoreGiven: number;           // confidence/score this model produced
  verdict: string;              // VERIFIED / UNCERTAIN / DISSENT / UNVERIFIED
  materialCount?: number;       // from materiality classification
  notableCount?: number;
  minorCount?: number;
  overallAssessment?: string;   // sound / adequate / questionable / deficient
  recordedAt: number;           // unix ms
}

export interface CalibrationStats {
  model: string;
  role: string;
  domain: string;
  runCount: number;
  avgScore: number;
  verdictDist: Record<string, number>;  // {VERIFIED: 5, UNCERTAIN: 2, ...}
  avgMaterialCount: number;
  bias: 'lenient' | 'strict' | 'neutral';  // vs. global avg
}

function getDbPath(): string {
  const custom = process.env.POT_CALIBRATION_DB;
  if (custom) return custom;
  const dir = join(homedir(), '.pot');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'calibration.db');
}

export class CalibrationStorage {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? getDbPath();
    this.db = new Database(path);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS judge_runs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        block_id         TEXT NOT NULL,
        model            TEXT NOT NULL,
        role             TEXT NOT NULL CHECK (role IN ('critic','synthesizer','generator')),
        domain           TEXT NOT NULL DEFAULT 'general',
        score_given      REAL NOT NULL,
        verdict          TEXT NOT NULL,
        material_count   INTEGER DEFAULT 0,
        notable_count    INTEGER DEFAULT 0,
        minor_count      INTEGER DEFAULT 0,
        overall_assessment TEXT,
        recorded_at      INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jr_model  ON judge_runs(model);
      CREATE INDEX IF NOT EXISTS idx_jr_domain ON judge_runs(domain);
      CREATE INDEX IF NOT EXISTS idx_jr_role   ON judge_runs(role);
    `);
  }

  record(entry: CalibrationEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO judge_runs
        (block_id, model, role, domain, score_given, verdict,
         material_count, notable_count, minor_count, overall_assessment, recorded_at)
      VALUES
        (@blockId, @model, @role, @domain, @scoreGiven, @verdict,
         @materialCount, @notableCount, @minorCount, @overallAssessment, @recordedAt)
    `);
    stmt.run({
      blockId: entry.blockId,
      model: entry.model,
      role: entry.role,
      domain: entry.domain ?? 'general',
      scoreGiven: entry.scoreGiven,
      verdict: entry.verdict,
      materialCount: entry.materialCount ?? 0,
      notableCount: entry.notableCount ?? 0,
      minorCount: entry.minorCount ?? 0,
      overallAssessment: entry.overallAssessment ?? null,
      recordedAt: entry.recordedAt,
    });
  }

  /**
   * Get calibration stats for all models (or filtered by model/role/domain).
   * Returns bias estimate: lenient (avg > global+0.05), strict (avg < global-0.05), neutral.
   */
  getStats(filter?: { model?: string; role?: string; domain?: string }): CalibrationStats[] {
    let where = '1=1';
    const params: Record<string, string> = {};
    if (filter?.model)  { where += ' AND model = @model';   params.model  = filter.model; }
    if (filter?.role)   { where += ' AND role = @role';     params.role   = filter.role; }
    if (filter?.domain) { where += ' AND domain = @domain'; params.domain = filter.domain; }

    const rows = this.db.prepare(`
      SELECT model, role, domain,
             COUNT(*) as run_count,
             AVG(score_given) as avg_score,
             AVG(material_count) as avg_material,
             verdict
      FROM judge_runs
      WHERE ${where}
      GROUP BY model, role, domain, verdict
      ORDER BY model, role, domain
    `).all(params) as any[];

    // Global average for bias calculation
    const globalAvg = (this.db.prepare('SELECT AVG(score_given) as avg FROM judge_runs').get() as any)?.avg ?? 0.7;

    // Aggregate by model+role+domain
    const map = new Map<string, CalibrationStats>();
    for (const row of rows) {
      const key = `${row.model}|${row.role}|${row.domain}`;
      if (!map.has(key)) {
        map.set(key, {
          model: row.model,
          role: row.role,
          domain: row.domain,
          runCount: 0,
          avgScore: row.avg_score,
          verdictDist: {},
          avgMaterialCount: row.avg_material ?? 0,
          bias: 'neutral',
        });
      }
      const entry = map.get(key)!;
      entry.verdictDist[row.verdict] = (entry.verdictDist[row.verdict] ?? 0) + row.run_count;
      entry.runCount += row.run_count;
    }

    // Calculate bias
    for (const stats of map.values()) {
      if (stats.avgScore > globalAvg + 0.05) stats.bias = 'lenient';
      else if (stats.avgScore < globalAvg - 0.05) stats.bias = 'strict';
    }

    return Array.from(map.values());
  }

  /**
   * Summary table for CLI display: model × domain → avg score + bias
   */
  getSummaryTable(): { model: string; role: string; domain: string; runs: number; avgScore: string; bias: string }[] {
    return this.getStats().map(s => ({
      model: s.model,
      role: s.role,
      domain: s.domain,
      runs: s.runCount,
      avgScore: (s.avgScore * 100).toFixed(1) + '%',
      bias: s.bias === 'lenient' ? '🟢 lenient' : s.bias === 'strict' ? '🔴 strict' : '⚪ neutral',
    }));
  }

  close(): void {
    this.db.close();
  }
}
