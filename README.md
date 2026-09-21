# @ayali/node-red-contrib-jev

Typed, calibrated decisions in Node-RED, backed by TypeSafe's Jev model.

Jev does not generate text. You give it a **state** and a map of named **questions**,
and it returns one answer per question with probabilities attached. Every question in
a request is evaluated in parallel, so asking five costs barely more than asking one.

Two nodes:

- **jev-config** — endpoint, model, API key (stored as a Node-RED credential).
- **jev** — evaluates a state against a list of typed questions, with one output for everything or one output per question.

## Install

From **Manage palette → Install**, search for `jev`. Or from the command line:

```bash
cd ~/.node-red
npm install @ayali/node-red-contrib-jev
```

For a Docker install, `/data` is the user directory:

```bash
docker exec -w /data nodered npm install @ayali/node-red-contrib-jev
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

## API reference

<https://docs.typesafe.ai/api>

## Contributing

Issues and pull requests: <https://github.com/ayali/node-red-contrib-jev>

## License

MIT
