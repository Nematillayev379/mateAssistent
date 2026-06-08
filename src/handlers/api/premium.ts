import express, { Request, Response } from 'express';
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
  /**
   * @swagger
   * /api/payments/methods:
   *   get:
   *     tags: [Premium]
   *     summary: Get available payment methods
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     responses:
   *       200:
   *         description: Available payment methods
   */
  app.get('/api/payments/methods', checkAuth, async (_req: Request, res: Response) => {
    try { res.json(CryptoPaymentService.getAvailableMethods()); }
    catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/payments/methods failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  /**
   * @swagger
   * /api/premium-info:
   *   get:
   *     tags: [Premium]
   *     summary: Get premium info and pricing
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     responses:
   *       200:
   *         description: Premium info with pricing
   */
  app.get('/api/premium-info', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
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
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/premium-info failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  /**
   * @swagger
   * /api/premium/buy:
   *   post:
   *     tags: [Premium]
   *     summary: Initiate premium purchase
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [method, plan]
   *             properties:
   *               method:
   *                 type: string
   *                 enum: [stars, usdt, ton]
   *               plan:
   *                 type: string
   *                 enum: [monthly, yearly]
   *     responses:
   *       200:
   *         description: Payment link or request
   *       400:
   *         description: Unsupported method
   */
  app.post('/api/premium/buy', buyLimiter, checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
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
        const paymentReq = await fn(uid, isYearly ? 'yearly' : 'monthly', price);
        if (!paymentReq) return res.status(503).json({ error: 'Crypto wallet sozlanmagan. Admin TON_WALLET ni o\'rnatsin.' });
        return res.json({ success: true, request: paymentReq, method });
      }
      res.status(400).json({ error: 'Unsupported method' });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/premium/buy failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  /**
   * @swagger
   * /api/payments/payme:
   *   post:
   *     tags: [Premium]
   *     summary: Payme payment webhook
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: Webhook response
   */
  app.post('/api/payments/payme', async (req: Request, res: Response) => {
    try {
      if (!SecretManager.get('PAYME_KEY')) { res.status(200).json({ error: { code: -32504, message: 'Payment not configured' } }); return; }
      res.json(await PaymentService.handlePaymeWebhook(req.body, req.headers));
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.warn(`Payme webhook failed: ${msg}`); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  /**
   * @swagger
   * /api/payments/click:
   *   post:
   *     tags: [Premium]
   *     summary: Click payment webhook
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: Webhook response
   */
  app.post('/api/payments/click', async (req: Request, res: Response) => {
    try {
      res.status(200).json(await PaymentService.handleClickWebhook(req.body || {}));
    } catch (e: unknown) {
      res.status(200).json({ error: -9, error_note: 'Internal server error', click_trans_id: req.body?.click_trans_id || 0, merchant_trans_id: req.body?.merchant_trans_id || '' });
    }
  });

  /**
   * @swagger
   * /api/crypto-payment/status/{id}:
   *   post:
   *     tags: [Premium]
   *     summary: Check crypto payment status
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Payment status
   */
  app.post('/api/crypto-payment/status/:id', checkAuth, async (req: Request, res: Response) => {
    try {
      const reqData = await CryptoPaymentService.getRequest(req.params.id as string);
      if (!reqData) return res.json({ status: 'not_found' });
      if (reqData.userId !== parseInt(req.authenticatedUserId as string)) return res.status(403).json({ error: 'Forbidden' });
      if (reqData.status === 'paid') return res.json({ status: 'paid' });
      const result = await CryptoPaymentService.verifyPayment(req.params.id as string);
      if (result === 'paid') {
        await DBService.setPremium(reqData.userId, reqData.plan === 'yearly' ? 365 : 30);
        logger.info(`Crypto premium granted: user ${reqData.userId}, ${reqData.currency} ${reqData.cryptoAmount}`);
      }
      res.json({ status: result });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/crypto-payment/status/:id failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  /**
   * @swagger
   * /api/premium/wallet-claim:
   *   post:
   *     tags: [Premium]
   *     summary: Claim premium via TON wallet
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [walletAddress]
   *             properties:
   *               walletAddress:
   *                 type: string
   *     responses:
   *       200:
   *         description: Premium claimed
   *       409:
   *         description: Already claimed
   */
  app.post('/api/premium/wallet-claim', claimLimiter, checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
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
        await DBService.updateUser(uid, { wallet_address: normalizedWalletAddress });
      } catch (e: unknown) {
        await DBService.deleteWalletClaim(uid).catch(() => false);
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`Wallet premium grant failed for ${uid}: ${msg}`);
        return res.status(500).json({ success: false, error: 'claim_apply_failed', message: 'Wallet bonus could not be applied. Please try again.' });
      }

      logger.info(`TON wallet premium granted: user ${uid}, wallet ${normalizedWalletAddress.slice(0, 8)}...`);
      res.json({ success: true, days: claim.bonus_days, message: '7-day premium granted for connecting your wallet!' });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/premium/wallet-claim failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  // ── Affiliate Dashboard ──
  /**
   * @swagger
   * /api/affiliate:
   *   get:
   *     tags: [Premium]
   *     summary: Get affiliate dashboard
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     responses:
   *       200:
   *         description: Affiliate stats
   */
  app.get('/api/affiliate', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
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
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/affiliate failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  /**
   * @swagger
   * /api/agency/info:
   *   get:
   *     tags: [Premium]
   *     summary: Get agency tier info
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     responses:
   *       200:
   *         description: Agency info
   */
  app.get('/api/agency/info', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
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
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/agency/info failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  /**
   * @swagger
   * /api/agency/subscribe:
   *   post:
   *     tags: [Premium]
   *     summary: Subscribe to agency plan
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [plan, method]
   *             properties:
   *               plan:
   *                 type: string
   *                 enum: [monthly, quarterly, yearly]
   *               method:
   *                 type: string
   *                 enum: [stars, usdt, ton]
   *     responses:
   *       200:
   *         description: Payment link
   *       400:
   *         description: Invalid plan
   */
  app.post('/api/agency/subscribe', buyLimiter, checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
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
        const paymentReq = await fn(uid, plan, price);
        if (!paymentReq) return res.status(503).json({ error: 'Crypto wallet not configured' });
        return res.json({ success: true, request: paymentReq, method });
      }

      res.status(400).json({ error: 'Unsupported method' });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/agency/subscribe failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  /**
   * @swagger
   * /api/agency/channels:
   *   get:
   *     tags: [Premium]
   *     summary: Get agency channels
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     responses:
   *       200:
   *         description: Agency channels
   *       403:
   *         description: Agency subscription required
   */
  app.get('/api/agency/channels', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const user = await DBService.getUser(uid);
      const isAgency = user?.role === 'agency' || user?.role === 'owner';
      if (!isAgency) return res.status(403).json({ error: 'Agency subscription required' });

      const channels = await DBService.getAllUserChannels(user);
      res.json({ channels, maxChannels: 10 });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/agency/channels failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  /**
   * @swagger
   * /api/agency/branding:
   *   post:
   *     tags: [Premium]
   *     summary: Update agency branding
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               brandName:
   *                 type: string
   *               logoUrl:
   *                 type: string
   *               primaryColor:
   *                 type: string
   *     responses:
   *       200:
   *         description: Branding updated
   *       403:
   *         description: Agency subscription required
   */
  app.post('/api/agency/branding', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const user = await DBService.getUser(uid);
      const isAgency = user?.role === 'agency' || user?.role === 'owner';
      if (!isAgency) return res.status(403).json({ error: 'Agency subscription required' });

      const { brandName, logoUrl, primaryColor } = req.body;
      await DBService.updateUser(uid, {
        agency_branding: JSON.stringify({ brandName, logoUrl, primaryColor })
      });
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/agency/branding failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });
}
