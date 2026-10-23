import { timerTitle } from './presence';

describe('timerTitle', () => {
  it('is the page title when no timer runs', () => {
    expect(timerTitle('Dashboard · Where Time Flew', null)).toBe('Dashboard · Where Time Flew');
  });

  it('prefixes the running timer', () => {
    expect(timerTitle('Dashboard · Where Time Flew', { nodeName: 'Design', elapsedSeconds: 3723 })).toBe(
      '▶ 1:02:03 Design · Dashboard · Where Time Flew',
    );
  });
});
