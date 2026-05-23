import { ArrowLeft } from "lucide-react";
import ModuleQuickNav from "@/src/components/ModuleQuickNav";

interface CopyPilotPageProps {
  onBack: () => void;
}

export default function CopyPilotPage({ onBack }: CopyPilotPageProps) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-50 border-b border-slate-200/60 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft className="size-4" />
            返回
          </button>
          <ModuleQuickNav current="douyin" onNavigate={() => {}} />
        </div>
      </header>
      <main className="flex-1">
        <iframe
          src="/copypilot/"
          title="CopyPilot"
          className="h-[calc(100vh-64px)] w-full border-0"
          allow="clipboard-read; clipboard-write"
        />
      </main>
    </div>
  );
}
