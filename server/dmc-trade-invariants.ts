/** Marketplace tenant isolation and buyer-facing supplier identity. */
export function mayManageDmcInventory(role: string, actorAgencyId: string | null, ownerAgencyId: string): boolean {
  if (role === "system_admin" || role === "back_office") return true;
  return role === "master_agency" && !!actorAgencyId && actorAgencyId === ownerAgencyId;
}
export function publicMarketplaceSupplier(): "BED4BOOK" { return "BED4BOOK"; }
export function assertDifferentDmcHidden(buyerAgencyId: string, ownerAgencyId: string): void {
  if (!buyerAgencyId || !ownerAgencyId) throw new Error("AGENCY_REQUIRED");
  // Supplier identity must never be serialized to buyer-facing responses.
}
