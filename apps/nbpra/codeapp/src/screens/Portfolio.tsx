import { useEffect, useMemo, useState } from "react";
import { Input, Select } from "@fluentui/react-components";
import { SearchRegular } from "@fluentui/react-icons";
import type { DataSource } from "../data/source";
import type { Submission, SubmissionStatus, UserContext } from "../data/types";
import { Meter, StatusPill, formatDate } from "../components/bits";

const CLOSED: SubmissionStatus[] = ["Withdrawn"];

type Attention = "all" | "blocked" | "kate" | "signatories" | "functional" | "aged";

const ATTENTION: { key: Attention; label: string; test: (s: Submission) => boolean }[] = [
  { key: "blocked", label: "Blocked", test: (s) => !!s.blocker },
  { key: "kate", label: "Waiting on the administrator", test: (s) => s.nextActor === "Kate" },
  { key: "functional", label: "Functional approvals outstanding", test: (s) => s.nextActor === "Functional approvers" },
  { key: "signatories", label: "Signatory approvals outstanding", test: (s) => s.status === "Awaiting Signatory Approval" },
  { key: "aged", label: "Open longer than 90 days", test: (s) => s.ageDays > 90 && s.status !== "Authorized for Committee" && !CLOSED.includes(s.status) },
];

type Sort = "attention" | "age" | "meeting" | "title";

const HEAD = {
  all: ["Register", "All submissions"],
  queue: ["Admin queue", "Awaiting the administrator's decision"],
  mine: ["My work", "My submissions"],
} as const;

export function Portfolio({ source, user, mode }: { source: DataSource; user: UserContext; mode: "all" | "queue" | "mine" }) {
  const initialAttention: Attention = mode === "queue" ? "kate" : "all";
  const [all, setAll] = useState<Submission[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | SubmissionStatus>("");
  const [attention, setAttention] = useState<Attention>(initialAttention);
  const [scope, setScope] = useState<"active" | "closed" | "all">("active");
  const [sort, setSort] = useState<Sort>("attention");

  useEffect(() => {
    source.listSubmissions().then((rows) => setAll(mode === "mine" ? rows.filter((r) => r.owner === user.fullName) : rows));
  }, [source, mode, user.fullName]);

  const active = useMemo(() => all.filter((s) => !CLOSED.includes(s.status)), [all]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const att = ATTENTION.find((a) => a.key === attention);
    const out = all.filter((s) => {
      if (scope === "active" && CLOSED.includes(s.status)) return false;
      if (scope === "closed" && !CLOSED.includes(s.status)) return false;
      if (status && s.status !== status) return false;
      if (att && !att.test(s)) return false;
      if (needle && ![s.reference, s.title, s.owner, s.businessArea, s.nextAction].some((v) => v.toLowerCase().includes(needle))) return false;
      return true;
    });
    const cmp: Record<Sort, (a: Submission, b: Submission) => number> = {
      attention: (a, b) => Number(!!b.blocker) - Number(!!a.blocker) || b.ageDays - a.ageDays,
      age: (a, b) => b.ageDays - a.ageDays,
      meeting: (a, b) => (a.meetingDate ?? "9999").localeCompare(b.meetingDate ?? "9999"),
      title: (a, b) => a.title.localeCompare(b.title),
    };
    return [...out].sort(cmp[sort]);
  }, [all, q, status, attention, scope, sort]);

  const statuses = useMemo(() => Array.from(new Set(all.map((s) => s.status))).sort(), [all]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{HEAD[mode][0]}</div>
          <h1 className="page-title">{HEAD[mode][1]}</h1>
        </div>
        {mode === "mine" && (
          <div className="head-actions">
            <a className="btn" href="#/reuse">
              Start from a previous submission
            </a>
            <a className="btn primary" href="#/calendar">
              Start a new submission
            </a>
          </div>
        )}
      </div>

      <div className="portfolio">
        <section>
          <div className="filters">
            <Input
              className="filter-search"
              contentBefore={<SearchRegular />}
              placeholder="Search reference, title, owner, action"
              aria-label="Search submissions"
              value={q}
              onChange={(_, d) => setQ(d.value)}
            />
            <Select aria-label="Status" value={status} onChange={(_, d) => setStatus(d.value as "" | SubmissionStatus)}>
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
            <Select aria-label="Scope" value={scope} onChange={(_, d) => setScope(d.value as typeof scope)}>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
              <option value="all">Active and closed</option>
            </Select>
            <Select aria-label="Sort" value={sort} onChange={(_, d) => setSort(d.value as Sort)}>
              <option value="attention">Needs attention first</option>
              <option value="age">Oldest first</option>
              <option value="meeting">Committee date</option>
              <option value="title">Title</option>
            </Select>
          </div>

          <div className="count" aria-live="polite">
            {rows.length} of {all.length} submissions
            {attention !== "all" && (
              <button className="link" onClick={() => setAttention("all")}>
                Clear worklist filter
              </button>
            )}
          </div>

          <div className="table-wrap">
            <table className="register wide">
              <thead>
                <tr>
                  <th scope="col">Proposal</th>
                  <th scope="col">Status</th>
                  <th scope="col">Complete</th>
                  <th scope="col">Approvals</th>
                  <th scope="col">Next action</th>
                  <th scope="col">Committee</th>
                  <th scope="col" className="num">Age</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <a className="row-title" href={`#/submission/${encodeURIComponent(s.id)}`}>
                        {s.title}
                      </a>
                      <div className="row-sub">
                        <span className="mono nowrap">{s.reference}</span> · {s.businessArea} · {s.owner}
                      </div>
                    </td>
                    <td>
                      <StatusPill status={s.status} />
                    </td>
                    <td>
                      <Meter pct={s.completenessPct} label="Data complete" />
                    </td>
                    <td className="nowrap">
                      {s.functionalRequired ? `Func ${s.functionalApproved}/${s.functionalRequired}` : "Func not started"}
                      <br />
                      Sig {s.signatoriesApproved}/5
                    </td>
                    <td>
                      {s.nextAction}
                      {s.blocker && <div className="blocked">Blocked: {s.blocker}</div>}
                    </td>
                    <td className="nowrap">
                      {formatDate(s.meetingDate)}
                      {s.slot && (
                        <div className="row-sub">
                          {s.slot} · {s.slotConfirmed ? "confirmed" : "requested"}
                        </div>
                      )}
                    </td>
                    <td className="num">{s.ageDays}d</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty">
                      No submissions match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="panel" aria-label="Attention worklist">
          <div className="panel-head">Attention worklist</div>
          {ATTENTION.map((a) => {
            const n = active.filter(a.test).length;
            return (
              <button key={a.key} className={"worklist-row" + (attention === a.key ? " on" : "")} aria-pressed={attention === a.key} onClick={() => setAttention(attention === a.key ? "all" : a.key)}>
                <span>{a.label}</span>
                <span className="mono">{n}</span>
              </button>
            );
          })}
        </aside>
      </div>
    </>
  );
}
