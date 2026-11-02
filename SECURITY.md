# Security Policy

## Supported versions

Jobgoblin is in developer preview and has no released versions yet. Security fixes land on `main` only.

## Reporting a vulnerability

**Do not open a public issue or pull request for a security problem.**

Report it privately instead:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability**. This uses GitHub's private vulnerability reporting.

Include:

- What you found and why it matters.
- Steps to reproduce it, and the commit or branch you tested.
- What an attacker could do with it.
- Whether you have shared it anywhere else.

Do not put real personal data in a report. Use the fake person in `fixtures/` instead.

## What to expect

Jobgoblin is maintained by volunteers, so responses are best effort. The maintainer aims to:

- Acknowledge your report within 7 days.
- Share a status update after triage.
- Credit you in the fix, unless you ask not to be named.

## Scope

These are in scope, because they break the product's promises:

- Data leaving the person's computer, or the local server being reachable from another machine. The server is meant to bind to `127.0.0.1` only.
- Access to the session token or a run token by anything other than the person or the run it belongs to.
- A run changing an application, or submitting one, without the person's approval.
- Resume content that cannot be traced to a story the person confirmed.
- Reading or writing files outside the folders the app is meant to use.

These are out of scope:

- Problems in third-party services, such as Claude Code or job boards.
- Social engineering or physical attacks.
- Automated scanner output without a working proof of concept.
