import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ADMIN_PUBLIC_ROUTE_KEY } from './admin-auth.metadata.js';
import type { AdminService } from './admin.service.js';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly adminService: AdminService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(ADMIN_PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    this.adminService.getRequestMeta(request);
    return true;
  }
}
