import { createRoot } from 'react-dom/client';
import CreativeSelectPage from './pages/CreativeSelectPage';
import './index.css';
createRoot(document.getElementById('root')!).render(<CreativeSelectPage onBack={() => {}} onNavigate={() => {}} onSelectVideo={() => {}} onSelectClip={() => {}} onSelectCopy={() => {}} onSelectVoiceTransfer={() => {}} onSelectCopyTransfer={() => {}} />);
