import { useEffect, useMemo, useState } from "react";
import { Input, Select } from "@fluentui/react-components";
import { SearchRegular } from "@fluentui/react-icons";
import type { DataSource } from "../data/source";
import type { BusinessEvent } from "../data/types";
import { TimelineTable } from "../components/Timeline";

export function Audit({ source }: { source: DataSource }) {
  const [all, setAll] = useState<BusinessEvent[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [channel, setChannel] = useState("");

  useEffect(() => {
    source.listEvents().then(setAll);
  }, [source]);

  const types = useMemo(() => Array.from(new Set(all.map((e) => e.eventType))).sort(), [all]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(
      (e) =>
        (!type || e.eventType === type) &&
        (!channel || e.channel === channel) &&
        (!needle || [e.reference, e.actor, e.action, e.reason ?? ""].some((v) => v.toLowerCase().includes(needle))),
    );
  }, [all, q, type, channel]);

  return (
    <>
      <div className="eyebrow">Records</div>
      <h1 className="page-title">Audit timeline</h1>
      <div className="filters three">
        <Input contentBefore={<SearchRegular />} placeholder="Search reference, actor, action, reason" aria-label="Search events" value={q} onChange={(_, d) => setQ(d.value)} />
        <Select aria-label="Event type" value={type} onChange={(_, d) => setType(d.value)}>
          <option value="">All event types</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <Select aria-label="Channel" value={channel} onChange={(_, d) => setChannel(d.value)}>
          <option value="">All channels</option>
          <option>App</option>
          <option>Teams</option>
          <option>Email</option>
          <option>System</option>
        </Select>
      </div>
      <div className="count" aria-live="polite">
        {rows.length} of {all.length} events, newest first
      </div>
      <TimelineTable events={rows} showReference />
    </>
  );
}
