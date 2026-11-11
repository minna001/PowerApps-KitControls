import { useEffect, useState } from "react";
import { Button, Field, Textarea } from "@fluentui/react-components";
import type { DataSource } from "../data/source";
import type { OpResult, ReviewDetail, ReviewTask, SignatoryTask } from "../data/types";
import { Notice, PageHead, formatDateTime } from "../components/ui";

/** Functional review worklist and the signed-in user's signatory approvals. */
export function Approvals({ source }: { source: DataSource }) {
  const [reviews, setReviews] = useState<ReviewTask[]>();
  const [seats, setSeats] = useState<SignatoryTask[]>();
  const [open, setOpen] = useState<ReviewDetail>();
  const [comment, setComment] = useState("");
  const [result, setResult] = useState<OpResult<unknown>>();
  const [busy, setBusy] = useState(false);

  const load = () => {
    source.listReviewTasks().then(setReviews);
    source.listSignatoryTasks().then(setSeats);
  };
  useEffect(load, [source]);

  async function run(op: () => Promise<OpResult>) {
    setBusy(true);
    const r = await op();
    setResult(r);
    setBusy(false);
    if (r.ok) {
      setOpen(undefined);
      setComment("");
      load();
    }
  }
  async function openReview(t: ReviewTask) {
    setResult(undefined);
    setComment("");
    setOpen(open?.requestId === t.requestId ? undefined : await source.getReview(t.requestId));
  }

  return (
    <>
      <PageHead eyebrow="My work" title="My approvals" />
      <Notice result={result} />

      <h2 className="sub-title">Functional reviews</h2>
      <p className="muted">Pending section reviews. You can decide the ones assigned to a group you belong to.</p>
      {reviews === undefined ? (
        <p className="muted">Loading…</p>
      ) : reviews.length === 0 ? (
        <div className="empty-card">No functional reviews are waiting.</div>
      ) : (
        <div className="stack">
          {reviews.map((t) => (
            <div key={t.requestId} className="panel">
              <div className="task-row">
                <div>
                  <div className="next-title">{t.section}</div>
                  <div className="muted">
                    <a href={`#/submission/${t.submissionId}`}>{t.title}</a> · <span className="mono">{t.reference}</span> · {t.team} · requested {formatDateTime(t.requestedAt)}
                  </div>
                </div>
                <Button onClick={() => openReview(t)}>{open?.requestId === t.requestId ? "Close" : "Review"}</Button>
              </div>
              {open?.requestId === t.requestId && (
                <div className="panel-body review">
                  <dl className="answers">
                    {open.answers.map((a) => (
                      <div key={a.label}>
                        <dt>{a.label}</dt>
                        <dd>{a.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <Field label="Comment (required to request changes)">
                    <Textarea value={comment} onChange={(_, d) => setComment(d.value)} rows={3} resize="vertical" />
                  </Field>
                  <div className="actions">
                    <Button appearance="primary" disabled={busy} onClick={() => run(() => source.decideReview(t.requestId, "approve", comment))}>
                      Approve section
                    </Button>
                    <Button disabled={busy} onClick={() => run(() => source.decideReview(t.requestId, "changes", comment))}>
                      Request changes
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <h2 className="sub-title">Signatory approvals</h2>
      <p className="muted">Complete packages waiting for your approval as a named signatory.</p>
      {seats === undefined ? (
        <p className="muted">Loading…</p>
      ) : seats.length === 0 ? (
        <div className="empty-card">No signatory approvals are waiting on you.</div>
      ) : (
        <div className="stack">
          {seats.map((t) => (
            <div key={t.assignmentId} className="panel">
              <div className="task-row">
                <div>
                  <div className="next-title">
                    {t.title} · {t.seat}
                  </div>
                  <div className="muted">
                    <span className="mono">{t.reference}</span> · package revision {t.packageRevision} · <a href={`#/submission/${t.submissionId}`}>open the package</a>
                  </div>
                </div>
                <div className="actions tight">
                  <Button appearance="primary" disabled={busy} onClick={() => run(() => source.decideSignatory(t.assignmentId, "approve", ""))}>
                    Approve
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt("Reason for returning the package (required):", "");
                      if (reason !== null) run(() => source.decideSignatory(t.assignmentId, "return", reason));
                    }}
                  >
                    Return
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
