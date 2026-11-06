import { describe, expect, it } from '@ohos/hypium';
import { Simulation } from '../main/ets/shared/domain/Simulation';
import { GameSave, PlayMode } from '../main/ets/shared/model/GameSave';
import { FacilityRules } from '../main/ets/shared/domain/FacilityRules';

export default function fixtureParityTest(): void {
  describe('world v2 fixture', () => {
    it('matches deterministic digest', 0, () => {
      let state: GameSave = Simulation.create('20260729', PlayMode.GUIDED);
      state = Simulation.step(state, { type: 'discover_region', coordinates: { x: 0, y: 0 } });
      state = Simulation.step(state, { type: 'advance_time', minutes: 180 });
      state = Simulation.step(state, { type: 'discover_region', coordinates: { x: 11, y: -8 } });
      state = Simulation.step(state, { type: 'gather', itemId: 'driftwood', amount: 2 });
      state = Simulation.step(state, { type: 'gather', itemId: 'palm-fiber', amount: 3 });
      state = Simulation.step(state, { type: 'craft', recipeId: 'craft-fishing-rod' });
      state = Simulation.step(state, { type: 'set_play_mode', playMode: PlayMode.FREE });
      state = Simulation.step(state, { type: 'write_diary', entryId: 'day-1', text: 'Gathered supplies and crossed the shore.' });
      expect(state.stableDigest()).assertEqual('097b8dcab5e03538c55536a1e80159d58f570538f7080b8020581d73d9b843b8');
    });

    it('shows stamina recovery during ten idle seconds and drains it while walking', 0, () => {
      const ready: GameSave = Simulation.create('visible-stamina', PlayMode.GUIDED);
      ready.vitals.stamina = 20; ready.vitals.hunger = 90; ready.vitals.hydration = 90;
      const idle: GameSave = Simulation.advanceSurvival(ready, 10000, 'idle');
      const walking: GameSave = Simulation.advanceSurvival(ready, 10000, 'walking');
      expect(idle.vitals.stamina >= 21.7).assertTrue();
      expect(walking.vitals.stamina < ready.vitals.stamina).assertTrue();
    });

    it('runs a persistent furnace queue and claims its output', 0, () => {
      const ready = Simulation.create('facility', PlayMode.GUIDED);
      ready.entities['furnace-1'] = { id: 'furnace-1', type: 'furnace', coordinates: { x: 0, y: 0 }, durability: 10, maxDurability: 10 };
      ready.inventory['copper-ore'] = 3; ready.inventory['charcoal'] = 2;
      const started = FacilityRules.startFurnace(ready, 'furnace-1', FacilityRules.recipes[0]);
      expect(started.error).assertEqual('');
      const completed = FacilityRules.advance(started.save, 30);
      const claimed = FacilityRules.claimFurnace(completed, 'furnace-1');
      expect(claimed.error).assertEqual('');
      expect(claimed.save.inventory['copper-ingot']).assertEqual(1);
    });
  });
}
