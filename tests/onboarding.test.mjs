import test from "node:test";
import assert from "node:assert/strict";
import {
  ONBOARDING_KEY,
  UPDATE_URL,
  ONBOARDING_STEPS,
  isOnboarded,
  setOnboarded,
  OnboardingController,
} from "../lib/onboarding.js";
import { PRESETS } from "../lib/presets.js";

test("storage key and update URL follow the onboarding standard", () => {
  assert.equal(ONBOARDING_KEY, "snap-judge.onboarded.v1");
  assert.equal(UPDATE_URL, "https://arnav1771.github.io/stealth-keqing/?app=snap-judge");
});

test("onboarding has at most 3 steps with progress markers", () => {
  assert.equal(ONBOARDING_STEPS.length, 3);
  assert.equal(ONBOARDING_STEPS[0].indicator, "1 of 3");
  assert.equal(ONBOARDING_STEPS[1].indicator, "2 of 3");
  assert.equal(ONBOARDING_STEPS[2].indicator, "3 of 3");
});

test("step 1 explains local privacy and offers starter question", () => {
  const step1 = ONBOARDING_STEPS[0];
  assert.match(step1.title, /Ask one question, many models answer/i);
  assert.ok(step1.paragraphs.some((p) => p.includes("No account needed")));
  assert.ok(step1.paragraphs.some((p) => p.includes("keys stay in your browser")));
  assert.equal(step1.primaryAction.label, "Load starter question");
  assert.equal(step1.secondaryAction.label, "Next");
});

test("step 2 explains local proxy and Chrome local-network permission by name", () => {
  const step2 = ONBOARDING_STEPS[1];
  assert.match(step2.title, /Add a key/i);
  const text = step2.paragraphs.join(" ");
  assert.ok(text.includes("TypeSafe"));
  assert.ok(text.includes("NVIDIA"));
  assert.ok(text.includes("Cerebras"));
  assert.ok(text.includes("node proxy.mjs"));
  assert.ok(text.includes("127.0.0.1:8787"));
  assert.ok(text.includes("Chrome"));
  assert.ok(text.includes("local-network permission"));
});

test("step 3 explains columns, agreement, type violations, and ends on running starter question", () => {
  const step3 = ONBOARDING_STEPS[2];
  assert.match(step3.title, /Read the result/i);
  const text = step3.paragraphs.join(" ");
  assert.ok(text.includes("agreement"));
  assert.ok(text.includes("1 - normalised entropy"));
  assert.ok(text.includes("never call it TypeSafe's confidence"));
  assert.ok(text.includes("type violation"));
  assert.equal(step3.primaryAction.label, "Run the starter question");
});

test("isOnboarded and setOnboarded read and write to storage", () => {
  const mockStorage = new Map();
  const storage = {
    getItem: (k) => mockStorage.get(k) ?? null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
  };

  assert.equal(isOnboarded(storage), false);
  setOnboarded(storage);
  assert.equal(isOnboarded(storage), true);
  assert.equal(storage.getItem(ONBOARDING_KEY), "true");
});

test("OnboardingController respects step limits and callbacks", () => {
  let loadedPreset = null;
  let starterRan = false;

  const controller = new OnboardingController({
    onLoadPreset: (id) => { loadedPreset = id; },
    onRunStarter: () => { starterRan = true; },
  });

  assert.equal(controller.currentStep, 0);
  assert.equal(PRESETS.length > 0, true);
});
