export const VALID_TERMS = {
  cancellationPolicy: {
    freeUntilDays: 7,
    penaltyType: "nights" as const,
    penaltyValue: 1,
    noShowPenaltyType: "percent" as const,
    noShowPenaltyValue: 100
  },
  paymentTerms: { dueDaysBeforeCheckIn: 14 }
};
