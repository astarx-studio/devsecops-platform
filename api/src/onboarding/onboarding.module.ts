import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuditLog, AuditLogSchema } from '../projects/schemas/audit-log.schema';

import { CloudflareEmailClient } from './cloudflare-email.client';
import { KeycloakAdminClient } from './keycloak-admin.client';
import { MailgunClient } from './mailgun.client';
import { EMAIL_ROUTING, IDENTITY, MAIL_SENDER } from './onboarding.ports';
import { OnboardingResolver } from './onboarding.resolver';
import { OnboardingService } from './onboarding.service';
import { CompanyOnboarding, CompanyOnboardingSchema } from './schemas/company-onboarding.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CompanyOnboarding.name, schema: CompanyOnboardingSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  providers: [
    OnboardingService,
    OnboardingResolver,
    { provide: EMAIL_ROUTING, useClass: CloudflareEmailClient },
    { provide: MAIL_SENDER, useClass: MailgunClient },
    { provide: IDENTITY, useClass: KeycloakAdminClient },
  ],
})
export class OnboardingModule {}
