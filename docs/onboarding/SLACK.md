# SplitIQ Slack workspace

Day-to-day conversation between you and Scott happens in the SplitIQ Slack workspace.
**GitHub is the source of truth.** Issues, pull requests and Discussions are the lasting
record. Slack is for talk, so anything that has to last goes on GitHub.

## Channels

| Channel | Purpose |
|---|---|
| `#announcements` | Releases, milestones and housekeeping. Only admins post; chat goes in `#build`. (Renamed from `#all-splitiq`.) |
| `#build` | Day-to-day development talk between you and Scott. |
| `#prototypes` | One thread per GitHub Discussion prototype. Post the Discussion link plus a one-liner; feedback stays in that thread. |
| `#decisions` | One post per decision: what, why and a link. No discussion in the post itself; use a thread or `#build`. |
| `#bugs` | Quick bug reports. Each one becomes a GitHub issue, and the issue link goes back in the thread. |
| `#github-feed` | Bot feed, no chat. The GitHub Slack app posts issues, pull requests, reviews and Discussions for `skizzy1986/SplitIQ`. Slack reserves the name `#github`. |
| `#social` | Casual. |
| `#vitals-feed` | Private. Pass/fail notices from the vitals sync job only; no health data is posted to Slack. |

There is no Vercel channel, by Scott's choice.

## Posting a decision

One post in `#decisions`, in this shape:

```
What: <the decision, in one sentence>
Why: <the reason>
Link: <the issue, pull request or Discussion>
```

## How a prototype gets in

1. Post the idea or prototype as a GitHub Discussion: **Ideas** for a rough idea, **Show
   and tell** once there is something to see.
2. Start a thread in `#prototypes` with the Discussion link and a one-liner. Keep
   feedback in that thread.
3. When Scott accepts it, he builds it into SplitIQ through his gated `/orchestrate`
   pull-request chain (his own build-and-review steps). You don't push to
   `skizzy1986/SplitIQ` yourself.
4. Log any decision that came out of it in `#decisions`.

A Slack message doesn't change what you may do with the code; that is set in
[`PERMISSIONS.md`](../../PERMISSIONS.md).

## How a bug gets logged

1. Report it in `#bugs`: what you saw, how to repeat it, and what you expected.
2. It is filed as a GitHub issue with the **Bug** form. The title is the symptom in a
   plain sentence, with no `fix:` prefix.
3. The issue link goes back in the Slack thread.
