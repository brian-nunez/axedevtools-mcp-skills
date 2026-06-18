// Minimal raw Chrome DevTools Protocol client over Node's global WebSocket.
// Needed because we attach to targets Playwright won't expose as pages — the
// DevTools front-end (devtools://) and the axe extension's panel.html iframe.

export interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
}

type Pending = { resolve: (v: any) => void; reject: (e: any) => void };

export class CDP {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, Pending>();

  static async connect(endpoint: string): Promise<CDP> {
    const base = endpoint.replace(/\/$/, "");
    let ver: any;
    try {
      const res = await fetch(base + "/json/version");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ver = await res.json();
    } catch (e: any) {
      throw new Error(
        `Could not reach a browser CDP endpoint at ${endpoint} (${e?.message ?? e}). ` +
          `Start one with axe_browser_start, or launch a Chromium-family browser with ` +
          `--remote-debugging-port=9222 --remote-allow-origins=* --auto-open-devtools-for-tabs.`
      );
    }
    const cdp = new CDP();
    cdp.ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      cdp.ws.onopen = () => resolve();
      cdp.ws.onerror = () => reject(new Error("CDP websocket error"));
    });
    cdp.ws.onmessage = (ev: MessageEvent) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.id && cdp.pending.has(msg.id)) {
        const p = cdp.pending.get(msg.id)!;
        cdp.pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    };
    return cdp;
  }

  send(method: string, params: any = {}, sessionId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const m: any = { id: ++this.id, method, params };
      if (sessionId) m.sessionId = sessionId;
      this.pending.set(m.id, { resolve, reject });
      this.ws.send(JSON.stringify(m));
    });
  }

  async targets(): Promise<TargetInfo[]> {
    await this.send("Target.setDiscoverTargets", { discover: true });
    return (await this.send("Target.getTargets")).targetInfos as TargetInfo[];
  }

  async attach(targetId: string): Promise<string> {
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    await this.send("Runtime.enable", {}, sessionId).catch(() => {});
    return sessionId;
  }

  async detach(sessionId: string): Promise<void> {
    await this.send("Target.detachFromTarget", { sessionId }).catch(() => {});
  }

  /** Evaluate an expression in a session; awaits promises and returns the value by value. */
  async evalIn(sessionId: string, expression: string): Promise<any> {
    const r = await this.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || "evaluate failed");
    return r.result?.value;
  }

  close(): void {
    try {
      this.ws.close();
    } catch {}
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
