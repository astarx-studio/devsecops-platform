import { BadRequestException } from '@nestjs/common';

export const ONBOARDING_STATES = [
  'awaiting_destination',
  'rule_enabled',
  'instructions_sent',
  'kc_actions_sent',
  'failed',
  'offboarded',
] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];

const RESERVED_LOCAL_PARTS = new Set([
  'postmaster',
  'hostmaster',
  'abuse',
  'noreply',
  'no-reply',
  'admin',
  'root',
  'gitlab',
]);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface OnboardingInput {
  personalEmail: string;
  firstName: string;
  lastName: string;
  companyEmail: string;
}

export interface NormalizedOnboarding {
  personalEmail: string;
  firstName: string;
  lastName: string;
  companyEmail: string;
}

export const ONBOARDING_STATUS_LABEL: Record<OnboardingState, string> = {
  awaiting_destination: "Waiting for them to open Cloudflare's verification mail",
  rule_enabled: 'Forward is on. Setup mail has not been sent yet.',
  instructions_sent: 'Setup mail sent. The YADA invite has not been sent yet.',
  kc_actions_sent: 'Invite sent. They set their password from the YADA mail.',
  failed: 'Stopped with an error. Resume to continue.',
  offboarded: 'Forward, send login, and YADA account are removed.',
};

/** Keycloak username: the mailbox name, without @domain. */
export function companyUsername(companyEmail: string): string {
  const at = companyEmail.lastIndexOf('@');
  return (at === -1 ? companyEmail : companyEmail.slice(0, at)).trim().toLowerCase();
}

export function normalizeOnboardingInput(
  input: OnboardingInput,
  options: { domain: string; platformFromEmail?: string },
): NormalizedOnboarding {
  const personalEmail = input.personalEmail.trim().toLowerCase();
  const companyEmail = input.companyEmail.trim().toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const domain = options.domain.trim().toLowerCase();

  if (!firstName || !lastName) {
    throw new BadRequestException('First name and last name are required');
  }
  if (!EMAIL.test(personalEmail) || !EMAIL.test(companyEmail)) {
    throw new BadRequestException('Personal email and company email must be email addresses');
  }
  if (personalEmail === companyEmail) {
    throw new BadRequestException('Personal email and company email must be different');
  }

  const at = companyEmail.lastIndexOf('@');
  const localPart = companyEmail.slice(0, at);
  const emailDomain = companyEmail.slice(at + 1);
  if (emailDomain !== domain) {
    throw new BadRequestException(`Company email must be on ${domain}`);
  }

  const reserved = new Set(RESERVED_LOCAL_PARTS);
  const platformFrom = options.platformFromEmail?.trim().toLowerCase();
  if (platformFrom?.includes('@')) {
    reserved.add(platformFrom.slice(0, platformFrom.lastIndexOf('@')));
  }
  if (reserved.has(localPart)) {
    throw new BadRequestException(`Company address ${localPart}@${domain} is reserved`);
  }
  if (localPart.length < 3) {
    throw new BadRequestException('Username must be at least 3 characters');
  }
  if (!/^[a-z0-9][a-z0-9._+-]*$/.test(localPart)) {
    throw new BadRequestException('Company email local-part has unsupported characters');
  }

  return { personalEmail, firstName, lastName, companyEmail };
}

/** Case-insensitive match on name, company address, or personal inbox. */
export function companyOnboardingSearch(query?: string): Record<string, unknown> | undefined {
  const needle = query?.trim().slice(0, 80);
  if (!needle) return undefined;
  const pattern = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(pattern, 'i');
  return {
    $or: [
      { companyEmail: regex },
      { personalEmail: regex },
      { firstName: regex },
      { lastName: regex },
      {
        $expr: {
          $regexMatch: {
            input: { $concat: ['$firstName', ' ', '$lastName'] },
            regex: pattern,
            options: 'i',
          },
        },
      },
    ],
  };
}
