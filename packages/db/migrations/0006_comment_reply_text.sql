-- Public comment reply: when a comment_on_post gate fires, we can now also
-- post a reply to the user's comment (visible to everyone on the post) in
-- addition to sending the DM. Empty / NULL = DM only (existing behavior).
-- Supports {{username}} placeholder for the commenter's handle.

ALTER TABLE engagement_gates ADD COLUMN comment_reply_text TEXT;
