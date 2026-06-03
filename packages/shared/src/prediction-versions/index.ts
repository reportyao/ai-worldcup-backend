import { PredictionVersion, type PredictionVersion as PredictionVersionValue } from '../enums/index.js';

export interface PredictionVersionMeta {
  value: PredictionVersionValue;
  label: string;
  longLabel: string;
  targetHours: number;
  autoTrigger: boolean;
  manualTrigger: boolean;
}

export const PREDICTION_VERSION_META = {
  [PredictionVersion.T_MINUS_7H]: {
    value: PredictionVersion.T_MINUS_7H,
    label: '赛前7h',
    longLabel: '开赛前7小时',
    targetHours: 7,
    autoTrigger: true,
    manualTrigger: true,
  },
  [PredictionVersion.T_MINUS_2H]: {
    value: PredictionVersion.T_MINUS_2H,
    label: '赛前2h',
    longLabel: '开赛前2小时',
    targetHours: 2,
    autoTrigger: false,
    manualTrigger: true,
  },
} as const satisfies Record<PredictionVersionValue, PredictionVersionMeta>;

export const ALL_PREDICTION_VERSIONS = Object.keys(PREDICTION_VERSION_META) as PredictionVersionValue[];

export const MANUAL_TRIGGER_PREDICTION_VERSIONS = ALL_PREDICTION_VERSIONS.filter(
  (version) => PREDICTION_VERSION_META[version].manualTrigger,
);

export const AUTO_TRIGGER_PREDICTION_VERSIONS = ALL_PREDICTION_VERSIONS.filter(
  (version) => PREDICTION_VERSION_META[version].autoTrigger,
);

export const AUTO_PREDICTION_SCHEDULES = AUTO_TRIGGER_PREDICTION_VERSIONS.map((version) => ({
  version,
  targetMs: PREDICTION_VERSION_META[version].targetHours * 60 * 60 * 1000,
})) as Array<{ version: PredictionVersionValue; targetMs: number }>;

export function getPredictionVersionLabel(version: PredictionVersionValue | string): string {
  return PREDICTION_VERSION_META[version as PredictionVersionValue]?.label ?? String(version);
}

export function getPredictionVersionLongLabel(version: PredictionVersionValue | string): string {
  return PREDICTION_VERSION_META[version as PredictionVersionValue]?.longLabel ?? String(version);
}

export function isPredictionVersion(value: unknown): value is PredictionVersionValue {
  return typeof value === 'string' && value in PREDICTION_VERSION_META;
}
