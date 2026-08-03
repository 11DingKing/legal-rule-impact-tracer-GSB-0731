import {
  ArticleStableId,
  RegulationVersionId,
  RuleId,
} from '../models/branded-types';
import { ImpactLevel, SuccessionKind } from '../models/enums';
import {
  ArticleImpact,
  ImpactReport,
  MissingSuccession,
  RuleImpact,
  RuleWitness,
} from '../models/impact-report';
import { PropagationPath } from '../models/propagation-path';
import { ReadOnlyRevisionGraph } from '../models/revision-graph';
import { PathTracer, TraceSeed } from './path-tracer';
import { ShortestPathCalculator } from './shortest-path-calculator';
import { TimepointResolver } from './timepoint-resolver';
import { EdgeSequenceBuilder } from './edge-sequence-builder';

export interface AnalyzeOptions {
  readonly asOf?: string;
  readonly backfillCount?: number;
}

export class ImpactAnalyzer {
  private readonly pathTracer: PathTracer;
  private readonly shortestPathCalculator: ShortestPathCalculator;
  private readonly timepointResolver: TimepointResolver;
  private readonly edgeSequenceBuilder: EdgeSequenceBuilder;

  constructor(
    pathTracer?: PathTracer,
    shortestPathCalculator?: ShortestPathCalculator,
    timepointResolver?: TimepointResolver,
    edgeSequenceBuilder?: EdgeSequenceBuilder,
  ) {
    this.pathTracer = pathTracer ?? new PathTracer();
    this.shortestPathCalculator =
      shortestPathCalculator ?? new ShortestPathCalculator();
    this.timepointResolver =
      timepointResolver ?? new TimepointResolver();
    this.edgeSequenceBuilder =
      edgeSequenceBuilder ?? new EdgeSequenceBuilder();
  }

  analyze(
    graph: ReadOnlyRevisionGraph,
    sourceVersionId: RegulationVersionId,
    targetVersionId: RegulationVersionId,
    queriedAt: string,
    options?: AnalyzeOptions,
  ): ImpactReport {
    this.validateVersions(graph, sourceVersionId, targetVersionId);

    const asOf = options?.asOf ?? queriedAt;
    const backfillCount = options?.backfillCount ?? 0;

    const timepoint = this.timepointResolver.resolve(
      graph,
      sourceVersionId,
      targetVersionId,
      asOf,
      backfillCount,
    );

    const edgeSequence = this.edgeSequenceBuilder.build(graph);

    const { directIds, missingSuccessions } = this.identifyDirectImpacts(
      graph,
      sourceVersionId,
      targetVersionId,
    );

    const seeds: TraceSeed[] = [...directIds]
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({
        articleId: id,
        reason: 'directly revised via succession',
      }));

    const paths = this.pathTracer.trace(graph, seeds);
    const reachedIds = new Set<ArticleStableId>();
    for (const p of paths) {
      reachedIds.add(p.targetId);
    }
    for (const id of directIds) {
      reachedIds.add(id);
    }

    const indirectIds = new Set<ArticleStableId>();
    for (const p of paths) {
      if (p.depth > 0 && !directIds.has(p.targetId)) {
        indirectIds.add(p.targetId);
      }
    }

    const {
      directArticles,
      indirectArticles,
      unaffectedArticles,
    } = this.classifyArticles(
      graph,
      directIds,
      indirectIds,
    );

    const { directRules, indirectRules, unaffectedRules } =
      this.classifyRules(graph, directIds, indirectIds);

    const shortestPathMap = this.shortestPathCalculator.calculate(
      graph,
      [...directIds],
    );

    const ruleWitnesses = this.buildRuleWitnesses(
      graph,
      directRules,
      indirectRules,
      shortestPathMap,
    );

    const sortedPaths = this.ensurePathsIncludeSeeds(paths, directIds);

