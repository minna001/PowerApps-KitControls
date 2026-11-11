import { useEffect, useState } from "react";
import { Shell } from "./components/Shell";
import { Portfolio } from "./screens/Portfolio";
import { Workspace } from "./screens/Workspace";
import { sampleSource } from "./data/sample";
import { createDataverseSource } from "./data/dataverse";
import type { DataSource } from "./data/source";

type LiveSource = DataSource & { whoAmI(): Promise<string> };

// Three ways the same screens get their data:
//   code app build (default `vite build`)  -> Power Apps SDK services
//   web resource build (--mode webresource) -> Dataverse Web API on the org's origin
//   local development                        -> invented sample data
async function loadSource(): Promise<{ source: DataSource; live?: LiveSource }> {
  if (import.meta.env.MODE === "production") {
    const live = (await import("./data/powerapps")).powerAppsSource;
    return { source: live, live };
  }
  if (import.meta.env.MODE === "webresource" && /\.dynamics\.com$/.test(window.location.hostname)) {
    const live = createDataverseSource();
    return { source: live, live };
  }
  return { source: sampleSource };
}

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash.slice(1) || "/portfolio");
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || "/portfolio");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const route = useHashRoute();
  const [loaded, setLoaded] = useState<{ source: DataSource; live?: LiveSource }>();
  const [userName, setUserName] = useState("");
  const [failure, setFailure] = useState("");

  useEffect(() => {
    loadSource().then(
      (l) => {
        setLoaded(l);
        if (l.live) l.live.whoAmI().then(setUserName, () => setUserName(""));
        else setUserName("Kate (NBPRA Administrator)");
      },
      (e) => setFailure(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  if (failure) return <p style={{ padding: 24 }}>The app could not connect to its data: {failure}</p>;
  if (!loaded) return <p style={{ padding: 24 }}>Loading…</p>;
  const { source } = loaded;
  const m = route.match(/^\/submission\/(.+)$/);
  return (
    <Shell route={route} isSample={source.isSample} userName={userName}>
      {m ? (
        <Workspace source={source} id={decodeURIComponent(m[1])} />
      ) : (
        <Portfolio key={route} source={source} initialAttention={route === "/queue" ? "kate" : "all"} />
      )}
    </Shell>
  );
}
