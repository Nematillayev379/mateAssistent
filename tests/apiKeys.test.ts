jest.mock('../src/services/database', () => ({
  DBService: {
    getUserApiKeys: jest.fn(),
    addApiKey: jest.fn(),
    removeApiKeyById: jest.fn(),
  },
}));

import { ApiKeyService } from '../src/services/apiKeys';

describe('ApiKeyService', () => {
  it('should mask key - show first 6 and last 4 chars', () => {
    expect(ApiKeyService.maskKey('sk-abcdefghijklmnop')).toBe('sk-abc...mnop');
  });

  it('should mask short key', () => {
    expect(ApiKeyService.maskKey('abc')).toBe('abc...');
  });

  it('should handle empty key', () => {
    expect(ApiKeyService.maskKey('')).toBe('Not available');
  });

  it('should handle null key', () => {
    expect(ApiKeyService.maskKey(undefined as any)).toBe('Not available');
  });
});
