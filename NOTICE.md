# Notices

## License

This package is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0-only). See `LICENSE` for the full text.

The license is chosen to match the upstream work the optimization templates
derive from (below), rather than asserting a more permissive license over that
derived text.

## Third-party attribution

The optimization templates in `templates.js` are adapted from
[linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer),
which is licensed under **AGPL-3.0**.

Adapted from that project:

- the implementation principle of rewriting a prompt with a template pair
  (system framing plus a user turn that carries the target as JSON evidence),
- the three optimization modes (system / user / iterate),
- the output rules: prompt only, no preamble, no code fence,
- the rule that `{{variable}}` placeholders survive verbatim,
- the structural skeleton of the role prompt and the iteration guidance.

The wording in `templates.js` is a condensed rewrite rather than a verbatim
copy. This plugin's own code (the Host and Client halves, the configuration
surface, the agent tool, and the tests) is original work by the package author.

## Using this plugin

Installing and using the plugin inside DeepSeek Harness is ordinary use and is
not restricted. The AGPL terms matter when you **redistribute** it, or **run a
modified version as a network service** — the usual AGPL obligation: share the
source of your changes under the same license.
