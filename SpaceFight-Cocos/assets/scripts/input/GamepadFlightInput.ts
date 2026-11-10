import { FlightCommand, normalizeFlightCommand } from '../core/FlightCommand';
import type { InputSettings } from './InputSettings';

export interface GamepadCalibration {
  deadzone: number;
  offsets: readonly [number, number, number, number];
}

export interface GamepadSnapshot {
  connected: boolean;
  id: string;
  axes: readonly [number, number, number, number];
  buttons: readonly number[];
}

export const DEFAULT_GAMEPAD_CALIBRATION: GamepadCalibration = {
  deadzone: 0.12,
  offsets: [0, 0, 0, 0],
};

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeGamepadCalibration(value?: Partial<GamepadCalibration> | null): GamepadCalibration {
  const providedOffsets = value?.offsets;
  const offsets = Array.isArray(providedOffsets) ? providedOffsets : DEFAULT_GAMEPAD_CALIBRATION.offsets;
  return {
    deadzone: clamp(finite(value?.deadzone, DEFAULT_GAMEPAD_CALIBRATION.deadzone), 0.04, 0.4),
    offsets: [0, 1, 2, 3].map((index) => clamp(finite(offsets[index], 0), -0.35, 0.35)) as unknown as [number, number, number, number],
  };
}

export function calibrationFromCenteredAxes(axes: readonly number[]): GamepadCalibration {
  const offsets = [0, 1, 2, 3].map((index) => clamp(finite(axes[index], 0), -0.35, 0.35)) as unknown as [number, number, number, number];
  const drift = Math.max(...offsets.map((axis) => Math.abs(axis)));
  return normalizeGamepadCalibration({ offsets, deadzone: Math.max(0.08, drift + 0.05) });
}

function shapedAxis(raw: number, offset: number, deadzone: number): number {
  const centered = clamp(finite(raw, 0) - offset, -1, 1);
  const magnitude = Math.abs(centered);
  if (magnitude <= deadzone) return 0;
  const normalized = (magnitude - deadzone) / (1 - deadzone);
  return Math.sign(centered) * Math.pow(normalized, 0.78);
}

export class GamepadFlightInput {
  private snapshot: GamepadSnapshot = { connected: false, id: '', axes: [0, 0, 0, 0], buttons: [] };
  private calibration: GamepadCalibration;
  private previousButtons: readonly number[] = [];
  private active = false;
  private centeredSampleCaptured = false;
  private calibrationChordHeld = false;

  constructor(
    private readonly inputSettings: InputSettings,
    calibration?: Partial<GamepadCalibration>,
  ) {
    this.calibration = normalizeGamepadCalibration(calibration);
  }

  update(snapshot: GamepadSnapshot): void {
    this.snapshot = snapshot;
    if (!snapshot.connected) this.centeredSampleCaptured = false;
    const calibrationChord = (snapshot.buttons[8] || 0) > 0.5 && (snapshot.buttons[9] || 0) > 0.5;
    if (
      calibrationChord
      && !this.calibrationChordHeld
      && snapshot.axes.every((axis) => Math.abs(axis) <= 0.35)
    ) {
      this.calibration = calibrationFromCenteredAxes(snapshot.axes);
      this.centeredSampleCaptured = true;
    }
    this.calibrationChordHeld = calibrationChord;
    if (
      snapshot.connected
      && !this.centeredSampleCaptured
      && snapshot.buttons.every((value) => value < 0.2)
      && snapshot.axes.every((axis) => Math.abs(axis) <= 0.35)
    ) {
      const automatic = calibrationFromCenteredAxes(snapshot.axes);
      this.calibration = {
        offsets: automatic.offsets,
        deadzone: Math.max(this.calibration.deadzone, automatic.deadzone),
      };
      this.centeredSampleCaptured = true;
    }
    this.active = snapshot.connected && (
      snapshot.axes.some((axis, index) => Math.abs(axis - this.calibration.offsets[index]) > this.calibration.deadzone)
      || snapshot.buttons.some((value) => value > 0.2)
    );
  }

  updateCalibration(calibration: Partial<GamepadCalibration>): void {
    this.calibration = normalizeGamepadCalibration(calibration);
  }

  isActive(): boolean {
    return this.active;
  }

  isConnected(): boolean {
    return this.snapshot.connected;
  }

  deviceName(): string {
    return this.snapshot.id;
  }

  consumeCommand(): FlightCommand {
    const axes = this.snapshot.axes.map((axis, index) => shapedAxis(
      axis,
      this.calibration.offsets[index],
      this.calibration.deadzone,
    ));
    const pressed = (index: number): boolean => (this.snapshot.buttons[index] || 0) > 0.35;
    const justPressed = (index: number): boolean => pressed(index) && (this.previousButtons[index] || 0) <= 0.35;
    const pitchDirection = this.inputSettings.invertY ? -1 : 1;
    const command = normalizeFlightCommand({
      throttle: -axes[1],
      strafe: axes[0],
      yaw: axes[2] * this.inputSettings.sensitivity,
      pitch: axes[3] * this.inputSettings.sensitivity * pitchDirection,
      primaryFire: pressed(7),
      secondaryFire: pressed(6),
      boost: pressed(4),
      cameraToggle: justPressed(3),
      pause: !this.calibrationChordHeld && justPressed(9),
      returnRequested: pressed(1),
      // X 键（按钮 2）战斗中主副武器互换，与桌面 E 键一致。
      swapWeapons: pressed(2),
      // RB（按钮 5）释放战术设备技能，与桌面 F 键一致。
      deviceAbility: pressed(5),
      // A 键确认"继续深入"，与桌面 Enter / 触屏按钮保持一致。
      advanceRequested: justPressed(0),
    });
    this.previousButtons = [...this.snapshot.buttons];
    return command;
  }

  releaseAll(): void {
    this.previousButtons = [];
    this.active = false;
    this.calibrationChordHeld = false;
  }
}
