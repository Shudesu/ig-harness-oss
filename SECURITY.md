# Security policy

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/Shudesu/ig-harness-oss/security/advisories/new). Do not put access tokens, API keys, customer messages, database exports, or exploit details in public issues.

Include the affected commit/version, a minimal reproduction using synthetic data, impact, and any proposed fix. Remove all credentials and personal data. Maintainers must enable private vulnerability reporting before publishing a release; if the private form is unavailable, contact the maintainer through the contact information on [their profile](https://github.com/Shudesu) without disclosing exploit details publicly.

The latest tagged release is the supported line. Older self-hosted versions should upgrade after a database backup and migration review. No response deadline is promised. Dependency updates are proposed weekly by Dependabot and require the same tests and review as other changes.

For a suspected token leak, revoke the affected token with its provider and replace it through the supported credential-update path. Do not rotate a database encryption key without a tested re-encryption plan and a recoverable backup.
