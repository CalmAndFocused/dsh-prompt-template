# Notices

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
copy, and this plugin's own code is original. Because the template text derives
from an AGPL-3.0 work, review that license before redistributing this package
where its conditions would apply. To avoid the question entirely, replace
`templates.js` with templates of your own.

## This package

Licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). If your release workflow expects
a `LICENSE` file, add the full text before publishing.
