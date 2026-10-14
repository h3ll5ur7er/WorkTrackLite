import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** Inline "this backup is password-protected" form. Takes focus when it appears. */
@Component({
  selector: 'app-password-prompt',
  template: `
    <form class="pp" aria-labelledby="pp-title" (submit)="$event.preventDefault(); submit()">
      <p id="pp-title" class="pp__title"><strong>This backup is password-protected.</strong></p>
      <label class="field">
        <span>Backup password</span>
        <input
          #pw
          type="password"
          autocomplete="current-password"
          [value]="value()"
          (input)="value.set($any($event.target).value)"
          [attr.aria-invalid]="error() ? true : null"
          [attr.aria-describedby]="error() ? 'pp-error' : null"
        />
      </label>
      @if (error(); as e) {
        <p id="pp-error" class="error" role="alert">{{ e }}</p>
      }
      <div class="row">
        <button type="submit" class="btn btn--primary" [disabled]="busy() || !value()">{{ busy() ? 'Unlocking…' : 'Unlock' }}</button>
        <button type="button" class="btn" (click)="cancelled.emit()">Cancel</button>
      </div>
    </form>
  `,
  styles: `
    .pp {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid var(--c-border);
      border-radius: 6px;
      max-width: 360px;
    }
    .pp__title {
      margin: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordPromptComponent implements AfterViewInit {
  readonly error = input<string | null>(null);
  readonly busy = input(false);
  readonly submitted = output<string>();
  readonly cancelled = output<void>();

  protected readonly value = signal('');
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('pw');

  constructor() {
    // After a wrong password, select it so the next attempt replaces it.
    afterRenderEffect(() => {
      if (!this.error()) return;
      const el = this.field().nativeElement;
      el.focus();
      el.select();
    });
  }

  ngAfterViewInit(): void {
    this.field().nativeElement.focus();
  }

  protected submit(): void {
    if (this.value() && !this.busy()) this.submitted.emit(this.value());
  }
}
