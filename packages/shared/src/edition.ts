/**
 * Product edition, fixed at build time (FLEXPOS_EDITION=lite → FlexPOS Lite for grocery/convenience stores).
 * Lite drops the restaurant features, promotions, custom fields, editable roles and multi-device use,
 * and is licensed for exactly one machine.
 */
import type { LicensePayload } from './license.js';

declare const __FLEXPOS_EDITION__: string | undefined;

export type Edition = 'full' | 'lite';

function detect(): Edition {
  const v =
    typeof __FLEXPOS_EDITION__ !== 'undefined'
      ? __FLEXPOS_EDITION__
      : (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.FLEXPOS_EDITION;
  return v === 'lite' ? 'lite' : 'full';
}

export const EDITION: Edition = detect();
export const IS_LITE = EDITION === 'lite';
export const EDITION_NAME = IS_LITE ? 'FlexPOS Lite' : 'FlexPOS';

/** Modules that Lite keeps switched off, whatever is saved in settings. */
export const LITE_DISABLED_MODULES = ['restaurant', 'kitchenDisplay', 'promotions', 'customerDisplay', 'multiBranch'] as const;

export type EditionFeature = 'modifiers' | 'customFields' | 'customRoles' | 'devices' | 'lanClient' | 'orderApp' | 'restaurant' | 'promotions' | 'multiBranch';
const LITE_DISABLED_FEATURES: ReadonlySet<EditionFeature> = new Set<EditionFeature>([
  'modifiers',
  'customFields',
  'customRoles',
  'devices',
  'lanClient',
  'orderApp',
  'restaurant',
  'promotions',
  'multiBranch',
]);

export function editionAllows(feature: EditionFeature, edition: Edition = EDITION): boolean {
  return edition === 'full' || !LITE_DISABLED_FEATURES.has(feature);
}

/** Force the modules this edition does not include to off. */
export function lockModules<M extends Record<string, boolean>>(modules: M, edition: Edition = EDITION): M {
  if (edition === 'full') return modules;
  const out: Record<string, boolean> = { ...modules };
  for (const m of LITE_DISABLED_MODULES) if (m in out) out[m] = false;
  return out as M;
}

/** License plan a key must carry to run on this edition; Lite keys never unlock the full edition. */
export const LITE_PLAN = 'lite';

/**
 * Whether a license key may run on this edition. Lite keys carry plan "lite" and are good for one machine:
 * either bound to its machine id, or issued by FlexPOS Cloud (which allows a single paired device).
 * The full edition refuses Lite keys.
 */
export function licenseFitsEdition(p: Pick<LicensePayload, 'plan' | 'machineId' | 'licenseId'>, edition: Edition = EDITION): boolean {
  const lite = p.plan === LITE_PLAN;
  if (edition === 'full') return !lite;
  return lite && (p.machineId !== '*' || !!p.licenseId);
}
