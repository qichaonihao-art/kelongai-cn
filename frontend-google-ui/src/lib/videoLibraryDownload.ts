import type { VideoLibraryItem } from './videoLibrary';

/** Hand off the authenticated original file to the browser download manager.
 * Do not fetch/blob/hash the video or ask for directory access on this path.
 * Starting a download is not proof that the file was saved, so no receipt or
 * unread status is changed here.
 */
export function startVideoLibraryBrowserDownload(item: Pick<VideoLibraryItem, 'id' | 'downloadUrl' | 'downloadName' | 'originalName'>) {
  const id = Number(item.id);
  const url = new URL(item.downloadUrl, window.location.href);
  if (!Number.isSafeInteger(id) || id <= 0 || url.origin !== window.location.origin || url.pathname !== `/api/video-library/videos/${id}/file`) {
    throw new Error('视频下载地址无效，请刷新素材库后重试。');
  }
  url.searchParams.delete('preview');
  url.searchParams.set('download', '1');
  const anchor = document.createElement('a');
  anchor.href = url.href;
  anchor.download = item.downloadName || item.originalName;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); }
}
