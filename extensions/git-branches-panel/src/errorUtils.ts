export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

export function formatErrorMessage(
  prefix: string,
  error: unknown,
  fallback = 'Unknown error'
): string {
  return `${prefix}: ${getErrorMessage(error, fallback)}`;
}
