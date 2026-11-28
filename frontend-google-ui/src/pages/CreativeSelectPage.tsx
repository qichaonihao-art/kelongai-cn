import { AudioLines, FileAudio, FileText, Scissors, Video } from 'lucide-react';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';
import HomeBackButton from '@/src/components/HomeBackButton';

interface CreativeSelectPageProps {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
  onSelectVideo: () => void;
  onSelectClip: () => void;
  onSelectCopy: () => void;
  onSelectVoiceTransfer?: () => void;
  onSelectCopyTransfer?: () => void;
}

const tools = [
  { id: 'video' as const, title: '视频创作', icon: Video, surface: 'border-[#b6d2be] bg-[#dcecdf] hover:bg-[#d3e7d8]', iconColor: 'bg-[#add2b8] text-[#1d5033]', titleColor: 'text-[#214a32]' },
  { id: 'clip' as const, title: '镜头截取', icon: Scissors, surface: 'border-[#b8d3e2] bg-[#dfedf5] hover:bg-[#d5e7f1]', iconColor: 'bg-[#b4d5e6] text-[#275872]', titleColor: 'text-[#2c5267]' },
  { id: 'copy' as const, title: '文案创作', icon: FileText, surface: 'border-[#ddcbb1] bg-[#f2e8d8] hover:bg-[#ecdfcc]', iconColor: 'bg-[#dfc69f] text-[#674624]', titleColor: 'text-[#62472d]' },
  { id: 'voice-transfer' as const, title: '音色转移', icon: AudioLines, surface: 'border-[#cfc1df] bg-[#ece5f4] hover:bg-[#e5daef]', iconColor: 'bg-[#cdb9df] text-[#50396d]', titleColor: 'text-[#55436a]' },
  { id: 'copy-transfer' as const, title: '文案转移', icon: FileAudio, surface: 'border-[#b1d3ca] bg-[#dceee9] hover:bg-[#d1e7e0]', iconColor: 'bg-[#afd8cb] text-[#235d4e]', titleColor: 'text-[#25594d]' },
];

export default function CreativeSelectPage({
  onBack, onNavigate, onSelectVideo, onSelectClip, onSelectCopy, onSelectVoiceTransfer, onSelectCopyTransfer,
}: CreativeSelectPageProps) {
  const actions = {
    video: onSelectVideo,
    clip: onSelectClip,
    copy: onSelectCopy,
    'voice-transfer': onSelectVoiceTransfer,
    'copy-transfer': onSelectCopyTransfer,
  };

  return (
    <div className="min-h-screen bg-[#f7f8f6] px-4 py-5 text-[#253630] sm:px-6 sm:py-6">
      <div className="mx-auto flex w-full max-w-[78rem] items-center gap-2">
        <HomeBackButton onClick={onBack} />
        <ModuleQuickNav current="creative" onNavigate={onNavigate} />
      </div>

      <main className="mx-auto w-full max-w-[58rem] pb-20 pt-14 sm:pt-20 lg:pt-24">
        <h1 className="mb-8 border-b border-[#dbe4df] pb-5 text-[29px] font-semibold tracking-[-0.025em] text-[#213d34] sm:mb-9 sm:text-[32px]">创意创作</h1>
        <div className="grid gap-3.5 sm:grid-cols-6">
          {tools.map((tool, index) => {
            const Icon = tool.icon;
            return <button
              key={tool.id}
              type="button"
              onClick={actions[tool.id]}
              className={`flex min-h-[152px] flex-col items-start justify-between rounded-[14px] border p-5 text-left shadow-[0_8px_18px_-14px_rgba(29,57,48,0.35)] transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_28px_-18px_rgba(29,57,48,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3d8660] focus-visible:ring-offset-2 sm:min-h-[164px] sm:p-6 ${index < 3 ? 'sm:col-span-2' : 'sm:col-span-3'} ${tool.surface} motion-reduce:transform-none`}
            >
              <span className={`flex size-11 items-center justify-center rounded-[11px] ${tool.iconColor}`}><Icon className="size-[21px]" strokeWidth={1.75} /></span>
              <span className={`text-[18px] font-semibold tracking-[-0.018em] ${tool.titleColor}`}>{tool.title}</span>
            </button>;
          })}
        </div>
      </main>
    </div>
  );
}
