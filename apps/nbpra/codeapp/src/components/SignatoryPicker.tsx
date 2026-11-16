import { useEffect, useState } from "react";
import { Button, Field, Select } from "@fluentui/react-components";
import type { DataSource } from "../data/source";
import type { OpResult, Person } from "../data/types";

/**
 * The business owner names the five signatories here, once every checklist
 * section is approved, and sends them the complete package in one step.
 */
export function SignatoryPicker({ source, submissionId, onResult }: { source: DataSource; submissionId: string; onResult: (r: OpResult) => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [seats, setSeats] = useState<string[]>(["", "", "", "", ""]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    source.listPeople().then(setPeople);
    // After a returned package the earlier names are offered again and can be changed.
    source.getIntake(submissionId).then((i) => setSeats([0, 1, 2, 3, 4].map((n) => i.signatories[n] ?? "")));
  }, [source, submissionId]);

  const chosen = seats.filter(Boolean);
  async function send() {
    setBusy(true);
    onResult(await source.requestSignatories(submissionId, seats));
    setBusy(false);
  }

  return (
    <div className="panel decision">
      <div className="panel-head">
        Name the five signatories <span className="mono">{chosen.length} of 5</span>
      </div>
      <div className="panel-body fields">
        <p className="muted decision-hint">Every section is approved. Choose five different people; each must approve the complete package before you can make the final submission.</p>
        {seats.map((v, i) => {
          const clash = v !== "" && seats.indexOf(v) !== i;
          return (
            <Field key={i} label={`Signatory ${i + 1}`} required validationState={clash ? "warning" : "none"} validationMessage={clash ? "Already chosen for another seat." : undefined}>
              <Select value={v} onChange={(_, d) => setSeats(seats.map((x, n) => (n === i ? d.value : x)))}>
                <option value="">Select a person…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          );
        })}
        <Button appearance="primary" disabled={busy || chosen.length < 5} onClick={send}>
          {busy ? "Sending…" : "Send to the five signatories"}
        </Button>
      </div>
    </div>
  );
}
