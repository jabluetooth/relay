// A harsh bracketed mono label instead of the rounded "sparkle pill" badge
// that sits above every AI-generated hero.
export default function Tag({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={"inline-block font-mono text-xs uppercase tracking-[0.12em] text-muted " + className}>
      [&nbsp;{children}&nbsp;]
    </span>
  );
}
