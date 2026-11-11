import { useEffect, useState } from "react";
import { Shell } from "./components/Shell";
import { Portfolio } from "./screens/Portfolio";
import { Workspace } from "./screens/Workspace";
import { sampleSource } from "./data/sample";

const source = sampleSource;

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
  const m = route.match(/^\/submission\/(.+)$/);
  return (
    <Shell route={route} isSample={source.isSample}>
      {m ? <Workspace source={source} id={decodeURIComponent(m[1])} /> : <Portfolio source={source} />}
    </Shell>
  );
}
