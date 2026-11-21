// Twenty field names the TW1 seed relies on, with their source at the pinned fork (Jayami123/twenty-crm at 7cbdfec6).
// Each one was read from packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/.
// A unit test (twenty-fields.test.ts) pins the values; the source line numbers are here so a reviewer can re-check them.

/** noteTarget -> opportunity relation: `targetOpportunity` (compute-note-target-standard-flat-field-metadata.util.ts:347), its join column `targetOpportunityId` (:366). */
export const NOTE_TARGET_OPPORTUNITY_COLUMN = "targetOpportunityId";
/** noteTarget -> note relation: `note` (:249), join column `noteId` (:267). */
export const NOTE_TARGET_NOTE_COLUMN = "noteId";
/** opportunity -> company relation: `company` (compute-opportunity-standard-flat-field-metadata.util.ts:421), join column `companyId` (:438). */
export const OPPORTUNITY_COMPANY_COLUMN = "companyId";
/** attachment -> company relation: `targetCompany` (compute-attachment-standard-flat-field-metadata.util.ts:527), join column `targetCompanyId` (:546). */
export const ATTACHMENT_TARGET_COMPANY_COLUMN = "targetCompanyId";
