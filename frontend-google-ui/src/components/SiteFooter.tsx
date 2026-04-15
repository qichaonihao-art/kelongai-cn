import { cn } from "@/src/lib/utils";

interface SiteFooterProps {
  className?: string;
}

export default function SiteFooter({ className }: SiteFooterProps) {
  return (
    <footer className={cn("w-full", className)}>
      <div className="mx-auto flex w-full items-center justify-center">
        <a
          href="https://beian.mps.gov.cn/#/query/webSearch?code=42110002000329"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] leading-5 text-slate-400 transition-colors hover:text-slate-500"
        >
          <img
            src="/beian-icon.png"
            alt=""
            aria-hidden="true"
            className="h-4 w-4 shrink-0 opacity-80"
          />
          <span>鄂公网安备42110002000329号</span>
        </a>
      </div>
    </footer>
  );
}
