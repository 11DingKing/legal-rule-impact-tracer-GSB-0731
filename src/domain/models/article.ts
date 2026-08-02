import { ArticleStableId, RegulationVersionId } from './branded-types';

export interface Article {
  readonly stableId: ArticleStableId;
  readonly versionId: RegulationVersionId;
  readonly label: string;
  readonly references: readonly ArticleStableId[];
}
