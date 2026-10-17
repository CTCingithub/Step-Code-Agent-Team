---
description: Run a parallel multi-member code review of the given target
---

Use the team tools to review $@ with a parallel team, then merge the findings into one report.

Execute this workflow:

1. Use team_create_member to create three reviewers with the "reviewer" role, named r1, r2, r3. Give each a distinct focus in its systemPrompt:
   - r1: correctness — logic, edge cases, error handling
   - r2: style — naming, duplication, dead code, readability
   - r3: security — injection, secrets, unsafe shell usage, path traversal
2. Use team_send to send each reviewer the target ($@) with instructions to review only its focus area. Send all three before waiting on results where possible by issuing the calls together.
3. Use team_task to create a merge task T1 with no dependencies, then dispatch it to a "worker" member (create one if needed) instructing it to deduplicate the three reviews, resolve contradictions, and produce a single report with a verdict per finding.
4. Return the merged report to the user, noting which reviewer found each finding.

Rules:
- Reviewers must not modify anything; only the worker writes the merged report.
- If a reviewer fails, retry once, then continue with the remaining reviewers and note the gap.
- Finish with team_disband to stop all member processes.
