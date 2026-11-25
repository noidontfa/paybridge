import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { SessionOnly } from '../../common/principal/access-policy.js';
import {
  PRINCIPAL_REQUEST_KEY,
  type Principal,
} from '../../common/principal/principal.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { INTERNAL_PREFIX } from '../../constants.js';
import { GetSessionUser } from '../application/use-cases/get-session-user.js';
import { RefreshSession } from '../application/use-cases/refresh-session.js';
import { SignIn } from '../application/use-cases/sign-in.js';
import { SignOut } from '../application/use-cases/sign-out.js';
import type { Session, SessionUser } from '../application/session.js';
import {
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  OrganizationSuspendedError,
  UserDeactivatedError,
} from '../domain/errors.js';
import { AccessTokenService } from '../port/access-token.service.js';
import { Public } from './principal.guard.js';

const signInSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1024),
});
const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});

type SignInBody = z.output<typeof signInSchema>;
type RefreshTokenBody = z.output<typeof refreshTokenSchema>;

function rethrow(error: unknown): never {
  if (error instanceof InvalidCredentialsError) {
    throw new UnauthorizedException({
      message: error.message,
      code: 'INVALID_CREDENTIALS',
    });
  }
  if (error instanceof InvalidRefreshTokenError) {
    throw new UnauthorizedException({
      message: error.message,
      code: 'INVALID_REFRESH_TOKEN',
    });
  }
  if (error instanceof UserDeactivatedError) {
    throw new ForbiddenException({
      message: error.message,
      code: 'ACCOUNT_DEACTIVATED',
    });
  }
  if (error instanceof OrganizationSuspendedError) {
    throw new ForbiddenException({
      message: error.message,
      code: 'ORGANIZATION_SUSPENDED',
    });
  }
  throw error;
}

/**
 * Sign-in, refresh and sign-out. They live under `/internal` because only the
 * Console's BFF calls them (ADR 0004): the tokens in the responses must never
 * reach a browser.
 */
@ApiTags('internal')
@Controller(`${INTERNAL_PREFIX}/auth`)
export class AuthController {
  constructor(
    @Inject(SignIn) private readonly signIn: SignIn,
    @Inject(RefreshSession) private readonly refresh: RefreshSession,
    @Inject(SignOut) private readonly signOut: SignOut,
    @Inject(GetSessionUser) private readonly sessionUser: GetSessionUser,
  ) {}

  @Public()
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async signInWithPassword(
    @Body(new ZodValidationPipe(signInSchema)) body: SignInBody,
  ): Promise<Session> {
    try {
      return await this.signIn.execute(body);
    } catch (error) {
      rethrow(error);
    }
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new session' })
  async refreshSession(
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenBody,
  ): Promise<Session> {
    try {
      return await this.refresh.execute(body.refreshToken);
    } catch (error) {
      rethrow(error);
    }
  }

  @Public()
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the sign-in a refresh token belongs to' })
  async signOutSession(
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenBody,
  ): Promise<void> {
    await this.signOut.execute(body.refreshToken);
  }

  @SessionOnly()
  @Get('me')
  @ApiOperation({ summary: 'The signed-in User, their Role and Organization' })
  async me(
    @Req() request: Record<string, unknown>,
  ): Promise<SessionUser> {
    const principal = request[PRINCIPAL_REQUEST_KEY] as Principal;
    try {
      return await this.sessionUser.execute(principal.user!.id);
    } catch (error) {
      rethrow(error);
    }
  }
}

/** Public keys for verifying access tokens, so signing keys can rotate. */
@ApiTags('identity')
@Controller('.well-known')
export class JwksController {
  constructor(
    @Inject(AccessTokenService) private readonly tokens: AccessTokenService,
  ) {}

  @Public()
  @Get('jwks.json')
  @ApiOperation({ summary: 'The access-token public keys (JWKS)' })
  jwks() {
    return this.tokens.jwks();
  }
}
