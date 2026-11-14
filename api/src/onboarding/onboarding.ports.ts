/** Vendor ports. The state machine depends on these, not on HTTP clients. */

export interface DestinationStatus {
  id: string;
  verified: boolean;
}

export interface ForwardRule {
  id: string;
  enabled: boolean;
}

export interface EmailRoutingPort {
  ensureDestination(personalEmail: string): Promise<DestinationStatus>;
  upsertForward(
    companyEmail: string,
    personalEmail: string,
    existingRuleId?: string,
  ): Promise<ForwardRule>;
  deleteRule(ruleId: string): Promise<void>;
}

export interface SmtpCredential {
  login: string;
  password: string;
}

export interface InstructionMail {
  to: string;
  firstName: string;
  companyEmail: string;
  login: string;
  password: string;
}

export interface MailSenderPort {
  createCredential(login: string): Promise<SmtpCredential>;
  deleteCredential(login: string): Promise<void>;
  sendInstructions(mail: InstructionMail): Promise<void>;
}

export interface IdentityInput {
  companyEmail: string;
  personalEmail: string;
  firstName: string;
  lastName: string;
}

export interface IdentityPort {
  /** Find or create the devops user. Enables a previously disabled user. */
  ensureUser(input: IdentityInput): Promise<{ id: string }>;
  sendInvite(userId: string): Promise<void>;
  /** No-op when the company address has no user. */
  disableUser(companyEmail: string): Promise<void>;
}

export const EMAIL_ROUTING = Symbol('EMAIL_ROUTING');
export const MAIL_SENDER = Symbol('MAIL_SENDER');
export const IDENTITY = Symbol('IDENTITY');
