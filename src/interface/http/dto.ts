import type {
  RevisionGraphInput,
  SuccessionKind,
  VersionStatus,
} from '../../domain';

export class VersionDto {
  id!: string;
  status!: VersionStatus;
  effectiveFrom!: string | null;
}

export class ArticleDto {
  stableId!: string;
  version!: string;
  label!: string;
  references?: string[];
}

export class SuccessionDto {
  from!: string | string[];
  to!: string | string[];
  kind!: SuccessionKind;
}

export class BindingDto {
  ruleId!: string;
  articleIds!: string[];
}

export class ImportRequestDto implements RevisionGraphInput {
  versions!: VersionDto[];
  articles!: ArticleDto[];
  succession!: SuccessionDto[];
  bindings!: BindingDto[];
}

export class ImpactQueryDto {
  fromVersionId!: string;
  toVersionId!: string;
  queryAt?: string;
  includeDrafts?: boolean;
  maxPathLength?: number;
  maxPathsPerTarget?: number;
}
