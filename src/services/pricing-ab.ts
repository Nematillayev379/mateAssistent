import { logger } from '../utils/logger';

interface PricingVariant {
  id: string;
  monthlyPrice: number;
  yearlyPrice: number;
  starsPrice: number;
  label: string;
}

const VARIANTS: PricingVariant[] = [
  { id: 'control', monthlyPrice: 25000, yearlyPrice: 250000, starsPrice: 500, label: 'Standard' },
  { id: 'discount', monthlyPrice: 20000, yearlyPrice: 200000, starsPrice: 400, label: 'Discount' },
  { id: 'premium', monthlyPrice: 30000, yearlyPrice: 300000, starsPrice: 600, label: 'Premium' },
];

export function getPricingVariant(userId: number): PricingVariant {
  // Deterministic assignment based on userId
  const index = userId % VARIANTS.length;
  return VARIANTS[index];
}

export function trackPricingView(userId: number, variantId: string) {
  logger.info(`Pricing view: user=${userId}, variant=${variantId}`);
}

export function trackPricingConversion(userId: number, variantId: string) {
  logger.info(`Pricing conversion: user=${userId}, variant=${variantId}`);
}
