import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, input, linkedSignal, output, viewChild } from '@angular/core';
import { TimeEntry } from '../../core/models';
import { parseTags } from '../../domain/format';

/** Note and tags of the running entry, edited from the timer bar. Takes focus when it opens. */
@Component({
  selector: 'app-running-note',
  template: `
    <form class="rn" aria-label="Note for the running timer" (submit)="$event.preventDefault(); save()" (keydown.escape)="cancelled.emit()">
      <label class="field rn__note">
        <span>Note</span>
        <input
          #note
          type="text"
          placeholder="What are you working on?"
          [value]="noteText()"
          (input)="noteText.set($any($event.target).value)"
        />
      </label>
      <label class="field rn__tags">
        <span>Tags (comma separated)</span>
        <input type="text" [value]="tagsText()" (input)="tagsText.set($any($event.target).value)" />
      </label>
      <div class="rn__actions">
        <button type="submit" class="btn btn--primary">Done</button>
        <button type="button" class="btn btn--ghost" (click)="cancelled.emit()">Cancel</button>
      </div>
    </form>
  `,
  styles: `
    :host {
      display: block;
      background: var(--c-bg-2);
      border-top: 1px solid var(--c-border);
    }
    .rn {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 8px;
      padding: 8px 14px 10px;
    }
    .rn__note {
      flex: 3 1 240px;
    }
    .rn__tags {
      flex: 1 1 160px;
    }
    .rn__actions {
      display: flex;
      gap: 6px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunningNoteComponent implements AfterViewInit {
  /** Snapshot of the running entry when the form opened. */
  readonly entry = input.required<TimeEntry>();
  readonly saved = output<{ note: string | undefined; tags: string[] | undefined }>();
  readonly cancelled = output<void>();

  protected readonly noteText = linkedSignal(() => this.entry().note ?? '');
  protected readonly tagsText = linkedSignal(() => (this.entry().tags ?? []).join(', '));
  private readonly noteField = viewChild.required<ElementRef<HTMLInputElement>>('note');

  ngAfterViewInit(): void {
    const el = this.noteField().nativeElement;
    el.focus();
    el.select();
  }

  protected save(): void {
    const tags = parseTags(this.tagsText());
    this.saved.emit({ note: this.noteText().trim() || undefined, tags: tags.length ? tags : undefined });
  }
}
