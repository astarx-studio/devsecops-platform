import { UseGuards } from '@nestjs/common';
import {
  Args,
  Field,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  registerEnumType,
  Resolver,
} from '@nestjs/graphql';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

import { CombinedAuthGuard } from '../common/guards';

import { ONBOARDING_STATUS_LABEL } from './onboarding.policy';
import { OnboardingService } from './onboarding.service';
import type { CompanyOnboardingDocument } from './schemas/company-onboarding.schema';

export enum CompanyOnboardingState {
  awaiting_destination = 'awaiting_destination',
  rule_enabled = 'rule_enabled',
  instructions_sent = 'instructions_sent',
  kc_actions_sent = 'kc_actions_sent',
  failed = 'failed',
  offboarded = 'offboarded',
}

registerEnumType(CompanyOnboardingState, { name: 'CompanyOnboardingState' });

@InputType()
export class StartCompanyOnboardingInput {
  @Field()
  @IsEmail()
  personalEmail!: string;

  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @Field()
  @IsEmail()
  companyEmail!: string;
}

@ObjectType()
export class CompanyOnboardingType {
  @Field()
  companyEmail!: string;

  @Field()
  personalEmail!: string;

  @Field()
  firstName!: string;

  @Field()
  lastName!: string;

  @Field(() => CompanyOnboardingState)
  state!: CompanyOnboardingState;

  @Field()
  statusLabel!: string;

  @Field({ nullable: true })
  cloudflareDestinationId?: string;

  @Field({ nullable: true })
  cloudflareRuleId?: string;

  @Field({ nullable: true })
  mailgunLogin?: string;

  @Field({ nullable: true })
  keycloakUserId?: string;

  @Field({ nullable: true })
  lastError?: string;

  @Field()
  updatedAt!: string;
}

function toGraphql(doc: CompanyOnboardingDocument): CompanyOnboardingType {
  const state = doc.state;
  return {
    companyEmail: doc.companyEmail,
    personalEmail: doc.personalEmail,
    firstName: doc.firstName,
    lastName: doc.lastName,
    state: state as CompanyOnboardingState,
    statusLabel: ONBOARDING_STATUS_LABEL[state],
    cloudflareDestinationId: doc.cloudflareDestinationId,
    cloudflareRuleId: doc.cloudflareRuleId,
    mailgunLogin: doc.mailgunLogin,
    keycloakUserId: doc.keycloakUserId,
    lastError: doc.lastError,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : new Date(0).toISOString(),
  };
}

@Resolver()
@UseGuards(CombinedAuthGuard)
export class OnboardingResolver {
  constructor(private readonly onboarding: OnboardingService) {}

  @Query(() => [CompanyOnboardingType])
  async companyOnboardings(
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('query', { type: () => String, nullable: true }) query?: string,
  ): Promise<CompanyOnboardingType[]> {
    const rows = await this.onboarding.list(limit ?? 50, query);
    return rows.map(toGraphql);
  }

  @Query(() => CompanyOnboardingType)
  async companyOnboarding(
    @Args('companyEmail') companyEmail: string,
  ): Promise<CompanyOnboardingType> {
    return toGraphql(await this.onboarding.get(companyEmail));
  }

  @Mutation(() => CompanyOnboardingType)
  async startCompanyOnboarding(
    @Args('input') input: StartCompanyOnboardingInput,
  ): Promise<CompanyOnboardingType> {
    return toGraphql(await this.onboarding.start(input));
  }

  @Mutation(() => CompanyOnboardingType)
  async resumeCompanyOnboarding(
    @Args('companyEmail') companyEmail: string,
  ): Promise<CompanyOnboardingType> {
    return toGraphql(await this.onboarding.resume(companyEmail));
  }

  @Mutation(() => CompanyOnboardingType)
  async offboardCompanyEmail(
    @Args('companyEmail') companyEmail: string,
  ): Promise<CompanyOnboardingType> {
    return toGraphql(await this.onboarding.offboard(companyEmail));
  }
}
