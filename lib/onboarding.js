// First-run onboarding for Snap Judge.
// Follows IMP-IMP-DOCS/ONBOARDING.md specifications.

import { PRESETS } from "./presets.js";

export const ONBOARDING_KEY = "snap-judge.onboarded.v1";
export const UPDATE_URL = "https://arnav1771.github.io/stealth-keqing/?app=snap-judge";

export const ONBOARDING_STEPS = [
  {
    step: 1,
    indicator: "1 of 3",
    title: "Ask one question, many models answer.",
    paragraphs: [
      "No account needed. Your keys stay in your browser.",
      "Write typed questions in TypeSafe Jev's format (yes/no noul, pick one choice, score for levels) and run them on Jev or any LLM side by side.",
      "Jev returns a full distribution in one call. General LLMs are sampled multiple times to reveal consistency and agreement.",
    ],
    primaryAction: {
      id: "load-starter",
      label: "Load starter question",
    },
    secondaryAction: {
      id: "next",
      label: "Next",
    },
  },
  {
    step: 2,
    indicator: "2 of 3",
    title: "Add a key.",
    paragraphs: [
      "API keys stay in this browser and are sent directly to the provider you choose.",
      "Three providers (TypeSafe, NVIDIA, Cerebras) block browser calls: they need the local proxy node proxy.mjs (127.0.0.1:8787).",
      "On the hosted page Chrome asks for local-network permission; allow it by name when prompted.",
    ],
    primaryAction: {
      id: "next",
      label: "Next",
    },
    secondaryAction: {
      id: "back",
      label: "Back",
    },
  },
  {
    step: 3,
    indicator: "3 of 3",
    title: "Read the result.",
    paragraphs: [
      "Compare output distributions and confidence-gated routing verdicts (act, confirm, human) side by side.",
      "Agreement shows how closely the models answered alike (1 minus normalised entropy). It is Snap Judge's own measure, not TypeSafe's confidence score.",
      "Any reply returned outside your declared options is counted as a type violation and excluded.",
    ],
    primaryAction: {
      id: "run-starter",
      label: "Run the starter question",
    },
    secondaryAction: {
      id: "back",
      label: "Back",
    },
  },
];

export function isOnboarded(storage = window.localStorage) {
  try {
    return Boolean(storage.getItem(ONBOARDING_KEY));
  } catch {
    return false;
  }
}

export function setOnboarded(storage = window.localStorage) {
  try {
    storage.setItem(ONBOARDING_KEY, "true");
  } catch {
    // Storage might be restricted in private window
  }
}

export class OnboardingController {
  constructor({ onLoadPreset, onRunStarter }) {
    this.onLoadPreset = onLoadPreset;
    this.onRunStarter = onRunStarter;
    this.currentStep = 0;
    this.previouslyFocused = null;
    this.overlay = null;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  mount() {
    this.overlay = document.getElementById("onboarding-overlay");
    if (!this.overlay) return;

    // Attach skip handler
    const skipBtn = this.overlay.querySelector("#onboarding-skip");
    if (skipBtn) {
      skipBtn.addEventListener("click", () => this.skip());
    }

    // Attach backdrop click handler
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.skip();
      }
    });

    // Check if should open automatically on first run
    if (!isOnboarded()) {
      this.open();
    }
  }

  open(step = 0) {
    if (!this.overlay) return;
    this.previouslyFocused = document.activeElement;
    this.currentStep = Math.max(0, Math.min(step, ONBOARDING_STEPS.length - 1));
    this.render();
    this.overlay.hidden = false;
    document.addEventListener("keydown", this.handleKeyDown);

    // Focus primary action button
    requestAnimationFrame(() => {
      const primaryBtn = this.overlay.querySelector("#onboarding-primary-btn");
      if (primaryBtn) primaryBtn.focus();
    });
  }

  close() {
    if (!this.overlay) return;
    this.overlay.hidden = true;
    document.removeEventListener("keydown", this.handleKeyDown);
    if (this.previouslyFocused && typeof this.previouslyFocused.focus === "function") {
      this.previouslyFocused.focus();
    }
  }

  skip() {
    setOnboarded();
    this.close();
  }

  complete() {
    setOnboarded();
    this.close();
    if (this.onRunStarter) {
      this.onRunStarter();
    }
  }

  render() {
    if (!this.overlay) return;
    const stepData = ONBOARDING_STEPS[this.currentStep];
    if (!stepData) return;

    const indicator = this.overlay.querySelector("#onboarding-step-indicator");
    if (indicator) indicator.textContent = stepData.indicator;

    const title = this.overlay.querySelector("#onboarding-title");
    if (title) title.textContent = stepData.title;

    const content = this.overlay.querySelector("#onboarding-content");
    if (content) {
      content.innerHTML = stepData.paragraphs
        .map((p) => `<p>${this.formatParagraph(p)}</p>`)
        .join("");
    }

    const actionsContainer = this.overlay.querySelector("#onboarding-actions");
    if (actionsContainer) {
      actionsContainer.innerHTML = "";

      if (stepData.secondaryAction) {
        const secBtn = document.createElement("button");
        secBtn.type = "button";
        secBtn.className = "btn ghost small";
        secBtn.textContent = stepData.secondaryAction.label;
        secBtn.addEventListener("click", () => {
          if (stepData.secondaryAction.id === "back") {
            this.currentStep--;
            this.render();
          } else if (stepData.secondaryAction.id === "next") {
            this.currentStep++;
            this.render();
          }
        });
        actionsContainer.appendChild(secBtn);
      }

      if (stepData.primaryAction) {
        const primBtn = document.createElement("button");
        primBtn.type = "button";
        primBtn.id = "onboarding-primary-btn";
        primBtn.className = "btn primary";
        primBtn.textContent = stepData.primaryAction.label;
        primBtn.addEventListener("click", () => {
          if (stepData.primaryAction.id === "load-starter") {
            if (this.onLoadPreset && PRESETS.length > 0) {
              this.onLoadPreset(PRESETS[0].id);
            }
            this.currentStep++;
            this.render();
          } else if (stepData.primaryAction.id === "next") {
            this.currentStep++;
            this.render();
          } else if (stepData.primaryAction.id === "run-starter") {
            this.complete();
          }
        });
        actionsContainer.appendChild(primBtn);
      }
    }
  }

  formatParagraph(text) {
    return text
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/node proxy\.mjs \(127\.0\.1\.1:8787\)/g, "<code>node proxy.mjs</code> (127.0.0.1:8787)")
      .replace(/\b(noul|choice|score)\b/g, "<code>$1</code>");
  }

  handleKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      this.skip();
      return;
    }

    if (e.key === "Tab") {
      this.trapFocus(e);
    }
  }

  trapFocus(e) {
    const focusables = this.overlay.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
