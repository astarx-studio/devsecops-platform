import { AsyncLocalStorage } from 'node:async_hooks';

/** Request-scoped caller label stamped onto new audit documents. */
export const auditActorAls = new AsyncLocalStorage<{ actor: string }>();
