import { useEffect, useState } from "react";
import { Shell } from "./components/Shell";
import { Portfolio } from "./screens/Portfolio";
import { Workspace } from "./screens/Workspace";
import { Home } from "./screens/Home";
import { Calendar } from "./screens/Calendar";
import { Onboarding } from "./screens/Onboarding";
import { Approvals } from "./screens/Approvals";
import { sampleSource } from "./data/sample";
import { createLiveSource } from "./data/live";
import { createWebApiTransport } from "./data/transport-webapi";
import type { DataSource } from "./data/source";
import type { UserContext } from "./data/types";

// Three ways the same screens get their data:
//   code app build (default `vite build`)   -> Power Apps SDK services
//   web resource build (--mode webresource) -> Dataverse Web API on the page's own origin
//   local development                        -> invented sample data
async function loadSource(): Promise<DataSource> {
  if (import.meta.env.MODE === "production") {
    const { sdkTransport } = await import("./data/transport-sdk");
    return createLiveSource(sdkTransport);
  }
  if (import.meta.env.MODE === "webresource") return createLiveSource(createWebApiTransport());
  return sampleSource;
}

function useHashRoute(): string {
  const read = () => window.location.hash.slice(1) || "/home";
  const [hash, setHash] = useState(read);
  useEffect(() => {
    const on = () => setHash(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const route = useHashRoute();
  const [source, setSource] = useState<DataSource>();
  const [user, setUser] = useState<UserContext>();
  const [failure, setFailure] = useState("");

  useEffect(() => {
    loadSource()
      .then(async (s) => {
        setUser(await s.context());
        setSource(s);
      })
      .catch((e) => setFailure(e instanceof Error ? e.message : String(e)));
  }, []);

  if (failure) return <p style={{ padding: 24 }}>The app could not connect to its data: {failure}</p>;
  if (!source || !user) return <p style={{ padding: 24 }}>Loading…</p>;

  const [path, query = ""] = route.split("?");
  const params = new URLSearchParams(query);
  const sub = path.match(/^\/submission\/([^/]+)$/);
  const onboarding = path.match(/^\/onboarding\/([^/]+)$/);

  let page;
  if (sub) page = <Workspace key={sub[1]} source={source} user={user} id={decodeURIComponent(sub[1])} initialTab={params.get("tab") ?? undefined} />;
  else if (onboarding) page = <Onboarding key={route} source={source} user={user} id={decodeURIComponent(onboarding[1])} pickedSlot={params.get("slot") ?? undefined} />;
  else if (path === "/new") page = <Onboarding key={route} source={source} user={user} pickedSlot={params.get("slot") ?? undefined} />;
  else if (path === "/calendar") page = <Calendar source={source} forSubmission={params.get("for") ?? undefined} />;
  else if (path === "/approvals") page = <Approvals source={source} />;
  else if (path === "/mine") page = <Portfolio key={path} source={source} user={user} mode="mine" />;
  else if (path === "/queue") page = <Portfolio key={path} source={source} user={user} mode="queue" />;
  else if (path === "/portfolio") page = <Portfolio key={path} source={source} user={user} mode="all" />;
  else page = <Home source={source} user={user} />;

  return (
    <Shell route={path} isSample={source.isSample} user={user}>
      {page}
    </Shell>
  );
}
