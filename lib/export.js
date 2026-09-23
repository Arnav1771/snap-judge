// The current document as code you can paste: curl, JavaScript and Python
// against the real TypeSafe API. The Python and JavaScript use the official
// SDK helpers (typesafe_sdk.Choice/Noul/Score, @typesafe-ai/sdk choice/noul/score).

import { toJevRequest } from "./schema.js";

const py = (v) => {
  if (v === null || v === undefined) return "None";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return `[${v.map(py).join(", ")}]`;
  return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${py(x)}`).join(", ")}}`;
};

const indent = (s, n) => s.split("\n").map((l, i) => (i ? " ".repeat(n) + l : l)).join("\n");

export function toCurl(doc, model) {
  const body = JSON.stringify(toJevRequest(doc, model), null, 2);
  return [
    "curl -X POST https://api.typesafe.ai/v1/systemone \\",
    '  -H "Authorization: Bearer $TYPESAFE_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    "  -d @- <<'EOF'",
    body,
    "EOF",
  ].join("\n");
}

export function toPython(doc, model) {
  const req = toJevRequest(doc, model);
  const used = new Set();
  const qs = Object.entries(req.questions).map(([id, q]) => {
    let call;
    if (q.type === "noul") {
      used.add("Noul");
      if (q.criteria) {
        used.add("NoulCriteria");
        call = `Noul(\n    instructions=${py(q.instructions)},\n    criteria=NoulCriteria(true=${py(q.criteria.true)}, false=${py(q.criteria.false)}),\n)`;
      } else {
        call = `Noul(\n    instructions=${py(q.instructions)},\n)`;
      }
    } else if (q.type === "choice") {
      used.add("Choice");
      const crit = Object.entries(q.criteria).map(([k, d]) => `    ${JSON.stringify(k)}: ${py(d)},`).join("\n");
      call = `Choice(\n    instructions=${py(q.instructions)},\n    criteria={\n${indent(crit, 4)}\n    },\n)`;
    } else {
      used.add("Score");
      const crit = q.criteria.map((d) => `    ${py(d)},`).join("\n");
      call = `Score(\n    instructions=${py(q.instructions)},\n    criteria=[\n${indent(crit, 4)}\n    ],\n)`;
    }
    return `        ${JSON.stringify(id)}: ${indent(call, 8)},`;
  });
  const imports = [...used, "TypeSafeClient"].sort().join(", ");
  return [
    `from typesafe_sdk import ${imports}`,
    "",
    `state = ${py(req.state)}`,
    "",
    "with TypeSafeClient() as client:  # reads TYPESAFE_API_KEY",
    "    response = client.system_one(",
    `        model=${JSON.stringify(req.model)},`,
    "        state=state,",
    "        questions={",
    ...qs.map((q) => indent(q, 4)),
    "        },",
    "    )",
    "",
    ...Object.keys(req.questions).map((id) => `print(${JSON.stringify(id)}, response.answers[${JSON.stringify(id)}])`),
  ].join("\n");
}

export function toJs(doc, model) {
  const req = toJevRequest(doc, model);
  const used = new Set();
  const js = (v) => JSON.stringify(v, null, 2);
  const qs = Object.entries(req.questions).map(([id, q]) => {
    used.add(q.type);
    let args;
    if (q.type === "noul") args = q.criteria ? `${js(q.instructions)}, ${indent(js(q.criteria), 4)}` : js(q.instructions);
    else args = `${js(q.instructions)}, ${indent(js(q.criteria), 4)}`;
    return `    ${JSON.stringify(id)}: ${q.type}(${args}),`;
  });
  return [
    `import { ${[...used].sort().join(", ")}, TypeSafeClient } from "@typesafe-ai/sdk";`,
    "",
    "const client = new TypeSafeClient(); // reads TYPESAFE_API_KEY",
    "const response = await client.systemOne({",
    `  model: ${JSON.stringify(req.model)},`,
    `  state: ${indent(js(req.state), 2)},`,
    "  questions: {",
    ...qs,
    "  },",
    "});",
    "",
    "console.log(response.answers);",
  ].join("\n");
}
