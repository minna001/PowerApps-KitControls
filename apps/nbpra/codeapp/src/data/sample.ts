import type { DataSource } from "./source";
import type {
  ActionResult,
  AdminAction,
  BusinessEvent,
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

// ---- Timeline -------------------------------------------------------------

const NOW = Date.parse("2026-11-11T09:00:00Z");
const DAY = 86400000;
const REACHED: SubmissionStatus[] = [
  "Onboarding Draft",
  "Awaiting Onboarding Review",
  "Checklist in Progress",
  "Awaiting Signatory Approval",
  "Ready for Final Submission",
  "Awaiting Final Admin Review",
  "Authorized for Committee",
];

function buildEvents(s: Submission): BusinessEvent[] {
  const out: BusinessEvent[] = [];
  const start = NOW - s.ageDays * DAY;
  let n = 0;
  const add = (frac: number, e: Omit<BusinessEvent, "id" | "submissionId" | "reference" | "occurredAt">) => {
    n++;
    out.push({
      id: `${s.id}-${n}`,
      submissionId: s.id,
      reference: s.reference,
      occurredAt: new Date(start + frac * s.ageDays * DAY + n * 47 * 60000).toISOString(),
      ...e,
    });
  };
  // How far along the main path this record got.
  const path: Partial<Record<SubmissionStatus, number>> = {
    "Onboarding Denied": 1,
    "Final Changes Requested": 5,
    "Final Rejected": 5,
    Withdrawn: 2,
  };
  const reached = path[s.status] ?? REACHED.indexOf(s.status);

  add(0, { actor: s.owner, eventType: "Submission", action: "Draft created", newStatus: "Onboarding Draft", channel: "App" });
  if (reached >= 1) {
    add(0.05, { actor: s.owner, eventType: "Slot", action: "Onboarding submitted with five signatories", oldStatus: "Onboarding Draft", newStatus: "Awaiting Onboarding Review", revision: "Onboarding rev 1", channel: "App" });
  }
  if (s.status === "Onboarding Denied") {
    add(0.3, { actor: "Kate", eventType: "Slot", action: "Onboarding denied", oldStatus: "Awaiting Onboarding Review", newStatus: "Onboarding Denied", revision: "Onboarding rev 1", channel: "Email", reason: "Requested meeting is outside the committee remit." });
  }
  if (reached >= 2) {
    add(0.1, { actor: "Kate", eventType: "Slot", action: "Onboarding approved; slot confirmed", oldStatus: "Awaiting Onboarding Review", newStatus: "Checklist in Progress", revision: "Onboarding rev 1", channel: "Teams" });
    add(0.1, { actor: "System", eventType: "Checklist", action: "Checklist unlocked; template v1 pinned", channel: "System" });
    if (s.functionalApproved > 0) {
      add(0.35, { actor: s.owner, eventType: "Section", action: "Business and product overview submitted", revision: "BUS rev 1", channel: "App" });
      add(0.45, { actor: "Amara Bello", eventType: "Review request", action: "NBPRA approved Business and product overview", revision: "BUS rev 1", channel: "App" });
    }
  }
  if (reached >= 3) {
    add(0.6, { actor: "System", eventType: "Section", action: "All required functional approvals current", channel: "System" });
    add(0.62, { actor: s.owner, eventType: "Signatory", action: "Package sent to five signatories", oldStatus: "Checklist in Progress", newStatus: "Awaiting Signatory Approval", revision: "Package rev 1", channel: "App" });
    SIGNATORY_NAMES.slice(0, s.signatoriesApproved).forEach((name, i) =>
      add(0.66 + i * 0.03, { actor: name, eventType: "Signatory", action: `Signatory ${i + 1} approved`, revision: "Package rev 1", channel: i % 2 ? "Email" : "App" }),
    );
  }
  if (reached >= 4) {
    add(0.82, { actor: "System", eventType: "Signatory", action: "All five signatories approved", oldStatus: "Awaiting Signatory Approval", newStatus: "Ready for Final Submission", revision: "Package rev 1", channel: "System" });
  }
  if (reached >= 5) {
    add(0.88, { actor: s.owner, eventType: "Final submission", action: "Final submission made", oldStatus: "Ready for Final Submission", newStatus: "Awaiting Final Admin Review", revision: "Package rev 1", channel: "App" });
  }
  if (s.status === "Final Changes Requested") {
    add(0.95, { actor: "Kate", eventType: "Admission", action: "Returned for changes", oldStatus: "Awaiting Final Admin Review", newStatus: "Final Changes Requested", revision: "Package rev 1", channel: "App", reason: "Liquidity assumptions need Finance to re-review." });
    add(0.95, { actor: "System", eventType: "Invalidation", action: "Five signatory approvals invalidated", revision: "Package rev 1", channel: "System" });
  }
  if (s.status === "Authorized for Committee") {
    add(0.96, { actor: "Kate", eventType: "Admission", action: "Committee attendance authorized", oldStatus: "Awaiting Final Admin Review", newStatus: "Authorized for Committee", revision: "Package rev 1", channel: "Teams" });
  }
  if (s.status === "Withdrawn") {
    add(0.5, { actor: s.owner, eventType: "Withdrawal", action: "Submission withdrawn", oldStatus: "Checklist in Progress", newStatus: "Withdrawn", channel: "App", reason: "Product shelved for this financial year." });
  }
  if (s.blocker?.includes("canceled")) {
    add(0.97, { actor: "Kate", eventType: "Slot", action: "Meeting canceled; slot allocation released", channel: "App", reason: "Committee quorum not available." });
  }
  return out;
}

const events: BusinessEvent[] = submissions.flatMap(buildEvents);
const newestFirst = (a: BusinessEvent, b: BusinessEvent) => b.occurredAt.localeCompare(a.occurredAt);

const ACTIONS: Record<AdminAction, { from: SubmissionStatus; to: SubmissionStatus; needsReason: boolean; type: string; label: string }> = {
  approveOnboarding: { from: "Awaiting Onboarding Review", to: "Checklist in Progress", needsReason: false, type: "Slot", label: "Onboarding approved; slot confirmed" },
  denyOnboarding: { from: "Awaiting Onboarding Review", to: "Onboarding Denied", needsReason: true, type: "Slot", label: "Onboarding denied" },
  authorize: { from: "Awaiting Final Admin Review", to: "Authorized for Committee", needsReason: false, type: "Admission", label: "Committee attendance authorized" },
  returnFinal: { from: "Awaiting Final Admin Review", to: "Final Changes Requested", needsReason: true, type: "Admission", label: "Returned for changes" },
  rejectFinal: { from: "Awaiting Final Admin Review", to: "Final Rejected", needsReason: true, type: "Admission", label: "Admission rejected" },
};

function decide(id: string, action: AdminAction, comment: string): ActionResult {
  const s = submissions.find((x) => x.id === id);
  const a = ACTIONS[action];
  if (!s) return { ok: false, error: "Submission not found." };
  if (s.status !== a.from) return { ok: false, error: "This request has already been resolved." };
  if (a.needsReason && !comment.trim()) return { ok: false, error: "Enter a reason before recording this decision." };
  if ((action === "approveOnboarding" || action === "authorize") && !s.meetingDate) {
    return { ok: false, error: "There is no valid meeting slot. Assign a slot before approving." };
  }
  const old = s.status;
  s.status = a.to;
  s.blocker = undefined;
  if (action === "approveOnboarding") {
    s.slotConfirmed = true;
    s.functionalRequired = 6;
    s.nextAction = "Complete the checklist";
    s.nextActor = "Submitter";
  } else if (action === "authorize") {
    s.nextAction = "Attend committee";
    s.nextActor = "None";
  } else {
    s.nextAction = action === "rejectFinal" ? "Closed pending reopen" : "Revise and resubmit";
    s.nextActor = "Submitter";
    s.blocker = `Kate: ${comment.trim()}`;
    if (action === "returnFinal") s.signatoriesApproved = 0;
  }
  events.push({
    id: `${s.id}-d${events.length}`,
    submissionId: s.id,
    reference: s.reference,
    occurredAt: new Date().toISOString(),
    actor: "Kate",
    eventType: a.type,
    action: a.label,
    oldStatus: old,
    newStatus: a.to,
    revision: action.includes("Onboarding") ? "Onboarding rev 1" : "Package rev 1",
    channel: "App",
    reason: comment.trim() || undefined,
  });
  return { ok: true };
}

export const sampleSource: DataSource = {
  async listEvents(submissionId) {
    return events.filter((e) => !submissionId || e.submissionId === submissionId).sort(newestFirst);
  },
  async decide(id, action, comment) {
    return decide(id, action, comment);
  },
  isSample: true,
  async listSubmissions() {
    return submissions.map((x) => ({ ...x }));
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
