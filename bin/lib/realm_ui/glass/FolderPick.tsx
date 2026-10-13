// "Choose folder" on the glass, for Carlton Aikins' Realm renderer
// (github.com/31Carlton7/realm). His new space sheet and "Link a folder" call
// window.realm.pickFolder(), which in his Electron app opens the system's
// folder dialog. The glass has no window to hang a dialog on, so bridge.js
// hands the call here: a dialog holding one combobox. The list is the
// checkouts Caleb's tabs worked in lately (GET /glass/folders); typing
// filters it, and a typed path that matches nothing is checked by the server
// before it's returned. Choosing resolves his promise with the path; Escape
// or a press outside resolves null, which is what his code does when the
// system dialog is cancelled.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./pick.css";

type Folder = { path: string; name: string };
type Ask = { resolve: (path: string | null) => void };

const glassFetch = (path: string) =>
  fetch(path, {
    headers: {
      "X-Glass-Token": String(
        (window as unknown as { realm?: { token?: string } }).realm?.token ??
          "",
      ),
    },
  });

const tilde = (path: string, home: string) =>
  home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;

export function FolderPick() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  // window.realm.home is the engine's home, ~/.chewbacca/realm.
  const home = String(
    (window as unknown as { realm?: { home?: string } }).realm?.home ?? "",
  ).replace(/\/\.chewbacca\/realm\/?$/, "");

  // bridge.js looks this up on every pickFolder call.
  useEffect(() => {
    const w = window as unknown as {
      __realmGlassPickFolder?: () => Promise<string | null>;
    };
    w.__realmGlassPickFolder = () =>
      new Promise<string | null>((resolve) => {
        setAsk((prev) => {
          prev?.resolve(null);
          return { resolve };
        });
      });
    return () => {
      delete w.__realmGlassPickFolder;
    };
  }, []);

  useEffect(() => {
    if (!ask) return;
    setFolders(null);
    setError(null);
    setTyped("");
    setPicked(0);
    let live = true;
    glassFetch("/glass/folders")
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then((b: { folders?: Folder[] }) => {
        if (live) setFolders(b.folders ?? []);
      })
      .catch(() => {
        if (!live) return;
        setFolders([]);
        setError("Couldn't list your folders. Type a path instead.");
      });
    requestAnimationFrame(() => field.current?.focus());
    return () => {
      live = false;
    };
  }, [ask]);

  const shown = useMemo(() => {
    const q = typed.trim().toLowerCase();
    const all = folders ?? [];
    return q
      ? all.filter((f) => tilde(f.path, home).toLowerCase().includes(q))
      : all;
  }, [folders, typed, home]);

  const done = useCallback(
    (path: string | null) => {
      ask?.resolve(path);
      setAsk(null);
    },
    [ask],
  );

  const submit = useCallback(async () => {
    if (shown[picked]) return done(shown[picked].path);
    const p = typed.trim();
    if (!p) return;
    let r: Response;
    try {
      r = await glassFetch(`/glass/folders?path=${encodeURIComponent(p)}`);
    } catch (err) {
      setError(`Couldn't check that path: ${String(err)}`);
      return;
    }
    const b = r.ok ? ((await r.json()) as { folder?: string }) : null;
    if (b?.folder) done(b.folder);
    else setError(`${p} isn't a git checkout in your home folder.`);
  }, [shown, picked, typed, done]);

  if (!ask) return null;
  return (
    <div
      className="glass-pick-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) done(null);
      }}
    >
      <div
        className="glass-pick"
        data-region="pick"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a folder"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            done(null);
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const n = shown.length;
            if (n)
              setPicked((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
          } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            void submit();
          }
        }}
      >
        <div className="glass-pick-title">Where should it work?</div>
        <input
          ref={field}
          className="glass-pick-field"
          role="combobox"
          aria-expanded="true"
          aria-controls="glass-pick-list"
          placeholder="Find a repo, or type a path"
          value={typed}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setTyped(e.target.value);
            setPicked(0);
            setError(null);
          }}
        />
        {error ? <div className="glass-pick-error">{error}</div> : null}
        <div
          id="glass-pick-list"
          className="glass-pick-list"
          role="listbox"
          aria-label="Folders"
        >
          {folders === null ? (
            <div className="glass-pick-empty">Looking for your repos…</div>
          ) : shown.length === 0 ? (
            <div className="glass-pick-empty">
              {typed.trim()
                ? "No repo matches. Return checks it as a path."
                : "No repos found. Type a path."}
            </div>
          ) : (
            shown.map((f, i) => (
              <button
                key={f.path}
                type="button"
                role="option"
                aria-selected={i === picked}
                className="glass-pick-row"
                data-picked={i === picked ? "" : undefined}
                // Move, not enter: a pointer resting where the dialog opens
                // would otherwise pick a row nobody pointed at.
                onPointerMove={() => setPicked(i)}
                onClick={() => done(f.path)}
              >
                <span className="glass-pick-name">{f.name}</span>
                <span className="glass-pick-path">{tilde(f.path, home)}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
