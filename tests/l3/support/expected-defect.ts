import { fail, pass, type Verdict } from "../../../src/oracles/verdict.js";

/**
 * Plan D13. A confirmed product gap stays in the suite as an expected defect: the test must still FAIL on the real
 * behaviour. If the verdict now passes, the defect is fixed upstream and the annotation must be removed, so this returns
 * a failure telling the reader to do that. Never use it to hide a failure nobody has confirmed against the ledger oracle.
 * Public text stays neutral: an ID, the server and a one-line summary.
 */
export interface DefectRef {
  caseId: string;
  server: string;
  summary: string;
}

export function expectedDefect(observed: Verdict, ref: DefectRef): Verdict {
  if (observed.outcome === "fail") return pass(`expected defect, still reproduces (${ref.server}: ${ref.summary})`);
  return fail(`expected defect no longer reproduces (${ref.server}: ${ref.summary}); the server now behaves as the ledger oracle asks, so remove expectedDefect() from ${ref.caseId}`);
}
