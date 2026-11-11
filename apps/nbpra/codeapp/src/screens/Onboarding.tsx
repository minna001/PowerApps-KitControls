import { useEffect, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@fluentui/react-components";
import type { DataSource } from "../data/source";
import type { Intake, MeetingInfo, OpResult, Person, UserContext } from "../data/types";
import { Notice, PageHead, formatDateTime, formatTime, zone } from "../components/ui";

const AREAS = ["Commercial Banking", "Global Markets", "Payments", "Retail Banking", "Wealth"];
const TYPES = ["New business", "New product", "Product extension", "Material change"];
const BLANK: Intake = { title: "", businessArea: "", proposalType: "", summary: "", scope: "", sponsorId: "", slotId: "", signatories: ["", "", "", "", ""] };

/** Initial onboarding: intake details, requested slot and the five signatories (requirements 11.1). */
export function Onboarding({ source, user, id, pickedSlot }: { source: DataSource; user: UserContext; id?: string; pickedSlot?: string }) {
  const [intake, setIntake] = useState<Intake>();
  const [people, setPeople] = useState<Person[]>([]);
  const [meetings, setMeetings] = useState<MeetingInfo[]>([]);
  const [result, setResult] = useState<OpResult<unknown>>();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Becomes the new submission's id after the first save, without leaving the form.
  const [sid, setSid] = useState(id);

  useEffect(() => {
    source.listPeople().then(setPeople);
    source.listMeetings().then(setMeetings);
    (id ? source.getIntake(id) : Promise.resolve(BLANK)).then((i) => {
      setIntake(pickedSlot ? { ...i, slotId: pickedSlot } : i);
      if (pickedSlot && id) setDirty(true);
    });
  }, [source, id, pickedSlot]);

  if (!intake) return <p className="muted">Loading…</p>;

  const set = <K extends keyof Intake>(k: K, v: Intake[K]) => {
    setIntake({ ...intake, [k]: v });
    setDirty(true);
  };
  const setSeat = (i: number, v: string) => set("signatories", intake.signatories.map((x, n) => (n === i ? v : x)));

  const slot = meetings.flatMap((m) => m.slots.map((s) => ({ ...s, meeting: m }))).find((s) => s.id === intake.slotId);
  const chosen = intake.signatories.filter(Boolean);
  const duplicates = new Set(chosen).size < chosen.length;

  async function save(): Promise<string | undefined> {
    const r = await source.saveOnboarding(sid, intake!);
    setResult(r);
    if (!r.ok) return undefined;
    setDirty(false);
    if (!sid) {
      setSid(r.data);
      // Update the address so a refresh reopens this draft; replaceState does not reload the form.
      window.history.replaceState(null, "", `#/onboarding/${r.data}`);
    }
    return r.data;
  }
  async function onSave() {
    setBusy(true);
    await save();
    setBusy(false);
  }
  async function onSubmit() {
    setBusy(true);
    const saved = await save();
    if (saved) {
      const r = await source.submitOnboarding(saved);
      if (r.ok) {
        window.location.hash = `#/submission/${saved}`;
        return;
      }
      setResult(r);
    }
    setBusy(false);
  }

  return (
    <>
      <PageHead eyebrow="New submission" title="Initial onboarding" />
      <p className="lead">Save a draft at any point. When you submit, the request goes to the NBPRA administrator; the full checklist opens once they approve it.</p>
      <Notice result={result} />

      <div className="form-grid">
        <section className="panel">
          <div className="panel-head">Requested committee slot</div>
          <div className="panel-body">
            {slot ? (
              <>
                <div className="next-title">{formatDateTime(slot.meeting.startAt).replace(/,? \d\d:\d\d$/, "")}</div>
                <div>
                  {formatTime(slot.startAt)}–{formatTime(slot.endAt)} ({zone}) · {slot.meeting.committee}
                </div>
                <div className="muted mono">{slot.reference}</div>
                {!slot.requestable && <div className="blocked">This slot can no longer be requested. Choose another.</div>}
              </>
            ) : (
              <div className="muted">No slot chosen yet.</div>
            )}
            <p>
              <a className="link plain" href={sid ? `#/calendar?for=${sid}` : "#/calendar"}>
                {slot ? "Choose a different slot" : "Choose a slot from the calendar"}
              </a>
              {dirty ? <span className="muted"> — save your draft first, or unsaved changes are lost</span> : null}
            </p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">Proposal</div>
          <div className="panel-body fields">
            <Field label="Proposal title" required>
              <Input value={intake.title} onChange={(_, d) => set("title", d.value)} maxLength={200} />
            </Field>
            <div className="two">
              <Field label="Business area" required>
                <Select value={intake.businessArea} onChange={(_, d) => set("businessArea", d.value)}>
                  <option value="">Select…</option>
                  {AREAS.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Proposal classification" required>
                <Select value={intake.proposalType} onChange={(_, d) => set("proposalType", d.value)}>
                  <option value="">Select…</option>
                  {TYPES.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Brief business description" required>
              <Textarea value={intake.summary} onChange={(_, d) => set("summary", d.value)} rows={4} resize="vertical" />
            </Field>
            <Field label="Indicative jurisdictions and scope">
              <Input value={intake.scope} onChange={(_, d) => set("scope", d.value)} />
            </Field>
            <div className="two">
              <Field label="Business owner">
                <Input value={user.fullName} readOnly />
              </Field>
              <Field label="Business sponsor or contact">
                <Select value={intake.sponsorId} onChange={(_, d) => set("sponsorId", d.value)}>
                  <option value="">Select…</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            5 Signatories <span className="mono">{chosen.length} of 5</span>
          </div>
          <div className="panel-body fields">
            <p className="muted">Five different people. Each approves the complete package before final submission.</p>
            {intake.signatories.map((v, i) => {
              const clash = v !== "" && intake.signatories.indexOf(v) !== i;
              return (
                <Field key={i} label={`Signatory ${i + 1}`} required validationState={clash ? "error" : "none"} validationMessage={clash ? "This person is already in another signatory seat." : undefined}>
                  <Select value={v} onChange={(_, d) => setSeat(i, d.value)}>
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
            {duplicates && <p className="muted">The server decides whether repeated people are allowed; in a test environment with fewer than five users they may be.</p>}
          </div>
        </section>
      </div>

      <div className="actions">
        <Button appearance="primary" disabled={busy} onClick={onSubmit}>
          Submit request
        </Button>
        <Button disabled={busy} onClick={onSave}>
          Save draft
        </Button>
        <span className="muted">{busy ? "Saving…" : dirty ? "Unsaved changes" : sid ? "All changes saved" : ""}</span>
      </div>
    </>
  );
}
