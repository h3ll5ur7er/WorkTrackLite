import { swallowNextClick } from './long-press.directive';

describe('swallowNextClick', () => {
  let clicks: number;
  const onClick = () => clicks++;
  const click = () => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  beforeEach(() => {
    clicks = 0;
    document.body.addEventListener('click', onClick);
  });
  afterEach(() => document.body.removeEventListener('click', onClick));

  it('swallows the click produced by lifting the finger after a long press', () => {
    swallowNextClick();
    click();
    expect(clicks).toBe(0);
    click();
    expect(clicks).toBe(1);
  });

  it('regression: never swallows a click that belongs to a new tap', () => {
    // The finger-lift click did not arrive (e.g. the browser cancelled it); the user taps again.
    swallowNextClick();
    window.dispatchEvent(new Event('pointerdown'));
    click();
    expect(clicks).toBe(1);
  });
});
