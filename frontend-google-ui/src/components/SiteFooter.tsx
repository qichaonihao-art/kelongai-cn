import { cn } from "@/src/lib/utils";

interface SiteFooterProps {
  className?: string;
  tone?: "light" | "dark";
}

export default function SiteFooter({ className, tone = "light" }: SiteFooterProps) {
  return (
    <footer className={cn("w-full", className)}>
      <div className="mx-auto flex w-full items-center justify-center">
        <a
          href="https://beian.mps.gov.cn/#/query/webSearch?code=42110002000329"
          target="_blank"
          rel="noreferrer"
          className={cn(
            "inline-flex items-center gap-1.5 text-[11px] leading-5 transition-colors",
            tone === "dark"
              ? "text-indigo-200/80 hover:text-white"
              : "text-slate-500 hover:text-slate-700",
          )}
        >
          <img
            src="/beian-icon.png"
            alt=""
            aria-hidden="true"
            className={cn(
              "h-4 w-4 shrink-0",
              tone === "dark" ? "opacity-90" : "opacity-80",
            )}
          />
          <span>鄂公网安备42110002000329号</span>
        </a>
      </div>
    </footer>
  );
}
