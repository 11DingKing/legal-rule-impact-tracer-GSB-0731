import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppServicesModule } from './app-services.module';
import { GraphAssembler } from './graph.assembler';
import { ImportService } from './import.service';
import { ImpactService } from './impact.service';
import { computeImpact, type ImpactQuery, type ImpactResult, type RevisionGraphInput } from '../domain';
import { LAW_DRAFT_2_FIXTURE } from '../domain/fixtures/law-draft-2.fixture';

const QUERY: ImpactQuery = {
  fromVersionId: 'LAW-V1',
  toVersionId: 'LAW-DRAFT-2',
  queryAt: '2026-08-03T00:00:00.000Z',
};

function reverse(input: RevisionGraphInput): RevisionGraphInput {
  return {
    versions: [...input.versions].reverse(),
    articles: [...input.articles].reverse(),
    succession: [...input.succession].reverse(),
    bindings: [...input.bindings].reverse(),
  };
}

function duplicate(input: RevisionGraphInput): RevisionGraphInput {
  return {
    versions: [...input.versions, ...input.versions],
    articles: [...input.articles, ...input.articles],
    succession: [...input.succession, ...input.succession],
    bindings: [...input.bindings, ...input.bindings],
  };
}

function relevantFingerprint(r: ImpactResult): string {
  return JSON.stringify({
    directKeys: r.directKeys,
    indirectKeys: r.indirectKeys,
    missingSuccession: r.missingSuccession,
    affectedRules: r.rules
      .filter((x) => x.level !== 'UNAFFECTED')
      .map((x) => ({
        ruleId: x.ruleId,
        level: x.level,
        articleKeys: x.articleKeys,
        witness: x.shortestWitness,
        count: x.equalLengthWitnessCount,
      })),
  });
}

describe('LAW-DRAFT-2 through NestJS + SQLite stack', () => {
  let app: INestApplication;
  let importService: ImportService;
  let impactService: ImpactService;
  let assembler: GraphAssembler;

  beforeEach(async () => {
    process.env.DB_PATH = ':memory:';
    const mod = await Test.createTestingModule({
      imports: [AppServicesModule],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
    importService = mod.get(ImportService);
    impactService = mod.get(ImpactService);
    assembler = mod.get(GraphAssembler);
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports the deliberate missing ART-Z succession and classifies all five rules', () => {
    importService.import(LAW_DRAFT_2_FIXTURE);
    const { result } = impactService.queryImpact(QUERY);

    expect(result.missingSuccession).toEqual([
      {
        stableId: 'ART-Z',
        fromVersionId: 'LAW-V1',
        toVersionId: 'LAW-DRAFT-2',
        reason: 'ARTICLE_IN_FROM_VERSION_BUT_NO_SUCCESSION_TO_TARGET_VERSION',
      },
    ]);

    const levels = Object.fromEntries(
      result.rules.map((r) => [r.ruleId, r.level]),
    );
    expect(levels).toEqual({
      'RULE-DIRECT-SPLIT': 'DIRECT',
      'RULE-DIRECT-MERGE': 'DIRECT',
      'RULE-INDIRECT-C': 'INDIRECT',
      'RULE-CYCLE-G': 'DIRECT',
      'RULE-UNAFFECTED-D': 'UNAFFECTED',
    });

    const indirect = result.rules.find((r) => r.ruleId === 'RULE-INDIRECT-C');
    expect(indirect?.equalLengthWitnessCount).toBe(2);
    expect(indirect?.shortestWitness?.length).toBe(1);
  });

  it('re-importing in reverse order and as duplicates produces the byte-identical fingerprint', async () => {
    importService.import(LAW_DRAFT_2_FIXTURE);
    const first = impactService.queryImpact(QUERY).result;

    const [fresh1, fresh2, fresh3] = await Promise.all([
      buildFreshAppAndQuery(LAW_DRAFT_2_FIXTURE),
      buildFreshAppAndQuery(reverse(LAW_DRAFT_2_FIXTURE)),
      buildFreshAppAndQuery(duplicate(LAW_DRAFT_2_FIXTURE)),
    ]);

    const baseline = relevantFingerprint(first);
    expect(relevantFingerprint(fresh1)).toBe(baseline);
    expect(relevantFingerprint(fresh2)).toBe(baseline);
    expect(relevantFingerprint(fresh3)).toBe(baseline);
  });

  it('snapshot replay returns byte-identical result even after the graph is subsequently extended', () => {
    importService.import(LAW_DRAFT_2_FIXTURE);
    const { snapshot, result } = impactService.queryImpact(QUERY);
    const originalFingerprint = relevantFingerprint(result);

    importService.import({
      versions: [],
      articles: [
        { stableId: 'LATE-X', version: 'LAW-V1', label: 'x', references: ['LATE-Y'] },
        { stableId: 'LATE-Y', version: 'LAW-V1', label: 'y', references: ['LATE-X'] },
        { stableId: 'LATE-X', version: 'LAW-DRAFT-2', label: 'x2', references: ['LATE-Y'] },
        { stableId: 'LATE-Y', version: 'LAW-DRAFT-2', label: 'y2', references: ['LATE-X'] },
      ],
      succession: [],
      bindings: [],
    });

    const replayed = impactService.replaySnapshot(snapshot.id);
    expect(relevantFingerprint(replayed)).toBe(originalFingerprint);
  });

  it('GraphAssembler feeds rows into the pure domain graph without embedding propagation rules', () => {
    importService.import(LAW_DRAFT_2_FIXTURE);
    const graph = assembler.assemble();
    const domainOnly = computeImpact(graph, QUERY);
    const viaService = impactService.queryImpact(QUERY).result;
    expect(relevantFingerprint(domainOnly)).toBe(
      relevantFingerprint(viaService),
    );
  });
});

async function buildFreshAppAndQuery(
  input: RevisionGraphInput,
): Promise<ImpactResult> {
  const mod = await Test.createTestingModule({
    imports: [AppServicesModule],
  }).compile();
  process.env.DB_PATH = ':memory:';
  const a = mod.createNestApplication();
  await a.init();
  const imp = mod.get(ImportService);
  const svc = mod.get(ImpactService);
  imp.import(input);
  const { result } = svc.queryImpact(QUERY);
  await a.close();
  return result;
}
