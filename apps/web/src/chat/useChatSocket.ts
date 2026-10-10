import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_WS_URL } from './api';
import type { ServerEvent } from './types';

export type Connection = 'connecting' | 'online' | 'reconnecting' | 'offline';

const PING_EVERY = 20_000;
const PONG_WITHIN = 8_000;

/**
 * One WebSocket per tab, identified as `user`. Reconnects with jittered exponential
 * backoff, treats a missing pong as a dead connection, and calls `onOpen` every time
 * it (re)connects so the caller can refetch anything sent while it was away.
 */
export function useChatSocket(user: string, onEvent: (event: ServerEvent) => void, onOpen: () => void) {
  const [status, setStatus] = useState<Connection>('connecting');
  const socketRef = useRef<WebSocket | null>(null);
  const handlers = useRef({ onEvent, onOpen });
  handlers.current = { onEvent, onOpen };

  useEffect(() => {
    let socket: WebSocket | null = null;
    let attempt = 0;
    let disposed = false;
    let retryTimer: number | undefined;
    let pingTimer: number | undefined;
    let pongTimer: number | undefined;

    const stopHeartbeat = () => {
      window.clearInterval(pingTimer);
      window.clearTimeout(pongTimer);
    };

    const connect = () => {
      window.clearTimeout(retryTimer);
      stopHeartbeat();
      const ws = new WebSocket(`${CHAT_WS_URL}?user=${encodeURIComponent(user)}`);
      socket = socketRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus('online');
        handlers.current.onOpen();
        pingTimer = window.setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: 'ping' }));
          window.clearTimeout(pongTimer);
          pongTimer = window.setTimeout(() => {
            // A dead connection can take a minute to report close; don't wait for it.
            if (socket !== ws) return;
            ws.onclose = null;
            ws.close();
            lost();
          }, PONG_WITHIN);
        }, PING_EVERY);
      };
      ws.onmessage = (e) => {
        let event: ServerEvent;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }
        if (event.type === 'pong') window.clearTimeout(pongTimer);
        else handlers.current.onEvent(event);
      };
      ws.onclose = () => {
        if (socket === ws) lost();
      };
    };

    const lost = () => {
      stopHeartbeat();
      socket = socketRef.current = null;
      if (disposed) return;
      setStatus(navigator.onLine ? 'reconnecting' : 'offline');
      const delay = Math.min(8000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      attempt += 1;
      retryTimer = window.setTimeout(connect, delay);
    };

    const wentOnline = () => {
      attempt = 0;
      if (!socket) {
        setStatus('reconnecting');
        connect();
      }
    };
    const wentOffline = () => setStatus('offline');
    window.addEventListener('online', wentOnline);
    window.addEventListener('offline', wentOffline);
    setStatus('connecting');
    connect();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      stopHeartbeat();
      window.removeEventListener('online', wentOnline);
      window.removeEventListener('offline', wentOffline);
      const last = socket;
      socket = socketRef.current = null;
      last?.close();
    };
  }, [user]);

  const send = useCallback((data: object) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }, []);

  return { status, send };
}