    return {
      sourceVersionId,
      targetVersionId,
      queriedAt,
      timepoint,
      graphFingerprint: graph.fingerprint(),
      edgeSequence,
      directArticles,
      indirectArticles,
      unaffectedArticles,
      directRules,
      indirectRules,
      unaffectedRules,
      ruleWitnesses,
      missingSuccessions,
      paths: sortedPaths,
    };
  }

  private validateVersions(
    graph: ReadOnlyRevisionGraph,
    sourceVersionId: RegulationVersionId,
    targetVersionId: RegulationVersionId,
  ): void {
    if (!graph.getVersion(sourceVersionId)) {
      throw new Error(`Source version not found: ${sourceVersionId}`);
    }
    if (!graph.getVersion(targetVersionId)) {
      throw new Error(`Target version not found: ${targetVersionId}`);
    }
    if (sourceVersionId === targetVersionId) {
      throw new Error(
        'Source and target versions must be different',
      );
    }
  }

  private identifyDirectImpacts(
    graph: ReadOnlyRevisionGraph,
    sourceVersionId: RegulationVersionId,
    targetVersionId: RegulationVersionId,
  ): {
    directIds: Set<ArticleStableId>;
    missingSuccessions: MissingSuccession[];
  } {
    const directIds = new Set<ArticleStableId>();
    const missing: MissingSuccession[] = [];

    const sourceArticles = graph.getArticlesByVersion(sourceVersionId);
    const targetArticleIds = new Set(
      graph.getArticlesByVersion(targetVersionId).map((a) => a.stableId),
    );

    for (const article of sourceArticles) {
      const edges = graph.getSuccessionsFrom(article.stableId);
      const relevantEdges = edges.filter((edge) =>
        edge.toStableIds.some((toId) => {
          const toArticle = graph.getArticle(toId);
          return (
            toArticle !== undefined &&
            toArticle.versionId === targetVersionId
          );
        }),
      );

      if (relevantEdges.length > 0) {
        directIds.add(article.stableId);
        for (const edge of relevantEdges) {
          for (const toId of edge.toStableIds) {
            const toArticle = graph.getArticle(toId);
            if (
              toArticle &&
              toArticle.versionId === targetVersionId
            ) {
              directIds.add(toId);
            }
          }
        }
      } else {
        if (!targetArticleIds.has(article.stableId)) {
          missing.push({
            stableId: article.stableId,
            label: article.label,
            versionId: article.versionId,
            reason:
              'Article exists in source version but has no explicit succession edge to target version',
          });
        }
      }
    }

    missing.sort((a, b) => a.stableId.localeCompare(b.stableId));
    return { directIds, missingSuccessions: missing };
  }

  private classifyArticles(
    graph: ReadOnlyRevisionGraph,
    directIds: ReadonlySet<ArticleStableId>,
    indirectIds: ReadonlySet<ArticleStableId>,
  ): {
    directArticles: ArticleImpact[];
    indirectArticles: ArticleImpact[];
    unaffectedArticles: ArticleImpact[];
  } {
    const directArticles: ArticleImpact[] = [];
    const indirectArticles: ArticleImpact[] = [];
    const unaffectedArticles: ArticleImpact[] = [];

    for (const article of graph.articles) {
      const impact: ArticleImpact = {
        stableId: article.stableId,
        label: article.label,
        versionId: article.versionId,
        level: ImpactLevel.UNAFFECTED,
      };
      if (directIds.has(article.stableId)) {
        directArticles.push({ ...impact, level: ImpactLevel.DIRECT });
      } else if (indirectIds.has(article.stableId)) {
        indirectArticles.push({
          ...impact,
          level: ImpactLevel.INDIRECT,
        });
      } else {
        unaffectedArticles.push(impact);
      }
    }

    return {
      directArticles,
      indirectArticles,
      unaffectedArticles,
    };
  }

  private classifyRules(
    graph: ReadOnlyRevisionGraph,
    directIds: ReadonlySet<ArticleStableId>,
    indirectIds: ReadonlySet<ArticleStableId>,
  ): {
    directRules: RuleImpact[];
    indirectRules: RuleImpact[];
    unaffectedRules: RuleImpact[];
  } {
    const directRules: RuleImpact[] = [];
    const indirectRules: RuleImpact[] = [];
    const unaffectedRules: RuleImpact[] = [];

    const allRuleIds = new Set<RuleId>();
    for (const binding of graph.bindings) {
      allRuleIds.add(binding.ruleId);
    }

    const sortedRuleIds = [...allRuleIds].sort((a, b) =>
      a.localeCompare(b),
    );

    for (const ruleId of sortedRuleIds) {
      const boundArticles = graph.getArticlesBoundToRule(ruleId);
      let hasDirect = false;
      let hasIndirect = false;
      for (const artId of boundArticles) {
        if (directIds.has(artId)) {
          hasDirect = true;
        } else if (indirectIds.has(artId)) {
          hasIndirect = true;
        }
      }

      const ruleImpact: RuleImpact = {
        ruleId,
        level: ImpactLevel.UNAFFECTED,
        boundArticleIds: boundArticles,
      };

      if (hasDirect) {
        directRules.push({ ...ruleImpact, level: ImpactLevel.DIRECT });
      } else if (hasIndirect) {
        indirectRules.push({
          ...ruleImpact,
          level: ImpactLevel.INDIRECT,
        });
      } else {
        unaffectedRules.push(ruleImpact);
      }
    }

    return { directRules, indirectRules, unaffectedRules };
  }

  private buildRuleWitnesses(
    graph: ReadOnlyRevisionGraph,
    directRules: readonly RuleImpact[],
    indirectRules: readonly RuleImpact[],
    shortestPathMap: ReadonlyMap<
      ArticleStableId,
      {
        readonly distance: number;
        readonly equalLengthPathCount: number;
        readonly witness: PropagationPath;
      }
    >,
  ): RuleWitness[] {
    const witnesses: RuleWitness[] = [];
    const affectedRules = [...directRules, ...indirectRules].sort((a, b) =>
      a.ruleId.localeCompare(b.ruleId),
    );

    for (const rule of affectedRules) {
      const boundArticles = graph.getArticlesBoundToRule(rule.ruleId);
      let minDistance = Number.POSITIVE_INFINITY;
      let totalCount = 0;
      let chosenWitness: PropagationPath | null = null;
      let chosenArticleId: ArticleStableId | null = null;

      const sortedBound = [...boundArticles].sort((a, b) =>
        a.localeCompare(b),
      );

      for (const artId of sortedBound) {
        const info = shortestPathMap.get(artId);
        if (!info) continue;

        if (info.distance < minDistance) {
          minDistance = info.distance;
          totalCount = info.equalLengthPathCount;
          chosenWitness = info.witness;
          chosenArticleId = artId;
        } else if (info.distance === minDistance) {
          totalCount += info.equalLengthPathCount;
          if (chosenArticleId === null) {
            chosenWitness = info.witness;
            chosenArticleId = artId;
          }
        }
      }

      if (chosenWitness && chosenArticleId !== null) {
        witnesses.push({
          ruleId: rule.ruleId,
          level: rule.level,
          shortestDistance: minDistance,
          equalLengthPathCount: totalCount,
          witness: chosenWitness,
        });
      }
    }

    return witnesses;
  }

  private ensurePathsIncludeSeeds(
    paths: readonly PropagationPath[],
    directIds: ReadonlySet<ArticleStableId>,
  ): PropagationPath[] {
    const result = new Map<string, PropagationPath>();
    for (const p of paths) {
      const key = this.pathKey(p);
      result.set(key, p);
    }
    for (const id of directIds) {
      const seedPath: PropagationPath = {
        hops: [],
        targetId: id,
        depth: 0,
      };
      const key = this.pathKey(seedPath);
      if (!result.has(key)) {
        result.set(key, seedPath);
      }
    }
    return [...result.values()].sort((a, b) => {
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      return this.pathKey(a).localeCompare(this.pathKey(b));
    });
  }

  private pathKey(path: PropagationPath): string {
    if (path.hops.length === 0) {
      return `seed:${path.targetId}`;
    }
    return path.hops
      .map((h) => `${h.edgeKind}:${h.fromId}->${h.toId}`)
      .join('|');
  }
}

export function successionKindLabel(kind: SuccessionKind): string {
  return kind;
}
