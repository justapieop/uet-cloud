import type { UnitOfWorkRepositories } from "../../dist/ports/uow.js";

/** Unused dependencies fail loudly; overrides must satisfy their actual port types. */
export function emptyRepositories(): UnitOfWorkRepositories {
  const unused: () => Promise<never> = async (): Promise<never> => { throw new Error("Unexpected repository access"); };
  return {
    users: { findById: unused, findByIdForUpdate: unused, exists: unused, save: unused },
    roles: { findById: unused, findByIdForUpdate: unused, findByIds: unused, findAll: unused, findActiveByUserId: unused, save: unused, insert: unused, replace: unused, deactivate: unused },
    userRoles: { findByUserId: unused, replaceForUser: unused },
    deployment: { findById: unused, findByIdAndUserId: unused, findByUserId: unused, save: unused, insert: unused, countReservedByUserId: unused, update: unused, updateProgress: unused, transitionStatus: unused, delete: unused },
    deploymentRequests: { findForUpdate: unused, save: unused },
    plans: { findActiveByStripeProductIds: unused },
    volumes: { findById: unused, findByIdAndUserId: unused, findByNameAndUserId: unused, findByUserId: unused, save: unused, delete: unused },
  };
}
