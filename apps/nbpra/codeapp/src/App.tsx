import { useEffect, useState } from "react";
import { Shell } from "./components/Shell";
import { Portfolio } from "./screens/Portfolio";
import { Workspace } from "./screens/Workspace";
import { sampleSource } from "./data/sample";
import { createDataverseSource } from "./data/dataverse";

// Served from a Dataverse org (as a web resource) the app uses live data;
// anywhere else, such as local development, it uses the sample set.
const onDataverse = /\.dynamics\.com$/.test(window.location.hostname);
const live = onDataverse ? createDataverseSource() : undefined;
const source = live ?? sampleSource;

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
  const [userName, setUserName] = useState(live ? "" : "Kate (NBPRA Administrator)");
  useEffect(() => {
    live?.whoAmI().then(setUserName, () => setUserName("unknown user"));
  }, []);
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
