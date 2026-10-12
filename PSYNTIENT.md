# This is a fork. Read this before the README.

**The `README.md` in this repository is upstream OpenClaw's** — upstream's banner,
upstream's CI badges, upstream's project. It is not about Psyntient and it is not
about this fork.

**The branch you want is `psyntient`.** It is not the default branch; the default is
`main`, which tracks upstream. Anything landing here without switching branches will
read this as upstream's project and conclude the fork does not exist.

```bash
git clone -b psyntient https://github.com/psyntient/Open-Claw-Forked.git
```

---

## What this fork is for

It is the engine behind **two** Psyntient surfaces, from one build:

| surface | what it is | where the build ends up |
|---|---|---|
| **Psyntient Node** | the researcher's local instrument — the Vault, the dashboard, the Archive viewer, running on their own machine | installed by [Psyntient-Installer](https://github.com/psyntient/Psyntient-Installer) |
| **Psyntient Cloud** | the same gateway on a per-researcher droplet, with Cortex as the agent | baked into the golden image; see [psyntient-cloud](https://github.com/psyntient/psyntient-cloud) |

Upstream OpenClaw is a general assistant. This fork makes it a research instrument
pointed at the Noetic Archive, so most of the diff is surface: things a researcher
sees and acts through.

---

## What the fork changes

Roughly in order of size:

- **The Vault.** The researcher's local file area: watch-directories with
  import-and-delete and mirror options, in-app preview for images and text,
  per-file and per-project Sync-to-Archive, and a real elevation system behind it
  all. None of this exists upstream.
- **The Archive viewer.** Browsing the taxonomy inside the app: archetype family
  trees, evidence lists, per-packet detail, Edition figures, and a
  recently-browsed history strip.
- **The Psyntient interface plugin.** Gateway routes the dashboard calls for
  projects, deposits and onboarding state. The plugin is given the gateway rather
  than a route table, so it can answer questions about the instance itself.
- **Brand and chrome.** The brain mark rather than upstream's flower, the
  Psyntient palette, the elf, and the chat surface: tool-call rows off by default,
  developer-shaped failures replaced with one plain line, and an animated Architect
  in the turn-recap row.
- **Cloud-specific corrections.** Several bugs that only appear when the app is
  served under a path prefix rather than at an origin root — plugin routes, asset
  paths, the elf's frames and in-app navigation were all origin-absolute, so
  selecting a project left the app entirely.

---

## Two rules that will cost you an evening

**1. The gateway refuses a control UI whose build id is not its own.** The UI is
served from the Archive; the gateway runs on the researcher's machine. Ship one
without the other and you get a dashboard that loads fully and then silently never
opens its socket — which reads as a broken agent rather than a half-finished deploy.
`The-Repo/tools/update-fleet.py` refuses an engine update that does not come with
`--control-ui` and `--ref` from the same build.

**2. The brand is an overlay, not a fork of the brand.** Re-run `apply-brand.sh`
after every upstream merge or the Psyntient styling is simply gone. The overlay
exists so upstream updates stay mergeable; the cost is that it has to be reapplied.

---

## Building it

**A 2 GB droplet cannot build OpenClaw.** That is why
[`ship-fork.sh`](https://github.com/psyntient/psyntient-cloud/blob/main/ship-fork.sh)
exists in the Cloud repo: it builds on a larger box and installs the result on an
instance. For Cloud, the build is then baked into a golden image rather than
installed per tenant — see the Cloud map.

---

## The other two OpenClaw repositories, so you do not confuse them

| repo | what it is |
|---|---|
| **this one** (`Open-Claw-Forked`, branch `psyntient`) | the fork we run |
| [`openclaw-mirror`](https://github.com/psyntient/openclaw-mirror) | an unmodified pinned-commit backup of `openclaw/openclaw`, kept so an upstream disappearance is survivable. Do not develop here |
| `OpenClaw-Fork` | **superseded and empty.** An earlier attempt, no branches, no content. Ignore it |

---

## Do not push to `main`

`main` tracks upstream. Psyntient work goes on `psyntient`. If you need upstream's
changes, merge upstream into `psyntient` and reapply the brand overlay.
