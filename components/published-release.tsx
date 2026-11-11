"use client";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, HardDrive } from "lucide-react";
import type { readPublishedRelease } from "@/lib/published-release.mjs";

type Release = Awaited<ReturnType<typeof readPublishedRelease>>;

export function PublishedRelease({ active, openEdge, revision = 0 }: { revision?: number; active: boolean; openEdge?: () => void }) {
  const [release, setRelease] = useState<Release | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/releases", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw Error("Release unavailable");
        const result: Release = await response.json();
        if (!controller.signal.aborted) { setRelease(result); setFailed(false); }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void refresh();
    const interval = window.setInterval(refresh, 15 * 60_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [active, revision]);
  const total = release?.installers.reduce<number | null>((sum, file) =>
    sum === null || file.bytes === null ? null : sum + file.bytes, 0);
  return <>
    <div className="release-banner">
      
      <div><p className="eyebrow">{failed ? (release ? "Release feed unavailable · Showing last loaded version" : "Release feed unavailable") : release ? "Current release" : "Loading published release"}</p>
        <h2>ExampleApp <span>{release?.version}</span></h2></div>
      {release && <div className="release-badge">Published · {new Date(release.publishedAt).toLocaleDateString()}</div>}
    </div>
    {release && <div className="release-grid">{release.installers.map(file =>
      <section className="release-card" key={file.platform}>
        <div className="mini-heading"><h3>{file.platform}</h3><span className="minor-label">{file.arch}</span></div>
        <p className="release-filename">{file.filename}</p>
        <div className="release-size">{file.bytes === null ? "Size unavailable" : <>{(file.bytes / 1048576).toFixed(1)} <span>MiB</span></>}</div>
        {file.available
          ? <a className="text-link" href={file.url}>{revision ? "Download sample manifest" : "Download installer"} <ArrowUpRight size={15} /></a>
          : <p className="footnote">Installer availability could not be confirmed.</p>}
      </section>)}</div>}
    {openEdge && <section className="storage-strip"><HardDrive size={25} /><div><h3>Installer storage</h3>
      <p>{total != null && <>These two packages total {(total / 1048576).toFixed(1)} MiB. </>}Edge Operations shows the bucket inventory and deployment history.</p></div>
      <button className="outline-button" onClick={openEdge}>Edge Operations <ArrowRight size={16} /></button></section>}
  </>;
}
