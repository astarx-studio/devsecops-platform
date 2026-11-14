import { BadRequestException } from '@nestjs/common';

/* Jest mocks are function values. The unbound-method rule treats them as class methods. */
/* eslint-disable @typescript-eslint/unbound-method */

import type { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';

import type { AppConfiguration } from '../config';
import type { AuditLog } from '../projects/schemas/audit-log.schema';

import type {
  EmailRoutingPort,
  IdentityInput,
  IdentityPort,
  InstructionMail,
  MailSenderPort,
} from './onboarding.ports';
import { OnboardingService } from './onboarding.service';
import type { CompanyOnboarding } from './schemas/company-onboarding.schema';

interface FakeDoc {
  companyEmail: string;
  personalEmail: string;
  firstName: string;
  lastName: string;
  state: string;
  cloudflareDestinationId?: string;
  cloudflareRuleId?: string;
  mailgunLogin?: string;
  keycloakUserId?: string;
  instructionsSent: boolean;
  inviteSent: boolean;
  lastError?: string;
  save: () => Promise<FakeDoc>;
}

class MemoryStore {
  rows = new Map<string, FakeDoc>();

  findOne(query: { companyEmail: string }) {
    return { exec: async () => this.rows.get(query.companyEmail) ?? null };
  }

  async create(data: Partial<FakeDoc>): Promise<FakeDoc> {
    const doc: FakeDoc = {
      companyEmail: data.companyEmail ?? '',
      personalEmail: data.personalEmail ?? '',
      firstName: data.firstName ?? '',
      lastName: data.lastName ?? '',
      state: data.state ?? 'awaiting_destination',
      cloudflareDestinationId: data.cloudflareDestinationId,
      cloudflareRuleId: data.cloudflareRuleId,
      mailgunLogin: data.mailgunLogin,
      keycloakUserId: data.keycloakUserId,
      instructionsSent: data.instructionsSent ?? false,
      inviteSent: data.inviteSent ?? false,
      lastError: data.lastError,
      save: async () => {
        this.rows.set(doc.companyEmail, doc);
        return doc;
      },
    };
    this.rows.set(doc.companyEmail, doc);
    return doc;
  }

  find() {
    const chain = {
      sort: () => chain,
      limit: () => chain,
      exec: async () => [...this.rows.values()],
    };
    return chain;
  }
}

const input = {
  personalEmail: 'person@gmail.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  companyEmail: 'ada@yadatechnology.com',
};

describe('OnboardingService', () => {
  let store: MemoryStore;
  let routing: jest.Mocked<EmailRoutingPort>;
  let mail: jest.Mocked<MailSenderPort>;
  let identity: jest.Mocked<IdentityPort>;
  let service: OnboardingService;

  beforeEach(() => {
    store = new MemoryStore();
    routing = {
      ensureDestination: jest.fn(),
      upsertForward: jest.fn(),
      deleteRule: jest.fn(),
    };
    mail = {
      createCredential: jest.fn(async (login: string) => ({
        login,
        password: 'generated-smtp-secret',
      })),
      deleteCredential: jest.fn(async (_login: string) => undefined),
      sendInstructions: jest.fn(async (_mail: InstructionMail) => undefined),
    };
    identity = {
      ensureUser: jest.fn(async (_input: IdentityInput) => ({ id: 'kc-user-1' })),
      sendInvite: jest.fn(async (_userId: string) => undefined),
      disableUser: jest.fn(async (_companyEmail: string) => undefined),
    };
    const config = {
      get: (key: string) => {
        const values: Record<string, string> = {
          'onboarding.mailgunDomain': 'yadatechnology.com',
          'onboarding.smtpFromEmail': 'no-reply@yadatechnology.com',
          domain: 'yadatechnology.com',
        };
        return values[key];
      },
    };
    service = new OnboardingService(
      store as unknown as Model<CompanyOnboarding>,
      { create: jest.fn(async () => undefined) } as unknown as Model<AuditLog>,
      config as unknown as ConfigService<AppConfiguration, true>,
      routing,
      mail,
      identity,
    );
  });

  it('stops at awaiting_destination and does not create a user when Cloudflare has not verified', async () => {
    routing.ensureDestination.mockResolvedValue({ id: 'dest-1', verified: false });

    const result = await service.start(input);

    expect(result.state).toBe('awaiting_destination');
    expect(result.cloudflareDestinationId).toBe('dest-1');
    expect(mail.createCredential).not.toHaveBeenCalled();
    expect(identity.ensureUser).not.toHaveBeenCalled();
    expect(identity.sendInvite).not.toHaveBeenCalled();
  });

  it('resumes a verified destination through mail and the YADA invite once', async () => {
    routing.ensureDestination.mockResolvedValueOnce({ id: 'dest-1', verified: false });
    await service.start(input);

    routing.ensureDestination.mockResolvedValue({ id: 'dest-1', verified: true });
    routing.upsertForward.mockResolvedValue({ id: 'rule-1', enabled: true });

    const done = await service.resume(input.companyEmail);

    expect(done.state).toBe('kc_actions_sent');
    expect(done.cloudflareRuleId).toBe('rule-1');
    expect(done.mailgunLogin).toBe('ada@yadatechnology.com');
    expect(done.keycloakUserId).toBe('kc-user-1');
    expect(mail.sendInstructions).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'person@gmail.com',
        password: 'generated-smtp-secret',
        login: 'ada@yadatechnology.com',
      }),
    );
    expect(identity.sendInvite).toHaveBeenCalledWith('kc-user-1');

    await service.start(input);

    expect(mail.createCredential).toHaveBeenCalledTimes(1);
    expect(identity.ensureUser).toHaveBeenCalledTimes(1);
    expect(identity.sendInvite).toHaveBeenCalledTimes(1);
    expect(routing.upsertForward).toHaveBeenCalledTimes(1);
  });

  it('rotates the Mailgun credential when the setup mail was never sent', async () => {
    routing.ensureDestination.mockResolvedValue({ id: 'dest-1', verified: true });
    routing.upsertForward.mockResolvedValue({ id: 'rule-1', enabled: true });
    mail.sendInstructions.mockRejectedValueOnce(new Error('Mailgun send failed'));

    await expect(service.start(input)).rejects.toBeInstanceOf(BadRequestException);

    const failed = store.rows.get('ada@yadatechnology.com');
    expect(failed?.state).toBe('failed');
    expect(failed?.mailgunLogin).toBeUndefined();
    expect(failed?.instructionsSent).toBe(false);
    expect(identity.ensureUser).not.toHaveBeenCalled();
    expect(mail.deleteCredential).toHaveBeenCalledWith('ada@yadatechnology.com');

    mail.sendInstructions.mockResolvedValue(undefined);
    const done = await service.resume(input.companyEmail);

    expect(done.state).toBe('kc_actions_sent');
    expect(mail.createCredential).toHaveBeenCalledTimes(2);
    expect(identity.ensureUser).toHaveBeenCalledTimes(1);
  });

  it('deletes a saved credential before sending again after a crash', async () => {
    const existing = await store.create({
      companyEmail: 'ada@yadatechnology.com',
      personalEmail: 'person@gmail.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      state: 'rule_enabled',
      cloudflareDestinationId: 'dest-1',
      cloudflareRuleId: 'rule-1',
      mailgunLogin: 'ada@yadatechnology.com',
      instructionsSent: false,
      inviteSent: false,
    });
    void existing;
    routing.ensureDestination.mockResolvedValue({ id: 'dest-1', verified: true });
    routing.upsertForward.mockResolvedValue({ id: 'rule-1', enabled: true });

    const done = await service.resume(input.companyEmail);

    expect(mail.deleteCredential).toHaveBeenCalledWith('ada@yadatechnology.com');
    expect(mail.createCredential).toHaveBeenCalledTimes(1);
    expect(done.state).toBe('kc_actions_sent');
    expect(done.instructionsSent).toBe(true);
  });

  it('offboards the rule, the send login, and the YADA user', async () => {
    routing.ensureDestination.mockResolvedValue({ id: 'dest-1', verified: true });
    routing.upsertForward.mockResolvedValue({ id: 'rule-1', enabled: true });
    await service.start(input);

    const removed = await service.offboard(input.companyEmail);

    expect(removed.state).toBe('offboarded');
    expect(routing.deleteRule).toHaveBeenCalledWith('rule-1');
    expect(mail.deleteCredential).toHaveBeenCalledWith('ada@yadatechnology.com');
    expect(identity.disableUser).toHaveBeenCalledWith('ada@yadatechnology.com');
    expect(removed.cloudflareRuleId).toBeUndefined();
    expect(removed.mailgunLogin).toBeUndefined();
  });
});
