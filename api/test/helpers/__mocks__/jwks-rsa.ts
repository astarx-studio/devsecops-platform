export function passportJwtSecret() {
  return (_req: unknown, _rawJwtToken: unknown, done: (err: null, key: string) => void) => {
    done(null, 'mock-signing-key');
  };
}

export class JwksClient {
  getSigningKey() {
    return Promise.resolve({ getPublicKey: () => 'mock-public-key' });
  }
}
