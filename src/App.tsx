import { useEffect, useRef, useState } from "react";
import type { Asset, Bank, Ink, Workspace, Attempt } from "./types";
import { bankKey } from "./types";
import * as db from "./db";
import * as engine from "./engine";
import { unpack, pack, assetRefs, download } from "./archive";
import { InkCanvas, type Tool } from "./InkCanvas";

function AssetImage({ asset }: { asset: Asset }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true,
      u = "";
    db.getAsset(asset.path)
      .then((b) => {
        if (active && b) {
          u = URL.createObjectURL(b);
          setUrl(u);
        } else if (active) setError(true);
      })
      .catch(() => setError(true));
    return () => {
      active = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [asset.path]);
  return error ? (
    <p role="alert">圖片無法載入。請重新匯入原題庫。</p>
  ) : url ? (
    <img src={url} alt={asset.alt} />
  ) : (
    <p aria-busy="true">載入圖片…</p>
  );
}
export default function App() {
  const [work, setWork] = useState<Workspace | null>(null),
    ref = useRef<Workspace | null>(null),
    [bank, setBank] = useState<Bank | null>(null),
    [banks, setBanks] = useState<Bank[]>([]),
    [topics, setTopics] = useState<string[]>([]),
    [tool, setTool] = useState<Tool>("pen"),
    [activeArea, setActiveArea] = useState<"thinking" | "answer" | "question">(
      "thinking",
    ),
    [busy, setBusy] = useState(false),
    lock = useRef(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [promptUrls, setPromptUrls] = useState<string[]>([]),
    [history, setHistory] = useState(false),
    [referenceOpen, setReferenceOpen] = useState(false),
    [menuOpen, setMenuOpen] = useState(false),
    [shareFailed, setShareFailed] = useState(false),
    [menuPosition, setMenuPosition] = useState({
      top: 60,
      right: 16,
      maxHeight: 600,
    }),
    [pendingRestore, setPendingRestore] = useState<{
      data: Awaited<ReturnType<typeof unpack>>;
      revision: number;
      name: string;
    } | null>(null),
    [backup, setBackup] = useState<{ blob: Blob; name: string } | null>(null);
  const tail = useRef<Promise<void>>(Promise.resolve()),
    rev = useRef(0),
    failed = useRef(false),
    bankFile = useRef<HTMLInputElement>(null),
    backupFile = useRef<HTMLInputElement>(null),
    actions = useRef<HTMLDivElement>(null),
    restoreDialog = useRef<HTMLDialogElement>(null),
    menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = restoreDialog.current;
    if (pendingRestore && dialog && !dialog.open) dialog.showModal();
    if (!pendingRestore && dialog?.open) dialog.close();
  }, [pendingRestore]);
  function closeMenu() {
    actions.current?.hidePopover();
  }
  useEffect(() => {
    const dismiss = () => actions.current?.hidePopover();
    window.addEventListener("resize", dismiss);
    return () => window.removeEventListener("resize", dismiss);
  }, []);
  function chooseFile(kind: "bank" | "backup") {
    closeMenu();
    (kind === "bank" ? bankFile : backupFile).current?.click();
  }
  const show = (w: Workspace) => {
    ref.current = w;
    setWork(w);
  };
  useEffect(() => {
    db.getWorkspace()
      .then(async (w) => {
        rev.current = w.revision;
        show(w);
        setTopics(w.selectedTopics);
        if (w.bankKey)
          setBank(
            (await db.getBank(
              w.session?.phase === "active" ? w.session.bankKey : w.bankKey,
            )) || null,
          );
        const snap = await db.snapshot();
        setBanks(snap.banks);
      })
      .catch(() => setError("無法開啟本地資料。請確認不是私人瀏覽模式。"));
    navigator.storage?.persist?.().catch(() => {});
  }, []);
  const session = work?.session,
    attempt = session?.attemptId
      ? work?.attempts[session.attemptId]
      : undefined,
    q = bank?.questions.find((q) => q.id === session?.currentId),
    inPractice = session?.phase === "active" && q && attempt;
  useEffect(() => {
    setReferenceOpen(!!attempt?.revealed);
  }, [attempt?.id, attempt?.revealed]);
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setPromptUrls([]);
    if (q)
      Promise.all(
        q.prompt.map(async (a) => {
          const b = await db.getAsset(a.path);
          if (!b) throw Error("題目圖片缺失，請重新匯入題庫。");
          const u = URL.createObjectURL(b);
          urls.push(u);
          return u;
        }),
      )
        .then((us) => {
          if (active) setPromptUrls(us);
          else us.forEach(URL.revokeObjectURL);
        })
        .catch((e) => setError(String(e.message)));
    return () => {
      active = false;
      urls.forEach(URL.revokeObjectURL);
    };
  }, [q?.id]);
  useEffect(() => {
    if (!session || !bank) return;
    const next = bank.questions.find((q) => q.id === session.queue[0]);
    if (next) next.prompt.forEach((a) => db.getAsset(a.path).catch(() => {}));
  }, [session?.currentId]);
  function schedule(w: Workspace) {
    show(w);
    setStatus("儲存中…");
    const snapshot = structuredClone(w);
    tail.current = tail.current
      .then(async () => {
        const saved = await db.commit(snapshot, rev.current);
        rev.current = saved.revision;
        if (ref.current) {
          ref.current = { ...ref.current, revision: saved.revision };
          setWork(ref.current);
        }
        setStatus("已儲存");
      })
      .catch((e) => {
        failed.current = true;
        setError(e.message || "保存失敗。草稿仍在畫面上，請重試。");
        throw e;
      });
    tail.current.catch(() => {});
  }
  function inkChanged(area: "thinking" | "answer" | "question", ink: Ink) {
    const w = ref.current;
    if (!w?.session?.attemptId) return;
    const id = w.session.attemptId;
    schedule({
      ...w,
      attempts: { ...w.attempts, [id]: { ...w.attempts[id], [area]: ink } },
    });
  }
  async function act(fn: (w: Workspace) => Workspace) {
    if (lock.current || !ref.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await tail.current;
      if (failed.current) throw Error("請先重試保存。");
      const next = fn(ref.current);
      const saved = await db.commit(next, rev.current);
      rev.current = saved.revision;
      show(saved);
      setStatus("已儲存");
      setHistory(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function retry() {
    if (!ref.current) return;
    try {
      const saved = await db.commit(ref.current, rev.current);
      rev.current = saved.revision;
      show(saved);
      tail.current = Promise.resolve();
      failed.current = false;
      setError("");
      setStatus("已儲存");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function importFile(f: File, intent: "bank" | "backup") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await tail.current;
      const data = await unpack(f);
      if (intent === "bank" && data.format !== "ppsbank")
        throw Error("呢個唔係題庫檔案。要還原進度，請選「還原備份」。");
      if (intent === "backup" && data.format !== "ppsbackup")
        throw Error("呢個唔係備份檔案。要加入題目，請選「匯入題庫」。");
      if (data.format === "ppsbank") {
        const imported = data.banks[0];
        const key = await db.installBank(imported, data.assets);
        const snap = await db.snapshot();
        setBanks(snap.banks);
        const w = ref.current!;
        if (w.session?.phase !== "active") {
          const updated = await db.commit(
            { ...w, bankKey: key, session: null, selectedTopics: [] },
            rev.current,
          );
          rev.current = updated.revision;
          show(updated);
          setBank(imported);
          setTopics([]);
        }
        setStatus("題庫已匯入");
      } else if (data.format === "ppsbackup" && data.workspace) {
        setPendingRestore({ data, revision: rev.current, name: f.name });
      } else throw Error("呢個係供 review 使用嘅匯出包，唔係題庫或備份。");
    } catch (e) {
      setError((e as Error | null)?.message || "匯入失敗；原有資料未被取代。");
    } finally {
      lock.current = false;
      setBusy(false);
      if (bankFile.current) bankFile.current.value = "";
      if (backupFile.current) backupFile.current.value = "";
    }
  }
  async function confirmRestore() {
    if (lock.current || !pendingRestore?.data.workspace) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const { data, revision } = pendingRestore;
    try {
      const w = await db.restore(
        { ...data, workspace: data.workspace! },
        revision,
      );
      rev.current = w.revision;
      show(w);
      tail.current = Promise.resolve();
      failed.current = false;
      setBank(
        data.banks.find(
          (b) =>
            bankKey(b) ===
            (w.session?.phase === "active" ? w.session.bankKey : w.bankKey),
        ) || null,
      );
      setBanks(data.banks);
      setTopics(w.selectedTopics);
      setStatus("已還原");
      setPendingRestore(null);
    } catch (e) {
      setPendingRestore(null);
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function makeBackup(review = false) {
    if (lock.current) return;
    closeMenu();
    setBackup(null);
    setShareFailed(false);
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await tail.current;
      const snap = await db.snapshot();
      if (review && q && bank) {
        const a = Object.values(snap.workspace.attempts).filter(
          (a) => a.questionId === q.id && a.bankKey === bankKey(bank),
        );
        const minimal = { ...bank, questions: [q] };
        const refs = new Set(assetRefs(minimal).map((a) => a.path));
        const blob = await pack(
          "ppsreview",
          [minimal],
          new Map([...snap.assets].filter(([k]) => refs.has(k))),
          { questionId: q.id, attempts: a },
        );
        setBackup({ blob, name: `${q.id}.ppsreview` });
      } else
        setBackup({
          blob: await pack(
            "ppsbackup",
            snap.banks,
            snap.assets,
            snap.workspace,
          ),
          name: `Past-Paper-${new Date().toISOString().slice(0, 10)}.ppsbackup`,
        });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function saveBackup() {
    if (!backup) return;
    const f = new File([backup.blob], backup.name, { type: "application/zip" });
    if (!shareFailed && navigator.canShare?.({ files: [f] })) {
      try {
        await navigator.share({ files: [f] });
        setBackup(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setShareFailed(true);
          setError("未能分享，請選擇下載備份。");
        }
      }
    } else {
      download(backup.blob, backup.name);
      setBackup(null);
    }
  }
  function editUndo(redo = false) {
    const w = ref.current;
    if (!w?.session?.attemptId) return;
    const ink = w.attempts[w.session.attemptId][activeArea],
      stack = redo ? ink.redo : ink.undo;
    if (!stack.length) return;
    inkChanged(activeArea, {
      ...ink,
      strokes: stack.at(-1)!,
      undo: redo ? [...ink.undo, ink.strokes] : ink.undo.slice(0, -1),
      redo: redo ? ink.redo.slice(0, -1) : [...ink.redo, ink.strokes],
      events: [
        ...ink.events,
        { at: Date.now(), action: redo ? "redo" : "undo", strokeIds: [] },
      ],
    });
  }
  if (!work)
    return (
      <main className="loading">
        <p>{error || "開啟練習…"}</p>
      </main>
    );
  const inkProps = (area: "thinking" | "answer" | "question") => ({
    ink: attempt![area],
    onChange: (i: Ink) => inkChanged(area, i),
    tool,
    width: work.pen.width,
    onActive: () => setActiveArea(area),
    readOnly: busy || attempt?.passed !== undefined,
  });
  const archived = q
    ? Object.values(work.attempts).filter(
        (a) => a.questionId === q.id && a.id !== attempt?.id,
      )
    : [];
  const reviewExport = backup?.name.endsWith(".ppsreview");
  const canSharePrepared =
    !shareFailed &&
    !!backup &&
    !!navigator.canShare?.({
      files: [
        new File([backup.blob], backup.name, { type: "application/zip" }),
      ],
    });
  return (
    <>
      <header className="app-bar">
        <span className="app-title">Past Paper</span>
        {inPractice && <span className="question-title">{q.title}</span>}
        <span className="save-status" role="status">
          {status}
        </span>
        <button
          ref={menuButton}
          className="data-button"
          popoverTarget="practice-actions"
          aria-expanded={menuOpen}
          aria-controls="practice-actions"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const width = Math.min(
              20 *
                parseFloat(getComputedStyle(document.documentElement).fontSize),
              window.innerWidth - 32,
            );
            const top = Math.min(
              r.bottom + 8,
              Math.max(16, window.innerHeight - 160),
            );
            setMenuPosition({
              top,
              right: Math.max(
                16,
                Math.min(
                  window.innerWidth - r.right,
                  window.innerWidth - width - 16,
                ),
              ),
              maxHeight: window.innerHeight - top - 16,
            });
          }}
        >
          {inPractice ? "更多選項" : "管理資料"}
          <span aria-hidden="true"> ⋯</span>
        </button>
        <div
          id="practice-actions"
          className="actions-popover"
          popover="auto"
          ref={actions}
          style={menuPosition}
          onToggle={(e) => {
            const opened = (e.nativeEvent as ToggleEvent).newState === "open";
            setMenuOpen(opened);
            if (opened)
              actions.current
                ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
                ?.focus();
            else if (
              document.activeElement === document.body ||
              actions.current?.contains(document.activeElement)
            )
              menuButton.current?.focus();
          }}
        >
          {inPractice && (
            <div className="action-group" role="group" aria-label="目前題目">
              <p className="group-title">目前題目</p>
              <button
                onClick={() => {
                  closeMenu();
                  setHistory((v) => !v);
                }}
                disabled={!archived.length}
              >
                {history ? "隱藏之前作答" : "查看之前作答"}
              </button>
              <button onClick={() => makeBackup(true)} disabled={busy}>
                匯出這題與草稿…
              </button>
              {work.lastGrade && (
                <button
                  disabled={busy}
                  onClick={() => {
                    closeMenu();
                    act(engine.undoGrade);
                  }}
                >
                  撤銷上一個評分
                </button>
              )}
            </div>
          )}
          <div className="action-group" role="group" aria-label="題庫">
            <p className="group-title">題庫</p>
            <button
              autoFocus
              onClick={() => chooseFile("bank")}
              disabled={busy}
            >
              匯入題庫…
            </button>
          </div>
          <div className="action-group" role="group" aria-label="備份">
            <p className="group-title">備份</p>
            <button
              onClick={() => makeBackup()}
              disabled={busy || !banks.length}
            >
              匯出備份…
            </button>
            <button onClick={() => chooseFile("backup")} disabled={busy}>
              還原備份…
            </button>
          </div>
          <p className="menu-note">草稿及進度會自動儲存在這部裝置。</p>
        </div>
        <input
          ref={bankFile}
          type="file"
          hidden
          accept=".ppsbank,application/zip"
          aria-label="選擇題庫檔案"
          tabIndex={-1}
          className="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f, "bank");
          }}
        />
        <input
          ref={backupFile}
          type="file"
          hidden
          accept=".ppsbackup,application/zip"
          aria-label="選擇備份檔案"
          tabIndex={-1}
          className="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f, "backup");
          }}
        />
      </header>
      <dialog
        ref={restoreDialog}
        aria-labelledby="restore-title"
        aria-describedby="restore-description"
        className="restore-dialog"
        onCancel={() => setPendingRestore(null)}
      >
        <h2 id="restore-title">還原這份備份？</h2>
        <p id="restore-description">
          這部裝置目前的題庫、草稿及練習進度，會被備份中的內容取代。此操作不會合併兩份資料。
        </p>
        <p className="restore-filename">{pendingRestore?.name}</p>
        <div className="dialog-actions">
          <button
            autoFocus
            disabled={busy}
            onClick={() => setPendingRestore(null)}
          >
            取消
          </button>
          <button
            className="destructive"
            disabled={busy}
            onClick={confirmRestore}
          >
            還原備份
          </button>
        </div>
      </dialog>
      {error && (
        <div className="error" role="alert">
          {error}
          {failed.current && <button onClick={retry}>重試保存</button>}
        </div>
      )}
      {backup && (
        <div className="backup-bar" role="status">
          <span>{reviewExport ? "題目與草稿已準備好" : "備份已準備好"}</span>
          <button className="primary" onClick={saveBackup}>
            {canSharePrepared
              ? "儲存或分享…"
              : reviewExport
                ? "下載題目與草稿"
                : "下載備份"}
          </button>
          <button onClick={() => setBackup(null)}>稍後</button>
        </div>
      )}
      {!inPractice ? (
        <main className="topics-page">
          {!bank ? (
            <>
              <h1>加入第一份題庫</h1>
              <p>選擇已準備好的題庫檔案。匯入一次後，就可以離線練習。</p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => chooseFile("bank")}
              >
                {busy ? "匯入中…" : "匯入題庫"}
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => chooseFile("backup")}
              >
                已有備份？還原練習進度
              </button>
            </>
          ) : (
            <>
              <h1>選擇練習主題</h1>
              {session?.phase === "complete" && (
                <div className="complete">
                  <p>呢一組已經全部完成。</p>
                  <button onClick={() => makeBackup()} disabled={busy}>
                    匯出備份…
                  </button>
                </div>
              )}
              {banks.length > 1 && (
                <label className="bank-select">
                  題庫
                  <select
                    value={bankKey(bank)}
                    disabled={busy}
                    onChange={(e) => {
                      const b = banks.find(
                        (b) => bankKey(b) === e.target.value,
                      )!;
                      setBank(b);
                      setTopics([]);
                      act((w) => ({
                        ...w,
                        bankKey: bankKey(b),
                        session: null,
                        selectedTopics: [],
                      }));
                    }}
                  >
                    {banks.map((b) => (
                      <option key={bankKey(b)} value={bankKey(b)}>
                        {b.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="secondary">
                可選多個主題。做完這一組後，再選下一組。
              </p>
              {[...new Set(bank.topics.map((t) => t.subject))].map(
                (subject) => (
                  <fieldset key={subject}>
                    <legend>{subject}</legend>
                    {bank.topics
                      .filter((t) => t.subject === subject)
                      .map((t) => (
                        <label className="topic-row" key={t.id}>
                          <input
                            type="checkbox"
                            checked={topics.includes(t.id)}
                            disabled={busy}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...topics, t.id]
                                : topics.filter((id) => id !== t.id);
                              setTopics(next);
                              schedule({
                                ...ref.current!,
                                selectedTopics: next,
                              });
                            }}
                          />
                          <span>{t.title}</span>
                        </label>
                      ))}
                  </fieldset>
                ),
              )}
              <div className="start-bar">
                <button
                  className="primary"
                  disabled={!topics.length || busy || failed.current}
                  onClick={() => act((w) => engine.start(w, bank, topics))}
                >
                  開始練習
                </button>
              </div>
            </>
          )}
        </main>
      ) : (
        <>
          <nav className="drawing-toolbar" aria-label="書寫工具">
            <div className="tool-group">
              {(
                [
                  ["pen", "筆"],
                  ["eraser", "擦膠"],
                  ["lasso", "選取"],
                ] as const
              ).map(([v, name]) => (
                <button
                  key={v}
                  aria-pressed={tool === v}
                  onClick={() => setTool(v)}
                >
                  {name}
                </button>
              ))}
            </div>
            <button
              onClick={() => editUndo()}
              disabled={
                busy ||
                !attempt[activeArea].undo.length ||
                attempt.passed !== undefined
              }
            >
              Undo
            </button>
            <button
              onClick={() => editUndo(true)}
              disabled={
                busy ||
                !attempt[activeArea].redo.length ||
                attempt.passed !== undefined
              }
            >
              Redo
            </button>
            <details className="pen-size">
              <summary>筆粗</summary>
              <label>
                粗幼{" "}
                <input
                  type="range"
                  min="0.4"
                  max="6"
                  step="0.1"
                  value={work.pen.width}
                  onChange={(e) =>
                    schedule({
                      ...ref.current!,
                      pen: { ...work.pen, width: Number(e.target.value) },
                    })
                  }
                />
                <output>{work.pen.width.toFixed(1)}</output>
              </label>
            </details>
            {q.kind === "sq" && attempt.revealed && (
              <button onClick={() => setReferenceOpen((v) => !v)}>
                {referenceOpen ? "返回題目" : "參考答案"}
              </button>
            )}
            <span className="gesture-tip">
              Apple Pencil 書寫 · 雙指縮放及移動
            </span>
          </nav>
          <main
            className={`practice ${q.kind} ${referenceOpen ? "reference-open" : ""}`}
          >
            <section className="question-panel">
              <h1 className="sr-only">{q.title}</h1>
              {promptUrls.length === q.prompt.length ? (
                <InkCanvas
                  key={`${attempt.id}-question`}
                  label="題目"
                  backgrounds={promptUrls}
                  {...inkProps("question")}
                />
              ) : (
                <p>載入題目…</p>
              )}
              {q.kind === "mc" && (
                <div className="choices" aria-label="答案選項">
                  {q.options!.map((o) => (
                    <button
                      key={o.id}
                      className={
                        "choice " +
                        (attempt.selected === o.id ? "selected " : "") +
                        (attempt.passed !== undefined &&
                        q.correctOptionId === o.id
                          ? "correct"
                          : "")
                      }
                      disabled={
                        busy || attempt.passed !== undefined || failed.current
                      }
                      onClick={() =>
                        act((w) => engine.selectMC(w, bank!, o.id))
                      }
                    >
                      <strong>{o.id}</strong>
                      <span>
                        {o.text}
                        {o.image && <AssetImage asset={o.image} />}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
            <section className="work-panel">
              {q.kind === "sq" && (
                <InkCanvas
                  key={`${attempt.id}-answer`}
                  label="答案"
                  lined
                  {...inkProps("answer")}
                />
              )}
              <InkCanvas
                key={`${attempt.id}-thinking`}
                label="思考空間"
                {...inkProps("thinking")}
              />
            </section>
            {(attempt.revealed || attempt.passed !== undefined) && (
              <section className="answer-panel" aria-label="參考答案">
                <h2>
                  {q.kind === "mc"
                    ? attempt.passed
                      ? "✓ 答對"
                      : "答錯"
                    : q.answerLabel}
                </h2>
                {q.kind === "mc" && (
                  <p>
                    你選擇 {attempt.selected}；正確答案係{" "}
                    <strong>{q.correctOptionId}</strong>。
                  </p>
                )}
                {q.answer.map((a, i) => (
                  <AssetImage key={i} asset={a} />
                ))}
                <p className="secondary">{q.answerLabel} · 已與原頁配對</p>
              </section>
            )}
            {history && (
              <section className="history">
                <h2>之前作答</h2>
                {archived.map((a) => (
                  <article key={a.id}>
                    <p>
                      {new Date(a.createdAt).toLocaleString("zh-HK")} ·{" "}
                      {a.passed === undefined
                        ? "未評分"
                        : a.passed
                          ? "滿分"
                          : "未滿分"}
                    </p>
                    {a.selected && <p>所選答案：{a.selected}</p>}
                    {(["question", "answer", "thinking"] as const)
                      .filter((k) => a[k].strokes.length)
                      .map((k) => (
                        <InkCanvas
                          key={k}
                          label={
                            k === "answer"
                              ? "舊答案"
                              : k === "question"
                                ? "舊題目標註"
                                : "舊思考空間"
                          }
                          ink={a[k]}
                          onChange={() => {}}
                          tool="pen"
                          width={1}
                          readOnly
                        />
                      ))}
                  </article>
                ))}
              </section>
            )}
          </main>
          <footer className="action-bar">
            {q.kind === "mc" ? (
              attempt.passed !== undefined ? (
                <button
                  className="primary"
                  disabled={busy || failed.current}
                  onClick={() => act((w) => engine.nextMC(w, bank!))}
                >
                  下一題
                </button>
              ) : (
                <span>思考後，點選一個答案。</span>
              )
            ) : attempt.revealed ? (
              <>
                <button
                  disabled={busy || failed.current}
                  onClick={() => act((w) => engine.markSQ(w, bank!, false))}
                >
                  未滿分
                </button>
                <button
                  className="primary"
                  disabled={busy || failed.current}
                  onClick={() => act((w) => engine.markSQ(w, bank!, true))}
                >
                  滿分
                </button>
              </>
            ) : (
              <button
                className="primary"
                disabled={busy || failed.current}
                onClick={() => act(engine.reveal)}
              >
                查看答案
              </button>
            )}
          </footer>
        </>
      )}
    </>
  );
}
