import { ArrowRight, FileText, Scissors, Video } from 'lucide-react';
export default function CreativeEntry({ onSelectVideo, onSelectClip, onSelectCopy }: { onSelectVideo: () => void; onSelectClip: () => void; onSelectCopy: () => void }) {
  return <div className="studio-creative-entry" aria-label="选择创作方式">
    <button className="studio-entry-feature" onClick={onSelectVideo}><Video size={32} strokeWidth={1.4} /><h2>视频创作</h2><p>参考分析、素材生成、元素替换与人物替换，<br />让产品故事有画面。</p><span>进入视频工作区<ArrowRight size={18} /></span><Video aria-hidden="true" /></button>
    <button className="studio-entry-secondary" onClick={onSelectClip}><Scissors size={28} strokeWidth={1.4} /><div><h2>镜头截取</h2><p>识别切镜、精确剪切，留下需要的片段。</p></div><ArrowRight size={18} /></button>
    <button className="studio-entry-secondary" onClick={onSelectCopy}><FileText size={28} strokeWidth={1.4} /><div><h2>文案创作</h2><p>原创口播与爆款仿写，把卖点说清楚。</p></div><ArrowRight size={18} /></button>
  </div>;
}
