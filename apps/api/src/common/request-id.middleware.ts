import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(
    req: Request & { traceId?: string },
    res: Response,
    next: NextFunction,
  ): void {
    const incoming = req.header('x-request-id');
    const traceId = incoming && incoming.length > 0 ? incoming : uuidv4();
    req.traceId = traceId;
    res.setHeader('x-request-id', traceId);
    next();
  }
}
