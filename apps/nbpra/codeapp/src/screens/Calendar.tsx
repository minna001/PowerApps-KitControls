import { useEffect, useState } from "react";
import type { DataSource } from "../data/source";
import type { MeetingInfo } from "../data/types";
import { Pill } from "../components/bits";
import { PageHead, formatDateTime, formatTime, zone } from "../components/ui";

/** How full a meeting is, as the pill beside it. */
export function capacityPill(m: MeetingInfo): { tone: "good" | "warn" | "neutral" | "bad"; label: string } {
  if (m.status === "Canceled") return { tone: "bad", label: "Canceled" };
  if (!m.requestable) return { tone: "neutral", label: m.remaining === 0 && m.status === "Open" ? "Closed · full" : `Closed${m.closedReason && m.closedReason !== "Full" ? ` · ${m.closedReason.toLowerCase()}` : ""}` };
  if (m.remaining <= 2) return { tone: "warn", label: "Low capacity" };
  return { tone: "good", label: "Places available" };
}

/** Meeting finder. Requesting a place starts a new onboarding request, or returns to the one being edited. */
export function Calendar({ source, forSubmission }: { source: DataSource; forSubmission?: string }) {
  const [meetings, setMeetings] = useState<MeetingInfo[]>();

  useEffect(() => {
    source.listMeetings().then(setMeetings);
  }, [source]);

  const target = (slotId: string) => (forSubmission ? `#/onboarding/${forSubmission}?slot=${slotId}` : `#/new?slot=${slotId}`);

  return (
    <>
      <PageHead eyebrow="Committee" title="Committee calendar" />
      <p className="lead">
        Each meeting takes a limited number of submissions. Request a place to start your onboarding; the NBPRA administrator confirms it when they approve the request, and tells you when to join. Times are shown in {zone}.
      </p>
      {meetings === undefined ? (
        <p className="muted">Loading…</p>
      ) : meetings.length === 0 ? (
        <div className="empty-card">
          <p>No upcoming committee meetings are scheduled.</p>
        </div>
      ) : (
        <div className="meetings">
          {meetings.map((m) => {
            const pill = capacityPill(m);
            return (
              <section key={m.id} className={"meeting" + (m.requestable ? "" : " shut")}>
                <div className="meeting-head">
                  <div>
                    <h2 className="section-title">{formatDateTime(m.startAt)}</h2>
                    <div className="muted">
                      {m.committee} · until {formatTime(m.endAt)}
                      {m.requestCloseAt && m.requestable ? ` · requests close ${formatDateTime(m.requestCloseAt)}` : ""}
                    </div>
                  </div>
                  <Pill tone={pill.tone}>{pill.label}</Pill>
                </div>
                <div className="places" role="img" aria-label={`${m.remaining} of ${m.capacity} places left`}>
                  {Array.from({ length: m.capacity }, (_, i) => (
                    <span key={i} className={"place" + (i < m.taken ? " taken" : "")} />
                  ))}
                </div>
                <div className="meeting-foot">
                  <div>
                    <span className="places-num">{m.remaining}</span> of {m.capacity} places left
                  </div>
                  {m.requestable ? (
                    <a className="btn primary" href={target(m.slotId)}>
                      Request a place
                    </a>
                  ) : (
                    <span className="muted">{m.closedReason ?? "Closed"}</span>
                  )}
                </div>
                {m.note && <div className="notice info meeting-note">{m.note}</div>}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
