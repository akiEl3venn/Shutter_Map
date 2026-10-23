import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { filterOptions } from '../search/cascade.ts';
import type { Option } from '../search/cascade.ts';
import { strings } from './strings.ts';

export function FilterCombobox({ label, options, value, onChange, disabled = false, placeholder, loading = false }: {
  label: string;
  options: Option[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  loading?: boolean;
}) {
  const selectedLabel = options.find(option => option.value === value)?.label ?? '';
  const [draft, setDraft] = useState(selectedLabel);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const listId = `${id}-options`;
  const unavailable = disabled || loading;
  const expanded = open && !unavailable;
  const filtered = useMemo(() => filterOptions(options, open ? query : ''), [options, query, open]);

  useEffect(() => {
    setDraft(selectedLabel);
    setQuery('');
    setOpen(false);
    setActive(-1);
    composing.current = false;
  }, [value, selectedLabel, unavailable]);

  useEffect(() => {
    if (expanded && active >= 0) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, expanded]);

  function expand() {
    if (unavailable || open) return;
    setQuery('');
    setOpen(true);
    setActive(-1);
  }

  function restore() {
    setDraft(selectedLabel);
    setQuery('');
    setOpen(false);
    setActive(-1);
    composing.current = false;
  }

  function select(option: Option) {
    onChange(option.value);
    setDraft(option.label);
    setQuery('');
    setOpen(false);
    setActive(-1);
  }

  return <div className="filter-combobox" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) restore();
  }}>
    <label htmlFor={id}>{label}</label>
    <div className="filter-combobox-input">
      <input ref={input} id={id} type="text" role="combobox"
        value={unavailable ? '' : draft} disabled={unavailable}
        placeholder={loading ? strings.regionLoading : placeholder}
        aria-autocomplete="list" aria-expanded={expanded} aria-busy={loading}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && active >= 0 && active < filtered.options.length ? `${id}-option-${active}` : undefined}
        autoComplete="off" spellCheck={false}
        onFocus={expand} onClick={expand}
        onChange={event => {
          setDraft(event.currentTarget.value);
          if (!composing.current) setQuery(event.currentTarget.value);
          setOpen(true);
          setActive(-1);
        }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={event => {
          composing.current = false;
          setQuery(event.currentTarget.value);
          setActive(-1);
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || composing.current) return;
          if (event.key === 'Escape') { restore(); return; }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            expand();
            if (!filtered.options.length) return;
            setActive(current => event.key === 'ArrowDown' ? (current + 1) % filtered.options.length
              : (current <= 0 ? filtered.options.length - 1 : current - 1));
          } else if (event.key === 'Enter' && expanded && filtered.options.length) {
            event.preventDefault();
            select(filtered.options[active] ?? filtered.options[0]!);
          }
        }} />
      {value !== null && !unavailable && <button type="button" className="filter-combobox-clear"
        aria-label={strings.clearRegion(label)}
        onPointerDown={event => event.preventDefault()}
        onClick={() => {
          onChange(null);
          setDraft('');
          setQuery('');
          setOpen(false);
          setActive(-1);
          input.current?.focus();
        }}>×</button>}
    </div>
    {expanded && <div className="filter-options">
      {!filtered.options.length && <p role="status" className="filter-options-footer">{strings.noRegionOptions}</p>}
      <ul ref={list} id={listId} role="listbox" aria-label={label}>
        {filtered.options.map((option, position) => <li key={option.value} id={`${id}-option-${position}`}
          role="option" aria-selected={active >= 0 ? active === position : value === option.value}
          className="filter-option" onPointerDown={event => event.preventDefault()}
          onPointerMove={() => setActive(position)} onClick={() => select(option)}>
          <span>{option.label}</span>
          {option.description && <small>{option.description}</small>}
        </li>)}
      </ul>
      {filtered.truncated && <p role="status" className="filter-options-footer">
        {strings.remainingRegionOptions(filtered.remaining)}
      </p>}
    </div>}
  </div>;
}
