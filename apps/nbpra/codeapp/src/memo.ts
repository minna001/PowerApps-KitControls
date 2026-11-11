// Builds the committee memo: a PDF brief of one submission, generated in the
// browser from the same data the screens show, then stored through the server
// in the submission's export history. The PDF library is loaded on demand.
import type { DataSource } from "./data/source";
import type { Question, UserContext } from "./data/types";

const FINAL = ["Awaiting Final Admin Review", "Authorized for Committee"];
const utc = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const stamp = (iso: string) => `${utc.format(new Date(iso))} UTC`;

function answerText(q: Question): string {
  if (q.type === "File") return q.file ? `File: ${q.file.name} (version ${q.file.version})` : "No file uploaded";
  if (!q.value) return "Not answered";
  if (q.type === "Boolean") return q.value === "true" ? "Yes" : "No"; // No is an answer, not a gap
  if (q.type === "Choice") return q.options.find((o) => o.code === q.value)?.label ?? q.value;
  return q.value;
}

export async function buildMemo(source: DataSource, user: UserContext, submissionId: string): Promise<{ fileName: string; base64: string }> {
  const detail = await source.getSubmission(submissionId);
  if (!detail) throw new Error("Submission not found.");
  const [intake, events, sections] = await Promise.all([
    source.getIntake(submissionId),
    source.listEvents(submissionId),
    Promise.all(detail.sections.filter((s) => s.id).map((s) => source.getSection(s.id))),
  ]);
  const isFinal = FINAL.includes(detail.status);
  const generated = new Date().toISOString();
  const slot = detail.meetingDate ? `${detail.meetingDate}${detail.slot ? `, ${detail.slot}` : ""} (${detail.slotConfirmed ? "confirmed" : "requested"})` : "None";

  const th = (t: string) => ({ text: t, style: "th" });
  const facts: [string, string][] = [
    ["Reference", detail.reference],
    ["Status", detail.status],
    ["Business owner", detail.owner],
    ["Sponsor", detail.sponsor || "Not given"],
    ["Business area", detail.businessArea || "Not given"],
    ["Classification", intake.proposalType || "Not given"],
    ["Committee slot", slot],
    ["Started from", intake.copiedFrom ?? "New submission"],
  ];
  const files = sections.flatMap((s) => (s?.questions ?? []).filter((q) => q.file).map((q) => ({ section: s!.title, q })));
  const decisions = [...events].reverse().filter((e) => ["Slot", "Review request", "Signatory", "Final submission", "Admission", "Invalidation"].includes(e.eventType));

  const content: any[] = [
    { text: "NBPRA · Committee memo", style: "eyebrow" },
    { text: detail.title, style: "title" },
    ...(isFinal ? [] : [{ text: "DRAFT — NOT FINAL. The package has not been finally submitted.", style: "draft" }]),
    { table: { widths: [120, "*"], body: facts.map(([k, v]) => [{ text: k, style: "key" }, v]) }, layout: "lightHorizontalLines", margin: [0, 8, 0, 0] },

    { text: "Business description", style: "h2" },
    { text: intake.summary || "Not given" },
    { text: "Jurisdictions and scope", style: "h3" },
    { text: intake.scope || "Not given" },

    { text: "Approval summary", style: "h2" },
    {
      table: {
        headerRows: 1,
        widths: ["*", 100, "*"],
        body: [
          [th("Checklist section"), th("Status"), th("Review groups")],
          ...detail.sections.map((s) => [s.title, s.status, s.groups.length ? s.groups.map((g) => `${g.name}: ${g.state}`).join("\n") : "—"]),
        ],
      },
      layout: "lightHorizontalLines",
    },
    { text: `Five signatories: ${detail.signatoriesApproved} of 5 approved`, style: "h3" },
    {
      table: { headerRows: 1, widths: [50, "*", 120], body: [[th("Seat"), th("Signatory"), th("Decision")], ...detail.signatories.map((p) => [String(p.slot), p.name, p.state])] },
      layout: "lightHorizontalLines",
    },

    { text: "Checklist responses", style: "h2", pageBreak: "before" },
    ...sections.flatMap((s) =>
      !s
        ? []
        : [
            { text: `${s.title} — ${s.status}${s.revision ? `, revision ${s.revision}` : ""}`, style: "h3" },
            s.questions.length
              ? { table: { headerRows: 1, dontBreakRows: false, widths: ["45%", "*"], body: [[th("Question"), th("Answer")], ...s.questions.map((q) => [q.label, answerText(q)])] }, layout: "lightHorizontalLines" }
              : { text: "No questions configured.", style: "muted" },
          ],
    ),

    { text: "Evidence", style: "h2" },
    files.length
      ? {
          table: {
            headerRows: 1,
            widths: ["*", 110, 40, 110],
            body: [[th("File"), th("Section"), th("Ver."), th("Uploaded")], ...files.map(({ section, q }) => [q.file!.name, section, String(q.file!.version), stamp(q.file!.uploadedAt)])],
          },
          layout: "lightHorizontalLines",
        }
      : { text: "No files uploaded.", style: "muted" },
    { text: "Files are held with the submission and are not embedded in this memo.", style: "muted", margin: [0, 4, 0, 0] },

    { text: "Decision history", style: "h2" },
    decisions.length
      ? {
          table: {
            headerRows: 1,
            widths: [95, 90, "*", 50],
            body: [[th("Time"), th("Actor"), th("Event"), th("Channel")], ...decisions.map((e) => [stamp(e.occurredAt), e.actor, e.action + (e.reason ? `\nReason: ${e.reason}` : ""), e.channel])],
          },
          layout: "lightHorizontalLines",
        }
      : { text: "No decisions recorded yet.", style: "muted" },
  ];

  const doc = {
    pageSize: "A4",
    pageMargins: [48, 56, 48, 56] as [number, number, number, number],
    info: { title: `NBPRA memo ${detail.reference}`, subject: detail.title },
    footer: (page: number, pages: number) => ({
      columns: [
        { text: `${detail.reference} · generated ${stamp(generated)} by ${user.fullName} · a snapshot of the record at that time`, style: "footer" },
        { text: `Page ${page} of ${pages}`, alignment: "right", style: "footer" },
      ],
      margin: [48, 18, 48, 0],
    }),
    content,
    defaultStyle: { fontSize: 9.5, lineHeight: 1.25 },
    styles: {
      eyebrow: { fontSize: 8, color: "#5c6464", characterSpacing: 1.2 },
      title: { fontSize: 20, margin: [0, 2, 0, 4] },
      draft: { color: "#a3392b", bold: true, margin: [0, 2, 0, 2] },
      h2: { fontSize: 13, bold: true, color: "#1f5f5b", margin: [0, 18, 0, 6] },
      h3: { fontSize: 10.5, bold: true, margin: [0, 12, 0, 4] },
      th: { bold: true, fontSize: 8.5, color: "#5c6464" },
      key: { color: "#5c6464" },
      muted: { color: "#5c6464" },
      footer: { fontSize: 7.5, color: "#5c6464" },
    },
  };

  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts")]);
  (pdfMake as any).addVirtualFileSystem?.(fonts);
  if (!(pdfMake as any).addVirtualFileSystem) (pdfMake as any).vfs = (fonts as any).pdfMake?.vfs ?? fonts;
  const pdf = (pdfMake as any).createPdf(doc);
  const base64: string = await new Promise((resolve, reject) => {
    const r = pdf.getBase64(resolve);
    if (r && typeof r.then === "function") r.then(resolve, reject);
  });
  return { fileName: `NBPRA memo ${detail.reference}${isFinal ? "" : " DRAFT"}.pdf`, base64 };
}
