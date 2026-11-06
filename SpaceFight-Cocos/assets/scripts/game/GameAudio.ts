import { AudioClip, AudioSource, Node, resources, sys } from 'cc';
import type { CombatEvent, CombatSnapshot } from '../core/CombatSimulation';

export const AUDIO_SFX_KEY = 'spacefight.audio.sfx.v1';
export const AUDIO_ENGINE_KEY = 'spacefight.audio.engine.v1';

type Cue = 'pulse-shot' | 'missile-launch' | 'hit-confirm' | 'destroyed' | 'player-hit' | 'pickup' | 'return' | 'ui-select';

function enabled(key: string): boolean {
  return sys.localStorage.getItem(key) !== 'off';
}

export function toggleAudioSetting(key: string): boolean {
  const next = !enabled(key);
  sys.localStorage.setItem(key, next ? 'on' : 'off');
  return next;
}

export function audioSettingEnabled(key: string): boolean {
  return enabled(key);
}

export class GameAudio {
  private readonly source: AudioSource;
  private readonly engine: AudioSource;
  private readonly clips = new Map<string, AudioClip>();
  private lastEventId = 0;
  private previousPickups = 0;
  private returning = false;

  constructor(parent: Node) {
    const effects = new Node('GameAudioEffects');
    effects.setParent(parent);
    this.source = effects.addComponent(AudioSource);
    const engine = new Node('GameAudioEngine');
    engine.setParent(parent);
    this.engine = engine.addComponent(AudioSource);
    this.engine.loop = true;
    this.engine.volume = 0.22;
    this.load('engine-loop', (clip) => {
      this.engine.clip = clip;
      if (enabled(AUDIO_ENGINE_KEY)) this.engine.play();
    });
    for (const cue of ['pulse-shot', 'missile-launch', 'hit-confirm', 'destroyed', 'player-hit', 'pickup', 'return', 'ui-select'] as Cue[]) {
      this.load(cue);
    }
  }

  sync(snapshot: CombatSnapshot): void {
    if (enabled(AUDIO_ENGINE_KEY)) {
      if (!this.engine.playing && this.engine.clip) this.engine.play();
      this.engine.volume = snapshot.paused ? 0.08 : 0.22;
    } else if (this.engine.playing) {
      this.engine.stop();
    }
    for (const event of snapshot.combatEvents) {
      if (event.id <= this.lastEventId) continue;
      this.lastEventId = event.id;
      this.playEvent(event);
    }
    if (snapshot.player.pickupsCollected > this.previousPickups) this.play('pickup', 0.68);
    this.previousPickups = snapshot.player.pickupsCollected;
    const nowReturning = snapshot.expedition.phase === 'returning';
    if (nowReturning && !this.returning) this.play('return', 0.72);
    this.returning = nowReturning;
  }

  ui(): void {
    this.play('ui-select', 0.55);
  }

  destroy(): void {
    this.engine.stop();
    this.source.stop();
  }

  private playEvent(event: CombatEvent): void {
    if (event.type === 'weapon-fired' && event.source === 'player') {
      this.play(event.weapon === 'missile' || event.weapon === 'torpedo' ? 'missile-launch' : 'pulse-shot', 0.54);
    } else if (event.type === 'hit' && event.source === 'player') {
      this.play('hit-confirm', event.lethal ? 0.82 : 0.5);
    } else if (event.type === 'destroyed') {
      this.play('destroyed', event.source === 'player' ? 0.75 : 0.42);
    } else if (event.type === 'player-hit' || event.type === 'shield-break') {
      this.play('player-hit', event.type === 'shield-break' ? 0.82 : 0.48);
    }
  }

  private play(cue: Cue, volume: number): void {
    if (!enabled(AUDIO_SFX_KEY)) return;
    const clip = this.clips.get(cue);
    if (clip) this.source.playOneShot(clip, volume);
  }

  private load(name: string, apply?: (clip: AudioClip) => void): void {
    resources.load(`audio/${name}`, AudioClip, (error: Error | null, clip?: AudioClip) => {
      if (error || !clip) {
        console.warn(`[SpaceFight audio] ${name} unavailable`, error);
        return;
      }
      this.clips.set(name, clip);
      apply?.(clip);
    });
  }
}
