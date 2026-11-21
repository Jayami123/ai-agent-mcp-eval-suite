import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTACHMENT_TARGET_COMPANY_COLUMN, NOTE_TARGET_NOTE_COLUMN, NOTE_TARGET_OPPORTUNITY_COLUMN, OPPORTUNITY_COMPANY_COLUMN } from "./twenty-fields.js";

// The join-column names the seed sends, pinned to the source (see twenty-fields.ts for the file and line of each).
test("noteTarget links to an opportunity by targetOpportunityId, not opportunityId", () => {
  assert.equal(NOTE_TARGET_OPPORTUNITY_COLUMN, "targetOpportunityId");
  assert.equal(NOTE_TARGET_NOTE_COLUMN, "noteId");
});

test("opportunity and attachment use the join columns from the source", () => {
  assert.equal(OPPORTUNITY_COMPANY_COLUMN, "companyId");
  assert.equal(ATTACHMENT_TARGET_COMPANY_COLUMN, "targetCompanyId");
});
