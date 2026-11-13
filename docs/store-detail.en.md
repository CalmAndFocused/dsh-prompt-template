# Prompt optimizer

Rewrite the prompt you are drafting, without leaving the composer.

## What it does

A **Prompt optimizer** pill sits at the right of the composer tool row (`Alt+O` does the same). Write the prompt you want to improve, open it, pick a mode, and the rewrite **streams in** token by token — reasoning first, then the prompt, cancellable at any point. Accept it and the text lands back in the editor.

Three modes for three real needs: restructure into a role prompt, make a vague request precise, or fold one change into an existing prompt.

## The problem it solves

Ordinary "polishing" treats your instructions as chat. Write "help me optimize: don't interact" and a typical model answers "OK, I won't interact" — it follows your requirement instead of writing it into the prompt.

This plugin hands your text over as **evidence** (framed in JSON) and tells the model to rewrite that text. So "don't interact" becomes part of the prompt: "give the complete answer directly, without back-and-forth confirmation".

It also holds three lines:

- **`{{variable}}` placeholders survive verbatim** — never renamed, never resolved into values, and the panel lists what it found.
- **Only the prompt is returned** — no preamble, explanation, or code fence; the Host strips those too if the model adds them anyway.
- **Your draft is untouched by default** — the result lives in the panel until you accept it.

## Model and configuration

Uses your session default model, with zero configuration. You can instead point it at an OpenAI-compatible endpoint as the preferred route; the key lives in the host credential store, not in configuration.

**Settings → General → Prompt optimizer** changes the default mode, endpoint, temperature, max output tokens, and timeout.

## Also an agent tool

The same operation is the `optimize_prompt` tool, so the assistant calls it when you ask for a prompt to be improved instead of rewriting it in a reply.

## Requirements

DeepSeek Harness 0.2.1-rc.2 or newer. No runtime dependencies.
