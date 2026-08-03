import { GraphBuilder } from '../services/graph-builder';
import { ImpactAnalyzer } from '../services/impact-analyzer';
import { ShortestPathCalculator } from '../services/shortest-path-calculator';
import {
  draft2GraphInput,
  cycleGraphInput,
  sampleGraphInput,
  vid,
  aid,
  rid,
} from '../testing/test-fixtures';
import { ImpactLevel, EdgeKind } from '../models/enums';
import { RevisionGraphInput } from '../ports/graph-input';

describe('LAW-DRAFT-2 scenario', () => {
  let builder: GraphBuilder;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    builder = new GraphBuilder();
    analyzer = new ImpactAnalyzer();
  });

  function analyze() {
    const graph = builder.build(draft2GraphInput());
    return analyzer.analyze(
      graph,
      vid('LAW-V1'),
      vid('LAW-DRAFT-2'),
      '2026-08-03T00:00:00.000Z',
    );
  }

  describe('same stableId in SPLIT and MERGE', () => {
    it('marks ART-A as direct via both SPLIT and MERGE edges', () => {
      const report = analyze();
      const directIds = report.directArticles.map((a) => a.stableId);
      expect(directIds).toContain(aid('ART-A'));
    });

    it('marks all SPLIT successors as direct', () => {
      const report = analyze();
      const directIds = report.directArticles.map((a) => a.stableId);
      expect(directIds).toContain(aid('ART-A1'));
      expect(directIds).toContain(aid('ART-A2'));
    });

    it('marks the MERGE target ART-M as direct', () => {
      const report = analyze();
      const directIds = report.directArticles.map((a) => a.stableId);
      expect(directIds).toContain(aid('ART-M'));
    });

    it('marks MERGE co-source ART-B as direct', () => {
      const report = analyze();
      const directIds = report.directArticles.map((a) => a.stableId);
      expect(directIds).toContain(aid('ART-B'));
    });

    it('records paths with both SPLIT and MERGE succession hops from ART-A', () => {
      const report = analyze();
      const pathsFromA = report.paths.filter(
        (p) =>
          p.hops.length > 0 &&
          p.hops[0].fromId === aid('ART-A') &&
          p.hops[0].edgeKind === EdgeKind.SUCCESSION,
      );
      const targets = pathsFromA.map((p) => p.targetId).sort();
      expect(targets).toContain(aid('ART-A1'));
      expect(targets).toContain(aid('ART-A2'));
      expect(targets).toContain(aid('ART-M'));
    });
  });

  describe('missing succession edge', () => {
    it('reports ART-D as missing succession, never guessed', () => {
      const report = analyze();
      expect(report.missingSuccessions).toHaveLength(1);
      expect(report.missingSuccessions[0].stableId).toBe(aid('ART-D'));
      expect(report.missingSuccessions[0].reason).toContain(
        'no explicit succession edge',
      );
    });

    it('does not create a fake edge for ART-D', () => {
      const report = analyze();
      const pathsToD = report.paths.filter(
        (p) => p.targetId === aid('ART-D') && p.depth > 0,
      );
      expect(pathsToD).toHaveLength(0);
    });
  });

  describe('rule classification', () => {
    it('classifies RULE-DIR-01 (bound to ART-A) as DIRECT', () => {
      const report = analyze();
      const rule = report.directRules.find(
        (r) => r.ruleId === rid('RULE-DIR-01'),
      );
      expect(rule).toBeDefined();
      expect(rule!.level).toBe(ImpactLevel.DIRECT);
    });

    it('classifies RULE-MERGE-02 (bound to ART-B) as DIRECT', () => {
      const report = analyze();
      const rule = report.directRules.find(
        (r) => r.ruleId === rid('RULE-MERGE-02'),
      );
      expect(rule).toBeDefined();
      expect(rule!.level).toBe(ImpactLevel.DIRECT);
    });

    it('classifies RULE-DRAFT-06 (bound to A1+M) as DIRECT', () => {
      const report = analyze();
      const rule = report.directRules.find(
        (r) => r.ruleId === rid('RULE-DRAFT-06'),
      );
      expect(rule).toBeDefined();
      expect(rule!.level).toBe(ImpactLevel.DIRECT);
    });

    it('classifies RULE-REF-03 (bound to ART-F in draft) as INDIRECT', () => {
      const report = analyze();
      const rule = report.indirectRules.find(
        (r) => r.ruleId === rid('RULE-REF-03'),
      );
      expect(rule).toBeDefined();
      expect(rule!.level).toBe(ImpactLevel.INDIRECT);
    });

    it('classifies RULE-MISSING-04 (bound to ART-D) as UNAFFECTED', () => {
      const report = analyze();
      const rule = report.unaffectedRules.find(
        (r) => r.ruleId === rid('RULE-MISSING-04'),
      );
      expect(rule).toBeDefined();
      expect(rule!.level).toBe(ImpactLevel.UNAFFECTED);
    });

    it('classifies RULE-REF-D-05 (bound to ART-E) as DIRECT', () => {
      const report = analyze();
      const rule = report.directRules.find(
        (r) => r.ruleId === rid('RULE-REF-D-05'),
      );
      expect(rule).toBeDefined();
      expect(rule!.level).toBe(ImpactLevel.DIRECT);
    });

    it('classifies RULE-CARRY-07 (bound to ART-C1) as DIRECT', () => {
      const report = analyze();
      const rule = report.directRules.find(
        (r) => r.ruleId === rid('RULE-CARRY-07'),
      );
      expect(rule).toBeDefined();
      expect(rule!.level).toBe(ImpactLevel.DIRECT);
    });

    it('every rule appears in exactly one category', () => {
      const report = analyze();
      const all = [
        ...report.directRules,
        ...report.indirectRules,
        ...report.unaffectedRules,
      ];
      const ids = all.map((r) => r.ruleId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBe(7);
    });
  });

  describe('shortest propagation witnesses', () => {
    it('provides a witness for every affected rule', () => {
      const report = analyze();
      const affectedRuleIds = [
        ...report.directRules.map((r) => r.ruleId),
        ...report.indirectRules.map((r) => r.ruleId),
      ].sort();
      const witnessRuleIds = report.ruleWitnesses
        .map((w) => w.ruleId)
        .sort();
      expect(witnessRuleIds).toEqual(affectedRuleIds);
    });

    it('RULE-DIR-01 has shortest distance 0 with count 1', () => {
      const report = analyze();
      const w = report.ruleWitnesses.find(
        (x) => x.ruleId === rid('RULE-DIR-01'),
      )!;
      expect(w.shortestDistance).toBe(0);
      expect(w.equalLengthPathCount).toBe(1);
      expect(w.witness.hops).toHaveLength(0);
      expect(w.witness.targetId).toBe(aid('ART-A'));
    });

    it('RULE-DRAFT-06 has shortest distance 0 with count 2 (A1 and M both direct)', () => {
      const report = analyze();
      const w = report.ruleWitnesses.find(
        (x) => x.ruleId === rid('RULE-DRAFT-06'),
      )!;
      expect(w.shortestDistance).toBe(0);
      expect(w.equalLengthPathCount).toBe(2);
      expect(w.witness.hops).toHaveLength(0);
    });

    it('RULE-REF-03 has shortest distance 1 with count 2 (F refs both A1 and M)', () => {
      const report = analyze();
      const w = report.ruleWitnesses.find(
        (x) => x.ruleId === rid('RULE-REF-03'),
      )!;
      expect(w.shortestDistance).toBe(1);
      expect(w.equalLengthPathCount).toBe(2);
      expect(w.witness.hops).toHaveLength(1);
      expect(w.witness.hops[0].edgeKind).toBe(
        EdgeKind.CROSS_REFERENCE,
      );
      expect(w.witness.hops[0].toId).toBe(aid('ART-F'));
    });

    it('RULE-MERGE-02 has shortest distance 0 with count 1', () => {
      const report = analyze();
      const w = report.ruleWitnesses.find(
        (x) => x.ruleId === rid('RULE-MERGE-02'),
      )!;
      expect(w.shortestDistance).toBe(0);
      expect(w.equalLengthPathCount).toBe(1);
    });

    it('RULE-REF-D-05 (bound to E) has shortest distance 0 count 1', () => {
      const report = analyze();
      const w = report.ruleWitnesses.find(
        (x) => x.ruleId === rid('RULE-REF-D-05'),
      )!;
      expect(w.shortestDistance).toBe(0);
      expect(w.equalLengthPathCount).toBe(1);
    });

    it('RULE-CARRY-07 (bound to C1) has shortest distance 0 count 1', () => {
      const report = analyze();
      const w = report.ruleWitnesses.find(
        (x) => x.ruleId === rid('RULE-CARRY-07'),
      )!;
      expect(w.shortestDistance).toBe(0);
      expect(w.equalLengthPathCount).toBe(1);
    });

    it('unaffected rules have no witness', () => {
      const report = analyze();
      const witnessIds = report.ruleWitnesses.map((w) => w.ruleId);
      expect(witnessIds).not.toContain(rid('RULE-MISSING-04'));
      expect(witnessIds).toHaveLength(6);
    });
  });
});

