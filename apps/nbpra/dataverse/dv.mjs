// Shared Dataverse Web API client for the scripts in this folder.
// Sign-in: service principal (DV_TENANT, DV_CLIENT_ID, DV_CLIENT_SECRET) or
// device code. DV_TOKEN_FILE optionally names a private file outside the repo
// where the access token is kept for up to an hour. Behind a proxy, run with
// NODE_USE_ENV_PROXY=1 (Node 22.21+).
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function connect(orgUrl, solution) {
  const url = orgUrl.replace(/\/$/, "");
  let token;

  async function getToken() {
    const f = process.env.DV_TOKEN_FILE;
    if (f && existsSync(f)) {
      const c = JSON.parse(readFileSync(f, "utf8"));
      if (c.url === url && c.expires > Date.now() + 5 * 60000) return c.token;
    }
    const save = (j) => {
      if (f) writeFileSync(f, JSON.stringify({ url, token: j.access_token, expires: Date.now() + j.expires_in * 1000 }), { mode: 0o600 });
      return j.access_token;
    };
    const scope = `${url}/.default`;
    const { DV_TENANT, DV_CLIENT_ID, DV_CLIENT_SECRET } = process.env;
    if (DV_TENANT && DV_CLIENT_ID && DV_CLIENT_SECRET) {
      const r = await fetch(`https://login.microsoftonline.com/${DV_TENANT}/oauth2/v2.0/token`, {
        method: "POST",
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: DV_CLIENT_ID, client_secret: DV_CLIENT_SECRET, scope }),
      });
      const j = await r.json();
      if (!j.access_token) throw new Error(`Sign-in failed: ${j.error_description ?? r.status}`);
      return save(j);
    }
    const client_id = "51f81489-12ee-4a9e-aaae-a2591f45987d"; // Microsoft's public client for Dataverse tooling
    const base = "https://login.microsoftonline.com/organizations/oauth2/v2.0";
    const dc = await (await fetch(`${base}/devicecode`, { method: "POST", body: new URLSearchParams({ client_id, scope }) })).json();
    if (!dc.device_code) throw new Error(`Device-code request failed: ${dc.error_description}`);
    console.log(`\n${dc.message}\n`);
    for (;;) {
      await new Promise((r) => setTimeout(r, (dc.interval ?? 5) * 1000));
      const j = await (
        await fetch(`${base}/token`, {
          method: "POST",
          body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id, device_code: dc.device_code }),
        })
      ).json();
      if (j.access_token) return save(j);
      if (j.error !== "authorization_pending") throw new Error(`Sign-in failed: ${j.error_description}`);
    }
  }

  /** Returns parsed JSON; null for a GET that 404s. Retries dropped connections and throttling. */
  async function api(method, path, body, { inSolution = true, headers = {} } = {}) {
    token ??= await getToken();
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(`${url}/api/data/v9.2/${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "OData-Version": "4.0",
            Accept: "application/json",
            Prefer: "return=representation",
            ...(inSolution && solution && method !== "GET" ? { "MSCRM.SolutionUniqueName": solution } : {}),
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (method === "GET" && r.status === 404) return null;
        if ([429, 502, 503, 504].includes(r.status) && attempt < 6) throw Object.assign(new Error("throttled"), { transient: true });
        const text = await r.text();
        if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}\n${text.slice(0, 800)}`);
        return text ? JSON.parse(text) : {};
      } catch (e) {
        const transient = e.transient || e.message === "fetch failed";
        // Only reads are retried blindly; a write may have landed before the connection dropped.
        if (!transient || attempt >= 6 || (method !== "GET" && !e.transient)) throw e;
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
  }

  return { url, api };
}
