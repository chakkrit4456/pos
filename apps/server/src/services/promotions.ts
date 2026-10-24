import type { PromotionRule } from '@flexpos/shared';
import type { PromotionsTable } from '@flexpos/db';
import type { AppContext } from '../context.js';
import { parseJson } from '../util.js';

export function rowToRule(r: PromotionsTable): PromotionRule {
  return {
    id: r.id,
    name: r.name,
    type: r.type as PromotionRule['type'],
    priority: r.priority,
    exclusive: r.exclusive === 1,
    value: r.value,
    scope: r.scope as PromotionRule['scope'],
    productIds: parseJson<string[]>(r.product_ids, []),
    categoryIds: parseJson<string[]>(r.category_ids, []),
    customerGroupIds: parseJson<string[]>(r.customer_group_ids, []),
    branchIds: parseJson<string[]>(r.branch_ids, []),
    buyQty: r.buy_qty,
    getQty: r.get_qty,
    getDiscountPercent: r.get_discount_percent,
    minSubtotal: r.min_subtotal,
    maxDiscount: r.max_discount,
    couponCode: r.coupon_code,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    daysOfWeek: parseJson<number[]>(r.days_of_week, []),
    timeFrom: r.time_from,
    timeTo: r.time_to,
    active: r.active === 1,
  };
}

/** Active promotions that still have usage left. */
export async function loadPromotions(ctx: AppContext): Promise<PromotionRule[]> {
  if (!ctx.settings.modules.promotions) return [];
  const rows = await ctx.db.selectFrom('promotions').selectAll().where('active', '=', 1).execute();
  return rows.filter((r) => r.usage_limit === 0 || r.usage_count < r.usage_limit).map(rowToRule);
}
