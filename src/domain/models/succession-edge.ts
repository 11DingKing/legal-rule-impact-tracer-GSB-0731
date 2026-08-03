import { ArticleStableId } from './branded-types';
import { SuccessionKind } from './enums';

export interface SuccessionEdge {
  readonly fromStableId: ArticleStableId;
  readonly toStableIds: readonly ArticleStableId[];
  readonly kind: SuccessionKind;
}
