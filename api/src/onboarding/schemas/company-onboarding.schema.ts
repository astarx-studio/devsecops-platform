import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import type { HydratedDocument } from 'mongoose';

import { ONBOARDING_STATES, type OnboardingState } from '../onboarding.policy';

export type CompanyOnboardingDocument = HydratedDocument<CompanyOnboarding>;

@Schema({
  timestamps: true,
  collection: 'company_onboardings',
})
export class CompanyOnboarding {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  companyEmail!: string;

  @Prop({ required: true, lowercase: true, trim: true })
  personalEmail!: string;

  @Prop({ required: true })
  firstName!: string;

  @Prop({ required: true })
  lastName!: string;

  @Prop({ required: true, type: String, enum: ONBOARDING_STATES })
  state!: OnboardingState;

  @Prop()
  cloudflareDestinationId?: string;

  @Prop()
  cloudflareRuleId?: string;

  /** Mailgun SMTP login. The password is never stored. */
  @Prop()
  mailgunLogin?: string;

  @Prop()
  keycloakUserId?: string;

  @Prop({ required: true, default: false })
  instructionsSent!: boolean;

  @Prop({ required: true, default: false })
  inviteSent!: boolean;

  @Prop()
  lastError?: string;

  updatedAt?: Date;
  createdAt?: Date;
}

export const CompanyOnboardingSchema = SchemaFactory.createForClass(CompanyOnboarding);
