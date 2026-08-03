import { RegulationVersionId } from './branded-types';
import { VersionStatus } from './enums';
import { QueryPhase } from './query-phase';

export interface VersionPhaseInfo {
  readonly versionId: RegulationVersionId;
  readonly declaredStatus: VersionStatus;
  readonly effectiveFrom: string | null;
  readonly effectiveAtQuery: boolean;
}

export interface QueryTimepoint {
  readonly asOf: string;
  readonly phase: QueryPhase;
  readonly sourceVersion: VersionPhaseInfo;
  readonly targetVersion: VersionPhaseInfo;
  readonly backfillCount: number;
}
