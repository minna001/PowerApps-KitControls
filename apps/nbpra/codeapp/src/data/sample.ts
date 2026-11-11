import type { DataSource } from "./source";
import type {
  DecisionState,
  SectionStatus,
  SectionSummary,
  Signatory,
  Submission,
  SubmissionDetail,
  SubmissionStatus,
} from "./types";

// Illustrative records only. Names, proposals and dates are invented.

type Row = [
  ref: string,
  title: string,
  area: string,
  owner: string,
  status: SubmissionStatus,
  completeness: number,
  funcApproved: number,
  funcRequired: number,
  sigs: number,
  nextAction: string,
  nextActor: string,
  blocker: string | undefined,
  meeting: string | undefined,
  slot: string | undefined,
  age: number,
];

const rows: Row[] = [
  ["NBPRA-2026-103", "SME Overdraft Repricing", "Retail Banking", "Hana Okafor", "Checklist in Progress", 45, 0, 6, 0, "Attach pricing analysis", "Submitter", "Financial section: pricing analysis not uploaded", "2026-12-02", "10:20", 31],
  ["NBPRA-2026-112", "Merchant Cash Advance", "Commercial Banking", "Owen Mercer", "Checklist in Progress", 100, 2, 6, 0, "Tax to review Scope and jurisdictions", "Functional approvers", "Tax review of Scope and jurisdictions has been open 14 days", "2026-12-16", "09:40", 47],
  ["NBPRA-2026-109", "Algorithmic Bond Pricing Engine", "Global Markets", "Luca Ferraro", "Checklist in Progress", 100, 5, 7, 0, "Risk to approve Risk and compliance", "Functional approvers", undefined, "2026-12-02", "10:40", 96],
  ["NBPRA-2026-113", "Crypto Custody Staking Extension", "Global Markets", "Priya Nair", "Awaiting Signatory Approval", 100, 8, 8, 3, "Two signatories still to approve", "Signatories", undefined, "2026-12-02", "11:00", 142],
  ["NBPRA-2026-117", "Real-Time FX Rate Lock", "Payments", "Mei Tanaka", "Authorized for Committee", 100, 6, 6, 5, "Attend committee", "None", undefined, "2026-11-18", "09:20", 214],
  ["NBPRA-2026-108", "Gold-Backed Lending", "Commercial Banking", "Isla McBride", "Final Changes Requested", 100, 6, 7, 0, "Revise Financial section", "Submitter", "Kate returned the package: liquidity assumptions", "2026-12-16", "10:00", 83],
  ["NBPRA-2026-101", "Tokenised Deposit Pilot", "Global Markets", "Priya Nair", "Onboarding Draft", 10, 0, 0, 0, "Assign five signatories", "Submitter", undefined, undefined, undefined, 6],
  ["NBPRA-2026-102", "Corporate Card Virtual Issuance", "Commercial Banking", "Owen Mercer", "Awaiting Onboarding Review", 15, 0, 0, 0, "Kate to review onboarding request", "Kate", undefined, "2026-12-16", "10:20", 9],
  ["NBPRA-2026-104", "FX Options Auto-Hedging", "Global Markets", "Luca Ferraro", "Awaiting Signatory Approval", 100, 7, 7, 1, "Four signatories still to approve", "Signatories", undefined, "2026-12-16", "10:40", 44],
  ["NBPRA-2026-105", "Green Mortgage Rate Discount", "Retail Banking", "Hana Okafor", "Ready for Final Submission", 100, 6, 6, 5, "Make final submission", "Submitter", undefined, "2026-12-02", "11:20", 58],
  ["NBPRA-2026-106", "Supplier Finance Onboarding Portal", "Commercial Banking", "Isla McBride", "Awaiting Final Admin Review", 100, 7, 7, 5, "Kate to review final package", "Kate", undefined, "2026-12-02", "11:40", 71],
  ["NBPRA-2026-107", "Instant Payee Verification", "Payments", "Mei Tanaka", "Onboarding Denied", 15, 0, 0, 0, "Revise and resubmit onboarding", "Submitter", "Denied: requested meeting is outside the committee remit", undefined, undefined, 12],
  ["NBPRA-2026-110", "Wealth Model Portfolios", "Wealth", "Daniel Osei", "Checklist in Progress", 72, 2, 6, 0, "Complete Operating model section", "Submitter", undefined, "2027-01-13", "09:20", 27],
  ["NBPRA-2026-111", "Buy Now Pay Later for SMEs", "Retail Banking", "Hana Okafor", "Checklist in Progress", 88, 4, 7, 0, "Submit Privacy section", "Submitter", undefined, "2027-01-13", "09:40", 39],
  ["NBPRA-2026-114", "Cross-Border Payroll Service", "Payments", "Mei Tanaka", "Checklist in Progress", 100, 3, 8, 0, "Tax to review Tax rev 1", "Functional approvers", "No eligible approver in Treasury group", "2027-01-13", "10:00", 65],
  ["NBPRA-2026-115", "Carbon Credit Custody", "Global Markets", "Priya Nair", "Awaiting Onboarding Review", 15, 0, 0, 0, "Kate to review onboarding request", "Kate", undefined, "2027-01-13", "10:20", 3],
  ["NBPRA-2026-116", "Trade Finance Document AI Check", "Commercial Banking", "Owen Mercer", "Checklist in Progress", 30, 0, 7, 0, "Complete Legal section", "Submitter", undefined, "2027-01-13", "10:40", 18],
  ["NBPRA-2026-118", "Private Credit Feeder Fund", "Wealth", "Daniel Osei", "Awaiting Final Admin Review", 100, 8, 8, 5, "Kate to review final package", "Kate", "Assigned meeting was canceled; slot needs reassignment", undefined, undefined, 102],
  ["NBPRA-2026-119", "Open Banking Data Sharing Consent", "Retail Banking", "Hana Okafor", "Ready for Final Submission", 100, 7, 7, 5, "Make final submission", "Submitter", undefined, "2026-12-16", "11:00", 77],
  ["NBPRA-2026-120", "Treasury Sweep Automation", "Commercial Banking", "Isla McBride", "Authorized for Committee", 100, 6, 6, 5, "Attend committee", "None", undefined, "2026-12-02", "09:20", 128],
  ["NBPRA-2026-097", "Student Account Fee Waiver", "Retail Banking", "Hana Okafor", "Withdrawn", 40, 1, 6, 0, "Closed", "None", undefined, undefined, undefined, 190],
];

