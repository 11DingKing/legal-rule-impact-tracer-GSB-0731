import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalStringify } from '../common/canonical-json';
import { parseImportDocument } from '../imports/import-document';
import { computeImpact } from './impact';
import type { ImpactQuery, LawVersion, RevisionGraph } from './types';

const QUERY: ImpactQuery = {
  fromVersion: 'LAW-V1',
  toVersion: 'LAW-DRAFT-2',
  asOf: '2026-08-02T00:00:00.000Z',
};

function loadMaterial(name: string): RevisionGraph {
  const raw = readFileSync(join(__dirname, '..', '..', 'materials', name), 'utf8');
  return parseImportDocument(JSON.parse(raw) as unknown);
}

function mergeGraphs(...graphs: RevisionGraph[]): RevisionGraph {
  const versions = new Map<string, LawVersion>();
  for (const graph of graphs) {
    for (const version of graph.versions) {
      versions.set(version.id, version);
    }
  }
  return {
    versions: [...versions.values()],
    articles: graphs.flatMap((g) => g.articles),
    references: graphs.flatMap((g) => g.references),
    succession: graphs.flatMap((g) => g.succession),
    bindings: graphs.flatMap((g) => g.bindings),
  };
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

const GRAPH = mergeGraphs(
  loadMaterial('revision-graph.json'),
  loadMaterial('draft-2-revision.json'),
);

describe('computeImpact on the LAW-DRAFT-2 draft revision', () => {
  const result = computeImpact(GRAPH, QUERY);

  it('classifies split, merge, cycle, indirect and unaffected rules', () => {
    expect(result.rules.direct.map((r) => r.ruleId)).toEqual([
      'RULE-DRAFT-CYCLE-1',
      'RULE-DRAFT-CYCLE-2',
      'RULE-DRAFT-MERGE-BOTH',
      'RULE-DRAFT-SPLIT',
      'RULE-ELIGIBILITY-01',
    ]);
    expect(result.rules.indirect.map((r) => r.ruleId)).toEqual([
      'RULE-DRAFT-OBS',
      'RULE-SERVICE-02',
    ]);
    expect(result.rules.unaffected.map((r) => r.ruleId)).toEqual([
      'RULE-DRAFT-GONE',
      'RULE-DRAFT-SAFE',
    ]);
    expect(result.changedArticles.map((c) => c.stableId)).toEqual([
      'ART-A',
      'ART-C1',
      'ART-C2',
      'ART-M1',
      'ART-M2',
      'ART-S',
    ]);
    // ART-S is at once a split source and a merge target: both edge kinds appear.
    expect(result.changedArticles.find((c) => c.stableId === 'ART-S')?.succession).toEqual([
      { fromId: 'ART-S', toId: 'ART-S1', kind: 'SPLIT' },
      { fromId: 'ART-S', toId: 'ART-S2', kind: 'SPLIT' },
    ]);
    expect(result.unchangedArticles).toEqual(['ART-KEEP', 'ART-OBS']);
    expect(result.addedArticles).toEqual([]);
    // Draft stays distinct from published versions.
    expect(result.versionContext.to).toEqual({
      id: 'LAW-DRAFT-2',
      status: 'DRAFT',
      effectiveFrom: null,
      effectivenessAtAsOf: 'DRAFT',
    });
    expect(result.versionContext.from.effectivenessAtAsOf).toBe('EFFECTIVE');
  });

  it('stores one shortest witness and the equal-length witness count per affected rule', () => {
    const directMerge = result.rules.direct.find((r) => r.ruleId === 'RULE-DRAFT-MERGE-BOTH');
    // Two equal-length direct witnesses [ART-M1] and [ART-M2]; smallest wins.
    expect(directMerge?.witness?.nodes).toEqual(['ART-M1']);
    expect(directMerge?.witnessCount).toBe(2);

    const directSplit = result.rules.direct.find((r) => r.ruleId === 'RULE-DRAFT-SPLIT');
    expect(directSplit?.witness?.nodes).toEqual(['ART-S']);
    expect(directSplit?.witnessCount).toBe(1);

    // ART-OBS cites both cycle partners: two shortest witnesses of length 1.
    const obs = result.rules.indirect.find((r) => r.ruleId === 'RULE-DRAFT-OBS');
    expect(obs?.witness?.nodes).toEqual(['ART-C1', 'ART-OBS']);
    expect(obs?.witness?.edges).toEqual([
      { fromId: 'ART-C1', toId: 'ART-OBS', kind: 'REFERENCE_REVERSE' },
    ]);
    expect(obs?.witnessCount).toBe(2);

    const legacy = result.rules.indirect.find((r) => r.ruleId === 'RULE-SERVICE-02');
    expect(legacy?.witness?.nodes).toEqual(['ART-A', 'ART-B']);
    expect(legacy?.witnessCount).toBe(1);

    for (const safe of result.rules.unaffected) {
      expect(safe.witness).toBeNull();
      expect(safe.witnessCount).toBe(0);
    }

    // The complete path set for ART-OBS stays complete around the cycle:
    // both length-1 and both length-2 simple paths, deduplicated and sorted.
    const obsPaths = result.paths.filter((p) => p.ruleId === 'RULE-DRAFT-OBS');
    expect(obsPaths.map((p) => p.nodes.join('>'))).toEqual([
      'ART-C1>ART-C2>ART-OBS',
      'ART-C1>ART-OBS',
      'ART-C2>ART-C1>ART-OBS',
      'ART-C2>ART-OBS',
    ]);
  });

  it('reports the deliberately missing succession edge as a stable diagnostic', () => {
    expect(result.missingSuccession).toEqual([
      { stableId: 'ART-B', boundRuleIds: ['RULE-SERVICE-02'] },
      { stableId: 'ART-GONE', boundRuleIds: ['RULE-DRAFT-GONE'] },
    ]);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'MISSING_SUCCESSION',
      'MISSING_SUCCESSION',
    ]);
    expect(result.diagnostics.map((d) => d.stableId)).toEqual(['ART-B', 'ART-GONE']);
    expect(result.diagnostics[1]?.boundRuleIds).toEqual(['RULE-DRAFT-GONE']);
    expect(result.diagnostics[1]?.message).toContain('LAW-DRAFT-2');
    // The missing article is not a change source: its rule stays UNAFFECTED.
    expect(result.rules.direct.map((r) => r.ruleId)).not.toContain('RULE-DRAFT-GONE');
  });

  it('is byte-identical when the import record order is reversed', () => {
    const reversed = computeImpact(reverseGraph(GRAPH), QUERY);
    expect(canonicalStringify(reversed)).toEqual(canonicalStringify(result));
  });
});
