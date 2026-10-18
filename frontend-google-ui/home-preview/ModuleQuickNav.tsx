import OriginalModuleQuickNav from '../src/components/ModuleQuickNav';
export type { ModuleId } from '../src/components/ModuleQuickNav';
import type { ModuleId } from '../src/components/ModuleQuickNav';

// The shared preview shell owns module navigation. Original comparison still
// renders the original navigation; hiding is scoped to the new shell only.
export default function ModuleQuickNav(props: { current: ModuleId; onNavigate: (page: ModuleId) => void }) {
  return <div data-preview-module-nav><OriginalModuleQuickNav {...props} /></div>;
}
