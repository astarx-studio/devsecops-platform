import { createHash } from 'crypto';

import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import type { Model } from 'mongoose';

import { Project } from './schemas/project.schema';

/**
 * Resolves an effective slug for a new project, following the policy:
 *
 *  1. If an explicit `slugOverride` is provided, use it directly — throw if taken.
 *  2. If `requested` is free, use it as-is.
 *  3. Append a 4-hex SHA1 suffix derived from the full group path
 *     (e.g. "repoa-a1b2") and check again.
 *  4. If the suffixed candidate is also taken, throw `ConflictException`.
 *
 * Slug stickiness policy (v2, Phase 4.5 decision — Option B):
 * Slugs are released back to the pool when a project is deleted; downstream URL
 * references should not assume immortality. The platform is single-tenant and
 * small-team, making the URL-recycle risk operational rather than a security
 * concern. Revisit if the platform grows multi-tenant or serves deep-linked
 * external traffic where `retired_slugs` (Option A) would be warranted.
 */
@Injectable()
export class SlugService {
  private readonly logger = new Logger(SlugService.name);

  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<Project>,
  ) {}

  /**
   * Resolves the effective slug for a project being created.
   *
   * @param requested - User-supplied leaf slug
   * @param groupPath - Ordered group path segments (used for hash suffix derivation)
   * @param slugOverride - Explicit slug that bypasses auto-generation and collision-suffix
   * @returns Resolved effective slug (may differ from `requested` on collision)
   * @throws ConflictException when both `requested` and the hashed candidate are taken,
   *         or when `slugOverride` is already in use
   */
  async resolve(requested: string, groupPath: string[], slugOverride?: string): Promise<string> {
    if (slugOverride) {
      this.logger.debug(`Slug resolution: using explicit override "${slugOverride}"`);
      if (await this.isTaken(slugOverride)) {
        throw new ConflictException(
          `Slug override "${slugOverride}" is already in use by another project.`,
        );
      }
      return slugOverride;
    }

    this.logger.debug(`Slug resolution: checking requested slug "${requested}"`);
    if (!(await this.isTaken(requested))) {
      this.logger.debug(`Slug "${requested}" is available — using as-is`);
      return requested;
    }

    const hash = this.pathHash(groupPath);
    const candidate = `${requested}-${hash}`;

    this.logger.debug(
      `Slug "${requested}" is taken — trying hash-suffixed candidate "${candidate}"`,
    );

    if (await this.isTaken(candidate)) {
      throw new ConflictException(
        `Slug "${candidate}" is already taken. ` +
          'Use the slugOverride field to specify an explicit unique slug.',
      );
    }

    this.logger.log(`Slug collision resolved: "${requested}" → "${candidate}"`);
    return candidate;
  }

  /**
   * Checks whether a slug is currently in use as an `effectiveSlug`.
   *
   * @param slug - Slug to check
   * @returns true if taken, false if available
   */
  async isAvailable(slug: string): Promise<boolean> {
    return !(await this.isTaken(slug));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async isTaken(slug: string): Promise<boolean> {
    const count = await this.projectModel.countDocuments({ effectiveSlug: slug }).exec();
    return count > 0;
  }

  /**
   * Derives a 4-hex-character suffix from the SHA1 of the full group path string.
   * e.g. ["groupa", "groupab"] → SHA1("groupa/groupab") → first 4 hex chars.
   *
   * @param groupPath - Group path segments
   * @returns 4-character lowercase hex string
   */
  private pathHash(groupPath: string[]): string {
    return createHash('sha1').update(groupPath.join('/')).digest('hex').slice(0, 4);
  }
}
