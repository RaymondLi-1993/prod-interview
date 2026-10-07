-- Up Migration

-- Cap message length, per role.
--
--   candidate     4000 chars — tight. One oversized candidate message is not
--                 paid for once: the whole transcript is resent to the LLM on
--                 every subsequent turn of the stage, so its cost is multiplied
--                 by the number of turns that follow it.
--   interviewer  16000 chars — loose. This is LLM output, bounded by
--                 max_output_tokens. 4096 tokens is roughly 16000 characters,
--                 so a tighter cap would reject replies we had already paid to
--                 generate and streamed to the candidate.
--
-- length() and not octet_length(): the promise to the candidate is "4000
-- characters", and the two diverge the moment anyone types an emoji or a CJK
-- character. octet_length() would silently cut a Japanese answer to about a
-- third of the advertised limit.
--
-- CASE needs ELSE false. A CHECK passes when its expression is NULL, and a
-- CASE with no match returns NULL — so without the ELSE, adding a third role
-- later would silently exempt it from any limit at all. Failing closed means a
-- new role is rejected outright until someone comes back here and gives it a
-- limit on purpose.
--
-- Added plain rather than NOT VALID. ADD CONSTRAINT takes an ACCESS EXCLUSIVE
-- lock and scans every row to prove the existing data passes; on a large table
-- that blocks reads and writes long enough to be an outage, and the pattern is
-- NOT VALID followed by a separate VALIDATE CONSTRAINT. This table holds five
-- rows and serves no traffic, so the scan is instant and the simpler form is
-- the honest choice.

ALTER TABLE messages
  ADD CONSTRAINT chk_messages_content_length CHECK (
    CASE role
      WHEN 'candidate'   THEN length(content) <= 4000
      WHEN 'interviewer' THEN length(content) <= 16000
      ELSE false
    END
  );

-- Down Migration

ALTER TABLE messages DROP CONSTRAINT chk_messages_content_length;
