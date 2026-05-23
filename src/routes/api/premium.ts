import express from 'express';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { PaymentService } from '../../services/payment';
import { logger } from '../../utils/logger';
import { checkAuth } from '../../middleware/auth';

const walletClaims = new Map<number, boolean>();

export function registerPremiumRoutes(app: express.Application) {
  app.get('/api/payments/methods', checkAuth, async (req: any, res: any) => {
    res.json(PaymentService.getAvailableMethods());
  });

  app.get('/api/premium-info', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const priceMonthly = await DBService.getPrice('monthly');
    const priceYearly = await DBService.getPrice('yearly');
    const isActive = await DBService.isPremiumActive(uid);
    let expiresAt = null;
    if (isActive) { const user = await DBService.getUser(uid); expiresAt = user?.premium_until; }
    const starsPrice = parseInt(await DBService.getSetting('premium_stars_price') || '500');
    res.json({ monthlyPrice: priceMonthly, yearlyPrice: priceYearly, starsPrice, starsYearlyPrice: starsPrice * 10, isActive, expiresAt, benefits: ['10 ta RSS manba', 'Cheksiz kanal monitoring', 'Cheksiz schedule post', 'AI prioritet (30/min)', 'Kunlik digest', 'Premium badge va oltin tema'] });
  });

  app.post('/api/premium/buy', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { method, plan } = req.body;
    const isYearly = plan === 'yearly';
    if (method === 'stars') {
      const starsPrice = parseInt(await DBService.getSetting('premium_stars_price') || '500');
      const invoice = await bot.createInvoiceLink(isYearly ? 'mateAssistent Premium (1 Year)' : 'mateAssistent Premium (1 Month)', 'Premium access', `premium_sub_${uid}${isYearly ? '_yearly' : ''}`, '', 'XTR', [{ label: 'Premium', amount: isYearly ? starsPrice * 10 : starsPrice }]);
      return res.json({ success: true, url: invoice, method: 'stars' });
    }
    if (method === 'payme') {
      const amount = isYearly ? await DBService.getPrice('yearly') : await DBService.getPrice('monthly');
      const link = await PaymentService.generatePaymeLink(uid, amount, isYearly ? 'yearly' : 'monthly');
      if (!link) return res.status(503).json({ error: 'Payme sozlanmagan' });
      return res.json({ success: true, url: link, method: 'payme' });
    }
    if (method === 'click') {
      const amount = isYearly ? await DBService.getPrice('yearly') : await DBService.getPrice('monthly');
      const link = await PaymentService.generateClickLink(uid, amount, isYearly ? 'yearly' : 'monthly');
      if (!link) return res.status(503).json({ error: 'Click sozlanmagan' });
      return res.json({ success: true, url: link, method: 'click' });
    }
    res.status(400).json({ error: 'Unsupported method' });
  });

  app.post('/api/payments/payme', async (req, res) => {
    try {
      if (!process.env.PAYME_KEY) { res.status(200).json({ error: { code: -32504, message: 'Payment not configured' } }); return; }
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

  app.post('/api/premium/wallet-claim', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    if (walletClaims.get(uid)) {
      return res.json({ success: false, error: 'already_claimed', message: 'You already claimed your wallet premium bonus.' });
    }
    const { walletAddress } = req.body;
    if (!walletAddress || typeof walletAddress !== 'string') {
      return res.status(400).json({ success: false, error: 'wallet_required' });
    }
    await DBService.setPremium(uid, 7);
    walletClaims.set(uid, true);
    try { await DBService.updateUser(uid, { wallet_address: walletAddress } as any); } catch {}
    logger.info(`TON wallet premium granted: user ${uid}, wallet ${walletAddress.slice(0, 8)}...`);
    res.json({ success: true, days: 7, message: '7-day premium granted for connecting your wallet!' });
  });
}
