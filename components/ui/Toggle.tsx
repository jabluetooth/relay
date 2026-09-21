"use client";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}

// Immediate-state control (Toggle vs Checkbox, UI Law #63) — auto-sync takes
// effect the instant it's flipped, unlike a checkbox in a form waiting on
// submit. A bracketed [ON]/[OFF] readout instead of the iOS-style pill
// switch — that exact green/gray pill is itself a named AI tell (#143);
// this one also states its own state in text rather than relying on
// position/color alone.
export default function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex shrink-0 items-center gap-2 rounded border border-border px-2 py-1 font-mono text-xs uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        className={
          "block size-2.5 rounded-sm border transition-colors " +
          (checked ? "border-accent bg-accent" : "border-muted bg-transparent")
        }
        aria-hidden="true"
      />
      <span className={checked ? "text-accent" : "text-muted"}>{checked ? "on" : "off"}</span>
    </button>
  );
}
