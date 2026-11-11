import { useEffect, useState } from "react";
import { Button } from "@fluentui/react-components";
import type { DataSource } from "../data/source";
import type { OpResult, Submission, UserContext } from "../data/types";
import { StatusPill } from "../components/bits";
import { Notice, PageHead } from "../components/ui";

/** Start a new submission from one of your earlier ones. */
export function Reuse({ source, user }: { source: DataSource; user: UserContext }) {
  const [subs, setSubs] = useState<Submission[]>();
  const [result, setResult] = useState<OpResult<unknown>>();
  const [busy, setBusy] = useState("");

  useEffect(() => {
    source.listSubmissions().then((rows) => setSubs(rows.filter((r) => r.owner === user.fullName)));
  }, [source, user.fullName]);

  async function use(id: string) {
    setBusy(id);
    const r = await source.copySubmission(id);
    setBusy("");
    if (r.ok) window.location.hash = `#/onboarding/${r.data}`;
    else setResult(r);
  }

  return (
    <>
      <PageHead eyebrow="New submission" title="Start from a previous submission" />
      <p className="lead">
        The new draft takes the earlier submission's proposal details and, once its onboarding is approved, its checklist answers. You then change only what differs. It does not take the committee slot, the five signatories, any uploaded
        files or any approvals: those always start fresh.
      </p>
      <Notice result={result} />
      {subs === undefined ? (
        <p className="muted">Loading…</p>
      ) : subs.length === 0 ? (
        <div className="empty-card">
          <p>You have no earlier submissions to start from.</p>
          <a className="btn primary" href="#/calendar">
            Start a blank submission
          </a>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="register compact">
            <thead>
              <tr>
                <th scope="col">Proposal</th>
                <th scope="col">Status</th>
                <th scope="col">Checklist</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td>
                    <a className="row-title" href={`#/submission/${s.id}`}>
                      {s.title}
                    </a>
                    <div className="row-sub">
                      <span className="mono">{s.reference}</span> · {s.businessArea}
                    </div>
                  </td>
                  <td>
                    <StatusPill status={s.status} />
                  </td>
                  <td className="nowrap">{s.functionalRequired ? `${s.completenessPct}% complete` : "Not started"}</td>
                  <td className="num">
                    <Button disabled={busy !== ""} onClick={() => use(s.id)}>
                      {busy === s.id ? "Creating…" : "Use as starting point"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
