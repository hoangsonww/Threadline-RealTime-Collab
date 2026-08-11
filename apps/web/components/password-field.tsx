"use client";

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";

export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  placeholder,
  helper,
}: {
  id?: string;
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  helper?: React.ReactNode;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div className="password-field">
        <input
          id={inputId}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className="password-input"
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          title={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
        </button>
      </div>
      {helper}
    </div>
  );
}
