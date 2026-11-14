import { useEffect, useState } from "react";
import { CloudOff, HardDriveDownload, Loader2 } from "lucide-react";
import type { Pack } from "../lib/types";

type S = "checking" | "saving" | "ready" | "dev" | "unsupported";

/** Reports the real offline state: it checks the service worker and the cached pack. */
export default function OfflineStatus({ pack }: { pack: Pack }) {
  const [s, setS] = useState<S>("checking");
  useEffect(() => {
    if (!import.meta.env.PROD) { setS("dev"); return; }
    if (!("serviceWorker" in navigator) || !("caches" in window)) { setS("unsupported"); return; }
    let alive = true;
    const check = async () => {
      const hit = await caches.match("/packs/calculus1.json").catch(() => undefined);
      if (alive) setS(hit && navigator.serviceWorker.controller ? "ready" : "saving");
    };
    check();
    navigator.serviceWorker.ready.then(() => setTimeout(check, 800));
    navigator.serviceWorker.addEventListener("controllerchange", check);
    return () => { alive = false; navigator.serviceWorker.removeEventListener("controllerchange", check); };
  }, []);

  const text: Record<S, string> = {
    checking: "Checking offline availability.",
    saving: "Saving the app and the round pack to this device for offline use.",
    ready: `Saved on this device. Home Mode, hints and answer checking work with no internet. Class games still need a connection.`,
    dev: "Offline mode runs in the deployed app, not in local development.",
    unsupported: "This browser can't save the app for offline use.",
  };
  const Icon = s === "ready" ? HardDriveDownload : s === "saving" || s === "checking" ? Loader2 : CloudOff;
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="flex items-center gap-2 font-bold">
        <Icon size={18} className={`${s === "ready" ? "text-teal-ink" : "text-navy-mute"} ${s === "saving" || s === "checking" ? "animate-spin" : ""}`} aria-hidden />
        Offline
      </h2>
      <p className="mt-1 text-[15px] text-navy-soft" role="status">{text[s]}</p>
      <p className="mt-2 text-sm text-navy-mute">Pack {pack.subject} v{pack.pack_version}: {pack.rounds.length} AI rounds and {pack.exercises.length} exercises.</p>
    </section>
  );
}
