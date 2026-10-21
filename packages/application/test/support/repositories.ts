import type { UnitOfWorkRepositories } from "../../dist/ports/uow.js";

/** Unused dependencies fail loudly; overrides must satisfy their actual port types. */
export function emptyRepositories(): UnitOfWorkRepositories {
  const unused: () => Promise<never> = async (): Promise<never> => { throw new Error("Unexpected repository access"); };
  return {
    users: { findById: unused, findByIdForUpdate: unused, exists: unused, save: unused },
    roles: { findById: unused, save: unused },
    deployment: { findById: unused, findByIdAndUserId: unused, findByUserId: unused, save: unused, update: unused, delete: unused },
    deploymentRequests: { findForUpdate: unused, save: unused },
    plans: { findActiveByStripeProductIds: unused },
  };
}
