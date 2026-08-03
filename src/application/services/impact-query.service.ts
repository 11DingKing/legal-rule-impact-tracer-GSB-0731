import { Injectable } from '@nestjs/common';
import {
  GraphBuilder,
  ImpactAnalyzer,
  ImpactReport,
  ImpactSnapshot,
  RegulationVersionId,
  SnapshotFactory,
} from '../../domain';
import { GraphRepository } from '../../infrastructure/persistence/repositories/graph.repository';
import { SnapshotRepository } from '../../infrastructure/persistence/repositories/snapshot.repository';

@Injectable()
export class ImpactQueryService {
  private readonly graphBuilder: GraphBuilder;
  private readonly impactAnalyzer: ImpactAnalyzer;
  private readonly snapshotFactory: SnapshotFactory;

  constructor(
    private readonly graphRepo: GraphRepository,
    private readonly snapshotRepo: SnapshotRepository,
  ) {
    this.graphBuilder = new GraphBuilder();
    this.impactAnalyzer = new ImpactAnalyzer();
    this.snapshotFactory = new SnapshotFactory();
  }

  query(
    sourceVersionId: string,
    targetVersionId: string,
    asOf?: string,
  ): ImpactSnapshot {
    const graphData = this.graphRepo.loadGraphData();
    const graph = this.graphBuilder.build(graphData);

    const queriedAt = new Date().toISOString();
    const backfillCount = this.graphRepo.countBackfills();

    const report: ImpactReport = this.impactAnalyzer.analyze(
      graph,
      sourceVersionId as RegulationVersionId,
      targetVersionId as RegulationVersionId,
      queriedAt,
      {
        asOf: asOf ?? queriedAt,
        backfillCount,
      },
    );

    const snapshot = this.snapshotFactory.create(report);
    this.snapshotRepo.save(snapshot);

    return snapshot;
  }
}
