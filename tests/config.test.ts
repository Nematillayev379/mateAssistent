describe('config', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.WEBHOOK_SECRET;
    delete process.env.DASHBOARD_SECRET;
    delete process.env.TELEGRAM_TOKEN;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('should generate random WEBHOOK_SECRET when not provided', () => {
    process.env.DASHBOARD_SECRET = 'my-secret';
    process.env.TELEGRAM_TOKEN = 'bot-token';
    const { CONFIG } = require('../src/config/config');
    expect(CONFIG.WEBHOOK_SECRET).toBeDefined();
    expect(CONFIG.WEBHOOK_SECRET.length).toBe(64);
  });

  it('should use provided WEBHOOK_SECRET', () => {
    process.env.WEBHOOK_SECRET = 'my-custom-webhook-secret-hex-1234567890abcdef';
    const { CONFIG } = require('../src/config/config');
    expect(CONFIG.WEBHOOK_SECRET).toBe('my-custom-webhook-secret-hex-1234567890abcdef');
  });

  it('should produce different secrets each time by default', () => {
    process.env.DASHBOARD_SECRET = 'secret';
    process.env.TELEGRAM_TOKEN = 'token';
    const { CONFIG: cfg1 } = require('../src/config/config');
    jest.resetModules();
    const { CONFIG: cfg2 } = require('../src/config/config');
    expect(cfg1.WEBHOOK_SECRET.length).toBe(64);
    expect(cfg2.WEBHOOK_SECRET.length).toBe(64);
  });
});
