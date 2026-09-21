module.exports = function (RED) {
  "use strict";

  const DEFAULT_BASE_URL = "https://api.typesafe.ai";
  const EVAL_PATH = "/v1/systemone";

  // ---------------------------------------------------------------- config --

  function JevConfigNode(config) {
    RED.nodes.createNode(this, config);
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = config.model || "jev-latest";
  }

  RED.nodes.registerType("jev-config", JevConfigNode, {
    credentials: {
      apiKey: { type: "password" }
    }
  });

  // ---------------------------------------------------------- question spec --

  // The editor stores questions as an ordered array of rows, which keeps the
  // UI simple and the output order stable. The API wants a keyed object, so
  // compile one into the other here. A plain object (msg.questions, or a
  // pre-0.2 config) is already in API shape and passes through untouched.
  function compileQuestions(spec) {
    if (!Array.isArray(spec)) {
      const questions = spec && typeof spec === "object" ? spec : {};
      return { questions: questions, keys: Object.keys(questions) };
    }

    const questions = {};
    const keys = [];

    spec.forEach(function (row) {
      const key = String(row.key || "").trim();
      if (!key || questions[key]) return;

      const q = {
        type: row.type,
        instructions: String(row.instructions || "").trim()
      };

      if (row.type === "noul") {
        const t = String(row.trueDesc || "").trim();
        const f = String(row.falseDesc || "").trim();
        if (t || f) {
          q.criteria = {};
          if (t) q.criteria["true"] = t;
          if (f) q.criteria["false"] = f;
        }
      } else if (row.type === "choice") {
        q.criteria = {};
        (row.options || []).forEach(function (opt) {
          const name = String(opt.name || "").trim();
          if (!name) return;
          const desc = String(opt.desc || "").trim();
          q.criteria[name] = desc || null;
        });
      } else if (row.type === "score") {
        q.criteria = (row.levels || [])
          .map(function (l) { return String(typeof l === "string" ? l : l.text || "").trim(); })
          .filter(Boolean);
      }

      questions[key] = q;
      keys.push(key);
    });

    return { questions: questions, keys: keys };
  }

  // Catches the mistakes the API would reject, before spending a request.
  function validateQuestions(questions) {
    const problems = [];
    const keys = Object.keys(questions);

    if (!keys.length) problems.push("no questions defined");

    keys.forEach(function (k) {
      const q = questions[k];
      if (!q || typeof q !== "object") {
        problems.push(k + ": not an object");
        return;
      }
      if (["noul", "choice", "score"].indexOf(q.type) < 0) {
        problems.push(k + ": unknown type " + q.type);
      }
      if (!q.instructions) {
        problems.push(k + ": instructions are empty");
      }
      if (q.type === "choice" && (!q.criteria || !Object.keys(q.criteria).length)) {
        problems.push(k + ": a choice needs at least one option");
      }
      if (q.type === "score" && (!Array.isArray(q.criteria) || q.criteria.length < 2)) {
        problems.push(k + ": a score needs at least two levels");
      }
    });

    return problems;
  }

  // ----------------------------------------------------------------- http --

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function backoff(attempt) {
    return Math.min(8000, 400 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
  }

  async function evaluate(server, body, opts) {
    const url = server.baseUrl + EVAL_PATH;
    let attempt = 0;

    for (;;) {
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + server.credentials.apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeout)
        });
      } catch (err) {
        if (attempt < opts.retries) {
          await sleep(backoff(attempt++));
          continue;
        }
        throw new Error("request failed: " + err.message);
      }

      if ((res.status === 429 || res.status === 529) && attempt < opts.retries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
        attempt++;
        continue;
      }

      const text = await res.text();

      if (!res.ok) {
        let detail = text;
        try { detail = JSON.stringify(JSON.parse(text)); } catch (_) { /* raw */ }
        const err = new Error("HTTP " + res.status + (detail ? " " + detail : ""));
        err.statusCode = res.status;
        throw err;
      }

      try {
        return JSON.parse(text);
      } catch (err) {
        throw new Error("unparseable response body: " + err.message);
      }
    }
  }

  // ------------------------------------------------------------- formatting --

  function fmtAnswer(a) {
    if (!a) return "—";
    if (a.type === "noul") return a.noul.toFixed(2);
    if (a.type === "choice") return a.choice + " @" + (a.confidence || 0).toFixed(2);
    if (a.type === "score") return a.score.toFixed(2) + " @" + (a.confidence || 0).toFixed(2);
    return String(a.type);
  }

  function summarise(answers, keys) {
    if (!keys.length) return "no answers";
    return keys
      .slice(0, 3)
      .map(function (k) { return k + " " + fmtAnswer(answers[k]); })
      .join(" · ") + (keys.length > 3 ? " +" + (keys.length - 3) : "");
  }

  // ------------------------------------------------------------------ node --

  function JevNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const server = RED.nodes.getNode(config.server);

    node.mode = config.mode || "single";
    node.answerProp = (config.answerProp || "answer").replace(/^msg\./, "");
    node.outputProp = (config.outputProp || "jev").replace(/^msg\./, "");
    node.outputs = parseInt(config.outputs, 10) || 1;

    node.timeout = parseInt(config.timeout, 10) || 15000;
    node.retries = parseInt(config.retries, 10);
    if (!Number.isFinite(node.retries)) node.retries = 2;

    // Compiled once at deploy: the outputs are wired to these keys, in order.
    let configured;
    try {
      const raw = typeof config.questions === "string"
        ? JSON.parse(config.questions || "{}")
        : config.questions;
      configured = compileQuestions(raw);
    } catch (err) {
      configured = { questions: {}, keys: [] };
      node.error("questions could not be read: " + err.message);
    }

    const problems = validateQuestions(configured.questions);
    if (problems.length) {
      node.status({ fill: "red", shape: "ring", text: problems[0] });
      node.error("invalid questions — " + problems.join("; "));
    }

    function resolveState(msg) {
      return new Promise((resolve, reject) => {
        RED.util.evaluateNodeProperty(
          config.state,
          config.stateType || "msg",
          node,
          msg,
          (err, value) => (err ? reject(err) : resolve(value))
        );
      });
    }

    node.on("input", async function (msg, send, done) {
      send = send || node.send.bind(node);
      done = done || ((err) => { if (err) node.error(err, msg); });

      if (!server || !server.credentials || !server.credentials.apiKey) {
        node.status({ fill: "red", shape: "ring", text: "no API key" });
        return done(new Error("no TypeSafe server configured, or API key missing"));
      }

      // msg.questions overrides the configured set. In split mode the outputs
      // stay bound to the configured keys, so an override there can only
      // rephrase existing questions, not add outputs.
      let active = configured;
      if (msg.questions) {
        active = compileQuestions(msg.questions);
      }

      const issues = validateQuestions(active.questions);
      if (issues.length) {
        node.status({ fill: "red", shape: "ring", text: issues[0] });
        return done(new Error("invalid questions — " + issues.join("; ")));
      }

      let state;
      try {
        state = await resolveState(msg);
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: "bad state" });
        return done(err);
      }

      if (state === undefined || state === null || state === "") {
        node.status({ fill: "red", shape: "ring", text: "empty state" });
        return done(new Error("state resolved to empty"));
      }
      if (typeof state !== "string" && typeof state !== "object") {
        state = String(state);
      }

      node.status({ fill: "blue", shape: "dot", text: "evaluating…" });
      const started = Date.now();

      let result;
      try {
        result = await evaluate(
          server,
          { model: msg.model || server.model, state: state, questions: active.questions },
          { timeout: node.timeout, retries: node.retries }
        );
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: err.message.slice(0, 40) });
        return done(err);
      }

      const ms = Date.now() - started;
      const answers = result.answers || {};
      const envelope = {
        model: result.model,
        answers: answers,
        usage: result.usage,
        latency_ms: ms
      };

      node.status({
        fill: "green",
        shape: "dot",
        text: summarise(answers, active.keys) + " · " + ms + "ms"
      });

      if (node.mode !== "split" || node.outputs <= 1) {
        RED.util.setMessageProperty(msg, node.outputProp, envelope, true);
        send(msg);
        return done();
      }

      // One output per configured question, in editor order. Each branch gets
      // its own answer on msg.answer and the whole response on msg.jev.
      const wires = configured.keys.slice(0, node.outputs).map(function (key, i) {
        const answer = answers[key];
        if (!answer) return null;
        const m = i === 0 ? msg : RED.util.cloneMessage(msg);
        RED.util.setMessageProperty(m, node.outputProp, Object.assign({ question: key }, envelope), true);
        RED.util.setMessageProperty(m, node.answerProp, answer, true);
        return m;
      });

      while (wires.length < node.outputs) wires.push(null);

      send(wires);
      done();
    });

    node.on("close", function () {
      node.status({});
    });
  }

  RED.nodes.registerType("jev", JevNode);
};
