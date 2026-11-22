# SplitIQ Slack workspace

Day-to-day conversation between Scott and Paul lives in the SplitIQ Slack workspace. **GitHub is the source of truth.** Issues, pull requests and Discussions are the durable record; Slack is for talk, not for decisions that must outlast the free plan's 90-day message window.

## Channels

| Channel | Purpose |
|---|---|
| `#announcements` | Releases, milestones and housekeeping. Renamed from `#all-splitiq`. Only admins post; chat goes in `#build`. |
| `#build` | Day-to-day development talk between Scott and Paul. |
| `#prototypes` | One thread per GitHub Discussion prototype. Post the Discussion link plus a one-liner; feedback stays in that thread. |
| `#decisions` | One post per decision. No discussion in the post itself; use a thread or `#build`. |
| `#bugs` | Quick bug reports. Each one becomes a GitHub issue, and the issue link goes back in the thread. |
| `#github-feed` | Bot feed only, no chat. The GitHub Slack app is subscribed to issues, pull requests, reviews and Discussions for `skizzy1986/SplitIQ`. Slack reserved the name `#github`, so this channel is named `#github-feed`. |
| `#social` | Casual. |
| `#vitals-feed` | Private channel for health-sync alerts. |

There is no Vercel channel, by Scott's choice.

## Decisions template

Post once in `#decisions`, in this shape:

```
Decision: <the call, in one sentence>
Why: <the reason>
Link: <the issue, PR, Discussion or Gate note>
```

## How a prototype flows in

1. Post the idea or prototype as a GitHub Discussion (Ideas, or Show and tell once there is something to see).
2. Open a thread in `#prototypes` with that link and a one-liner. Keep feedback in the thread.
3. When Scott accepts it, it enters his gated `/orchestrate` pull-request chain. Paul does not push to `skizzy1986/SplitIQ`.
4. Log any decision that came out of it in `#decisions`. The durable record stays on GitHub.

Draft [#670](https://github.com/skizzy1986/SplitIQ/pull/670) covers contribution terms and is on hold until a first agreed prototype exists. Do not treat Slack as a substitute for that grant.

## How a bug is logged

1. Report it in `#bugs` (what you saw, how to repeat it, what you expected).
2. File a GitHub issue from that report, using the bug template: a plain-sentence title, no `fix:` prefix.
3. Paste the issue link back into the Slack thread.
