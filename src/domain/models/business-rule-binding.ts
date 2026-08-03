import { ArticleStableId, RuleId } from './branded-types';

export interface BusinessRuleBinding {
  readonly ruleId: RuleId;
  readonly articleStableIds: readonly ArticleStableId[];
}
