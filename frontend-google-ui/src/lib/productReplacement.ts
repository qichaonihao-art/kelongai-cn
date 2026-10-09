import { readReplacementCompatibility } from '../../../legacy-project/replacement-compatibility.mjs';
import type { PaintingProductType } from './creative';
export type ReplacementProductType = PaintingProductType | 'generic';
export const replacementProductLabel = (type: ReplacementProductType) => ({ hanging: '挂画／卷轴', sticker: 'PVC贴画', ornament: '固定一体摆件', generic: '其他元素' })[type];
export const replacementElementLabel = (type: ReplacementProductType) => ({ hanging: '挂画', sticker: '贴画', ornament: '摆台', generic: '指定元素' })[type];
export function replacementProductRules(type: ReplacementProductType): string {
  if (type === 'generic') return '';
  const physics = type === 'hanging'
    ? '保留原视频与参考图实际可见的上下木条、挂绳与悬挂或卷轴结构，不新加轴头，不使用贴画背胶、摆件后撑杆或AI素材的固定尺寸补偿。'
    : type === 'sticker'
      ? '目标为哑光柔性PVC平面印刷贴画，无实体边框、上下木条、挂绳或支架。印刷装饰边线仍是膜面的平面像素；安装镜头才有白色背面和背膜，不新增揭膜动作。不猜厘米尺寸，按原目标占比和参考图比例。'
      : '目标为固定一体摆台：金色矩形铝合金边框、四角斜接、木质背板、背部下边中央连接单根细金属后撑杆，使用时轻微后倾。正面图像的立体光影只是平面图案，不生成雕塑。主体与后撑杆不拆装、不折叠，不变成挂画或墙贴；正面覆层材质未知，不猜玻璃、树脂或亚克力。';
  return `【产品元素替换：${type}】\n${physics}\n先核对原视频里指定目标的物理形态、位置和动作是否能由${replacementProductLabel(type)}实现。只做同类产品换款，禁止把卷轴展开、揭背膜、盘面与托架分离等不兼容动作机械套入目标。若原目标不存在或动作不兼容，只输出“【替换动作兼容性：不兼容】”和具体原因，不生成可提交提示词。若兼容，输出完整视频提示词，可在正文前用独立一行“【替换动作兼容性：兼容】”注明结论。产品结构与镜头动作分别锁定，不为了适配产品新增动作或切镜。`;
}
export function wrapReplacementPrompt(prompt: string, type: ReplacementProductType): string {
  if (type === 'generic') return prompt;
  const returnedTypes = [...prompt.matchAll(/【产品元素替换：([^】]+)】/g)].map(match => match[1]);
  if (returnedTypes.some(returnedType => returnedType !== type)) throw new Error('分析返回的产品类型与所选替换产品不一致，请重新分析。');
  const compatibility = readReplacementCompatibility(prompt);
  if (compatibility === 'incompatible') throw new Error('分析明确指出原视频动作与目标产品不兼容，请查看具体原因，选择同类产品视频或明确替换位置后重试。');
  if (compatibility === 'uncertain') throw new Error('分析明确表示无法确认替换动作，请查看具体原因并补充原视频或替换位置后重试。');
  if (!prompt.trim()) throw new Error('分析结果为空，请重新分析。');
  return `【产品元素替换：${type}】\n${prompt.replace(/【产品元素替换：(hanging|sticker|ornament|generic)】/g, '')}`;
}