describe('ShortestPathCalculator', () => {
  let calculator: ShortestPathCalculator;
  let builder: GraphBuilder;

  beforeEach(() => {
    calculator = new ShortestPathCalculator();
    builder = new GraphBuilder();
  });

  it('computes distance 0 and count 1 for each seed', () => {
    const graph = builder.build(sampleGraphInput());
    const result = calculator.calculate(graph, [aid('ART-A')]);
    const info = result.get(aid('ART-A'))!;
    expect(info.distance).toBe(0);
    expect(info.equalLengthPathCount).toBe(1);
    expect(info.witness.hops).toHaveLength(0);
  });

  it('counts multiple equal-length shortest paths through different seeds', () => {
    const graph = builder.build(draft2GraphInput());
    const result = calculator.calculate(graph, [
      aid('ART-A'),
      aid('ART-B'),
    ]);
    const info = result.get(aid('ART-C'))!;
    expect(info.distance).toBe(1);
    expect(info.equalLengthPathCount).toBe(2);
  });

  it('produces a deterministic canonical witness', () => {
    const graph = builder.build(draft2GraphInput());
    const r1 = calculator.calculate(graph, [aid('ART-A'), aid('ART-B')]);
    const r2 = calculator.calculate(graph, [aid('ART-A'), aid('ART-B')]);
    const w1 = r1.get(aid('ART-C'))!.witness;
    const w2 = r2.get(aid('ART-C'))!.witness;
    expect(JSON.stringify(w1)).toBe(JSON.stringify(w2));
  });

  it('terminates on cross-reference cycles without infinite loop', () => {
    const graph = builder.build(cycleGraphInput());
    const result = calculator.calculate(graph, [aid('C1')]);
    expect(result.size).toBeGreaterThan(0);
    expect(result.size).toBeLessThan(100);
  });

  it('reaches all nodes in a cycle at finite distances', () => {
    const graph = builder.build(cycleGraphInput());
    const result = calculator.calculate(graph, [aid('C1')]);
    expect(result.has(aid('C2'))).toBe(true);
    expect(result.has(aid('C3'))).toBe(true);
    expect(result.has(aid('C4'))).toBe(true);
  });

  it('witness path hops form a valid chain ending at target', () => {
    const graph = builder.build(sampleGraphInput());
    const result = calculator.calculate(graph, [aid('ART-A')]);
    const info = result.get(aid('ART-B'))!;
    expect(info.witness.targetId).toBe(aid('ART-B'));
    for (let i = 1; i < info.witness.hops.length; i++) {
      expect(info.witness.hops[i].fromId).toBe(
        info.witness.hops[i - 1].toId,
      );
    }
  });
});

