# @ayali/node-red-contrib-jev

Simple Node-RED integration to TypeSafe AI's runtime Jev model.

Jev is a *System One* model: it does not generate text. You give it a **state** and a
list of named **questions**, and it returns one typed answer per question with
probabilities attached. Answers come back in tens of milliseconds for a fraction of
the cost of an LLM call, which makes it practical to ask a question of every event in
a flow rather than only the interesting ones.

Every question in a request is evaluated in parallel against the same state, so asking
five costs barely more than asking one.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Nodes](#nodes)
- [Questions](#questions)
- [Outputs](#outputs)
- [Examples](#examples)
- [Dynamic questions](#dynamic-questions)
- [Errors and status](#errors-and-status)

## Install

From **Manage palette → Install**, search for `jev`. Or from the command line:

```bash
cd ~/.node-red
npm install @ayali/node-red-contrib-jev
```

Docker, where `/data` is the user directory:

```bash
docker exec -w /data <container> npm install @ayali/node-red-contrib-jev
docker restart <container>
```

Requires Node.js 18 or later (the node uses the built-in `fetch`) and Node-RED 3.1+.
You will need an API key from [TypeSafe](https://typesafe.ai).

## Quick start

1. Drag a **jev** node onto the canvas and open it.
2. Beside **Server**, click the pencil and add your API key. The key is stored as a
   Node-RED credential, so it stays out of your flow exports.
3. Leave **State** as `msg.payload`.
4. In **Questions**, name the first row `urgent`, leave the type as *yes / no*, and
   write an instruction: `Does this message need attention today?`
5. Wire an inject node with some string payload into it, and a debug node set to
   *complete msg object* on the output.
6. Deploy and inject. `msg.answers.urgent.noul` is a probability between 0 and 1.

## Nodes

**jev-config** holds the endpoint, the model name and the API key. Point **Base URL**
at a gateway (LiteLLM, Vercel AI Gateway, Opper) if you proxy model traffic; the node
appends `/v1/systemone`.

**jev** evaluates a state against the questions you define, with either one output
carrying every answer or one output per question.

## Questions

Questions are edited as a list in the node's dialog — one row each, with a name, a
type, an instruction, and the criteria fields for that type. The name is the key the
answer comes back under.

| type | criteria you fill in | answer fields |
|---|---|---|
| yes / no (`noul`) | optional description of what true and false mean | `noul` — a probability from 0 to 1 |
| choice | option name, and when it applies | `choice`, `probabilities`, `confidence` |
| score | ordered levels, lowest first | `score` (weighted), `legend`, `probabilities`, `confidence` |

Criteria are optional on a yes/no question but worth writing — they are the cheapest
accuracy you will buy. A choice option with no description is sent as `null`, which is
fine when the name says enough.

Problems the API would reject — an empty instruction, a choice with no options, a
score with fewer than two levels — are caught at deploy time and shown on the node
status rather than costing a request.

## Outputs

**One output** sets two properties:

```js
msg.jev     = { model: "jev-latest",
                usage: { input_tokens: 312, output_tokens: 48 },
                latency_ms: 180 }

msg.answers = { needs_action: { type: "noul", noul: 0.93 },
                category:     { type: "choice",
                                choice: "schedule",
                                probabilities: { schedule: 0.88, logistics: 0.07,
                                                 social: 0.03, urgent: 0.02 },
                                confidence: 0.85 } }
```

**One output per question** emits a copy of the message on each output, in the order
the questions are listed, and sets three:

```js
msg.jev      = { model, usage, latency_ms }
msg.question = "needs_action"
msg.answer   = { type: "noul", noul: 0.93 }
```

There is no answers map on the branches, so a branch cannot read another question's
result by accident. All four property names are configurable in the dialog if they
collide with something else in your flows.

The node deliberately does not apply thresholds itself. Put a Switch node on each
branch to turn a probability into a decision, so every decision boundary stays visible
on the canvas rather than buried in an edit dialog.

## Examples

Two worked flows ship with the node, under **Import → Examples → @ayali/node-red-contrib-jev**.
Each one runs from an inject node carrying a sample payload, so both can be deployed
and run as they are once a key is set on the config node.

### Camera event triage

![Camera event triage flow](https://raw.githubusercontent.com/ayali/node-red-contrib-jev/main/docs/example-frigate-triage.png)

A security camera event — the camera, what was detected, the zone, the time, whether
anything similar fired recently — is evaluated by two questions in a single request,
each answer arriving on its own output.

The first question is a yes/no: is this worth interrupting someone for. Its branch
feeds a Switch node that splits on a confidence band rather than a single cutoff — at
or above 0.8 a notification is warranted, at or below 0.2 it is routine, and the
middle goes to a third branch instead of being forced either way. The second question
is a choice that labels what triggered the event, and is handled independently.

It shows the shape most flows end up with: one question that drives an action, another
that adds context, and the threshold living in a Switch node on the canvas where it can
be seen and changed.

<details>
<summary>Flow JSON</summary>

```json
[{"id":"jevex1tab","type":"tab","label":"Jev \u2014 Frigate triage","disabled":false,"info":"Evaluates a camera event with two questions in one request, and gives each answer its own output.\n\nThe yes/no answer feeds a Switch node that splits on a confidence band rather than a single cutoff, so an uncertain answer lands on its own branch instead of being forced either way."},{"id":"jevex1cfg","type":"jev-config","name":"TypeSafe","baseUrl":"https://api.typesafe.ai","model":"jev-latest"},{"id":"jevex1inject","type":"inject","z":"jevex1tab","name":"sample event","props":[{"p":"payload"}],"repeat":"","crontab":"","once":false,"topic":"","payload":"{\"camera\":\"front_gate\",\"label\":\"person\",\"score\":0.81,\"zones\":[\"driveway\"],\"local_time\":\"02:14\",\"stationary\":false,\"recent_similar_events\":0}","payloadType":"json","x":150,"y":140,"wires":[["jevex1jev"]]},{"id":"jevex1jev","type":"jev","z":"jevex1tab","name":"triage event","server":"jevex1cfg","mode":"split","state":"payload","stateType":"msg","questions":[{"key":"notify","type":"noul","instructions":"Should this camera event interrupt someone in the house right now?","trueDesc":"A person or vehicle somewhere or at a time that warrants attention, e.g. an unrecognised person at the gate at night","falseDesc":"Routine or expected: a known car in the driveway, an animal, foliage or rain, a repeat of an event already seen"},{"key":"subject","type":"choice","instructions":"What triggered this event?","options":[{"name":"person","desc":""},{"name":"vehicle","desc":""},{"name":"animal","desc":""},{"name":"other","desc":"Foliage, shadows, rain, or an unclear detection"}]}],"timeout":15000,"retries":2,"outputs":2,"x":350,"y":140,"wires":[["jevex1sw"],["jevex1subject"]],"metadataProp":"jev","questionProp":"question","answerProp":"answer","responseProp":"answers"},{"id":"jevex1sw","type":"switch","z":"jevex1tab","name":"p >= 0.8 ?","property":"answer.noul","propertyType":"msg","rules":[{"t":"gte","v":"0.8","vt":"num"},{"t":"lte","v":"0.2","vt":"num"},{"t":"else"}],"checkall":"false","outputs":3,"x":540,"y":100,"wires":[["jevex1push"],["jevex1log"],["jevex1review"]]},{"id":"jevex1push","type":"debug","z":"jevex1tab","name":"push notification","active":true,"complete":"answer","targetType":"msg","x":760,"y":60,"wires":[]},{"id":"jevex1log","type":"debug","z":"jevex1tab","name":"log only","active":true,"complete":"answer","targetType":"msg","x":740,"y":100,"wires":[]},{"id":"jevex1review","type":"debug","z":"jevex1tab","name":"uncertain \u2192 review","active":true,"complete":"answer","targetType":"msg","x":770,"y":140,"wires":[]},{"id":"jevex1subject","type":"debug","z":"jevex1tab","name":"subject label","active":true,"complete":"answer","targetType":"msg","x":560,"y":200,"wires":[]}]
```

</details>

### Prefilter in front of a larger model

![LLM prefilter flow](https://raw.githubusercontent.com/ayali/node-red-contrib-jev/main/docs/example-llm-prefilter.png)

An inbound message is triaged by three questions of different types at once — a yes/no
for whether it needs action, a choice for what it is about, and a score for how soon.
All three answers come back together on `msg.answers`, and a Switch node reads one of
them to decide whether the message is worth passing to a more expensive model.

This is the cascade pattern: a cheap, calibrated pass runs on everything, and only the
minority that need prose reach a model that charges like one. It also shows the value
of asking several questions in one request — the extra two cost almost nothing, and the
labels they produce are useful further down the flow.

<details>
<summary>Flow JSON</summary>

```json
[{"id":"jevex2tab","type":"tab","label":"Jev \u2014 LLM prefilter","disabled":false,"info":"Triages a message with three questions of different types in a single request.\n\nAll the answers arrive together on msg.answers, and a Switch node reads one of them to decide whether the message is worth passing to a more expensive model."},{"id":"jevex2cfg","type":"jev-config","name":"TypeSafe","baseUrl":"https://api.typesafe.ai","model":"jev-latest"},{"id":"jevex2inject","type":"inject","z":"jevex2tab","name":"sample message","props":[{"p":"payload"}],"repeat":"","crontab":"","once":false,"topic":"","payload":"Reminder: tomorrow is a short day, pickup at 12:30 instead of 14:00. Please send a note if someone else is collecting.","payloadType":"str","x":160,"y":120,"wires":[["jevex2jev"]]},{"id":"jevex2jev","type":"jev","z":"jevex2tab","name":"triage","server":"jevex2cfg","mode":"single","state":"payload","stateType":"msg","questions":[{"key":"needs_action","type":"noul","instructions":"Does this message require a parent to do something?","trueDesc":"Asks for a reply, a signature, money, an item to bring, or a change to pickup or schedule","falseDesc":"Social chatter, thanks, photos, or information needing no response"},{"key":"category","type":"choice","instructions":"What is this message about?","options":[{"name":"schedule","desc":"Times, dates, pickup, cancellations"},{"name":"logistics","desc":"Items to bring, forms, payments"},{"name":"social","desc":"Chatter, congratulations, photos"},{"name":"urgent","desc":"Safety, illness, or something happening today"}]},{"key":"time_pressure","type":"score","instructions":"How soon must this be acted on?","levels":["Whenever","This week","Today"]}],"timeout":15000,"retries":2,"outputs":1,"x":350,"y":120,"wires":[["jevex2switch"]],"metadataProp":"jev","questionProp":"question","answerProp":"answer","responseProp":"answers"},{"id":"jevex2switch","type":"switch","z":"jevex2tab","name":"act?","property":"answers.needs_action.noul","propertyType":"msg","rules":[{"t":"gte","v":"0.6","vt":"num"},{"t":"else"}],"checkall":"false","outputs":2,"x":510,"y":120,"wires":[["jevex2llm"],["jevex2drop"]]},{"id":"jevex2llm","type":"debug","z":"jevex2tab","name":"\u2192 LLM summariser","active":true,"complete":"true","targetType":"msg","x":710,"y":90,"wires":[]},{"id":"jevex2drop","type":"debug","z":"jevex2tab","name":"\u2192 digest only","active":true,"complete":"true","targetType":"msg","x":700,"y":150,"wires":[]}]
```

</details>

## Dynamic questions

`msg.questions` overrides the configured list, and `msg.model` overrides the configured
model. The override takes the API's own shape — an object keyed by question name:

```js
msg.questions = {
  urgent: {
    type: "noul",
    instructions: "Does this need attention today?",
    criteria: { "true": "...", "false": "..." }
  }
};
```

This lets you build criteria upstream in a Change node with JSONata and keep the jev
node generic. In one-output-per-question mode the outputs stay bound to the configured
question names, so an override can rephrase a question but cannot add an output.

## Errors and status

Failures are raised to the node and can be handled with a Catch node. HTTP 429 and 529
responses are retried with exponential backoff, honouring `Retry-After` when the API
sends one; **Timeout** and **Retries** are configurable in the dialog.

The node status shows the answers and the round-trip time after a successful call, and
the first problem otherwise.

## Links

- [TypeSafe API reference](https://docs.typesafe.ai/api)
- [Issues](https://github.com/ayali/node-red-contrib-jev/issues)

## License

MIT
