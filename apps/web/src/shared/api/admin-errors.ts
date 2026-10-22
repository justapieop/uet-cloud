export function adminError(status: number): string {
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "You do not have permission to manage this section.";
  if (status === 400) return "The request was rejected. Check the supplied fields.";
  if (status === 404) return "The selected record could not be found.";
  if (status === 409) return "The request conflicts with an existing record or the current subscription state. Refresh and check the settings.";
  return "The management service is temporarily unavailable. Please try again.";
}

export type AdminResult<T> = { readonly data: T; readonly error?: never } | { readonly error: string; readonly data?: never };
