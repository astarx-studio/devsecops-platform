import { BadRequestException } from '@nestjs/common';

import {
  companyOnboardingSearch,
  companyUsername,
  normalizeOnboardingInput,
} from './onboarding.policy';

const options = {
  domain: 'yadatechnology.com',
  platformFromEmail: 'no-reply@yadatechnology.com',
};

describe('normalizeOnboardingInput', () => {
  it('lowercases both addresses', () => {
    const result = normalizeOnboardingInput(
      {
        personalEmail: 'Person@Gmail.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        companyEmail: 'Ada.Lovelace@Yadatechnology.com',
      },
      options,
    );
    expect(result.personalEmail).toBe('person@gmail.com');
    expect(result.companyEmail).toBe('ada.lovelace@yadatechnology.com');
    expect(companyUsername(result.companyEmail)).toBe('ada.lovelace');
  });

  it('builds a case-insensitive people search and ignores a blank query', () => {
    expect(companyOnboardingSearch('  ')).toBeUndefined();
    const filter = companyOnboardingSearch('a.a') as {
      $or: Array<{ companyEmail?: RegExp }>;
    };
    expect(filter.$or[0].companyEmail?.source).toBe('a\\.a');
    expect(filter.$or[0].companyEmail?.test('skara.alma@yadatechnology.com')).toBe(true);
  });

  it('rejects a username shorter than 3 characters', () => {
    expect(() =>
      normalizeOnboardingInput(
        {
          personalEmail: 'person@gmail.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          companyEmail: 'ab@yadatechnology.com',
        },
        options,
      ),
    ).toThrow(/at least 3/);
  });

  it('rejects the platform from address and other role accounts', () => {
    expect(() =>
      normalizeOnboardingInput(
        {
          personalEmail: 'person@gmail.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          companyEmail: 'no-reply@yadatechnology.com',
        },
        options,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeOnboardingInput(
        {
          personalEmail: 'person@gmail.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          companyEmail: 'admin@yadatechnology.com',
        },
        options,
      ),
    ).toThrow(/reserved/);
  });

  it('rejects a company address on another domain', () => {
    expect(() =>
      normalizeOnboardingInput(
        {
          personalEmail: 'person@gmail.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          companyEmail: 'ada@example.com',
        },
        options,
      ),
    ).toThrow(/yadatechnology.com/);
  });

  it('rejects using the personal address as the company address', () => {
    expect(() =>
      normalizeOnboardingInput(
        {
          personalEmail: 'ada@yadatechnology.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          companyEmail: 'ada@yadatechnology.com',
        },
        options,
      ),
    ).toThrow(/different/);
  });
});
