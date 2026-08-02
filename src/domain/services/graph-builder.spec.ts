import { GraphBuilder } from '../services/graph-builder';
import {
  ReferentialIntegrityError,
  ValidationError,
} from '../errors/domain-errors';
import {
  sampleGraphInput,
  vid,
  aid,
  rid,
} from '../testing/test-fixtures';
import { SuccessionKind, VersionStatus } from '../models/enums';

describe('GraphBuilder', () => {
  let builder: GraphBuilder;

  beforeEach(() => {
    builder = new GraphBuilder();
  });

  it('builds a valid graph from sample input', () => {
    const graph = builder.build(sampleGraphInput());
    expect(graph.versions).toHaveLength(2);
    expect(graph.articles).toHaveLength(4);
    expect(graph.successionEdges).toHaveLength(1);
    expect(graph.bindings).toHaveLength(2);
  });

  it('produces a deterministic fingerprint', () => {
    const graph1 = builder.build(sampleGraphInput());
    const graph2 = builder.build(sampleGraphInput());
    expect(graph1.fingerprint()).toBe(graph2.fingerprint());
  });

  it('deduplicates duplicate versions on build', () => {
    const input = sampleGraphInput();
    input.versions = [
      ...input.versions,
      { id: vid('LAW-V1'), status: VersionStatus.DRAFT, effectiveFrom: null },
    ];
    const graph = builder.build(input);
    expect(graph.versions).toHaveLength(2);
    const v1 = graph.getVersion(vid('LAW-V1'))!;
    expect(v1.status).toBe(VersionStatus.EFFECTIVE);
  });

  it('deduplicates duplicate articles', () => {
    const input = sampleGraphInput();
    input.articles = [
      ...input.articles,
      {
        stableId: aid('ART-A'),
        version: vid('LAW-V1'),
        label: '第十条',
        references: [],
      },
    ];
    const graph = builder.build(input);
    expect(graph.articles).toHaveLength(4);
  });

  it('throws on unknown version reference in article', () => {
    const input = sampleGraphInput();
    input.articles[0] = {
      ...input.articles[0],
      version: vid('UNKNOWN'),
    };
    expect(() => builder.build(input)).toThrow(
      ReferentialIntegrityError,
    );
  });

  it('throws on unknown cross-reference target', () => {
    const input = sampleGraphInput();
    input.articles[0] = {
      ...input.articles[0],
      references: [aid('ART-UNKNOWN')],
    };
    expect(() => builder.build(input)).toThrow(
      ReferentialIntegrityError,
    );
  });

  it('throws on unknown succession source', () => {
    const input = sampleGraphInput();
    input.succession.push({
      from: aid('ART-UNKNOWN'),
      to: [aid('ART-A1')],
      kind: SuccessionKind.REVISE,
    });
    expect(() => builder.build(input)).toThrow(
      ReferentialIntegrityError,
    );
  });

  it('throws on succession edge within same version', () => {
    const input = sampleGraphInput();
    input.succession.push({
      from: aid('ART-A'),
      to: [aid('ART-B')],
      kind: SuccessionKind.RENAME,
    });
    expect(() => builder.build(input)).toThrow(ValidationError);
  });

  it('throws on empty succession targets', () => {
    const input = sampleGraphInput();
    input.succession[0] = {
      from: aid('ART-A'),
      to: [],
      kind: SuccessionKind.SPLIT,
    };
    expect(() => builder.build(input)).toThrow(ValidationError);
  });

  it('throws on binding referencing unknown article', () => {
    const input = sampleGraphInput();
    input.bindings.push({
      ruleId: rid('RULE-BAD'),
      articleIds: [aid('ART-UNKNOWN')],
    });
    expect(() => builder.build(input)).toThrow(
      ReferentialIntegrityError,
    );
  });

  it('throws on invalid date format', () => {
    const input = sampleGraphInput();
    input.versions[0] = {
      ...input.versions[0],
      effectiveFrom: 'not-a-date',
    };
    expect(() => builder.build(input)).toThrow(ValidationError);
  });

  it('correctly indexes reverse references', () => {
    const graph = builder.build(sampleGraphInput());
    const reverseRefs = graph.getReverseReferences(aid('ART-A'));
    expect(reverseRefs).toContain(aid('ART-B'));
  });

  it('correctly indexes bindings by article and rule', () => {
    const graph = builder.build(sampleGraphInput());
    const bindings = graph.getBindingsForArticle(aid('ART-A'));
    expect(bindings).toHaveLength(1);
    expect(bindings[0].ruleId).toBe(rid('RULE-ELIGIBILITY-01'));

    const articles = graph.getArticlesBoundToRule(
      rid('RULE-SERVICE-02'),
    );
    expect(articles).toEqual([aid('ART-B')]);
  });
});
