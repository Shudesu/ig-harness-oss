-- Cache a LINE Harness tracked-link short id per gate so the reward DM can
-- auto-generate a cross-link URL `<lh>/r/<short>?ig=<IGSID>&pool=<slug>`
-- at delivery time without re-creating a tracked link for every recipient.
-- Nullable: if the operator doesn't attach a line_connection_id on the gate,
-- we skip cross-link wrapping entirely and send reward_url as-is.
ALTER TABLE engagement_gates ADD COLUMN line_tracked_link_short TEXT;
