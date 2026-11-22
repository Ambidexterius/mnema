import type { IncomingMessage, ServerResponse } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import type { createMcpService } from '../mcp.ts';
import type { Person, RequestServices } from '../request-context.ts';
import { handledJson } from '../http.ts';

const discoveryPaths = new Set([
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server/api/auth',
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration/api/auth',
  '/api/auth/.well-known/openid-configuration',
  '/api/auth/.well-known/oauth-authorization-server',
]);
const oauthPaths = new Set([
  '/api/auth/jwks',
  '/api/auth/oauth2/authorize',
  '/api/auth/oauth2/token',
  '/api/auth/oauth2/register',
  '/api/auth/oauth2/userinfo',
  '/api/auth/oauth2/revoke',
  '/api/auth/oauth2/introspect',
]);

export function matchPublicMcpRoute(path: string) {
  if (path === '/mcp') return 'transport';
  if (discoveryPaths.has(path)) return 'discovery';
  if (oauthPaths.has(path)) return 'oauth';
}

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
interface PublicMcpServices {
  transport: NodeHandler;
  auth: NodeHandler;
  limit: RequestServices['limit'];
}

export async function handlePublicMcp(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  route: NonNullable<ReturnType<typeof matchPublicMcpRoute>>,
  { transport, auth, limit }: PublicMcpServices,
) {
  if (route === 'transport') return transport(req, res);
  if (route === 'discovery') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' });
      res.end();
      return;
    }
  } else if (path.endsWith('/register')) limit('mcp-register:' + req.socket.remoteAddress, 10);
  return auth(req, res);
}

interface ManagementServices extends Pick<RequestServices, 'body' | 'limit'> {
  mcpService: ReturnType<typeof createMcpService>;
}
export async function handleMcpManagement(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  { mcpService, body, limit }: ManagementServices,
) {
  if (path === '/api/mcp/settings' && req.method === 'GET')
    return handledJson(res, 200, mcpService.settings(person));
  if (path === '/api/mcp/consent/context' && req.method === 'POST') {
    limit('mcp-consent:' + person.id, 30);
    const b = await body(req);
    return handledJson(
      res,
      200,
      await mcpService.consentContext(person, String(b.query || ''), fromNodeHeaders(req.headers)),
    );
  }
  if (path === '/api/mcp/consent' && req.method === 'POST') {
    limit('mcp-consent:' + person.id, 30);
    return handledJson(
      res,
      200,
      await mcpService.consent(person, await body(req), fromNodeHeaders(req.headers)),
    );
  }
  if (path === '/api/mcp/tokens' && req.method === 'POST') {
    limit('mcp-token:' + person.id, 5);
    return handledJson(res, 201, mcpService.createToken(person, await body(req)));
  }
  if (/^\/api\/mcp\/grants\/[^/]+\/revoke$/.test(path) && req.method === 'POST') {
    await body(req);
    return handledJson(
      res,
      200,
      await mcpService.revoke(person, path.split('/')[4], fromNodeHeaders(req.headers)),
    );
  }

  return false;
}
