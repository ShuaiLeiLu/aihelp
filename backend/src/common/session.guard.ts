import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../modules/prisma/prisma.service'
import { verifySession } from './signed-session'

@Injectable()
export class UserSessionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest()
    const payload = verifySession(req.cookies?.chatty_session, this.userSessionSecret(), 'user')
    if (!payload) throw new UnauthorizedException('unauthorized')
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user || user.status !== 'active') throw new UnauthorizedException('unauthorized')
    req.user = { id: user.id, status: user.status }
    return true
  }

  private userSessionSecret() {
    const secret = this.config.get<string>('USER_SESSION_SECRET') || this.config.get<string>('COOKIE_SECRET')
    if (!secret) throw new UnauthorizedException('session_secret_not_configured')
    return secret
  }
}

@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  async canActivate(context: ExecutionContext) {
    const http = context.switchToHttp()
    const req = http.getRequest()
    const payload = verifySession(req.cookies?.chatty_admin_session, this.adminSessionSecret(), 'admin')
    if (!payload) throw new UnauthorizedException('unauthorized')
    const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } })
    if (!admin || admin.status !== 'active') throw new UnauthorizedException('unauthorized')
    req.admin = { id: admin.id, role: admin.role, status: admin.status }
    return true
  }

  private adminSessionSecret() {
    const secret = this.config.get<string>('ADMIN_SESSION_SECRET') || this.config.get<string>('COOKIE_SECRET')
    if (!secret) throw new UnauthorizedException('session_secret_not_configured')
    return secret
  }
}