describe('Determinism — byte-level consistency', () => {
  let builder: GraphBuilder;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    builder = new GraphBuilder();
    analyzer = new ImpactAnalyzer();
  });

  function reverseInput(input: RevisionGraphInput): RevisionGraphInput {
    return {
      versions: [...input.versions].reverse(),
      articles: [...input.articles].reverse(),
      succession: [...input.succession].reverse(),
      bindings: [...input.bindings].reverse(),
    };
  }

  function duplicateInput(
    input: RevisionGraphInput,
  ): RevisionGraphInput {
    return {
      versions: [...input.versions, ...input.versions],
      articles: [...input.articles, ...input.articles],
      succession: [...input.succession, ...input.succession],
      bindings: [...input.bindings, ...input.bindings],
    };
  }

  function runAnalyzer(input: RevisionGraphInput) {
    const graph = builder.build(input);
    return analyzer.analyze(
      graph,
      vid('LAW-V1'),
      vid('LAW-DRAFT-2'),
      '2026-08-03T00:00:00.000Z',
    );
  }

  function serialize(value: unknown): string {
    return JSON.stringify(value);
  }

  it('reversed import order produces identical fingerprint, paths and diagnostics', () => {
    const normal = draft2GraphInput();
    const reversed = reverseInput(normal);

    const report1 = runAnalyzer(normal);
    const report2 = runAnalyzer(reversed);

    expect(report1.graphFingerprint).toBe(report2.graphFingerprint);
    expect(serialize(report1.paths)).toBe(serialize(report2.paths));
    expect(serialize(report1.missingSuccessions)).toBe(
      serialize(report2.missingSuccessions),
    );
    expect(serialize(report1.directArticles)).toBe(
      serialize(report2.directArticles),
    );
    expect(serialize(report1.indirectArticles)).toBe(
      serialize(report2.indirectArticles),
    );
    expect(serialize(report1.directRules)).toBe(
      serialize(report2.directRules),
    );
    expect(serialize(report1.indirectRules)).toBe(
      serialize(report2.indirectRules),
    );
    expect(serialize(report1.ruleWitnesses)).toBe(
      serialize(report2.ruleWitnesses),
    );
    expect(serialize(report1)).toBe(serialize(report2));
  });

  it('duplicate imports produce identical fingerprint, paths and diagnostics', () => {
    const normal = draft2GraphInput();
    const duplicated = duplicateInput(normal);

    const report1 = runAnalyzer(normal);
    const report2 = runAnalyzer(duplicated);

    expect(report1.graphFingerprint).toBe(report2.graphFingerprint);
    expect(serialize(report1)).toBe(serialize(report2));
  });

  it('cycle-containing subgraph produces byte-identical results across runs', () => {
    const graph = builder.build(cycleGraphInput());
    const r1 = analyzer.analyze(
      graph,
      vid('V1'),
      vid('V2'),
      '2026-08-03T00:00:00.000Z',
    );
    const r2 = analyzer.analyze(
      graph,
      vid('V1'),
      vid('V2'),
      '2026-08-03T00:00:00.000Z',
    );
    expect(serialize(r1)).toBe(serialize(r2));
  });

  it('reversed cycle subgraph input produces identical output', () => {
    const normal = cycleGraphInput();
    const reversed = reverseInput(normal);
    const g1 = builder.build(normal);
    const g2 = builder.build(reversed);

    const r1 = analyzer.analyze(
      g1,
      vid('V1'),
      vid('V2'),
      '2026-08-03T00:00:00.000Z',
    );
    const r2 = analyzer.analyze(
      g2,
      vid('V1'),
      vid('V2'),
      '2026-08-03T00:00:00.000Z',
    );

    expect(r1.graphFingerprint).toBe(r2.graphFingerprint);
    expect(serialize(r1)).toBe(serialize(r2));
  });

  it('sample graph with reversed and duplicated inputs is byte-identical', () => {
    const normal = sampleGraphInput();
    const target = vid('LAW-V2');

    const g1 = builder.build(normal);
    const g2 = builder.build(reverseInput(normal));
    const g3 = builder.build(duplicateInput(normal));

    const r1 = analyzer.analyze(
      g1,
      vid('LAW-V1'),
      target,
      '2026-08-03T00:00:00.000Z',
    );
    const r2 = analyzer.analyze(
      g2,
      vid('LAW-V1'),
      target,
      '2026-08-03T00:00:00.000Z',
    );
    const r3 = analyzer.analyze(
      g3,
      vid('LAW-V1'),
      target,
      '2026-08-03T00:00:00.000Z',
    );

    expect(serialize(r1)).toBe(serialize(r2));
    expect(serialize(r1)).toBe(serialize(r3));
  });
});
