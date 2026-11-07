import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { Station } from "@tot/shared";
import { api } from "./api";

// The API has no "list every station" call (an empty query returns []), so the closed-input dropdown shows the main
// termini, resolved by CRS through the same endpoint; typing searches by name, alias or CRS.
const POPULAR = ["EUS", "MAN", "BHM", "LIV", "LDS", "EDB", "BRI", "KGX", "PAD", "NCL"];

let popular: Promise<Station[]> | undefined;
function loadPopular(): Promise<Station[]> {
  popular ??= Promise.all(POPULAR.map((crs) => api.stations(crs).then((found) => found.find((s) => s.crs === crs))))
    .then((found) => found.filter((s): s is Station => s !== undefined))
    .catch(() => {
      popular = undefined; // retry next time the list opens
      return [];
    });
  return popular;
}

interface Props {
  label: string;
  /** CRS code of the chosen station. */
  value: string;
  onChange: (crs: string) => void;
}

export function StationPicker({ label, value, onChange }: Props) {
  const id = useId();
  const [selected, setSelected] = useState<Station | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [options, setOptions] = useState<{ query: string; list: Station[] } | null>(null);

  const query = editing ? text.trim() : "";
  const list = options?.list ?? [];
  const noMatches = editing && query !== "" && options?.query === query && list.length === 0;
  const shown = editing ? text : (selected?.name ?? value);

  // Show the station's name, not just its code, for whatever CRS the parent holds.
  useEffect(() => {
    if (selected?.crs === value) return;
    let cancelled = false;
    api
      .stations(value)
      .then((found) => !cancelled && setSelected(found.find((s) => s.crs === value) ?? null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [value, selected]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        (query ? api.stations(query) : loadPopular())
          .then((found) => !cancelled && (setOptions({ query, list: found }), setActive(0)))
          .catch(() => !cancelled && setOptions({ query, list: [] }));
      },
      query ? 150 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  function pick(station: Station) {
    setSelected(station);
    onChange(station.crs);
    setEditing(false);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else if (list.length) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
    } else if (e.key === "Enter" && open && list[active]) {
      e.preventDefault(); // pick the highlighted station instead of submitting the form
      pick(list[active]);
    } else if (e.key === "Escape" && open) {
      setOpen(false);
      setEditing(false);
    }
  }

  return (
    <div className="relative flex flex-col gap-1 text-sm font-medium text-slate-700">
      <label htmlFor={`${id}-input`}>{label}</label>
      <input
        id={`${id}-input`}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && list[active] ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search stations"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
        value={shown}
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setEditing(false);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setEditing(true);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={`${label} stations`}
          className="absolute left-0 top-full z-20 mt-1 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {!editing && list.length > 0 && (
            <li role="presentation" className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Popular stations
            </li>
          )}
          {list.map((s, i) => (
            <li
              key={s.crs}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the input so blur doesn't close the list before the click lands
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 ${i === active ? "bg-slate-100" : ""}`}
            >
              <span className="text-slate-900">{s.name}</span>
              <span className="font-mono text-xs text-slate-500">{s.crs}</span>
            </li>
          ))}
          {noMatches && (
            <li role="presentation" className="px-3 py-2 font-normal text-slate-500">
              No stations match “{query}”
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
