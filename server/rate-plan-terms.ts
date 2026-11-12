import { validateRatePlanTerms } from "./validation";

export function ratePlanTermsText(cancellationPolicy: unknown, paymentTerms: unknown): string {
  if (!validateRatePlanTerms(cancellationPolicy, paymentTerms)) return "Koşullar tanımlı değil / Terms not defined";
  const c = cancellationPolicy as { freeUntilDays: number; penaltyType: string; penaltyValue: number; noShowPenaltyType: string; noShowPenaltyValue: number };
  const p = paymentTerms as { dueDaysBeforeCheckIn: number };
  const penalty = (type: string, value: number) => type === "nights" ? `${value} gece` : `%${value}`;
  return `Girişe ${c.freeUntilDays} gün kalana kadar ücretsiz iptal, sonrasında ${penalty(c.penaltyType,c.penaltyValue)} ceza. No-show: ${penalty(c.noShowPenaltyType,c.noShowPenaltyValue)}. Ödeme: girişten ${p.dueDaysBeforeCheckIn} gün önce.`;
}
