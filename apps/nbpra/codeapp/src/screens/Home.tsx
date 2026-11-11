import { useEffect, useState } from "react";
import type { DataSource } from "../data/source";
import type { ReviewTask, SignatoryTask, Submission, UserContext } from "../data/types";
import { StatusPill, formatDate } from "../components/bits";
import { PageHead } from "../components/ui";

const CLOSED = ["Withdrawn", "Authorized for Committee"];

export function Home({ source, user }: { source: DataSource; user: UserContext }) {
  const [subs, setSubs] = useState<Submission[]>();
  const [reviews, setReviews] = useState<ReviewTask[]>([]);
  const [seats, setSeats] = useState<SignatoryTask[]>([]);

  useEffect(() => {
    source.listSubmissions().then(setSubs);
    source.listReviewTasks().then(setReviews);
    source.listSignatoryTasks().then(setSeats);
  }, [source]);

  const mine = (subs ?? []).filter((s) => s.owner === user.fullName);
  const active = mine.filter((s) => !CLOSED.includes(s.status));
  const queue = (subs ?? []).filter((s) => s.nextActor === "Kate");

  return (
    <>
      <PageHead eyebrow="Home" title={`Welcome, ${user.fullName.split(" ")[0]}`}>
        <div className="head-actions">
          <a className="btn" href="#/reuse">
            Start from a previous submission
          </a>
          <a className="btn primary" href="#/calendar">
            Start a new submission
          </a>
        </div>
      </PageHead>

      <div className="tiles">
        <a className="tile" href="#/mine">
          <div className="tile-num">{active.length}</div>
          <div className="tile-label">My active submissions</div>
        </a>
        <a className="tile" href="#/approvals">
          <div className="tile-num">{reviews.length}</div>
          <div className="tile-label">Functional reviews waiting</div>
        </a>
        <a className="tile" href="#/approvals">
          <div className="tile-num">{seats.length}</div>
          <div className="tile-label">Signatory approvals waiting on me</div>
        </a>
        {user.isAdmin && (
          <a className="tile" href="#/queue">
            <div className="tile-num">{queue.length}</div>
            <div className="tile-label">Awaiting my admin decision</div>
          </a>
        )}
      </div>

      <h2 className="sub-title">My submissions</h2>
      {subs === undefined ? (
        <p className="muted">Loading…</p>
      ) : mine.length === 0 ? (
        <div className="empty-card">
          <p>You have no submissions yet.</p>
          <p className="muted">Pick a committee slot from the calendar, then fill in the onboarding details. The checklist opens once the NBPRA administrator approves the request.</p>
          <a className="btn primary" href="#/calendar">
            Find a committee slot
          </a>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="register compact">
            <thead>
              <tr>
                <th scope="col">Proposal</th>
                <th scope="col">Status</th>
                <th scope="col">Next action</th>
                <th scope="col">Committee</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((s) => (
                <tr key={s.id}>
                  <td>
                    <a className="row-title" href={`#/submission/${s.id}`}>
                      {s.title}
                    </a>
                    <div className="row-sub mono">{s.reference}</div>
                  </td>
                  <td>
                    <StatusPill status={s.status} />
                  </td>
                  <td>
                    {s.nextAction}
                    {s.blocker && <div className="blocked">{s.blocker}</div>}
                  </td>
                  <td className="nowrap">
                    {formatDate(s.meetingDate)}
                    {s.slot && <div className="row-sub">{s.slot} · {s.slotConfirmed ? "confirmed" : "requested"}</div>}
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
