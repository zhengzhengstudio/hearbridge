import { input, Input } from 'cc';
import type { EventGamepad } from 'cc';
import type { GamepadSnapshot } from './GamepadFlightInput';
import { GamepadFlightInput } from './GamepadFlightInput';

interface CocosGamepadLike {
  connected: boolean;
  deviceId: number;
  leftStick: { getValue(): { x: number; y: number } };
  rightStick: { getValue(): { x: number; y: number } };
  buttonSouth: { getValue(): number };
  buttonEast: { getValue(): number };
  buttonWest: { getValue(): number };
  buttonNorth: { getValue(): number };
  buttonL1: { getValue(): number };
  buttonR1: { getValue(): number };
  buttonL2: { getValue(): number };
  buttonR2: { getValue(): number };
  buttonShare: { getValue(): number };
  buttonOptions: { getValue(): number };
}

export class CocosGamepadBridge {
  private attached = false;

  constructor(private readonly flightInput: GamepadFlightInput) {}

  attach(): void {
    if (this.attached) return;
    input.on(Input.EventType.GAMEPAD_INPUT, this.handleInput, this);
    input.on(Input.EventType.GAMEPAD_CHANGE, this.handleInput, this);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    input.off(Input.EventType.GAMEPAD_INPUT, this.handleInput, this);
    input.off(Input.EventType.GAMEPAD_CHANGE, this.handleInput, this);
    this.attached = false;
    this.flightInput.update({ connected: false, id: '', axes: [0, 0, 0, 0], buttons: [] });
  }

  private readonly handleInput = (event: EventGamepad): void => {
    const gamepad = event.gamepad as unknown as CocosGamepadLike;
    const left = gamepad.leftStick.getValue();
    const right = gamepad.rightStick.getValue();
    const snapshot: GamepadSnapshot = {
      connected: gamepad.connected,
      id: `Cocos Gamepad ${gamepad.deviceId + 1}`,
      axes: [left.x, -left.y, right.x, -right.y],
      buttons: [
        gamepad.buttonSouth.getValue(), gamepad.buttonEast.getValue(),
        gamepad.buttonWest.getValue(), gamepad.buttonNorth.getValue(),
        gamepad.buttonL1.getValue(), gamepad.buttonR1.getValue(),
        gamepad.buttonL2.getValue(), gamepad.buttonR2.getValue(),
        gamepad.buttonShare.getValue(), gamepad.buttonOptions.getValue(),
      ],
    };
    this.flightInput.update(snapshot);
  };
}
