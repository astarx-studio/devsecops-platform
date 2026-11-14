import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';

import type { Model } from 'mongoose';

import { AppConfiguration } from '../config';
import { AuditLog } from '../projects/schemas/audit-log.schema';

import {
  EMAIL_ROUTING,
  IDENTITY,
  MAIL_SENDER,
  type EmailRoutingPort,
  type IdentityPort,
  type MailSenderPort,
} from './onboarding.ports';
import {
  companyOnboardingSearch,
  normalizeOnboardingInput,
  type NormalizedOnboarding,
  type OnboardingInput,
  type OnboardingState,
} from './onboarding.policy';
import {
  CompanyOnboarding,
  type CompanyOnboardingDocument,
} from './schemas/company-onboarding.schema';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectModel(CompanyOnboarding.name)
    private readonly records: Model<CompanyOnboarding>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLog>,
    private readonly config: ConfigService<AppConfiguration, true>,
    @Inject(EMAIL_ROUTING) private readonly routing: EmailRoutingPort,
    @Inject(MAIL_SENDER) private readonly mail: MailSenderPort,
    @Inject(IDENTITY) private readonly identity: IdentityPort,
  ) {}

  async list(limit = 50, query?: string): Promise<CompanyOnboardingDocument[]> {
    const capped = Math.min(Math.max(limit, 1), 100);
    const filter = companyOnboardingSearch(query);
    return this.records
      .find(filter ?? {})
      .sort({ updatedAt: -1 })
      .limit(capped)
      .exec();
  }

  async get(companyEmail: string): Promise<CompanyOnboardingDocument> {
    const doc = await this.records
      .findOne({ companyEmail: companyEmail.trim().toLowerCase() })
      .exec();
    if (!doc) {
      throw new NotFoundException('No onboarding record for that company email');
    }
    return doc;
  }

  async start(input: OnboardingInput): Promise<CompanyOnboardingDocument> {
    const normalized = this.normalize(input);
    let doc = await this.records.findOne({ companyEmail: normalized.companyEmail }).exec();

    if (!doc) {
      doc = await this.createRecord(normalized);
      await this.audit('onboarding.started', doc);
    } else if (doc.state === 'kc_actions_sent') {
      if (doc.personalEmail !== normalized.personalEmail) {
        throw new BadRequestException(
          'This company address is already invited. Offboard it before changing the personal address.',
        );
      }
      return doc;
    } else if (doc.state === 'offboarded') {
      doc.personalEmail = normalized.personalEmail;
      doc.firstName = normalized.firstName;
      doc.lastName = normalized.lastName;
      doc.state = 'awaiting_destination';
      doc.cloudflareRuleId = undefined;
      doc.mailgunLogin = undefined;
      doc.instructionsSent = false;
      doc.inviteSent = false;
      doc.lastError = undefined;
      await doc.save();
      await this.audit('onboarding.started', doc);
    } else {
      doc.personalEmail = normalized.personalEmail;
      doc.firstName = normalized.firstName;
      doc.lastName = normalized.lastName;
      await doc.save();
    }

    return this.advance(doc);
  }

  async resume(companyEmail: string): Promise<CompanyOnboardingDocument> {
    const doc = await this.get(companyEmail);
    if (doc.state === 'offboarded') {
      throw new BadRequestException('This company address was offboarded. Start it again.');
    }
    if (doc.state === 'kc_actions_sent') {
      return doc;
    }
    return this.advance(doc);
  }

  async offboard(companyEmail: string): Promise<CompanyOnboardingDocument> {
    const doc = await this.get(companyEmail);
    const errors: string[] = [];

    if (doc.cloudflareRuleId) {
      try {
        await this.routing.deleteRule(doc.cloudflareRuleId);
        doc.cloudflareRuleId = undefined;
      } catch (err) {
        errors.push(this.message(err));
      }
    }

    if (doc.mailgunLogin) {
      try {
        await this.mail.deleteCredential(doc.mailgunLogin);
        doc.mailgunLogin = undefined;
      } catch (err) {
        errors.push(this.message(err));
      }
    }

    try {
      await this.identity.disableUser(doc.companyEmail);
    } catch (err) {
      errors.push(this.message(err));
    }

    if (errors.length > 0) {
      doc.state = 'failed';
      doc.lastError = errors.join('; ').slice(0, 500);
      await doc.save();
      await this.audit('onboarding.failed', doc);
      throw new BadRequestException(doc.lastError);
    }

    doc.state = 'offboarded';
    doc.instructionsSent = false;
    doc.inviteSent = false;
    doc.lastError = undefined;
    await doc.save();
    await this.audit('onboarding.offboarded', doc);
    return doc;
  }

  private async advance(doc: CompanyOnboardingDocument): Promise<CompanyOnboardingDocument> {
    let destinationId = doc.cloudflareDestinationId;
    let verified = false;
    try {
      const destination = await this.routing.ensureDestination(doc.personalEmail);
      destinationId = destination.id;
      verified = destination.verified;
    } catch (err) {
      return this.markFailed(doc, err);
    }

    if (!verified) {
      const alreadyWaiting =
        doc.state === 'awaiting_destination' && doc.cloudflareDestinationId === destinationId;
      doc.state = 'awaiting_destination';
      doc.cloudflareDestinationId = destinationId;
      doc.lastError = undefined;
      await doc.save();
      if (!alreadyWaiting) {
        await this.audit('onboarding.destination_pending', doc);
      }
      return doc;
    }

    try {
      const rule = await this.routing.upsertForward(
        doc.companyEmail,
        doc.personalEmail,
        doc.cloudflareRuleId,
      );
      if (!rule.enabled) {
        throw new Error('Cloudflare routing rule was saved but is not enabled');
      }
      doc.cloudflareDestinationId = destinationId;
      doc.cloudflareRuleId = rule.id;
      doc.state = 'rule_enabled';
      doc.lastError = undefined;
      await doc.save();
    } catch (err) {
      return this.markFailed(doc, err);
    }

    if (!doc.instructionsSent) {
      try {
        if (doc.mailgunLogin) {
          await this.mail.deleteCredential(doc.mailgunLogin);
          doc.mailgunLogin = undefined;
          await doc.save();
        }
        const credential = await this.mail.createCredential(doc.companyEmail);
        doc.mailgunLogin = credential.login;
        await doc.save();
        await this.mail.sendInstructions({
          to: doc.personalEmail,
          firstName: doc.firstName,
          companyEmail: doc.companyEmail,
          login: credential.login,
          password: credential.password,
        });
        doc.instructionsSent = true;
        doc.state = 'instructions_sent';
        doc.lastError = undefined;
        await doc.save();
      } catch (err) {
        if (doc.mailgunLogin && !doc.instructionsSent) {
          await this.mail.deleteCredential(doc.mailgunLogin).catch(() => undefined);
          doc.mailgunLogin = undefined;
        }
        return this.markFailed(doc, err);
      }
    }

    if (!doc.inviteSent) {
      try {
        const user = await this.identity.ensureUser({
          companyEmail: doc.companyEmail,
          personalEmail: doc.personalEmail,
          firstName: doc.firstName,
          lastName: doc.lastName,
        });
        doc.keycloakUserId = user.id;
        await doc.save();
        await this.identity.sendInvite(user.id);
        doc.inviteSent = true;
        doc.state = 'kc_actions_sent';
        doc.lastError = undefined;
        await doc.save();
        await this.audit('onboarding.invited', doc);
      } catch (err) {
        return this.markFailed(doc, err);
      }
    }

    return doc;
  }

  private async createRecord(input: NormalizedOnboarding): Promise<CompanyOnboardingDocument> {
    try {
      return await this.records.create({
        ...input,
        state: 'awaiting_destination' satisfies OnboardingState,
        instructionsSent: false,
        inviteSent: false,
      });
    } catch (err) {
      if (this.isDuplicate(err)) {
        const existing = await this.records.findOne({ companyEmail: input.companyEmail }).exec();
        if (existing) {
          return existing;
        }
      }
      throw err;
    }
  }

  private normalize(input: OnboardingInput): NormalizedOnboarding {
    const domain =
      this.config.get('onboarding.mailgunDomain', { infer: true }) ??
      this.config.get('domain', { infer: true });
    if (!domain) {
      throw new BadRequestException('Company email domain is not configured');
    }
    return normalizeOnboardingInput(input, {
      domain,
      platformFromEmail: this.config.get('onboarding.smtpFromEmail', { infer: true }),
    });
  }

  private async markFailed(doc: CompanyOnboardingDocument, err: unknown): Promise<never> {
    doc.state = 'failed';
    doc.lastError = this.message(err).slice(0, 500);
    await doc.save();
    await this.audit('onboarding.failed', doc);
    throw new BadRequestException(doc.lastError);
  }

  private async audit(
    eventType:
      | 'onboarding.started'
      | 'onboarding.destination_pending'
      | 'onboarding.invited'
      | 'onboarding.failed'
      | 'onboarding.offboarded',
    doc: CompanyOnboardingDocument,
  ): Promise<void> {
    await this.auditLogModel.create({
      eventType,
      metadata: {
        companyEmail: doc.companyEmail,
        personalEmail: doc.personalEmail,
        state: doc.state,
        cloudflareDestinationId: doc.cloudflareDestinationId,
        cloudflareRuleId: doc.cloudflareRuleId,
        mailgunLogin: doc.mailgunLogin,
        keycloakUserId: doc.keycloakUserId,
      },
    });
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : 'Onboarding failed';
  }

  private isDuplicate(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
  }
}
