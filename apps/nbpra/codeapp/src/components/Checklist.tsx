import { useEffect, useState } from "react";
import { Button, Field, Input, Radio, RadioGroup, Select, Textarea } from "@fluentui/react-components";
import type { DataSource } from "../data/source";
import type { OpResult, Question, SectionDetail, SectionSummary } from "../data/types";
import { SectionPill } from "./bits";
import { Notice, formatDateTime } from "./ui";
import { MAX_FILE_BYTES, fileSize, readFile, saveToDisk } from "../files";

/** Section list on the left, the selected section's questions on the right. */
export function Checklist({ source, sections, canEdit, onChanged }: { source: DataSource; sections: SectionSummary[]; canEdit: boolean; onChanged: () => void }) {
  const usable = sections.filter((s) => s.id);
  const [selected, setSelected] = useState(usable.find((s) => s.status !== "Approved" && s.status !== "Not Applicable")?.id ?? usable[0]?.id);
  const [detail, setDetail] = useState<SectionDetail>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OpResult<unknown>>();

  const load = (id: string) =>
    source.getSection(id).then((d) => {
      setDetail(d);
      setValues(Object.fromEntries((d?.questions ?? []).map((q) => [q.id, q.value])));
      setDirty(false);
    });

  useEffect(() => {
    setDetail(undefined);
    setResult(undefined);
    if (selected) load(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, source]);

  if (usable.length === 0) return <p className="muted">The checklist opens once the NBPRA administrator approves the onboarding request.</p>;

  const editable = canEdit && !!detail?.editable;
  const set = (id: string, v: string) => {
    setValues({ ...values, [id]: v });
    setDirty(true);
  };
  const missing = (detail?.questions ?? []).filter((q) => q.required && (q.type === "File" ? !q.file : !(values[q.id] ?? "").trim())).length;

  async function onUpload(q: Question, file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setResult({ ok: false, error: `"${file.name}" is ${fileSize(file.size)}. The limit is ${fileSize(MAX_FILE_BYTES)}.` });
      return;
    }
    setBusy(true);
    // Typed answers are saved first so reloading the section after the upload cannot lose them.
    if (!dirty || (await save())) {
      const r = await source.uploadEvidence(selected!, q.id, await readFile(file));
      setResult(r.ok ? { ok: true, message: `Uploaded ${file.name}.`, data: undefined } : r);
      if (r.ok) {
        await load(selected!);
        onChanged();
      }
    }
    setBusy(false);
  }
  async function onDownload(id: string) {
    const r = await source.downloadFile("evidence", id);
    if (r.ok) saveToDisk(r.data);
    else setResult(r);
  }

  async function save(): Promise<boolean> {
    const r = await source.saveSection(selected!, (detail?.questions ?? []).map((q) => ({ q: q.id, v: values[q.id] ?? "" })));
    setResult(r.ok ? { ok: true, message: `Saved. Section is ${r.data}.`, data: undefined } : r);
    if (r.ok) {
      await load(selected!);
      onChanged();
    }
    return r.ok;
  }
  async function onSave() {
    setBusy(true);
    await save();
    setBusy(false);
  }
  async function onSubmit() {
    setBusy(true);
    if (!dirty || (await save())) {
      const r = await source.submitSection(selected!);
      setResult(r);
      if (r.ok) {
        await load(selected!);
        onChanged();
      }
    }
    setBusy(false);
  }

  return (
    <div className="checklist">
      <nav className="cl-nav" aria-label="Checklist sections">
        <div className="eyebrow">Sections</div>
        {usable.map((s) => (
          <button key={s.id} className={"cl-item" + (s.id === selected ? " on" : "")} aria-current={s.id === selected ? "true" : undefined} onClick={() => (!dirty || window.confirm("Discard unsaved answers in this section?")) && setSelected(s.id)}>
            <span>{s.title}</span>
            <SectionPill status={s.status} />
          </button>
        ))}
      </nav>

      <div className="cl-body">
        {!detail ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="cl-head">
              <h2 className="section-title">{detail.title}</h2>
              <SectionPill status={detail.status} />
              {detail.revision > 0 && <span className="muted">revision {detail.revision}</span>}
            </div>
            {detail.status === "Changes Requested" && (
              <div className="notice bad" role="status">
                A reviewer returned this section{detail.returnedReason ? `: ${detail.returnedReason}` : "."} Correct it and submit again.
              </div>
            )}
            {detail.status === "Under Review" && <div className="notice info">This revision is locked while its review groups decide.</div>}
            <Notice result={result} />

            {detail.questions.length === 0 && <p className="muted">This section has no questions configured.</p>}
            <div className="fields">
              {detail.questions.map((q) => (
                <QuestionField key={q.id} q={q} value={values[q.id] ?? ""} disabled={!editable || busy} onChange={(v) => set(q.id, v)} onUpload={(f) => onUpload(q, f)} onDownload={onDownload} />
              ))}
            </div>

            {editable && (
              <div className="actions">
                <Button appearance="primary" disabled={busy || missing > 0} onClick={onSubmit}>
                  Submit section for review
                </Button>
                <Button disabled={busy} onClick={onSave}>
                  Save answers
                </Button>
                <span className="muted">{busy ? "Working…" : missing > 0 ? `${missing} required answer${missing === 1 ? "" : "s"} or file${missing === 1 ? "" : "s"} still needed` : dirty ? "Unsaved changes" : "Ready to submit"}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function QuestionField({ q, value, disabled, onChange, onUpload, onDownload }: { q: Question; value: string; disabled: boolean; onChange: (v: string) => void; onUpload: (f: File) => void; onDownload: (id: string) => void }) {
  const label = q.label;
  switch (q.type) {
    case "File":
      return (
        <Field label={label} required={q.required} hint={q.accept?.length ? `Accepted: ${q.accept.map((x) => "." + x).join(", ")}. Up to ${fileSize(MAX_FILE_BYTES)}.` : `Up to ${fileSize(MAX_FILE_BYTES)}.`}>
          <div className="file-q">
            {q.file ? (
              <div className="file-current">
                <button type="button" className="link plain" onClick={() => onDownload(q.file!.id)}>
                  {q.file.name}
                </button>
                <span className="muted">
                  {" "}
                  · {fileSize(q.file.sizeBytes)} · version {q.file.version} · uploaded {formatDateTime(q.file.uploadedAt)}
                </span>
              </div>
            ) : (
              <div className="muted">No file uploaded yet.</div>
            )}
            {!disabled && (
              <input
                type="file"
                aria-label={`${q.file ? "Replace" : "Upload"} file for: ${label}`}
                accept={q.accept?.map((x) => "." + x).join(",")}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onUpload(f);
                }}
              />
            )}
          </div>
        </Field>
      );
    case "Boolean":
      return (
        <Field label={label} required={q.required}>
          <RadioGroup layout="horizontal" value={value} onChange={(_, d) => onChange(d.value)} disabled={disabled}>
            <Radio value="true" label="Yes" />
            <Radio value="false" label="No" />
          </RadioGroup>
        </Field>
      );
    case "Choice":
      return (
        <Field label={label} required={q.required}>
          <Select value={value} onChange={(_, d) => onChange(d.value)} disabled={disabled}>
            <option value="">Select…</option>
            {q.options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "Number":
      return (
        <Field label={label} required={q.required}>
          <Input type="number" value={value} onChange={(_, d) => onChange(d.value)} disabled={disabled} />
        </Field>
      );
    case "Date":
      return (
        <Field label={label} required={q.required}>
          <Input type="date" value={value} onChange={(_, d) => onChange(d.value)} disabled={disabled} />
        </Field>
      );
    case "Long text":
      return (
        <Field label={label} required={q.required}>
          <Textarea value={value} onChange={(_, d) => onChange(d.value)} rows={4} resize="vertical" disabled={disabled} />
        </Field>
      );
    default:
      return (
        <Field label={label} required={q.required}>
          <Input value={value} onChange={(_, d) => onChange(d.value)} disabled={disabled} />
        </Field>
      );
  }
}
