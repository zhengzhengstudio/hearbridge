import { FlightCommand } from '../core/FlightCommand';
import { DesktopFlightInput } from './DesktopFlightInput';
import { TouchFlightInput } from './TouchFlightInput';
import { GamepadFlightInput } from './GamepadFlightInput';

export type InputMode = 'desktop' | 'touch' | 'gamepad';

export class InputRouter {
  private mode: InputMode = 'desktop';

  constructor(
    private readonly desktop: DesktopFlightInput,
    private readonly touch: TouchFlightInput,
    private readonly gamepad?: GamepadFlightInput,
  ) {}

  setMode(mode: InputMode): void {
    if (mode === this.mode) return;
    if (this.mode === 'desktop') this.desktop.releaseAll();
    if (this.mode === 'touch') this.touch.releaseAll();
    if (this.mode === 'gamepad') this.gamepad?.releaseAll();
    this.mode = mode;
    if (typeof document !== 'undefined' && document.body?.dataset) {
      document.body.dataset.inputMode = mode;
    }
  }

  currentMode(): InputMode {
    return this.mode;
  }

  consumeCommand(): FlightCommand {
    const gamepadCommand = this.gamepad?.consumeCommand();
    if (this.gamepad?.isActive()) this.setMode('gamepad');
    if (this.mode === 'gamepad' && !this.gamepad?.isConnected()) this.setMode('desktop');
    const command = this.mode === 'desktop'
      ? this.desktop.consumeCommand()
      : this.mode === 'touch'
        ? this.touch.consumeCommand()
        : gamepadCommand || this.desktop.consumeCommand();
    if (
      typeof window !== 'undefined'
      && typeof document !== 'undefined'
      && typeof CustomEvent !== 'undefined'
      && document.body?.dataset?.inputDebug === 'true'
    ) {
      window.dispatchEvent(new CustomEvent('spacefight:input-debug', {
        detail: { mode: this.mode, ...command },
      }));
    }
    return command;
  }

  releaseAll(): void {
    this.desktop.releaseAll();
    this.touch.releaseAll();
    this.gamepad?.releaseAll();
  }
}
