import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Field, ObjectType } from '@nestjs/graphql';

import { CombinedAuthGuard } from '../common/guards';
import {
  CreatedMcpAccessKey,
  McpAccessKeyService,
  McpAccessKeyView,
} from './mcp-access-key.service';
import type { McpScope } from './mcp-scopes';

@ObjectType({ description: 'MCP access key metadata. The secret is never stored or listed.' })
export class McpAccessKeyType implements McpAccessKeyView {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field({ description: 'Non-secret prefix of the token' })
  tokenPrefix!: string;

  @Field(() => String, { description: 'read, read_secret, operate, or full' })
  scope!: McpScope;

  @Field({ nullable: true })
  createdAt?: string;

  @Field({ nullable: true })
  lastUsedAt?: string;

  @Field({ nullable: true })
  revokedAt?: string;
}

@ObjectType({ description: 'Create response. `token` is shown once.' })
export class CreateMcpAccessKeyPayload extends McpAccessKeyType implements CreatedMcpAccessKey {
  @Field({ description: 'Full bearer token. Returned only from this mutation.' })
  token!: string;
}

@Resolver()
@UseGuards(CombinedAuthGuard)
export class McpResolver {
  constructor(private readonly keys: McpAccessKeyService) {}

  @Query(() => [McpAccessKeyType], {
    description: 'MCP keys issued for IDE clients. Tokens are not included.',
  })
  mcpAccessKeys(
    @Args('includeRevoked', { type: () => Boolean, nullable: true, defaultValue: false })
    includeRevoked?: boolean,
  ): Promise<McpAccessKeyType[]> {
    return this.keys.list(includeRevoked === true);
  }

  @Mutation(() => CreateMcpAccessKeyPayload, {
    description:
      'Issue an MCP bearer token. The token is returned once and only its hash is stored.',
  })
  createMcpAccessKey(
    @Args('name') name: string,
    @Args('scope', {
      nullable: true,
      defaultValue: 'read',
      description: 'read, read_secret, operate, or full. Default read.',
    })
    scope?: string,
  ): Promise<CreateMcpAccessKeyPayload> {
    return this.keys.create(name, scope ?? 'read');
  }

  @Mutation(() => Boolean, {
    description: 'Revoke an MCP key. Later calls with that token are rejected.',
  })
  revokeMcpAccessKey(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.keys.revoke(id);
  }
}
