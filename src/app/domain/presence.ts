import { formatHMS } from './format';

/** Document title while a timer runs: "▶ 1:02:03 Design · Dashboard · WorkTrackLite". */
export function timerTitle(pageTitle: string, running: { nodeName: string; elapsedSeconds: number } | null): string {
  if (!running) return pageTitle;
  return `▶ ${formatHMS(running.elapsedSeconds)} ${running.nodeName} · ${pageTitle}`;
}
