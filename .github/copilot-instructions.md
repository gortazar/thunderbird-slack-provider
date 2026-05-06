# Copilot instructions for this repository

## Objective
When suggesting or generating code in this repository, prioritize correctness, maintainability, test coverage, and consistency with the existing codebase.

## General rules
- Prefer small, focused changes over broad refactors.
- Follow the repository's existing architecture, naming conventions, and coding style.
- Reuse existing utilities and patterns before introducing new abstractions.
- Do not introduce unnecessary dependencies.

## Code generation
- Produce production-ready code, not pseudocode.
- Keep implementations simple and readable.
- Handle error cases explicitly.
- Consider null/undefined values, empty inputs, invalid states, and boundary conditions.
- Call out assumptions when repository context is incomplete.

## Testing
- For every functional change, add or propose relevant tests.
- Prefer unit tests unless integration tests are more appropriate.
- Explain what behavior is covered by the tests.
- Mention important scenarios that are not covered yet.

## Security and reliability
- Consider input validation, authorization, secret handling, injection risks, and data exposure.
- Consider timeouts, retries, idempotency, concurrency, and partial failure handling where applicable.

## Dependencies and versions
- Respect the dependency versions and tooling already defined in the repository.
- Do not claim a dependency version is the latest unless it has been explicitly verified.
- If suggesting a new dependency, explain why it is needed, its tradeoffs, and possible alternatives.

## Output format
When responding with code changes, include:
1. A brief summary
2. The proposed code
3. Tests added or recommended
4. Risks, assumptions, or follow-up items
5. Verification steps