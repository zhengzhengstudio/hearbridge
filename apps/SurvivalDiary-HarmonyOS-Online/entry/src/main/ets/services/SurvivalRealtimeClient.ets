import webSocket from '@ohos.net.webSocket';

export interface RealtimeChatMessage { uid: string; text: string; createdAt: number }

type StateCallback = (state: string, message: string) => void;
type SnapshotCallback = (islandId: string, revision: number, world: object) => void;
type ChatCallback = (message: RealtimeChatMessage) => void;

interface RealtimeRequest { type: string; protocolVersion: number; requestId: string; islandId: string; revision?: number }

interface RealtimeWorldCommand { eventId: string; baseRevision: number; type: string; payload: object }
interface RealtimeCommandRequest extends RealtimeRequest { command: RealtimeWorldCommand }

interface ServerMessage {
  type: string;
  revision?: number;
  world?: object;
  uid?: string;
  actorUid?: string;
  text?: string;
  createdAt?: number;
  messages?: RealtimeChatMessage[];
  message?: string;
  code?: string;
}

export class SurvivalRealtimeClient {
  private socket: webSocket.WebSocket | null = null;
  private sessionToken: string = '';
  private islandId: string = '';
  private revision: number = 0;
  private reconnectAttempt: number = 0;
  private generation: number = 0;
  private intentional: boolean = true;
  private readonly onState: StateCallback;
  private readonly onSnapshot: SnapshotCallback;
  private readonly onChat: ChatCallback;

  constructor(onState: StateCallback, onSnapshot: SnapshotCallback, onChat: ChatCallback) {
    this.onState = onState; this.onSnapshot = onSnapshot; this.onChat = onChat;
  }

  join(sessionToken: string, islandId: string): void {
    this.leave(false);
    this.sessionToken = sessionToken;
    this.islandId = islandId;
    this.intentional = false;
    this.open(false);
  }

  async sendChat(text: string): Promise<void> {
    const normalized = text.trim();
    if (normalized.length < 1 || normalized.length > 500) throw new Error('消息需要 1 到 500 个字');
    if (this.socket === null) throw new Error('岛屿聊天尚未连接');
    await this.socket.send(JSON.stringify({ type: 'chat', protocolVersion: 2, requestId: this.id('chat'), islandId: this.islandId, text: normalized }));
  }

  async sendCommand(type: string, payload: object): Promise<string> {
    if (type.length === 0 || this.islandId.length === 0 || this.socket === null) throw new Error('公共岛尚未连接');
    const eventId = this.id('event');
    const command: RealtimeWorldCommand = { eventId, baseRevision: this.revision, type, payload };
    const request: RealtimeCommandRequest = {
      type: 'command', protocolVersion: 2, requestId: this.id('command'), islandId: this.islandId, command
    };
    await this.socket.send(JSON.stringify(request));
    return eventId;
  }

  leave(notify: boolean = true): void {
    this.intentional = true;
    this.generation += 1;
    this.socket?.close({ code: 1000, reason: 'leave island' });
    this.socket = null;
    this.islandId = '';
    this.revision = 0;
    this.reconnectAttempt = 0;
    if (notify) this.onState('local', '当前为本地游玩');
  }

  private open(resume: boolean): void {
    const socket = webSocket.createWebSocket();
    const generation = ++this.generation;
    const island = this.islandId;
    this.socket = socket;
    this.onState(resume ? 'reconnecting' : 'connecting', resume ? '正在恢复公共岛' : '正在加入公共岛');
    socket.on('open', (error) => {
      if (error || !this.current(socket, generation, island)) return;
      const message: RealtimeRequest = {
        type: resume ? 'resume' : 'join', protocolVersion: 2, requestId: this.id(resume ? 'resume' : 'join'), islandId: this.islandId
      };
      if (resume) message.revision = this.revision;
      socket.send(JSON.stringify(message));
    });
    socket.on('message', (error, value) => {
      if (error || !this.current(socket, generation, island) || typeof value !== 'string') return;
      this.handle(JSON.parse(value) as ServerMessage);
    });
    socket.on('error', () => {
      if (!this.current(socket, generation, island)) return;
      this.onState('offline', '连接中断');
    });
    socket.on('close', () => {
      if (!this.current(socket, generation, island)) return;
      this.onState('offline', '公共岛离线，准备重连');
      this.scheduleReconnect();
    });
    socket.connect(`wss://survival-diary.zhengzhengstudio.cn/ws?session=${encodeURIComponent(this.sessionToken)}`);
  }

  private handle(message: ServerMessage): void {
    if (message.type === 'snapshot' || message.type === 'ack' || message.type === 'world_update') {
      this.revision = message.revision ?? this.revision;
      this.reconnectAttempt = 0;
      this.onSnapshot(this.islandId, this.revision, message.world !== undefined ? message.world : JSON.parse('{}') as object);
      this.onState('online', `已连接 ${this.islandId}`);
    } else if (message.type === 'chat') {
      const chat: RealtimeChatMessage = { uid: message.uid ?? message.actorUid ?? '岛友', text: message.text ?? '', createdAt: message.createdAt ?? Date.now() };
      this.onChat(chat);
    } else if (message.type === 'chat_history') {
      (message.messages ?? []).forEach((item: RealtimeChatMessage) => this.onChat(item));
    } else if (message.type === 'error') {
      // Command rejection is not a transport failure; keep the public island connected.
      this.onState('online', message.message ?? message.code ?? '联机请求失败');
    }
  }

  private scheduleReconnect(): void {
    if (this.intentional || this.islandId.length === 0 || this.reconnectAttempt >= 6) return;
    this.reconnectAttempt += 1;
    const generation = this.generation;
    const delay = Math.min(20000, 750 * Math.pow(2, this.reconnectAttempt - 1));
    setTimeout(() => { if (!this.intentional && generation === this.generation && this.islandId.length > 0) this.open(true); }, delay);
  }

  private current(socket: webSocket.WebSocket, generation: number, island: string): boolean {
    return !this.intentional && this.socket === socket && this.generation === generation && this.islandId === island;
  }

  private id(prefix: string): string { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`; }
}
