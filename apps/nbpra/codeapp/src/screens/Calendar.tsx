import { useEffect, useState } from "react";
import type { DataSource } from "../data/source";
import type { MeetingInfo } from "../data/types";
import { Pill } from "../components/bits";
import { PageHead, formatDateTime, formatTime, zone } from "../components/ui";

/** Slot finder. Choosing a slot starts a new onboarding request, or returns to the one being edited. */
export function Calendar({ source, forSubmission }: { source: DataSource; forSubmission?: string }) {
  const [meetings, setMeetings] = useState<MeetingInfo[]>();

  useEffect(() => {
    source.listMeetings().then(setMeetings);
  }, [source]);

  const target = (slotId: string) => (forSubmission ? `#/onboarding/${forSubmission}?slot=${slotId}` : `#/new?slot=${slotId}`);

  return (
    <>
      <PageHead eyebrow="Committee" title="Calendar and slots" />
      <p className="lead">
        Choose an open slot to request it. A request is not a booking: the NBPRA administrator confirms the slot when they approve your onboarding. Times are shown in {zone}.
      </p>
      {meetings === undefined ? (
        <p className="muted">Loading…</p>
      ) : meetings.length === 0 ? (
        <div className="empty-card">
          <p>No upcoming committee meetings are scheduled.</p>
        </div>
      ) : (
        meetings.map((m) => {
          const free = m.slots.filter((s) => s.requestable).length;
          return (
            <section key={m.id} className="meeting">
              <div className="meeting-head">
                <div>
                  <h2 className="section-title">{formatDateTime(m.startAt)}</h2>
                  <div className="muted">
                    {m.committee} · {m.name}
                    {m.requestCloseAt ? ` · requests close ${formatDateTime(m.requestCloseAt)}` : ""}
                  </div>
                </div>
                <Pill tone={m.status === "Open" && free > 0 ? "good" : m.status === "Canceled" ? "bad" : "neutral"}>{m.status === "Open" ? `${free} of ${m.slots.length} slots open` : m.status}</Pill>
              </div>
              <div className="slots">
                {m.slots.map((s) =>
                  s.requestable ? (
                    <a key={s.id} className="slot open" href={target(s.id)} aria-label={`Request slot ${formatTime(s.startAt)} to ${formatTime(s.endAt)}`}>
                      <span className="slot-time">
                        {formatTime(s.startAt)}–{formatTime(s.endAt)}
                      </span>
                      <span className="slot-state">Request</span>
                    </a>
                  ) : (
                    <span key={s.id} className="slot taken">
                      <span className="slot-time">
                        {formatTime(s.startAt)}–{formatTime(s.endAt)}
                      </span>
                      <span className="slot-state">{s.status !== "Open" ? s.status : s.allocated >= s.capacity ? "Taken" : "Closed"}</span>
                    </span>
                  ),
                )}
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
