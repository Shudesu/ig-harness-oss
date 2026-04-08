-- Drop LINE Harness fork residue with no IG analog or backing route
-- IG Harness was largely cleaned at fork time; only outgoing_webhooks
-- and its webhook_logs join table remained.

DROP TABLE IF EXISTS webhook_logs;
DROP TABLE IF EXISTS outgoing_webhooks;
