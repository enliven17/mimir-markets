"use client";

import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

/**
 * Inputs follow the pill/well language: `--panel-2` fill, inset
 * shadow-well, cream text, dim placeholder, 2px coral focus ring. Single-line
 * fields are pills, textareas `rounded-lg`.
 */
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  mono?: boolean;
  dot?: string;
  hint?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, mono, dot, hint, className = "", id, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? (label ? `in-${autoId.replace(/:/g, "")}` : undefined);
    return (
      <div>
        {label && (
          <label className="label" htmlFor={inputId}>
            {dot && (
              <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: dot }} />
            )}
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`input ${mono ? "font-mono text-xs" : ""} ${className}`}
          {...props}
        />
        {hint ? <p className="mt-2 text-[13px] text-muted">{hint}</p> : null}
      </div>
    );
  },
);

Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }>(
  ({ label, className = "", id, ...props }, ref) => {
    const autoId = useId();
    const areaId = id ?? (label ? `ta-${autoId.replace(/:/g, "")}` : undefined);
    return (
      <div>
        {label && (
          <label className="label" htmlFor={areaId}>
            {label}
          </label>
        )}
        <textarea ref={ref} id={areaId} className={`input min-h-[7rem] resize-y ${className}`} {...props} />
      </div>
    );
  },
);

Textarea.displayName = "Textarea";

export default Input;
