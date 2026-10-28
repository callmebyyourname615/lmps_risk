import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createLocalJWKSet, importJWK, jwtVerify, type JWK } from 'jose';
import { ForbiddenException, Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const LOCAL_AUTH = Symbol('LOCAL_AUTH');
export const LOCAL_SCOPE = Symbol('LOCAL_SCOPE');
export const LOCAL_ISSUER = 'https://lmps-local.invalid';
export const LOCAL_AUDIENCE = 'lmps-local-source-read';
export type Principal = { subject: string; workspace: string };
const LOCAL_SCOPES = ['source:read', 'operations:read', 'audit:read', 'sync:read', 'transactions:read', 'rules:read', 'assessments:read', 'risk:read', 'alerts:read', 'alerts:review', 'risk-jobs:read', 'risk-jobs:retry', 'policies:read', 'policies:write', 'policies:approve', 'policies:activate', 'cases:read', 'cases:write', 'cases:assign', 'cases:work', 'cases:reopen', 'labels:read', 'labels:adjudicate'] as const;
type LocalScope = typeof LOCAL_SCOPES[number];
export type ScopedRequest = FastifyRequest & { principal: Principal };
export type LocalAuthenticator = { verify(header: unknown, scope?: LocalScope): Promise<Principal> };

@Injectable()
export class LocalAccessGuard implements CanActivate {
  constructor(@Inject(LOCAL_AUTH) private readonly auth: LocalAuthenticator, private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const required = this.reflector.getAllAndOverride<LocalScope | LocalScope[]>(LOCAL_SCOPE, [context.getHandler(), context.getClass()]);
    const scopes = Array.isArray(required) ? required : [required];
    if (!scopes.length || scopes.some(scope => (scope === undefined || !LOCAL_SCOPES.includes(scope)))) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Required local scope is unavailable.' });
    try { for (const scope of scopes) request.principal = await this.auth.verify(request.headers.authorization, scope); return true; }
    catch (error) {
      if (error instanceof UnauthorizedException) context.switchToHttp().getResponse<FastifyReply>().header('WWW-Authenticate', 'Bearer realm="lmps-local"');
      throw error;
    }
  }
}

export async function loadLocalAuthenticator(path: string): Promise<LocalAuthenticator> {
  try {
    if (!isAbsolute(path)) throw new Error();
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let config;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.uid !== process.getuid?.() || stat.size > 16384) throw new Error();
      const buffer = Buffer.alloc(16385);
      let length = 0;
      while (length < buffer.length) {
        const read = await file.read(buffer, length, buffer.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (length > 16384) throw new Error();
      config = JSON.parse(buffer.subarray(0, length).toString('utf8'));
    } finally { await file.close(); }
    if (!config || Object.keys(config).sort().join(',') !== 'audience,format,issuer,jwks,kind'
      || config.format !== 1 || config.kind !== 'local_synthetic' || config.issuer !== LOCAL_ISSUER || config.audience !== LOCAL_AUDIENCE
      || !config.jwks || Object.keys(config.jwks).join(',') !== 'keys' || !Array.isArray(config.jwks.keys) || !config.jwks.keys.length || config.jwks.keys.length > 4) throw new Error();
    const kids = new Set();
    for (const key of config.jwks.keys) {
      if (!key || Object.keys(key).sort().join(',') !== 'alg,crv,kid,kty,use,x,y' || key.kty !== 'EC' || key.crv !== 'P-256' || key.alg !== 'ES256' || key.use !== 'sig'
        || typeof key.kid !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(key.kid) || kids.has(key.kid)
        || !/^[A-Za-z0-9_-]{43}$/.test(key.x) || !/^[A-Za-z0-9_-]{43}$/.test(key.y)) throw new Error();
      kids.add(key.kid);
      await importJWK(key, 'ES256');
    }
    const keyset = createLocalJWKSet(config.jwks as { keys: JWK[] });
    return { async verify(header: unknown, required: LocalScope = 'source:read'): Promise<Principal> {
      let principal: Principal; let scope: string;
      try {
        if (typeof header !== 'string' || header.length > 4096) throw new Error();
        const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header)?.[1];
        if (!token) throw new Error();
        const { payload, protectedHeader } = await jwtVerify(token, keyset, {
          issuer: LOCAL_ISSUER, audience: LOCAL_AUDIENCE, algorithms: ['ES256'], typ: 'at+jwt',
          requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'nbf', 'jti'], maxTokenAge: 300, clockTolerance: 0,
        });
        if (Object.keys(protectedHeader).sort().join(',') !== 'alg,kid,typ'
          || ![payload.iat, payload.exp, payload.nbf].every(Number.isSafeInteger)
          || payload.exp! <= payload.iat! || payload.exp! - payload.iat! > 300
          || typeof payload.sub !== 'string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(payload.sub)
          || typeof payload.jti !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(payload.jti)) throw new Error();
        if (typeof payload.scope !== 'string' || payload.scope.length > 256 || !/^[a-z][a-z0-9:_-]*( [a-z][a-z0-9:_-]*)*$/.test(payload.scope)
          || typeof payload.workspace_key !== 'string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(payload.workspace_key)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Required source scope is unavailable.' });
        principal = { subject: payload.sub, workspace: payload.workspace_key }; scope = payload.scope;
      } catch (error) {
        if (error instanceof ForbiddenException) throw error;
        throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'A valid local access token is required.' });
      }
      if (!LOCAL_SCOPES.includes(required) || !scope.split(' ').includes(required)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Required local scope is unavailable.' });
      return principal;
    } };
  } catch { throw new Error('Invalid private local authentication configuration.'); }
}
