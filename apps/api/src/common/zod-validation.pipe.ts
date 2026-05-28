import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Zod 校验 Pipe：用法 `@Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto`。
 * Pipe 抛出原始 ZodError，由 AllExceptionsFilter 统一格式化为 ApiResponse 错误。
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    return this.schema.parse(value);
  }
}
