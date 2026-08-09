"use client";

import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";

export type AppSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type AppSelectProps = {
  id: string;
  options: AppSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  variant?: "default" | "sidebar";
};

const nextEnabledIndex = (options: AppSelectOption[], from: number, direction: 1 | -1) => {
  if (!options.length) return -1;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (from + direction * offset + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
};

export function AppSelect({
  id,
  options,
  value,
  onValueChange,
  name,
  placeholder = "Choose an option",
  ariaLabel,
  disabled = false,
  variant = "default",
}: AppSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  const focusOption = (index: number) => {
    setActiveIndex(index);
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  };

  const openAt = (index: number) => {
    if (disabled) return;
    const fallback = options.findIndex((option) => !option.disabled);
    const target = index >= 0 && !options[index]?.disabled ? index : fallback;
    setOpen(true);
    if (target >= 0) focusOption(target);
  };

  const close = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    close(true);
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const fallback = options.findIndex((option) => !option.disabled);
    const current = selectedIndex >= 0 ? selectedIndex : fallback;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openAt(open ? nextEnabledIndex(options, activeIndex >= 0 ? activeIndex : current, 1) : current);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt(open ? nextEnabledIndex(options, activeIndex >= 0 ? activeIndex : current, -1) : current);
    } else if (event.key === "Home") {
      event.preventDefault();
      openAt(options.findIndex((option) => !option.disabled));
    } else if (event.key === "End") {
      event.preventDefault();
      openAt(
        [...options]
          .map((option, index) => ({ option, index }))
          .reverse()
          .find(({ option }) => !option.disabled)?.index ?? -1,
      );
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) close();
      else openAt(current);
    } else if (event.key === "Escape") {
      close();
    }
  };

  const onOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(nextEnabledIndex(options, index, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(nextEnabledIndex(options, index, -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(options.findIndex((option) => !option.disabled));
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(
        [...options]
          .map((option, optionIndex) => ({ option, optionIndex }))
          .reverse()
          .find(({ option }) => !option.disabled)?.optionIndex ?? -1,
      );
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close();
    }
  };

  return (
    <div className={`app-select app-select-${variant} ${open ? "is-open" : ""}`} ref={rootRef}>
      {name && <input aria-hidden="true" name={name} readOnly tabIndex={-1} type="hidden" value={value} />}
      <button
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="app-select-trigger"
        disabled={disabled}
        id={id}
        onClick={() => (open ? close() : openAt(selectedIndex))}
        onKeyDown={onTriggerKeyDown}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span className={selected ? "app-select-value" : "app-select-placeholder"}>
          {selected?.label ?? placeholder}
        </span>
        <CaretDownIcon aria-hidden="true" className="app-select-caret" size={16} weight="bold" />
      </button>
      {open && (
        <div aria-labelledby={id} className="app-select-menu" id={listboxId} role="listbox">
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <button
                aria-selected={isSelected}
                className={`app-select-option ${isSelected ? "is-selected" : ""}`}
                disabled={option.disabled}
                key={option.value}
                onClick={() => choose(index)}
                onKeyDown={(event) => onOptionKeyDown(event, index)}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                role="option"
                tabIndex={activeIndex === index ? 0 : -1}
                type="button"
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
                {isSelected && <CheckIcon aria-hidden="true" size={16} weight="bold" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
