import { useState } from "react";
import { Button, Field, Textarea } from "@fluentui/react-components";
import type { DataSource } from "../data/source";
import type { AdminAction, SubmissionDetail } from "../data/types";

const SETS: Partial<Record<SubmissionDetail["status"], { title: string; hint: string; actions: { action: AdminAction; label: string; primary?: boolean }[] }>> = {
  "Awaiting Onboarding Review": {
    title: "Onboarding decision",
    hint: "Approving confirms the slot and unlocks the checklist. Denying needs a reason.",
    actions: [
      { action: "approveOnboarding", label: "Approve and unlock checklist", primary: true },
      { action: "denyOnboarding", label: "Deny" },
    ],
  },
  "Awaiting Final Admin Review": {
    title: "Committee admission decision",
    hint: "Returning or rejecting needs a reason.",
    actions: [
      { action: "authorize", label: "Authorize committee attendance", primary: true },
      { action: "returnFinal", label: "Return for changes" },
      { action: "rejectFinal", label: "Reject admission" },
    ],
  },
};

export function AdminDecision({ source, submission, onDone }: { source: DataSource; submission: SubmissionDetail; onDone: () => void }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = SETS[submission.status];
  if (!set) return null;

  async function run(action: AdminAction) {
    setBusy(true);
    setError("");
    const r = await source.decide(submission.id, action, comment);
    setBusy(false);
    if (r.ok) {
      setComment("");
      onDone();
    } else setError(r.error);
  }

  return (
    <div className="panel decision">
      <div className="panel-head">{set.title}</div>
      <div className="panel-body">
        <p className="muted decision-hint">{set.hint}</p>
        <Field label="Comment" validationState={error ? "error" : "none"} validationMessage={error || undefined}>
          <Textarea value={comment} onChange={(_, d) => setComment(d.value)} rows={3} resize="vertical" />
        </Field>
        <div className="decision-actions">
          {set.actions.map((a) => (
            <Button key={a.action} appearance={a.primary ? "primary" : "secondary"} disabled={busy} onClick={() => run(a.action)}>
              {a.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
