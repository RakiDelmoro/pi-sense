---
name: automation-creator
description: Manage automation rules for Pi Sense. Use when the user asks to add, modify, or remove an automation that reacts to MQTT sensor data and triggers outbound actions. Creates TypeScript rule files in automations/<slug>/ — rules are auto-discovered by the automation service.
---

# Automation Creator

Manage automation rules for Pi Sense. The user describes a trigger condition and an action; you build a self-contained TypeScript rule.

## Architecture

The automation service is a separate container that subscribes to the same MQTT broker as the dashboard and adapter. It discovers and loads rules at startup.

```
Sensors → MQTT ──→ Adapter (parses, writes InfluxDB, publishes pi-sense/updates/<topic>)
                                                          │
                                ┌─────────────────────────┴─────────────────────────┐
                                ▼                                                   ▼
                          Dashboard                                        Automation service
                          (on update notification,                    (on update notification,
                           queries InfluxDB,                             queries InfluxDB,
                           pushes to browsers)                           evaluates rules, fires actions)
```

- **InfluxDB is the only source of truth.** The automation service never sees raw MQTT payloads. It reacts to `pi-sense/updates/<topic>` notifications published by the adapter after each DB write, then queries InfluxDB for the authoritative value before evaluating rules.
- **Rules are stateless per evaluation.** Each DB-update notification is evaluated independently against the latest DB value. If a rule needs "sustained for N seconds" logic, the rule itself tracks that with timers.
- **Actions are outbound.** Hue lights, webhooks, notifications — anything that produces an external side-effect.

## When to use

Any time the user mentions an automation, trigger, rule, or action tied to sensor data.

Examples of what a user might say:

- "When temperature exceeds 30, turn on the fan"
- "If water-tank drops below 20, send me a webhook"
- "Alert me when raw-pulses is above 100 for more than 5 minutes"
- "Change the high-temp alert threshold to 35"
- "Delete the water-tank low alert"
- "Add a rule that flashes the Hue light when water-flow exceeds 50"

## Auto-discovery

Automation rules are automatically discovered. The automation service scans `automations/*/rule.ts` at startup — no manual wiring needed. Creating or deleting rule files is all you need to do. The service will pick them up on next restart.

## MQTT topic convention

Sensor topics are whatever the sensor configs declare (the adapter subscribes to the topics listed in `sensors/*/config.ts`). A rule's `topic` field must match a real sensor's topic so that `pi-sense/updates/<topic>` notifications route to it. See the existing sensors in `sensors/*/config.ts` for the topics in use.

## Modes

Infer the mode from the user's prompt:

| Trigger words | Mode |
|---|---|
| create, add, make, when, if, alert, notify, trigger, new, build | **Create** |
| change, update, modify, rename, fix, adjust, tweak, replace, redo | **Modify** |
| delete, remove, get rid of, drop, trash | **Delete** |

### Create mode

Generate a new automation rule from scratch.

1. Extract the trigger (topic, condition, threshold, duration) and action (type, target, params) from the prompt
2. If the user doesn't specify the MQTT topic, **always ask** — the topic is required and cannot be guessed
3. If the trigger condition is ambiguous (e.g., "too high"), ask for a specific threshold
4. If the action is vague (e.g., "notify me"), ask what kind — Hue light, webhook, etc.
5. Generate the slug from a short description (lowercase, hyphens, no special chars). If `automations/<slug>/` exists, append a number
6. Create `automations/<slug>/config.ts` and `automations/<slug>/rule.ts`
7. Verify — no other files need to be touched (auto-discovery handles the rest)

### Modify mode

Full control over an existing automation rule.

1. Identify which automation the user is referring to (by label, slug, or topic+condition)
2. If unclear which automation, ask the user to clarify
3. Read the existing files in `automations/<slug>/` to understand what's there
4. Apply the user's requested changes — this may touch any combination of files:
   - Config change (label, topic, threshold, action params) → rewrite `config.ts`
   - Logic change (condition, duration, action type) → rewrite `rule.ts`
   - Rename (label change) → if the slug changes, delete old `automations/<old-slug>/`, create new `automations/<new-slug>/`
