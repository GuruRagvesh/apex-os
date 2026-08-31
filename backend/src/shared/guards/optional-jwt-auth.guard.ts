import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Attaches the session if there is one, and refuses nobody.
 *
 * For routes authorised by something OTHER than the session — currently only
 * the phone punch handoff, which is authorised by a one-time token carried in
 * a QR fragment. The employee standing in a doorway must not be sent through a
 * login screen to record a punch their laptop already authorised.
 *
 * The session is still read when present, because "no session" and "somebody
 * else's session" are different facts: the first is an employee who happens to
 * be signed out, the second is a colleague holding a QR that is not theirs.
 * Routes using this guard are expected to refuse the second.
 *
 * NEVER use this on a route the session alone authorises. It is not a relaxed
 * JwtAuthGuard; it is a guard for routes that carry their own credential.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(_err: any, user: any) {
    // A missing, expired or malformed token is not an error on these routes.
    // Passport signals all three the same way, and all three mean the same
    // thing here: no session to compare against.
    return user || null;
  }
}
