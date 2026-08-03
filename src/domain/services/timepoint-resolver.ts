import { RegulationVersionId } from '../models/branded-types';
import { VersionStatus } from '../models/enums';
import {
  QueryTimepoint,
  VersionPhaseInfo,
} from '../models/query-timepoint';
import { QueryPhase } from '../models/query-phase';
import { ReadOnlyRevisionGraph } from '../models/revision-graph';

export class TimepointResolver {
  resolve(
    graph: ReadOnlyRevisionGraph,
    sourceVersionId: RegulationVersionId,
    targetVersionId: RegulationVersionId,
    asOf: string,
    backfillCount: number,
  ): QueryTimepoint {
    const sourceVersion = graph.getVersion(sourceVersionId);
    const targetVersion = graph.getVersion(targetVersionId);

    if (!sourceVersion) {
      throw new Error(`Source version not found: ${sourceVersionId}`);
    }
    if (!targetVersion) {
      throw new Error(`Target version not found: ${targetVersionId}`);
    }

    const sourceInfo = this.buildVersionInfo(sourceVersion, asOf);
    const targetInfo = this.buildVersionInfo(targetVersion, asOf);

    const phase = this.determinePhase(
      targetVersion.status,
      targetInfo.effectiveAtQuery,
      backfillCount,
    );

    return {
      asOf,
      phase,
      sourceVersion: sourceInfo,
      targetVersion: targetInfo,
      backfillCount,
    };
  }

  private buildVersionInfo(
    version: {
      readonly id: RegulationVersionId;
      readonly status: VersionStatus;
      readonly effectiveFrom: string | null;
    },
    asOf: string,
  ): VersionPhaseInfo {
    const effectiveAtQuery =
      version.effectiveFrom !== null &&
      asOf >= version.effectiveFrom;

    return {
      versionId: version.id,
      declaredStatus: version.status,
      effectiveFrom: version.effectiveFrom,
      effectiveAtQuery,
    };
  }

  private determinePhase(
    targetStatus: VersionStatus,
    targetEffective: boolean,
    backfillCount: number,
  ): QueryPhase {
    if (backfillCount > 0) {
      return QueryPhase.POST_BACKFILL;
    }
    if (targetStatus === VersionStatus.DRAFT) {
      return QueryPhase.DRAFT;
    }
    if (
      targetStatus === VersionStatus.PUBLISHED &&
      !targetEffective
    ) {
      return QueryPhase.PUBLISHED_NOT_EFFECTIVE;
    }
    return QueryPhase.EFFECTIVE;
  }
}
