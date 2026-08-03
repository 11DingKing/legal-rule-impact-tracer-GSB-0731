import { Injectable } from '@nestjs/common';
import {
  ArticleStableId,
  GraphBuilder,
  SuccessionKind,
} from '../../domain';
import { GraphRepository } from '../../infrastructure/persistence/repositories/graph.repository';
import { BackfillDto } from '../dto/backfill.dto';

@Injectable()
export class BackfillService {
  private readonly graphBuilder: GraphBuilder;

  constructor(private readonly graphRepo: GraphRepository) {
    this.graphBuilder = new GraphBuilder();
  }

  backfill(dto: BackfillDto): {
    added: boolean;
    backfillCount: number;
    graphFingerprint: string;
  } {
    const existing = this.graphRepo.loadGraphData();

    const candidate = {
      from: dto.from as ArticleStableId,
      to: [dto.to as ArticleStableId],
      kind: dto.kind as SuccessionKind,
    };

    const mergedSuccessions = [...existing.succession, candidate];
    const merged = {
      ...existing,
      succession: mergedSuccessions,
    };
    this.graphBuilder.build(merged);

    const result = this.graphRepo.backfillSuccession(
      dto.from,
      dto.to,
      dto.kind,
    );

    const afterData = this.graphRepo.loadGraphData();
    const afterGraph = this.graphBuilder.build(afterData);

    return {
      added: result.added,
      backfillCount: result.backfillCount,
      graphFingerprint: afterGraph.fingerprint(),
    };
  }
}
