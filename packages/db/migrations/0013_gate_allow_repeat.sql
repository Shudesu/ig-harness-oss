-- Allow repeated enrollment per follower for demo / nurture campaigns.
--
-- Default 0 (legacy idempotent skip behavior preserved). When set to 1
-- on a gate, every matching trigger creates a fresh delivery and the
-- service layer skips the "delivery.status !== 'triggered'" early-return
-- so the same follower can receive the CTA flow again.
--
-- Removing the unique index is required so subsequent INSERTs aren't
-- collapsed by ON CONFLICT — but the createGateDelivery helper still
-- protects allow_repeat=0 gates by SELECTing first and returning the
-- existing row when present (race-tolerant: 2 concurrent webhooks from
-- the same follower may produce 2 rows in the worst case, which is
-- still better than ON CONFLICT silently dropping the second insert).

ALTER TABLE engagement_gates ADD COLUMN allow_repeat INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS uq_gate_deliveries_gate_follower;
