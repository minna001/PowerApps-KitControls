import type { DecisionState, SectionStatus, SubmissionStatus } from "../data/types";

export function Meter({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="meter" role="img" aria-label={`${label} ${pct}%`}>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="meter-num">{pct}%</span>
    </div>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "info";

const STATUS_TONE: Record<SubmissionStatus, Tone> = {
  "Onboarding Draft": "neutral",
  "Awaiting Onboarding Review": "info",
  "Onboarding Denied": "bad",
  "Checklist in Progress": "neutral",
  "Awaiting Signatory Approval": "info",
  "Ready for Final Submission": "warn",
  "Awaiting Final Admin Review": "info",
  "Final Changes Requested": "bad",
  "Final Rejected": "bad",
  "Authorized for Committee": "good",
  Withdrawn: "neutral",
};

const SECTION_TONE: Record<SectionStatus, Tone> = {
  "Not Started": "neutral",
  Draft: "neutral",
  "Ready to Submit": "warn",
  "Under Review": "info",
  "Changes Requested": "bad",
  Approved: "good",
  "Not Applicable": "neutral",
};

const DECISION_TONE: Record<DecisionState, Tone> = {
  "Not requested": "neutral",
  Pending: "info",
  Approved: "good",
  Returned: "bad",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export const StatusPill = ({ status }: { status: SubmissionStatus }) => <Pill tone={STATUS_TONE[status]}>{status}</Pill>;
export const SectionPill = ({ status }: { status: SectionStatus }) => <Pill tone={SECTION_TONE[status]}>{status}</Pill>;
export const DecisionPill = ({ state }: { state: DecisionState }) => <Pill tone={DECISION_TONE[state]}>{state}</Pill>;

export function formatDate(iso?: string): string {
  if (!iso) return "None";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
