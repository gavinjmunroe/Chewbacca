import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { MemoEntry } from './memoActions';
import { sortMemo } from './proposeMemoActions';
import { queryMemo, shouldStartMemoQuery, type MemoQueryState } from './memoQuery';

/** One query per memo at a time; opening history never re-runs model work. */
export function useMemoQueries(
  memos: MemoEntry[],
  setMemos: Dispatch<SetStateAction<MemoEntry[]>>,
  contacts: { id: string; name: string }[] = [],
) {
  const [queries, setQueries] = useState<Record<string, MemoQueryState>>({});
  const available = useRef(contacts);
  available.current = contacts;
  const current = useRef(memos);
  current.current = memos;
  const state = useRef(queries);
  state.current = queries;
  const active = useRef(new Map<string, AbortController>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const pending = active.current;
    return () => {
      alive.current = false;
      pending.forEach((controller) => controller.abort());
    };
  }, []);
  const ask = useCallback(
    async (entry: MemoEntry, question?: string) => {
      if (active.current.has(entry.id)) return;
      const controller = new AbortController();
      active.current.set(entry.id, controller);
      const prior =
        state.current[entry.id] ??
        current.current.find((m) => m.id === entry.id)?.query ??
        entry.query;
      const turns = prior?.sorting && prior.sorting.text !== entry.text ? [] : (prior?.turns ?? []);
      let sorting = prior?.sorting?.text === entry.text ? prior.sorting : undefined;
      let sortingError: string | undefined;
      const update = (value: MemoQueryState) => {
        if (
          !alive.current ||
          (current.current.find((m) => m.id === entry.id)?.text ?? entry.text) !== entry.text
        )
          return;
        value = { ...value, sorting, sortingError };
        state.current = { ...state.current, [entry.id]: value };
        setQueries(state.current);
        setMemos((old) => old.map((m) => (m.id === entry.id ? { ...m, query: value } : m)));
      };
      update({ status: 'running', turns });
      let paintedAt = 0;
      const timer = setTimeout(() => controller.abort(), 90000);
      // Sort once per transcript; follow-up chat and reopening history reuse it.
      const sorted = sorting
        ? Promise.resolve()
        : sortMemo(entry.text, available.current, controller.signal)
            .then((value) => {
              sorting = value;
              update({ ...state.current[entry.id], status: 'running', turns });
            })
            .catch(() => {
              sortingError =
                'People and plans could not be sorted. Your recording is safe; try again.';
            });
      try {
        const turn = await queryMemo(entry, {
          question,
          signal: controller.signal,
          onProgress: (draft) => {
            if (
              !alive.current ||
              controller.signal.aborted ||
              Date.now() - paintedAt < 300 ||
              (current.current.find((m) => m.id === entry.id)?.text ?? entry.text) !== entry.text
            )
              return;
            paintedAt = Date.now();
            const next: MemoQueryState = { status: 'running', turns, draft, sorting, sortingError };
            state.current = { ...state.current, [entry.id]: next };
            setQueries(state.current);
          },
        });
        await sorted;
        update({ status: 'complete', turns: [...turns, turn] });
      } catch (error) {
        await sorted;
        update({
          status: 'error',
          turns,
          error: error instanceof Error ? error.message : 'Could not finish. Try again.',
        });
      } finally {
        clearTimeout(timer);
        active.current.delete(entry.id);
        if (
          alive.current &&
          current.current.some(
            (m) => m.id === entry.id && m.text !== entry.text && m.query?.status === 'queued',
          )
        )
          setMemos((old) => old.map((m) => (m.id === entry.id ? { ...m } : m)));
      }
    },
    [setMemos],
  );
  useEffect(() => {
    for (const memo of memos) {
      if (shouldStartMemoQuery(memo)) void ask(memo);
    }
  }, [memos, ask]);
  return { queries, ask, isRunning: (id: string) => active.current.has(id) };
}
