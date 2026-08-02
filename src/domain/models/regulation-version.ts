import { RegulationVersionId } from './branded-types';
import { VersionStatus } from './enums';

export interface RegulationVersion {
  readonly id: RegulationVersionId;
  readonly status: VersionStatus;
  readonly effectiveFrom: string | null;
}
