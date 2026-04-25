-- 24h-window drip: after the reward DM is delivered, optionally send
-- follow-up DMs at staggered delays to keep the user engaged inside the
-- Meta 24-hour messaging window. The sequence is stored as a JSON array
-- on the gate row so we don't need a separate table for the small number
-- of steps (≤ 3). Example:
--   [
--     {"delay_minutes": 30, "text": "読んでくれた？", "button_label": null},
--     {"delay_minutes": 180, "text": "質問あれば気軽にDMして！"}
--   ]
ALTER TABLE engagement_gates ADD COLUMN followup_dm_sequence TEXT;

-- Per-delivery progress tracker: how many follow-up steps have fired for
-- this delivery (0 = none yet), and when the next one is due.
ALTER TABLE gate_deliveries ADD COLUMN followup_step_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gate_deliveries ADD COLUMN next_followup_at TEXT;

CREATE INDEX IF NOT EXISTS idx_gate_deliveries_next_followup
  ON gate_deliveries(next_followup_at)
  WHERE next_followup_at IS NOT NULL;
