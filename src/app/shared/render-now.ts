import { ChangeDetectorRef } from '@angular/core';

/**
 * Renders a component synchronously, inside the current event handler.
 *
 * Use it right after setting state that opens something the user will type
 * into (a menu, dialog or palette). With zoneless change detection the render
 * otherwise happens in a later task, and the browser may deliver the next
 * keystrokes first, to whatever still has focus.
 */
export function renderNow(cdr: ChangeDetectorRef): void {
  cdr.detectChanges();
}
