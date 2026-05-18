/** Vault KV key storing full file body for BUILD `raw_file` delivery. */
export const ENV_PROFILE_RAW_CONTENT_KEY = '_raw_content';

/** Max upload size for env profile file content (bytes). */
export const ENV_PROFILE_MAX_FILE_BYTES = 256 * 1024;

/** Relative path under vaultBasePath for non-secret CI profile index. */
export const ENV_PROFILE_CI_INDEX_SUFFIX = 'ci/index';

export type EnvProfileInjectionPhase = 'build' | 'runtime';

export type EnvProfileBuildDelivery = 'raw_file' | 'dotenv_build_args';
