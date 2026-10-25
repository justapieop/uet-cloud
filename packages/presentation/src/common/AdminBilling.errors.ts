import { AdminBillingConflict, AdminBillingNotFound, AdminBillingUnavailable } from "@kumo/application";
import { InvalidDomainParams } from "@kumo/domain";
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";

export function adminBillingError(error: unknown): never {
  if (error instanceof InvalidDomainParams) throw new BadRequestException(error.message);
  if (error instanceof AdminBillingNotFound) throw new NotFoundException(error.message);
  if (error instanceof AdminBillingConflict) throw new ConflictException(error.message);
  if (error instanceof AdminBillingUnavailable) throw new ServiceUnavailableException(error.message);
  throw error;
}