5. Verify — no other files need to be touched

### Delete mode

Remove an automation rule. **Always ask for confirmation before deleting.**

1. Identify which automation the user wants to delete
2. Use `ask_user_question` to confirm: *"Delete the automation rule '<label>'?"*
3. If confirmed: remove `automations/<slug>/` folder
4. Verify — no other files need to be touched (auto-discovery will stop including the deleted rule)

## File structure

```
automations/<slug>/
├── config.ts     # Rule metadata — always required
└── rule.ts       # Rule logic — always required
```

**Only create/modify/delete files within `automations/<slug>/`.** Never edit the automation service entry point or any other file outside the rule folder — auto-discovery handles everything.

### config.ts — always this shape

```ts
import type { AutomationConfig } from '../../src/automation/types';

export const config: AutomationConfig = {
  slug: '<slug>',
  label: '<Label>',
  topic: '<topic>',            // sensor topic to react to (e.g. 'esp/water-level')
  enabled: true,
};
```

### rule.ts — always this shape

```ts
import type { AutomationContext, AutomationRule } from '../../src/automation/types';
import { config } from './config';

const rule: AutomationRule = {
  ...config,

  evaluate(ctx: AutomationContext) {
    // ctx.value     — the numeric value from InfluxDB (the only source of truth)
    // ctx.topic     — the sensor topic this rule is subscribed to
    // ctx.raw       — string form of the DB value (NOT the raw MQTT payload)
    // ctx.timestamp — ISO timestamp of the DB point

    // Return an action to fire, or null/undefined to do nothing
    return null;
  },
};

export default rule;
```

## Shared types

### `src/automation/types.ts` — AutomationConfig & AutomationRule

Import: `import type { AutomationConfig, AutomationRule, AutomationContext } from '../../src/automation/types';`

```ts
interface AutomationConfig {
  slug: string;
  label: string;
  topic: string;
  enabled?: boolean;
}

interface AutomationContext {
  value: number;
  topic: string;
  raw: string;
  timestamp: string;
}

type ActionResult =
  | { type: 'hue'; lightId: string | number; state: Record<string, unknown> }
  | { type: 'webhook'; url: string; method?: string; body?: unknown }
  | { type: 'log'; message: string }
  | null;

interface AutomationRule extends AutomationConfig {
  evaluate(ctx: AutomationContext): ActionResult | ActionResult[] | null;
}
```

## Built-in action types

The automation service handles these action types. Rules just return them from `evaluate()`.

| Type | Fields | Description |
|---|---|---|
| `hue` | `lightId`, `state` | Set a Hue light state (on/off, brightness, color). Uses `HUE_BRIDGE_IP` and `HUE_API_KEY` from env. |
| `webhook` | `url`, `method?`, `body?` | Send an HTTP request. `method` defaults to `'POST'`. |
| `log` | `message` | Log a message to the automation service stdout. Useful for debugging. |

## Patterns

### Simple threshold

```ts
evaluate(ctx) {
  if (ctx.value > 30) {
    return { type: 'hue', lightId: 1, state: { on: true, bri: 254 } };
  }
  return null;
}
```

### Threshold with reset (on/off)

```ts
let triggered = false;

evaluate(ctx) {
  if (!triggered && ctx.value > 30) {
    triggered = true;
    return { type: 'hue', lightId: 1, state: { on: true, bri: 254 } };
  }
  if (triggered && ctx.value <= 28) {  // hysteresis
    triggered = false;
    return { type: 'hue', lightId: 1, state: { on: false } };
  }
  return null;
}
```

### Sustained condition (timer-based)

