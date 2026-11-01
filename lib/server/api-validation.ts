import { isAddress } from "viem";

export type ApiErrorShape = {
  error: {
    code: string;
    message: string;
  };
};

export function createApiError(code: string, message: string): ApiErrorShape {
  return {
    error: {
      code,
      message,
    },
  };
}

export function parsePositiveIntegerParam(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

/** A well-formed EVM address, as given, or null. */
export function parseAddressParam(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !isAddress(trimmed, { strict: false })) {
    return null;
  }

  return trimmed;
}
