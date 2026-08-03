import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalStringify } from '../common/canonical-json';
import { parseImportDocument } from '../imports/import-document';
import { computeImpact } from './impact';
import type { ImpactQuery, RevisionGraph } from './types';

/**
 * Round-2 scenario: a LAW-DRAFT-2 draft in which the SAME stable article ID
 * (ART-HUB) is at once a one-to-many SPLIT source and one of two MERGE sources,
 * alongside one deliberately missing succession edge (ART-DROP) and a
 * cross-reference cycle (ART-C1 <-> ART-C2).
 *
 * This reuses the round-1 relationship kinds, stable ordering, and the pure
 * domain evaluator unchanged. The tests assert the classification, per-rule
 * witnesses, the stable missing-edge diagnostic, and — the core requirement —
 * byte-identical output under reversed import order, repeated import, and when
 * restricted to the cycle subgraph.
 */

const QUERY: ImpactQuery = {
  fromVersion: 'LAW-V1',
  toVersion: 'LAW-DRAFT-2',
  asOf: '2026-08-02T00:00:00.000Z',
};

function loadMaterial(name: string): RevisionGraph {
  const raw = readFileSync(join(__dirname, '..', '..', 'materials', name), 'utf8');
  return parseImportDocument(JSON.parse(raw));
}

function reverseGraph(graph: RevisionGraph): RevisionGraph {
  return {
    versions: [...graph.versions].reverse(),
    articles: [...graph.articles].reverse(),
    references: [...graph.references].reverse(),
    succession: [...graph.succession].reverse(),
    bindings: [...graph.bindings].reverse(),
  };
}

/** Concatenate a graph with itself: simulates a duplicate re-import. */
function duplicateGraph(graph: RevisionGraph): RevisionGraph {
  return {
    versions: [...graph.versions, ...graph.versions],
    articles: [...graph.articles, ...graph.articles],
    references: [...graph.references, ...graph.references],
    succession: [...graph.succession, ...graph.succession],
    bindings: [...graph.bindings, ...graph.bindings],
  };
}

const GRAPH = loadMaterial('draft-2-shared-node.json');

