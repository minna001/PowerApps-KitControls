import { useEffect, useState } from "react";
import { Tab, TabList } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import type { DataSource } from "../data/source";
import { PHASES, phaseIndex, type BusinessEvent, type ExportInfo, type OpResult, type SubmissionDetail, type UserContext } from "../data/types";
import { buildMemo } from "../memo";
import { saveToDisk } from "../files";
import { formatDateTime } from "../components/ui";
import { Checklist } from "../components/Checklist";
import { SignatoryPanel } from "../components/SignatoryPicker";
import { SIGNATORY_SEATS } from "../data/types";
import { MeetingUpdates } from "../components/MeetingUpdates";
import { Notice } from "../components/ui";
import { Button } from "@fluentui/react-components";
import { AdminDecision } from "../components/AdminDecision";
import { TimelineTable } from "../components/Timeline";
import { DecisionPill, Meter, Pill, SectionPill, StatusPill, formatDate } from "../components/bits";

const TABS = ["Overview", "Checklist", "Timeline"];

function currentPhase(s: SubmissionDetail): number {
  const p = phaseIndex(s.status);
  if (p === 1 && s.sections.some((x) => x.status === "Under Review" || x.status === "Approved")) return 2;
  return p;
}

export function Workspace({ source, user, id, initialTab }: { source: DataSource; user: UserContext; id: string; initialTab?: string }) {
  const [s, setS] = useState<SubmissionDetail | null | undefined>(null);
  const [tab, setTab] = useState(initialTab && TABS.includes(initialTab) ? initialTab : "Overview");
  const [result, setResult] = useState<OpResult<unknown>>();
  const [busy, setBusy] = useState(false);

  const [events, setEvents] = useState<BusinessEvent[]>([]);
  const [exports, setExports] = useState<ExportInfo[]>([]);

  const load = () => {
    source.getSubmission(id).then(setS);
    source.listEvents(id).then(setEvents);
    source.listExports(id).then(setExports);
  };
  useEffect(() => {
    setS(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, id]);

  if (s === null) return <p>Loading…</p>;
  if (s === undefined)
    return (
      <p>
        No submission with reference {id}. <a href="#/portfolio">Back to the register</a>
      </p>
    );

  const phase = currentPhase(s);
  const isOwner = s.ownerId === user.userId || source.isSample;
  const checklistOpen = s.status === "Checklist in Progress" || s.status === "Final Changes Requested";

  async function run(op: () => Promise<OpResult>) {
    setBusy(true);
    const r = await op();
    setResult(r);
    setBusy(false);
    if (r.ok) load();
  }

  async function generateMemo() {
    setBusy(true);
    try {
      const memo = await buildMemo(source, user, id);
      const saved = await source.saveMemo(id, memo.fileName, memo.base64);
      setResult(saved);
      if (saved.ok) {
        saveToDisk({ fileName: memo.fileName, contentType: "application/pdf", base64: memo.base64 });
        load();
      }
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "The memo could not be generated." });
    }
    setBusy(false);
  }
  async function downloadMemo(exportId: string) {
    const r = await source.downloadFile("export", exportId);
    if (r.ok) saveToDisk(r.data);
    else setResult(r);
  }

  // What the business owner can do next, if anything.
  let ownerAction: { label: string; hint: string; go: () => void } | undefined;
  if (isOwner) {
    if (s.status === "Onboarding Draft" || s.status === "Onboarding Denied")
      ownerAction = { label: s.status === "Onboarding Denied" ? "Revise onboarding" : "Continue onboarding", hint: "Complete the intake details and submit the request.", go: () => (window.location.hash = `#/onboarding/${s.id}`) };
    else if (checklistOpen) ownerAction = { label: "Open the checklist", hint: "Answer each section and submit it for functional review.", go: () => setTab("Checklist") };
    else if (s.status === "Ready for Final Submission") ownerAction = { label: "Make final submission", hint: "Every section and all six signatories are approved. Send the package to the NBPRA administrator.", go: () => run(() => source.finalSubmit(s.id)) };
  }
  const applicable = s.sections.filter((x) => x.status !== "Not Applicable");
  const approvedSections = applicable.filter((x) => x.status === "Approved").length;

  return (
    <>
      <div className="crumb">
        <a href="#/portfolio">All submissions</a> / <span className="mono">{s.reference}</span>
      </div>
      <div className="ws-head">
        <div>
          <h1 className="page-title">{s.title}</h1>
          <div className="ws-meta">
            {[s.businessArea, `Owner ${s.owner}`, s.sponsor ? `Sponsor ${s.sponsor}` : "", `Committee ${formatDate(s.meetingDate)}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="ws-badges">
          <StatusPill status={s.status} />
          <Pill>Open {s.ageDays}d</Pill>
        </div>
      </div>

      <Notice result={result} />
      <ol className="rail" aria-label="Progress">
        {PHASES.map((p, i) => {
          const finished = s.status === "Authorized for Committee";
          const state = phase < 0 ? "todo" : i < phase || finished ? "done" : i === phase ? "now" : "todo";
          return (
            <li key={p} className={`rail-step ${state}`} aria-current={state === "now" ? "step" : undefined}>
              <div className="rail-name">{p}</div>
              <div className="rail-state">{state === "done" ? "Done" : state === "now" ? "In progress" : "Not started"}</div>
            </li>
          );
        })}
      </ol>

      <div className="ws-body">
        <section>
          <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as string)}>
            {TABS.map((t) => (
              <Tab key={t} value={t}>
                {t}
              </Tab>
            ))}
          </TabList>

          {tab === "Overview" ? (
            <div className="tab-body">
              <div className="ov-head">
                <h2 className="section-title">Overview</h2>
                <div className="ov-meter">
                  <span>Data complete</span>
                  <Meter pct={s.completenessPct} label="Data complete" />
                </div>
              </div>

              <div className="stats">
                <Stat big={`${approvedSections} / ${applicable.length}`} label="Sections approved" />
                <Stat big={`${s.functionalApproved} / ${s.functionalRequired}`} label="Functional group approvals" />
                <Stat big={`${s.signatoriesApproved} / ${SIGNATORY_SEATS}`} label="Signatory approvals" />
              </div>

              {s.blockers.length > 0 && (
                <div className="blockers" role="alert">
                  <div className="blockers-head">
                    <ErrorCircleRegular /> Blocking issues
                  </div>
                  {s.blockers.map((b) => (
                    <div key={b} className="blocker-row">
                      {b}
                    </div>
                  ))}
                </div>
              )}

              <h3 className="sub-title">Sections</h3>
              <div className="table-wrap">
                <table className="register compact">
                  <thead>
                    <tr>
                      <th scope="col">Section</th>
                      <th scope="col">Status</th>
                      <th scope="col">Required groups</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.sections.map((x) => (
                      <tr key={x.code}>
                        <td>
                          {x.id ? (
                            <button className="link plain" onClick={() => setTab("Checklist")}>
                              {x.title}
                            </button>
                          ) : (
                            x.title
                          )}
                          {x.revision > 0 && <span className="row-sub"> · rev {x.revision}</span>}
                        </td>
                        <td>
                          <SectionPill status={x.status} />
                        </td>
                        <td>
                          {x.groups.length === 0
                            ? "—"
                            : x.groups.map((g) => (
                                <span key={g.name} className="group">
                                  {g.name} <DecisionPill state={g.state} />
                                </span>
                              ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : tab === "Checklist" ? (
            <div className="tab-body">
              <Checklist source={source} sections={s.sections} canEdit={isOwner && checklistOpen} onChanged={load} />
            </div>
          ) : tab === "Timeline" ? (
            <div className="tab-body">
              <TimelineTable events={events} />
            </div>
          ) : null}
        </section>

        <aside className="ws-side">
          {user.isAdmin && (
            <AdminDecision
              source={source}
              submission={s}
              onDone={() => {
                setResult(undefined);
                load();
              }}
            />
          )}
          <MeetingUpdates
            source={source}
            submission={s}
            canPost={user.isAdmin && !source.isSample}
            onPosted={(r) => {
              setResult(r);
              if (r.ok) load();
            }}
          />

          <div className="panel">
            <div className="panel-head">Next action</div>
            <div className="panel-body">
              <div className="next-title">{s.nextAction}</div>
              {s.nextActor !== "None" && <div className="muted">Waiting on: {s.nextActor === "Kate" ? "NBPRA administrator" : s.nextActor}</div>}
              {ownerAction && (
                <>
                  <p className="muted decision-hint">{ownerAction.hint}</p>
                  <Button appearance="primary" disabled={busy} onClick={ownerAction.go}>
                    {ownerAction.label}
                  </Button>
                </>
              )}
            </div>
          </div>

          <SignatoryPanel
            source={source}
            submissionId={s.id}
            signatories={s.signatories}
            canEdit={isOwner && !source.isSample && (checklistOpen || s.status === "Ready for Final Submission")}
            canRecord={user.isAdmin && !source.isSample}
            onResult={(r) => {
              setResult(r as typeof result);
              if (r.ok) load();
            }}
          />

          <div className="panel">
            <div className="panel-head">Committee memo</div>
            <div className="panel-body">
              <p className="muted decision-hint">A PDF brief of this submission for the committee: details, approvals, checklist responses, evidence list and decision history.</p>
              {(isOwner || user.isAdmin) && !source.isSample && (
                <Button disabled={busy} onClick={generateMemo}>
                  {busy ? "Working…" : "Generate memo (PDF)"}
                </Button>
              )}
              {exports.length > 0 && (
                <ul className="memo-list">
                  {exports.slice(0, 4).map((x) => (
                    <li key={x.id}>
                      <button className="link plain" onClick={() => downloadMemo(x.id)}>
                        {x.type} memo
                      </button>
                      <span className="muted"> · {formatDateTime(x.generatedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">Key information</div>
            <dl className="facts">
              <dt>Status</dt>
              <dd>{s.status}</dd>
              <dt>Committee date</dt>
              <dd>{formatDate(s.meetingDate)}</dd>
              <dt>Place</dt>
              <dd>{s.meetingDate ? (s.slotConfirmed ? "Confirmed" : "Requested") : "None"}</dd>
              <dt>Owner</dt>
              <dd>{s.owner}</dd>
            </dl>
          </div>
        </aside>
      </div>
    </>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div className="stat">
      <div className="stat-big">{big}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
