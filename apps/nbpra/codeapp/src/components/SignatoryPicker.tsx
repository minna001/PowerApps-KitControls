import { useState } from "react";
import { Button, Field, Input } from "@fluentui/react-components";
import type { DataSource } from "../data/source";
import { SIGNATORY_SEATS, type OpResult, type Person, type Signatory } from "../data/types";
import { DecisionPill } from "./bits";
import { PeoplePicker } from "./PeoplePicker";
import { formatDateTime } from "./ui";

interface Props {
  source: DataSource;
  submissionId: string;
  signatories: Signatory[];
  /** The business owner, while signatories can still be chosen and asked. */
  canEdit: boolean;
  /** An administrator may record an answer that reached them outside the app. */
  canRecord: boolean;
  onResult: (r: OpResult<unknown>) => void;
}

/**
 * The six signatories: the sponsor from onboarding plus five the business owner
 * picks from the directory. Each is asked on their own, as soon as their area's
 * work is done, and answers from the approval email.
 */
export function SignatoryPanel({ source, submissionId, signatories, canEdit, canRecord, onResult }: Props) {
  const [editing, setEditing] = useState<number>();
  const [person, setPerson] = useState<Person | null>(null);
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const approved = signatories.filter((s) => s.state === "Approved").length;

  async function run(op: () => Promise<OpResult<unknown>>) {
    setBusy(true);
    const r = await op();
    setBusy(false);
    onResult(r);
    return r.ok;
  }
  function open(s: Signatory) {
    setEditing(s.slot);
    setPerson(null);
    setRole(s.role);
  }
  async function save(slot: number) {
    if (person && (await run(() => source.setSignatory(submissionId, slot, person, role.trim())))) setEditing(undefined);
  }
  function record(s: Signatory, outcome: "approve" | "return") {
    const how = window.prompt(outcome === "approve" ? `How did ${s.name} give their approval? (required)` : `Why did ${s.name} return the package? (required)`, "");
    if (how) run(() => source.decideSignatory(s.id, outcome, how));
  }

  return (
    <div className="panel">
      <div className="panel-head">
        Signatories{" "}
        <span className="mono">
          {approved} of {SIGNATORY_SEATS}
        </span>
      </div>
      {canEdit && <div className="sig-row muted sig-hint">Ask each signatory as soon as their area is done. All six must approve before the final submission.</div>}
      {signatories.map((s) => {
        const sponsor = s.slot === 1;
        const label = s.role || (sponsor ? "Business unit sponsor" : `Signatory ${s.slot}`);
        if (editing === s.slot)
          return (
            <div key={s.slot} className="sig-edit fields">
              {!sponsor && (
                <Field label="Signing for">
                  <Input value={role} onChange={(_, d) => setRole(d.value)} placeholder="For example Legal, Compliance or Finance" />
                </Field>
              )}
              <Field label={sponsor ? "Business unit sponsor" : "Person"} required>
                <PeoplePicker source={source} value={person} onChange={setPerson} />
              </Field>
              <div className="actions tight">
                <Button appearance="primary" disabled={busy || !person} onClick={() => save(s.slot)}>
                  Save
                </Button>
                <Button disabled={busy} onClick={() => setEditing(undefined)}>
                  Cancel
                </Button>
              </div>
            </div>
          );
        return (
          <div key={s.slot} className="sig-seat">
            <div className="sig-row">
              <div>
                <div className="sig-role">{label}</div>
                {s.name ? <div className="person-name">{s.name}</div> : <div className="muted">Not chosen yet</div>}
                {s.name && <div className="muted person-mail">{s.email}</div>}
              </div>
              {s.name && <DecisionPill state={s.state} />}
            </div>
            {s.state === "Pending" && s.requestedAt && <div className="sig-note muted">Asked {formatDateTime(s.requestedAt)}. They answer from the approval email.</div>}
            {s.state === "Returned" && <div className="sig-note">Returned{s.comment ? `: ${s.comment}` : "."}</div>}
            {s.state === "Approved" && s.decidedAt && <div className="sig-note muted">Approved {formatDateTime(s.decidedAt)}</div>}
            {(canEdit || canRecord) && (
              <div className="sig-actions">
                {canEdit && s.name && (s.state === "Not requested" || s.state === "Returned") && (
                  <Button size="small" appearance="primary" disabled={busy} onClick={() => run(() => source.sendSignatory(s.id))}>
                    {s.state === "Returned" ? "Ask again" : "Send for approval"}
                  </Button>
                )}
                {canEdit && s.state !== "Approved" && (
                  <Button size="small" disabled={busy} onClick={() => open(s)}>
                    {s.name ? "Change" : "Choose"}
                  </Button>
                )}
                {canRecord && s.state === "Pending" && (
                  <>
                    <Button size="small" disabled={busy} onClick={() => record(s, "approve")}>
                      Record approval
                    </Button>
                    <Button size="small" disabled={busy} onClick={() => record(s, "return")}>
                      Record return
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
