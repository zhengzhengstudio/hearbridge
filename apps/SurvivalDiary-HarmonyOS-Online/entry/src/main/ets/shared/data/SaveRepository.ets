import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { fileIo } from '@kit.CoreFileKit';
import { GameSave, PlayMode } from '../model/GameSave';

export enum HarmonyEdition { ONLINE = 'online', OFFLINE = 'offline' }

export class SaveRepository {
  private readonly context: common.UIAbilityContext;
  private readonly edition: HarmonyEdition;
  private store: preferences.Preferences | null = null;

  constructor(context: common.UIAbilityContext, edition: HarmonyEdition) {
    this.context = context;
    this.edition = edition;
  }

  private async storage(): Promise<preferences.Preferences> {
    if (this.store === null) this.store = await preferences.getPreferences(this.context, `survival_diary_${this.edition}_edition`);
    return this.store;
  }

  async load(): Promise<GameSave> {
    const store = await this.storage();
    const current = await store.get('current', '') as string;
    const previous = await store.get('previous', '') as string;
    if (current.length > 0) {
      try { return this.decode(current); } catch (_) { /* Fall through to the previous atomic snapshot. */ }
    }
    if (previous.length > 0) {
      try { return this.decode(previous); } catch (_) { /* Create a safe new world below. */ }
    }
    return new GameSave(`${Date.now()}`, PlayMode.GUIDED);
  }

  async hasSave(): Promise<boolean> {
    const store = await this.storage();
    return (await store.get('current', '') as string).length > 0 || (await store.get('previous', '') as string).length > 0;
  }

  async reset(): Promise<void> {
    const store = await this.storage();
    await store.delete('current'); await store.delete('previous'); await store.delete('pending'); await store.flush();
  }

  async save(value: GameSave): Promise<void> {
    const store = await this.storage();
    const serialized = JSON.stringify(value);
    const current = await store.get('current', '') as string;
    await store.put('pending', serialized); await store.flush();
    if (current.length > 0) await store.put('previous', current);
    await store.put('current', serialized);
    await store.delete('pending');
    await store.flush();
  }

  exportToFile(value: GameSave, targetPath: string): void {
    const file = fileIo.openSync(targetPath, fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
    fileIo.writeSync(file.fd, JSON.stringify(value));
    fileIo.fsyncSync(file.fd);
    fileIo.closeSync(file);
  }

  importFromFile(sourcePath: string): GameSave {
    const text = fileIo.readTextSync(sourcePath);
    return this.decode(text);
  }

  private decode(text: string): GameSave {
    const raw = JSON.parse(text) as GameSave;
    const save = new GameSave(raw.seed, raw.playMode as PlayMode);
    save.day = raw.day;
    save.time = raw.time;
    save.weather = raw.weather;
    save.regions = raw.regions;
    save.entities = raw.entities;
    save.players = raw.players;
    save.journals = raw.journals;
    save.milestones = raw.milestones;
    save.inventory = raw.inventory;
    save.containerInventories = raw.containerInventories ?? {};
    save.facilityProcesses = raw.facilityProcesses ?? {};
    save.vitals = raw.vitals ?? save.vitals;
    save.recoveryBlockers = raw.recoveryBlockers ?? [];
    save.groundItems = raw.groundItems ?? {};
    save.plots = raw.plots ?? {};
    return save;
  }
}
