import type { Request, Response } from "express";
import * as sessionService from "./session.service.ts";
import { encodeCursor } from "./session.http.ts";
import type {
  CreateSessionBody,
  ListSessionsQuery,
  SessionIdParams,
} from "./session.http.ts";

/**
 * HTTP concerns only: read the request, call the service, choose a status code.
 *
 * No business logic, no database access, and no try/catch — a thrown domain
 * error propagates to the error middleware, which owns the mapping to HTTP.
 *
 * `req.userId` comes from the auth middleware and is the one value here a
 * client cannot influence. Everything else in the request is untrusted, which
 * is why the service re-checks ownership rather than trusting a path param.
 */

// TODO(raymond): POST /api/v1/sessions
//   - the validated body is on `req.body` (cast it to CreateSessionBody)
//   - call sessionService.createSession with req.userId plus track/difficulty
//   - which status code does a creation return? and which header should
//     accompany it, per the API conventions?
//   - res.status(...).location(...).json(...) chains.
export async function create(req: Request, res: Response) {
  const { track, difficulty } = req.body as CreateSessionBody;
  const result = await sessionService.createSession({
    userId: req.userId,
    track,
    difficulty,
  });

  res
    .status(201)
    .location(`/api/v1/sessions/${result.session.id}`)
    .json(result);
}

// TODO(raymond): GET /api/v1/sessions/:sessionId
//   - `req.params` holds the validated param (cast to SessionIdParams)
//   - one call, one res.json(...). Nothing else.
//   - what happens if the service throws NotFoundError? Do you need to
//     handle it here?
export async function getById(req: Request, res: Response) {
  const { sessionId } = req.params as SessionIdParams;
  res.json(await sessionService.getSession(sessionId, req.userId));
}

// TODO(raymond): POST /api/v1/sessions/:sessionId/advance
//   Nearly identical to getById — different service call.
export async function advance(req: Request, res: Response) {
  const { sessionId } = req.params as SessionIdParams;
  res.json(await sessionService.advanceSession(sessionId, req.userId));
}

/**
 * GET /api/v1/sessions — the user's sessions, newest first.
 *
 * Keyset pagination: rather than "skip 40 rows", the client sends back the
 * sort key of the last row it saw, and the query resumes from there.
 *
 *   page 1   GET /sessions?limit=20
 *            → { data: [20 rows], nextCursor: "eyJjIjoi…" }
 *
 *   page 2   GET /sessions?limit=20&cursor=eyJjIjoi…
 *            → { data: [20 rows], nextCursor: "eyJjIjoi…" }
 *
 *   last     → { data: [7 rows],  nextCursor: null }
 *
 * The cursor encodes `(createdAt, id)` — exactly the columns the query orders
 * by — so the next page starts where the previous one stopped even if rows
 * were inserted in between. `OFFSET` cannot promise that: a new session shifts
 * the window and the client sees a row twice.
 */
export async function list(req: Request, res: Response) {
  // validate() has already coerced limit to a number and decoded the cursor,
  // so these are real values rather than strings.
  const query = req.query as unknown as ListSessionsQuery;

  const data = await sessionService.listSessions(
    req.userId,
    query.limit,
    query.cursor,
  );

  // A full page means there is probably more; a short page means the rows ran
  // out. Returning a cursor there would send the client after an empty page.
  const last = data.at(-1);
  const nextCursor =
    data.length === query.limit && last
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null;

  // Collections are wrapped; single resources are returned bare.
  res.json({ data, nextCursor });
}
