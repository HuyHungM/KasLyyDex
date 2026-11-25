"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectProps = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  options: SelectOption[];
  onChange?: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

export default function Select({
  id, name, value, defaultValue = "", options, onChange, disabled = false, ariaLabel, className,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState(defaultValue);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const generatedId = useId();
  const listId = `${id ?? generatedId}-list`;
  const current = value !== undefined ? value : internal;

  function initialIndex() {
    const selected = options.findIndex((option) => option.value === current && !option.disabled);
    return selected >= 0 ? selected : Math.max(0, options.findIndex((option) => !option.disabled));
  }

  function move(step: 1 | -1) {
    setActive((from) => {
      let next = from;
      for (let attempt = 0; attempt < options.length; attempt += 1) {
        next = (next + step + options.length) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return from;
    });
  }

  function choose(option: SelectOption) {
    if (option.disabled) return;
    if (value === undefined) setInternal(option.value);
    setOpen(false);
    onChange?.(option.value);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId, open]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { setActive(initialIndex()); setOpen(true); }
      else move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) { setActive(initialIndex()); setOpen(true); }
      else if (options[active]) choose(options[active]);
    } else if (event.key === "Escape") {
      if (open) { event.preventDefault(); setOpen(false); }
    } else if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      const target = event.key === "Home" ? 0 : options.length - 1;
      setActive(options[target]?.disabled ? initialIndex() : target);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  const selected = options.find((option) => option.value === current);
  return (
    <div ref={root} className={["select", className].filter(Boolean).join(" ")} data-open={open}>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <button
        ref={trigger}
        id={id}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-opt-${active}` : undefined}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setActive(initialIndex());
          setOpen((wasOpen) => !wasOpen);
          trigger.current?.focus();
        }}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{selected?.label ?? ""}</span>
        <svg className="select-chevron" aria-hidden="true" width="10" height="7" viewBox="0 0 10 7" fill="none">
          <path d="m1 1 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <ul className="select-list" id={listId} role="listbox" aria-label={ariaLabel} hidden={!open}>
        {options.map((option, index) => (
          <li
            key={option.value}
            id={`${listId}-opt-${index}`}
            role="option"
            aria-selected={option.value === current}
            aria-disabled={option.disabled || undefined}
            data-value={option.value}
            className="select-option"
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              // Wrapping labels would otherwise forward this click back to the trigger.
              event.preventDefault();
              event.stopPropagation();
              choose(option);
            }}
          >
            {option.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
