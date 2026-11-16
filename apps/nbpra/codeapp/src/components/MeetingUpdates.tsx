import { useState } from "react";
import { Button, Field, Textarea } from "@fluentui/react-components";
import type { DataSource } from "../data/source";
import type { OpResult, SubmissionDetail } from "../data/types";
import { formatDateTime } from "./ui";

/**
 * Latest word from the administrator: an update for this submission (for
 * example when to join the meeting) and any update on the meeting itself.
 * The administrator can post a new one; earlier ones stay in the timeline.
 */
export function MeetingUpdates({ source, submission, canPost, onPosted }: { source: DataSource; submission: SubmissionDetail; canPost: boolean; onPosted: (r: OpResult) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const { adminNote, meetingNote } = submission;
  if (!adminNote && !meetingNote && !canPost) return null;

  async function post() {
    setBusy(true);
    const r = await source.postNote(submission.id, text);
    setBusy(false);
    if (r.ok) setText("");
    onPosted(r);
  }

  return (
    <div className="panel updates">
      <div className="panel-head">Meeting updates</div>
      <div className="panel-body">
        {adminNote ? (
          <div className="update">
            <div className="update-text">{adminNote.text}</div>
            <div className="muted update-meta">
              {adminNote.by} · {formatDateTime(adminNote.at)}
            </div>
          </div>
        ) : (
          !meetingNote && <div className="muted">No updates yet.</div>
        )}
        {meetingNote && (
          <div className="update">
            <div className="eyebrow">For everyone at this meeting</div>
            <div className="update-text">{meetingNote}</div>
          </div>
        )}
        {canPost && (
          <div className="update-post">
            <Field label="Post an update to the submitter">
              <Textarea value={text} onChange={(_, d) => setText(d.value)} rows={3} resize="vertical" placeholder="For example: please join at 2:30pm; you are third on the agenda." />
            </Field>
            <Button disabled={busy || !text.trim()} onClick={post}>
              {busy ? "Posting…" : "Post update"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
