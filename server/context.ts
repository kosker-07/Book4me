// Per-request context (request id, client IP, user-agent) carried through async calls so that every audit
// record can be traced back to the HTTP request that caused it.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export interface RequestContext { requestId: string; ip: string | null; userAgent: string | null }

const storage = new AsyncLocalStorage<RequestContext>();
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;

export const currentContext = (): RequestContext | undefined => storage.getStore();

/** Accepts a well-formed incoming X-Request-Id (e.g. from the reverse proxy), otherwise generates one. */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", requestId);
  const ua = req.header("user-agent");
  storage.run({ requestId, ip: req.ip || req.socket.remoteAddress || null, userAgent: ua ? ua.slice(0, 500) : null }, next);
}
