import {
  buildGraph,
  computeImpact,
  type ArticleInput,
  type BindingInput,
  type ImpactQuery,
  type ImpactResult,
  type RevisionGraphInput,
  type SuccessionInput,
  type VersionInput,
} from './index';
import { LAW_DRAFT_2_FIXTURE } from './fixtures/law-draft-2.fixture';

const QUERY: ImpactQuery = {
  fromVersionId: 'LAW-V1',
  toVersionId: 'LAW-DRAFT-2',
  queryAt: '2026-08-03T00:00:00.000Z',
};

function reverseInput(input: RevisionGraphInput): RevisionGraphInput {
  return {
    versions: [...input.versions].reverse() as VersionInput[],
    articles: [...input.articles].reverse() as ArticleInput[],
    succession: [...input.succession].reverse() as SuccessionInput[],
    bindings: [...input.bindings].reverse() as BindingInput[],
  };
}

function duplicateInput(input: RevisionGraphInput): RevisionGraphInput {
  return {
    versions: [...input.versions, ...input.versions],
    articles: [...input.articles, ...input.articles],
    succession: [...input.succession, ...input.succession],
    bindings: [...input.bindings, ...input.bindings],
  };
}

function run(input: RevisionGraphInput): ImpactResult {
  const g = buildGraph(
    input.versions,
    input.articles,
    input.succession,
    input.bindings,
  );
  return computeImpact(g, QUERY);
}

function canonical(result: ImpactResult): string {
  return JSON.stringify({
    directKeys: result.directKeys,
    indirectKeys: result.indirectKeys,
    missingSuccession: result.missingSuccession,
    danglingReferences: result.danglingReferences,
    affectedRules: result.rules
      .filter((r) => r.level !== 'UNAFFECTED')
      .map((r) => ({
        ruleId: r.ruleId,
        level: r.level,
        articleKeys: r.articleKeys,
        shortestWitness: r.shortestWitness,
        equalLengthWitnessCount: r.equalLengthWitnessCount,
      })),
    affectedArticles: result.articles
      .filter((a) => a.level !== 'UNAFFECTED')
      .map((a) => ({
        key: a.key,
        level: a.level,
        shortestWitness: a.shortestWitness,
        equalLengthWitnessCount: a.equalLengthWitnessCount,
      })),
  });
}

