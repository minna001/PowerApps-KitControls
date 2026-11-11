import type { BusinessEvent } from "../data/types";

const fmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function TimelineTable({ events, showReference }: { events: BusinessEvent[]; showReference?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="register compact">
        <thead>
          <tr>
            <th scope="col">Time (UTC)</th>
            {showReference && <th scope="col">Submission</th>}
            <th scope="col">Actor</th>
            <th scope="col">Event</th>
            <th scope="col">Status change</th>
            <th scope="col">Revision</th>
            <th scope="col">Channel</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="nowrap mono">{fmt.format(new Date(e.occurredAt))}</td>
              {showReference && (
                <td className="nowrap">
                  <a className="mono" href={`#/submission/${encodeURIComponent(e.submissionId)}`}>
                    {e.reference}
                  </a>
                </td>
              )}
              <td className="nowrap">{e.actor}</td>
              <td>
                <span className="row-sub">{e.eventType}</span>
                <div>{e.action}</div>
                {e.reason && <div className="reason">Reason: {e.reason}</div>}
              </td>
              <td>{e.newStatus ? `${e.oldStatus ?? "None"} → ${e.newStatus}` : "—"}</td>
              <td className="nowrap">{e.revision ?? "—"}</td>
              <td>{e.channel}</td>
            </tr>
          ))}
          {events.length === 0 && (
            <tr>
              <td colSpan={showReference ? 7 : 6} className="empty">
                No events match.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
