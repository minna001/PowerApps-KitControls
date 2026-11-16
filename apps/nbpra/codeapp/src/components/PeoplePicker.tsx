import { useEffect, useRef, useState } from "react";
import { Input } from "@fluentui/react-components";
import type { DataSource } from "../data/source";
import type { Person } from "../data/types";

/** Type-ahead search of the company directory. Anyone in it can be chosen, app user or not. */
export function PeoplePicker({ source, value, onChange, placeholder }: { source: DataSource; value: Person | null; onChange: (p: Person | null) => void; placeholder?: string }) {
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<Person[]>();
  const [error, setError] = useState("");
  const latest = useRef(0);

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setFound(undefined);
      return;
    }
    // Wait for a pause in typing, and ignore replies to searches that were overtaken.
    const run = ++latest.current;
    const timer = setTimeout(() => {
      source
        .searchPeople(q)
        .then((people) => {
          if (run !== latest.current) return;
          setFound(people);
          setError("");
        })
        .catch((e: unknown) => run === latest.current && setError(e instanceof Error ? e.message : "The directory search failed."));
    }, 300);
    return () => clearTimeout(timer);
  }, [source, term]);

  if (value)
    return (
      <div className="person-chip">
        <div>
          <div className="person-name">{value.name}</div>
          <div className="muted person-mail">{[value.email, value.jobTitle].filter(Boolean).join(" · ")}</div>
        </div>
        <button type="button" className="link-button" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );

  return (
    <div className="people-picker">
      <Input value={term} onChange={(_, d) => setTerm(d.value)} placeholder={placeholder ?? "Search by name or email"} aria-label={placeholder ?? "Search the directory by name or email"} />
      {error && <div className="muted person-mail">{error}</div>}
      {found && (
        <ul className="people-list">
          {found.length === 0 && <li className="muted">No one found. Try the start of their name or email address.</li>}
          {found.map((p) => (
            <li key={p.email}>
              <button
                type="button"
                onClick={() => {
                  onChange(p);
                  setTerm("");
                  setFound(undefined);
                }}
              >
                <span className="person-name">{p.name}</span>
                <span className="muted person-mail">{[p.email, p.jobTitle].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
