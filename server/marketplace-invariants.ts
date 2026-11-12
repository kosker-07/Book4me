/** Pure, fail-closed marketplace pricing permissions. */
export type MarketplaceRole = "system_admin" | "back_office" | "master_agency" | "sub_agency";
export function mayChangePlatformFee(role: MarketplaceRole): boolean {
  return role === "system_admin" || role === "back_office";
}
export function mayChangeOwnMarketplaceMarkup(role: MarketplaceRole, actorAgencyId: string | null, targetAgencyId: string): boolean {
  return role === "master_agency" && !!actorAgencyId && actorAgencyId === targetAgencyId;
}
export function buyerFacingSupplierName(): "BED4BOOK" { return "BED4BOOK"; }
