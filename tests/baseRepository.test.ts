import { normalizeUrl, normalizeTitle, isLikelyDuplicate } from '../src/repositories/BaseRepository';

describe('normalizeUrl', () => {
  it('should remove tracking parameters', () => {
    const url = normalizeUrl('https://example.com/page?utm_source=twitter&id=123');
    expect(url).not.toContain('utm_source');
    expect(url).toContain('id=123');
  });
  it('should remove hash', () => {
    expect(normalizeUrl('https://example.com/page#section')).not.toContain('#section');
  });
  it('should lowercase hostname', () => {
    expect(normalizeUrl('https://Example.COM/Path')).toContain('example.com');
  });
  it('should strip trailing slash', () => {
    expect(normalizeUrl('https://example.com/page/')).not.toMatch(/\/$/);
  });
  it('should handle invalid URLs', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });
  it('should handle empty string', () => {
    expect(normalizeUrl('')).toBe('');
  });
});

describe('normalizeTitle', () => {
  it('should lowercase', () => expect(normalizeTitle('Hello World')).toBe('hello world'));
  it('should remove URLs', () => expect(normalizeTitle('Check https://example.com')).not.toContain('https://'));
  it('should collapse whitespace', () => expect(normalizeTitle('hello    world')).toBe('hello world'));
});

describe('isLikelyDuplicate', () => {
  it('should detect exact match', () => expect(isLikelyDuplicate('Hello World', 'Hello World')).toBe(true));
  it('should detect match after normalization', () => {
    expect(isLikelyDuplicate('Hello World!', 'hello world')).toBe(true);
  });
  it('should match substring when long enough', () => {
    const long = 'This is a very long title with enough words to match by inclusion';
    expect(isLikelyDuplicate(long, long.slice(0, 35))).toBe(true);
  });
  it('should return false for completely different titles', () => {
    expect(isLikelyDuplicate('Weather forecast for today', 'Stock market reaches new highs')).toBe(false);
  });
  it('should handle empty strings', () => {
    expect(isLikelyDuplicate('', 'test')).toBe(false);
    expect(isLikelyDuplicate('', '')).toBe(false);
  });
});
