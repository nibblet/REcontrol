/**
 * Sense pipeline configuration constants.
 * Update LATEST_ACS_5YR when Census releases a new ACS 5-year vintage
 * (typically December/January for the prior year).
 */

/** Latest available ACS 5-year survey year. Census releases ~13 months after reference year. */
export const LATEST_ACS_5YR = 2024;

/** Default Zillow datasets for bootstrap and global refresh. */
export const DEFAULT_ZILLOW_DATASETS = [
  'zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa',
  'zori_uc_sfrcondomfr_sm',
];

/** Default months of Zillow history to ingest. */
export const DEFAULT_ZILLOW_MONTHS_BACK = 24;

/** Default HUD SAFMR fiscal year. HUD publishes SAFMR annually (FY = Oct-Sep). */
export const DEFAULT_SAFMR_FY_YEAR = 2025;

/** Stale bootstrap run timeout in milliseconds (30 minutes). */
export const STALE_RUN_TIMEOUT_MS = 30 * 60 * 1000;
