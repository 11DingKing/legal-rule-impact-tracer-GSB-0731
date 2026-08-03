import { ArticleStableId } from '../models/branded-types';
import { EdgeKind } from '../models/enums';
import { ReadOnlyRevisionGraph } from '../models/revision-graph';

export interface GraphNeighbor {
  readonly id: ArticleStableId;
  readonly edgeKind: EdgeKind;
  readonly detail: string;
}

export function getOrderedNeighbors(
  graph: ReadOnlyRevisionGraph,
  articleId: ArticleStableId,
): readonly GraphNeighbor[] {
  const neighbors: GraphNeighbor[] = [];

  const successionEdges = graph.getSuccessionsFrom(articleId);
  for (const edge of successionEdges) {
    for (const toId of edge.toStableIds) {
      neighbors.push({
        id: toId,
        edgeKind: EdgeKind.SUCCESSION,
        detail: `${edge.kind}: ${articleId} -> ${toId}`,
      });
    }
  }

  const reverseRefs = graph.getReverseReferences(articleId);
  for (const refId of reverseRefs) {
    neighbors.push({
      id: refId,
      edgeKind: EdgeKind.CROSS_REFERENCE,
      detail: `${refId} references ${articleId}`,
    });
  }

  neighbors.sort((a, b) => {
    if (a.edgeKind !== b.edgeKind) {
      return a.edgeKind.localeCompare(b.edgeKind);
    }
    return a.id.localeCompare(b.id);
  });

  return neighbors;
}
