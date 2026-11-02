'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { LIMITS, parseField, type LimitName } from '../rules';

/**
 * Inputs keep their own text. Store updates only flow back in while the field
 * is not focused, so a refresh can never move the cursor or eat a keystroke.
 */
function useLocalText(external: string) {
  const [text, setText] = useState(external);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(external);
  }, [external]);
  return {
    text,
    setText,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
    },
  };
}

const rangeText = (limit: LimitName) => {
  const l = LIMITS[limit];
  return `${l.integer ? 'Whole number ' : ''}${l.min}–${l.max}`;
};

export const inputBase =
  'mono w-full rounded-lg border bg-raised text-ink outline-none transition placeholder:text-faint focus-ring';

export function NumInput({
  value,
  onChange,
  limit,
  placeholder,
  ariaLabel,
  className = '',
  showError = false,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  limit: LimitName;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  /** Show the range message under the field (otherwise just the red border). */
  showError?: boolean;
}) {
  const local = useLocalText(value === null ? '' : String(value));
  const parsed = parseField(local.text, limit);
  const invalid = parsed === undefined;
  const errId = useId();

  return (
    <div className="min-w-0">
      <input
        type="text"
        inputMode={LIMITS[limit].integer ? 'numeric' : 'decimal'}
        autoComplete="off"
        enterKeyHint="next"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errId : undefined}
        title={invalid ? `${ariaLabel}: ${rangeText(limit)}` : undefined}
        placeholder={placeholder}
        value={local.text}
        onFocus={(e) => {
          local.onFocus();
          e.currentTarget.select();
        }}
        onBlur={() => {
          local.onBlur();
          // tidy "2,5" or "12." into the stored number; invalid text stays visible
          if (!invalid) local.setText(value === null ? '' : String(value));
        }}
        onChange={(e) => {
          const t = e.target.value;
          local.setText(t);
          const v = parseField(t, limit);
          if (v !== undefined && v !== value) onChange(v);
        }}
        className={`${inputBase} h-11 px-2 text-center text-[15px] ${
          invalid ? 'border-rose text-rose' : 'border-line'
        } ${className}`}
      />
      {invalid && (
        <p id={errId} className={showError ? 'mt-1 text-[11px] text-rose' : 'sr-only'}>
          {rangeText(limit)}
        </p>
      )}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  multiline = false,
  maxLength = 200,
  className = '',
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  ariaLabel: string;
  multiline?: boolean;
  maxLength?: number;
  className?: string;
}) {
  const local = useLocalText(value ?? '');
  const common = {
    'aria-label': ariaLabel,
    placeholder,
    value: local.text,
    maxLength,
    onFocus: local.onFocus,
    onBlur: local.onBlur,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      local.setText(e.target.value);
      onChange(e.target.value === '' ? null : e.target.value);
    },
  };
  const cls = `${inputBase} border-line px-3 text-[14px] font-[inherit] ${className}`;
  return multiline ? (
    <textarea {...common} rows={3} className={`${cls} py-2 leading-relaxed`} style={{ fontFamily: 'inherit' }} />
  ) : (
    <input {...common} type="text" className={`${cls} h-11`} style={{ fontFamily: 'inherit' }} />
  );
}

export function Check({
  checked,
  onChange,
  label,
  tone = 'green',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  tone?: 'green' | 'accent';
}) {
  return (
    <label className="flex min-h-11 cursor-pointer select-none items-center gap-2.5 px-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`h-6 w-6 shrink-0 cursor-pointer ${tone === 'green' ? 'accent-green' : 'accent-accent'}`}
      />
      <span className={`text-[14px] ${checked ? 'text-ink' : 'text-muted'}`}>{label}</span>
    </label>
  );
}
