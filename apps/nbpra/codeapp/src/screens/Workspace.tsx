import { useEffect, useState } from "react";
import { Tab, TabList } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import type { DataSource } from "../data/source";
import { PHASES, phaseIndex, type BusinessEvent, type SubmissionDetail } from "../data/types";
import { AdminDecision } from "../components/AdminDecision";
import { TimelineTable } from "../components/Timeline";
import { DecisionPill, Meter, Pill, SectionPill, StatusPill, formatDate } from "../components/bits";

const TABS = ["Overview", "Checklist", "Evidence", "Functional reviews", "Signatories", "Communications", "Timeline"];

function currentPhase(s: SubmissionDetail): number {
  const p = phaseIndex(s.status);
  if (p === 1 && s.sections.some((x) => x.status === "Under Review" || x.status === "Approved")) return 2;
  return p;
}

export function Workspace({ source, id }: { source: DataSource; id: string }) {
  const [s, setS] = useState<SubmissionDetail | null | undefined>(null);
  const [tab, setTab] = useState("Overview");

  const [events, setEvents] = useState<BusinessEvent[]>([]);

  const load = () => {
    source.getSubmission(id).then(setS);
    source.listEvents(id).then(setEvents);
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
  const applicable = s.sections.filter((x) => x.status !== "Not Applicable");
  const answered = applicable.reduce((n, x) => n + x.answered, 0);
  const required = applicable.reduce((n, x) => n + x.required, 0);
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
            {s.businessArea} · Owner {s.owner} · Sponsor {s.sponsor} · Committee {formatDate(s.meetingDate)}
            {s.slot ? `, ${s.slot}` : ""}
          </div>
        </div>
        <div className="ws-badges">
          <StatusPill status={s.status} />
          <Pill>Open {s.ageDays}d</Pill>
        </div>
      </div>

      <ol className="rail" aria-label="Progress">
        {PHASES.map((p, i) => {
          const state = phase < 0 ? "todo" : i < phase ? "done" : i === phase ? "now" : "todo";
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
                <Stat big={required ? `${answered} / ${required}` : "—"} label="Required answers saved" />
                <Stat big={`${approvedSections} / ${applicable.length}`} label="Sections approved" />
                <Stat big={`${s.functionalApproved} / ${s.functionalRequired}`} label="Functional group approvals" />
                <Stat big={`${s.signatoriesApproved} / 5`} label="Signatory approvals" />
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
                      <th scope="col">Answers</th>
                      <th scope="col">Status</th>
                      <th scope="col">Required groups</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.sections.map((x) => (
                      <tr key={x.code}>
                        <td>
                          {x.title}
                          {x.revision > 0 && <span className="row-sub"> · rev {x.revision}</span>}
                        </td>
                        <td className="nowrap">{x.status === "Not Applicable" || x.required === 0 ? "—" : `${x.answered} / ${x.required}`}</td>
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
          ) : tab === "Timeline" ? (
            <div className="tab-body">
              <TimelineTable events={events} />
            </div>
          ) : (
            <div className="tab-body">
              <p className="muted">The {tab} tab is not built yet.</p>
            </div>
          )}
        </section>

        <aside className="ws-side">
          <AdminDecision source={source} submission={s} onDone={load} />
          <div className="panel">
            <div className="panel-head">Next action</div>
            <div className="panel-body">
              <div className="next-title">{s.nextAction}</div>
              <div className="muted">Waiting on: {s.nextActor}</div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              Five signatories <span className="mono">{s.signatoriesApproved} of 5</span>
            </div>
            {s.signatories.map((p) => (
              <div key={p.slot} className="sig-row">
                <span>{p.name}</span>
                <DecisionPill state={p.state} />
              </div>
            ))}
          </div>

          <div className="panel">
            <div className="panel-head">Key information</div>
            <dl className="facts">
              <dt>Status</dt>
              <dd>{s.status}</dd>
              <dt>Committee date</dt>
              <dd>{formatDate(s.meetingDate)}</dd>
              <dt>Slot</dt>
              <dd>{s.slot ? `${s.slot} (${s.slotConfirmed ? "confirmed" : "requested"})` : "None"}</dd>
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
