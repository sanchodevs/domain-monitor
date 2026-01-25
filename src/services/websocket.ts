import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'http';
import { createLogger } from '../utils/logger.js';
import type { RefreshStatus } from '../types/api.js';
import type { Domain, DomainHealth } from '../types/domain.js';

const logger = createLogger('websocket');

export interface WSMessage {
  type: 'connected' | 'refresh_progress' | 'refresh_complete' | 'domain_updated' | 'health_update' | 'error';
  payload: unknown;
}

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      logger.info('WebSocket client connected', { totalClients: this.clients.size });

      // Send connection confirmation
      this.send(ws, {
        type: 'connected',
        payload: { timestamp: Date.now(), message: 'Connected to Domain Monitor' },
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.info('WebSocket client disconnected', { totalClients: this.clients.size });
      });

      ws.on('error', (err) => {
        logger.error('WebSocket error', { error: err.message });
        this.clients.delete(ws);
      });

      // Handle ping/pong for connection health
      ws.on('pong', () => {
        (ws as unknown as { isAlive: boolean }).isAlive = true;
      });
    });

    // Heartbeat to detect stale connections
    const heartbeatInterval = setInterval(() => {
      this.wss?.clients.forEach((ws) => {
        const wsExt = ws as unknown as { isAlive: boolean };
        if (wsExt.isAlive === false) {
          this.clients.delete(ws);
          return ws.terminate();
        }
        wsExt.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.wss.on('close', () => {
      clearInterval(heartbeatInterval);
    });

    logger.info('WebSocket server initialized');
  }

  private send(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  broadcast(message: WSMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  sendRefreshProgress(status: RefreshStatus): void {
    this.broadcast({
      type: 'refresh_progress',
      payload: {
        ...status,
        timestamp: Date.now(),
      },
    });
  }

  sendRefreshComplete(total: number, duration: number): void {
    this.broadcast({
      type: 'refresh_complete',
      payload: {
        total,
        duration,
        timestamp: Date.now(),
      },
    });
  }

  sendDomainUpdate(domain: Domain): void {
    this.broadcast({
      type: 'domain_updated',
      payload: domain,
    });
  }

  sendHealthUpdate(domainId: number, health: DomainHealth): void {
    this.broadcast({
      type: 'health_update',
      payload: { domainId, health },
    });
  }

  sendError(message: string): void {
    this.broadcast({
      type: 'error',
      payload: { message, timestamp: Date.now() },
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    this.wss?.close();
    this.clients.clear();
    logger.info('WebSocket server closed');
  }
}

export const wsService = new WebSocketService();
