import assert = require('node:assert/strict');
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const errorMessage = (value: unknown): string => value instanceof Error ? value.message : String(value);

namespace cdp {

export interface DebugPage { url: string; webSocketDebuggerUrl: string; type?: string }
export function debugPages(value: unknown): DebugPage[] {
  assert(Array.isArray(value), 'Debugger target list is not an array');
  return value.map((page: unknown) => {
    assert(isRecord(page) && typeof page.url === 'string' && typeof page.webSocketDebuggerUrl === 'string', 'Invalid debugger target');
    return { url: page.url, webSocketDebuggerUrl: page.webSocketDebuggerUrl, ...(typeof page.type === 'string' ? { type: page.type } : {}) };
  });
}

export interface Evaluation { result: { value?: unknown; objectId?: string }; exceptionDetails?: { text?: string } }
export interface Metrics { metrics: Array<{ name: string; value: number }> }
export interface EventListeners { listeners: Array<{ type: string; handler?: { objectId?: string } }> }
export type CdpResponse<M extends string> = M extends 'Runtime.evaluate' | 'Runtime.callFunctionOn' ? Evaluation :
  M extends 'Page.captureScreenshot' ? { data: string } : M extends 'Performance.getMetrics' ? Metrics :
  M extends 'DOMDebugger.getEventListeners' ? EventListeners : M extends 'DOM.getDocument' ? { root: { nodeId: number } } :
  M extends 'DOM.querySelector' ? { nodeId: number } : Record<string, unknown>;
export interface CdpEvent { method: string; params: Record<string, unknown> }
export function cdpEvent(data: unknown): CdpEvent | undefined {
  if (typeof data !== 'string') return;
  const value: unknown = JSON.parse(data);
  return isRecord(value) && typeof value.method === 'string' && isRecord(value.params) ? { method: value.method, params: value.params } : undefined;
}

export interface CdpConnection {
  socket: WebSocket;
  fileChoosers: Array<{ backendNodeId: number; mode: string }>;
  send<M extends string>(method: M, params?: Record<string, unknown>, timeout?: number): Promise<CdpResponse<M>>;
  evaluate<T = unknown>(expression: string, awaitPromise?: boolean): Promise<T>;
  close(): Promise<void>;
}

export async function connect(url: string, failures: string[], page = true, requestTimeout = 30000): Promise<CdpConnection> {
  const socket = new WebSocket(url);
  const pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(reason: Error): void; timer: NodeJS.Timeout }>();
  const fileChoosers: Array<{ backendNodeId: number; mode: string }> = [];
  const requests = new Map<string, string>();
  let id = 0;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('DevTools WebSocket did not open')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', event => { clearTimeout(timer); reject(event); }, { once: true });
  });
  socket.addEventListener('message', event => {
    try {
      const message: unknown = typeof event.data === 'string' ? JSON.parse(event.data) : null;
      if (!isRecord(message)) return;
      if (typeof message.id === 'number') {
        const request = pending.get(message.id);
        if (request) {
          pending.delete(message.id); clearTimeout(request.timer);
          if (isRecord(message.error)) request.reject(new Error(errorMessage(message.error.message)));
          else if (isRecord(message.result)) request.resolve(message.result);
          else request.reject(new Error('Invalid debugger response'));
        }
      }
      if (!isRecord(message.params)) return;
      const params = message.params;
      if (message.method === 'Runtime.exceptionThrown' && isRecord(params.exceptionDetails)) failures.push(String(params.exceptionDetails.text));
      if (message.method === 'Log.entryAdded' && isRecord(params.entry) && params.entry.level === 'error') failures.push(String(params.entry.text));
      if (message.method === 'Page.fileChooserOpened' && typeof params.backendNodeId === 'number') fileChoosers.push({ backendNodeId: params.backendNodeId, mode: String(params.mode) });
      if (message.method === 'Network.requestWillBeSent' && typeof params.requestId === 'string' && isRecord(params.request) && typeof params.request.url === 'string') requests.set(params.requestId, params.request.url);
      if (message.method === 'Network.loadingFailed' && typeof params.requestId === 'string' && /\.js(?:$|\?)/.test(requests.get(params.requestId) || '')) failures.push(`${requests.get(params.requestId)}: ${String(params.errorText)}`);
    } catch (error) { failures.push(errorMessage(error)); }
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Debugger connection closed')); }
    pending.clear();
  });
  async function send<M extends string>(method: M, params: Record<string, unknown> = {}, timeout = requestTimeout): Promise<CdpResponse<M>> {
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const number = ++id;
      const timer = setTimeout(() => {
        pending.delete(number);
        reject(new Error(`${method} timed out: ${(typeof params.expression === 'string' ? params.expression : '').slice(0, 160)}`));
      }, timeout);
      pending.set(number, { resolve, reject, timer }); socket.send(JSON.stringify({ id: number, method, params }));
    });
    // CDP is a local test protocol. Each call site's assertions verify its measured result.
    return result as CdpResponse<M>;
  }
  async function evaluate<T = unknown>(expression: string, awaitPromise = true): Promise<T> {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value as T;
  }
  if (page) { await send('Runtime.enable'); await send('Log.enable'); }
  return { socket, send, evaluate, fileChoosers, close: async () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Debugger closed')); }
    pending.clear();
    if (socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise<void>(resolve => socket.addEventListener('close', () => resolve(), { once: true }));
    socket.close(); await closed;
  } };
}

}
export = cdp;