```ts
let timer: ReturnType<typeof setTimeout> | null = null;
let active = false;

evaluate(ctx) {
  if (ctx.value > 100 && !active) {
    if (!timer) {
      timer = setTimeout(() => {
        active = true;
        // Fire action through the service's action dispatcher
        // The rule returns null here; the timer callback uses ctx.dispatch()
      }, 5 * 60 * 1000); // 5 minutes
    }
    return null;
  }
  if (ctx.value <= 100) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (active) {
      active = false;
      return { type: 'hue', lightId: 1, state: { on: false } };
    }
  }
  return null;
}
```

### Multiple actions

```ts
evaluate(ctx) {
  if (ctx.value < 20) {
    return [
      { type: 'hue', lightId: 3, state: { on: true, alert: 'lselect' } },
      { type: 'webhook', url: 'https://example.com/alert', body: { topic: ctx.topic, value: ctx.value } },
    ];
  }
  return null;
}
```

## Slug generation

Derive from the rule's purpose: lowercase, replace spaces/special chars with hyphens, collapse consecutive hyphens, strip leading/trailing hyphens. If `automations/<slug>/` exists, append a number: `high-temp-alert-2`.

Examples:
- "When temperature exceeds 30" → `high-temp-alert`
- "Water tank low alert" → `water-tank-low-alert`
- "Water flow too high" → `water-flow-high`

## Rules

These are non-negotiable.

1. **Rules declare a `topic`, they don't subscribe.** The automation service subscribes to `pi-sense/updates/#` and routes each DB-update notification to rules whose `topic` matches. A rule's `topic` must match a real sensor's topic (see `sensors/*/config.ts`).
2. **The automation service depends on `src/influx/influx.ts`.** It queries InfluxDB for the authoritative value on every notification (shared module, not dashboard-specific code). Rules themselves must not import dashboard server code — they only use `src/automation/types.ts` and return action objects.
3. **Keep rules stateless where possible.** Only use module-level state (timers, flags) when the rule genuinely needs it (sustained conditions, hysteresis). Prefer simple threshold evaluations.
4. **Return actions, don't execute them.** Rules return `ActionResult` objects. The automation service handles the actual Hue API calls, webhook dispatch, etc. This keeps rules testable and side-effect-free.
5. **Scope any module-level state to the rule.** Since each rule is its own module, timers and flags are naturally scoped. Never share state between rules.

## Verify

After any mode (create, modify, delete), verify — **do not start the automation service.**

**TypeScript compiles without errors:**

```bash
bunx tsc --noEmit
```

**For create/modify:** automation folder exists with both required files:

```bash
ls automations/<slug>/config.ts automations/<slug>/rule.ts
```

**For delete:** automation folder no longer exists:

```bash
ls automations/<slug>/ 2>/dev/null && echo "FAIL: folder still exists" || echo "OK: folder removed"
```

## Checklist

### Create

- [ ] Understand the trigger (topic + condition) and action
- [ ] Confirm topic and threshold/action details if ambiguous
- [ ] Generate slug, check for folder conflicts
- [ ] Create `automations/<slug>/config.ts`
- [ ] Create `automations/<slug>/rule.ts` — implement the evaluate logic
- [ ] `bunx tsc --noEmit` — no type errors
- [ ] `ls automations/<slug>/{config.ts,rule.ts}` — all files exist

### Modify

- [ ] Identify which automation (by label, slug, or topic+condition)
- [ ] Read existing files to understand current state
- [ ] Apply changes to the needed files
- [ ] If slug changed: delete old folder, create new folder
- [ ] `bunx tsc --noEmit` — no type errors
- [ ] `ls automations/<slug>/{config.ts,rule.ts}` — all files exist

### Delete

- [ ] Identify which automation (by label, slug, or topic+condition)
- [ ] Ask user for confirmation with `ask_user_question`
- [ ] If confirmed: remove `automations/<slug>/` folder
- [ ] `bunx tsc --noEmit` — no type errors
- [ ] `ls automations/<slug>/ 2>/dev/null` — folder no longer exists
