export interface AccountHealthStep {
  threshold: number;
  points: number;
}

export interface AccountHealthConfig {
  bands: { healthy: number; attention: number };
  newAccountGraceDays: number;
  lastSeen: { steps: AccountHealthStep[]; neverSeenDays: number };
  usageDrop: {
    windowDays: number;
    minPreviousWeek: number;
    steps: AccountHealthStep[];
  };
  trial: {
    endingWithinDays: number;
    endingPoints: number;
    expiredPoints: number;
  };
  quota: { thresholdPercent: number; points: number; exhaustedPoints: number };
  errors: { windowDays: number; steps: AccountHealthStep[] };
  deliveryFailures: { windowHours: number; steps: AccountHealthStep[] };
  delinquency: { pastDuePoints: number; suspendedPoints: number };
}

export const ACCOUNT_HEALTH_CONFIG: AccountHealthConfig = {
  bands: { healthy: 70, attention: 40 },
  newAccountGraceDays: 7,
  lastSeen: {
    steps: [
      { threshold: 30, points: 35 },
      { threshold: 14, points: 25 },
      { threshold: 7, points: 15 },
    ],
    neverSeenDays: 30,
  },
  usageDrop: {
    windowDays: 7,
    minPreviousWeek: 3,
    steps: [
      { threshold: 75, points: 20 },
      { threshold: 50, points: 12 },
      { threshold: 25, points: 6 },
    ],
  },
  trial: { endingWithinDays: 7, endingPoints: 15, expiredPoints: 25 },
  quota: { thresholdPercent: 80, points: 8, exhaustedPoints: 12 },
  errors: {
    windowDays: 3,
    steps: [
      { threshold: 20, points: 15 },
      { threshold: 5, points: 8 },
      { threshold: 1, points: 3 },
    ],
  },
  deliveryFailures: {
    windowHours: 72,
    steps: [
      { threshold: 10, points: 10 },
      { threshold: 3, points: 5 },
    ],
  },
  delinquency: { pastDuePoints: 25, suspendedPoints: 40 },
};
