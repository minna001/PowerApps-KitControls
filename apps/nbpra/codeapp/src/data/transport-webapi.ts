import type { OperationReply, QueryOptions, Row, Transport } from "./transport";

export interface WebApiOptions {
  /** Org URL; empty when the app is served from the org's own origin. */
  baseUrl?: string;
  headers?: Record<string, string>;
  fetchFn?: typeof fetch;
}

export function createWebApiTransport(opts: WebApiOptions = {}): Transport {
  const base = (opts.baseUrl ?? "") + "/api/data/v9.2/";
  const doFetch = opts.fetchFn ?? fetch.bind(globalThis);
  const headers = { Accept: "application/json", "Content-Type": "application/json", "OData-Version": "4.0", "OData-MaxVersion": "4.0", ...opts.headers };

  async function post(path: string, body: Row): Promise<OperationReply> {
    try {
      const r = await doFetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
      const j: Row = await r.json().catch(() => ({}));
      if (!r.ok) return { Outcome: "error", Message: j.error?.message ?? `The server refused the request (${r.status}).` };
      return j as OperationReply;
    } catch (e) {
      return { Outcome: "error", Message: e instanceof Error ? e.message : "The request could not be sent." };
    }
  }

  return {
    async query(entitySet, o: QueryOptions = {}) {
      const p = new URLSearchParams();
      if (o.select?.length) p.set("$select", o.select.join(","));
      if (o.filter) p.set("$filter", o.filter);
      if (o.orderBy?.length) p.set("$orderby", o.orderBy.join(","));
      const out: Row[] = [];
      let url: string | undefined = `${base}${entitySet}?${p.toString()}`;
      while (url) {
        const r: Response = await doFetch(url, { headers });
        if (!r.ok) throw new Error(`Could not load ${entitySet} (${r.status}): ${(await r.text()).slice(0, 200)}`);
        const j: Row = await r.json();
        out.push(...(j.value ?? []));
        url = j["@odata.nextLink"];
      }
      return out;
    },
    workflow(Operation, TargetId, Outcome, Comment, Payload) {
      const body: Row = { Operation };
      if (TargetId) body.TargetId = TargetId;
      if (Outcome) body.Outcome = Outcome;
      if (Comment) body.Comment = Comment;
      if (Payload) body.Payload = Payload;
      return post("nbpra_Workflow", body);
    },
    adminDecision(SubmissionId, Action, Comment) {
      return post("nbpra_AdminDecision", { SubmissionId, Action, Comment, Channel: "App" });
    },
  };
}