describe('LAW-DRAFT-2 revision draft', () => {
  it('classifies direct / indirect / unaffected rules correctly', () => {
    const result = run(LAW_DRAFT_2_FIXTURE);
    const byId = new Map(result.rules.map((r) => [r.ruleId, r]));

    expect(byId.get('RULE-DIRECT-SPLIT')?.level).toBe('DIRECT');
    expect(byId.get('RULE-DIRECT-MERGE')?.level).toBe('DIRECT');
    expect(byId.get('RULE-INDIRECT-C')?.level).toBe('INDIRECT');
    expect(byId.get('RULE-CYCLE-G')?.level).toBe('DIRECT');
    expect(byId.get('RULE-UNAFFECTED-D')?.level).toBe('UNAFFECTED');

    expect(result.directKeys).toEqual(
      expect.arrayContaining([
        'ART-A@LAW-V1',
        'ART-A1@LAW-DRAFT-2',
        'ART-A2@LAW-DRAFT-2',
        'ART-E@LAW-V1',
        'ART-F@LAW-V1',
        'ART-M@LAW-DRAFT-2',
        'ART-G@LAW-V1',
        'ART-G2@LAW-DRAFT-2',
        'ART-B@LAW-V1',
        'ART-B@LAW-DRAFT-2',
      ]),
    );
    expect(result.indirectKeys).toEqual(
      expect.arrayContaining([
        'ART-C@LAW-DRAFT-2',
        'ART-H@LAW-V1',
        'ART-H@LAW-DRAFT-2',
        'ART-M@LAW-V2',
      ]),
    );
    expect(result.unaffectedKeys).toEqual(
      expect.arrayContaining([
        'ART-C@LAW-V1',
        'ART-D@LAW-V1',
        'ART-D@LAW-DRAFT-2',
        'ART-Z@LAW-V1',
      ]),
    );
  });

  it('saves one shortest witness and the total equal-length witness count per affected rule', () => {
    const result = run(LAW_DRAFT_2_FIXTURE);
    const c = result.rules.find((r) => r.ruleId === 'RULE-INDIRECT-C');
    expect(c).toBeTruthy();
    expect(c?.shortestWitness).not.toBeNull();
    expect(c?.shortestWitness?.length).toBe(1);
    expect(c?.equalLengthWitnessCount).toBe(2);

    const split = result.rules.find((r) => r.ruleId === 'RULE-DIRECT-SPLIT');
    expect(split?.shortestWitness?.nodes[0]).toBe('ART-A1@LAW-DRAFT-2');
    expect(split?.equalLengthWitnessCount).toBe(1);

    const unaffected = result.rules.find(
      (r) => r.ruleId === 'RULE-UNAFFECTED-D',
    );
    expect(unaffected?.shortestWitness).toBeNull();
    expect(unaffected?.equalLengthWitnessCount).toBe(0);
  });

  it('reports the deliberately missing succession edge for ART-Z with a stable diagnostic', () => {
    const result = run(LAW_DRAFT_2_FIXTURE);
    expect(result.missingSuccession).toEqual([
      {
        stableId: 'ART-Z',
        fromVersionId: 'LAW-V1',
        toVersionId: 'LAW-DRAFT-2',
        reason: 'ARTICLE_IN_FROM_VERSION_BUT_NO_SUCCESSION_TO_TARGET_VERSION',
      },
    ]);
    expect(result.directKeys).not.toContain('ART-Z@LAW-V1');
  });

  it('treats the G<->H reference cycle without infinite traversal and keeps both endpoints impacted', () => {
    const result = run(LAW_DRAFT_2_FIXTURE);
    expect(result.directKeys).toEqual(
      expect.arrayContaining(['ART-G@LAW-V1', 'ART-G2@LAW-DRAFT-2']),
    );
    expect(result.indirectKeys).toEqual(
      expect.arrayContaining(['ART-H@LAW-V1', 'ART-H@LAW-DRAFT-2']),
    );
    const h1 = result.articles.find((a) => a.key === 'ART-H@LAW-V1');
    expect(h1?.shortestWitness).not.toBeNull();
    expect(h1?.level).toBe('INDIRECT');
  });

  it('is byte-for-byte identical when records are imported in reverse order', () => {
    const a = canonical(run(LAW_DRAFT_2_FIXTURE));
    const b = canonical(run(reverseInput(LAW_DRAFT_2_FIXTURE)));
    expect(b).toBe(a);
  });

  it('is byte-for-byte identical when the import is duplicated', () => {
    const a = canonical(run(LAW_DRAFT_2_FIXTURE));
    const b = canonical(run(duplicateInput(LAW_DRAFT_2_FIXTURE)));
    expect(b).toBe(a);
  });

  it('is byte-for-byte identical for the base graph versus the graph plus an isolated cyclic subgraph', () => {
    const withExtraCycle: RevisionGraphInput = {
      versions: LAW_DRAFT_2_FIXTURE.versions,
      articles: [
        ...LAW_DRAFT_2_FIXTURE.articles,
        {
          stableId: 'CYC-X',
          version: 'LAW-V1',
          label: 'x',
          references: ['CYC-Y'],
        },
        {
          stableId: 'CYC-Y',
          version: 'LAW-V1',
          label: 'y',
          references: ['CYC-X'],
        },
        {
          stableId: 'CYC-X',
          version: 'LAW-DRAFT-2',
          label: 'x2',
          references: ['CYC-Y'],
        },
        {
          stableId: 'CYC-Y',
          version: 'LAW-DRAFT-2',
          label: 'y2',
          references: ['CYC-X'],
        },
      ],
      succession: LAW_DRAFT_2_FIXTURE.succession,
      bindings: LAW_DRAFT_2_FIXTURE.bindings,
    };
    const a = canonical(run(LAW_DRAFT_2_FIXTURE));
    const b = canonical(run(withExtraCycle));
    expect(b).toBe(a);
  });

  it('equal-length witness counts do not change when import order is reversed', () => {
    const a = run(LAW_DRAFT_2_FIXTURE);
    const b = run(reverseInput(LAW_DRAFT_2_FIXTURE));
    for (const ra of a.rules) {
      const rb = b.rules.find((x) => x.ruleId === ra.ruleId);
      expect(rb?.equalLengthWitnessCount).toBe(ra.equalLengthWitnessCount);
      expect(JSON.stringify(rb?.shortestWitness)).toBe(
        JSON.stringify(ra.shortestWitness),
      );
    }
  });
});
