import axios from 'axios';

export class VendorStatusError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Vendor error text safe to show an operator. Omits request config, which carries tokens. */
export function vendorError(err: unknown, label: string): VendorStatusError {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data: unknown = err.response?.data;
    let detail = '';
    if (typeof data === 'string') {
      detail = data.slice(0, 300);
    } else if (data && typeof data === 'object') {
      const body = data as { message?: string; errors?: Array<{ message?: string }> };
      detail =
        body.message ||
        body.errors
          ?.map((item) => item.message)
          .filter((message): message is string => Boolean(message))
          .join('; ') ||
        '';
    }
    return new VendorStatusError(
      `${label} failed (${status ?? 'network'}): ${detail || err.message}`,
      status,
    );
  }
  if (err instanceof VendorStatusError) {
    return err;
  }
  if (err instanceof Error) {
    return new VendorStatusError(err.message);
  }
  return new VendorStatusError(`${label} failed`);
}
