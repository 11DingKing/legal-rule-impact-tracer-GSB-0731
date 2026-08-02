import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import {
  DomainError,
  ValidationError,
  ReferentialIntegrityError,
  VersionNotFoundError,
  ArticleNotFoundError,
  SnapshotNotFoundError,
} from '../../../domain/errors/domain-errors';

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;

    if (
      exception instanceof ValidationError ||
      exception instanceof ReferentialIntegrityError
    ) {
      status = HttpStatus.BAD_REQUEST;
    } else if (
      exception instanceof VersionNotFoundError ||
      exception instanceof ArticleNotFoundError ||
      exception instanceof SnapshotNotFoundError
    ) {
      status = HttpStatus.NOT_FOUND;
    }

    response.status(status).json({
      statusCode: status,
      error: exception.name,
      message: exception.message,
    });
  }
}
