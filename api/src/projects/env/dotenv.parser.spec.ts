import { BadRequestException } from '@nestjs/common';

import { parseDotenvContent } from './dotenv.parser';

describe('parseDotenvContent', () => {
  it('parses simple key=value lines', () => {
    expect(parseDotenvContent('FOO=bar\nBAZ=qux')).toEqual({
      FOO: 'bar',
      BAZ: 'qux',
    });
  });

  it('skips comments and blank lines', () => {
    expect(parseDotenvContent('# comment\n\nKEY=val')).toEqual({ KEY: 'val' });
  });

  it('strips optional quotes', () => {
    expect(parseDotenvContent('A="x"\nB=\'y\'')).toEqual({ A: 'x', B: 'y' });
  });

  it('accepts arbitrary key prefixes (tech-agnostic)', () => {
    expect(parseDotenvContent('NX_API_URL=http://x\nCUSTOM_FOO=1')).toEqual({
      NX_API_URL: 'http://x',
      CUSTOM_FOO: '1',
    });
  });

  it('throws on invalid lines', () => {
    expect(() => parseDotenvContent('not-a-valid-line')).toThrow(BadRequestException);
  });
});
