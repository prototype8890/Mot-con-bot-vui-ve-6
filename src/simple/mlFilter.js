const DEFAULT_THRESHOLD = Number(process.env.ML_SCORE_THRESHOLD || '62');

const WEIGHTS = {
  lpEth: 30,
  tokenAgeMinutes: 20,
  deployerHistory: 15,
  holderDistribution: 15,
  socialScore: 10,
  taxScore: 10
};

export function calculateMlScore(features) {
  const {
    lpEth = 0,
    tokenAgeMinutes = 0,
    deployerHistoryScore = 0,
    holderDistributionScore = 0,
    socialScore = 0,
    taxScore = 0
  } = features;

  const lpComponent = Math.min(lpEth, 10) / 10 * WEIGHTS.lpEth;
  const ageComponent = Math.min(tokenAgeMinutes, 120) / 120 * WEIGHTS.tokenAgeMinutes;
  const deployerComponent = Math.max(Math.min(deployerHistoryScore, 1), -1) * WEIGHTS.deployerHistory;
  const holderComponent = Math.max(Math.min(holderDistributionScore, 1), -1) * WEIGHTS.holderDistribution;
  const socialComponent = Math.max(Math.min(socialScore, 1), 0) * WEIGHTS.socialScore;
  const taxComponent = Math.max(Math.min(taxScore, 1), -1) * WEIGHTS.taxScore;

  const rawScore = 50 + lpComponent + ageComponent + deployerComponent + holderComponent + socialComponent + taxComponent;
  return Math.max(0, Math.min(100, rawScore));
}

export function evaluateTokenWithMl(features, threshold = DEFAULT_THRESHOLD) {
  const score = calculateMlScore(features);
  return {
    score,
    passed: score >= threshold,
    threshold,
    breakdown: {
      lpEth: features.lpEth,
      tokenAgeMinutes: features.tokenAgeMinutes,
      deployerHistoryScore: features.deployerHistoryScore,
      holderDistributionScore: features.holderDistributionScore,
      socialScore: features.socialScore,
      taxScore: features.taxScore
    }
  };
}

