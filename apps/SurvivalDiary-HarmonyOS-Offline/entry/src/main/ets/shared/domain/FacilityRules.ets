import { FacilityProcess, FacilityStatus, GameSave, Inventory } from '../model/GameSave';

export interface FurnaceRecipe { id: string; inputItemId: string; inputAmount: number; fuelItemId: string; fuelAmount: number; outputItemId: string; outputAmount: number; durationMinutes: number }
export interface FacilityMutation { save: GameSave; error: string }
export enum TransferDirection { DEPOSIT = 'deposit', WITHDRAW = 'withdraw' }

function emptyProcess(): FacilityProcess {
  return { recipeId: '', input: {}, fuel: {}, output: {}, progressMinutes: 0, durationMinutes: 0,
    outputItemId: '', outputAmount: 0, status: FacilityStatus.IDLE };
}
function consume(inventory: Inventory, itemId: string, amount: number): void {
  const remaining = (inventory[itemId] ?? 0) - amount;
  inventory[itemId] = Math.max(0, remaining);
}

export class FacilityRules {
  static readonly recipes: FurnaceRecipe[] = [
    { id: 'smelt-copper', inputItemId: 'copper-ore', inputAmount: 3, fuelItemId: 'charcoal', fuelAmount: 2, outputItemId: 'copper-ingot', outputAmount: 1, durationMinutes: 30 },
    { id: 'smelt-iron', inputItemId: 'iron-ore', inputAmount: 3, fuelItemId: 'coal', fuelAmount: 2, outputItemId: 'iron-ingot', outputAmount: 1, durationMinutes: 45 }
  ];

  static startFurnace(source: GameSave, entityId: string, recipe: FurnaceRecipe): FacilityMutation {
    if (source.entities[entityId]?.type !== 'furnace') return { save: source, error: 'invalid-facility' };
    const current = source.facilityProcesses[entityId] ?? emptyProcess();
    if (current.status === FacilityStatus.WORKING) return { save: source, error: 'facility-busy' };
    if (Object.keys(current.output).some((id: string) => current.output[id] > 0)) return { save: source, error: 'output-waiting' };
    if ((source.inventory[recipe.inputItemId] ?? 0) < recipe.inputAmount) return { save: source, error: 'missing-input' };
    const combinedFuel = recipe.fuelAmount + (recipe.inputItemId === recipe.fuelItemId ? recipe.inputAmount : 0);
    if ((source.inventory[recipe.fuelItemId] ?? 0) < combinedFuel) return { save: source, error: 'missing-fuel' };
    const next = source.clone();
    consume(next.inventory, recipe.inputItemId, recipe.inputAmount); consume(next.inventory, recipe.fuelItemId, recipe.fuelAmount);
    const input: Inventory = {}; input[recipe.inputItemId] = recipe.inputAmount;
    const fuel: Inventory = {}; fuel[recipe.fuelItemId] = recipe.fuelAmount;
    next.facilityProcesses[entityId] = { recipeId: recipe.id, input: input,
      fuel: fuel, output: {}, progressMinutes: 0,
      durationMinutes: recipe.durationMinutes, outputItemId: recipe.outputItemId, outputAmount: recipe.outputAmount, status: FacilityStatus.WORKING };
    return { save: next, error: '' };
  }

  static advance(source: GameSave, elapsedMinutes: number): GameSave {
    if (elapsedMinutes <= 0) return source;
    const next = source.clone();
    for (const entityId of Object.keys(next.facilityProcesses)) {
      const process = next.facilityProcesses[entityId];
      if (process.status !== FacilityStatus.WORKING) continue;
      process.progressMinutes = Math.min(process.durationMinutes, process.progressMinutes + elapsedMinutes);
      if (process.progressMinutes >= process.durationMinutes) {
        const output: Inventory = {}; output[process.outputItemId] = process.outputAmount;
        process.input = {}; process.fuel = {}; process.output = output; process.status = FacilityStatus.READY;
      }
    }
    return next;
  }

  static claimFurnace(source: GameSave, entityId: string): FacilityMutation {
    const process = source.facilityProcesses[entityId];
    if (process === undefined || process.status !== FacilityStatus.READY) return { save: source, error: 'no-output' };
    const next = source.clone();
    for (const itemId of Object.keys(process.output)) next.inventory[itemId] = (next.inventory[itemId] ?? 0) + process.output[itemId];
    next.facilityProcesses[entityId] = emptyProcess();
    return { save: next, error: '' };
  }

  static transferStorage(source: GameSave, entityId: string, itemId: string, amount: number, direction: TransferDirection): FacilityMutation {
    if (amount <= 0 || source.entities[entityId]?.type !== 'storage-crate') return { save: source, error: 'invalid-facility' };
    const next = source.clone(); const container = next.containerInventories[entityId] ?? {};
    if (direction === TransferDirection.DEPOSIT) {
      if ((next.inventory[itemId] ?? 0) < amount) return { save: source, error: 'missing-items' };
      consume(next.inventory, itemId, amount); container[itemId] = (container[itemId] ?? 0) + amount;
    } else {
      if ((container[itemId] ?? 0) < amount) return { save: source, error: 'missing-items' };
      consume(container, itemId, amount); next.inventory[itemId] = (next.inventory[itemId] ?? 0) + amount;
    }
    next.containerInventories[entityId] = container; return { save: next, error: '' };
  }
}
