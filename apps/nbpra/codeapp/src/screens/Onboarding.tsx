import { useEffect, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@fluentui/react-components";
import type { DataSource } from "../data/source";
import type { Intake, MeetingInfo, OpResult, UserContext } from "../data/types";
import { PeoplePicker } from "../components/PeoplePicker";
import { Notice, PageHead, formatDateTime, formatTime, zone } from "../components/ui";

const AREAS = ["Commercial Banking", "Global Markets", "Payments", "Retail Banking", "Wealth"];
const TYPES = ["New business", "New product", "Product extension", "Material change"];
const BLANK: Intake = { title: "", businessArea: "", proposalType: "", summary: "", scope: "", sponsor: null, slotId: "" };

/** Initial onboarding: intake details, the business unit sponsor and the requested meeting. The other five signatories are chosen later. */
export function Onboarding({ source, user, id, pickedSlot }: { source: DataSource; user: UserContext; id?: string; pickedSlot?: string }) {
  const [intake, setIntake] = useState<Intake>();
  const [meetings, setMeetings] = useState<MeetingInfo[]>([]);
  const [result, setResult] = useState<OpResult<unknown>>();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Becomes the new submission's id after the first save, without leaving the form.
  const [sid, setSid] = useState(id);

  useEffect(() => {
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

  const meeting = meetings.find((m) => m.slotId === intake.slotId);

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
      <p className="lead">Save a draft at any point. When you submit, the request goes to the NBPRA administrator; the full checklist opens once they approve it. You name the five signatories at the end, after every checklist section is approved.</p>
      {intake.copiedFrom && (
        <div className="notice info">
          Started from <span className="mono">{intake.copiedFrom}</span>. Its checklist answers will be waiting as drafts once this request is approved. Choose a meeting here; the meeting place, signatories, files and approvals are never copied.
        </div>
      )}
      <Notice result={result} />

      <div className="form-grid">
        <section className="panel">
          <div className="panel-head">Requested committee meeting</div>
          <div className="panel-body">
            {meeting ? (
              <>
                <div className="next-title">{formatDateTime(meeting.startAt)}</div>
                <div>
                  {meeting.committee} · until {formatTime(meeting.endAt)} ({zone})
                </div>
                <div className="muted">
                  {meeting.remaining} of {meeting.capacity} places left. The administrator confirms your place and tells you when to join.
                </div>
                {!meeting.requestable && <div className="blocked">This meeting can no longer be requested ({(meeting.closedReason ?? "closed").toLowerCase()}). Choose another.</div>}
              </>
            ) : intake.slotId ? (
              <div className="muted">A place is requested at a meeting that is no longer listed.</div>
            ) : (
              <div className="muted">No meeting chosen yet.</div>
            )}
            <p>
              <a className="link plain" href={sid ? `#/calendar?for=${sid}` : "#/calendar"}>
                {meeting ? "Choose a different meeting" : "Choose a meeting from the calendar"}
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
              <Field label="Business unit sponsor" required hint="Senior vice president or above. They approve the package at the end, with the other signatories.">
                <PeoplePicker source={source} value={intake.sponsor} onChange={(p) => set("sponsor", p)} />
              </Field>
            </div>
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
