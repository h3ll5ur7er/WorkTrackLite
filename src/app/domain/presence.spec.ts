import { timerTitle } from './presence';

describe('timerTitle', () => {
  it('is the page title when no timer runs', () => {
    expect(timerTitle('Dashboard · WorkTrackLite', null)).toBe('Dashboard · WorkTrackLite');
  });

  it('prefixes the running timer', () => {
    expect(timerTitle('Dashboard · WorkTrackLite', { nodeName: 'Design', elapsedSeconds: 3723 })).toBe(
      '▶ 1:02:03 Design · Dashboard · WorkTrackLite',
    );
  });
});
