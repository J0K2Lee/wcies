import { DomainError } from '../../../common/errors/domain.error';

export class ImageNotFoundError extends DomainError {
  readonly code = 'SKU_IMAGE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`SKU image not found: ${id}`, { id });
  }
}

export class FileInvalidType extends DomainError {
  readonly code = 'FILE_INVALID_TYPE';
  readonly httpStatus = 422;

  constructor(mimeType: string) {
    super(`File type not allowed: ${mimeType}`, { mimeType });
  }
}

export class FileTooLargeError extends DomainError {
  readonly code = 'FILE_TOO_LARGE';
  readonly httpStatus = 422;

  constructor(maxBytes: number) {
    super(`File exceeds the maximum allowed size`, { maxBytes });
  }
}
