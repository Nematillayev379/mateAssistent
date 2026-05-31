jest.mock('../src/config/config', () => ({
  CONFIG: { DASHBOARD_SECRET: 'test-secret-for-encryption-test-123' },
}));

import { encrypt, decrypt, hashKey } from '../src/utils/crypto';

describe('crypto utils', () => {
  it('should encrypt and decrypt a string', () => {
    const original = 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(encrypted).toContain(':');
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it('should produce different ciphertexts for same input', () => {
    const key = 'sk-test-key-123456';
    const enc1 = encrypt(key);
    const enc2 = encrypt(key);
    expect(enc1).not.toBe(enc2);
  });

  it('should generate deterministic hash', () => {
    const key = 'sk-test-key-123456';
    expect(hashKey(key)).toBe(hashKey(key));
    expect(hashKey(key)).not.toBe(hashKey(key + 'x'));
  });

  it('should handle empty string', () => {
    const encrypted = encrypt('');
    expect(decrypt(encrypted)).toBe('');
  });

  it('should throw on invalid encrypted format', () => {
    expect(() => decrypt('invalid')).toThrow();
  });
});
