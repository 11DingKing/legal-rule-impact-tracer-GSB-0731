import { ArticleStableId } from './branded-types';
import { EdgeKind } from './enums';

export interface PathHop {
  readonly edgeKind: EdgeKind;
  readonly fromId: ArticleStableId;
  readonly toId: ArticleStableId;
  readonly detail: string;
}

export interface PropagationPath {
  readonly hops: readonly PathHop[];
  readonly targetId: ArticleStableId;
  readonly depth: number;
}
