/**
 * Errors thrown by services, mapped to HTTP status codes by the error
 * middleware and nowhere else (see README: Architecture).
 *
 * A service throws `new NotFoundError("Session", id)`. It does not know or
 * care that 404 exists — that mapping lives at the HTTP boundary, so the same
 * service works unchanged behind a queue worker or a CLI.
 */
export abstract class AppError extends Error {
  /** HTTP status the error middleware will use. */
  abstract readonly status: number;

  /**
   * Stable, machine-readable identifier. Becomes the `type` URI in the
   * RFC 9457 response body, so clients can branch on it without parsing
   * human-readable text.
   */
  abstract readonly type: string;

  /**
   * Whether this error is safe to show a user.
   *
   * `true` for errors describing what the caller did wrong. `false` for
   * anything that might carry internal detail — those get a generic message.
   */
  readonly expose: boolean = true;

  constructor(message: string) {
    super(message);
    // Error subclasses need this to report the right name in stack traces.
    this.name = new.target.name;
    Error.captureStackTrace(this, new.target);
  }
}

/**
 * 404 — the resource does not exist, **or it is not yours**.
 *
 * Deliberately conflated: returning 403 for someone else's resource confirms
 * that it exists, which lets an attacker enumerate ids.
 */
export class NotFoundError extends AppError {
  readonly status = 404;
  readonly type = "not-found";

  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} ${id} was not found.` : `${resource} was not found.`,
    );
  }
}

/**
 * 409 — the request is valid but conflicts with current state.
 *
 * The state-machine error: starting a second interview while one is running,
 * advancing a completed session, activating a stage while another is active.
 */
export class ConflictError extends AppError {
  readonly status = 409;
  readonly type = "conflict";
}

/**
 * 422 — well-formed and correctly typed, but semantically invalid.
 *
 * Distinct from 400, which the validation middleware returns when a request
 * fails its schema. This is for rules a schema cannot express: "that stage
 * belongs to a different session".
 */
export class UnprocessableError extends AppError {
  readonly status = 422;
  readonly type = "unprocessable";
}

/** 401 — no valid credentials. */
export class UnauthorizedError extends AppError {
  readonly status = 401;
  readonly type = "unauthorized";

  constructor(message = "Authentication required.") {
    super(message);
  }
}

/**
 * 403 — authenticated, and genuinely forbidden.
 *
 * Rare here: anything owned by another user is a 404 instead. Reserved for
 * cases where the resource's existence is already public knowledge.
 */
export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly type = "forbidden";
}

/**
 * 500 — an unexpected failure.
 *
 * `expose` is false: the message may name internal services or query shapes,
 * so the client gets a generic string and the detail goes to the logs,
 * correlated by requestId.
 */
export class InternalError extends AppError {
  readonly status = 500;
  readonly type = "internal";
  override readonly expose = false;
}
