import express from 'express';
import rateLimit from 'express-rate-limit';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { PaymentService } from '../../services/payment';
import { CryptoPaymentService } from '../../services/crypto_payment';
import { SecretManager } from '../../services/secret_manager';
import { logger } from '../../utils/logger';
import { checkAuth } from '../auth';

export function registerPremiumRoutes(app: express.Application) {
  const buyLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Too many purchase attempts.' } });
  const claimLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Too many claim attempts.' } });
  app.get('/api/payments/methods', checkAuth, async (req: any, res: any) => {
    res.json(CryptoPaymentService.getAvailableMethods());
  });

  app.get('/api/premium-info', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const [priceMonthly, priceYearly, isActive, starsPriceStr, user] = await Promise.all([
      DBService.getPrice('monthly'),
      DBService.getPrice('yearly'),
      DBService.isPremiumActive(uid),
      DBService.getSetting('premium_stars_price'),
      DBService.getUser(uid),
    ]);
    const starsPrice = parseInt(starsPriceStr || '500');
    const expiresAt = isActive ? user?.premium_until : null;
    res.json({ monthlyPrice: priceMonthly, yearlyPrice: priceYearly, starsPrice, starsYearlyPrice: starsPrice * 10, isActive, expiresAt, benefits: ['10 ta RSS manba', 'Cheksiz kanal monitoring', 'Cheksiz schedule post', 'AI prioritet (30/min)', 'Kunlik digest', 'Premium badge va oltin tema'] });
  });

  app.post('/api/premium/buy', buyLimiter, checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { method, plan } = req.body;
    const isYearly = plan === 'yearly';
    if (method === 'stars') {
      const starsPrice = parseInt(await DBService.getSetting('premium_stars_price') || '500');
      const invoice = await bot.createInvoiceLink(isYearly ? 'mateAssistent Premium (1 Year)' : 'mateAssistent Premium (1 Month)', 'Premium access', `premium_sub_${uid}${isYearly ? '_yearly' : ''}`, '', 'XTR', [{ label: 'Premium', amount: isYearly ? starsPrice * 10 : starsPrice }]);
      return res.json({ success: true, url: invoice, method: 'stars' });
    }
    if (method === 'usdt' || method === 'ton') {
      const fn = method === 'usdt' ? CryptoPaymentService.createRequest : CryptoPaymentService.createTonRequest;
      const price = await DBService.getPrice(isYearly ? 'yearly' : 'monthly');
      const req = await fn(uid, isYearly ? 'yearly' : 'monthly', price);
      if (!req) return res.status(503).json({ error: 'Crypto wallet sozlanmagan. Admin TON_WALLET ni o\'rnatsin.' });
      return res.json({ success: true, request: req, method });
    }
    res.status(400).json({ error: 'Unsupported method' });
  });

  app.post('/api/payments/payme', async (req, res) => {
    try {
      if (!SecretManager.get('PAYME_KEY')) { res.status(200).json({ error: { code: -32504, message: 'Payment not configured' } }); return; }
      res.json(await PaymentService.handlePaymeWebhook(req.body, req.headers));
    } catch (e: any) { logger.warn(`Payme webhook failed: ${e.message}`); res.status(500).json({ error: e.message }); }
  });

  app.post('/api/payments/click', async (req, res) => {
    try {
      res.status(200).json(await PaymentService.handleClickWebhook(req.body || {}));
    } catch (e: any) {
      res.status(200).json({ error: -9, error_note: 'Internal server error', click_trans_id: req.body?.click_trans_id || 0, merchant_trans_id: req.body?.merchant_trans_id || '' });
    }
  });

  app.post('/api/crypto-payment/status/:id', checkAuth, async (req: any, res: any) => {
    const reqData = await CryptoPaymentService.getRequest(req.params.id);
    if (!reqData) return res.json({ status: 'not_found' });
    if (reqData.userId !== parseInt(req.authenticatedUserId)) return res.status(403).json({ error: 'Forbidden' });
    if (reqData.status === 'paid') return res.json({ status: 'paid' });
    const result = await CryptoPaymentService.verifyPayment(req.params.id);
    if (result === 'paid') {
      await DBService.setPremium(reqData.userId, reqData.plan === 'yearly' ? 365 : 30);
      logger.info(`Crypto premium granted: user ${reqData.userId}, ${reqData.currency} ${reqData.cryptoAmount}`);
    }
    res.json({ status: result });
  });

  app.post('/api/premium/wallet-claim', claimLimiter, checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { walletAddress } = req.body;
    const normalizedWalletAddress = typeof walletAddress === 'string' ? walletAddress.trim() : '';

    if (!normalizedWalletAddress) {
      return res.status(400).json({ success: false, error: 'wallet_required' });
    }

    const existingByUser = await DBService.getWalletClaimByTelegramId(uid);
    if (existingByUser) {
      return res.json({ success: false, error: 'already_claimed', message: 'You already claimed your wallet premium bonus.' });
    }

    const existingByWallet = await DBService.getWalletClaimByAddress(normalizedWalletAddress);
    if (existingByWallet) {
      return res.json({ success: false, error: 'wallet_already_used', message: 'This wallet already received the premium bonus.' });
    }

    const claim = await DBService.createWalletClaim({
      telegram_id: uid,
      wallet_address: normalizedWalletAddress,
      bonus_days: 7,
    });
    if (!claim) {
      return res.status(409).json({ success: false, error: 'claim_conflict', message: 'Wallet bonus already claimed or temporarily unavailable.' });
    }

    try {
      await DBService.setPremium(uid, claim.bonus_days);
      await DBService.updateUser(uid, { wallet_address: normalizedWalletAddress } as any);
    } catch (e: any) {
      await DBService.deleteWalletClaim(uid).catch(() => false);
      logger.error(`Wallet premium grant failed for ${uid}: ${e.message}`);
      return res.status(500).json({ success: false, error: 'claim_apply_failed', message: 'Wallet bonus could not be applied. Please try again.' });
    }

    logger.info(`TON wallet premium granted: user ${uid}, wallet ${normalizedWalletAddress.slice(0, 8)}...`);
    res.json({ success: true, days: claim.bonus_days, message: '7-day premium granted for connecting your wallet!' });
  });

  // ── Affiliate Dashboard ──
  app.get('/api/affiliate', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const stats = await DBService.getReferralStats(uid);
    const code = await DBService.ensureReferralCode(uid);
    const user = await DBService.getUser(uid);
    const botUsername = process.env.BOT_USERNAME || 'bot';
    const refLink = code ? `https://t.me/${botUsername}?start=ref_${code}` : null;
    res.json({
      code,
      link: refLink,
      total: stats.total,
      active: stats.active,
      needed: stats.needed,
      premiumCount: user?.referral_count || 0,
      rewardPerActive: 10,
      daysPerReward: 30,
    });
  });

  app.get('/api/agency/info', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const user = await DBService.getUser(uid);
    const isAgency = user?.role === 'agency' || user?.role === 'owner';
    res.json({
      isAgency,
      tier: user?.agency_tier || null,
      maxChannels: isAgency ? 10 : 3,
      features: isAgency ? [
        '10 ta kanal boshqaruvi',
        'White-label dashboard',
        'AI kvota: 200 ta post/daqiqa',
        'Prioritet qo\'llab-quvvatlash',
        'Custom branding',
        'API access',
        'Multi-admin role',
      ] : [
        '3 ta kanal boshqaruvi',
        'Standart dashboard',
        'AI kvota: 30 ta post/daqiqa',
      ],
      pricing: {
        monthly: 500000,
        quarterly: 1200000,
        yearly: 4000000,
      },
    });
  });

  app.post('/api/agency/subscribe', buyLimiter, checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { plan, method } = req.body;
    const prices: Record<string, number> = { monthly: 500000, quarterly: 1200000, yearly: 4000000 };
    const price = prices[plan];
    if (!price) return res.status(400).json({ error: 'Invalid plan' });

    if (method === 'stars') {
      const starsPrice = Math.ceil(price / 100);
      const invoice = await bot.createInvoiceLink(
        `mateAssistent Agency (${plan})`,
        'Agency subscription',
        `agency_sub_${uid}_${plan}`,
        '', 'XTR',
        [{ label: 'Agency', amount: starsPrice }]
      );
      return res.json({ success: true, url: invoice, method: 'stars' });
    }

    if (method === 'usdt' || method === 'ton') {
      const fn = method === 'usdt' ? CryptoPaymentService.createRequest : CryptoPaymentService.createTonRequest;
      const req = await fn(uid, plan, price);
      if (!req) return res.status(503).json({ error: 'Crypto wallet not configured' });
      return res.json({ success: true, request: req, method });
    }

    res.status(400).json({ error: 'Unsupported method' });
  });

  app.get('/api/agency/channels', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const user = await DBService.getUser(uid);
    const isAgency = user?.role === 'agency' || user?.role === 'owner';
    if (!isAgency) return res.status(403).json({ error: 'Agency subscription required' });

    const channels = await DBService.getAllUserChannels(user);
    res.json({ channels, maxChannels: 10 });
  });

  app.post('/api/agency/branding', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const user = await DBService.getUser(uid);
    const isAgency = user?.role === 'agency' || user?.role === 'owner';
    if (!isAgency) return res.status(403).json({ error: 'Agency subscription required' });

    const { brandName, logoUrl, primaryColor } = req.body;
    await DBService.updateUser(uid, {
      agency_branding: JSON.stringify({ brandName, logoUrl, primaryColor })
    });
    res.json({ success: true });
  });
}
