import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NAV_ITEMS } from './app.nav';
import { DataService } from './core/data.service';
import { PresenceService } from './core/presence.service';
import { ThemeService } from './core/theme.service';
import { SetupComponent } from './features/setup/setup.component';
import { CommandPaletteComponent } from './shared/ui/command-palette.component';
import { TimerBarComponent } from './shared/ui/timer-bar.component';
import { ToastsComponent } from './shared/ui/toasts.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SetupComponent, TimerBarComponent, CommandPaletteComponent, ToastsComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  protected readonly data = inject(DataService);
  protected readonly theme = inject(ThemeService);
  // Instantiated here so the title/badge stay in sync on every page.
  private readonly presence = inject(PresenceService);
  protected readonly nav = NAV_ITEMS;
  protected readonly empty = computed(() => this.data.nodes().length === 0);
}
