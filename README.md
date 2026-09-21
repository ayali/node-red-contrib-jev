# @ayali/node-red-contrib-jev

Typed, calibrated decisions in Node-RED, backed by TypeSafe's Jev model.

Jev does not generate text. You give it a **state** and a map of named **questions**,
and it returns one answer per question with probabilities attached. Every question in
a request is evaluated in parallel, so asking five costs barely more than asking one.

Two nodes:

- **jev-config** — endpoint, model, API key (stored as a Node-RED credential).
- **jev** — evaluates a state against a list of typed questions, with one output for everything or one output per question.

## Install

Once published, from **Manage palette → Install**, or:

```bash
cd ~/.node-red
npm install @ayali/node-red-contrib-jev
```

For a Docker install, `/data` is the user directory:

```bash
npm pack                                          # → ayali-node-red-contrib-jev-1.0.0.tgz
docker cp ayali-node-red-contrib-jev-1.0.0.tgz nodered:/data/
docker exec -w /data nodered npm install ./ayali-node-red-contrib-jev-1.0.0.tgz
docker restart nodered
```

Requires Node.js 18+ (uses the built-in `fetch`) and Node-RED 3.1+.
Import the flows under **Import → Examples → @ayali/node-red-contrib-jev**.

## Questions

Questions are edited as a list in the node's edit dialog — one row each, with a
name, a type, the instruction, and the criteria fields for that type. The name you
give a row is the key its answer comes back under.

| type | criteria you fill in | answer |
|---|---|---|
| yes / no (`noul`) | optional description of what true and false mean | `noul`, a probability 0–1 |
| choice | option name + when it applies | `choice`, `probabilities`, `confidence` |
| score | ordered levels, lowest first | weighted `score`, `legend`, `probabilities`, `confidence` |

Problems the API would reject — an empty instruction, a choice with no options, a
score with fewer than two levels — are caught at deploy and shown on the node status
rather than costing a request.

## Outputs

**One output** sets two properties:

```js
msg.jev      = { model: "jev-latest",
                 usage: { input_tokens: 312, output_tokens: 48 },
                 latency_ms: 180 }

msg.answers  = { needs_action: { type: "noul", noul: 0.93 },
                 category:     { type: "choice", choice: "schedule",
                                 probabilities: { ... }, confidence: 0.85 } }
```

**One output per question** emits a copy of the message on each output, in list
order, and sets three:

```js
msg.jev      = { model, usage, latency_ms }
msg.question = "needs_action"
msg.answer   = { type: "noul", noul: 0.93 }
```

No answers map on the branches — a branch cannot read another question's result by
accident. All four names are configurable in the edit dialog if they collide with
something else in your flows.

Put a Switch node on each branch to turn a probability into a decision; the node
deliberately does not apply thresholds itself, so every decision boundary stays
visible on the canvas rather than buried in an edit dialog.

## Dynamic questions

`msg.questions` (API-shaped object) overrides the configured list, and `msg.model`
overrides the configured model. In split mode the outputs stay bound to the
configured question names, so an override can rephrase a question but cannot add an
output.

## Without installing anything

If you would rather not add a package, one Function node does the basic job:

```javascript
const res = await fetch("https://api.typesafe.ai/v1/systemone", {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + env.get("TYPESAFE_API_KEY"),
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "jev-latest",
    state: msg.payload,
    questions: {
      notify: { type: "noul", instructions: "Should this interrupt someone right now?" }
    }
  })
});
if (!res.ok) { node.error("jev " + res.status, msg); return null; }
msg.jev = await res.json();
return msg;
```

You lose the credential store, retries, status text, and the routing outputs, but
it is a fine way to find out whether the answers are any good on your data before
committing to the node.

## Before you trust it

- **Calibration is the whole product, so check it.** Log `msg.jev` on real traffic for
  a week before anything acts on it. Pull the probabilities into a sheet and look at
  whether events scored 0.8 actually happen about 80% of the time. If they do not,
  the model is not calibrated on your domain and the threshold is guesswork.
- **Published accuracy figures are vendor numbers on vendor-chosen tasks.** TypeSafe's
  own evaluation puts Jev roughly level with a mid-tier LLM and behind the frontier
  models, at a fraction of the cost. It is a cheap first pass, not a replacement.
- **Set thresholds from your own labelled examples.** The defaults here are round
  numbers, not findings.
- **Watch the failure mode.** An outbound call sits between a sensor and an actuator
  now. Wire a Catch node to every Jev node and decide explicitly what happens when the
  API is slow or down — for home automation, failing to the safe branch generally
  beats failing to the quiet one.

## API reference

<https://docs.typesafe.ai/api>

## Publishing

The Flow Library stopped auto-indexing npm in April 2020, so listing is a manual
submission. Order matters: npm first, library second.

1. **Name it under your npm scope.** Packages first published after 31 January 2022
   must use a scoped name. `@yourname/node-red-jev` is fine; a bare
   `node-red-contrib-jev` will be rejected.
2. **Required in `package.json`:** a `node-red` section listing the node files, and
   `"node-red"` in `keywords`. Plus a `README.md` describing what the node does, and
   a `LICENSE` file. The `examples/` folder must sit in the package root.
3. **Hold the keyword until it's ready.** The docs ask you not to add the `node-red`
   keyword until the node is stable, working, and documented well enough for someone
   else to use. It is already in this `package.json` — take it out if you are
   publishing a first version to test the mechanics.
4. **Publish.**
   ```bash
   npm pack --dry-run          # check the file list before it is permanent
   npm login
   npm publish                 # publishConfig.access is already set to public
   ```
   Scoped packages default to private, which fails without a paid account — hence
   `publishConfig`.
5. **Submit to the library.** Sign in at <https://flows.nodered.org> with GitHub,
   then the `+` button → *node*, or go straight to <https://flows.nodered.org/add/node>.
   Later releases either get resubmitted the same way or refreshed from the node's
   own library page via the *request refresh* link, visible when signed in.

The library scores packages against a scorecard, so before submitting: fill in
`repository`, `homepage` and `bugs` (they are placeholders right now), tag a matching
GitHub release, and make sure the node's help text renders properly in the info tab.

### Version bumps

`npm version patch|minor|major` then `npm publish`. The Flow Library will not pick up
the new version on its own — request a refresh.
