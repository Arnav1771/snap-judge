// Starting points. Each shows one of TypeSafe's documented patterns with
// content written for this app.

export const PRESETS = [
  {
    id: "triage",
    label: "Support ticket triage",
    pattern: "Speculative fan-out: ask everything the router might need in one call.",
    doc: {
      stateIsJson: false,
      state:
        "I ordered the blue kettle (order #58213) on Monday. It arrived today with a cracked lid, and my card " +
        "was charged twice. My parents visit on Saturday and I need a kettle that works before then.",
      questions: [
        {
          id: "department", type: "choice", instructions: "Which team should handle this message?",
          options: [
            { name: "returns", description: "Damaged, wrong or unwanted items; exchanges" },
            { name: "shipping", description: "Late, lost or misdelivered packages" },
            { name: "billing", description: "Charges, refunds of payments, invoices" },
            { name: "other", description: "Anything that fits none of the above" },
          ],
        },
        {
          id: "wants_replacement", type: "noul", instructions: "Does the customer want the item replaced?",
          criteria: { true: "Asks for a new or working item", false: "Asks only for money back, or nothing" },
        },
        {
          id: "frustration", type: "score", instructions: "How frustrated does the customer appear?",
          levels: ["Calm, just stating facts", "Frustrated but civil", "Angry, strong language"],
        },
        { id: "time_sensitive", type: "noul", instructions: "The message says the problem has a deadline.", criteria: { true: "", false: "" } },
      ],
    },
  },
  {
    id: "routing",
    label: "Voice banking intent",
    pattern: "Confidence-gated routing: act, confirm, or hand to a person.",
    doc: {
      stateIsJson: false,
      state: "uh yeah can you move like two hundred over to savings, or wait, what's in checking first",
      questions: [
        {
          id: "intent", type: "choice", instructions: "What does the caller want to do right now?",
          options: [
            { name: "check_balance", description: "Hear the balance of an account" },
            { name: "transfer_funds", description: "Move money between their own accounts" },
            { name: "pay_someone", description: "Send money to another person or company" },
            { name: "support", description: "Talk to someone about a problem" },
          ],
        },
        {
          id: "amount_stated", type: "noul", instructions: "Does the caller state an exact amount of money?",
          criteria: { true: "A specific number, like 200", false: "No amount, or only a vague one" },
        },
      ],
    },
  },
  {
    id: "bug",
    label: "Bug report",
    pattern: "Score levels you define, plus nouls the code can threshold.",
    doc: {
      stateIsJson: true,
      state: JSON.stringify({
        title: "Export button freezes the settings page in Safari",
        body: "Clicking Export on Settings > Data freezes the tab in Safari 19. Chrome and Firefox are fine. " +
          "Steps: open Settings, choose Data, click Export. Our finance team only uses Safari.",
        reporter: { plan: "business", seats: 40 },
      }, null, 2),
      questions: [
        {
          id: "severity", type: "score", instructions: "How severe is the problem described in `body`?",
          levels: [
            "Cosmetic; nothing stops working",
            "A feature is broken but a workaround exists",
            "A feature is broken for some users with no workaround",
            "Data loss, security, or the whole product is down",
          ],
        },
        { id: "has_repro_steps", type: "noul", instructions: "Does `body` give steps to reproduce the problem?", criteria: { true: "", false: "" } },
        {
          id: "area", type: "choice", instructions: "Which part of the product does `title` point to?",
          options: [
            { name: "settings", description: "" }, { name: "billing", description: "" },
            { name: "editor", description: "" }, { name: "other", description: "" },
          ],
        },
      ],
    },
  },
  {
    id: "resume",
    label: "Resume screen",
    pattern: "Composite scoring: several narrow scores, weighted in your code.",
    doc: {
      stateIsJson: false,
      state:
        "Backend engineer, 6 years. Wrote Python daily at two fintechs: payment reconciliation services on " +
        "FastAPI and Postgres, Kafka consumers handling 40k events a second. Led a team of four for one year. " +
        "Some React. No formal system-design interviews, but designed our ledger's sharding scheme.",
      questions: [
        {
          id: "python_depth", type: "score", instructions: "How much Python experience does the candidate show?",
          levels: ["None", "Occasional scripts", "Regular use in a job", "Deep, production-scale expertise"],
        },
        {
          id: "leadership", type: "score", instructions: "How much people leadership does the candidate show?",
          levels: ["None", "Mentored or led informally", "Managed a team"],
        },
        { id: "distributed_systems", type: "noul", instructions: "Does the resume show hands-on work with distributed systems?", criteria: { true: "", false: "" } },
      ],
    },
  },
];
