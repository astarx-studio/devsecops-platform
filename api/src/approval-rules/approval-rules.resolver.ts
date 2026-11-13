import { UseGuards } from '@nestjs/common';
import {
  Args,
  Field,
  ID,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  registerEnumType,
  Resolver,
} from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { CombinedAuthGuard } from '../common/guards';

import { MAX_REQUIRED, MAX_RULES } from './approval-rules.policy';
import { ApprovalRulesService, type ApprovalRulesView } from './approval-rules.service';

export enum ApprovalRulesSource {
  console = 'console',
  file = 'file',
  none = 'none',
}

registerEnumType(ApprovalRulesSource, {
  name: 'ApprovalRulesSource',
  description: 'Where the approval rules GitLab currently enforces come from.',
});

@InputType()
export class ApprovalRuleInput {
  @Field()
  @IsString()
  @MaxLength(200)
  name!: string;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  @Max(MAX_REQUIRED)
  required!: number;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paths?: string[];

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  users?: string[];

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groups?: string[];
}

@InputType()
export class ApprovalRulesInput {
  @Field(() => [ApprovalRuleInput])
  @IsArray()
  @ArrayMaxSize(MAX_RULES)
  @ValidateNested({ each: true })
  @Type(() => ApprovalRuleInput)
  rules!: ApprovalRuleInput[];

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  authorCanApprove?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  committersCanApprove?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  resetOnPush?: boolean;
}

@ObjectType()
export class ApprovalRuleType {
  @Field()
  name!: string;

  @Field(() => Int)
  required!: number;

  @Field(() => [String])
  paths!: string[];

  @Field(() => [String])
  users!: string[];

  @Field(() => [String])
  groups!: string[];
}

@ObjectType()
export class ApprovalRulesType {
  @Field(() => ID)
  projectId!: string;

  @Field(() => ApprovalRulesSource)
  source!: ApprovalRulesSource;

  /** Console rules. Empty when the project has none (see `source`). */
  @Field(() => [ApprovalRuleType])
  rules!: ApprovalRuleType[];

  @Field()
  authorCanApprove!: boolean;

  @Field()
  committersCanApprove!: boolean;

  @Field()
  resetOnPush!: boolean;

  @Field({ nullable: true })
  updatedBy?: string;

  @Field({ nullable: true })
  updatedAt?: string;

  @Field({
    nullable: true,
    description:
      'Content of .gitlab/approvals.yml on the default branch (the fallback), if present.',
  })
  repositoryFile?: string;
}

function toGraphql(view: ApprovalRulesView): ApprovalRulesType {
  const config = view.config;
  return {
    projectId: view.projectId,
    source: view.source as ApprovalRulesSource,
    rules: (config?.rules ?? []).map((rule) => ({
      name: rule.name,
      required: rule.required,
      paths: rule.paths ?? [],
      users: rule.approvers?.users ?? [],
      groups: rule.approvers?.groups ?? [],
    })),
    authorCanApprove: config?.author_can_approve ?? false,
    committersCanApprove: config?.committers_can_approve ?? true,
    resetOnPush: config?.reset_on_push ?? true,
    updatedBy: view.updatedBy,
    updatedAt: view.updatedAt?.toISOString(),
    repositoryFile: view.repositoryFile,
  };
}

@Resolver()
@UseGuards(CombinedAuthGuard)
export class ApprovalRulesResolver {
  constructor(private readonly approvalRules: ApprovalRulesService) {}

  @Query(() => ApprovalRulesType)
  async projectApprovalRules(
    @Args('projectId', { type: () => ID }) projectId: string,
  ): Promise<ApprovalRulesType> {
    return toGraphql(await this.approvalRules.get(projectId));
  }

  @Mutation(() => ApprovalRulesType)
  async setProjectApprovalRules(
    @Args('projectId', { type: () => ID }) projectId: string,
    @Args('input') input: ApprovalRulesInput,
  ): Promise<ApprovalRulesType> {
    return toGraphql(await this.approvalRules.set(projectId, input));
  }

  @Mutation(() => ApprovalRulesType, {
    description:
      'Removes console rules; the project falls back to .gitlab/approvals.yml if it has one.',
  })
  async clearProjectApprovalRules(
    @Args('projectId', { type: () => ID }) projectId: string,
  ): Promise<ApprovalRulesType> {
    return toGraphql(await this.approvalRules.clear(projectId));
  }
}
