import { FlightCommand } from '../core/FlightCommand';
import { DesktopFlightInput } from './DesktopFlightInput';
import { TouchFlightInput } from './TouchFlightInput';
import { GamepadFlightInput } from './GamepadFlightInput';

export type InputMode = 'desktop' | 'touch' | 'gamepad';

export class InputRouter {
  private mode: InputMode = 'desktop';
  // 修复：记录切入手柄之前的模式，断连时恢复它而不是写死 desktop。
  private previousMode: InputMode = 'desktop';

  constructor(
    private readonly desktop: DesktopFlightInput,
    private readonly touch: TouchFlightInput,
    private readonly gamepad?: GamepadFlightInput,
  ) {}

  setMode(mode: InputMode): void {
    if (mode === this.mode) return;
    // 修复：切入手柄前记住原模式，供断连恢复。
    if (mode === 'gamepad' && this.mode !== 'gamepad') {
      this.previousMode = this.mode;
    }
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
    const gamepadActive = this.gamepad?.isActive() === true;
    const gamepadConnected = this.gamepad?.isConnected() === true;

    // 每帧只消费一次当前（非手柄）输入源，用于判断是否存在其它活动输入。
    const previousMode = this.mode;
    let otherCommand: FlightCommand | null = null;
    if (previousMode !== 'gamepad') {
      otherCommand = previousMode === 'touch'
        ? this.touch.consumeCommand()
        : this.desktop.consumeCommand();
    }
    const otherActive = otherCommand !== null && this.hasActivity(otherCommand);

    // 修复：不再每帧无条件抢占；手柄仅在无其它活动输入时接管，断连恢复 previousMode。
    if (previousMode === 'gamepad') {
      if (!gamepadConnected) this.setMode(this.previousMode);
    } else if (gamepadActive && !otherActive) {
      this.setMode('gamepad');
    }

    let command: FlightCommand;
    if (this.mode === 'gamepad') {
      command = gamepadCommand || otherCommand || this.desktop.consumeCommand();
    } else if (this.mode === 'touch') {
      command = otherCommand || this.touch.consumeCommand();
    } else {
      command = otherCommand || this.desktop.consumeCommand();
    }
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

  /** 命令里存在任意非零/true 字段即视为该输入源有活动。 */
  private hasActivity(command: FlightCommand): boolean {
    return Object.values(command).some((value) => value !== 0 && value !== false);
  }

  releaseAll(): void {
    this.desktop.releaseAll();
    this.touch.releaseAll();
    this.gamepad?.releaseAll();
  }
}