const submissions: Submission[] = rows.map((r) => ({
  id: r[0],
  reference: r[0],
  title: r[1],
  businessArea: r[2],
  owner: r[3],
  sponsor: "Jane Smith",
  status: r[4],
  completenessPct: r[5],
  functionalApproved: r[6],
  functionalRequired: r[7],
  signatoriesApproved: r[8],
  nextAction: r[9],
  nextActor: r[10],
  blocker: r[11],
  meetingDate: r[12],
  slot: r[13],
  slotConfirmed: !["Onboarding Draft", "Awaiting Onboarding Review", "Onboarding Denied"].includes(r[4]) && !!r[12],
  ageDays: r[14],
}));

// Section list follows the candidate baseline in requirements section 11.2.
// The approved question catalogue replaces it.
const SECTION_DEFS: [code: string, title: string, groups: string[], required: number][] = [
  ["BUS", "Business and product overview", ["NBPRA"], 14],
  ["SCO", "Scope and jurisdictions", ["Legal", "Tax"], 9],
  ["LEG", "Legal", ["Legal"], 16],
  ["TAX", "Tax", ["Tax"], 11],
  ["FIN", "Financial and commercial", ["Finance"], 13],
  ["RSK", "Risk and compliance", ["Risk", "Compliance"], 18],
  ["OPS", "Operating model", ["Operations"], 12],
  ["TEC", "Technology and information security", ["Technology"], 15],
  ["PRV", "Privacy and data", ["Privacy"], 13],
];

function buildSections(s: Submission): SectionSummary[] {
  const locked = ["Onboarding Draft", "Awaiting Onboarding Review", "Onboarding Denied"].includes(s.status);
  let approvalsLeft = s.functionalApproved;
  const total = SECTION_DEFS.length;
  return SECTION_DEFS.map(([code, title, groups, required], i) => {
    if (code === "PRV" && s.functionalRequired <= 6 && !locked) {
      return { code, title, status: "Not Applicable", revision: 0, answered: 0, required: 0, groups: [] };
    }
    if (locked) {
      return { code, title, status: "Not Started", revision: 0, answered: 0, required, groups: groups.map((name) => ({ name, state: "Not requested" as DecisionState })) };
    }
    const doneThrough = Math.round((s.completenessPct / 100) * total);
    const complete = i < doneThrough;
    const groupStates = groups.map((name) => {
      if (!complete) return { name, state: "Not requested" as DecisionState };
      if (approvalsLeft > 0) {
        approvalsLeft--;
        return { name, state: "Approved" as DecisionState };
      }
      return { name, state: "Pending" as DecisionState };
    });
    let status: SectionStatus;
    if (!complete) status = i === doneThrough ? "Draft" : "Not Started";
    else if (groupStates.every((g) => g.state === "Approved")) status = "Approved";
    else status = "Under Review";
    const answered = complete ? required : i === doneThrough ? Math.floor(required / 2) : 0;
    return { code, title, status, revision: complete ? 1 : 0, answered, required, groups: groupStates };
  });
}

const SIGNATORY_NAMES = ["Jane Smith", "Tom Baker", "Sarah Jenkins", "Mark Davies", "Lisa Wong"];

function buildSignatories(s: Submission): Signatory[] {
  const requested = s.signatoriesApproved > 0 || s.status === "Awaiting Signatory Approval";
  return SIGNATORY_NAMES.map((name, i) => ({
    slot: i + 1,
    name,
    state: i < s.signatoriesApproved ? "Approved" : requested ? "Pending" : "Not requested",
  }));
}

export const sampleSource: DataSource = {
  isSample: true,
  async listSubmissions() {
    return submissions;
  },
  async getSubmission(id) {
    const s = submissions.find((x) => x.id === id);
    if (!s) return undefined;
    const detail: SubmissionDetail = {
      ...s,
      sections: buildSections(s),
      signatories: buildSignatories(s),
      blockers: s.blocker ? [s.blocker] : [],
    };
    return detail;
  },
};
