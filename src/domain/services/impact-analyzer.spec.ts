import { ImpactAnalyzer } from './impact-analyzer';
import { GraphBuilder } from './graph-builder';
import {
  sampleGraphInput,
  mergeGraphInput,
  cycleGraphInput,
  missingSuccessionGraphInput,
  sameDayVersionsGraphInput,
  largeGraphInput,
  vid,
  aid,
  rid,
} from '../testing/test-fixtures';
import { ImpactLevel } from '../models/enums';

describe('ImpactAnalyzer', () => {
  let analyzer: ImpactAnalyzer;
  let builder: GraphBuilder;

  beforeEach(() => {
    analyzer = new ImpactAnalyzer();
    builder = new GraphBuilder();
  });

  describe('split (one-to-many)', () => {
    it('identifies split source and successors as DIRECT', () => {
      const graph = builder.build(sampleGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('LAW-V1'),
        vid('LAW-V2'),
        '2026-08-01T00:00:00.000Z',
      );

      const directIds = report.directArticles.map((a) => a.stableId);
      expect(directIds).toContain(aid('ART-A'));
      expect(directIds).toContain(aid('ART-A1'));
      expect(directIds).toContain(aid('ART-A2'));
    });

    it('identifies cross-referencing article as INDIRECT', () => {
      const graph = builder.build(sampleGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('LAW-V1'),
        vid('LAW-V2'),
        '2026-08-01T00:00:00.000Z',
      );

      const indirectIds = report.indirectArticles.map(
        (a) => a.stableId,
      );
      expect(indirectIds).toContain(aid('ART-B'));
    });

    it('classifies rules bound to changed articles as DIRECT', () => {
      const graph = builder.build(sampleGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('LAW-V1'),
        vid('LAW-V2'),
        '2026-08-01T00:00:00.000Z',
      );

      const directRuleIds = report.directRules.map((r) => r.ruleId);
      expect(directRuleIds).toContain(rid('RULE-ELIGIBILITY-01'));
    });

    it('classifies rules bound to indirectly affected articles as INDIRECT', () => {
      const graph = builder.build(sampleGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('LAW-V1'),
        vid('LAW-V2'),
        '2026-08-01T00:00:00.000Z',
      );

      const indirectRuleIds = report.indirectRules.map(
        (r) => r.ruleId,
      );
      expect(indirectRuleIds).toContain(rid('RULE-SERVICE-02'));
    });

    it('includes propagation paths from revised article through cross-references', () => {
      const graph = builder.build(sampleGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('LAW-V1'),
        vid('LAW-V2'),
        '2026-08-01T00:00:00.000Z',
      );

      const pathToB = report.paths.find(
        (p) => p.targetId === aid('ART-B') && p.depth > 0,
      );
      expect(pathToB).toBeDefined();
      expect(pathToB!.hops.length).toBeGreaterThan(0);
    });
  });

  describe('merge (many-to-one)', () => {
    it('identifies all merge sources and the merged target as DIRECT', () => {
      const graph = builder.build(mergeGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('LAW-V1'),
        vid('LAW-V2'),
        '2026-08-01T00:00:00.000Z',
      );

      const directIds = report.directArticles.map((a) => a.stableId);
      expect(directIds).toContain(aid('ART-X'));
      expect(directIds).toContain(aid('ART-Y'));
      expect(directIds).toContain(aid('ART-Z'));
    });

    it('classifies rules from both merge sources as DIRECT', () => {
      const graph = builder.build(mergeGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('LAW-V1'),
        vid('LAW-V2'),
        '2026-08-01T00:00:00.000Z',
      );

      const directRuleIds = report.directRules.map((r) => r.ruleId);
      expect(directRuleIds).toContain(rid('RULE-X'));
      expect(directRuleIds).toContain(rid('RULE-Y'));
      expect(directRuleIds).toContain(rid('RULE-Z'));
    });
  });

  describe('cross-reference cycles', () => {
    it('terminates and classifies all cycle members', () => {
      const graph = builder.build(cycleGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('V1'),
        vid('V2'),
        '2026-08-01T00:00:00.000Z',
      );

      expect(report.directArticles).toHaveLength(2);
      const indirectIds = report.indirectArticles.map(
        (a) => a.stableId,
      );
      expect(indirectIds).toContain(aid('C2'));
      expect(indirectIds).toContain(aid('C3'));
      expect(indirectIds).toContain(aid('C4'));
    });

    it('does not produce infinite paths', () => {
      const graph = builder.build(cycleGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('V1'),
        vid('V2'),
        '2026-08-01T00:00:00.000Z',
      );

      for (const p of report.paths) {
        const ids = p.hops.map((h) => h.toId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });
  });

  describe('missing succession', () => {
    it('reports articles with no explicit succession edge', () => {
      const graph = builder.build(missingSuccessionGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('V1'),
        vid('V2'),
        '2026-08-01T00:00:00.000Z',
      );

      expect(report.missingSuccessions).toHaveLength(1);
      expect(report.missingSuccessions[0].stableId).toBe(aid('GONE'));
    });

    it('does not report articles that have succession as missing', () => {
      const graph = builder.build(missingSuccessionGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('V1'),
        vid('V2'),
        '2026-08-01T00:00:00.000Z',
      );

      const missingIds = report.missingSuccessions.map(
        (m) => m.stableId,
      );
      expect(missingIds).not.toContain(aid('KEEP'));
    });
  });

  describe('same-day multiple versions', () => {
    it('distinguishes queries to different target versions on the same day', () => {
      const graph = builder.build(sameDayVersionsGraphInput());

      const reportA = analyzer.analyze(
        graph,
        vid('V1'),
        vid('V2A'),
        '2026-08-01T00:00:00.000Z',
      );
      const reportB = analyzer.analyze(
        graph,
        vid('V1'),
        vid('V2B'),
        '2026-08-01T00:00:00.000Z',
      );

      const directA = reportA.directArticles.map((a) => a.stableId);
      const directB = reportB.directArticles.map((a) => a.stableId);
      expect(directA).toContain(aid('D2A'));
      expect(directB).toContain(aid('D2B'));
      expect(directA).not.toEqual(directB);
    });
  });

  describe('unaffected set', () => {
    it('includes articles not reached by any path', () => {
      const graph = builder.build(sampleGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('LAW-V1'),
        vid('LAW-V2'),
        '2026-08-01T00:00:00.000Z',
      );

      const unaffectedIds = report.unaffectedArticles.map(
        (a) => a.stableId,
      );
      expect(unaffectedIds).not.toContain(aid('ART-A'));
      expect(unaffectedIds).not.toContain(aid('ART-B'));
    });

    it('every article appears in exactly one impact level', () => {
      const graph = builder.build(sampleGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('LAW-V1'),
        vid('LAW-V2'),
        '2026-08-01T00:00:00.000Z',
      );

      const all = [
        ...report.directArticles,
        ...report.indirectArticles,
        ...report.unaffectedArticles,
      ];
      const ids = all.map((a) => a.stableId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBe(graph.articles.length);
    });

    it('every rule appears in exactly one impact level', () => {
      const graph = builder.build(sampleGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('LAW-V1'),
        vid('LAW-V2'),
        '2026-08-01T00:00:00.000Z',
      );

      const all = [
        ...report.directRules,
        ...report.indirectRules,
        ...report.unaffectedRules,
      ];
      const ids = all.map((r) => r.ruleId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBe(graph.bindings.length);
    });
  });

  describe('large graph path deduplication and ordering', () => {
    it('produces stable, deduplicated paths on large graph', () => {
      const graph = builder.build(largeGraphInput(30));
      const report1 = analyzer.analyze(
        graph,
        vid('V1'),
        vid('V2'),
        '2026-08-01T00:00:00.000Z',
      );
      const report2 = analyzer.analyze(
        graph,
        vid('V1'),
        vid('V2'),
        '2026-08-01T00:00:00.000Z',
      );

      const pathKey = (p: { hops: ReadonlyArray<{ fromId: string; toId: string }>; targetId: string }): string =>
        p.hops.length === 0
          ? `seed:${p.targetId}`
          : p.hops.map((h) => `${h.fromId}->${h.toId}`).join('|');
      const keys1 = report1.paths.map(pathKey);
      const keys2 = report2.paths.map(pathKey);
      expect(keys1).toEqual(keys2);

      expect(new Set(keys1).size).toBe(keys1.length);

      for (let i = 1; i < report1.paths.length; i++) {
        expect(report1.paths[i - 1].depth).toBeLessThanOrEqual(
          report1.paths[i].depth,
        );
      }
    });
  });

  describe('report metadata', () => {
    it('includes graph fingerprint and queried timestamp', () => {
      const graph = builder.build(sampleGraphInput());
      const ts = '2026-08-01T12:00:00.000Z';
      const report = analyzer.analyze(
        graph,
        vid('LAW-V1'),
        vid('LAW-V2'),
        ts,
      );

      expect(report.queriedAt).toBe(ts);
      expect(report.graphFingerprint).toBe(graph.fingerprint());
      expect(report.sourceVersionId).toBe(vid('LAW-V1'));
      expect(report.targetVersionId).toBe(vid('LAW-V2'));
    });

    it('throws when source version does not exist', () => {
      const graph = builder.build(sampleGraphInput());
      expect(() =>
        analyzer.analyze(
          graph,
          vid('NOPE'),
          vid('LAW-V2'),
          '2026-08-01T00:00:00.000Z',
        ),
      ).toThrow();
    });

    it('throws when source and target are the same version', () => {
      const graph = builder.build(sampleGraphInput());
      expect(() =>
        analyzer.analyze(
          graph,
          vid('LAW-V1'),
          vid('LAW-V1'),
          '2026-08-01T00:00:00.000Z',
        ),
      ).toThrow();
    });
  });

  describe('impact levels on all articles', () => {
    it('marks every article with a valid impact level', () => {
      const graph = builder.build(sampleGraphInput());
      const report = analyzer.analyze(
        graph,
        vid('LAW-V1'),
        vid('LAW-V2'),
        '2026-08-01T00:00:00.000Z',
      );

      for (const a of report.directArticles) {
        expect(a.level).toBe(ImpactLevel.DIRECT);
      }
      for (const a of report.indirectArticles) {
        expect(a.level).toBe(ImpactLevel.INDIRECT);
      }
      for (const a of report.unaffectedArticles) {
        expect(a.level).toBe(ImpactLevel.UNAFFECTED);
      }
    });
  });
});
