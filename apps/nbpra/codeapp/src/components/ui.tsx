import type { ReactNode } from "react";
import type { OpResult } from "../data/types";

/** Outcome of the last server operation, shown above the form that ran it. */
export function Notice({ result }: { result?: OpResult<unknown> | { ok: false; error: string } }) {
  if (!result) return null;
  return result.ok ? (
    <div className="notice good" role="status">
      {result.message}
    </div>
  ) : (
    <div className="notice bad" role="alert">
      {result.error}
    </div>
  );
}

export function PageHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
      </div>
      {children}
    </div>
  );
}

const dateTime = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const timeOnly = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatTime = (iso: string) => timeOnly.format(new Date(iso));
/** Local time zone name, shown wherever a slot time appears. */
export const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
