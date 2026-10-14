import { PALETTE, contrastRatio, isHexColor, readableTextColor } from './color';

describe('color', () => {
  it('validates #rrggbb colours only', () => {
    expect(isHexColor('#3b82f6')).toBe(true);
    expect(isHexColor('#FFF')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#3b82f6; background: url(x)')).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });

  it('picks the more readable text colour', () => {
    expect(readableTextColor('#ffffff')).toBe('#111827');
    expect(readableTextColor('#000000')).toBe('#ffffff');
    expect(readableTextColor('#f59e0b')).toBe('#111827');
  });

  it('every palette colour has readable text (WCAG AA large, 3:1)', () => {
    for (const { hex } of PALETTE) {
      expect(contrastRatio(hex, readableTextColor(hex)), hex).toBeGreaterThanOrEqual(3);
    }
  });
});
