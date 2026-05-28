import { DomainError, ErrorCode } from '@ai-worldcup/shared';
import type {
  ArgumentsHost,
  ExceptionFilter} from '@nestjs/common';
import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

interface ApiErrorResponse {
  success: false;
  data: null;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  traceId?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { traceId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorResponse = {
      success: false,
      data: null,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
      },
      traceId: req?.traceId,
    };

    if (exception instanceof DomainError) {
      status = this.mapDomainErrorToStatus(exception.code);
      body = {
        ...body,
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      };
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      body = {
        ...body,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Validation failed',
          details: exception.flatten(),
        },
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      body = {
        ...body,
        error: {
          code: this.mapStatusToCode(status),
          message:
            typeof resp === 'string'
              ? resp
              : ((resp as { message?: string }).message ?? exception.message),
          details: typeof resp === 'object' ? resp : undefined,
        },
      };
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      body.error.message = exception.message;
    } else {
      this.logger.error('Unknown exception', JSON.stringify(exception));
    }

    res.status(status).json(body);
  }

  private mapDomainErrorToStatus(code: string): number {
    switch (code) {
      case ErrorCode.AUTH_REQUIRED:
      case ErrorCode.AUTH_INVALID_TOKEN:
        return HttpStatus.UNAUTHORIZED;
      case ErrorCode.RATE_LIMITED:
        return HttpStatus.TOO_MANY_REQUESTS;
      case ErrorCode.VALIDATION_FAILED:
        return HttpStatus.BAD_REQUEST;
      case ErrorCode.RESOURCE_NOT_FOUND:
        return HttpStatus.NOT_FOUND;
      case ErrorCode.ENTITLEMENT_QUOTA_EXCEEDED:
      case ErrorCode.ENTITLEMENT_PASS_REQUIRED:
      case ErrorCode.INVITE_LIMIT_REACHED:
        return HttpStatus.FORBIDDEN;
      case ErrorCode.PAYMENT_CHANNEL_UNSUPPORTED:
        return HttpStatus.BAD_REQUEST;
      default:
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }

  private mapStatusToCode(status: number): string {
    if (status === HttpStatus.UNAUTHORIZED) return ErrorCode.AUTH_REQUIRED;
    if (status === HttpStatus.NOT_FOUND) return ErrorCode.RESOURCE_NOT_FOUND;
    if (status === HttpStatus.TOO_MANY_REQUESTS) return ErrorCode.RATE_LIMITED;
    if (status === HttpStatus.BAD_REQUEST) return ErrorCode.VALIDATION_FAILED;
    return ErrorCode.INTERNAL_ERROR;
  }
}
