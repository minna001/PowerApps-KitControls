// Display names for columns. Column names in schema.json are lower-case and
// run together ("requestcloseat"); this splits them into words ("Request
// close at") for forms, views and spreadsheet headers. A table's own "status"
// column is labelled "<Table> status" so it cannot be confused with the
// built-in Status (active/inactive) column that every table has.

const WORDS = [
  "applicability", "idempotency", "cancellation", "instructions", "correlation", "eligibility", "replacement", "integration", "description",
  "submission", "committee", "authorized", "signatory", "assignment", "allocation", "validation", "completion", "applicable", "supersedes", "recipient",
  "delegated", "generated", "delivered", "published", "effective", "requested", "requires", "required", "reference", "checklist", "submitted", "withdrawn",
  "business", "instance", "proposal", "template", "activity", "deadline", "location", "capacity", "snapshot", "decision", "approval", "evidence", "question", "approved",
  "revision", "boolean", "currency", "answered", "original", "uploaded", "external", "occurred", "category", "provider", "assigned", "location", "manifest",
  "replaced", "timezone", "filename", "sponsor", "summary", "desired", "current", "package", "default", "meeting", "request", "version", "display", "section",
  "content", "routing", "purpose", "outcome", "comment", "decided", "channel", "subject", "related", "trigger", "address", "attempt", "timing", "status",
  "review", "policy", "offset", "answer", "locked", "person", "option", "upload", "closed", "actor", "action", "record", "export", "source", "reason", "copied",
  "active", "intake", "number", "block", "count", "start", "close", "order", "label", "value", "route", "state", "multi", "codes", "bytes", "error", "event",
  "owner", "scope", "final", "admin", "title", "type", "slot", "area", "last", "from", "code", "team", "open", "rule", "help", "text", "days", "date", "file",
  "size", "user", "kind", "body", "read", "name", "def", "due", "end", "key", "old", "new", "id", "is", "at", "by",
].sort((a, b) => b.length - a.length);

const SHOWN = { def: "definition", timezone: "time zone", filename: "file name", id: "ID", multi: "multiple", codes: "codes" };

/** Splits a run-together column name into its words, or returns null if it cannot. */
function split(name) {
  if (name === "") return [];
  for (const w of WORDS) {
    if (name.startsWith(w)) {
      const rest = split(name.slice(w.length));
      if (rest) return [w, ...rest];
    }
  }
  return null;
}

export function columnLabel(tableDisplay, name) {
  if (name === "status") return `${tableDisplay} status`;
  const words = split(name) ?? [name];
  const text = words.map((w) => SHOWN[w] ?? w).join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
