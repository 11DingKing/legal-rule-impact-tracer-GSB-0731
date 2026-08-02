import { Injectable } from '@nestjs/common';
import {
  ArticleStableId,
  GraphBuilder,
  RegulationVersionId,
  RevisionGraphInput,
  RuleId,
  SuccessionKind,
  VersionStatus,
  VersionInput,
  ArticleInput,
  SuccessionInput,
  BindingInput,
} from '../../domain';
import { GraphRepository } from '../../infrastructure/persistence/repositories/graph.repository';
import {
  BindingDto,
  ArticleDto,
  SuccessionDto,
  VersionDto,
} from '../dto/import-graph.dto';

@Injectable()
export class ImportService {
  private readonly graphBuilder: GraphBuilder;

  constructor(private readonly graphRepo: GraphRepository) {
    this.graphBuilder = new GraphBuilder();
  }

  import(dto: {
    versions: VersionDto[];
    articles: ArticleDto[];
    succession: SuccessionDto[];
    bindings: BindingDto[];
  }): {
    versionsImported: number;
    articlesImported: number;
    successionsImported: number;
    bindingsImported: number;
    graphFingerprint: string;
  } {
    const newInput = this.toDomainInput(dto);
    const existing = this.graphRepo.loadGraphData();

    const merged = this.mergeInputs(existing, newInput);
    this.graphBuilder.build(merged);

    const result = this.graphRepo.importData(newInput);

    const graphData = this.graphRepo.loadGraphData();
    const graph = this.graphBuilder.build(graphData);

    return {
      ...result,
      graphFingerprint: graph.fingerprint(),
    };
  }

  private mergeInputs(
    existing: RevisionGraphInput,
    newData: RevisionGraphInput,
  ): RevisionGraphInput {
    const versionMap = new Map<string, VersionInput>();
    for (const v of existing.versions) {
      versionMap.set(v.id as string, v);
    }
    for (const v of newData.versions) {
      versionMap.set(v.id as string, v);
    }

    const articleMap = new Map<string, ArticleInput>();
    for (const a of existing.articles) {
      articleMap.set(a.stableId as string, a);
    }
    for (const a of newData.articles) {
      articleMap.set(a.stableId as string, a);
    }

    const successionSet = new Set<string>();
    const successions: SuccessionInput[] = [];
    for (const s of [...existing.succession, ...newData.succession]) {
      const key = `${s.from}|${[...s.to].sort().join(',')}|${s.kind}`;
      if (!successionSet.has(key)) {
        successionSet.add(key);
        successions.push(s);
      }
    }

    const bindingMap = new Map<string, BindingInput>();
    for (const b of existing.bindings) {
      bindingMap.set(b.ruleId as string, b);
    }
    for (const b of newData.bindings) {
      bindingMap.set(b.ruleId as string, b);
    }

    return {
      versions: [...versionMap.values()],
      articles: [...articleMap.values()],
      succession: successions,
      bindings: [...bindingMap.values()],
    };
  }

  private toDomainInput(dto: {
    versions: VersionDto[];
    articles: ArticleDto[];
    succession: SuccessionDto[];
    bindings: BindingDto[];
  }): RevisionGraphInput {
    return {
      versions: dto.versions.map((v) => ({
        id: v.id as RegulationVersionId,
        status: v.status as VersionStatus,
        effectiveFrom: v.effectiveFrom ?? null,
      })),
      articles: dto.articles.map((a) => ({
        stableId: a.stableId as ArticleStableId,
        version: a.version as RegulationVersionId,
        label: a.label,
        references: (a.references ?? []).map(
          (r) => r as ArticleStableId,
        ),
      })),
      succession: dto.succession.map((s) => ({
        from: s.from as ArticleStableId,
        to: s.to.map((t) => t as ArticleStableId),
        kind: s.kind as SuccessionKind,
      })),
      bindings: dto.bindings.map((b) => ({
        ruleId: b.ruleId as RuleId,
        articleIds: b.articleIds.map((a) => a as ArticleStableId),
      })),
    };
  }
}
