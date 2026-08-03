import { ArticleStableId } from './branded-types';
import { EdgeKind } from './enums';

export interface EdgeSequenceEntry {
  readonly edgeKind: EdgeKind;
  readonly fromId: ArticleStableId;
  readonly toId: ArticleStableId;
  readonly detail: string;
}

export interface EdgeSequence {
  readonly entries: readonly EdgeSequenceEntry[];
  readonly hash: string;
}