describe('computeImpact on the shared-node LAW-DRAFT-2 draft', () => {
  const result = computeImpact(GRAPH, QUERY);

  it('treats ART-HUB as a single changed article carrying both SPLIT and MERGE edges', () => {
    expect(result.changedArticles.map((c) => c.stableId)).toEqual([
      'ART-C1',
      'ART-C2',
      'ART-HUB',
      'ART-PART',
    ]);
    const hub = result.changedArticles.find((c) => c.stableId === 'ART-HUB');
    // One stableId simultaneously splits into many and merges into one; edges
    // are followed only along explicit succession, listed in stable order.
    expect(hub?.succession).toEqual([
      { fromId: 'ART-HUB', toId: 'ART-COMBINED', kind: 'MERGE' },
      { fromId: 'ART-HUB', toId: 'ART-HUB-A', kind: 'SPLIT' },
      { fromId: 'ART-HUB', toId: 'ART-HUB-B', kind: 'SPLIT' },
    ]);
    expect(result.addedArticles).toEqual([]);
    expect(result.unchangedArticles).toEqual(['ART-CITE', 'ART-CITE2', 'ART-SAFE']);
    expect(result.versionContext.to).toEqual({
      id: 'LAW-DRAFT-2',
      status: 'DRAFT',
      effectiveFrom: null,
      effectivenessAtAsOf: 'DRAFT',
    });
    expect(result.versionContext.from.effectivenessAtAsOf).toBe('EFFECTIVE');
  });

  it('classifies direct, indirect and unaffected rules', () => {
    expect(result.rules.direct.map((r) => r.ruleId)).toEqual([
      'RULE-CYCLE-1',
      'RULE-CYCLE-2',
      'RULE-HUB',
      'RULE-MERGE-BOTH',
    ]);
    expect(result.rules.indirect.map((r) => r.ruleId)).toEqual([
      'RULE-CITE',
      'RULE-CITE2',
    ]);
    expect(result.rules.unaffected.map((r) => r.ruleId)).toEqual([
      'RULE-DROP',
      'RULE-SAFE',
    ]);
  });

  it('stores one shortest witness and the equal-length witness count per affected rule', () => {
    // Bound to BOTH merge sources -> two equal-length direct witnesses.
    const mergeBoth = result.rules.direct.find((r) => r.ruleId === 'RULE-MERGE-BOTH');
    expect(mergeBoth?.witness?.nodes).toEqual(['ART-HUB']);
    expect(mergeBoth?.witness?.edges).toEqual([]);
    expect(mergeBoth?.witnessCount).toBe(2);
    expect(mergeBoth?.via).toEqual(['ART-HUB', 'ART-PART']);

    const hub = result.rules.direct.find((r) => r.ruleId === 'RULE-HUB');
    expect(hub?.witness?.nodes).toEqual(['ART-HUB']);
    expect(hub?.witnessCount).toBe(1);

    // One citer of a single cycle node -> one shortest witness.
    const cite = result.rules.indirect.find((r) => r.ruleId === 'RULE-CITE');
    expect(cite?.witness?.nodes).toEqual(['ART-C1', 'ART-CITE']);
    expect(cite?.witness?.edges).toEqual([
      { fromId: 'ART-C1', toId: 'ART-CITE', kind: 'REFERENCE_REVERSE' },
    ]);
    expect(cite?.witnessCount).toBe(1);

    // Cites both cycle nodes -> two equal-length shortest witnesses.
    const cite2 = result.rules.indirect.find((r) => r.ruleId === 'RULE-CITE2');
    expect(cite2?.witness?.nodes).toEqual(['ART-C1', 'ART-CITE2']);
    expect(cite2?.witnessCount).toBe(2);

    for (const safe of result.rules.unaffected) {
      expect(safe.witness).toBeNull();
      expect(safe.witnessCount).toBe(0);
    }
  });

  it('enumerates cycle paths deterministically, deduplicated and stably sorted', () => {
    expect(
      result.paths.filter((p) => p.ruleId === 'RULE-CITE2').map((p) => p.nodes.join('>')),
    ).toEqual([
      'ART-C1>ART-C2>ART-CITE2',
      'ART-C1>ART-CITE2',
      'ART-C2>ART-C1>ART-CITE2',
      'ART-C2>ART-CITE2',
    ]);
    expect(
      result.paths.filter((p) => p.ruleId === 'RULE-CITE').map((p) => p.nodes.join('>')),
    ).toEqual(['ART-C1>ART-CITE', 'ART-C2>ART-C1>ART-CITE']);
  });

  it('reports the deliberately missing succession edge as a stable diagnostic, never guessed', () => {
    expect(result.missingSuccession).toEqual([
      { stableId: 'ART-DROP', boundRuleIds: ['RULE-DROP'] },
    ]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('MISSING_SUCCESSION');
    expect(result.diagnostics[0]?.stableId).toBe('ART-DROP');
    expect(result.diagnostics[0]?.message).toContain('LAW-DRAFT-2');
    expect(result.rules.unaffected.map((r) => r.ruleId)).toContain('RULE-DROP');
  });

  it('is byte-identical when the import record order is reversed', () => {
    const reversed = computeImpact(reverseGraph(GRAPH), QUERY);
    expect(canonicalStringify(reversed)).toEqual(canonicalStringify(result));
  });

  it('is byte-identical when the same document is imported twice (duplicate records)', () => {
    const duplicated = computeImpact(duplicateGraph(GRAPH), QUERY);
    expect(canonicalStringify(duplicated)).toEqual(canonicalStringify(result));
  });

  it('produces byte-identical cycle output regardless of subgraph edge ordering', () => {
    // Isolate the cross-reference cycle subgraph: ART-C1 <-> ART-C2, cited by
    // ART-CITE and ART-CITE2, with a RENUMBER succession driving the change.
    const cycleGraph: RevisionGraph = {
      versions: [
        { id: 'LAW-V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
        { id: 'LAW-DRAFT-2', status: 'DRAFT', effectiveFrom: null },
      ],
      articles: GRAPH.articles.filter((a) =>
        ['ART-C1', 'ART-C2', 'ART-CITE', 'ART-CITE2', 'ART-C1N', 'ART-C2N'].includes(
          a.stableId,
        ),
      ),
      references: GRAPH.references.filter((r) =>
        ['ART-C1', 'ART-C2', 'ART-CITE', 'ART-CITE2'].includes(r.fromId),
      ),
      succession: GRAPH.succession.filter((s) =>
        ['ART-C1', 'ART-C2'].includes(s.fromId),
      ),
      bindings: GRAPH.bindings.filter((b) =>
        ['RULE-CYCLE-1', 'RULE-CYCLE-2', 'RULE-CITE', 'RULE-CITE2'].includes(b.ruleId),
      ),
    };
    const forward = computeImpact(cycleGraph, QUERY);
    const reversed = computeImpact(reverseGraph(cycleGraph), QUERY);
    const duplicated = computeImpact(duplicateGraph(cycleGraph), QUERY);
    expect(canonicalStringify(reversed)).toEqual(canonicalStringify(forward));
    expect(canonicalStringify(duplicated)).toEqual(canonicalStringify(forward));
    // The cycle terminates and every reachable citer is reported once.
    expect(forward.rules.indirect.map((r) => r.ruleId)).toEqual([
      'RULE-CITE',
      'RULE-CITE2',
    ]);
  });
});
